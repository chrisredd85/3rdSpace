-- Prompt 8 hardening: confirm an external checkout and publish its audit and
-- host-visible evidence as one transaction. A completed action is repairable
-- and idempotent, so a prior response failure cannot strand the timeline.

CREATE OR REPLACE FUNCTION public.confirm_external_checkout_handoff(
  p_plan_id UUID,
  p_action_id UUID,
  p_approval_id UUID,
  p_expected_snapshot_hash TEXT,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_action public.agent_actions%ROWTYPE;
  v_approval public.approvals%ROWTYPE;
  v_message public.plan_messages%ROWTYPE;
  v_evidence JSONB;
  v_now TIMESTAMPTZ := transaction_timestamp();
  v_existing BOOLEAN := false;
  v_provider TEXT;
BEGIN
  IF current_user <> 'postgres'
    AND NOT (current_user = 'service_role' AND auth.role() = 'service_role')
  THEN
    RAISE EXCEPTION 'confirm_external_checkout_unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL
    OR NULLIF(btrim(p_expected_snapshot_hash), '') IS NULL
  THEN
    RAISE EXCEPTION 'confirm_external_checkout_invalid_contract' USING ERRCODE = '22023';
  END IF;

  SELECT plan_row.*
  INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND OR v_plan.user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'confirm_external_checkout_plan_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT action_row.*
  INTO v_action
  FROM public.agent_actions AS action_row
  WHERE action_row.id = p_action_id
    AND action_row.plan_id = p_plan_id
    AND action_row.approval_id = p_approval_id
    AND action_row.action_type = 'external_checkout'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_external_checkout_action_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT approval_row.*
  INTO v_approval
  FROM public.approvals AS approval_row
  WHERE approval_row.id = p_approval_id
    AND approval_row.plan_id = p_plan_id
    AND approval_row.agent_action_id = p_action_id
  FOR KEY SHARE;

  IF NOT FOUND
    OR v_approval.status NOT IN ('approved', 'authorized')
    OR COALESCE(v_approval.authorized_by, v_approval.approved_by) IS DISTINCT FROM p_actor_id
    OR v_approval.snapshot_hash IS DISTINCT FROM p_expected_snapshot_hash
  THEN
    RAISE EXCEPTION 'confirm_external_checkout_approval_mismatch' USING ERRCODE = '23514';
  END IF;

  v_evidence := COALESCE(v_action.result_metadata -> 'external_checkout', '{}'::jsonb);

  IF v_action.status = 'complete'
    AND v_evidence ->> 'status' = 'completed'
    AND v_evidence ->> 'approval_id' = v_approval.id::TEXT
    AND v_evidence ->> 'snapshot_hash' = p_expected_snapshot_hash
  THEN
    v_existing := true;
  ELSE
    IF v_action.status <> 'executing'
      OR v_evidence ->> 'status' <> 'ready'
      OR v_evidence ->> 'approval_id' IS DISTINCT FROM v_approval.id::TEXT
      OR v_evidence ->> 'snapshot_hash' IS DISTINCT FROM p_expected_snapshot_hash
    THEN
      RAISE EXCEPTION 'confirm_external_checkout_not_confirmable'
        USING ERRCODE = '23514', DETAIL = v_action.status;
    END IF;

    v_evidence := v_evidence || jsonb_build_object(
      'status', 'completed',
      'completed_at', v_now,
      'confirmed_by', p_actor_id,
      'confirmation_source', 'host',
      'completion_confirmation_required', false
    );

    UPDATE public.agent_actions AS action_row
    SET status = 'complete',
        executed_at = v_now,
        result_metadata = COALESCE(action_row.result_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'execution_mode', 'external_checkout',
            'message', 'Host confirmed the external checkout was completed.',
            'external_checkout', v_evidence
          ),
        updated_at = v_now
    WHERE action_row.id = v_action.id
      AND action_row.status = 'executing'
    RETURNING * INTO v_action;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'confirm_external_checkout_race' USING ERRCODE = '40001';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.agent_action_audit_log AS audit_row
    WHERE audit_row.action_id = v_action.id
      AND audit_row.plan_id = v_plan.id
      AND audit_row.reason = 'external_checkout.host_confirmed'
      AND audit_row.metadata ->> 'approval_id' = v_approval.id::TEXT
  ) THEN
    INSERT INTO public.agent_action_audit_log (
      action_id, plan_id, from_status, to_status, actor_id, actor_role, reason, metadata
    ) VALUES (
      v_action.id,
      v_plan.id,
      'executing',
      'complete',
      p_actor_id,
      'user',
      'external_checkout.host_confirmed',
      jsonb_build_object(
        'approval_id', v_approval.id,
        'snapshot_hash', p_expected_snapshot_hash,
        'confirmation_source', 'host'
      )
    );
  END IF;

  SELECT message_row.*
  INTO v_message
  FROM public.plan_messages AS message_row
  WHERE message_row.plan_id = v_plan.id
    AND message_row.metadata ->> 'state' = 'external_checkout_completed'
    AND message_row.metadata ->> 'agent_action_id' = v_action.id::TEXT
    AND message_row.metadata ->> 'approval_id' = v_approval.id::TEXT
  ORDER BY message_row.created_at
  LIMIT 1;

  IF NOT FOUND THEN
    v_provider := COALESCE(NULLIF(btrim(v_action.provider), ''), 'the external provider');
    INSERT INTO public.plan_messages (plan_id, role, content, message_type, metadata)
    VALUES (
      v_plan.id,
      'agent',
      left('You confirmed the external checkout with ' || v_provider || ' was completed.', 1000),
      'status_update',
      jsonb_build_object(
        'state', 'external_checkout_completed',
        'action_status', 'complete',
        'agent_action_id', v_action.id,
        'approval_id', v_approval.id,
        'action_result', v_action.result_metadata
      )
    )
    RETURNING * INTO v_message;
  END IF;

  RETURN jsonb_build_object(
    'existing', v_existing,
    'action_status', v_action.status,
    'approval_status', v_approval.status,
    'result_metadata', v_action.result_metadata,
    'agent_action', to_jsonb(v_action),
    'plan_message', to_jsonb(v_message)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_external_checkout_handoff(
  UUID, UUID, UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_external_checkout_handoff(
  UUID, UUID, UUID, TEXT, UUID
) TO service_role;
