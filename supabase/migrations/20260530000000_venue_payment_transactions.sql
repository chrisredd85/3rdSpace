-- Migration: Venue rental payment transaction ledger
-- Created: 2026-05-30
-- Context: Phase 2 Builder -> Venue rental payments. Builders explicitly
-- approve rental terms, then pay confirmed venue bookings through Stripe
-- Checkout destination charges. Venues receive the negotiated rental amount;
-- builder-paid processing fees are tracked separately.

CREATE TABLE IF NOT EXISTS public.venue_payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  venue_booking_id uuid REFERENCES public.venue_bookings(id) ON DELETE SET NULL,
  builder_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE RESTRICT,
  venue_owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL,
  processing_fee_cents integer NOT NULL DEFAULT 0,
  application_fee_cents integer NOT NULL DEFAULT 0,
  venue_payout_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'pending_builder_payment',
  payment_method_type text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_transfer_id text,
  stripe_refund_id text,
  stripe_transfer_reversal_id text,
  refund_amount_cents integer,
  refund_reason text,
  refund_requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  refund_requested_at timestamptz,
  refund_approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  refund_approved_at timestamptz,
  paid_at timestamptz,
  transfer_completed_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_payment_transactions_amount_cents_check
    CHECK (amount_cents >= 50 AND amount_cents <= 5000000),
  CONSTRAINT venue_payment_transactions_processing_fee_cents_check
    CHECK (processing_fee_cents >= 0),
  CONSTRAINT venue_payment_transactions_application_fee_cents_check
    CHECK (application_fee_cents >= 0),
  CONSTRAINT venue_payment_transactions_venue_payout_cents_check
    CHECK (venue_payout_cents >= 0),
  CONSTRAINT venue_payment_transactions_refund_amount_cents_check
    CHECK (refund_amount_cents IS NULL OR refund_amount_cents >= 0),
  CONSTRAINT venue_payment_transactions_currency_check
    CHECK (currency = 'usd'),
  CONSTRAINT venue_payment_transactions_status_check
    CHECK (status IN (
      'pending_builder_payment',
      'checkout_created',
      'paid',
      'refund_requested',
      'refund_approved',
      'refunded_partial',
      'refunded_full',
      'cancelled',
      'failed'
    )),
  CONSTRAINT venue_payment_transactions_payment_method_type_check
    CHECK (
      payment_method_type IS NULL
      OR payment_method_type IN ('card', 'us_bank_account')
    )
);

CREATE INDEX IF NOT EXISTS idx_venue_payment_transactions_plan_id
  ON public.venue_payment_transactions(plan_id);

CREATE INDEX IF NOT EXISTS idx_venue_payment_transactions_booking_id
  ON public.venue_payment_transactions(venue_booking_id)
  WHERE venue_booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_venue_payment_transactions_builder_id
  ON public.venue_payment_transactions(builder_id);

CREATE INDEX IF NOT EXISTS idx_venue_payment_transactions_venue_id
  ON public.venue_payment_transactions(venue_id);

CREATE INDEX IF NOT EXISTS idx_venue_payment_transactions_owner_id
  ON public.venue_payment_transactions(venue_owner_id);

CREATE INDEX IF NOT EXISTS idx_venue_payment_transactions_status
  ON public.venue_payment_transactions(status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_payment_transactions_plan_booking_unique
  ON public.venue_payment_transactions(plan_id, venue_booking_id)
  WHERE venue_booking_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_payment_transactions_checkout_session_unique
  ON public.venue_payment_transactions(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_payment_transactions_payment_intent_unique
  ON public.venue_payment_transactions(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_payment_transactions_transfer_unique
  ON public.venue_payment_transactions(stripe_transfer_id)
  WHERE stripe_transfer_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_venue_payment_transactions_updated_at
  ON public.venue_payment_transactions;
CREATE TRIGGER update_venue_payment_transactions_updated_at
  BEFORE UPDATE ON public.venue_payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.venue_payment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builders can read own venue payment transactions"
  ON public.venue_payment_transactions;
CREATE POLICY "Builders can read own venue payment transactions"
  ON public.venue_payment_transactions
  FOR SELECT
  TO authenticated
  USING (
    builder_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.plans plan
      WHERE plan.id = venue_payment_transactions.plan_id
        AND plan.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Venue owners can read own venue payment transactions"
  ON public.venue_payment_transactions;
CREATE POLICY "Venue owners can read own venue payment transactions"
  ON public.venue_payment_transactions
  FOR SELECT
  TO authenticated
  USING (
    venue_owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.venues venue
      WHERE venue.id = venue_payment_transactions.venue_id
        AND venue.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage venue payment transactions"
  ON public.venue_payment_transactions;
CREATE POLICY "Service role can manage venue payment transactions"
  ON public.venue_payment_transactions
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT SELECT ON public.venue_payment_transactions TO authenticated;
GRANT ALL ON public.venue_payment_transactions TO service_role;

COMMENT ON TABLE public.venue_payment_transactions IS
  'Phase 2 venue rental payment ledger. Builders pay confirmed venue bookings through Stripe Checkout destination charges.';
COMMENT ON COLUMN public.venue_payment_transactions.venue_booking_id IS
  'Confirmed venue booking that anchors the negotiated rental amount. Nullable only to preserve financial history if a booking row is deleted.';
COMMENT ON COLUMN public.venue_payment_transactions.amount_cents IS
  'Negotiated venue rental principal in integer cents. Must be between $0.50 and $50,000.';
COMMENT ON COLUMN public.venue_payment_transactions.processing_fee_cents IS
  'Builder-paid processing fee in integer cents. Venue payout remains the full negotiated amount.';
COMMENT ON COLUMN public.venue_payment_transactions.application_fee_cents IS
  'Platform fee in integer cents. Phase 2 keeps this at zero for 100% venue pass-through.';
COMMENT ON COLUMN public.venue_payment_transactions.venue_payout_cents IS
  'Amount routed to the venue connected account. For Phase 2 this equals amount_cents.';
COMMENT ON COLUMN public.venue_payment_transactions.payment_method_type IS
  'Builder-selected Stripe payment method used to compute the processing fee: card or us_bank_account.';
COMMENT ON COLUMN public.venue_payment_transactions.status IS
  'pending_builder_payment, checkout_created, paid, refund_requested, refund_approved, refunded_partial, refunded_full, cancelled, or failed.';

-- Down migration reference:
-- DROP TABLE IF EXISTS public.venue_payment_transactions;
