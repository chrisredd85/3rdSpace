-- ============================================================================
-- STANDARDIZE VENDOR PROFILES AS THE VENDOR SOURCE OF TRUTH
-- ============================================================================

ALTER TABLE public.vendor_profiles
  ADD COLUMN IF NOT EXISTS requires_deposit BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS deposit_type TEXT,
  ADD COLUMN IF NOT EXISTS deposit_percentage INTEGER,
  ADD COLUMN IF NOT EXISTS deposit_refundable BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS deposit_terms TEXT;

ALTER TABLE public.vendor_profiles
  DROP CONSTRAINT IF EXISTS vendor_profiles_pricing_model_check,
  DROP CONSTRAINT IF EXISTS valid_vendor_pricing_model,
  DROP CONSTRAINT IF EXISTS vendor_profiles_deposit_type_check,
  DROP CONSTRAINT IF EXISTS vendor_profiles_deposit_amount_check,
  DROP CONSTRAINT IF EXISTS vendor_profiles_deposit_percentage_check;

UPDATE public.vendor_profiles
SET pricing_model = 'flat_rate'
WHERE pricing_model IN ('flat', 'package');

ALTER TABLE public.vendor_profiles
  ADD CONSTRAINT valid_vendor_pricing_model
    CHECK (pricing_model IS NULL OR pricing_model IN ('flat_rate', 'per_person', 'hourly', 'revenue_share', 'hybrid')),
  ADD CONSTRAINT vendor_profiles_deposit_type_check
    CHECK (deposit_type IS NULL OR deposit_type IN ('fixed', 'percentage')),
  ADD CONSTRAINT vendor_profiles_deposit_amount_check
    CHECK (deposit_amount IS NULL OR deposit_amount > 0),
  ADD CONSTRAINT vendor_profiles_deposit_percentage_check
    CHECK (deposit_percentage IS NULL OR deposit_percentage BETWEEN 1 AND 100);
