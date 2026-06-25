-- Migration: CHI true-up manual review and observability
-- Created: 2026-06-24
-- Context: Caps per-update CHI rate movement. Proposed rates above the cap
-- are queued for admin review instead of being applied automatically.

ALTER TABLE public.chi_rate_history
  ADD COLUMN IF NOT EXISTS movement_pct REAL,
  ADD COLUMN IF NOT EXISTS movement_bucket TEXT;

COMMENT ON COLUMN public.chi_rate_history.movement_pct IS
  'Absolute percentage movement from the prior current CHI rate to this new rate. Null when no prior rate exists.';
COMMENT ON COLUMN public.chi_rate_history.movement_bucket IS
  'Observability bucket for true-up movement: <1%, 1-5%, 5-20%, >20%, or no-current-rate.';

CREATE TABLE IF NOT EXISTS public.chi_trueup_manual_review (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  archetype VARCHAR(64) NOT NULL,
  venue_type VARCHAR(64) NOT NULL,
  current_rate_cents INTEGER NOT NULL,
  proposed_rate_cents INTEGER NOT NULL,
  applied_rate_cents INTEGER,
  movement_pct REAL NOT NULL,
  movement_bucket TEXT NOT NULL,
  derived_from_event_count INTEGER NOT NULL DEFAULT 0,
  triggering_settlement_run_id UUID REFERENCES public.settlement_runs(id) ON DELETE SET NULL,
  reason VARCHAR(64) NOT NULL,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  applied BOOLEAN NOT NULL DEFAULT false,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chi_trueup_manual_review_current_rate_check CHECK (current_rate_cents >= 0),
  CONSTRAINT chi_trueup_manual_review_proposed_rate_check CHECK (proposed_rate_cents >= 0),
  CONSTRAINT chi_trueup_manual_review_applied_rate_check CHECK (applied_rate_cents IS NULL OR applied_rate_cents >= 0),
  CONSTRAINT chi_trueup_manual_review_movement_check CHECK (movement_pct >= 0),
  CONSTRAINT chi_trueup_manual_review_count_check CHECK (derived_from_event_count >= 0),
  CONSTRAINT chi_trueup_manual_review_reason_check CHECK (reason IN ('movement_cap_exceeded')),
  CONSTRAINT chi_trueup_manual_review_bucket_check CHECK (movement_bucket IN ('<1%', '1-5%', '5-20%', '>20%', 'no-current-rate')),
  CONSTRAINT chi_trueup_manual_review_review_state_check CHECK (
    (reviewed_at IS NULL AND reviewed_by IS NULL AND applied_rate_cents IS NULL AND applied = false)
    OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  )
);

COMMENT ON TABLE public.chi_trueup_manual_review IS
  'Append-only queue for CHI rate true-up proposals that exceed the configured movement cap. Admin review is required before a proposed rate can become current.';
COMMENT ON COLUMN public.chi_trueup_manual_review.current_rate_cents IS
  'Current CHI rate in integer cents per attendee at the time the cap was exceeded.';
COMMENT ON COLUMN public.chi_trueup_manual_review.proposed_rate_cents IS
  'Computed CHI rate in integer cents per attendee that exceeded the automatic movement cap.';
COMMENT ON COLUMN public.chi_trueup_manual_review.applied_rate_cents IS
  'Admin-approved or admin-adjusted CHI rate in integer cents per attendee. Null when rejected or still pending.';

CREATE INDEX IF NOT EXISTS idx_chi_trueup_manual_review_pending
  ON public.chi_trueup_manual_review(created_at ASC)
  WHERE reviewed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chi_trueup_manual_review_settlement_run
  ON public.chi_trueup_manual_review(triggering_settlement_run_id)
  WHERE triggering_settlement_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chi_trueup_manual_review_venue
  ON public.chi_trueup_manual_review(venue_id, created_at DESC);

ALTER TABLE public.chi_trueup_manual_review ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages CHI true-up manual review"
  ON public.chi_trueup_manual_review;
CREATE POLICY "Service role manages CHI true-up manual review"
  ON public.chi_trueup_manual_review
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Organizers read own CHI true-up reviews"
  ON public.chi_trueup_manual_review;
CREATE POLICY "Organizers read own CHI true-up reviews"
  ON public.chi_trueup_manual_review
  FOR SELECT
  USING (auth.uid() = organizer_id);

GRANT SELECT ON public.chi_trueup_manual_review TO authenticated;
GRANT ALL ON public.chi_trueup_manual_review TO service_role;
