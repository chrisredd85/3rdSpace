-- Migration: CHI settlement checkout ledger and venue acknowledgement tokens
-- Created: 2026-06-18
-- Context: Phase epsilon.3 moves CHI settlement from organizer approval to
-- venue acknowledgement, Stripe Checkout payment, and settlement ledger writes.

ALTER TABLE public.settlement_runs
  DROP CONSTRAINT IF EXISTS settlement_runs_status_check;

ALTER TABLE public.settlement_runs
  ADD CONSTRAINT settlement_runs_status_check CHECK (status IN (
    'pending',
    'awaiting_attendance',
    'awaiting_organizer_review',
    'awaiting_venue_ack',
    'awaiting_venue_payment',
    'ready_to_settle',
    'settled',
    'disputed',
    'cancelled'
  ));

COMMENT ON TABLE public.settlement_runs IS
  'Per-event CHI settlement records. State machine: pending -> awaiting_attendance -> awaiting_organizer_review -> awaiting_venue_ack -> awaiting_venue_payment -> settled, with dispute/admin resolution branches.';

ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS approval_type TEXT,
  ADD COLUMN IF NOT EXISTS settlement_run_id UUID REFERENCES public.settlement_runs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.approvals.approval_type IS
  'Machine-readable approval category used by settlement and execution invariants.';
COMMENT ON COLUMN public.approvals.settlement_run_id IS
  'Settlement run authorized by this approval when approval_type = chi_settlement.';

CREATE INDEX IF NOT EXISTS approvals_settlement_run_type_status
  ON public.approvals(settlement_run_id, approval_type, status)
  WHERE settlement_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.venue_settlement_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_run_id UUID NOT NULL REFERENCES public.settlement_runs(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  venue_email TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  first_viewed_at TIMESTAMPTZ,
  last_viewed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT venue_settlement_tokens_expires_check CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS venue_settlement_tokens_one_per_run
  ON public.venue_settlement_tokens(settlement_run_id);

CREATE INDEX IF NOT EXISTS venue_settlement_tokens_lookup
  ON public.venue_settlement_tokens(token_hash);

COMMENT ON TABLE public.venue_settlement_tokens IS
  'One active venue-facing acknowledgement/payment token per CHI settlement run. Raw token values are never stored.';

CREATE TABLE IF NOT EXISTS public.settlement_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_run_id UUID NOT NULL REFERENCES public.settlement_runs(id) ON DELETE RESTRICT,
  approval_id UUID REFERENCES public.approvals(id) ON DELETE SET NULL,
  organizer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  venue_id UUID NOT NULL,
  amount_cents INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  organizer_payout_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'checkout_created',
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_transfer_id TEXT,
  stripe_connected_account_id TEXT,
  checkout_url TEXT,
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  transfer_completed_at TIMESTAMPTZ,
  trueup_processed_at TIMESTAMPTZ,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT settlement_charges_amounts_check CHECK (
    amount_cents > 0 AND
    platform_fee_cents >= 0 AND
    organizer_payout_cents >= 0 AND
    organizer_payout_cents + platform_fee_cents = amount_cents
  ),
  CONSTRAINT settlement_charges_status_check CHECK (
    status IN ('checkout_created', 'paid', 'failed', 'cancelled')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS settlement_charges_one_active_per_run
  ON public.settlement_charges(settlement_run_id)
  WHERE status IN ('checkout_created', 'paid');

CREATE INDEX IF NOT EXISTS settlement_charges_run
  ON public.settlement_charges(settlement_run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS settlement_charges_payment_intent
  ON public.settlement_charges(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

COMMENT ON TABLE public.settlement_charges IS
  'Stripe Checkout charge ledger for CHI settlements. Venues pay through Checkout; organizers receive funds through their Connect account.';

DROP TRIGGER IF EXISTS update_venue_settlement_tokens_updated_at ON public.venue_settlement_tokens;
CREATE TRIGGER update_venue_settlement_tokens_updated_at
  BEFORE UPDATE ON public.venue_settlement_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_settlement_charges_updated_at ON public.settlement_charges;
CREATE TRIGGER update_settlement_charges_updated_at
  BEFORE UPDATE ON public.settlement_charges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.venue_settlement_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages venue settlement tokens" ON public.venue_settlement_tokens;
CREATE POLICY "Service role manages venue settlement tokens"
  ON public.venue_settlement_tokens FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Service role manages settlement charges" ON public.settlement_charges;
CREATE POLICY "Service role manages settlement charges"
  ON public.settlement_charges FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Organizers read own settlement charges" ON public.settlement_charges;
CREATE POLICY "Organizers read own settlement charges"
  ON public.settlement_charges FOR SELECT
  USING (auth.uid() = organizer_id);

GRANT ALL ON public.venue_settlement_tokens TO service_role;
GRANT ALL ON public.settlement_charges TO service_role;
GRANT SELECT ON public.settlement_charges TO authenticated;
