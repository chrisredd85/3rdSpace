-- ============================================================================
-- VENDOR DEPOSITS AND PAYMENT TERMS
-- ============================================================================

ALTER TABLE public.vendor_profiles
  ADD COLUMN IF NOT EXISTS requires_deposit BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS deposit_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS deposit_percentage INTEGER,
  ADD COLUMN IF NOT EXISTS deposit_refundable BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS deposit_terms TEXT;

ALTER TABLE public.vendor_profiles
  ALTER COLUMN deposit_type TYPE VARCHAR(20);

ALTER TABLE public.vendor_profiles
  DROP CONSTRAINT IF EXISTS vendor_profiles_deposit_type_check,
  DROP CONSTRAINT IF EXISTS vendor_profiles_deposit_amount_check,
  DROP CONSTRAINT IF EXISTS vendor_profiles_deposit_percentage_check;

ALTER TABLE public.vendor_profiles
  ADD CONSTRAINT vendor_profiles_deposit_type_check
    CHECK (deposit_type IS NULL OR deposit_type IN ('fixed', 'percentage')),
  ADD CONSTRAINT vendor_profiles_deposit_amount_check
    CHECK (deposit_amount IS NULL OR deposit_amount > 0),
  ADD CONSTRAINT vendor_profiles_deposit_percentage_check
    CHECK (deposit_percentage IS NULL OR deposit_percentage BETWEEN 1 AND 100);

COMMENT ON COLUMN public.vendor_profiles.requires_deposit IS
  'Whether this vendor requires a deposit before a booking is secured.';
COMMENT ON COLUMN public.vendor_profiles.deposit_amount IS
  'Fixed deposit amount when deposit_type is fixed.';
COMMENT ON COLUMN public.vendor_profiles.deposit_type IS
  'Deposit calculation type: fixed amount or percentage of booking total.';
COMMENT ON COLUMN public.vendor_profiles.deposit_percentage IS
  'Percentage of booking total required as deposit when deposit_type is percentage.';
COMMENT ON COLUMN public.vendor_profiles.deposit_refundable IS
  'Whether the vendor deposit can be refunded under stated terms.';
COMMENT ON COLUMN public.vendor_profiles.deposit_terms IS
  'Vendor-provided payment, refund, and cancellation terms.';
