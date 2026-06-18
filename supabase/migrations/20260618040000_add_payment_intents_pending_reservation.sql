-- Migration: Reserve planner deposit rows before Stripe authorization
-- Created: 2026-06-18
-- Context: Prevent orphan Stripe PaymentIntents when concurrent deposit
-- authorization requests race with different amounts for the same approval.

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT COUNT(*)
    INTO duplicate_count
  FROM (
    SELECT approval_id
    FROM public.payment_intents
    WHERE status IN ('pending', 'requested', 'authorized', 'captured')
    GROUP BY approval_id
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add pending active payment intent guard: % approval(s) already have duplicate active payment_intents',
      duplicate_count;
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
      'captured',
      'refunded',
      'failed',
      'blocked_by_account_state'
    )),
  ADD COLUMN IF NOT EXISTS failure_reason text;

DROP INDEX IF EXISTS payment_intents_one_active_per_approval;

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_one_active_per_approval
  ON public.payment_intents (approval_id)
  WHERE status IN ('pending', 'requested', 'authorized', 'captured');

COMMENT ON INDEX public.payment_intents_one_active_per_approval IS
  'Enforces exactly one active deposit per approval, including pending reserve rows created before Stripe authorization. Refunded and failed intents do not count toward the constraint, so re-attempt after refund/failure is allowed.';

COMMENT ON COLUMN public.payment_intents.failure_reason IS
  'Failure reason captured when a pending planner deposit reservation fails before Stripe authorization completes.';
