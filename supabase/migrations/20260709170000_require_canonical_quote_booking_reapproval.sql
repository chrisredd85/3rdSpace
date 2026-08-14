-- Reopen only a canonical quote booking that has not produced any durable
-- operational side effect. This command bridges an expired or stale immutable
-- approval to supersede_approval_version without making generic executing work
-- editable again.

CREATE OR REPLACE FUNCTION public.require_canonical_quote_booking_reapproval(
  p_plan_id UUID,
  p_agent_action_id UUID,
  p_approval_id UUID,
  p_actor_id UUID,
  p_expected_snapshot_hash TEXT,
  p_reason TEXT
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
  v_marker JSONB;
  v_snapshot_stale BOOLEAN := false;
  v_approval_expired BOOLEAN := false;
  v_from_status TEXT;
  v_now TIMESTAMPTZ := transaction_timestamp();
BEGIN
  IF current_user <> 'postgres'
    AND NOT (current_user = 'service_role' AND auth.role() = 'service_role')
  THEN
    RAISE EXCEPTION 'require_canonical_quote_booking_reapproval_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL
    OR p_reason NOT IN ('approval_expired', 'approval_stale')
    OR p_expected_snapshot_hash !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'require_canonical_quote_booking_reapproval_invalid_contract'
      USING ERRCODE = '22023';
  END IF;

  -- Match create_canonical_booking_from_approval lock order so the no-side-
  -- effect decision cannot race event materialization or booking creation.
  SELECT plan_row.*
  INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'require_canonical_quote_booking_reapproval_plan_not_found'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_plan.user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'require_canonical_quote_booking_reapproval_actor_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF v_plan.materialized_event_id IS NOT NULL THEN
    SELECT event_row.*
    INTO v_event
    FROM public.events AS event_row
    WHERE event_row.id = v_plan.materialized_event_id
      AND event_row.plan_id = v_plan.id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'require_canonical_quote_booking_reapproval_event_identity_missing'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT action_row.*
  INTO v_action
  FROM public.agent_actions AS action_row
  WHERE action_row.id = p_agent_action_id
    AND action_row.plan_id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_action.approval_id IS DISTINCT FROM p_approval_id
    OR v_action.action_type IS DISTINCT FROM 'concierge_queue'
    OR v_action.payload_json ->> 'kind' IS DISTINCT FROM 'canonical_quote_booking'
    OR v_action.status NOT IN ('approved', 'executing')
  THEN
    RAISE EXCEPTION 'require_canonical_quote_booking_reapproval_action_not_eligible'
      USING ERRCODE = '23514';
  END IF;

  SELECT approval_row.*
  INTO v_approval
  FROM public.approvals AS approval_row
  WHERE approval_row.id = p_approval_id
    AND approval_row.plan_id = p_plan_id
    AND approval_row.agent_action_id = p_agent_action_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_approval.superseded_at IS NOT NULL
    OR v_approval.superseded_by_approval_id IS NOT NULL
    OR v_approval.status NOT IN ('approved', 'authorized', 'expired', 're_approval_required')
  THEN
    RAISE EXCEPTION 'require_canonical_quote_booking_reapproval_approval_not_current'
      USING ERRCODE = '23514';
  END IF;

  IF v_approval.snapshot_hash IS DISTINCT FROM p_expected_snapshot_hash
    OR v_approval.snapshot_schema_version IS DISTINCT FROM 2
    OR v_approval.snapshot_json ->> 'schema_version' IS DISTINCT FROM '2'
    OR jsonb_typeof(v_approval.snapshot_json -> 'plan') IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_approval.snapshot_json -> 'approval') IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_approval.snapshot_json -> 'action') IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION 'require_canonical_quote_booking_reapproval_snapshot_mismatch'
      USING ERRCODE = '40001';
  END IF;

  IF v_approval.authorized_by IS DISTINCT FROM p_actor_id
    OR v_approval.authorized_at IS NULL
  THEN
    RAISE EXCEPTION 'require_canonical_quote_booking_reapproval_authorization_mismatch'
      USING ERRCODE = '23514';
  END IF;

  -- Accepted canonical quote money is immutable. A different amount or quoted
  -- price must come from a newly captured trusted response, never from the
  -- generic approval-version editor or stale-state recovery command.
  IF v_approval.requested_amount_cents IS DISTINCT FROM v_approval.price_cents
    OR v_approval.requested_amount_cents IS DISTINCT FROM v_approval.authorized_amount_cents
    OR v_approval.requested_amount_cents IS DISTINCT FROM v_action.amount_cents
    OR (v_action.payload_json ->> 'requested_amount_cents')::INTEGER
      IS DISTINCT FROM v_approval.requested_amount_cents
    OR (v_action.payload_json ->> 'price_cents')::INTEGER
      IS DISTINCT FROM v_approval.requested_amount_cents
    OR (v_approval.snapshot_json #>> '{approval,requested_amount_cents}')::INTEGER
      IS DISTINCT FROM v_approval.requested_amount_cents
    OR (v_approval.snapshot_json #>> '{approval,price_cents}')::INTEGER
      IS DISTINCT FROM v_approval.requested_amount_cents
    OR (v_approval.snapshot_json #>> '{action,amount_cents}')::INTEGER
      IS DISTINCT FROM v_approval.requested_amount_cents
    OR v_approval.snapshot_json #> '{action,payload_json,quote_terms}'
      IS DISTINCT FROM v_action.payload_json -> 'quote_terms'
    OR v_approval.snapshot_json #> '{action,payload_json,quoted_price_cents}'
      IS DISTINCT FROM v_action.payload_json -> 'quoted_price_cents'
    OR v_approval.snapshot_json #> '{action,payload_json,quoted_package_cents}'
      IS DISTINCT FROM v_action.payload_json -> 'quoted_package_cents'
    OR v_approval.snapshot_json #> '{action,payload_json,quoted_minimum_cents}'
      IS DISTINCT FROM v_action.payload_json -> 'quoted_minimum_cents'
    OR v_approval.snapshot_json #> '{action,payload_json,quoted_hourly_cents}'
      IS DISTINCT FROM v_action.payload_json -> 'quoted_hourly_cents'
  THEN
    RAISE EXCEPTION 'require_canonical_quote_booking_reapproval_fresh_trusted_quote_required'
      USING ERRCODE = '23514';
  END IF;

  -- Metadata may describe a wait, but never a handoff that should have left a
  -- durable row. A missing row cannot be used to erase started-work evidence.
  IF v_action.last_retry_status = 'in_progress'
    OR v_action.result_metadata ->> 'outbound_message_sent' = 'true'
    OR v_action.result_metadata ? 'handoff_status'
    OR COALESCE(v_action.result_metadata ->> 'canonical_booking_status', '') NOT IN (
      '',
      'waiting_for_event_materialization',
      'resuming_after_event_materialization',
      'requires_concierge',
      'reapproval_required'
    )
  THEN
    RAISE EXCEPTION 'require_canonical_quote_booking_reapproval_started_work_evidence'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.venue_bookings AS booking
    WHERE booking.agent_action_id = v_action.id
       OR booking.approval_id = v_approval.id
  ) OR EXISTS (
    SELECT 1 FROM public.vendor_bookings AS booking
    WHERE booking.agent_action_id = v_action.id
       OR booking.approval_id = v_approval.id
  ) THEN
    RAISE EXCEPTION 'require_canonical_quote_booking_reapproval_booking_exists'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.admin_tasks AS task_row
    WHERE task_row.agent_action_id = v_action.id
       OR task_row.approval_id = v_approval.id
  ) THEN
    RAISE EXCEPTION 'require_canonical_quote_booking_reapproval_admin_task_exists'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.outreach_messages AS message_row
    WHERE message_row.agent_action_id = v_action.id
       OR message_row.approval_id = v_approval.id
  ) OR EXISTS (
    SELECT 1 FROM public.outreach_threads AS thread_row
    WHERE thread_row.source_agent_action_id = v_action.id
  ) THEN
    RAISE EXCEPTION 'require_canonical_quote_booking_reapproval_outreach_exists'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_intents AS payment_row
    WHERE payment_row.approval_id = v_approval.id
  ) OR EXISTS (
    SELECT 1 FROM public.vendor_transactions AS transaction_row
    WHERE transaction_row.approval_id = v_approval.id
  ) OR EXISTS (
    SELECT 1 FROM public.venue_payment_transactions AS transaction_row
    WHERE transaction_row.approval_id = v_approval.id
  ) OR EXISTS (
    SELECT 1 FROM public.platform_fee_transactions AS transaction_row
    WHERE transaction_row.approval_id = v_approval.id
  ) OR EXISTS (
    SELECT 1 FROM public.settlement_charges AS charge_row
    WHERE charge_row.approval_id = v_approval.id
  ) THEN
    RAISE EXCEPTION 'require_canonical_quote_booking_reapproval_financial_side_effect_exists'
      USING ERRCODE = '23514';
  END IF;

  v_snapshot_stale :=
    v_approval.status = 're_approval_required'
    OR v_approval.snapshot_json -> 'plan' IS DISTINCT FROM jsonb_build_object(
      'event_type', v_plan.event_type,
      'guest_count', v_plan.guest_count,
      'budget_cap_cents', v_plan.budget_cap_cents,
      'neighborhood', v_plan.neighborhood,
      'date_window_start', v_plan.date_window_start,
      'date_window_end', v_plan.date_window_end,
      'ticketed', v_plan.ticketed,
      'ticketing_model', v_plan.ticketing_model,
      'food_responsibility', v_plan.food_responsibility,
      'profit_goal_cents', v_plan.profit_goal_cents
    )
    OR v_approval.snapshot_json #>> '{action,action_type}' IS DISTINCT FROM v_action.action_type
    OR v_approval.snapshot_json #>> '{action,target_type}' IS DISTINCT FROM v_action.target_type
    OR v_approval.snapshot_json #>> '{action,target_id}' IS DISTINCT FROM v_action.target_id::TEXT
    OR (v_approval.snapshot_json #>> '{action,amount_cents}')::INTEGER IS DISTINCT FROM v_action.amount_cents
    OR v_approval.snapshot_json #> '{action,payload_json}' IS DISTINCT FROM v_action.payload_json
    OR v_approval.snapshot_json #>> '{approval,action_label}' IS DISTINCT FROM v_approval.action_label
    OR v_approval.snapshot_json #>> '{approval,event_date}' IS DISTINCT FROM v_approval.event_date::TEXT
    OR (v_approval.snapshot_json #>> '{approval,requested_amount_cents}')::INTEGER
      IS DISTINCT FROM v_approval.requested_amount_cents
    OR (v_approval.snapshot_json #>> '{approval,price_cents}')::INTEGER
      IS DISTINCT FROM v_approval.price_cents
    OR (v_approval.snapshot_json #>> '{approval,fees_cents}')::INTEGER
      IS DISTINCT FROM v_approval.fees_cents
    OR v_approval.snapshot_json #>> '{approval,notes}' IS DISTINCT FROM v_approval.notes
    OR v_approval.snapshot_json #>> '{approval,provider}' IS DISTINCT FROM v_approval.provider
    OR v_approval.snapshot_json #>> '{approval,delivery_email}' IS DISTINCT FROM v_approval.delivery_email
    OR v_approval.snapshot_json #>> '{approval,refund_terms}' IS DISTINCT FROM v_approval.refund_terms
    OR v_approval.snapshot_json #>> '{approval,cancellation_terms}' IS DISTINCT FROM v_approval.cancellation_terms
    OR v_approval.snapshot_json #>> '{approval,package_details}' IS DISTINCT FROM v_approval.package_details
    OR v_approval.authorized_amount_cents IS DISTINCT FROM v_approval.requested_amount_cents
    OR v_approval.requested_amount_cents IS DISTINCT FROM v_action.amount_cents
    OR v_approval.price_cents IS DISTINCT FROM v_action.amount_cents;

  IF v_plan.materialized_event_id IS NOT NULL THEN
    v_snapshot_stale := v_snapshot_stale
      OR v_approval.event_date IS DISTINCT FROM v_event.event_date;
  END IF;

  v_approval_expired :=
    v_approval.status = 'expired'
    OR (v_approval.expires_at IS NOT NULL AND v_approval.expires_at <= v_now);

  IF (p_reason = 'approval_expired' AND NOT v_approval_expired)
    OR (p_reason = 'approval_stale' AND NOT v_snapshot_stale)
  THEN
    RAISE EXCEPTION 'require_canonical_quote_booking_reapproval_reason_not_proven'
      USING ERRCODE = '23514';
  END IF;

  v_marker := v_action.result_metadata -> 'canonical_quote_reapproval';
  IF v_approval.status = 're_approval_required'
    AND v_action.status = 'approved'
    AND v_marker ->> 'approval_id' = v_approval.id::TEXT
    AND v_marker ->> 'snapshot_hash' = p_expected_snapshot_hash
    AND v_marker ->> 'reason' = p_reason
  THEN
    RETURN jsonb_build_object(
      'existing', true,
      'disposition', 'reapproval_required',
      'reason', p_reason,
      'plan_id', v_plan.id,
      'approval_id', v_approval.id,
      'action_status', v_action.status,
      'approval_status', v_approval.status,
      'snapshot_hash', v_approval.snapshot_hash,
      'agent_action', to_jsonb(v_action),
      'approval', to_jsonb(v_approval) - 'payment_method_id'
    );
  END IF;

  IF v_marker IS NOT NULL THEN
    RAISE EXCEPTION 'require_canonical_quote_booking_reapproval_idempotency_conflict'
      USING ERRCODE = '40001';
  END IF;

  v_from_status := v_action.status;

  UPDATE public.approvals AS approval_row
  SET status = 're_approval_required',
      updated_at = v_now
  WHERE approval_row.id = v_approval.id
  RETURNING approval_row.* INTO v_approval;

  UPDATE public.agent_actions AS action_row
  SET status = 'approved',
      executed_at = NULL,
      result_metadata = COALESCE(action_row.result_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'canonical_booking_status', 'reapproval_required',
          'outbound_message_sent', false,
          'canonical_quote_reapproval', jsonb_build_object(
            'approval_id', v_approval.id,
            'snapshot_hash', v_approval.snapshot_hash,
            'reason', p_reason,
            'required_at', v_now
          )
        ),
      updated_at = v_now
  WHERE action_row.id = v_action.id
  RETURNING action_row.* INTO v_action;

  UPDATE public.plan_messages AS message_row
  SET metadata = COALESCE(message_row.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'status', 're_approval_required',
      'approval_id', v_approval.id,
      'approval', COALESCE(message_row.metadata -> 'approval', '{}'::jsonb)
        || (to_jsonb(v_approval) - 'payment_method_id')
    )
  WHERE message_row.plan_id = v_plan.id
    AND message_row.message_type = 'approval_request'
    AND (
      message_row.metadata -> 'approval' ->> 'id' = v_approval.id::TEXT
      OR message_row.metadata ->> 'approval_id' = v_approval.id::TEXT
    );

  INSERT INTO public.agent_action_audit_log (
    action_id, plan_id, from_status, to_status, actor_id, actor_role,
    reason, metadata
  ) VALUES (
    v_action.id, v_plan.id, v_from_status, 'approved', p_actor_id, 'user',
    'canonical_quote_booking.reapproval_required',
    jsonb_build_object(
      'approval_id', v_approval.id,
      'snapshot_hash', v_approval.snapshot_hash,
      'reapproval_reason', p_reason,
      'durable_side_effects_found', false
    )
  );

  INSERT INTO public.plan_messages (
    plan_id, role, content, message_type, metadata
  ) VALUES (
    v_plan.id,
    'system',
    CASE p_reason
      WHEN 'approval_expired' THEN
        'The approved booking request expired before execution began. Review and approve a fresh version.'
      ELSE
        'The approved booking request changed before execution began. Review and approve a fresh version.'
    END,
    'status_update',
    jsonb_build_object(
      'kind', 'canonical_quote_booking_reapproval_required',
      'reason', p_reason,
      'agent_action_id', v_action.id,
      'approval_id', v_approval.id,
      'snapshot_hash', v_approval.snapshot_hash,
      'outbound_message_sent', false
    )
  );

  RETURN jsonb_build_object(
    'existing', false,
    'disposition', 'reapproval_required',
    'reason', p_reason,
    'plan_id', v_plan.id,
    'approval_id', v_approval.id,
    'action_status', v_action.status,
    'approval_status', v_approval.status,
    'snapshot_hash', v_approval.snapshot_hash,
    'agent_action', to_jsonb(v_action),
    'approval', to_jsonb(v_approval) - 'payment_method_id'
  );
END;
$function$;

COMMENT ON FUNCTION public.require_canonical_quote_booking_reapproval(
  UUID, UUID, UUID, UUID, TEXT, TEXT
) IS 'Atomically reopens only an expired or stale canonical quote action with no durable side effect.';

REVOKE ALL ON FUNCTION public.require_canonical_quote_booking_reapproval(
  UUID, UUID, UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.require_canonical_quote_booking_reapproval(
  UUID, UUID, UUID, UUID, TEXT, TEXT
) TO service_role;
