-- Prompt 8: extend Prompt 6's failed-action retry contract to durable
-- execution handoffs. A recovered handoff may correctly remain `executing`;
-- only a completed draft/send is finalized as `complete`.

CREATE OR REPLACE FUNCTION public.claim_failed_action_retry(
  p_plan_id UUID,
  p_action_id UUID,
  p_approval_id UUID,
  p_expected_snapshot_hash TEXT,
  p_idempotency_key TEXT,
  p_actor_id UUID
)
RETURNS TABLE(outcome TEXT, action_status TEXT, result_metadata JSONB)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_action public.agent_actions%ROWTYPE;
  v_approval public.approvals%ROWTYPE;
  v_now TIMESTAMPTZ := transaction_timestamp();
BEGIN
  IF p_actor_id IS NULL OR NULLIF(btrim(p_idempotency_key), '') IS NULL
    OR length(p_idempotency_key) > 200
  THEN
    RAISE EXCEPTION 'approval_retry_identity_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT approval.*
  INTO v_approval
  FROM public.approvals AS approval
  WHERE approval.id = p_approval_id
    AND approval.plan_id = p_plan_id
    AND approval.agent_action_id = p_action_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_retry_approval_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_approval.snapshot_hash IS DISTINCT FROM p_expected_snapshot_hash THEN
    RAISE EXCEPTION 'approval_snapshot_mismatch' USING ERRCODE = '40001';
  END IF;

  SELECT action.*
  INTO v_action
  FROM public.agent_actions AS action
  WHERE action.id = p_action_id
    AND action.plan_id = p_plan_id
    AND action.approval_id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_retry_action_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    v_action.action_type IN (
      'external_checkout',
      'hold_request',
      'vendor_contact',
      'concierge_queue'
    )
    OR (
      v_action.action_type = 'email'
      AND v_action.payload_json ->> 'kind' = 'gmail_approved_outreach'
    )
  )
  OR (
    v_action.action_type = 'vendor_contact'
    AND v_action.payload_json ->> 'kind' = 'vendor_reply_capture'
  )
  THEN
    RAISE EXCEPTION 'approval_retry_action_kind_not_retryable' USING ERRCODE = '23514';
  END IF;

  IF v_action.status = 'complete' THEN
    RETURN QUERY SELECT 'prior_success'::TEXT, v_action.status, v_action.result_metadata;
    RETURN;
  END IF;

  -- A handoff retry may succeed while the action correctly remains executing.
  -- Return that durable receipt even if its approval expires before a transport
  -- replay; never turn an already-completed retry key into a new failure.
  IF v_action.last_retry_idempotency_key = p_idempotency_key
    AND v_action.last_retry_status = 'succeeded'
  THEN
    RETURN QUERY SELECT
      'prior_success'::TEXT,
      v_action.status,
      COALESCE(v_action.result_metadata, v_action.last_retry_result);
    RETURN;
  END IF;

  IF v_approval.status NOT IN ('approved', 'authorized')
    OR (v_approval.expires_at IS NOT NULL AND v_approval.expires_at <= v_now)
  THEN
    RAISE EXCEPTION 'approval_retry_approval_not_executable' USING ERRCODE = '23514';
  END IF;

  IF v_action.last_retry_idempotency_key = p_idempotency_key THEN
    IF v_action.last_retry_status = 'in_progress'
      AND v_action.last_retry_started_at <= v_now - INTERVAL '60 seconds'
    THEN
      UPDATE public.agent_actions
      SET last_retry_started_at = v_now,
          updated_at = v_now
      WHERE id = v_action.id
      RETURNING * INTO v_action;

      INSERT INTO public.agent_action_audit_log (
        action_id, plan_id, from_status, to_status, actor_id, actor_role, reason, metadata
      ) VALUES (
        v_action.id, p_plan_id, 'executing', 'executing', p_actor_id, 'user',
        'approval.retry_reclaimed', jsonb_build_object('idempotency_key', p_idempotency_key)
      );

      RETURN QUERY SELECT 'claimed'::TEXT, v_action.status, v_action.result_metadata;
      RETURN;
    END IF;

    RETURN QUERY SELECT
      CASE v_action.last_retry_status
        WHEN 'in_progress' THEN 'in_progress'
        WHEN 'succeeded' THEN 'prior_success'
        ELSE 'prior_failure'
      END::TEXT,
      v_action.status,
      COALESCE(v_action.last_retry_result, v_action.result_metadata);
    RETURN;
  END IF;

  IF v_action.status <> 'failed' THEN
    RAISE EXCEPTION 'approval_retry_action_not_failed' USING ERRCODE = '23514';
  END IF;

  UPDATE public.agent_actions
  SET status = 'executing',
      last_retry_idempotency_key = p_idempotency_key,
      last_retry_status = 'in_progress',
      last_retry_started_at = v_now,
      last_retry_completed_at = NULL,
      last_retry_result = NULL,
      updated_at = v_now
  WHERE id = v_action.id
  RETURNING * INTO v_action;

  INSERT INTO public.agent_action_audit_log (
    action_id, plan_id, from_status, to_status, actor_id, actor_role, reason, metadata
  ) VALUES (
    v_action.id, p_plan_id, 'failed', 'executing', p_actor_id, 'user',
    'approval.retry_claimed', jsonb_build_object('idempotency_key', p_idempotency_key)
  );

  RETURN QUERY SELECT 'claimed'::TEXT, v_action.status, v_action.result_metadata;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_failed_action_retry(UUID, UUID, UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_failed_action_retry(UUID, UUID, UUID, TEXT, TEXT, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_approved_action_handoff_retry(
  p_plan_id UUID,
  p_action_id UUID,
  p_idempotency_key TEXT,
  p_outcome TEXT,
  p_success_action_status TEXT,
  p_result JSONB,
  p_actor_id UUID
)
RETURNS TABLE(outcome TEXT, action_status TEXT, result_metadata JSONB)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_action public.agent_actions%ROWTYPE;
  v_now TIMESTAMPTZ := transaction_timestamp();
  v_target_status TEXT;
  v_from_status TEXT;
BEGIN
  IF p_actor_id IS NULL
    OR NULLIF(btrim(p_idempotency_key), '') IS NULL
    OR p_outcome NOT IN ('succeeded', 'failed')
    OR p_success_action_status NOT IN ('executing', 'complete')
    OR jsonb_typeof(COALESCE(p_result, '{}'::jsonb)) IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION 'approval_handoff_retry_finalize_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT action.*
  INTO v_action
  FROM public.agent_actions AS action
  WHERE action.id = p_action_id
    AND action.plan_id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_retry_action_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_action.last_retry_idempotency_key IS DISTINCT FROM p_idempotency_key THEN
    RAISE EXCEPTION 'approval_retry_idempotency_conflict' USING ERRCODE = '40001';
  END IF;

  IF v_action.last_retry_status = p_outcome THEN
    RETURN QUERY SELECT
      CASE WHEN p_outcome = 'succeeded' THEN 'prior_success' ELSE 'prior_failure' END::TEXT,
      v_action.status,
      COALESCE(v_action.last_retry_result, v_action.result_metadata);
    RETURN;
  END IF;

  IF v_action.last_retry_status <> 'in_progress'
    OR (
      p_outcome = 'failed' AND v_action.status <> 'executing'
    )
    OR (
      p_outcome = 'succeeded' AND v_action.status NOT IN ('executing', 'complete')
    )
  THEN
    RAISE EXCEPTION 'approval_retry_not_in_progress' USING ERRCODE = '23514';
  END IF;

  v_from_status := v_action.status;
  v_target_status := CASE
    WHEN p_outcome = 'failed' THEN 'failed'
    WHEN v_action.status = 'complete' THEN 'complete'
    ELSE p_success_action_status
  END;

  UPDATE public.agent_actions AS action_row
  SET status = v_target_status,
      executed_at = CASE
        WHEN v_target_status = 'complete' THEN COALESCE(action_row.executed_at, v_now)
        ELSE action_row.executed_at
      END,
      result_metadata = COALESCE(action_row.result_metadata, '{}'::jsonb)
        || COALESCE(p_result, '{}'::jsonb),
      last_retry_status = p_outcome,
      last_retry_completed_at = v_now,
      last_retry_result = COALESCE(p_result, '{}'::jsonb),
      updated_at = v_now
  WHERE action_row.id = v_action.id
  RETURNING action_row.* INTO v_action;

  INSERT INTO public.agent_action_audit_log (
    action_id, plan_id, from_status, to_status, actor_id, actor_role, reason, metadata
  ) VALUES (
    v_action.id,
    p_plan_id,
    v_from_status,
    v_action.status,
    p_actor_id,
    'user',
    CASE
      WHEN p_outcome = 'succeeded' THEN 'approval.handoff_retry_succeeded'
      ELSE 'approval.handoff_retry_failed'
    END,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'outcome', p_outcome,
      'success_action_status', p_success_action_status
    )
  );

  RETURN QUERY SELECT p_outcome, v_action.status, v_action.result_metadata;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_approved_action_handoff_retry(
  UUID, UUID, TEXT, TEXT, TEXT, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_approved_action_handoff_retry(
  UUID, UUID, TEXT, TEXT, TEXT, JSONB, UUID
) TO service_role;
