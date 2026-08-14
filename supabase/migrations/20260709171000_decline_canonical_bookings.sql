-- Partner declines are terminal execution outcomes, not ordinary booking-row
-- edits. Keep the booking, action, audit, and host evidence in one service-only
-- transaction; an invalid member aborts the entire canonical batch.

CREATE OR REPLACE FUNCTION public.decline_canonical_bookings(
  p_booking_kind TEXT,
  p_booking_ids UUID[],
  p_actor_id UUID,
  p_reason TEXT,
  p_decline_context JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_requested_count INTEGER;
  v_distinct_count INTEGER;
  v_booking_id UUID;
  v_partner_actor_id UUID;
  v_partner_id UUID;
  v_plan_id UUID;
  v_event_id UUID;
  v_action_id UUID;
  v_approval_id UUID;
  v_organizer_id UUID;
  v_quoted_price_cents INTEGER;
  v_approved_terms_snapshot JSONB;
  v_booking_status TEXT;
  v_plan public.plans%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_action public.agent_actions%ROWTYPE;
  v_approval public.approvals%ROWTYPE;
  v_venue_booking public.venue_bookings%ROWTYPE;
  v_vendor_booking public.vendor_bookings%ROWTYPE;
  v_marker JSONB;
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
  v_results JSONB := '[]'::jsonb;
  v_bookings JSONB := '[]'::jsonb;
  v_existing_count INTEGER := 0;
  v_now TIMESTAMPTZ := transaction_timestamp();
BEGIN
  IF current_user <> 'postgres'
    AND NOT (current_user = 'service_role' AND auth.role() = 'service_role')
  THEN
    RAISE EXCEPTION 'decline_canonical_bookings_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  v_requested_count := COALESCE(cardinality(p_booking_ids), 0);
  IF p_booking_kind NOT IN ('venue', 'vendor')
    OR p_actor_id IS NULL
    OR v_requested_count < 1
    OR v_requested_count > 100
    OR v_reason = ''
    OR length(v_reason) > 1000
    OR jsonb_typeof(COALESCE(p_decline_context, '{}'::jsonb)) IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION 'decline_canonical_bookings_invalid_contract'
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(DISTINCT booking_id)::INTEGER
  INTO v_distinct_count
  FROM unnest(p_booking_ids) AS requested(booking_id)
  WHERE booking_id IS NOT NULL;

  IF v_distinct_count <> v_requested_count THEN
    RAISE EXCEPTION 'decline_canonical_bookings_ids_must_be_unique'
      USING ERRCODE = '22023';
  END IF;

  -- Lock every requested aggregate before validation or mutation, using the
  -- same plan -> event -> action -> approval -> partner -> booking order as
  -- confirmation and host cancellation. Each class is sorted so overlapping
  -- bulk commands cannot acquire the same rows in caller-dependent order.
  IF p_booking_kind = 'venue' THEN
    PERFORM plan_row.id
    FROM public.plans AS plan_row
    JOIN public.venue_bookings AS booking ON booking.plan_id = plan_row.id
    WHERE booking.id = ANY(p_booking_ids)
    ORDER BY plan_row.id, booking.id
    FOR UPDATE OF plan_row;

    PERFORM event_row.id
    FROM public.events AS event_row
    JOIN public.venue_bookings AS booking ON booking.event_id = event_row.id
    WHERE booking.id = ANY(p_booking_ids)
    ORDER BY event_row.id, booking.id
    FOR SHARE OF event_row;

    PERFORM action_row.id
    FROM public.agent_actions AS action_row
    JOIN public.venue_bookings AS booking ON booking.agent_action_id = action_row.id
    WHERE booking.id = ANY(p_booking_ids)
    ORDER BY action_row.id, booking.id
    FOR UPDATE OF action_row;

    PERFORM approval_row.id
    FROM public.approvals AS approval_row
    JOIN public.venue_bookings AS booking ON booking.approval_id = approval_row.id
    WHERE booking.id = ANY(p_booking_ids)
    ORDER BY approval_row.id, booking.id
    FOR UPDATE OF approval_row;

    PERFORM venue.id
    FROM public.venues AS venue
    JOIN public.venue_bookings AS booking ON booking.venue_id = venue.id
    WHERE booking.id = ANY(p_booking_ids)
    ORDER BY venue.id, booking.id
    FOR SHARE OF venue;

    PERFORM booking.id
    FROM public.venue_bookings AS booking
    WHERE booking.id = ANY(p_booking_ids)
    ORDER BY booking.id
    FOR UPDATE;
  ELSE
    PERFORM plan_row.id
    FROM public.plans AS plan_row
    JOIN public.vendor_bookings AS booking ON booking.plan_id = plan_row.id
    WHERE booking.id = ANY(p_booking_ids)
    ORDER BY plan_row.id, booking.id
    FOR UPDATE OF plan_row;

    PERFORM event_row.id
    FROM public.events AS event_row
    JOIN public.vendor_bookings AS booking ON booking.event_id = event_row.id
    WHERE booking.id = ANY(p_booking_ids)
    ORDER BY event_row.id, booking.id
    FOR SHARE OF event_row;

    PERFORM action_row.id
    FROM public.agent_actions AS action_row
    JOIN public.vendor_bookings AS booking ON booking.agent_action_id = action_row.id
    WHERE booking.id = ANY(p_booking_ids)
    ORDER BY action_row.id, booking.id
    FOR UPDATE OF action_row;

    PERFORM approval_row.id
    FROM public.approvals AS approval_row
    JOIN public.vendor_bookings AS booking ON booking.approval_id = approval_row.id
    WHERE booking.id = ANY(p_booking_ids)
    ORDER BY approval_row.id, booking.id
    FOR UPDATE OF approval_row;

    PERFORM vendor.id
    FROM public.vendor_profiles AS vendor
    JOIN public.vendor_bookings AS booking ON booking.vendor_id = vendor.id
    WHERE booking.id = ANY(p_booking_ids)
    ORDER BY vendor.id, booking.id
    FOR SHARE OF vendor;

    PERFORM booking.id
    FROM public.vendor_bookings AS booking
    WHERE booking.id = ANY(p_booking_ids)
    ORDER BY booking.id
    FOR UPDATE;
  END IF;

  -- No member is changed until the complete requested set is locked and its
  -- actor is verified against the locked partner record.
  FOR v_booking_id IN
    SELECT requested.booking_id
    FROM unnest(p_booking_ids) AS requested(booking_id)
    ORDER BY requested.booking_id
  LOOP
    IF p_booking_kind = 'venue' THEN
      SELECT booking.*
      INTO v_venue_booking
      FROM public.venue_bookings AS booking
      WHERE booking.id = v_booking_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'decline_canonical_bookings_booking_not_found'
          USING ERRCODE = 'P0002', DETAIL = v_booking_id::TEXT;
      END IF;

      SELECT venue.owner_id
      INTO v_partner_actor_id
      FROM public.venues AS venue
      WHERE venue.id = v_venue_booking.venue_id;
    ELSE
      SELECT booking.*
      INTO v_vendor_booking
      FROM public.vendor_bookings AS booking
      WHERE booking.id = v_booking_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'decline_canonical_bookings_booking_not_found'
          USING ERRCODE = 'P0002', DETAIL = v_booking_id::TEXT;
      END IF;

      SELECT vendor.user_id
      INTO v_partner_actor_id
      FROM public.vendor_profiles AS vendor
      WHERE vendor.id = v_vendor_booking.vendor_id;
    END IF;

    IF NOT FOUND OR v_partner_actor_id IS DISTINCT FROM p_actor_id THEN
      RAISE EXCEPTION 'decline_canonical_bookings_partner_mismatch'
        USING ERRCODE = '42501', DETAIL = v_booking_id::TEXT;
    END IF;

    v_booking_status := CASE
      WHEN p_booking_kind = 'venue' THEN v_venue_booking.status
      ELSE v_vendor_booking.status
    END;
    IF v_booking_status NOT IN ('pending', 'declined') THEN
      RAISE EXCEPTION 'decline_canonical_bookings_invalid_booking_state'
        USING ERRCODE = '23514', DETAIL = v_booking_id::TEXT || '|' || COALESCE(v_booking_status, 'null');
    END IF;
  END LOOP;

  FOR v_booking_id IN
    SELECT requested.booking_id
    FROM unnest(p_booking_ids) AS requested(booking_id)
    ORDER BY requested.booking_id
  LOOP
    IF p_booking_kind = 'venue' THEN
      SELECT booking.* INTO v_venue_booking
      FROM public.venue_bookings AS booking
      WHERE booking.id = v_booking_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'decline_canonical_bookings_booking_not_found'
          USING ERRCODE = 'P0002', DETAIL = v_booking_id::TEXT;
      END IF;

      v_partner_id := v_venue_booking.venue_id;
      v_plan_id := v_venue_booking.plan_id;
      v_event_id := v_venue_booking.event_id;
      v_action_id := v_venue_booking.agent_action_id;
      v_approval_id := v_venue_booking.approval_id;
      v_organizer_id := v_venue_booking.organizer_id;
      v_quoted_price_cents := v_venue_booking.quoted_price_cents;
      v_approved_terms_snapshot := v_venue_booking.approved_terms_snapshot;
      v_booking_status := v_venue_booking.status;
    ELSE
      SELECT booking.* INTO v_vendor_booking
      FROM public.vendor_bookings AS booking
      WHERE booking.id = v_booking_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'decline_canonical_bookings_booking_not_found'
          USING ERRCODE = 'P0002', DETAIL = v_booking_id::TEXT;
      END IF;

      v_partner_id := v_vendor_booking.vendor_id;
      v_plan_id := v_vendor_booking.plan_id;
      v_event_id := v_vendor_booking.event_id;
      v_action_id := v_vendor_booking.agent_action_id;
      v_approval_id := v_vendor_booking.approval_id;
      v_organizer_id := v_vendor_booking.organizer_id;
      v_quoted_price_cents := v_vendor_booking.quoted_price_cents;
      v_approved_terms_snapshot := v_vendor_booking.approved_terms_snapshot;
      v_booking_status := v_vendor_booking.status;
    END IF;

    IF v_plan_id IS NULL OR v_action_id IS NULL OR v_approval_id IS NULL
      OR v_quoted_price_cents IS NULL OR v_approved_terms_snapshot IS NULL
    THEN
      RAISE EXCEPTION 'decline_canonical_bookings_provenance_incomplete'
        USING ERRCODE = '23514', DETAIL = v_booking_id::TEXT;
    END IF;

    SELECT plan_row.* INTO v_plan
    FROM public.plans AS plan_row
    WHERE plan_row.id = v_plan_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'decline_canonical_bookings_identity_mismatch'
        USING ERRCODE = '23514', DETAIL = v_booking_id::TEXT || '|plan';
    END IF;

    SELECT event_row.* INTO v_event
    FROM public.events AS event_row
    WHERE event_row.id = v_event_id
      AND event_row.plan_id = v_plan_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'decline_canonical_bookings_identity_mismatch'
        USING ERRCODE = '23514', DETAIL = v_booking_id::TEXT || '|event';
    END IF;

    SELECT action_row.* INTO v_action
    FROM public.agent_actions AS action_row
    WHERE action_row.id = v_action_id
      AND action_row.plan_id = v_plan_id
      AND action_row.approval_id = v_approval_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'decline_canonical_bookings_identity_mismatch'
        USING ERRCODE = '23514', DETAIL = v_booking_id::TEXT || '|action';
    END IF;

    SELECT approval_row.* INTO v_approval
    FROM public.approvals AS approval_row
    WHERE approval_row.id = v_approval_id
      AND approval_row.plan_id = v_plan_id
      AND approval_row.agent_action_id = v_action_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'decline_canonical_bookings_identity_mismatch'
        USING ERRCODE = '23514', DETAIL = v_booking_id::TEXT || '|approval';
    END IF;

    IF v_plan.materialized_event_id IS DISTINCT FROM v_event_id
      OR v_plan.user_id IS DISTINCT FROM v_organizer_id
      OR v_event.plan_id IS DISTINCT FROM v_plan.id
      OR v_action.payload_json ->> 'kind' IS DISTINCT FROM 'canonical_quote_booking'
      OR v_action.payload_json ->> 'quote_kind' IS DISTINCT FROM p_booking_kind
      OR (
        v_booking_status = 'declined'
        AND v_approval.status NOT IN ('approved', 'authorized', 'cancelled', 'rejected')
      )
      OR (
        v_booking_status <> 'declined'
        AND v_approval.status NOT IN ('approved', 'authorized')
      )
    THEN
      RAISE EXCEPTION 'decline_canonical_bookings_identity_mismatch'
        USING ERRCODE = '23514', DETAIL = v_booking_id::TEXT;
    END IF;

    v_marker := v_action.result_metadata -> 'canonical_booking_decline';
    IF v_booking_status = 'declined' THEN
      IF v_action.status IS DISTINCT FROM 'cancelled'
        OR v_marker ->> 'booking_id' IS DISTINCT FROM v_booking_id::TEXT
        OR v_marker ->> 'booking_kind' IS DISTINCT FROM p_booking_kind
        OR v_marker ->> 'approval_id' IS DISTINCT FROM v_approval_id::TEXT
        OR NULLIF(btrim(v_approval.snapshot_hash), '') IS NULL
        OR v_marker ->> 'approval_snapshot_hash' IS DISTINCT FROM v_approval.snapshot_hash
        OR v_approval.snapshot_json IS DISTINCT FROM v_approved_terms_snapshot
        OR v_marker ->> 'declined_by' IS DISTINCT FROM p_actor_id::TEXT
        OR v_marker ->> 'reason' IS DISTINCT FROM v_reason
        OR (v_marker -> 'context') - 'source' - 'route_confirmed'
          IS DISTINCT FROM COALESCE(p_decline_context, '{}'::jsonb) - 'source' - 'route_confirmed'
        OR (
          p_booking_kind = 'venue'
          AND (
            v_venue_booking.decline_reason IS DISTINCT FROM v_reason
            OR v_venue_booking.rejection_reason IS DISTINCT FROM v_reason
          )
        )
        OR (
          p_booking_kind = 'vendor'
          AND v_vendor_booking.decline_reason IS DISTINCT FROM v_reason
        )
      THEN
        RAISE EXCEPTION 'decline_canonical_bookings_idempotency_conflict'
          USING ERRCODE = '40001', DETAIL = v_booking_id::TEXT;
      END IF;

      v_existing_count := v_existing_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'existing', true,
        'booking_id', v_booking_id,
        'booking_kind', p_booking_kind,
        'booking_status', 'declined',
        'action_status', v_action.status,
        'approval_status', v_approval.status,
        'plan_id', v_plan.id,
        'event_id', v_event.id,
        'reason', v_reason
      ));
      CONTINUE;
    END IF;

    IF v_action.status IS DISTINCT FROM 'executing' OR v_marker IS NOT NULL THEN
      RAISE EXCEPTION 'decline_canonical_bookings_action_not_declineable'
        USING ERRCODE = '23514', DETAIL = v_booking_id::TEXT || '|' || COALESCE(v_action.status, 'null');
    END IF;

    -- Move the action to its terminal, non-retryable state first. The booking
    -- provenance trigger requires a declined canonical booking to point at a
    -- cancelled action, so a direct booking-only service update cannot pass.
    UPDATE public.agent_actions AS action_row
    SET status = 'cancelled',
        result_metadata = COALESCE(action_row.result_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'canonical_booking_status', 'declined',
            'booking_id', v_booking_id,
            'booking_kind', p_booking_kind,
            'approval_status_preserved', v_approval.status,
            'outbound_message_sent', false,
            'canonical_booking_decline', jsonb_build_object(
              'booking_id', v_booking_id,
              'booking_kind', p_booking_kind,
              'approval_id', v_approval_id,
              'approval_snapshot_hash', v_approval.snapshot_hash,
              'declined_by', p_actor_id,
              'declined_at', v_now,
              'reason', v_reason,
              'context', COALESCE(p_decline_context, '{}'::jsonb)
            )
          ),
        updated_at = v_now
    WHERE action_row.id = v_action.id
      AND action_row.status = 'executing'
    RETURNING action_row.* INTO v_action;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'decline_canonical_bookings_action_state_conflict'
        USING ERRCODE = '40001', DETAIL = v_booking_id::TEXT;
    END IF;

    -- The negative transition is validated after the action has moved to its
    -- matching terminal state. Any mismatch rolls this transaction back, while
    -- completed/archived plans can still clean up stranded pending work.
    IF NOT public.canonical_booking_has_execution_provenance(
      p_booking_kind,
      v_partner_id,
      v_event_id,
      v_plan_id,
      v_action_id,
      v_approval_id,
      v_organizer_id,
      v_quoted_price_cents,
      v_approved_terms_snapshot,
      'declined'
    ) THEN
      RAISE EXCEPTION 'decline_canonical_bookings_provenance_mismatch'
        USING ERRCODE = '23514', DETAIL = v_booking_id::TEXT;
    END IF;

    IF p_booking_kind = 'venue' THEN
      UPDATE public.venue_bookings AS booking
      SET status = 'declined',
          decline_reason = v_reason,
          rejection_reason = v_reason,
          responded_at = v_now,
          updated_at = v_now
      WHERE booking.id = v_booking_id
        AND booking.status = 'pending'
      RETURNING booking.* INTO v_venue_booking;
    ELSE
      UPDATE public.vendor_bookings AS booking
      SET status = 'declined',
          decline_reason = v_reason,
          responded_at = v_now,
          updated_at = v_now
      WHERE booking.id = v_booking_id
        AND booking.status = 'pending'
      RETURNING booking.* INTO v_vendor_booking;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'decline_canonical_bookings_booking_state_conflict'
        USING ERRCODE = '40001', DETAIL = v_booking_id::TEXT;
    END IF;

    INSERT INTO public.agent_action_audit_log (
      action_id, plan_id, from_status, to_status, actor_id, actor_role,
      reason, metadata
    ) VALUES (
      v_action.id, v_plan.id, 'executing', 'cancelled', p_actor_id, 'external',
      'canonical_booking.partner_declined',
      jsonb_build_object(
        'booking_id', v_booking_id,
        'booking_kind', p_booking_kind,
        'approval_id', v_approval.id,
        'approval_status_preserved', v_approval.status,
        'decline_reason', v_reason,
        'decline_context', COALESCE(p_decline_context, '{}'::jsonb)
      )
    );

    INSERT INTO public.plan_messages (
      plan_id, role, content, message_type, metadata
    ) VALUES (
      v_plan.id,
      'system',
      'The ' || p_booking_kind || ' declined the booking request: ' || v_reason,
      'status_update',
      jsonb_build_object(
        'kind', 'canonical_booking_declined',
        'booking_id', v_booking_id,
        'booking_kind', p_booking_kind,
        'event_id', v_event.id,
        'agent_action_id', v_action.id,
        'approval_id', v_approval.id,
        'reason', v_reason,
        'outbound_message_sent', false
      )
    );

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'existing', false,
      'booking_id', v_booking_id,
      'booking_kind', p_booking_kind,
      'booking_status', 'declined',
      'action_status', v_action.status,
      'approval_status', v_approval.status,
      'plan_id', v_plan.id,
      'event_id', v_event.id,
      'reason', v_reason
    ));
  END LOOP;

  IF p_booking_kind = 'venue' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(booking) ORDER BY booking.id), '[]'::jsonb)
    INTO v_bookings
    FROM public.venue_bookings AS booking
    WHERE booking.id = ANY(p_booking_ids);
  ELSE
    SELECT COALESCE(jsonb_agg(to_jsonb(booking) ORDER BY booking.id), '[]'::jsonb)
    INTO v_bookings
    FROM public.vendor_bookings AS booking
    WHERE booking.id = ANY(p_booking_ids);
  END IF;

  RETURN jsonb_build_object(
    'status', 'complete',
    'booking_kind', p_booking_kind,
    'requested_count', v_requested_count,
    'declined_count', v_requested_count,
    'existing_count', v_existing_count,
    'reason', v_reason,
    'results', v_results,
    'bookings', v_bookings
  );
END;
$function$;

COMMENT ON FUNCTION public.decline_canonical_bookings(TEXT, UUID[], UUID, TEXT, JSONB)
  IS 'Atomically records partner decline outcomes for one or more exactly-provenanced pending canonical bookings.';

REVOKE ALL ON FUNCTION public.decline_canonical_bookings(TEXT, UUID[], UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decline_canonical_bookings(TEXT, UUID[], UUID, TEXT, JSONB)
  TO service_role;
