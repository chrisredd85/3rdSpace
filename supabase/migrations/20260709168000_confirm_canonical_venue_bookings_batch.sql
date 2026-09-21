-- Confirm a venue owner's canonical booking selection as one database command.
-- Any invalid booking aborts the function transaction, including confirmations
-- and their action/message/audit side effects completed earlier in the loop.

CREATE OR REPLACE FUNCTION public.confirm_canonical_venue_bookings_batch(
  p_booking_ids UUID[],
  p_actor_id UUID,
  p_confirmation_context JSONB DEFAULT '{}'::jsonb
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
  v_owner_id UUID;
  v_plan_id UUID;
  v_event_id UUID;
  v_action_id UUID;
  v_approval_id UUID;
  v_result JSONB;
  v_results JSONB := '[]'::jsonb;
  v_bookings JSONB := '[]'::jsonb;
  v_existing_count INTEGER := 0;
  v_context JSONB;
BEGIN
  IF current_user <> 'postgres'
    AND NOT (current_user = 'service_role' AND auth.role() = 'service_role')
  THEN
    RAISE EXCEPTION 'confirm_canonical_venue_bookings_batch_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  v_requested_count := COALESCE(cardinality(p_booking_ids), 0);
  IF p_actor_id IS NULL
    OR v_requested_count < 1
    OR v_requested_count > 100
    OR jsonb_typeof(COALESCE(p_confirmation_context, '{}'::jsonb)) IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION 'confirm_canonical_venue_bookings_batch_invalid_contract'
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(DISTINCT booking_id)::INTEGER
  INTO v_distinct_count
  FROM unnest(p_booking_ids) AS requested(booking_id)
  WHERE booking_id IS NOT NULL;

  IF v_distinct_count <> v_requested_count THEN
    RAISE EXCEPTION 'confirm_canonical_venue_bookings_batch_ids_must_be_unique'
      USING ERRCODE = '22023';
  END IF;

  v_context := COALESCE(p_confirmation_context, '{}'::jsonb) || jsonb_build_object(
    'bulk_confirmation', true,
    'batch_size', v_requested_count
  );

  -- Lock complete aggregates in the same deterministic order used by the
  -- single confirmation and decline/cancel commands. Locking all plans before
  -- any action or booking prevents inverse plan-vs-booking waits when a batch
  -- spans multiple plans.
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

  -- Every requested row must still exist after the lock set is established.
  IF (SELECT COUNT(*) FROM public.venue_bookings WHERE id = ANY(p_booking_ids))
    <> v_requested_count
  THEN
    RAISE EXCEPTION 'confirm_canonical_venue_bookings_batch_booking_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  FOR v_booking_id IN
    SELECT requested.booking_id
    FROM unnest(p_booking_ids) AS requested(booking_id)
    ORDER BY requested.booking_id
  LOOP
    SELECT venue.owner_id, booking.plan_id, booking.event_id,
      booking.agent_action_id, booking.approval_id
    INTO v_owner_id, v_plan_id, v_event_id, v_action_id, v_approval_id
    FROM public.venue_bookings AS booking
    JOIN public.venues AS venue ON venue.id = booking.venue_id
    WHERE booking.id = v_booking_id
    ;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'confirm_canonical_venue_bookings_batch_booking_not_found'
        USING ERRCODE = 'P0002', DETAIL = v_booking_id::TEXT;
    END IF;

    IF v_owner_id IS DISTINCT FROM p_actor_id THEN
      RAISE EXCEPTION 'confirm_canonical_venue_bookings_batch_owner_mismatch'
        USING ERRCODE = '42501', DETAIL = v_booking_id::TEXT;
    END IF;

    IF v_plan_id IS NULL OR v_event_id IS NULL
      OR v_action_id IS NULL OR v_approval_id IS NULL
    THEN
      RAISE EXCEPTION 'confirm_canonical_venue_bookings_batch_provenance_incomplete'
        USING ERRCODE = '23514', DETAIL = v_booking_id::TEXT;
    END IF;

    v_result := public.confirm_canonical_booking(
      'venue',
      v_booking_id,
      p_actor_id,
      v_context
    );

    IF jsonb_typeof(v_result) IS DISTINCT FROM 'object'
      OR jsonb_typeof(v_result -> 'existing') IS DISTINCT FROM 'boolean'
      OR v_result ->> 'booking_id' IS DISTINCT FROM v_booking_id::TEXT
      OR v_result ->> 'booking_kind' IS DISTINCT FROM 'venue'
      OR v_result ->> 'booking_status' IS DISTINCT FROM 'confirmed'
      OR v_result ->> 'action_status' IS DISTINCT FROM 'complete'
      OR v_result ->> 'plan_id' IS DISTINCT FROM v_plan_id::TEXT
      OR v_result ->> 'event_id' IS DISTINCT FROM v_event_id::TEXT
    THEN
      RAISE EXCEPTION 'confirm_canonical_venue_bookings_batch_result_invalid'
        USING ERRCODE = '23514', DETAIL = v_booking_id::TEXT;
    END IF;

    v_results := v_results || jsonb_build_array(v_result);
    IF (v_result ->> 'existing')::BOOLEAN THEN
      v_existing_count := v_existing_count + 1;
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(to_jsonb(booking) ORDER BY booking.id), '[]'::jsonb)
  INTO v_bookings
  FROM public.venue_bookings AS booking
  WHERE booking.id = ANY(p_booking_ids);

  RETURN jsonb_build_object(
    'status', 'complete',
    'requested_count', v_requested_count,
    'confirmed_count', v_requested_count,
    'existing_count', v_existing_count,
    'results', v_results,
    'bookings', v_bookings
  );
END;
$function$;

COMMENT ON FUNCTION public.confirm_canonical_venue_bookings_batch(UUID[], UUID, JSONB)
  IS 'Atomically confirms a venue-owner batch of canonical bookings through confirm_canonical_booking.';

REVOKE ALL ON FUNCTION public.confirm_canonical_venue_bookings_batch(UUID[], UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_canonical_venue_bookings_batch(UUID[], UUID, JSONB)
  TO service_role;
