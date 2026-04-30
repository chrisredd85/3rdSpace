-- ============================================================================
-- VENDOR PAYMENT TRANSACTIONS
-- ============================================================================

ALTER TABLE public.vendor_bookings
  DROP CONSTRAINT IF EXISTS valid_payment_status;

ALTER TABLE public.vendor_bookings
  ADD CONSTRAINT valid_payment_status
    CHECK (
      payment_status IS NULL OR payment_status IN (
        'pending',
        'processing',
        'succeeded',
        'fully_paid',
        'failed',
        'refunded'
      )
    );

CREATE TABLE IF NOT EXISTS public.vendor_transactions (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES public.vendor_bookings(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES public.vendor_profiles(id) ON DELETE CASCADE,
  builder_id UUID NOT NULL REFERENCES public.builder_profiles(id) ON DELETE CASCADE,
  stripe_payment_intent_id VARCHAR(255),
  stripe_charge_id VARCHAR(255),
  stripe_transfer_id VARCHAR(255),
  amount NUMERIC(10,2) NOT NULL,
  platform_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  stripe_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  vendor_payout NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vendor_transactions_payment_type_check
    CHECK (payment_type IN ('deposit', 'final_payment', 'service_payment', 'refund')),
  CONSTRAINT vendor_transactions_status_check
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'refunded')),
  CONSTRAINT vendor_transactions_amount_check
    CHECK (amount >= 0),
  CONSTRAINT vendor_transactions_platform_fee_check
    CHECK (platform_fee >= 0),
  CONSTRAINT vendor_transactions_stripe_fee_check
    CHECK (stripe_fee >= 0),
  CONSTRAINT vendor_transactions_vendor_payout_check
    CHECK (vendor_payout >= 0)
);

CREATE INDEX IF NOT EXISTS idx_vendor_transactions_booking_id
  ON public.vendor_transactions(booking_id);

CREATE INDEX IF NOT EXISTS idx_vendor_transactions_vendor_id
  ON public.vendor_transactions(vendor_id);

CREATE INDEX IF NOT EXISTS idx_vendor_transactions_builder_id
  ON public.vendor_transactions(builder_id);

CREATE INDEX IF NOT EXISTS idx_vendor_transactions_payment_intent
  ON public.vendor_transactions(stripe_payment_intent_id);

ALTER TABLE public.vendor_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builders can view own vendor transactions" ON public.vendor_transactions;
CREATE POLICY "Builders can view own vendor transactions"
  ON public.vendor_transactions
  FOR SELECT
  USING (
    builder_id IN (
      SELECT id FROM public.builder_profiles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Vendors can view own vendor transactions" ON public.vendor_transactions;
CREATE POLICY "Vendors can view own vendor transactions"
  ON public.vendor_transactions
  FOR SELECT
  USING (
    vendor_id IN (
      SELECT id FROM public.vendor_profiles WHERE user_id = auth.uid()
    )
  );

GRANT ALL ON TABLE public.vendor_transactions TO anon;
GRANT ALL ON TABLE public.vendor_transactions TO authenticated;
GRANT ALL ON TABLE public.vendor_transactions TO service_role;
