-- Migration: CHI rate calculation tables
-- Created: 2026-06-18
-- Context: Phase epsilon.1 supports network-default cold-start rates and
-- per-group measured rates. No money moves until later phases.

CREATE TABLE IF NOT EXISTS public.chi_network_defaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  archetype TEXT NOT NULL,
  venue_type TEXT NOT NULL,
  neighborhood TEXT NOT NULL,
  per_attendee_cents INTEGER NOT NULL,
  sample_size INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'bootstrap',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chi_network_defaults_amount_check CHECK (per_attendee_cents >= 0),
  CONSTRAINT chi_network_defaults_sample_check CHECK (sample_size >= 0),
  CONSTRAINT chi_network_defaults_source_check CHECK (source IN ('bootstrap', 'derived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS chi_network_defaults_unique_key
  ON public.chi_network_defaults (archetype, venue_type, neighborhood);

COMMENT ON TABLE public.chi_network_defaults IS
  'Network-default CHI rates keyed by archetype, venue type, and neighborhood. Used as cold-start rate before a group has its own measured rate. Refined as real data accumulates.';
COMMENT ON COLUMN public.chi_network_defaults.per_attendee_cents IS
  'Default CHI rate in integer cents per attendee.';

DROP TRIGGER IF EXISTS update_chi_network_defaults_updated_at
  ON public.chi_network_defaults;
CREATE TRIGGER update_chi_network_defaults_updated_at
  BEFORE UPDATE ON public.chi_network_defaults
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.chi_rate_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  archetype TEXT NOT NULL,
  venue_type TEXT NOT NULL,
  per_attendee_cents INTEGER NOT NULL,
  derived_from_event_count INTEGER NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chi_rate_history_amount_check CHECK (per_attendee_cents >= 0),
  CONSTRAINT chi_rate_history_count_check CHECK (derived_from_event_count >= 0)
);

CREATE INDEX IF NOT EXISTS chi_rate_history_lookup
  ON public.chi_rate_history (organizer_id, archetype, venue_type, effective_from DESC)
  WHERE superseded_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS chi_rate_history_one_current_per_key
  ON public.chi_rate_history (organizer_id, archetype, venue_type)
  WHERE superseded_at IS NULL;

COMMENT ON TABLE public.chi_rate_history IS
  'Per-group measured CHI rate history. Each row is a snapshot derived from settled events at organizer, archetype, and venue type keys. Superseded rows are retained for audit; current rate is the row where superseded_at is null.';
COMMENT ON COLUMN public.chi_rate_history.per_attendee_cents IS
  'Measured CHI rate in integer cents per attendee.';

ALTER TABLE public.chi_network_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chi_rate_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read network defaults"
  ON public.chi_network_defaults;
CREATE POLICY "Anyone can read network defaults"
  ON public.chi_network_defaults
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Service role manages network defaults"
  ON public.chi_network_defaults;
CREATE POLICY "Service role manages network defaults"
  ON public.chi_network_defaults
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Organizers read own rate history"
  ON public.chi_rate_history;
CREATE POLICY "Organizers read own rate history"
  ON public.chi_rate_history
  FOR SELECT
  USING (auth.uid() = organizer_id);

DROP POLICY IF EXISTS "Service role manages rate history"
  ON public.chi_rate_history;
CREATE POLICY "Service role manages rate history"
  ON public.chi_rate_history
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT SELECT ON public.chi_network_defaults TO authenticated, anon;
GRANT SELECT ON public.chi_rate_history TO authenticated;
GRANT ALL ON public.chi_network_defaults TO service_role;
GRANT ALL ON public.chi_rate_history TO service_role;
