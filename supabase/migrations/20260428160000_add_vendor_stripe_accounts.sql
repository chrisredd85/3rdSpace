-- ============================================================================
-- VENDOR STRIPE CONNECT ACCOUNTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vendor_stripe_accounts (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  vendor_id UUID NOT NULL UNIQUE REFERENCES public.vendor_profiles(id) ON DELETE CASCADE,
  stripe_account_id VARCHAR(255) UNIQUE,
  account_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  charges_enabled BOOLEAN NOT NULL DEFAULT false,
  payouts_enabled BOOLEAN NOT NULL DEFAULT false,
  requirements_due JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vendor_stripe_accounts_status_check
    CHECK (account_status IN ('pending', 'active', 'restricted'))
);

CREATE INDEX IF NOT EXISTS idx_vendor_stripe_accounts_vendor_id
  ON public.vendor_stripe_accounts(vendor_id);

CREATE INDEX IF NOT EXISTS idx_vendor_stripe_accounts_stripe_account_id
  ON public.vendor_stripe_accounts(stripe_account_id);

DROP TRIGGER IF EXISTS update_vendor_stripe_accounts_updated_at
  ON public.vendor_stripe_accounts;

CREATE TRIGGER update_vendor_stripe_accounts_updated_at
  BEFORE UPDATE ON public.vendor_stripe_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.vendor_stripe_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vendors can view own stripe account" ON public.vendor_stripe_accounts;
CREATE POLICY "Vendors can view own stripe account"
  ON public.vendor_stripe_accounts
  FOR SELECT
  USING (
    vendor_id IN (
      SELECT id FROM public.vendor_profiles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Vendors can create own stripe account" ON public.vendor_stripe_accounts;
CREATE POLICY "Vendors can create own stripe account"
  ON public.vendor_stripe_accounts
  FOR INSERT
  WITH CHECK (
    vendor_id IN (
      SELECT id FROM public.vendor_profiles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Vendors can update own stripe account" ON public.vendor_stripe_accounts;
CREATE POLICY "Vendors can update own stripe account"
  ON public.vendor_stripe_accounts
  FOR UPDATE
  USING (
    vendor_id IN (
      SELECT id FROM public.vendor_profiles WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    vendor_id IN (
      SELECT id FROM public.vendor_profiles WHERE user_id = auth.uid()
    )
  );

INSERT INTO public.vendor_stripe_accounts (
  vendor_id,
  stripe_account_id,
  account_status,
  payouts_enabled,
  requirements_due
)
SELECT
  id,
  stripe_account_id,
  CASE WHEN payout_enabled THEN 'active' ELSE 'pending' END,
  COALESCE(payout_enabled, false),
  '{}'::jsonb
FROM public.vendor_profiles
WHERE stripe_account_id IS NOT NULL
ON CONFLICT (vendor_id) DO NOTHING;

GRANT ALL ON TABLE public.vendor_stripe_accounts TO anon;
GRANT ALL ON TABLE public.vendor_stripe_accounts TO authenticated;
GRANT ALL ON TABLE public.vendor_stripe_accounts TO service_role;
