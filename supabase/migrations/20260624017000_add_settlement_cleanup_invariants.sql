-- Migration: Settlement cleanup invariants
-- Created: 2026-06-24
-- Context: CHI settlement charges are USD-only, zero-platform-fee pass-through
-- payments. This makes those assumptions explicit at the database layer.

ALTER TABLE public.settlement_charges
  DROP CONSTRAINT IF EXISTS settlement_charges_currency_check;

ALTER TABLE public.settlement_charges
  ADD CONSTRAINT settlement_charges_currency_check
  CHECK (currency = 'usd');

ALTER TABLE public.settlement_charges
  DROP CONSTRAINT IF EXISTS settlement_charges_zero_platform_fee_check;

ALTER TABLE public.settlement_charges
  ADD CONSTRAINT settlement_charges_zero_platform_fee_check
  CHECK (
    platform_fee_cents = 0 AND
    organizer_payout_cents = amount_cents
  );

COMMENT ON CONSTRAINT settlement_charges_currency_check ON public.settlement_charges IS
  'CHI settlement charges are USD-only for MVP.';

COMMENT ON CONSTRAINT settlement_charges_zero_platform_fee_check ON public.settlement_charges IS
  '3rdPlace takes no platform fee from CHI settlement payments; the full principal routes to the organizer.';
