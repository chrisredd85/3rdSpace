-- Migration: Add inferred capacity fields for discovery venues
-- Created: 2026-06-24
-- Context: Google Places does not expose venue capacity. Persist one conservative
-- LLM-assisted estimate per discovery venue so ranking can use approved or
-- high-confidence capacity without re-calling the model at plan time.

ALTER TABLE public.discovery_venues
  ADD COLUMN IF NOT EXISTS inferred_capacity_standing INTEGER,
  ADD COLUMN IF NOT EXISTS inferred_capacity_seated INTEGER,
  ADD COLUMN IF NOT EXISTS capacity_inference_confidence REAL,
  ADD COLUMN IF NOT EXISTS capacity_inference_source_quote TEXT,
  ADD COLUMN IF NOT EXISTS capacity_inference_model VARCHAR(64),
  ADD COLUMN IF NOT EXISTS capacity_inference_extracted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capacity_inference_admin_status VARCHAR(20) DEFAULT 'pending',
  ADD CONSTRAINT discovery_venues_inferred_capacity_standing_check
    CHECK (inferred_capacity_standing IS NULL OR inferred_capacity_standing >= 0),
  ADD CONSTRAINT discovery_venues_inferred_capacity_seated_check
    CHECK (inferred_capacity_seated IS NULL OR inferred_capacity_seated >= 0),
  ADD CONSTRAINT discovery_venues_capacity_inference_confidence_check
    CHECK (capacity_inference_confidence IS NULL OR (capacity_inference_confidence >= 0 AND capacity_inference_confidence <= 1)),
  ADD CONSTRAINT discovery_venues_capacity_inference_admin_status_check
    CHECK (capacity_inference_admin_status IN ('pending', 'approved', 'rejected', 'edited'));

COMMENT ON COLUMN public.discovery_venues.inferred_capacity_standing IS
  'Conservative standing-capacity estimate inferred from Places metadata and optional website context.';
COMMENT ON COLUMN public.discovery_venues.inferred_capacity_seated IS
  'Conservative seated-capacity estimate inferred from Places metadata and optional website context.';
COMMENT ON COLUMN public.discovery_venues.capacity_inference_confidence IS
  'Model confidence from 0 to 1. Ranking may use high-confidence inference before admin review.';
COMMENT ON COLUMN public.discovery_venues.capacity_inference_source_quote IS
  'Short evidence quote supporting the inferred capacity, when available.';
COMMENT ON COLUMN public.discovery_venues.capacity_inference_model IS
  'Model identifier used for the capacity inference.';
COMMENT ON COLUMN public.discovery_venues.capacity_inference_extracted_at IS
  'Timestamp proving the one-time inference has already run for this discovery venue.';
COMMENT ON COLUMN public.discovery_venues.capacity_inference_admin_status IS
  'Admin review state for inferred venue capacity: pending, approved, rejected, or edited.';

CREATE INDEX IF NOT EXISTS idx_discovery_venues_capacity_admin
  ON public.discovery_venues(capacity_inference_admin_status)
  WHERE capacity_inference_admin_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_discovery_venues_capacity_uninferred
  ON public.discovery_venues(updated_at)
  WHERE capacity_inference_extracted_at IS NULL;
