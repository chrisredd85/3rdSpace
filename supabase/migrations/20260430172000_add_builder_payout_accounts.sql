-- ============================================================================
-- BUILDER PAYOUT ACCOUNTS AND KICKBACK PAYMENT RECONCILIATION
-- Builder Connect accounts receive venue kickbacks based on verified attendance.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.builder_stripe_accounts (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  builder_id UUID UNIQUE REFERENCES public.builder_profiles(id) ON DELETE CASCADE,
  stripe_account_id VARCHAR(255) UNIQUE,
  account_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  charges_enabled BOOLEAN NOT NULL DEFAULT false,
  payouts_enabled BOOLEAN NOT NULL DEFAULT false,
  requirements_due JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT builder_stripe_accounts_status_check
    CHECK (account_status IN ('pending', 'active', 'restricted'))
);

CREATE INDEX IF NOT EXISTS idx_builder_stripe_accounts_user_id
  ON public.builder_stripe_accounts(user_id);

CREATE INDEX IF NOT EXISTS idx_builder_stripe_accounts_builder_id
  ON public.builder_stripe_accounts(builder_id);

CREATE INDEX IF NOT EXISTS idx_builder_stripe_accounts_stripe_account_id
  ON public.builder_stripe_accounts(stripe_account_id);

DROP TRIGGER IF EXISTS update_builder_stripe_accounts_updated_at
  ON public.builder_stripe_accounts;

CREATE TRIGGER update_builder_stripe_accounts_updated_at
  BEFORE UPDATE ON public.builder_stripe_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.builder_stripe_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builders can view own stripe account" ON public.builder_stripe_accounts;
CREATE POLICY "Builders can view own stripe account"
  ON public.builder_stripe_accounts
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Builders can create own stripe account" ON public.builder_stripe_accounts;
CREATE POLICY "Builders can create own stripe account"
  ON public.builder_stripe_accounts
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Builders can update own stripe account" ON public.builder_stripe_accounts;
CREATE POLICY "Builders can update own stripe account"
  ON public.builder_stripe_accounts
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE public.kickback_payments
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stripe_transfer_reversal_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_kickback_payments_recipient_id
  ON public.kickback_payments(recipient_id);

CREATE INDEX IF NOT EXISTS idx_kickback_payments_payer_id
  ON public.kickback_payments(payer_id);

CREATE INDEX IF NOT EXISTS idx_kickback_payments_payment_intent
  ON public.kickback_payments(stripe_payment_intent_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kickback_payments_checkout_session
  ON public.kickback_payments(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kickback_payments_transfer_id
  ON public.kickback_payments(stripe_transfer_id);

GRANT ALL ON TABLE public.builder_stripe_accounts TO anon;
GRANT ALL ON TABLE public.builder_stripe_accounts TO authenticated;
GRANT ALL ON TABLE public.builder_stripe_accounts TO service_role;
