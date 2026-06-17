-- Migration: Add P0 concurrency guards for planner approvals and billing
-- Created: 2026-06-17
-- Context: Prevent duplicate payment authorizations and duplicate builder event
-- access consumption under concurrent approval/payment requests.

-- Enforce one active planner deposit per approval.
-- Backfill safety: if existing duplicate active rows are present, this index
-- creation fails. Do not silently dedupe money-movement rows.
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_one_active_per_approval
ON public.payment_intents (approval_id)
WHERE status IN ('requested', 'authorized', 'captured');

COMMENT ON INDEX public.payment_intents_one_active_per_approval IS
'Enforces exactly one active deposit per approval. Refunded and failed intents do not count toward the constraint, so re-attempt after refund/failure is allowed.';

CREATE TABLE IF NOT EXISTS public.builder_event_access_consumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id UUID NOT NULL REFERENCES public.builder_profiles(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT builder_event_access_consumptions_source_check
    CHECK (source IN ('free_trial', 'pay_per_event', 'pro_monthly', 'pro_annual')),
  CONSTRAINT builder_event_access_consumptions_amount_check
    CHECK (amount >= 0 AND amount_cents >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS builder_event_access_consumptions_builder_event_key
ON public.builder_event_access_consumptions (builder_id, event_id);

COMMENT ON TABLE public.builder_event_access_consumptions IS
'Idempotency ledger for builder event access consumption. One builder can consume access for a plan/event exactly once.';

DROP TRIGGER IF EXISTS update_builder_event_access_consumptions_updated_at
  ON public.builder_event_access_consumptions;
CREATE TRIGGER update_builder_event_access_consumptions_updated_at
  BEFORE UPDATE ON public.builder_event_access_consumptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.builder_event_access_consumptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builders can read own event access consumptions"
  ON public.builder_event_access_consumptions;
CREATE POLICY "Builders can read own event access consumptions"
  ON public.builder_event_access_consumptions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.builder_profiles builder
      WHERE builder.id = builder_event_access_consumptions.builder_id
        AND builder.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage builder event access consumptions"
  ON public.builder_event_access_consumptions;
CREATE POLICY "Service role can manage builder event access consumptions"
  ON public.builder_event_access_consumptions
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT SELECT ON public.builder_event_access_consumptions TO authenticated;
GRANT ALL ON public.builder_event_access_consumptions TO service_role;
