-- Migration: Add LLM-assisted capacity inference for discovery venues
-- Context: Google Places rarely returns event-capacity data. These fields let
-- the enrichment worker infer conservative capacity from public venue signals
-- and keep human review state before low-confidence values affect ranking.

ALTER TABLE public.discovery_venues
  ADD COLUMN IF NOT EXISTS inferred_capacity_standing INTEGER,
  ADD COLUMN IF NOT EXISTS inferred_capacity_seated INTEGER,
  ADD COLUMN IF NOT EXISTS capacity_inference_confidence REAL,
  ADD COLUMN IF NOT EXISTS capacity_inference_source_quote TEXT,
  ADD COLUMN IF NOT EXISTS capacity_inference_model VARCHAR(64),
  ADD COLUMN IF NOT EXISTS capacity_inference_extracted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capacity_inference_admin_status VARCHAR(20) DEFAULT 'pending';

ALTER TABLE public.discovery_venues
  DROP CONSTRAINT IF EXISTS discovery_venues_inferred_capacity_standing_check,
  DROP CONSTRAINT IF EXISTS discovery_venues_inferred_capacity_seated_check,
  DROP CONSTRAINT IF EXISTS discovery_venues_capacity_inference_confidence_check,
  DROP CONSTRAINT IF EXISTS discovery_venues_capacity_inference_admin_status_check;

ALTER TABLE public.discovery_venues
  ADD CONSTRAINT discovery_venues_inferred_capacity_standing_check
    CHECK (inferred_capacity_standing IS NULL OR inferred_capacity_standing >= 0),
  ADD CONSTRAINT discovery_venues_inferred_capacity_seated_check
    CHECK (inferred_capacity_seated IS NULL OR inferred_capacity_seated >= 0),
  ADD CONSTRAINT discovery_venues_capacity_inference_confidence_check
    CHECK (capacity_inference_confidence IS NULL OR (capacity_inference_confidence >= 0 AND capacity_inference_confidence <= 1)),
  ADD CONSTRAINT discovery_venues_capacity_inference_admin_status_check
    CHECK (capacity_inference_admin_status IN ('pending', 'approved', 'rejected', 'edited'));

CREATE INDEX IF NOT EXISTS idx_discovery_venues_capacity_admin
  ON public.discovery_venues (capacity_inference_admin_status, capacity_inference_confidence, updated_at)
  WHERE capacity_inference_admin_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_app_jobs_infer_venue_capacity
  ON public.app_jobs(job_type, status, scheduled_at)
  WHERE job_type = 'infer_venue_capacity';

COMMENT ON COLUMN public.discovery_venues.inferred_capacity_standing IS
  'Conservative standing/cocktail capacity inferred from public venue signals. Trusted in ranking only when high-confidence or admin-approved.';

COMMENT ON COLUMN public.discovery_venues.inferred_capacity_seated IS
  'Conservative seated capacity inferred from public venue signals. Trusted in ranking only when high-confidence or admin-approved.';

COMMENT ON COLUMN public.discovery_venues.capacity_inference_confidence IS
  '0-1 confidence score emitted by the inference model. Values below 0.7 require admin approval before ranking trust.';

COMMENT ON COLUMN public.discovery_venues.capacity_inference_source_quote IS
  'Short source text or rationale used by the inference model. This is for admin review, not customer-facing copy.';

COMMENT ON COLUMN public.discovery_venues.capacity_inference_admin_status IS
  'Review state for inferred venue capacity: pending, approved, rejected, or edited.';
