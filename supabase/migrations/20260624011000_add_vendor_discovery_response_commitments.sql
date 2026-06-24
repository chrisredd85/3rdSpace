-- Migration: Vendor discovery parity, outreach responses, and accepted quote snapshots
-- Created: 2026-06-24
-- Context: Extends the existing approval-gated venue discovery flow to vendors
-- and stores replied/accepted terms for planner comparison and brief economics.

CREATE TABLE IF NOT EXISTS public.discovery_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(50) NOT NULL DEFAULT 'google_places',
  source_external_id VARCHAR(255),
  name VARCHAR(255) NOT NULL,
  service_type VARCHAR(50) NOT NULL,
  formatted_address TEXT,
  city VARCHAR(100),
  state VARCHAR(50) DEFAULT 'CA',
  website TEXT,
  phone VARCHAR(50),
  google_place_id VARCHAR(255),
  google_rating REAL,
  google_user_rating_count INTEGER,
  google_price_level TEXT,
  business_status VARCHAR(50),
  place_types JSONB DEFAULT '[]'::jsonb,
  photos JSONB DEFAULT '[]'::jsonb,
  contact_email VARCHAR(255),
  organizer_provided_email VARCHAR(255),
  extracted_emails JSONB DEFAULT '[]'::jsonb,
  website_extraction_status VARCHAR(50) DEFAULT 'never_attempted',
  website_extraction_attempted_at TIMESTAMPTZ,
  website_extraction_attempts INTEGER NOT NULL DEFAULT 0,
  website_extraction_metadata JSONB DEFAULT '{}'::jsonb,
  inferred_hourly_rate_cents INTEGER,
  inferred_package_rate_cents INTEGER,
  inferred_minimum_cents INTEGER,
  rate_inference_confidence REAL,
  rate_inference_source_quote TEXT,
  rate_inference_extracted_at TIMESTAMPTZ,
  rate_inference_model VARCHAR(64),
  rate_inference_admin_status VARCHAR(20) DEFAULT 'pending',
  last_refreshed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT discovery_vendors_source_check
    CHECK (source IN ('google_places', 'manual_seed', 'creator_referral', 'scrape')),
  CONSTRAINT discovery_vendors_rate_admin_status_check
    CHECK (rate_inference_admin_status IN ('pending', 'approved', 'edited', 'rejected')),
  CONSTRAINT discovery_vendors_hourly_rate_check
    CHECK (inferred_hourly_rate_cents IS NULL OR inferred_hourly_rate_cents >= 0),
  CONSTRAINT discovery_vendors_package_rate_check
    CHECK (inferred_package_rate_cents IS NULL OR inferred_package_rate_cents >= 0),
  CONSTRAINT discovery_vendors_minimum_rate_check
    CHECK (inferred_minimum_cents IS NULL OR inferred_minimum_cents >= 0),
  CONSTRAINT discovery_vendors_confidence_check
    CHECK (rate_inference_confidence IS NULL OR (rate_inference_confidence >= 0 AND rate_inference_confidence <= 1)),
  UNIQUE (source, source_external_id)
);

COMMENT ON TABLE public.discovery_vendors IS
  'Non-onboarded vendor discovery catalog used for organizer-approved outreach and quote comparison.';
COMMENT ON COLUMN public.discovery_vendors.inferred_package_rate_cents IS
  'Estimated vendor event/package rate in integer cents. This is not executable pricing until the organizer receives and accepts a quote.';
COMMENT ON COLUMN public.discovery_vendors.rate_inference_admin_status IS
  'Admin review state for AI-inferred vendor rates: pending, approved, edited, or rejected.';

CREATE INDEX IF NOT EXISTS idx_discovery_vendors_service_city
  ON public.discovery_vendors(service_type, city);
CREATE INDEX IF NOT EXISTS idx_discovery_vendors_extraction_pending
  ON public.discovery_vendors(website_extraction_attempted_at NULLS FIRST)
  WHERE website IS NOT NULL
    AND contact_email IS NULL
    AND jsonb_array_length(extracted_emails) = 0
    AND website_extraction_attempts < 3
    AND website_extraction_status IS DISTINCT FROM 'successful'
    AND website_extraction_status IS DISTINCT FROM 'blocked_by_robots';
CREATE INDEX IF NOT EXISTS idx_discovery_vendors_rate_admin
  ON public.discovery_vendors(rate_inference_admin_status)
  WHERE rate_inference_admin_status = 'pending';

DROP TRIGGER IF EXISTS update_discovery_vendors_updated_at ON public.discovery_vendors;
CREATE TRIGGER update_discovery_vendors_updated_at
  BEFORE UPDATE ON public.discovery_vendors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.plan_discovery_vendor_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  discovery_vendor_id UUID NOT NULL REFERENCES public.discovery_vendors(id) ON DELETE CASCADE,
  searched_by_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  search_query TEXT NOT NULL,
  service_type TEXT NOT NULL,
  fit_score INTEGER,
  status TEXT NOT NULL DEFAULT 'candidate',
  dismissed_at TIMESTAMPTZ,
  places_request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  outreach_approval_created_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT plan_discovery_vendor_candidates_status_check
    CHECK (status IN ('candidate', 'dismissed', 'approval_created', 'superseded')),
  CONSTRAINT plan_discovery_vendor_candidates_fit_score_check
    CHECK (fit_score IS NULL OR (fit_score >= 0 AND fit_score <= 100)),
  UNIQUE (plan_id, discovery_vendor_id)
);

COMMENT ON TABLE public.plan_discovery_vendor_candidates IS
  'Plan-scoped vendor discovery candidates. Mirrors plan_discovery_venue_candidates for service-specific outreach.';

CREATE INDEX IF NOT EXISTS idx_plan_discovery_vendor_candidates_plan
  ON public.plan_discovery_vendor_candidates(plan_id, status, fit_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_plan_discovery_vendor_candidates_vendor
  ON public.plan_discovery_vendor_candidates(discovery_vendor_id);

DROP TRIGGER IF EXISTS update_plan_discovery_vendor_candidates_updated_at
  ON public.plan_discovery_vendor_candidates;
CREATE TRIGGER update_plan_discovery_vendor_candidates_updated_at
  BEFORE UPDATE ON public.plan_discovery_vendor_candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.outreach_threads
  ADD COLUMN IF NOT EXISTS discovery_vendor_id UUID REFERENCES public.discovery_vendors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_outreach_threads_discovery_vendor
  ON public.outreach_threads(discovery_vendor_id);

ALTER TABLE public.plan_discovery_venue_candidates
  DROP CONSTRAINT IF EXISTS plan_discovery_venue_candidates_status_check;
ALTER TABLE public.plan_discovery_venue_candidates
  ADD CONSTRAINT plan_discovery_venue_candidates_status_check
  CHECK (status IN ('candidate', 'dismissed', 'approval_created', 'superseded'));

CREATE TABLE IF NOT EXISTS public.venue_outreach_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  discovery_venue_id UUID NOT NULL REFERENCES public.discovery_venues(id) ON DELETE CASCADE,
  outreach_thread_id UUID REFERENCES public.outreach_threads(id) ON DELETE SET NULL,
  gmail_thread_id TEXT,
  classification VARCHAR(50),
  classification_confidence REAL,
  quoted_price_cents INTEGER,
  quoted_deal_model VARCHAR(50),
  availability_confirmed BOOLEAN,
  capacity_confirmed INTEGER,
  conditions JSONB DEFAULT '[]'::jsonb,
  raw_response_excerpt TEXT,
  extracted_at TIMESTAMPTZ DEFAULT now(),
  model VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT venue_outreach_responses_classification_check
    CHECK (classification IS NULL OR classification IN ('yes','no','conditional','quote_received','follow_up_needed','unclear')),
  CONSTRAINT venue_outreach_responses_confidence_check
    CHECK (classification_confidence IS NULL OR (classification_confidence >= 0 AND classification_confidence <= 1)),
  CONSTRAINT venue_outreach_responses_price_check
    CHECK (quoted_price_cents IS NULL OR quoted_price_cents >= 0),
  UNIQUE (plan_id, discovery_venue_id, gmail_thread_id)
);

CREATE TABLE IF NOT EXISTS public.vendor_outreach_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  discovery_vendor_id UUID NOT NULL REFERENCES public.discovery_vendors(id) ON DELETE CASCADE,
  outreach_thread_id UUID REFERENCES public.outreach_threads(id) ON DELETE SET NULL,
  gmail_thread_id TEXT,
  classification VARCHAR(50),
  classification_confidence REAL,
  quoted_hourly_cents INTEGER,
  quoted_package_cents INTEGER,
  quoted_minimum_cents INTEGER,
  quoted_deposit_pct REAL,
  availability_confirmed BOOLEAN,
  conditions JSONB DEFAULT '[]'::jsonb,
  raw_response_excerpt TEXT,
  extracted_at TIMESTAMPTZ DEFAULT now(),
  model VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT vendor_outreach_responses_classification_check
    CHECK (classification IS NULL OR classification IN ('yes','no','conditional','quote_received','follow_up_needed','unclear')),
  CONSTRAINT vendor_outreach_responses_confidence_check
    CHECK (classification_confidence IS NULL OR (classification_confidence >= 0 AND classification_confidence <= 1)),
  CONSTRAINT vendor_outreach_responses_hourly_check
    CHECK (quoted_hourly_cents IS NULL OR quoted_hourly_cents >= 0),
  CONSTRAINT vendor_outreach_responses_package_check
    CHECK (quoted_package_cents IS NULL OR quoted_package_cents >= 0),
  CONSTRAINT vendor_outreach_responses_minimum_check
    CHECK (quoted_minimum_cents IS NULL OR quoted_minimum_cents >= 0),
  CONSTRAINT vendor_outreach_responses_deposit_pct_check
    CHECK (quoted_deposit_pct IS NULL OR (quoted_deposit_pct >= 0 AND quoted_deposit_pct <= 1)),
  UNIQUE (plan_id, discovery_vendor_id, gmail_thread_id)
);

CREATE INDEX IF NOT EXISTS idx_venue_outreach_responses_plan
  ON public.venue_outreach_responses(plan_id, classification, extracted_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_outreach_responses_plan
  ON public.vendor_outreach_responses(plan_id, classification, extracted_at DESC);

DROP TRIGGER IF EXISTS update_venue_outreach_responses_updated_at ON public.venue_outreach_responses;
CREATE TRIGGER update_venue_outreach_responses_updated_at
  BEFORE UPDATE ON public.venue_outreach_responses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_vendor_outreach_responses_updated_at ON public.vendor_outreach_responses;
CREATE TRIGGER update_vendor_outreach_responses_updated_at
  BEFORE UPDATE ON public.vendor_outreach_responses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS committed_venue_id UUID REFERENCES public.discovery_venues(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS committed_venue_quoted_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS committed_venue_quoted_deal_model VARCHAR(50),
  ADD COLUMN IF NOT EXISTS committed_venue_quoted_terms JSONB,
  ADD COLUMN IF NOT EXISTS committed_venue_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS committed_vendors JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.plans.committed_venue_id IS
  'Accepted discovery venue for the current plan. This is a quote snapshot, not a booking or payment execution.';
COMMENT ON COLUMN public.plans.committed_vendors IS
  'Accepted vendor quote snapshots. Shape: array of { vendor_id, service_type, quoted_hourly_cents, quoted_package_cents, quoted_minimum_cents, quoted_deposit_pct, quoted_terms, committed_at }.';

ALTER TABLE public.discovery_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_discovery_vendor_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_outreach_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_outreach_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read discovery vendors" ON public.discovery_vendors;
CREATE POLICY "Authenticated users can read discovery vendors"
  ON public.discovery_vendors FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage discovery vendors" ON public.discovery_vendors;
CREATE POLICY "Service role can manage discovery vendors"
  ON public.discovery_vendors FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Plan owners can read discovery vendor candidates" ON public.plan_discovery_vendor_candidates;
CREATE POLICY "Plan owners can read discovery vendor candidates"
  ON public.plan_discovery_vendor_candidates FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE plans.id = plan_discovery_vendor_candidates.plan_id
        AND plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Plan owners can create discovery vendor candidates" ON public.plan_discovery_vendor_candidates;
CREATE POLICY "Plan owners can create discovery vendor candidates"
  ON public.plan_discovery_vendor_candidates FOR INSERT
  TO authenticated
  WITH CHECK (
    searched_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.plans
      WHERE plans.id = plan_discovery_vendor_candidates.plan_id
        AND plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Plan owners can update discovery vendor candidates" ON public.plan_discovery_vendor_candidates;
CREATE POLICY "Plan owners can update discovery vendor candidates"
  ON public.plan_discovery_vendor_candidates FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE plans.id = plan_discovery_vendor_candidates.plan_id
        AND plans.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE plans.id = plan_discovery_vendor_candidates.plan_id
        AND plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage discovery vendor candidates" ON public.plan_discovery_vendor_candidates;
CREATE POLICY "Service role can manage discovery vendor candidates"
  ON public.plan_discovery_vendor_candidates FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Plan owners can read venue outreach responses" ON public.venue_outreach_responses;
CREATE POLICY "Plan owners can read venue outreach responses"
  ON public.venue_outreach_responses FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE plans.id = venue_outreach_responses.plan_id
        AND plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Plan owners can read vendor outreach responses" ON public.vendor_outreach_responses;
CREATE POLICY "Plan owners can read vendor outreach responses"
  ON public.vendor_outreach_responses FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plans
      WHERE plans.id = vendor_outreach_responses.plan_id
        AND plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage venue outreach responses" ON public.venue_outreach_responses;
CREATE POLICY "Service role can manage venue outreach responses"
  ON public.venue_outreach_responses FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Service role can manage vendor outreach responses" ON public.vendor_outreach_responses;
CREATE POLICY "Service role can manage vendor outreach responses"
  ON public.vendor_outreach_responses FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT SELECT ON public.discovery_vendors TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.plan_discovery_vendor_candidates TO authenticated;
GRANT SELECT ON public.venue_outreach_responses TO authenticated;
GRANT SELECT ON public.vendor_outreach_responses TO authenticated;
GRANT ALL ON public.discovery_vendors TO service_role;
GRANT ALL ON public.plan_discovery_vendor_candidates TO service_role;
GRANT ALL ON public.venue_outreach_responses TO service_role;
GRANT ALL ON public.vendor_outreach_responses TO service_role;
