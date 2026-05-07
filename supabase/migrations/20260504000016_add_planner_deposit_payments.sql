-- Migration: Add planner deposit payment authorization flow
-- Created: 2026-05-04
-- Context: Agent Planner deposits require explicit user authorization before
-- Stripe authorization, then a separate explicit capture before funds are charged.

CREATE TABLE IF NOT EXISTS public.payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  approval_id UUID NOT NULL REFERENCES public.approvals(id) ON DELETE RESTRICT,
  partner_kind TEXT NOT NULL,
  partner_id UUID NOT NULL,
  amount_cents INTEGER NOT NULL, -- stored as integer cents
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'requested',
  stripe_payment_intent_id TEXT UNIQUE,
  authorized_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ,
  refund_terms TEXT NOT NULL DEFAULT 'Refundable up to 7 days before the event unless partner terms override.',
  platform_fee_cents INTEGER NOT NULL DEFAULT 0, -- stored as integer cents
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_intents_partner_kind_check
    CHECK (partner_kind IN ('venue', 'vendor')),
  CONSTRAINT payment_intents_status_check
    CHECK (status IN ('requested', 'authorized', 'captured', 'refunded', 'failed')),
  CONSTRAINT payment_intents_amount_cents_check
    CHECK (amount_cents >= 0),
  CONSTRAINT payment_intents_platform_fee_cents_check
    CHECK (platform_fee_cents >= 0)
);

CREATE TABLE IF NOT EXISTS public.payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id UUID NOT NULL REFERENCES public.payment_intents(id) ON DELETE CASCADE,
  partner_kind TEXT NOT NULL,
  partner_id UUID NOT NULL,
  amount_cents INTEGER NOT NULL, -- stored as integer cents
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'pending',
  stripe_payout_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payouts_partner_kind_check
    CHECK (partner_kind IN ('venue', 'vendor')),
  CONSTRAINT payouts_status_check
    CHECK (status IN ('pending', 'queued', 'paid', 'failed', 'cancelled')),
  CONSTRAINT payouts_amount_cents_check
    CHECK (amount_cents >= 0)
);

COMMENT ON TABLE public.payment_intents IS
  'Planner partner deposit records. Stripe manual capture is used when configured.';
COMMENT ON COLUMN public.payment_intents.status IS
  'requested = local request exists, authorized = card authorization held, captured = explicit capture completed.';
COMMENT ON COLUMN public.payment_intents.refund_terms IS
  'Host-visible refund terms captured at authorization time.';

CREATE INDEX IF NOT EXISTS idx_payment_intents_plan_id
  ON public.payment_intents(plan_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_approval_id
  ON public.payment_intents(approval_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status
  ON public.payment_intents(status);
CREATE INDEX IF NOT EXISTS idx_payouts_payment_intent_id
  ON public.payouts(payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payouts_partner
  ON public.payouts(partner_kind, partner_id);

DROP TRIGGER IF EXISTS update_payment_intents_updated_at
  ON public.payment_intents;
CREATE TRIGGER update_payment_intents_updated_at
  BEFORE UPDATE ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_payouts_updated_at
  ON public.payouts;
CREATE TRIGGER update_payouts_updated_at
  BEFORE UPDATE ON public.payouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builders can read own planner payment intents"
  ON public.payment_intents;
CREATE POLICY "Builders can read own planner payment intents"
  ON public.payment_intents
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.plans plan
      WHERE plan.id = payment_intents.plan_id
        AND plan.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Builders can insert own planner payment intents"
  ON public.payment_intents;
CREATE POLICY "Builders can insert own planner payment intents"
  ON public.payment_intents
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.plans plan
      WHERE plan.id = payment_intents.plan_id
        AND plan.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Builders can read own planner payouts"
  ON public.payouts;
CREATE POLICY "Builders can read own planner payouts"
  ON public.payouts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.payment_intents intent
      JOIN public.plans plan ON plan.id = intent.plan_id
      WHERE intent.id = payouts.payment_intent_id
        AND plan.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage planner payment intents"
  ON public.payment_intents;
CREATE POLICY "Service role can manage planner payment intents"
  ON public.payment_intents
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Service role can manage planner payouts"
  ON public.payouts;
CREATE POLICY "Service role can manage planner payouts"
  ON public.payouts
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT SELECT, INSERT ON public.payment_intents TO authenticated;
GRANT SELECT ON public.payouts TO authenticated;
GRANT ALL ON public.payment_intents TO service_role;
GRANT ALL ON public.payouts TO service_role;
