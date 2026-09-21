-- Prompt 8: canonical bulk confirmation route effects are independently
-- replayable. Confirmation may commit before the HTTP worker writes its
-- notification/audit rows, so both effects use the booking id as a durable
-- idempotency key and are reconciled by one locked service command.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS canonical_venue_confirmation_booking_id UUID
    REFERENCES public.venue_bookings(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_canonical_venue_confirmation_unique
  ON public.notifications(canonical_venue_confirmation_booking_id)
  WHERE canonical_venue_confirmation_booking_id IS NOT NULL;

ALTER TABLE public.venue_booking_approval_audit
  ADD COLUMN IF NOT EXISTS canonical_confirmation_booking_id UUID
    REFERENCES public.venue_bookings(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS venue_booking_audit_canonical_confirmation_unique
  ON public.venue_booking_approval_audit(canonical_confirmation_booking_id)
  WHERE canonical_confirmation_booking_id IS NOT NULL;

COMMENT ON COLUMN public.notifications.canonical_venue_confirmation_booking_id IS
  'Deterministic idempotency key for the host notification created by canonical venue bulk confirmation.';
COMMENT ON COLUMN public.venue_booking_approval_audit.canonical_confirmation_booking_id IS
  'Deterministic idempotency key for the route-level audit receipt created by canonical venue bulk confirmation.';

CREATE OR REPLACE FUNCTION public.ensure_canonical_venue_confirmation_effects(
  p_booking_ids UUID[],
  p_actor_id UUID,
  p_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_requested_count INTEGER := COALESCE(cardinality(p_booking_ids), 0);
  v_distinct_count INTEGER;
  v_booking_id UUID;
  v_booking public.venue_bookings%ROWTYPE;
  v_plan public.plans%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_action public.agent_actions%ROWTYPE;
  v_approval public.approvals%ROWTYPE;
  v_venue public.venues%ROWTYPE;
  v_builder_user_id UUID;
  v_notification_id UUID;
  v_audit_id UUID;
  v_audit_inserted BOOLEAN;
  v_notification_inserted BOOLEAN;
  v_effected_count INTEGER := 0;
  v_existing_count INTEGER := 0;
  v_skipped_count INTEGER := 0;
  v_results JSONB := '[]'::jsonb;
  v_message TEXT := NULLIF(btrim(p_message), '');
BEGIN
  IF current_user <> 'postgres'
    AND NOT (current_user = 'service_role' AND auth.role() = 'service_role')
  THEN
    RAISE EXCEPTION 'ensure_canonical_venue_confirmation_effects_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL
    OR v_requested_count < 1
    OR v_requested_count > 100
    OR length(COALESCE(v_message, '')) > 1000
  THEN
    RAISE EXCEPTION 'ensure_canonical_venue_confirmation_effects_invalid_contract'
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(DISTINCT requested.booking_id)::INTEGER
  INTO v_distinct_count
  FROM unnest(p_booking_ids) AS requested(booking_id)
  WHERE requested.booking_id IS NOT NULL;

  IF v_distinct_count <> v_requested_count THEN
    RAISE EXCEPTION 'ensure_canonical_venue_confirmation_effects_ids_must_be_unique'
      USING ERRCODE = '22023';
  END IF;

  -- Match canonical confirmation lock order. This command can race an exact
  -- confirmation replay without introducing an inverse booking -> plan wait.
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

  IF (SELECT COUNT(*) FROM public.venue_bookings WHERE id = ANY(p_booking_ids))
    <> v_requested_count
  THEN
    RAISE EXCEPTION 'ensure_canonical_venue_confirmation_effects_booking_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  FOR v_booking_id IN
    SELECT requested.booking_id
    FROM unnest(p_booking_ids) AS requested(booking_id)
    ORDER BY requested.booking_id
  LOOP
    SELECT booking.* INTO v_booking
    FROM public.venue_bookings AS booking
    WHERE booking.id = v_booking_id;

    SELECT plan_row.* INTO v_plan
    FROM public.plans AS plan_row
    WHERE plan_row.id = v_booking.plan_id;
    SELECT event_row.* INTO v_event
    FROM public.events AS event_row
    WHERE event_row.id = v_booking.event_id;
    SELECT action_row.* INTO v_action
    FROM public.agent_actions AS action_row
    WHERE action_row.id = v_booking.agent_action_id;
    SELECT approval_row.* INTO v_approval
    FROM public.approvals AS approval_row
    WHERE approval_row.id = v_booking.approval_id;
    SELECT venue.* INTO v_venue
    FROM public.venues AS venue
    WHERE venue.id = v_booking.venue_id;

    IF v_venue.owner_id IS DISTINCT FROM p_actor_id THEN
      RAISE EXCEPTION 'ensure_canonical_venue_confirmation_effects_owner_mismatch'
        USING ERRCODE = '42501', DETAIL = v_booking_id::TEXT;
    END IF;

    -- Only confirmations performed through the canonical bulk command are
    -- eligible. An already-confirmed booking from another route stays skipped.
    IF v_booking.status IS DISTINCT FROM 'confirmed'
      OR v_action.status IS DISTINCT FROM 'complete'
      OR v_action.result_metadata #>> '{confirmation_context,bulk_confirmation}'
        IS DISTINCT FROM 'true'
    THEN
      v_skipped_count := v_skipped_count + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'booking_id', v_booking_id,
        'effect_status', 'skipped',
        'reason', 'not_a_completed_canonical_bulk_confirmation'
      ));
      CONTINUE;
    END IF;

    IF v_plan.id IS NULL
      OR v_plan.materialized_event_id IS DISTINCT FROM v_event.id
      OR v_event.plan_id IS DISTINCT FROM v_plan.id
      OR v_action.plan_id IS DISTINCT FROM v_plan.id
      OR v_action.approval_id IS DISTINCT FROM v_approval.id
      OR v_approval.plan_id IS DISTINCT FROM v_plan.id
      OR v_approval.agent_action_id IS DISTINCT FROM v_action.id
      OR NOT public.canonical_booking_has_execution_provenance(
        'venue', v_booking.venue_id, v_booking.event_id, v_booking.plan_id,
        v_booking.agent_action_id, v_booking.approval_id, v_booking.organizer_id,
        v_booking.quoted_price_cents, v_booking.approved_terms_snapshot,
        v_booking.status
      )
    THEN
      RAISE EXCEPTION 'ensure_canonical_venue_confirmation_effects_provenance_mismatch'
        USING ERRCODE = '23514', DETAIL = v_booking_id::TEXT;
    END IF;

    SELECT profile.user_id
    INTO v_builder_user_id
    FROM public.builder_profiles AS profile
    WHERE profile.id = v_event.builder_id;

    v_audit_id := NULL;
    INSERT INTO public.venue_booking_approval_audit (
      venue_id, booking_id, actor_id, action, previous_status, new_status,
      message, metadata, canonical_confirmation_booking_id
    ) VALUES (
      v_booking.venue_id, v_booking.id, p_actor_id, 'bulk_approve', 'pending',
      'confirmed', v_message,
      jsonb_build_object(
        'source', 'canonical_venue_bulk_confirmation',
        'plan_id', v_booking.plan_id,
        'event_id', v_booking.event_id,
        'agent_action_id', v_booking.agent_action_id,
        'approval_id', v_booking.approval_id
      ),
      v_booking.id
    )
    ON CONFLICT (canonical_confirmation_booking_id)
      WHERE canonical_confirmation_booking_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_audit_id;
    v_audit_inserted := v_audit_id IS NOT NULL;

    IF v_audit_id IS NULL THEN
      SELECT audit.id INTO v_audit_id
      FROM public.venue_booking_approval_audit AS audit
      WHERE audit.canonical_confirmation_booking_id = v_booking.id;
    END IF;

    v_notification_id := NULL;
    v_notification_inserted := false;
    IF v_builder_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_id, type, notification_type, title, message, link, link_url,
        action_url, related_id, metadata, group_key, is_read,
        canonical_venue_confirmation_booking_id
      ) VALUES (
        v_builder_user_id,
        'booking_confirmed',
        'booking_confirmed',
        'Venue booking confirmed',
        COALESCE(v_message, 'Your booking request for ' || COALESCE(v_event.event_name, 'your event') || ' has been approved.'),
        '/planner/experiences',
        '/planner/experiences',
        '/planner/experiences',
        v_booking.id,
        jsonb_build_object(
          'source', 'canonical_venue_bulk_confirmation',
          'booking_id', v_booking.id,
          'plan_id', v_booking.plan_id,
          'event_id', v_booking.event_id,
          'venue_id', v_booking.venue_id
        ),
        'canonical-venue-confirmation:' || v_booking.id::TEXT,
        false,
        v_booking.id
      )
      ON CONFLICT (canonical_venue_confirmation_booking_id)
        WHERE canonical_venue_confirmation_booking_id IS NOT NULL
      DO NOTHING
      RETURNING id INTO v_notification_id;
      v_notification_inserted := v_notification_id IS NOT NULL;

      IF v_notification_id IS NULL THEN
        SELECT notification.id INTO v_notification_id
        FROM public.notifications AS notification
        WHERE notification.canonical_venue_confirmation_booking_id = v_booking.id;
      END IF;
    END IF;

    v_effected_count := v_effected_count + 1;
    IF NOT v_audit_inserted AND (v_builder_user_id IS NULL OR NOT v_notification_inserted) THEN
      v_existing_count := v_existing_count + 1;
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'booking_id', v_booking.id,
      'effect_status', CASE
        WHEN v_audit_inserted OR v_notification_inserted THEN 'created'
        ELSE 'existing'
      END,
      'notification_id', v_notification_id,
      'approval_audit_id', v_audit_id
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'complete',
    'requested_count', v_requested_count,
    'effected_count', v_effected_count,
    'existing_count', v_existing_count,
    'skipped_count', v_skipped_count,
    'results', v_results
  );
END;
$function$;

COMMENT ON FUNCTION public.ensure_canonical_venue_confirmation_effects(UUID[], UUID, TEXT) IS
  'Creates or reloads exactly one notification and bulk-approval audit receipt per canonical venue bulk confirmation.';

REVOKE ALL ON FUNCTION public.ensure_canonical_venue_confirmation_effects(UUID[], UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_canonical_venue_confirmation_effects(UUID[], UUID, TEXT)
  TO service_role;
