-- Migration: Add planner deposit capture reservation state
-- Created: 2026-07-09
-- Context: Prevent duplicate Stripe capture attempts from concurrent capture
-- requests on the same approval-backed planner deposit.

-- Fail before changing the schema when hosted rows cannot satisfy the stricter
-- money invariant or the widened one-payment-per-approval guard. These messages
-- are intentionally actionable for the coordinated hosted preflight.
DO $$
DECLARE
  v_invalid_fee_count integer;
  v_duplicate_approval_count integer;
  v_zero_terminal_amount_count integer;
BEGIN
  SELECT COUNT(*)
    INTO v_invalid_fee_count
  FROM public.payment_intents
  WHERE platform_fee_cents < 0
    OR platform_fee_cents > amount_cents;

  IF v_invalid_fee_count > 0 THEN
    RAISE EXCEPTION
      'payment capture safety preflight failed: % payment_intents have platform_fee_cents outside 0..amount_cents',
      v_invalid_fee_count;
  END IF;

  -- The original table accepted zero-cent planner payments, while the shipped
  -- API now requires at least 50 cents. A zero-cent captured/refunded row cannot
  -- satisfy the cumulative-refund state invariant below, so fail before any DDL
  -- with an explicit repair count instead of surfacing an opaque CHECK failure.
  SELECT COUNT(*)
    INTO v_zero_terminal_amount_count
  FROM public.payment_intents
  WHERE amount_cents = 0
    AND status IN ('captured', 'refunded');

  IF v_zero_terminal_amount_count > 0 THEN
    RAISE EXCEPTION
      'payment capture safety preflight failed: % captured/refunded payment_intents have zero amount_cents and require repair',
      v_zero_terminal_amount_count;
  END IF;

  SELECT COUNT(*)
    INTO v_duplicate_approval_count
  FROM (
    SELECT approval_id
    FROM public.payment_intents
    WHERE status IN (
      'pending',
      'requested',
      'authorized',
      'capturing',
      'captured',
      'refunded',
      'refund_reconciliation_required',
      'blocked_by_account_state'
    )
    GROUP BY approval_id
    HAVING COUNT(*) > 1
  ) duplicates;

  IF v_duplicate_approval_count > 0 THEN
    RAISE EXCEPTION
      'payment capture safety preflight failed: % approval(s) have multiple active/refunded payment_intents',
      v_duplicate_approval_count;
  END IF;
END $$;

ALTER TABLE public.payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_status_check;

ALTER TABLE public.payment_intents
  ADD CONSTRAINT payment_intents_status_check
    CHECK (status IN (
      'pending',
      'requested',
      'authorized',
      'capturing',
      'captured',
      'refunded',
      'refund_reconciliation_required',
      'failed',
      'blocked_by_account_state'
    ));

ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS capture_attempt_id UUID,
  ADD COLUMN IF NOT EXISTS capture_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capture_effects_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capture_effects_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_payment_method_id TEXT,
  ADD COLUMN IF NOT EXISTS refunded_amount_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_refund_event_id TEXT,
  ADD COLUMN IF NOT EXISTS account_state_blocked_previous_status TEXT,
  ADD COLUMN IF NOT EXISTS account_state_blocked_stripe_account_id TEXT;

-- The pre-migration application stored every charge.refunded event as the same
-- `refunded` status and did not persist Stripe's cumulative refund amount. That
-- history cannot safely be backfilled as a full refund because some charges may
-- only have been partially refunded. Preserve it as durable unknown work until
-- the reconciler retrieves the exact Stripe charge snapshot.
UPDATE public.payment_intents
SET
  status = 'refund_reconciliation_required',
  refund_updated_at = COALESCE(refund_updated_at, updated_at)
WHERE status = 'refunded';

ALTER TABLE public.payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_platform_fee_cents_check,
  DROP CONSTRAINT IF EXISTS payment_intents_refunded_amount_cents_check,
  DROP CONSTRAINT IF EXISTS payment_intents_refund_status_check,
  ADD CONSTRAINT payment_intents_platform_fee_cents_check
    CHECK (platform_fee_cents >= 0 AND platform_fee_cents <= amount_cents),
  ADD CONSTRAINT payment_intents_refunded_amount_cents_check
    CHECK (refunded_amount_cents >= 0 AND refunded_amount_cents <= amount_cents),
  ADD CONSTRAINT payment_intents_refund_status_check
    CHECK (
      (status = 'refunded' AND refunded_amount_cents = amount_cents)
      OR (
        status = 'captured'
        AND refunded_amount_cents >= 0
        AND refunded_amount_cents < amount_cents
      )
      OR (
        status = 'refund_reconciliation_required'
        AND refunded_amount_cents >= 0
        AND refunded_amount_cents < amount_cents
      )
      OR (
        status NOT IN ('captured', 'refunded', 'refund_reconciliation_required')
        AND refunded_amount_cents = 0
      )
    );

-- Schema-first compatibility for the deployed helper, which performs only
-- UPDATE payment_intents SET status = 'refunded' and ignores Supabase errors.
-- Convert that legacy write into durable reconciliation work instead of either
-- acknowledging a lost constraint failure or falsely declaring a partial refund
-- to be full. The new atomic RPC writes refunded_amount_cents in the same update,
-- so an exact full-refund transition is not intercepted.
CREATE OR REPLACE FUNCTION public.preserve_unknown_planner_refund_truth()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'refunded'
    AND OLD.status <> 'refunded'
    AND NEW.refunded_amount_cents IS NOT DISTINCT FROM OLD.refunded_amount_cents
  THEN
    NEW.status := 'refund_reconciliation_required';
    NEW.refund_updated_at := COALESCE(OLD.refund_updated_at, now());
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.preserve_unknown_planner_refund_truth()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS preserve_unknown_planner_refund_truth
  ON public.payment_intents;
CREATE TRIGGER preserve_unknown_planner_refund_truth
  BEFORE UPDATE OF status ON public.payment_intents
  FOR EACH ROW
  EXECUTE FUNCTION public.preserve_unknown_planner_refund_truth();

ALTER TABLE public.payouts
  DROP CONSTRAINT IF EXISTS payouts_status_check;

ALTER TABLE public.payouts
  ADD CONSTRAINT payouts_status_check
    CHECK (status IN (
      'pending',
      'queued',
      'paid',
      'failed',
      'cancelled',
      'reversal_required'
    ));

ALTER TABLE public.admin_tasks
  DROP CONSTRAINT IF EXISTS admin_tasks_task_type_check,
  DROP CONSTRAINT IF EXISTS admin_tasks_type_check;

ALTER TABLE public.admin_tasks
  ADD CONSTRAINT admin_tasks_task_type_check
    CHECK (task_type IN (
      'concierge_booking',
      'receipt_upload',
      'vendor_confirm',
      'coi_collect',
      'catalog_gap',
      'payment_refund_reversal'
    ));

DROP INDEX IF EXISTS admin_tasks_one_payment_refund_reversal;

CREATE UNIQUE INDEX admin_tasks_one_payment_refund_reversal
  ON public.admin_tasks ((metadata->>'payment_intent_id'))
  WHERE task_type = 'payment_refund_reversal';

COMMENT ON INDEX public.admin_tasks_one_payment_refund_reversal IS
  'One durable refund-reversal work item per planner payment. Later cumulative refunds update and, when necessary, reopen the same task rather than creating duplicate reversal work.';

-- Keep one durable operator work item whose target advances with Stripe's
-- cumulative refund truth. Replays at the same or an older cumulative amount
-- are no-ops, including after an operator completes the task; a larger refund
-- updates and reopens that same row.
CREATE OR REPLACE FUNCTION public.sync_planner_refund_reversal_task(
  p_plan_id uuid,
  p_payment_intent_id uuid,
  p_payout_id uuid,
  p_stripe_payout_id text,
  p_target_payout_amount_cents integer,
  p_refunded_amount_cents integer,
  p_event_id text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task public.admin_tasks%ROWTYPE;
  v_recorded_refund integer;
  v_metadata jsonb;
BEGIN
  IF p_refunded_amount_cents <= 0 THEN
    RETURN false;
  END IF;

  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'payment_intent_id', p_payment_intent_id,
    'payout_id', p_payout_id,
    'stripe_payout_id', p_stripe_payout_id,
    'target_payout_amount_cents', p_target_payout_amount_cents,
    'refunded_amount_cents', p_refunded_amount_cents,
    'stripe_event_id', p_event_id
  ));

  SELECT * INTO v_task
  FROM public.admin_tasks
  WHERE task_type = 'payment_refund_reversal'
    AND metadata->>'payment_intent_id' = p_payment_intent_id::text
  FOR UPDATE;

  IF FOUND THEN
    v_recorded_refund := CASE
      WHEN jsonb_typeof(v_task.metadata->'refunded_amount_cents') = 'number'
        THEN (v_task.metadata->>'refunded_amount_cents')::integer
      ELSE -1
    END;

    IF p_refunded_amount_cents <= v_recorded_refund THEN
      RETURN false;
    END IF;

    UPDATE public.admin_tasks
    SET
      status = CASE
        WHEN status IN ('complete', 'cancelled') THEN 'open'
        ELSE status
      END,
      completed_at = CASE
        WHEN status IN ('complete', 'cancelled') THEN NULL
        ELSE completed_at
      END,
      priority = 'urgent',
      metadata = metadata || v_metadata,
      updated_at = now()
    WHERE id = v_task.id;

    RETURN true;
  END IF;

  INSERT INTO public.admin_tasks (
    plan_id, task_type, description, status, priority, metadata
  ) VALUES (
    p_plan_id,
    'payment_refund_reversal',
    'Reverse or recover an externally sent planner payout after a Stripe refund.',
    'open',
    'urgent',
    v_metadata
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_planner_refund_reversal_task(
  uuid, uuid, uuid, text, integer, integer, text
) FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_capture_attempt_check;

ALTER TABLE public.payment_intents
  ADD CONSTRAINT payment_intents_capture_attempt_check
    CHECK (
      status <> 'capturing'
      OR (
        capture_attempt_id IS NOT NULL
        AND capture_started_at IS NOT NULL
        AND stripe_payment_intent_id IS NOT NULL
      )
    );

DROP INDEX IF EXISTS payment_intents_one_active_per_approval;

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_one_active_per_approval
  ON public.payment_intents (approval_id)
  WHERE status IN (
    'pending',
    'requested',
    'authorized',
    'capturing',
    'captured',
    'refunded',
    'refund_reconciliation_required',
    'blocked_by_account_state'
  );

COMMENT ON INDEX public.payment_intents_one_active_per_approval IS
  'Enforces exactly one payment record per approval through pending, capture, refund, or account-blocked states. A replacement charge after refund requires a new approval; only failed intents leave the retry guard.';

COMMENT ON COLUMN public.payment_intents.status IS
  'requested = local request exists, authorized = card authorization held, capturing = explicit capture is in progress, captured = explicit capture completed.';

COMMENT ON COLUMN public.payment_intents.capture_attempt_id IS
  'Durable identity for one capture attempt. Combined with the Stripe PaymentIntent id to form the deterministic Stripe idempotency key.';

COMMENT ON COLUMN public.payment_intents.capture_started_at IS
  'Time the current capture reservation began. A capturing row is stale when its updated_at lease is older than the reconciler timeout.';

COMMENT ON COLUMN public.payment_intents.capture_effects_started_at IS
  'Lease timestamp for terminal capture effects. Captured/failed effects may be reclaimed when this lease is stale and completion is still NULL.';

COMMENT ON COLUMN public.payment_intents.capture_effects_completed_at IS
  'Set only after terminal capture effects are durable: captured payments have a payout and completed action; failed capture attempts have a failed action. NULL means reconciliation still has work.';

COMMENT ON COLUMN public.payment_intents.stripe_payment_method_id IS
  'Binds an authorization reservation to one approved Stripe PaymentMethod so concurrent callers cannot share an idempotency key with different Stripe parameters.';

COMMENT ON COLUMN public.payment_intents.refunded_amount_cents IS
  'Stripe cumulative refunded amount in integer cents. Partial refunds remain captured; refunded means the full captured amount was returned.';

COMMENT ON FUNCTION public.preserve_unknown_planner_refund_truth() IS
  'Converts the deployed status-only refund write into durable unknown work. Exact Stripe snapshots must use apply_planner_deposit_refund to resolve it.';

COMMENT ON COLUMN public.payment_intents.account_state_blocked_previous_status IS
  'Pending/requested/authorized planner state restored only after the same connected account is verified ready again.';

COMMENT ON COLUMN public.payment_intents.account_state_blocked_stripe_account_id IS
  'Connected account that caused the planner payment block; fences deterministic recovery to the same account.';

UPDATE public.payment_intents
SET account_state_blocked_previous_status = CASE
  WHEN stripe_payment_intent_id IS NOT NULL AND authorized_at IS NOT NULL THEN 'authorized'
  WHEN stripe_payment_intent_id IS NOT NULL THEN 'requested'
  ELSE 'pending'
END
WHERE status = 'blocked_by_account_state'
  AND account_state_blocked_previous_status IS NULL;

UPDATE public.payment_intents payment
SET account_state_blocked_stripe_account_id = account.stripe_account_id
FROM public.vendor_stripe_accounts account
WHERE payment.status = 'blocked_by_account_state'
  AND payment.partner_kind = 'vendor'
  AND payment.partner_id = account.vendor_id
  AND payment.account_state_blocked_stripe_account_id IS NULL;

UPDATE public.payment_intents payment
SET account_state_blocked_stripe_account_id = account.stripe_account_id
FROM public.venues venue
JOIN public.venue_stripe_accounts account ON account.owner_id = venue.owner_id
WHERE payment.status = 'blocked_by_account_state'
  AND payment.partner_kind = 'venue'
  AND payment.partner_id = venue.id
  AND payment.account_state_blocked_stripe_account_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_payment_intents_stale_capturing
  ON public.payment_intents (updated_at)
  WHERE status = 'capturing';

DROP INDEX IF EXISTS idx_payment_intents_incomplete_capture_effects;

CREATE INDEX idx_payment_intents_incomplete_capture_effects
  ON public.payment_intents (updated_at)
  WHERE capture_effects_completed_at IS NULL
    AND (
      status IN ('captured', 'refunded')
      OR (status = 'failed' AND capture_attempt_id IS NOT NULL)
    );

-- Serialize an explicit capture against plan revisions. The lock order mirrors
-- apply_plan_revision_atomic (plan first), so either the revision commits and
-- makes the approval stale before this reservation, or this reservation wins
-- as the earlier serialized operation.
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
  'Atomically revalidates and locks the current plan, approval, payment action, and planner payment before reserving one explicit Stripe capture attempt.';

-- Preserve an in-flight capture when a connected account becomes restricted.
-- Stripe remains authoritative for that already-started attempt; the capture
-- worker/reconciler will finish or fail it, while pending/requested/authorized intents
-- are blocked so no later capture can begin on the restricted account.
--
-- This also carries forward the Prompt 1 stored-function repair: the legacy
-- kickback_payments table has no updated_at column.
CREATE OR REPLACE FUNCTION public.block_inflight_stripe_account_payments(
  p_stripe_account_id text,
  p_reason text,
  p_event_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vendor_ids uuid[];
  v_venue_owner_ids uuid[];
  v_venue_ids uuid[];
  v_builder_user_ids uuid[];
  v_payment_intents integer := 0;
  v_capturing_payment_intents_preserved integer := 0;
  v_vendor_transactions integer := 0;
  v_venue_transactions integer := 0;
  v_kickback_payments integer := 0;
  v_settlement_runs integer := 0;
  v_settlement_charges integer := 0;
  v_now timestamptz := now();
BEGIN
  SELECT COALESCE(array_agg(vendor_id), ARRAY[]::uuid[])
    INTO v_vendor_ids
  FROM public.vendor_stripe_accounts
  WHERE stripe_account_id = p_stripe_account_id;

  SELECT COALESCE(array_agg(owner_id), ARRAY[]::uuid[])
    INTO v_venue_owner_ids
  FROM public.venue_stripe_accounts
  WHERE stripe_account_id = p_stripe_account_id;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_venue_ids
  FROM public.venues
  WHERE owner_id = ANY(v_venue_owner_ids);

  SELECT COALESCE(array_agg(user_id), ARRAY[]::uuid[])
    INTO v_builder_user_ids
  FROM public.builder_stripe_accounts
  WHERE stripe_account_id = p_stripe_account_id;

  SELECT COUNT(*)
    INTO v_capturing_payment_intents_preserved
  FROM public.payment_intents
  WHERE status = 'capturing'
    AND (
      (partner_kind = 'vendor' AND partner_id = ANY(v_vendor_ids))
      OR (partner_kind = 'venue' AND partner_id = ANY(v_venue_ids))
    );

  UPDATE public.payment_intents
  SET
    status = 'blocked_by_account_state',
    account_state_blocked_previous_status = status,
    account_state_blocked_stripe_account_id = p_stripe_account_id,
    account_state_blocked_at = v_now,
    account_state_block_reason = p_reason,
    updated_at = v_now
  WHERE status IN ('pending', 'requested', 'authorized')
    AND (
      (partner_kind = 'vendor' AND partner_id = ANY(v_vendor_ids))
      OR (partner_kind = 'venue' AND partner_id = ANY(v_venue_ids))
    );
  GET DIAGNOSTICS v_payment_intents = ROW_COUNT;

  UPDATE public.vendor_transactions
  SET
    status = 'blocked_by_account_state',
    account_state_blocked_at = v_now,
    account_state_block_reason = p_reason
  WHERE status IN ('pending', 'processing')
    AND vendor_id = ANY(v_vendor_ids);
  GET DIAGNOSTICS v_vendor_transactions = ROW_COUNT;

  UPDATE public.venue_payment_transactions
  SET
    status = 'blocked_by_account_state',
    account_state_blocked_at = v_now,
    account_state_block_reason = p_reason,
    updated_at = v_now
  WHERE status IN ('pending_builder_payment', 'checkout_created')
    AND venue_owner_id = ANY(v_venue_owner_ids);
  GET DIAGNOSTICS v_venue_transactions = ROW_COUNT;

  UPDATE public.kickback_payments
  SET
    status = 'blocked_by_account_state',
    account_state_blocked_at = v_now,
    account_state_block_reason = p_reason
  WHERE status IN ('pending', 'processing', 'pending_venue_approval', 'invoice_sent')
    AND recipient_id = ANY(v_builder_user_ids);
  GET DIAGNOSTICS v_kickback_payments = ROW_COUNT;

  UPDATE public.settlement_charges
  SET
    status = 'blocked',
    blocked_at = v_now,
    blocked_previous_status = status,
    blocked_stripe_account_id = p_stripe_account_id,
    account_state_blocked_at = v_now,
    account_state_block_reason = p_reason,
    account_state_blocked_event_id = p_event_id,
    updated_at = v_now
  WHERE status = 'checkout_created'
    AND stripe_connected_account_id = p_stripe_account_id;
  GET DIAGNOSTICS v_settlement_charges = ROW_COUNT;

  UPDATE public.settlement_runs
  SET
    status = 'blocked',
    blocked_at = v_now,
    blocked_previous_status = status,
    blocked_stripe_account_id = p_stripe_account_id,
    account_state_blocked_at = v_now,
    account_state_block_reason = p_reason,
    account_state_blocked_event_id = p_event_id,
    updated_at = v_now
  WHERE status IN (
      'pending',
      'awaiting_attendance',
      'awaiting_organizer_review',
      'awaiting_venue_ack',
      'awaiting_venue_payment',
      'ready_to_settle'
    )
    AND organizer_id = ANY(v_builder_user_ids);
  GET DIAGNOSTICS v_settlement_runs = ROW_COUNT;

  UPDATE public.vendor_stripe_accounts
  SET last_webhook_event_id = p_event_id, last_webhook_event_type = p_reason, last_webhook_at = v_now
  WHERE stripe_account_id = p_stripe_account_id;

  UPDATE public.venue_stripe_accounts
  SET last_webhook_event_id = p_event_id, last_webhook_event_type = p_reason, last_webhook_at = v_now
  WHERE stripe_account_id = p_stripe_account_id;

  UPDATE public.builder_stripe_accounts
  SET last_webhook_event_id = p_event_id, last_webhook_event_type = p_reason, last_webhook_at = v_now
  WHERE stripe_account_id = p_stripe_account_id;

  RETURN jsonb_build_object(
    'payment_intents', v_payment_intents,
    'capturing_payment_intents_preserved', v_capturing_payment_intents_preserved,
    'vendor_transactions', v_vendor_transactions,
    'venue_payment_transactions', v_venue_transactions,
    'kickback_payments', v_kickback_payments,
    'settlement_runs', v_settlement_runs,
    'settlement_charges', v_settlement_charges
  );
END;
$$;

REVOKE ALL ON FUNCTION public.block_inflight_stripe_account_payments(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_inflight_stripe_account_payments(text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.block_inflight_stripe_account_payments(text, text, text) IS
  'Blocks not-yet-started payments for a restricted Stripe account. Capturing planner deposits are deliberately preserved and counted so Stripe truth can finalize or reconcile them without abandoning an in-flight charge.';

CREATE OR REPLACE FUNCTION public.unblock_stripe_account_settlements(
  p_stripe_account_id text,
  p_event_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_intents integer := 0;
  v_settlement_runs integer := 0;
  v_settlement_charges integer := 0;
  v_now timestamptz := now();
BEGIN
  UPDATE public.payment_intents
  SET
    status = account_state_blocked_previous_status,
    account_state_blocked_previous_status = NULL,
    account_state_blocked_stripe_account_id = NULL,
    account_state_blocked_at = NULL,
    account_state_block_reason = NULL,
    updated_at = v_now
  WHERE status = 'blocked_by_account_state'
    AND account_state_blocked_stripe_account_id = p_stripe_account_id
    AND account_state_blocked_previous_status IN ('pending', 'requested', 'authorized');
  GET DIAGNOSTICS v_payment_intents = ROW_COUNT;

  UPDATE public.settlement_charges
  SET
    status = blocked_previous_status,
    blocked_at = NULL,
    blocked_previous_status = NULL,
    blocked_stripe_account_id = NULL,
    account_state_blocked_at = NULL,
    account_state_block_reason = NULL,
    account_state_blocked_event_id = NULL,
    updated_at = v_now
  WHERE status = 'blocked'
    AND blocked_stripe_account_id = p_stripe_account_id
    AND account_state_blocked_at IS NOT NULL
    AND blocked_previous_status = 'checkout_created';
  GET DIAGNOSTICS v_settlement_charges = ROW_COUNT;

  UPDATE public.settlement_runs
  SET
    status = blocked_previous_status,
    blocked_at = NULL,
    blocked_previous_status = NULL,
    blocked_stripe_account_id = NULL,
    account_state_blocked_at = NULL,
    account_state_block_reason = NULL,
    account_state_blocked_event_id = NULL,
    updated_at = v_now
  WHERE status = 'blocked'
    AND blocked_stripe_account_id = p_stripe_account_id
    AND account_state_blocked_at IS NOT NULL
    AND blocked_previous_status IN (
      'pending',
      'awaiting_attendance',
      'awaiting_organizer_review',
      'awaiting_venue_ack',
      'awaiting_venue_payment',
      'ready_to_settle'
    );
  GET DIAGNOSTICS v_settlement_runs = ROW_COUNT;

  UPDATE public.vendor_stripe_accounts
  SET last_webhook_event_id = p_event_id,
      last_webhook_event_type = 'account.updated.unblocked',
      last_webhook_at = v_now
  WHERE stripe_account_id = p_stripe_account_id;

  UPDATE public.venue_stripe_accounts
  SET last_webhook_event_id = p_event_id,
      last_webhook_event_type = 'account.updated.unblocked',
      last_webhook_at = v_now
  WHERE stripe_account_id = p_stripe_account_id;

  UPDATE public.builder_stripe_accounts
  SET last_webhook_event_id = p_event_id,
      last_webhook_event_type = 'account.updated.unblocked',
      last_webhook_at = v_now
  WHERE stripe_account_id = p_stripe_account_id;

  RETURN jsonb_build_object(
    'payment_intents', v_payment_intents,
    'settlement_runs', v_settlement_runs,
    'settlement_charges', v_settlement_charges
  );
END;
$$;

REVOKE ALL ON FUNCTION public.unblock_stripe_account_settlements(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unblock_stripe_account_settlements(text, text)
  TO service_role;

COMMENT ON FUNCTION public.unblock_stripe_account_settlements(text, text) IS
  'Restores account-blocked planner payments to their fenced prior state after the same connected account is verified ready, and restores blocked settlement rows.';

CREATE OR REPLACE FUNCTION public.ensure_planner_deposit_payout(
  p_payment_intent_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payment_intents%ROWTYPE;
  v_payout public.payouts%ROWTYPE;
  v_target_amount integer;
  v_created boolean := false;
  v_adjusted boolean := false;
BEGIN
  SELECT * INTO v_payment
  FROM public.payment_intents
  WHERE id = p_payment_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Planner payment intent % was not found', p_payment_intent_id;
  END IF;
  IF v_payment.status NOT IN ('captured', 'refunded') THEN
    RAISE EXCEPTION 'Cannot ensure payout for planner payment status %', v_payment.status;
  END IF;

  v_target_amount := GREATEST(
    0,
    v_payment.amount_cents - v_payment.platform_fee_cents - v_payment.refunded_amount_cents
  );

  SELECT * INTO v_payout
  FROM public.payouts
  WHERE payment_intent_id = v_payment.id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF v_target_amount > 0 THEN
      INSERT INTO public.payouts (
        payment_intent_id, partner_kind, partner_id, amount_cents, currency, status
      ) VALUES (
        v_payment.id,
        v_payment.partner_kind,
        v_payment.partner_id,
        v_target_amount,
        v_payment.currency,
        'pending'
      ) RETURNING * INTO v_payout;
      v_created := true;
    END IF;
  ELSIF (v_payout.stripe_payout_id IS NOT NULL OR v_payout.status IN ('paid', 'reversal_required'))
    AND v_payout.amount_cents <> v_target_amount THEN
    UPDATE public.payouts
    SET status = 'reversal_required', updated_at = now()
    WHERE id = v_payout.id
    RETURNING * INTO v_payout;

    IF v_payment.refunded_amount_cents > 0 THEN
      PERFORM public.sync_planner_refund_reversal_task(
        v_payment.plan_id,
        v_payment.id,
        v_payout.id,
        v_payout.stripe_payout_id,
        v_target_amount,
        v_payment.refunded_amount_cents,
        NULL
      );
    END IF;
    v_adjusted := true;
  ELSIF v_payout.stripe_payout_id IS NULL AND v_payout.status <> 'paid' THEN
    UPDATE public.payouts
    SET
      amount_cents = v_target_amount,
      status = CASE WHEN v_target_amount = 0 THEN 'cancelled' ELSE 'pending' END,
      updated_at = now()
    WHERE id = v_payout.id
      AND (
        amount_cents IS DISTINCT FROM v_target_amount
        OR status IS DISTINCT FROM CASE WHEN v_target_amount = 0 THEN 'cancelled' ELSE 'pending' END
      )
    RETURNING * INTO v_payout;
    v_adjusted := FOUND;
  END IF;

  RETURN jsonb_build_object(
    'payment_intent_id', v_payment.id,
    'target_amount_cents', v_target_amount,
    'created', v_created,
    'adjusted', v_adjusted,
    'reversal_required', COALESCE(v_payout.status = 'reversal_required', false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_planner_deposit_payout(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_planner_deposit_payout(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.apply_planner_deposit_refund(
  p_stripe_payment_intent_id text,
  p_charge_amount_captured_cents integer,
  p_refunded_amount_cents integer,
  p_currency text,
  p_event_id text,
  p_charge_refunded boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payment_intents%ROWTYPE;
  v_payout public.payouts%ROWTYPE;
  v_effective_refund integer;
  v_previous_refund integer;
  v_target_amount integer;
BEGIN
  IF p_stripe_payment_intent_id IS NULL OR p_refunded_amount_cents < 0 THEN
    RAISE EXCEPTION 'Invalid planner refund snapshot';
  END IF;

  SELECT * INTO v_payment
  FROM public.payment_intents
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false);
  END IF;
  IF v_payment.status NOT IN ('captured', 'refunded', 'refund_reconciliation_required') THEN
    RAISE EXCEPTION 'Cannot refund planner payment in status %', v_payment.status;
  END IF;
  IF lower(p_currency) <> lower(v_payment.currency) THEN
    RAISE EXCEPTION 'Planner refund currency mismatch';
  END IF;
  IF p_charge_amount_captured_cents <> v_payment.amount_cents THEN
    RAISE EXCEPTION 'Planner refund captured amount mismatch';
  END IF;
  IF p_refunded_amount_cents > p_charge_amount_captured_cents THEN
    RAISE EXCEPTION 'Planner refund cumulative amount exceeds the captured charge';
  END IF;

  v_previous_refund := v_payment.refunded_amount_cents;
  v_effective_refund := GREATEST(
    v_previous_refund,
    LEAST(p_refunded_amount_cents, v_payment.amount_cents)
  );

  IF p_charge_refunded IS DISTINCT FROM (
    p_refunded_amount_cents = p_charge_amount_captured_cents
  ) THEN
    RAISE EXCEPTION 'Planner refund full-refund flag does not match cumulative amount';
  END IF;

  v_target_amount := GREATEST(
    0,
    v_payment.amount_cents - v_payment.platform_fee_cents - v_effective_refund
  );

  SELECT * INTO v_payout
  FROM public.payouts
  WHERE payment_intent_id = v_payment.id
  FOR UPDATE;

  IF FOUND THEN
    IF (v_payout.stripe_payout_id IS NOT NULL OR v_payout.status IN ('paid', 'reversal_required'))
      AND v_payout.amount_cents <> v_target_amount THEN
      UPDATE public.payouts
      SET status = 'reversal_required', updated_at = now()
      WHERE id = v_payout.id
      RETURNING * INTO v_payout;

      IF v_effective_refund > v_previous_refund THEN
        PERFORM public.sync_planner_refund_reversal_task(
          v_payment.plan_id,
          v_payment.id,
          v_payout.id,
          v_payout.stripe_payout_id,
          v_target_amount,
          v_effective_refund,
          p_event_id
        );
      END IF;
    ELSIF v_payout.stripe_payout_id IS NULL AND v_payout.status <> 'paid' THEN
      UPDATE public.payouts
      SET
        amount_cents = v_target_amount,
        status = CASE WHEN v_target_amount = 0 THEN 'cancelled' ELSE 'pending' END,
        updated_at = now()
      WHERE id = v_payout.id;
    END IF;
  ELSIF v_target_amount > 0 THEN
    INSERT INTO public.payouts (
      payment_intent_id, partner_kind, partner_id, amount_cents, currency, status
    ) VALUES (
      v_payment.id,
      v_payment.partner_kind,
      v_payment.partner_id,
      v_target_amount,
      v_payment.currency,
      'pending'
    );
  END IF;

  UPDATE public.payment_intents
  SET
    refunded_amount_cents = v_effective_refund,
    refund_updated_at = CASE
      WHEN v_effective_refund > v_previous_refund THEN now()
      ELSE refund_updated_at
    END,
    last_refund_event_id = p_event_id,
    status = CASE
      WHEN v_effective_refund = amount_cents THEN 'refunded'
      ELSE 'captured'
    END,
    updated_at = now()
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  RETURN jsonb_build_object(
    'matched', true,
    'payment_intent_id', v_payment.id,
    'status', v_payment.status,
    'previous_refunded_amount_cents', v_previous_refund,
    'refunded_amount_cents', v_payment.refunded_amount_cents,
    'refund_delta_cents', v_payment.refunded_amount_cents - v_previous_refund,
    'target_payout_amount_cents', v_target_amount,
    'reversal_required', COALESCE(v_payout.status = 'reversal_required', false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_planner_deposit_refund(text, integer, integer, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_planner_deposit_refund(text, integer, integer, text, text, boolean)
  TO service_role;
