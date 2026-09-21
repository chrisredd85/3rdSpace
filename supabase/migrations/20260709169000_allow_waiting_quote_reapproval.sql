-- A canonical quote can be authorized before its exact event exists. The
-- dispatcher records that action as executing while it waits for host
-- materialization. If the immutable approval expires during that wait, the
-- host must be able to create a fresh approval version, but only when no
-- operational side effect has actually started.

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
  v_plan public.plans%ROWTYPE;
  v_previous public.approvals%ROWTYPE;
  v_action public.agent_actions%ROWTYPE;
  v_next public.approvals%ROWTYPE;
  v_identity_plan_id UUID;
  v_identity_action_id UUID;
  v_next_id UUID := gen_random_uuid();
  v_now TIMESTAMPTZ := transaction_timestamp();
  v_is_canonical_reapproval BOOLEAN := false;
  v_can_reset_waiting_quote BOOLEAN := false;
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

  -- Read only immutable relationship identities before taking locks. Every
  -- identity is revalidated after the canonical plan -> action -> approval
  -- lock sequence, so a stale or mismatched caller still fails closed.
  SELECT approval_row.plan_id, approval_row.agent_action_id
  INTO v_identity_plan_id, v_identity_action_id
  FROM public.approvals AS approval_row
  WHERE approval_row.id = p_approval_id;

  IF NOT FOUND
    OR v_identity_plan_id IS DISTINCT FROM p_plan_id
    OR v_identity_action_id IS NULL
  THEN
    RAISE EXCEPTION 'approval_version_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Match canonical reapproval, resume, and booking creation: aggregate root
  -- first, then its action, then the approval leaf.
  SELECT plan_row.*
  INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval_version_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_plan.user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'approval_version_actor_mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT action_row.*
  INTO v_action
  FROM public.agent_actions AS action_row
  WHERE action_row.id = v_identity_action_id
    AND action_row.plan_id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_action.id IS DISTINCT FROM v_identity_action_id
    OR v_action.plan_id IS DISTINCT FROM v_identity_plan_id
  THEN
    RAISE EXCEPTION 'approval_version_action_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT approval_row.*
  INTO v_previous
  FROM public.approvals AS approval_row
  WHERE approval_row.id = p_approval_id
    AND approval_row.plan_id = p_plan_id
    AND approval_row.agent_action_id = v_action.id
  FOR UPDATE;

  IF NOT FOUND
    OR v_previous.plan_id IS DISTINCT FROM v_identity_plan_id
    OR v_previous.agent_action_id IS DISTINCT FROM v_identity_action_id
  THEN
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

  IF v_action.payload_json ->> 'kind' = 'canonical_quote_booking'
    AND (
      (p_snapshot_json #>> '{approval,price_cents}')::INTEGER
        IS DISTINCT FROM p_requested_amount_cents
      OR (p_snapshot_json #>> '{action,amount_cents}')::INTEGER
        IS DISTINCT FROM p_requested_amount_cents
      OR (p_action_payload_json ->> 'price_cents')::INTEGER
        IS DISTINCT FROM p_requested_amount_cents
      OR (p_action_payload_json ->> 'requested_amount_cents')::INTEGER
        IS DISTINCT FROM p_requested_amount_cents
      OR (
        p_action_payload_json ? 'amount_cents'
        AND (p_action_payload_json ->> 'amount_cents')::INTEGER
          IS DISTINCT FROM p_requested_amount_cents
      )
      OR (
        p_action_payload_json ? 'requestedAmountCents'
        AND (p_action_payload_json ->> 'requestedAmountCents')::INTEGER
          IS DISTINCT FROM p_requested_amount_cents
      )
    )
  THEN
    RAISE EXCEPTION 'approval_version_canonical_snapshot_fields_mismatch'
      USING ERRCODE = '22023';
  END IF;

  v_is_canonical_reapproval := COALESCE(
    v_previous.status = 're_approval_required'
    AND v_action.approval_id = v_previous.id
    AND v_action.action_type = 'concierge_queue'
    AND v_action.payload_json ->> 'kind' = 'canonical_quote_booking',
    false
  );

  SELECT COALESCE(
    v_is_canonical_reapproval
    AND v_action.status IN ('approved', 'executing')
    AND v_action.payload_json ->> 'requires_event_materialization' = 'true'
    AND v_action.last_retry_status IS DISTINCT FROM 'in_progress'
    AND v_action.result_metadata ->> 'outbound_message_sent' IS DISTINCT FROM 'true'
    AND NOT COALESCE(v_action.result_metadata ? 'handoff_status', false)
    AND COALESCE(v_action.result_metadata ->> 'canonical_booking_status', '') IN (
      '',
      'waiting_for_event_materialization',
      'resuming_after_event_materialization',
      'requires_concierge',
      'reapproval_required'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.venue_bookings booking
      WHERE booking.agent_action_id = v_action.id
         OR booking.approval_id = v_previous.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.vendor_bookings booking
      WHERE booking.agent_action_id = v_action.id
         OR booking.approval_id = v_previous.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_tasks task
      WHERE task.agent_action_id = v_action.id
         OR task.approval_id = v_previous.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.outreach_messages message
      WHERE message.agent_action_id = v_action.id
         OR message.approval_id = v_previous.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.outreach_threads thread
      WHERE thread.source_agent_action_id = v_action.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_intents payment_row
      WHERE payment_row.approval_id = v_previous.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.vendor_transactions transaction_row
      WHERE transaction_row.approval_id = v_previous.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.venue_payment_transactions transaction_row
      WHERE transaction_row.approval_id = v_previous.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.platform_fee_transactions transaction_row
      WHERE transaction_row.approval_id = v_previous.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.settlement_charges charge_row
      WHERE charge_row.approval_id = v_previous.id
    ),
    false
  )
  INTO v_can_reset_waiting_quote;

  IF v_is_canonical_reapproval AND NOT v_can_reset_waiting_quote THEN
    RAISE EXCEPTION 'approval_version_canonical_quote_side_effect_exists'
      USING ERRCODE = '23514';
  END IF;

  IF v_action.status IN ('executing', 'complete', 'failed', 'cancelled')
    AND NOT v_can_reset_waiting_quote
  THEN
    RAISE EXCEPTION 'approval_version_action_not_editable' USING ERRCODE = '23514';
  END IF;

  IF v_action.payload_json ->> 'kind' = 'canonical_quote_booking'
    AND (
      p_requested_amount_cents IS DISTINCT FROM v_previous.requested_amount_cents
      OR p_requested_amount_cents IS DISTINCT FROM v_previous.price_cents
      OR p_requested_amount_cents IS DISTINCT FROM v_action.amount_cents
      OR p_action_payload_json -> 'quote_terms'
        IS DISTINCT FROM v_action.payload_json -> 'quote_terms'
      OR p_action_payload_json -> 'quoted_price_cents'
        IS DISTINCT FROM v_action.payload_json -> 'quoted_price_cents'
      OR p_action_payload_json -> 'quoted_package_cents'
        IS DISTINCT FROM v_action.payload_json -> 'quoted_package_cents'
      OR p_action_payload_json -> 'quoted_minimum_cents'
        IS DISTINCT FROM v_action.payload_json -> 'quoted_minimum_cents'
      OR p_action_payload_json -> 'quoted_hourly_cents'
        IS DISTINCT FROM v_action.payload_json -> 'quoted_hourly_cents'
    )
  THEN
    RAISE EXCEPTION 'canonical_quote_booking_amount_change_requires_fresh_quote'
      USING ERRCODE = '23514';
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
    p_requested_amount_cents, v_previous.fees_cents, v_previous.refund_terms,
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
      status = CASE
        WHEN status = 'approved' OR v_can_reset_waiting_quote THEN 'pending'
        ELSE status
      END,
      executed_at = NULL,
      result_metadata = CASE
        WHEN v_can_reset_waiting_quote THEN
          COALESCE(result_metadata, '{}'::jsonb) || jsonb_build_object(
            'canonical_booking_status', 'reapproval_pending',
            'approval_id', v_next.id,
            'previous_approval_id', v_previous.id,
            'outbound_message_sent', false
          )
        ELSE result_metadata
      END,
      updated_at = v_now
  WHERE id = v_action.id
    AND plan_id = p_plan_id;

  UPDATE public.approvals
  SET superseded_by_approval_id = v_next.id,
      updated_at = v_now
  WHERE id = v_previous.id;

  UPDATE public.plan_messages message
  SET metadata = message.metadata
    || jsonb_build_object(
      'status', 'pending',
      'approval_id', v_next.id,
      'approval', COALESCE(message.metadata -> 'approval', '{}'::jsonb)
        || (to_jsonb(v_next) - 'payment_method_id')
    )
  WHERE message.plan_id = p_plan_id
    AND message.message_type = 'approval_request'
    AND (
      message.metadata -> 'approval' ->> 'id' = v_previous.id::text
      OR message.metadata ->> 'approval_id' = v_previous.id::text
    );

  INSERT INTO public.agent_action_audit_log (
    action_id, plan_id, from_status, to_status, actor_id, actor_role, reason, metadata
  ) VALUES (
    v_action.id, p_plan_id, v_action.status,
    CASE
      WHEN v_action.status = 'approved' OR v_can_reset_waiting_quote THEN 'pending'
      ELSE v_action.status
    END,
    p_actor_id, 'user', 'approval.version_superseded',
    jsonb_build_object(
      'previous_approval_id', v_previous.id,
      'approval_id', v_next.id,
      'version_number', v_next.version_number,
      'snapshot_hash', p_snapshot_hash,
      'reset_waiting_canonical_quote', v_can_reset_waiting_quote
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
