-- Migration: Add Supply Scout venue lead staging
-- Created: 2026-06-01
-- Context: Internal acquisition workflow for the first production-ready
-- discovery venue set. Raw address signals stay here until admin approval
-- promotes them into discovery_venues.

CREATE TABLE IF NOT EXISTS public.supply_scout_venue_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  normalized_address TEXT NOT NULL,
  neighborhood TEXT,
  city TEXT NOT NULL DEFAULT 'San Francisco',
  state TEXT NOT NULL DEFAULT 'CA',
  source_platform TEXT NOT NULL,
  source_url TEXT,
  event_title TEXT,
  event_type TEXT,
  evidence_summary TEXT NOT NULL,
  booking_signals TEXT[] NOT NULL DEFAULT '{}'::text[],
  disqualifiers TEXT[] NOT NULL DEFAULT '{}'::text[],
  website TEXT,
  capacity_hint INTEGER,
  price_hint_cents_low INTEGER,
  price_hint_cents_high INTEGER,
  booking_likelihood TEXT NOT NULL DEFAULT 'event_proven_unverified',
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.55,
  review_status TEXT NOT NULL DEFAULT 'needs_review',
  discovery_venue_id UUID REFERENCES public.discovery_venues(id) ON DELETE SET NULL,
  duplicate_of_lead_id UUID REFERENCES public.supply_scout_venue_leads(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT supply_scout_venue_leads_source_platform_check
    CHECK (source_platform IN ('eventbrite', 'posh', 'luma', 'partiful', 'google_search', 'city_source', 'reddit', 'manual', 'other')),
  CONSTRAINT supply_scout_venue_leads_booking_likelihood_check
    CHECK (booking_likelihood IN ('public_bookable', 'commercial_likely_bookable', 'event_proven_unverified', 'not_suitable')),
  CONSTRAINT supply_scout_venue_leads_review_status_check
    CHECK (review_status IN ('needs_review', 'approved', 'rejected', 'duplicate')),
  CONSTRAINT supply_scout_venue_leads_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT supply_scout_venue_leads_capacity_hint_check
    CHECK (capacity_hint IS NULL OR capacity_hint >= 0),
  CONSTRAINT supply_scout_venue_leads_price_low_check
    CHECK (price_hint_cents_low IS NULL OR price_hint_cents_low >= 0),
  CONSTRAINT supply_scout_venue_leads_price_high_check
    CHECK (price_hint_cents_high IS NULL OR price_hint_cents_high >= 0),
  CONSTRAINT supply_scout_venue_leads_price_range_check
    CHECK (
      price_hint_cents_low IS NULL OR
      price_hint_cents_high IS NULL OR
      price_hint_cents_low <= price_hint_cents_high
    )
);

COMMENT ON TABLE public.supply_scout_venue_leads IS
  'Admin-only staging queue for venue/address signals found during Supply Scout research.';
COMMENT ON COLUMN public.supply_scout_venue_leads.source_url IS
  'Public event or venue page used as evidence. Do not store private invite, attendee, or account data.';
COMMENT ON COLUMN public.supply_scout_venue_leads.discovery_venue_id IS
  'Approved production discovery venue created from this staged lead.';
COMMENT ON COLUMN public.supply_scout_venue_leads.metadata IS
  'Additional evidence details, source URLs, and operator notes. Do not store platform credentials or cookies.';

CREATE INDEX IF NOT EXISTS idx_supply_scout_leads_review_status
  ON public.supply_scout_venue_leads(review_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_supply_scout_leads_normalized_address
  ON public.supply_scout_venue_leads(normalized_address);

CREATE INDEX IF NOT EXISTS idx_supply_scout_leads_source
  ON public.supply_scout_venue_leads(source_platform, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_supply_scout_leads_search
  ON public.supply_scout_venue_leads USING gin(
    to_tsvector(
      'english',
      coalesce(name, '') || ' ' ||
      coalesce(address, '') || ' ' ||
      coalesce(neighborhood, '') || ' ' ||
      coalesce(event_type, '') || ' ' ||
      coalesce(evidence_summary, '')
    )
  );

DROP TRIGGER IF EXISTS update_supply_scout_venue_leads_updated_at ON public.supply_scout_venue_leads;
CREATE TRIGGER update_supply_scout_venue_leads_updated_at
  BEFORE UPDATE ON public.supply_scout_venue_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.supply_scout_venue_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage supply scout venue leads"
  ON public.supply_scout_venue_leads;
CREATE POLICY "Service role can manage supply scout venue leads"
  ON public.supply_scout_venue_leads FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT ALL ON public.supply_scout_venue_leads TO service_role;
