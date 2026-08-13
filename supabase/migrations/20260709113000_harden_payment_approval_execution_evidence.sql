-- Fail closed before reserving a Stripe capture unless the approval retains
-- the actor, timestamp, snapshot, and expiry evidence required at execution.
--
-- This is intentionally a focused replacement of the function introduced by
-- 20260709090000. Keep its signature and plans -> approvals -> agent_actions ->
-- payment_intents lock order stable so concurrent capture behavior is unchanged.

CREATE OR REPLACE FUNCTION public.reserve_planner_deposit_capture(
  p_payment_intent_id uuid,
  p_plan_id uuid,
  p_approval_id uuid,
  p_expected_snapshot_hash text,
  p_expected_amount_cents integer,
  p_expected_partner_kind text,
  p_expected_partner_id uuid,
  p_capture_attempt_id uuid
) RETURNS SETOF public.payment_intents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approval public.approvals%ROWTYPE;
  v_action public.agent_actions%ROWTYPE;
  v_payment public.payment_intents%ROWTYPE;
  v_approved_amount_cents integer;
BEGIN
  IF p_capture_attempt_id IS NULL
    OR NULLIF(btrim(p_expected_snapshot_hash), '') IS NULL
    OR p_expected_amount_cents IS NULL
    OR p_expected_amount_cents < 0
    OR p_expected_partner_kind NOT IN ('venue', 'vendor') THEN
    RETURN;
  END IF;

  -- Shared first lock with apply_plan_revision_atomic.
  PERFORM 1
  FROM public.plans
  WHERE id = p_plan_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_approval
  FROM public.approvals
  WHERE id = p_approval_id
    AND plan_id = p_plan_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_approved_amount_cents := COALESCE(
    v_approval.authorized_amount_cents,
    v_approval.requested_amount_cents,
    v_approval.price_cents,
    0
  );
  IF v_approval.status NOT IN ('approved', 'authorized')
    OR v_approval.authorized_by IS NULL
    OR v_approval.authorized_at IS NULL
    OR NULLIF(btrim(v_approval.snapshot_hash), '') IS NULL
    OR v_approval.superseded_at IS NOT NULL
    OR (v_approval.expires_at IS NOT NULL AND v_approval.expires_at <= now())
    OR v_approval.snapshot_hash IS DISTINCT FROM p_expected_snapshot_hash
    OR v_approved_amount_cents <> p_expected_amount_cents THEN
    RETURN;
  END IF;

  SELECT * INTO v_action
  FROM public.agent_actions
  WHERE id = v_approval.agent_action_id
    AND plan_id = p_plan_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_action.action_type <> 'payment'
    OR v_action.status NOT IN ('approved', 'executing')
    OR v_action.approval_id IS DISTINCT FROM p_approval_id
    OR v_action.target_type IS DISTINCT FROM p_expected_partner_kind
    OR v_action.target_id IS DISTINCT FROM p_expected_partner_id
    OR v_action.amount_cents IS DISTINCT FROM p_expected_amount_cents THEN
    RETURN;
  END IF;

  SELECT * INTO v_payment
  FROM public.payment_intents
  WHERE id = p_payment_intent_id
    AND plan_id = p_plan_id
    AND approval_id = p_approval_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_payment.status NOT IN ('requested', 'authorized')
    OR v_payment.stripe_payment_intent_id IS NULL
    OR v_payment.amount_cents <> p_expected_amount_cents
    OR v_payment.partner_kind <> p_expected_partner_kind
    OR v_payment.partner_id <> p_expected_partner_id
    OR v_payment.platform_fee_cents <> COALESCE(v_approval.fees_cents, 0) THEN
    RETURN;
  END IF;

  UPDATE public.payment_intents
  SET
    status = 'capturing',
    failure_reason = NULL,
    capture_attempt_id = p_capture_attempt_id,
    capture_started_at = now(),
    capture_effects_started_at = NULL,
    capture_effects_completed_at = NULL
  WHERE id = v_payment.id
    AND status = v_payment.status
  RETURNING * INTO v_payment;

  IF NOT FOUND THEN RETURN; END IF;
  RETURN NEXT v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_planner_deposit_capture(
  uuid, uuid, uuid, text, integer, text, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_planner_deposit_capture(
  uuid, uuid, uuid, text, integer, text, uuid, uuid
) TO service_role;

COMMENT ON FUNCTION public.reserve_planner_deposit_capture(
  uuid, uuid, uuid, text, integer, text, uuid, uuid
) IS
  'Atomically revalidates approval actor, timestamp, snapshot, expiry, action, and payment evidence before reserving one explicit Stripe capture attempt.';
