-- Migration: Vendor city policy and discovery freshness tracking
-- Created: 2026-06-26
-- Context: Adds event-city vendor discovery controls and an additive
-- discovery change log so catalog updates can cascade through the plan
-- revision pipeline without bypassing organizer approvals.

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS event_city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS vendor_same_city_required BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS vendor_out_of_city_approved BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vendor_approved_adjacent_cities TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS special_supply_radius_miles INTEGER NOT NULL DEFAULT 100;

COMMENT ON COLUMN public.plans.event_city IS
  'Canonical city derived from planner neighborhood/venue area. Used as the default vendor discovery boundary.';
COMMENT ON COLUMN public.plans.vendor_same_city_required IS
  'When true, normal vendor discovery prefers vendors in the event city unless the organizer explicitly approves widening.';
COMMENT ON COLUMN public.plans.vendor_out_of_city_approved IS
  'Organizer-approved opt-in to adjacent-city vendor recommendations. Set through the plan revision pipeline.';
COMMENT ON COLUMN public.plans.vendor_approved_adjacent_cities IS
  'Adjacent cities the organizer approved for vendor sourcing after a sparse-pool prompt.';
COMMENT ON COLUMN public.plans.special_supply_radius_miles IS
  'Search radius for special-supply events such as yacht charters or private estates. Normal vendors use city boundaries.';

ALTER TABLE public.discovery_venues
  ADD COLUMN IF NOT EXISTS last_places_refresh_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_meaningful_change_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS business_status VARCHAR(50),
  ADD COLUMN IF NOT EXISTS data_freshness_status VARCHAR(32) NOT NULL DEFAULT 'fresh';

ALTER TABLE public.discovery_vendors
  ADD COLUMN IF NOT EXISTS last_places_refresh_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_meaningful_change_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_freshness_status VARCHAR(32) NOT NULL DEFAULT 'fresh';

ALTER TABLE public.discovery_venues
  DROP CONSTRAINT IF EXISTS discovery_venues_data_freshness_status_check;
ALTER TABLE public.discovery_venues
  ADD CONSTRAINT discovery_venues_data_freshness_status_check
  CHECK (data_freshness_status IN ('fresh', 'stale', 'changed', 'under_review', 'closed'));

ALTER TABLE public.discovery_vendors
  DROP CONSTRAINT IF EXISTS discovery_vendors_data_freshness_status_check;
ALTER TABLE public.discovery_vendors
  ADD CONSTRAINT discovery_vendors_data_freshness_status_check
  CHECK (data_freshness_status IN ('fresh', 'stale', 'changed', 'under_review', 'closed'));

CREATE INDEX IF NOT EXISTS idx_discovery_venues_refresh
  ON public.discovery_venues(last_places_refresh_at NULLS FIRST);
CREATE INDEX IF NOT EXISTS idx_discovery_vendors_refresh
  ON public.discovery_vendors(last_places_refresh_at NULLS FIRST);

CREATE TABLE IF NOT EXISTS public.discovery_change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(32) NOT NULL,
  entity_id UUID NOT NULL,
  source VARCHAR(32) NOT NULL,
  field_name VARCHAR(64) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  confidence REAL NOT NULL DEFAULT 1.0,
  source_evidence TEXT,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  applied BOOLEAN NOT NULL DEFAULT false,
  applied_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  review_notes TEXT,
  cascade_impact JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT discovery_change_entity_type_check
    CHECK (entity_type IN ('discovery_venue', 'discovery_vendor')),
  CONSTRAINT discovery_change_source_check
    CHECK (source IN (
      'places_refresh',
      'outreach_extraction',
      'admin_override',
      'vendor_self_update',
      'stripe_account_event',
      'organizer_report'
    )),
  CONSTRAINT discovery_change_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1)
);

COMMENT ON TABLE public.discovery_change_log IS
  'Audit trail for venue/vendor discovery data changes. Applied changes can cascade into plan revisions and refreshed event briefs.';
COMMENT ON COLUMN public.discovery_change_log.cascade_impact IS
  'Structured impact produced by discovery cascade invalidation: invalidated recommendations, flagged commitments, stale outreach, and notifications.';

CREATE INDEX IF NOT EXISTS idx_discovery_change_entity
  ON public.discovery_change_log(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_change_unreviewed
  ON public.discovery_change_log(applied, created_at)
  WHERE applied = false;

ALTER TABLE public.discovery_change_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read discovery change log" ON public.discovery_change_log;
CREATE POLICY "Admins can read discovery change log"
  ON public.discovery_change_log FOR SELECT
  TO authenticated
  USING (
    COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false)
  );

DROP POLICY IF EXISTS "Service role can manage discovery change log" ON public.discovery_change_log;
CREATE POLICY "Service role can manage discovery change log"
  ON public.discovery_change_log FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT SELECT ON public.discovery_change_log TO authenticated;
GRANT ALL ON public.discovery_change_log TO service_role;
