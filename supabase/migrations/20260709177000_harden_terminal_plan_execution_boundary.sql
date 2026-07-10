-- Completed and archived plans are immutable execution aggregates. Negative
-- cleanup may still cancel/fail outstanding work, and exact terminal replays
-- are handled by their dedicated idempotent commands, but generic service-role
-- writes may not create or advance positive execution.

CREATE OR REPLACE FUNCTION public.enforce_agent_action_plan_execution_boundary()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan_status TEXT;
  v_positive_mutation BOOLEAN := TG_OP = 'INSERT';
  v_negative_terminal_transition BOOLEAN := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_negative_terminal_transition :=
      NEW.status IN ('cancelled', 'failed')
      AND OLD.status IN ('pending', 'proposed', 'approved', 'executing')
      AND NEW.status IS DISTINCT FROM OLD.status;
    v_positive_mutation :=
      NEW.plan_id IS DISTINCT FROM OLD.plan_id
      OR NEW.action_type IS DISTINCT FROM OLD.action_type
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.provider IS DISTINCT FROM OLD.provider
      OR NEW.target_type IS DISTINCT FROM OLD.target_type
      OR NEW.target_id IS DISTINCT FROM OLD.target_id
      OR NEW.payload_json IS DISTINCT FROM OLD.payload_json
      OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.approval_id IS DISTINCT FROM OLD.approval_id
      OR (
        NOT v_negative_terminal_transition
        AND (
          NEW.status IS DISTINCT FROM OLD.status
          OR NEW.executed_at IS DISTINCT FROM OLD.executed_at
          OR NEW.result_metadata IS DISTINCT FROM OLD.result_metadata
          OR NEW.last_retry_idempotency_key IS DISTINCT FROM OLD.last_retry_idempotency_key
          OR NEW.last_retry_status IS DISTINCT FROM OLD.last_retry_status
          OR NEW.last_retry_started_at IS DISTINCT FROM OLD.last_retry_started_at
          OR NEW.last_retry_completed_at IS DISTINCT FROM OLD.last_retry_completed_at
          OR NEW.last_retry_result IS DISTINCT FROM OLD.last_retry_result
        )
      );
  END IF;

  IF NOT v_positive_mutation THEN
    RETURN NEW;
  END IF;

  -- Serialize against a concurrent terminal transition. The status read must
  -- be part of the same statement that would create or advance the action.
  SELECT plan_row.status::TEXT
  INTO v_plan_status
  FROM public.plans AS plan_row
  WHERE plan_row.id = NEW.plan_id
  FOR SHARE NOWAIT;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_action_plan_not_found'
      USING ERRCODE = '23503';
  END IF;

  IF v_plan_status IN ('complete', 'completed', 'archived') THEN
    RAISE EXCEPTION 'agent_action_terminal_plan_positive_execution_forbidden'
      USING ERRCODE = '23514',
            CONSTRAINT = 'agent_actions_terminal_plan_positive_execution_check',
            DETAIL = v_plan_status;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_agent_action_plan_execution_boundary()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_agent_action_plan_execution_boundary()
  TO service_role;

DROP TRIGGER IF EXISTS enforce_agent_action_plan_execution_boundary_trigger
  ON public.agent_actions;
CREATE TRIGGER enforce_agent_action_plan_execution_boundary_trigger
  BEFORE INSERT OR UPDATE ON public.agent_actions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_agent_action_plan_execution_boundary();

-- Extend the existing approval invariant trigger so a direct service-role
-- insert/update is as strict as the HTTP route. Pending/reapproval rows are
-- included because they can otherwise manufacture fresh executable work for a
-- terminal plan. Cancel/reject/supersede/expire transitions remain available.
CREATE OR REPLACE FUNCTION public.enforce_approval_execution_invariants()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan_status TEXT;
  v_positive_mutation BOOLEAN := false;
BEGIN
  IF NEW.status IN ('pending', 'approved', 'authorized', 're_approval_required') THEN
    v_positive_mutation := TG_OP = 'INSERT';
    IF TG_OP = 'UPDATE' THEN
      v_positive_mutation :=
        NEW.plan_id IS DISTINCT FROM OLD.plan_id
        OR NEW.agent_action_id IS DISTINCT FROM OLD.agent_action_id
        OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW.action_label IS DISTINCT FROM OLD.action_label
        OR NEW.provider IS DISTINCT FROM OLD.provider
        OR NEW.event_date IS DISTINCT FROM OLD.event_date
        OR NEW.price_cents IS DISTINCT FROM OLD.price_cents
        OR NEW.fees_cents IS DISTINCT FROM OLD.fees_cents
        OR NEW.refund_terms IS DISTINCT FROM OLD.refund_terms
        OR NEW.cancellation_terms IS DISTINCT FROM OLD.cancellation_terms
        OR NEW.package_details IS DISTINCT FROM OLD.package_details
        OR NEW.delivery_email IS DISTINCT FROM OLD.delivery_email
        OR NEW.payment_method_id IS DISTINCT FROM OLD.payment_method_id
        OR NEW.requested_amount_cents IS DISTINCT FROM OLD.requested_amount_cents
        OR NEW.authorized_amount_cents IS DISTINCT FROM OLD.authorized_amount_cents
        OR NEW.authorized_by IS DISTINCT FROM OLD.authorized_by
        OR NEW.authorized_at IS DISTINCT FROM OLD.authorized_at
        OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
        OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
        OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
        OR NEW.snapshot_json IS DISTINCT FROM OLD.snapshot_json
        OR NEW.snapshot_schema_version IS DISTINCT FROM OLD.snapshot_schema_version;
    END IF;
  END IF;

  IF v_positive_mutation THEN
    SELECT plan_row.status::TEXT
    INTO v_plan_status
    FROM public.plans AS plan_row
    WHERE plan_row.id = NEW.plan_id
    FOR SHARE NOWAIT;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'approval_plan_not_found'
        USING ERRCODE = '23503';
    END IF;

    IF v_plan_status IN ('complete', 'completed', 'archived') THEN
      RAISE EXCEPTION 'approval_terminal_plan_positive_execution_forbidden'
        USING ERRCODE = '23514',
              CONSTRAINT = 'approvals_terminal_plan_positive_execution_check',
              DETAIL = v_plan_status;
    END IF;
  END IF;

  IF NEW.status IN ('approved', 'authorized') THEN
    IF NEW.authorized_by IS NULL OR NEW.authorized_at IS NULL THEN
      RAISE EXCEPTION 'approval_executable_requires_actor_and_timestamp'
        USING ERRCODE = '23514',
              CONSTRAINT = 'approvals_executable_actor_timestamp_check';
    END IF;

    IF NULLIF(btrim(NEW.snapshot_hash), '') IS NULL THEN
      RAISE EXCEPTION 'approval_executable_requires_snapshot_hash'
        USING ERRCODE = '23514',
              CONSTRAINT = 'approvals_executable_snapshot_check';
    END IF;

    IF NEW.expires_at IS NOT NULL AND NEW.expires_at <= transaction_timestamp() THEN
      RAISE EXCEPTION 'approval_executable_cannot_be_expired'
        USING ERRCODE = '23514',
              CONSTRAINT = 'approvals_executable_expiry_check';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_approval_execution_invariants()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_approval_execution_invariants()
  TO service_role;

-- Recreate explicitly so schema drift cannot leave an older trigger pointing
-- at a stale function definition in partial environments.
DROP TRIGGER IF EXISTS enforce_approval_execution_invariants_trigger
  ON public.approvals;
CREATE TRIGGER enforce_approval_execution_invariants_trigger
  BEFORE INSERT OR UPDATE ON public.approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_approval_execution_invariants();
