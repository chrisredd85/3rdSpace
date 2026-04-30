-- ============================================================================
-- VENUE STRIPE CONNECT ACCOUNTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.venue_stripe_accounts (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  owner_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_account_id VARCHAR(255) UNIQUE,
  account_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  charges_enabled BOOLEAN NOT NULL DEFAULT false,
  payouts_enabled BOOLEAN NOT NULL DEFAULT false,
  requirements_due JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT venue_stripe_accounts_status_check
    CHECK (account_status IN ('pending', 'active', 'restricted'))
);

CREATE INDEX IF NOT EXISTS idx_venue_stripe_accounts_owner_id
  ON public.venue_stripe_accounts(owner_id);

CREATE INDEX IF NOT EXISTS idx_venue_stripe_accounts_stripe_account_id
  ON public.venue_stripe_accounts(stripe_account_id);

DROP TRIGGER IF EXISTS update_venue_stripe_accounts_updated_at
  ON public.venue_stripe_accounts;

CREATE TRIGGER update_venue_stripe_accounts_updated_at
  BEFORE UPDATE ON public.venue_stripe_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.venue_stripe_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Venue owners can view own stripe account" ON public.venue_stripe_accounts;
CREATE POLICY "Venue owners can view own stripe account"
  ON public.venue_stripe_accounts
  FOR SELECT
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Venue owners can create own stripe account" ON public.venue_stripe_accounts;
CREATE POLICY "Venue owners can create own stripe account"
  ON public.venue_stripe_accounts
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Venue owners can update own stripe account" ON public.venue_stripe_accounts;
CREATE POLICY "Venue owners can update own stripe account"
  ON public.venue_stripe_accounts
  FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

GRANT ALL ON TABLE public.venue_stripe_accounts TO anon;
GRANT ALL ON TABLE public.venue_stripe_accounts TO authenticated;
GRANT ALL ON TABLE public.venue_stripe_accounts TO service_role;
