-- ============================================================================
-- VENUE UNIQUE FEATURES
-- ============================================================================

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS unique_features TEXT,
  ADD COLUMN IF NOT EXISTS unique_features_tags TEXT[] DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_venues_unique_features_tags
  ON public.venues USING GIN (unique_features_tags);
