-- ============================================================================
-- DEPOSIT REQUIREMENTS FOR VENUES AND VENDORS
-- ============================================================================

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS requires_deposit BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS deposit_type TEXT,
  ADD COLUMN IF NOT EXISTS deposit_percentage INTEGER,
  ADD COLUMN IF NOT EXISTS deposit_refundable BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS deposit_terms TEXT;

ALTER TABLE IF EXISTS public.vendors
  ADD COLUMN IF NOT EXISTS requires_deposit BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS deposit_type TEXT,
  ADD COLUMN IF NOT EXISTS deposit_percentage INTEGER,
  ADD COLUMN IF NOT EXISTS deposit_refundable BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS deposit_terms TEXT;

ALTER TABLE IF EXISTS public.vendor_profiles
  ADD COLUMN IF NOT EXISTS requires_deposit BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS deposit_type TEXT,
  ADD COLUMN IF NOT EXISTS deposit_percentage INTEGER,
  ADD COLUMN IF NOT EXISTS deposit_refundable BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS deposit_terms TEXT;

ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS venues_deposit_type_check,
  DROP CONSTRAINT IF EXISTS venues_deposit_amount_check,
  DROP CONSTRAINT IF EXISTS venues_deposit_percentage_check;

ALTER TABLE public.venues
  ADD CONSTRAINT venues_deposit_type_check
    CHECK (deposit_type IS NULL OR deposit_type IN ('fixed', 'percentage')),
  ADD CONSTRAINT venues_deposit_amount_check
    CHECK (deposit_amount IS NULL OR deposit_amount > 0),
  ADD CONSTRAINT venues_deposit_percentage_check
    CHECK (deposit_percentage IS NULL OR deposit_percentage BETWEEN 1 AND 100);

ALTER TABLE IF EXISTS public.vendors
  DROP CONSTRAINT IF EXISTS vendors_deposit_type_check,
  DROP CONSTRAINT IF EXISTS vendors_deposit_amount_check,
  DROP CONSTRAINT IF EXISTS vendors_deposit_percentage_check;

ALTER TABLE IF EXISTS public.vendors
  ADD CONSTRAINT vendors_deposit_type_check
    CHECK (deposit_type IS NULL OR deposit_type IN ('fixed', 'percentage')),
  ADD CONSTRAINT vendors_deposit_amount_check
    CHECK (deposit_amount IS NULL OR deposit_amount > 0),
  ADD CONSTRAINT vendors_deposit_percentage_check
    CHECK (deposit_percentage IS NULL OR deposit_percentage BETWEEN 1 AND 100);

ALTER TABLE IF EXISTS public.vendor_profiles
  DROP CONSTRAINT IF EXISTS vendor_profiles_deposit_type_check,
  DROP CONSTRAINT IF EXISTS vendor_profiles_deposit_amount_check,
  DROP CONSTRAINT IF EXISTS vendor_profiles_deposit_percentage_check;

ALTER TABLE IF EXISTS public.vendor_profiles
  ADD CONSTRAINT vendor_profiles_deposit_type_check
    CHECK (deposit_type IS NULL OR deposit_type IN ('fixed', 'percentage')),
  ADD CONSTRAINT vendor_profiles_deposit_amount_check
    CHECK (deposit_amount IS NULL OR deposit_amount > 0),
  ADD CONSTRAINT vendor_profiles_deposit_percentage_check
    CHECK (deposit_percentage IS NULL OR deposit_percentage BETWEEN 1 AND 100);
