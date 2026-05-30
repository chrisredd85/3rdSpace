-- Migration: Tighten venue rental payment invariants
-- Created: 2026-05-30
-- Context: Phase 2 checkout route writes venue payout and refund values.
-- These checks defend the 100% pass-through invariant and prevent refunds
-- above the original rental principal.

ALTER TABLE public.venue_payment_transactions
  ADD CONSTRAINT venue_payment_transactions_payout_lte_amount_check
  CHECK (venue_payout_cents <= amount_cents);

ALTER TABLE public.venue_payment_transactions
  DROP CONSTRAINT IF EXISTS venue_payment_transactions_refund_amount_cents_check,
  ADD CONSTRAINT venue_payment_transactions_refund_amount_cents_check
  CHECK (
    refund_amount_cents IS NULL
    OR (refund_amount_cents >= 0 AND refund_amount_cents <= amount_cents)
  );

COMMENT ON CONSTRAINT venue_payment_transactions_payout_lte_amount_check
  ON public.venue_payment_transactions IS
  'Venue payout cannot exceed the negotiated rental principal paid by the builder.';

COMMENT ON CONSTRAINT venue_payment_transactions_refund_amount_cents_check
  ON public.venue_payment_transactions IS
  'Refund amount cannot exceed the original venue rental principal.';
