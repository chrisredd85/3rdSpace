-- Migration: Add discovery venue catalog and outreach signals
-- Created: 2026-06-01
-- Context: Phase 2 expands agentic outreach beyond onboarded venue rows
-- while preserving the approval-gated Gmail send loop from Phase 1.

CREATE TABLE IF NOT EXISTS public.discovery_venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  neighborhood TEXT,
  city TEXT NOT NULL DEFAULT 'San Francisco',
  state TEXT NOT NULL DEFAULT 'CA',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  contact_email TEXT,
  contact_phone TEXT,
  website TEXT,
  instagram_handle TEXT,
  capacity_seated INTEGER,
  capacity_standing INTEGER,
  capacity_cocktail INTEGER,
  vibe_tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  alcohol_policy TEXT,
  av_available BOOLEAN,
  parking_notes TEXT,
  price_hint_cents_low INTEGER,
  price_hint_cents_high INTEGER,
  price_hint_note TEXT,
  source TEXT NOT NULL DEFAULT 'manual_seed',
  source_external_id TEXT,
  google_rating NUMERIC(2,1),
  google_user_ratings_total INTEGER,
  google_photo_names TEXT[] NOT NULL DEFAULT '{}'::text[],
  opening_hours_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_enriched_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  is_claimed BOOLEAN NOT NULL DEFAULT false,
  claimed_venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT discovery_venues_source_check
    CHECK (source IN ('google_places', 'manual_seed', 'creator_referral', 'claimed', 'scrape')),
  CONSTRAINT discovery_venues_capacity_seated_check
    CHECK (capacity_seated IS NULL OR capacity_seated >= 0),
  CONSTRAINT discovery_venues_capacity_standing_check
    CHECK (capacity_standing IS NULL OR capacity_standing >= 0),
  CONSTRAINT discovery_venues_capacity_cocktail_check
    CHECK (capacity_cocktail IS NULL OR capacity_cocktail >= 0),
  CONSTRAINT discovery_venues_price_low_check
    CHECK (price_hint_cents_low IS NULL OR price_hint_cents_low >= 0),
  CONSTRAINT discovery_venues_price_high_check
    CHECK (price_hint_cents_high IS NULL OR price_hint_cents_high >= 0),
  CONSTRAINT discovery_venues_price_range_check
    CHECK (
      price_hint_cents_low IS NULL OR
      price_hint_cents_high IS NULL OR
      price_hint_cents_low <= price_hint_cents_high
    ),
  CONSTRAINT discovery_venues_google_rating_check
    CHECK (google_rating IS NULL OR (google_rating >= 0 AND google_rating <= 5)),
  CONSTRAINT discovery_venues_google_user_ratings_total_check
    CHECK (google_user_ratings_total IS NULL OR google_user_ratings_total >= 0),
  CONSTRAINT discovery_venues_claim_consistency_check
    CHECK (
      (is_claimed = false AND claimed_venue_id IS NULL) OR
      (is_claimed = true AND claimed_venue_id IS NOT NULL)
    )
);

COMMENT ON TABLE public.discovery_venues IS
  'Non-onboarded Bay Area venue discovery catalog used for creator-approved Gmail outreach.';
COMMENT ON COLUMN public.discovery_venues.source_external_id IS
  'Provider id such as a Google Places id. Combined with source for idempotent enrichment/import.';
COMMENT ON COLUMN public.discovery_venues.price_hint_cents_low IS
  'Low estimated venue cost in integer cents.';
COMMENT ON COLUMN public.discovery_venues.price_hint_cents_high IS
  'High estimated venue cost in integer cents.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_venues_source_external_id
  ON public.discovery_venues(source, source_external_id);

CREATE INDEX IF NOT EXISTS idx_discovery_venues_city_neighborhood
  ON public.discovery_venues(city, neighborhood);

CREATE INDEX IF NOT EXISTS idx_discovery_venues_capacity
  ON public.discovery_venues(capacity_standing, capacity_cocktail, capacity_seated);

CREATE INDEX IF NOT EXISTS idx_discovery_venues_last_enriched
  ON public.discovery_venues(last_enriched_at NULLS FIRST, updated_at);

CREATE INDEX IF NOT EXISTS idx_discovery_venues_vibe_tags
  ON public.discovery_venues USING gin(vibe_tags);

CREATE INDEX IF NOT EXISTS idx_discovery_venues_search
  ON public.discovery_venues USING gin(
    to_tsvector(
      'english',
      coalesce(name, '') || ' ' || coalesce(neighborhood, '')
    )
  );

DROP TRIGGER IF EXISTS update_discovery_venues_updated_at ON public.discovery_venues;
CREATE TRIGGER update_discovery_venues_updated_at
  BEFORE UPDATE ON public.discovery_venues
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.outreach_threads
  ADD COLUMN IF NOT EXISTS target_source TEXT NOT NULL DEFAULT 'onboarded',
  ADD COLUMN IF NOT EXISTS discovery_venue_id UUID REFERENCES public.discovery_venues(id) ON DELETE SET NULL;

ALTER TABLE public.outreach_threads
  DROP CONSTRAINT IF EXISTS outreach_threads_target_source_check;
ALTER TABLE public.outreach_threads
  ADD CONSTRAINT outreach_threads_target_source_check
  CHECK (target_source IN ('onboarded', 'discovery'));

COMMENT ON COLUMN public.outreach_threads.target_source IS
  'Whether the thread target came from onboarded venue/vendor supply or discovery catalog.';
COMMENT ON COLUMN public.outreach_threads.discovery_venue_id IS
  'Discovery venue row used to start the outreach thread, preserved after a venue claims the listing.';

CREATE INDEX IF NOT EXISTS idx_outreach_threads_target_source
  ON public.outreach_threads(target_source, discovery_venue_id);

CREATE TABLE IF NOT EXISTS public.discovery_venue_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discovery_venue_id UUID REFERENCES public.discovery_venues(id) ON DELETE CASCADE,
  venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  thread_id UUID REFERENCES public.outreach_threads(id) ON DELETE SET NULL,
  latency_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT discovery_venue_signals_event_type_check
    CHECK (event_type IN ('email_sent', 'reply_received', 'booked', 'declined', 'stale')),
  CONSTRAINT discovery_venue_signals_target_check
    CHECK (discovery_venue_id IS NOT NULL OR venue_id IS NOT NULL),
  CONSTRAINT discovery_venue_signals_latency_check
    CHECK (latency_seconds IS NULL OR latency_seconds >= 0)
);

COMMENT ON TABLE public.discovery_venue_signals IS
  'Response and booking signals used to rank discovery and onboarded venue candidates.';

CREATE INDEX IF NOT EXISTS idx_discovery_venue_signals_discovery_created
  ON public.discovery_venue_signals(discovery_venue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discovery_venue_signals_venue_created
  ON public.discovery_venue_signals(venue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discovery_venue_signals_thread
  ON public.discovery_venue_signals(thread_id);

CREATE TABLE IF NOT EXISTS public.discovery_venue_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discovery_venue_id UUID NOT NULL REFERENCES public.discovery_venues(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.discovery_venue_events IS
  'Audit trail for discovery venue imports, enrichments, claim starts, and completed claims.';

CREATE INDEX IF NOT EXISTS idx_discovery_venue_events_venue_created
  ON public.discovery_venue_events(discovery_venue_id, created_at DESC);

ALTER TABLE public.discovery_venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovery_venue_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovery_venue_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read discovery venues" ON public.discovery_venues;
CREATE POLICY "Authenticated users can read discovery venues"
  ON public.discovery_venues FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage discovery venues" ON public.discovery_venues;
CREATE POLICY "Service role can manage discovery venues"
  ON public.discovery_venues FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Authenticated users can read discovery venue signals" ON public.discovery_venue_signals;
CREATE POLICY "Authenticated users can read discovery venue signals"
  ON public.discovery_venue_signals FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage discovery venue signals" ON public.discovery_venue_signals;
CREATE POLICY "Service role can manage discovery venue signals"
  ON public.discovery_venue_signals FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Service role can manage discovery venue events" ON public.discovery_venue_events;
CREATE POLICY "Service role can manage discovery venue events"
  ON public.discovery_venue_events FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT SELECT ON public.discovery_venues TO authenticated;
GRANT SELECT ON public.discovery_venue_signals TO authenticated;
GRANT ALL ON public.discovery_venues TO service_role;
GRANT ALL ON public.discovery_venue_signals TO service_role;
GRANT ALL ON public.discovery_venue_events TO service_role;
