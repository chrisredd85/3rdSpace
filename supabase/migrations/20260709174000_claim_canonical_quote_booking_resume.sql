-- Claim a canonical quote-booking resume and write its transition evidence in
-- one transaction. A failed audit insert rolls the status change back; exact
-- retries return the already-claimed action without adding another audit row.

CREATE OR REPLACE FUNCTION public.claim_canonical_quote_booking_materialization_resume(
  p_plan_id UUID,
  p_agent_action_id UUID,
  p_approval_id UUID,
  p_actor_id UUID,
  p_expected_snapshot_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_action public.agent_actions%ROWTYPE;
  v_approval public.approvals%ROWTYPE;
  v_claim_marker JSONB;
  v_existing_marker JSONB;
  v_existing_audit_count INTEGER;
BEGIN
  IF current_user <> 'postgres'
    AND NOT (current_user = 'service_role' AND auth.role() = 'service_role')
  THEN
    RAISE EXCEPTION 'claim_canonical_quote_booking_resume_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_plan_id IS NULL
    OR p_agent_action_id IS NULL
    OR p_approval_id IS NULL
    OR p_actor_id IS NULL
    OR p_expected_snapshot_hash !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'claim_canonical_quote_booking_resume_invalid_contract'
      USING ERRCODE = '22023';
  END IF;

  SELECT plan_row.*
  INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim_canonical_quote_booking_resume_plan_not_found'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_plan.user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'claim_canonical_quote_booking_resume_actor_mismatch'
      USING ERRCODE = '42501';
  END IF;
  IF v_plan.materialized_event_id IS NULL
    OR v_plan.status::TEXT NOT IN ('executing', 'booked')
  THEN
    RAISE EXCEPTION 'claim_canonical_quote_booking_resume_event_required'
      USING ERRCODE = '23514';
  END IF;

  SELECT event_row.*
  INTO v_event
  FROM public.events AS event_row
  WHERE event_row.id = v_plan.materialized_event_id
    AND event_row.plan_id = v_plan.id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim_canonical_quote_booking_resume_event_identity_missing'
      USING ERRCODE = '23514';
  END IF;

  SELECT action_row.*
  INTO v_action
  FROM public.agent_actions AS action_row
  WHERE action_row.id = p_agent_action_id
    AND action_row.plan_id = p_plan_id
    AND action_row.approval_id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_action.action_type IS DISTINCT FROM 'concierge_queue'
    OR v_action.payload_json ->> 'kind' IS DISTINCT FROM 'canonical_quote_booking'
  THEN
    RAISE EXCEPTION 'claim_canonical_quote_booking_resume_action_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT approval_row.*
  INTO v_approval
  FROM public.approvals AS approval_row
  WHERE approval_row.id = p_approval_id
    AND approval_row.plan_id = p_plan_id
    AND approval_row.agent_action_id = p_agent_action_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_approval.snapshot_hash IS DISTINCT FROM p_expected_snapshot_hash
    OR v_approval.snapshot_schema_version IS DISTINCT FROM 2
    OR v_approval.snapshot_json ->> 'schema_version' IS DISTINCT FROM '2'
    OR v_approval.authorized_by IS DISTINCT FROM p_actor_id
    OR v_approval.authorized_at IS NULL
    OR v_approval.superseded_at IS NOT NULL
    OR v_approval.superseded_by_approval_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'claim_canonical_quote_booking_resume_approval_mismatch'
      USING ERRCODE = '23514';
  END IF;

  v_claim_marker := jsonb_build_object(
    'plan_id', v_plan.id,
    'event_id', v_event.id,
    'agent_action_id', v_action.id,
    'approval_id', v_approval.id,
    'approval_snapshot_hash', v_approval.snapshot_hash,
    'outbound_message_sent', false
  );
  v_existing_marker := v_action.result_metadata -> 'materialization_resume_claim';

  IF v_action.status = 'approved' THEN
    IF v_approval.status NOT IN ('approved', 'authorized')
      OR (v_approval.expires_at IS NOT NULL AND v_approval.expires_at <= transaction_timestamp())
    THEN
      RAISE EXCEPTION 'claim_canonical_quote_booking_resume_requires_executable_approval'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.agent_actions AS action_row
    SET status = 'executing',
        result_metadata = COALESCE(action_row.result_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'canonical_booking_status', 'resuming_after_event_materialization',
            'materialization_resume_claim', v_claim_marker,
            'outbound_message_sent', false
          )
    WHERE action_row.id = v_action.id
      AND action_row.plan_id = v_plan.id
      AND action_row.status = 'approved'
    RETURNING action_row.* INTO v_action;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'claim_canonical_quote_booking_resume_status_conflict'
        USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.agent_action_audit_log (
      action_id, plan_id, from_status, to_status, actor_id, actor_role, reason, metadata
    ) VALUES (
      v_action.id, v_plan.id, 'approved', 'executing', p_actor_id, 'user',
      'canonical_quote_booking.materialization_resume', v_claim_marker
    );

    RETURN jsonb_build_object(
      'existing', false,
      'transitioned', true,
      'agent_action', to_jsonb(v_action)
    );
  END IF;

  -- A separate executor may have started work or reached an immutable terminal
  -- state after the caller loaded `approved` but before this lock. Preserve
  -- that truth even when this resume command never owned the transition; the
  -- downstream booking command is independently idempotent.
  IF v_action.status IN ('executing', 'complete', 'cancelled', 'failed')
    AND v_existing_marker IS NULL
  THEN
    RETURN jsonb_build_object(
      'existing', true,
      'transitioned', false,
      'concurrent_execution', true,
      'agent_action', to_jsonb(v_action)
    );
  END IF;

  IF v_action.status IN ('executing', 'complete', 'cancelled', 'failed') THEN
    SELECT COUNT(*)::INTEGER
    INTO v_existing_audit_count
    FROM public.agent_action_audit_log AS audit_row
    WHERE audit_row.action_id = v_action.id
      AND audit_row.plan_id = v_plan.id
      AND audit_row.from_status = 'approved'
      AND audit_row.to_status = 'executing'
      AND audit_row.reason = 'canonical_quote_booking.materialization_resume'
      AND audit_row.metadata = v_claim_marker;

    IF v_existing_marker IS DISTINCT FROM v_claim_marker
      OR v_existing_audit_count IS DISTINCT FROM 1
    THEN
      RAISE EXCEPTION 'claim_canonical_quote_booking_resume_existing_evidence_mismatch'
        USING ERRCODE = '23514';
    END IF;

    RETURN jsonb_build_object(
      'existing', true,
      'transitioned', false,
      'agent_action', to_jsonb(v_action)
    );
  END IF;

  RAISE EXCEPTION 'claim_canonical_quote_booking_resume_action_not_claimable'
    USING ERRCODE = '23514', DETAIL = v_action.status;
END;
$function$;

COMMENT ON FUNCTION public.claim_canonical_quote_booking_materialization_resume(
  UUID, UUID, UUID, UUID, TEXT
) IS
  'Service-only atomic approved-to-executing claim and deterministic audit for canonical quote-booking materialization resume.';

REVOKE ALL ON FUNCTION public.claim_canonical_quote_booking_materialization_resume(
  UUID, UUID, UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_canonical_quote_booking_materialization_resume(
  UUID, UUID, UUID, UUID, TEXT
) TO service_role;
