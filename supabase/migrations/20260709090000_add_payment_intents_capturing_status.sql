-- Migration: Add planner deposit capture reservation state
-- Created: 2026-07-09
-- Context: Prevent duplicate Stripe capture attempts from concurrent capture
-- requests on the same approval-backed planner deposit.

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
      'failed',
      'blocked_by_account_state'
    ));

DROP INDEX IF EXISTS payment_intents_one_active_per_approval;

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_one_active_per_approval
  ON public.payment_intents (approval_id)
  WHERE status IN ('pending', 'requested', 'authorized', 'capturing', 'captured');

COMMENT ON INDEX public.payment_intents_one_active_per_approval IS
  'Enforces exactly one active deposit per approval, including pending authorization and capture reservations. Refunded and failed intents do not count toward the constraint, so re-attempt after refund/failure is allowed.';

COMMENT ON COLUMN public.payment_intents.status IS
  'requested = local request exists, authorized = card authorization held, capturing = explicit capture is in progress, captured = explicit capture completed.';
