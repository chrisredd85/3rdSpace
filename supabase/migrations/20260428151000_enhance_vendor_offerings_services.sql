-- ============================================================================
-- VENDOR SERVICE LISTINGS AND PORTFOLIO
-- ============================================================================

ALTER TABLE public.vendor_offerings
  ADD COLUMN IF NOT EXISTS base_price NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pricing_model TEXT DEFAULT 'flat_rate',
  ADD COLUMN IF NOT EXISTS min_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS max_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS duration_hours NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS portfolio_images TEXT[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS add_ons JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS service_category TEXT DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS max_capacity INTEGER,
  ADD COLUMN IF NOT EXISTS equipment_included TEXT[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.vendor_offerings
SET
  base_price = COALESCE(base_price, 0),
  pricing_model = COALESCE(pricing_model, 'flat_rate'),
  portfolio_images = COALESCE(portfolio_images, '{}'::text[]),
  add_ons = COALESCE(add_ons, '[]'::jsonb),
  service_category = COALESCE(service_category, 'other'),
  equipment_included = COALESCE(equipment_included, '{}'::text[]),
  is_active = COALESCE(is_active, true),
  updated_at = COALESCE(updated_at, created_at, NOW());

ALTER TABLE public.vendor_offerings
  ALTER COLUMN base_price SET NOT NULL,
  ALTER COLUMN pricing_model SET NOT NULL,
  ALTER COLUMN portfolio_images SET NOT NULL,
  ALTER COLUMN add_ons SET NOT NULL,
  ALTER COLUMN service_category SET NOT NULL,
  ALTER COLUMN equipment_included SET NOT NULL,
  ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.vendor_offerings
  DROP CONSTRAINT IF EXISTS vendor_offerings_base_price_check,
  DROP CONSTRAINT IF EXISTS vendor_offerings_duration_hours_check,
  DROP CONSTRAINT IF EXISTS vendor_offerings_max_capacity_check,
  DROP CONSTRAINT IF EXISTS vendor_offerings_pricing_model_check,
  DROP CONSTRAINT IF EXISTS vendor_offerings_service_category_check,
  DROP CONSTRAINT IF EXISTS vendor_offerings_portfolio_images_limit_check;

ALTER TABLE public.vendor_offerings
  ADD CONSTRAINT vendor_offerings_base_price_check
    CHECK (base_price >= 0),
  ADD CONSTRAINT vendor_offerings_duration_hours_check
    CHECK (duration_hours IS NULL OR duration_hours > 0),
  ADD CONSTRAINT vendor_offerings_max_capacity_check
    CHECK (max_capacity IS NULL OR max_capacity > 0),
  ADD CONSTRAINT vendor_offerings_pricing_model_check
    CHECK (pricing_model IN ('hourly', 'flat_rate', 'per_person', 'revenue_share', 'hybrid')),
  ADD CONSTRAINT vendor_offerings_service_category_check
    CHECK (service_category IN ('dj', 'photography', 'videography', 'av', 'security', 'catering', 'bartending', 'staffing', 'production', 'decor', 'other')),
  ADD CONSTRAINT vendor_offerings_portfolio_images_limit_check
    CHECK (array_length(portfolio_images, 1) IS NULL OR array_length(portfolio_images, 1) <= 10);

CREATE INDEX IF NOT EXISTS idx_vendor_offerings_category
  ON public.vendor_offerings(service_category);

CREATE INDEX IF NOT EXISTS idx_vendor_offerings_active
  ON public.vendor_offerings(vendor_id, is_active);

DROP TRIGGER IF EXISTS update_vendor_offerings_updated_at ON public.vendor_offerings;
CREATE TRIGGER update_vendor_offerings_updated_at
  BEFORE UPDATE ON public.vendor_offerings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

