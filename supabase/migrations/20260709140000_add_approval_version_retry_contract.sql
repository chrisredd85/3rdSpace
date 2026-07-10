-- P0.6: immutable approval versions, retry coordination, and durable outreach dispatch identity.
--
-- This migration follows the server-owned execution control plane. Browser roles
-- retain read access only; every function below is SECURITY INVOKER and executable
-- only by service_role after an authenticated route has proved ownership.

-- ---------------------------------------------------------------------------
-- Approval version lineage and canonical snapshots
-- ---------------------------------------------------------------------------

ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS root_approval_id UUID,
  ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_approval_id UUID,
  ADD COLUMN IF NOT EXISTS superseded_by_approval_id UUID,
  ADD COLUMN IF NOT EXISTS version_created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version_reason TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_json JSONB,
  ADD COLUMN IF NOT EXISTS snapshot_schema_version SMALLINT;

UPDATE public.approvals
SET root_approval_id = id,
    version_number = 1
WHERE root_approval_id IS NULL;

ALTER TABLE public.approvals
  ALTER COLUMN root_approval_id SET NOT NULL;

ALTER TABLE public.approvals
  ADD CONSTRAINT approvals_version_number_positive_check
    CHECK (version_number > 0),
  ADD CONSTRAINT approvals_version_shape_check
    CHECK (
      (version_number = 1 AND root_approval_id = id AND supersedes_approval_id IS NULL)
      OR
      (version_number > 1 AND root_approval_id <> id AND supersedes_approval_id IS NOT NULL)
    ),
  ADD CONSTRAINT approvals_snapshot_schema_check
    CHECK (
      (snapshot_schema_version IS NULL AND snapshot_json IS NULL)
      OR
      (
        snapshot_schema_version = 2
        AND snapshot_json IS NOT NULL
        AND snapshot_json ->> 'schema_version' = '2'
        AND NULLIF(btrim(snapshot_hash), '') IS NOT NULL
      )
    ),
  ADD CONSTRAINT approvals_root_plan_fkey
    FOREIGN KEY (root_approval_id, plan_id)
    REFERENCES public.approvals(id, plan_id)
    ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT approvals_supersedes_plan_fkey
    FOREIGN KEY (supersedes_approval_id, plan_id)
    REFERENCES public.approvals(id, plan_id)
    ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT approvals_superseded_by_plan_fkey
    FOREIGN KEY (superseded_by_approval_id, plan_id)
    REFERENCES public.approvals(id, plan_id)
    ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX approvals_root_version_unique
  ON public.approvals(root_approval_id, version_number);

CREATE UNIQUE INDEX approvals_single_direct_successor
  ON public.approvals(supersedes_approval_id)
  WHERE supersedes_approval_id IS NOT NULL;

CREATE INDEX approvals_current_version_lookup
  ON public.approvals(root_approval_id, version_number DESC);

COMMENT ON COLUMN public.approvals.root_approval_id IS
  'First approval row in this immutable approval-version lineage.';
COMMENT ON COLUMN public.approvals.version_number IS
  'Monotonic version within root_approval_id; edits create a new pending row.';
COMMENT ON COLUMN public.approvals.snapshot_json IS
  'Canonical full approval/action/plan snapshot shown before authorization.';
COMMENT ON COLUMN public.approvals.snapshot_schema_version IS
  'Canonical snapshot schema. Version 2 includes exact cents, date, notes, counterparty, and execution payload.';

CREATE OR REPLACE FUNCTION public.enforce_approval_version_lineage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_previous public.approvals%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.root_approval_id IS NULL THEN
      NEW.root_approval_id := NEW.id;
    END IF;

    IF NEW.version_number = 1 THEN
      IF NEW.root_approval_id IS DISTINCT FROM NEW.id OR NEW.supersedes_approval_id IS NOT NULL THEN
        RAISE EXCEPTION 'approval_initial_version_lineage_invalid'
          USING ERRCODE = '23514', CONSTRAINT = 'approvals_version_shape_check';
      END IF;
      RETURN NEW;
    END IF;

    SELECT approval.*
    INTO v_previous
    FROM public.approvals approval
    WHERE approval.id = NEW.supersedes_approval_id
      AND approval.plan_id = NEW.plan_id
    FOR KEY SHARE;

    IF NOT FOUND
      OR v_previous.agent_action_id IS DISTINCT FROM NEW.agent_action_id
      OR v_previous.root_approval_id IS DISTINCT FROM NEW.root_approval_id
      OR v_previous.version_number + 1 IS DISTINCT FROM NEW.version_number
      OR v_previous.status IS DISTINCT FROM 'superseded'
    THEN
      RAISE EXCEPTION 'approval_successor_lineage_invalid'
        USING ERRCODE = '23514', CONSTRAINT = 'approvals_successor_lineage_check';
    END IF;

    IF NEW.snapshot_schema_version IS DISTINCT FROM 2
      OR NEW.snapshot_json IS NULL
      OR NEW.snapshot_json ->> 'schema_version' IS DISTINCT FROM '2'
      OR NEW.snapshot_hash !~ '^[0-9a-f]{64}$'
    THEN
      RAISE EXCEPTION 'approval_successor_requires_v2_snapshot'
        USING ERRCODE = '23514', CONSTRAINT = 'approvals_successor_snapshot_check';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.root_approval_id IS DISTINCT FROM OLD.root_approval_id
    OR NEW.version_number IS DISTINCT FROM OLD.version_number
    OR NEW.supersedes_approval_id IS DISTINCT FROM OLD.supersedes_approval_id
    OR NEW.snapshot_schema_version IS DISTINCT FROM OLD.snapshot_schema_version
    OR NEW.snapshot_json IS DISTINCT FROM OLD.snapshot_json
    OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
  THEN
    RAISE EXCEPTION 'approval_version_identity_is_immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'approvals_version_immutable_check';
  END IF;

  IF OLD.snapshot_schema_version = 2 AND (
    NEW.action_label IS DISTINCT FROM OLD.action_label
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.event_date IS DISTINCT FROM OLD.event_date
    OR NEW.price_cents IS DISTINCT FROM OLD.price_cents
    OR NEW.fees_cents IS DISTINCT FROM OLD.fees_cents
    OR NEW.refund_terms IS DISTINCT FROM OLD.refund_terms
    OR NEW.cancellation_terms IS DISTINCT FROM OLD.cancellation_terms
    OR NEW.package_details IS DISTINCT FROM OLD.package_details
    OR NEW.delivery_email IS DISTINCT FROM OLD.delivery_email
    OR NEW.requested_amount_cents IS DISTINCT FROM OLD.requested_amount_cents
    OR NEW.notes IS DISTINCT FROM OLD.notes
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
  ) THEN
    RAISE EXCEPTION 'approval_v2_snapshot_fields_are_immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'approvals_v2_snapshot_fields_immutable_check';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_approval_version_lineage()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_approval_version_lineage()
  TO service_role;

CREATE TRIGGER enforce_approval_version_lineage_trigger
  BEFORE INSERT OR UPDATE ON public.approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_approval_version_lineage();

CREATE OR REPLACE FUNCTION public.supersede_approval_version(
  p_plan_id UUID,
  p_approval_id UUID,
  p_expected_snapshot_hash TEXT,
  p_actor_id UUID,
  p_requested_amount_cents INTEGER,
  p_event_date DATE,
  p_notes TEXT,
  p_expires_at TIMESTAMPTZ,
  p_action_payload_json JSONB,
  p_snapshot_json JSONB,
  p_snapshot_hash TEXT,
  p_reason TEXT
)
RETURNS public.approvals
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_previous public.approvals%ROWTYPE;
  v_action public.agent_actions%ROWTYPE;
  v_next public.approvals%ROWTYPE;
  v_next_id UUID := gen_random_uuid();
  v_now TIMESTAMPTZ := transaction_timestamp();
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'approval_version_actor_required' USING ERRCODE = '22023';
  END IF;
  IF p_requested_amount_cents IS NULL OR p_requested_amount_cents < 0 THEN
    RAISE EXCEPTION 'approval_version_amount_invalid' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_expected_snapshot_hash), '') IS NULL THEN
    RAISE EXCEPTION 'approval_version_expected_snapshot_required' USING ERRCODE = '22023';
  END IF;
  IF p_snapshot_hash !~ '^[0-9a-f]{64}$'
    OR p_snapshot_json IS NULL
    OR p_snapshot_json ->> 'schema_version' IS DISTINCT FROM '2'
  THEN
    RAISE EXCEPTION 'approval_version_v2_snapshot_invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_snapshot_json #>> '{approval,requested_amount_cents}')::INTEGER
      IS DISTINCT FROM p_requested_amount_cents
    OR p_snapshot_json #>> '{approval,event_date}'
      IS DISTINCT FROM (CASE WHEN p_event_date IS NULL THEN NULL ELSE p_event_date::TEXT END)
    OR p_snapshot_json #>> '{approval,notes}' IS DISTINCT FROM p_notes
    OR p_snapshot_json #> '{action,payload_json}' IS DISTINCT FROM p_action_payload_json
  THEN
    RAISE EXCEPTION 'approval_version_snapshot_fields_mismatch' USING ERRCODE = '22023';
  END IF;

  SELECT approval.*
  INTO v_previous
  FROM public.approvals approval
  WHERE approval.id = p_approval_id
    AND approval.plan_id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_version_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (
    (v_previous.snapshot_hash IS NULL AND p_expected_snapshot_hash = 'legacy-missing')
    OR v_previous.snapshot_hash = p_expected_snapshot_hash
  ) THEN
    RAISE EXCEPTION 'approval_snapshot_mismatch' USING ERRCODE = '40001';
  END IF;
  IF v_previous.status NOT IN ('pending', 'expired', 're_approval_required') THEN
    RAISE EXCEPTION 'approval_version_source_not_editable' USING ERRCODE = '23514';
  END IF;
  IF v_previous.superseded_at IS NOT NULL OR v_previous.superseded_by_approval_id IS NOT NULL THEN
    RAISE EXCEPTION 'approval_version_source_already_superseded' USING ERRCODE = '23514';
  END IF;

  SELECT action.*
  INTO v_action
  FROM public.agent_actions action
  WHERE action.id = v_previous.agent_action_id
    AND action.plan_id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_version_action_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_action.status IN ('executing', 'complete', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'approval_version_action_not_editable' USING ERRCODE = '23514';
  END IF;

  UPDATE public.approvals
  SET status = 'superseded',
      superseded_at = v_now,
      superseded_reason = p_reason,
      updated_at = v_now
  WHERE id = v_previous.id;

  INSERT INTO public.approvals (
    id, plan_id, agent_action_id, action_label, provider, event_date,
    price_cents, fees_cents, refund_terms, cancellation_terms,
    package_details, delivery_email, payment_method_id, status,
    requested_amount_cents, authorized_amount_cents, authorized_by,
    authorized_at, approved_by, approved_at, expires_at, snapshot_hash,
    approval_type, settlement_run_id, notes, root_approval_id,
    version_number, supersedes_approval_id, version_created_by,
    version_reason, snapshot_json, snapshot_schema_version
  ) VALUES (
    v_next_id, v_previous.plan_id, v_previous.agent_action_id,
    v_previous.action_label, v_previous.provider, p_event_date,
    v_previous.price_cents, v_previous.fees_cents, v_previous.refund_terms,
    v_previous.cancellation_terms, v_previous.package_details,
    v_previous.delivery_email, v_previous.payment_method_id, 'pending',
    p_requested_amount_cents, NULL, NULL, NULL, NULL, NULL, p_expires_at,
    p_snapshot_hash, v_previous.approval_type, v_previous.settlement_run_id,
    p_notes, v_previous.root_approval_id, v_previous.version_number + 1,
    v_previous.id, p_actor_id, p_reason, p_snapshot_json, 2
  )
  RETURNING * INTO v_next;

  UPDATE public.agent_actions
  SET approval_id = v_next.id,
      amount_cents = p_requested_amount_cents,
      payload_json = p_action_payload_json,
      status = CASE WHEN status = 'approved' THEN 'pending' ELSE status END,
      executed_at = NULL,
      updated_at = v_now
  WHERE id = v_action.id
    AND plan_id = p_plan_id;

  UPDATE public.approvals
  SET superseded_by_approval_id = v_next.id,
      updated_at = v_now
  WHERE id = v_previous.id;

  -- Approval cards are a denormalized read cache. Repoint any existing card in
  -- the same transaction so a reload cannot authorize the superseded row.
  UPDATE public.plan_messages message
  SET metadata = message.metadata
    || jsonb_build_object(
      'status', 'pending',
      'approval_id', v_next.id,
      'approval', COALESCE(message.metadata -> 'approval', '{}'::JSONB)
        || (to_jsonb(v_next) - 'payment_method_id')
    )
  WHERE message.plan_id = p_plan_id
    AND message.message_type = 'approval_request'
    AND (
      message.metadata -> 'approval' ->> 'id' = v_previous.id::TEXT
      OR message.metadata ->> 'approval_id' = v_previous.id::TEXT
    );

  INSERT INTO public.agent_action_audit_log (
    action_id, plan_id, from_status, to_status, actor_id, actor_role, reason, metadata
  ) VALUES (
    v_action.id, p_plan_id, v_action.status,
    CASE WHEN v_action.status = 'approved' THEN 'pending' ELSE v_action.status END,
    p_actor_id, 'user', 'approval.version_superseded',
    jsonb_build_object(
      'previous_approval_id', v_previous.id,
      'approval_id', v_next.id,
      'version_number', v_next.version_number,
      'snapshot_hash', p_snapshot_hash
    )
  );

  RETURN v_next;
END;
$function$;

REVOKE ALL ON FUNCTION public.supersede_approval_version(
  UUID, UUID, TEXT, UUID, INTEGER, DATE, TEXT, TIMESTAMPTZ, JSONB, JSONB, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_approval_version(
  UUID, UUID, TEXT, UUID, INTEGER, DATE, TEXT, TIMESTAMPTZ, JSONB, JSONB, TEXT, TEXT
) TO service_role;

-- ---------------------------------------------------------------------------
-- Narrow failed-action retry coordination (Prompt 16 owns attempt history)
-- ---------------------------------------------------------------------------

ALTER TABLE public.agent_actions
  ADD COLUMN IF NOT EXISTS last_retry_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS last_retry_status TEXT,
  ADD COLUMN IF NOT EXISTS last_retry_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_retry_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_retry_result JSONB;

ALTER TABLE public.agent_actions
  ADD CONSTRAINT agent_actions_last_retry_status_check
    CHECK (last_retry_status IS NULL OR last_retry_status IN ('in_progress', 'succeeded', 'failed')),
  ADD CONSTRAINT agent_actions_last_retry_shape_check
    CHECK (
      (last_retry_idempotency_key IS NULL AND last_retry_status IS NULL
        AND last_retry_started_at IS NULL AND last_retry_completed_at IS NULL)
      OR
      (last_retry_idempotency_key IS NOT NULL AND last_retry_status = 'in_progress'
        AND last_retry_started_at IS NOT NULL AND last_retry_completed_at IS NULL)
      OR
      (last_retry_idempotency_key IS NOT NULL AND last_retry_status IN ('succeeded', 'failed')
        AND last_retry_started_at IS NOT NULL AND last_retry_completed_at IS NOT NULL)
    );

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
  FROM public.approvals approval
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
  FROM public.agent_actions action
  WHERE action.id = p_action_id
    AND action.plan_id = p_plan_id
    AND action.approval_id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_retry_action_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (
    v_action.action_type IN ('opportunity_send_venues', 'opportunity_send_vendors')
    OR (
      v_action.action_type = 'email'
      AND v_action.payload_json ->> 'kind' IN (
        'gmail_approved_outreach', 'venue_outreach', 'vendor_outreach'
      )
    )
  ) THEN
    RAISE EXCEPTION 'approval_retry_action_kind_not_retryable' USING ERRCODE = '23514';
  END IF;

  -- A completed action is authoritative provider evidence. Return it even if
  -- the approval expired afterward; a retry must never repeat the side effect.
  IF v_action.status = 'complete' THEN
    RETURN QUERY SELECT 'prior_success'::TEXT, v_action.status, v_action.result_metadata;
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

CREATE OR REPLACE FUNCTION public.finalize_failed_action_retry(
  p_plan_id UUID,
  p_action_id UUID,
  p_idempotency_key TEXT,
  p_outcome TEXT,
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
  v_action_status TEXT;
BEGIN
  IF p_actor_id IS NULL OR NULLIF(btrim(p_idempotency_key), '') IS NULL
    OR p_outcome NOT IN ('succeeded', 'failed')
  THEN
    RAISE EXCEPTION 'approval_retry_finalize_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT action.*
  INTO v_action
  FROM public.agent_actions action
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
  IF v_action.last_retry_status <> 'in_progress' OR v_action.status <> 'executing' THEN
    RAISE EXCEPTION 'approval_retry_not_in_progress' USING ERRCODE = '23514';
  END IF;

  v_action_status := CASE WHEN p_outcome = 'succeeded' THEN 'complete' ELSE 'failed' END;

  UPDATE public.agent_actions AS action_row
  SET status = v_action_status,
      executed_at = CASE WHEN p_outcome = 'succeeded' THEN v_now ELSE action_row.executed_at END,
      result_metadata = COALESCE(action_row.result_metadata, '{}'::JSONB) || COALESCE(p_result, '{}'::JSONB),
      last_retry_status = p_outcome,
      last_retry_completed_at = v_now,
      last_retry_result = COALESCE(p_result, '{}'::JSONB),
      updated_at = v_now
  WHERE action_row.id = v_action.id
  RETURNING action_row.* INTO v_action;

  INSERT INTO public.agent_action_audit_log (
    action_id, plan_id, from_status, to_status, actor_id, actor_role, reason, metadata
  ) VALUES (
    v_action.id, p_plan_id, 'executing', v_action.status, p_actor_id, 'user',
    CASE WHEN p_outcome = 'succeeded' THEN 'approval.retry_succeeded' ELSE 'approval.retry_failed' END,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'outcome', p_outcome)
  );

  RETURN QUERY SELECT p_outcome, v_action.status, v_action.result_metadata;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_failed_action_retry(UUID, UUID, UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_failed_action_retry(UUID, UUID, UUID, TEXT, TEXT, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.finalize_failed_action_retry(UUID, UUID, TEXT, TEXT, JSONB, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_failed_action_retry(UUID, UUID, TEXT, TEXT, JSONB, UUID)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Durable per-recipient outreach dispatch identity
-- ---------------------------------------------------------------------------

ALTER TABLE public.outreach_messages
  ADD COLUMN IF NOT EXISTS dispatch_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS rfc_message_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT,
  ADD COLUMN IF NOT EXISTS send_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_send_error TEXT;

ALTER TABLE public.outreach_messages
  ADD CONSTRAINT outreach_messages_delivery_status_check
    CHECK (
      delivery_status IS NULL
      OR delivery_status IN ('pending', 'sending', 'sent', 'failed', 'ambiguous')
    ),
  ADD CONSTRAINT outreach_messages_dispatch_direction_check
    CHECK (dispatch_idempotency_key IS NULL OR direction = 'outbound');

CREATE UNIQUE INDEX outreach_messages_action_dispatch_unique
  ON public.outreach_messages(agent_action_id, dispatch_idempotency_key)
  WHERE direction = 'outbound'
    AND agent_action_id IS NOT NULL
    AND dispatch_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX outreach_messages_rfc_message_id_unique
  ON public.outreach_messages(rfc_message_id)
  WHERE rfc_message_id IS NOT NULL;

CREATE INDEX outreach_messages_delivery_recovery
  ON public.outreach_messages(delivery_status, send_started_at)
  WHERE direction = 'outbound'
    AND delivery_status IN ('sending', 'failed', 'ambiguous');

COMMENT ON COLUMN public.outreach_messages.dispatch_idempotency_key IS
  'Stable per-action/per-recipient key reserved before calling an outbound provider.';
COMMENT ON COLUMN public.outreach_messages.rfc_message_id IS
  'Deterministic Message-ID used to reconcile an ambiguous Gmail send before retrying.';
COMMENT ON COLUMN public.outreach_messages.delivery_status IS
  'Current provider-dispatch state. Generalized execution attempt history is deferred to Prompt 16.';
