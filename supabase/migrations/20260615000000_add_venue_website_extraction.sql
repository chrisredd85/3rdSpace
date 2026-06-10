-- Migration: Add website email extraction fields for discovery venues
-- Created: 2026-06-15
-- Context: additive discovery enrichment metadata only; extraction cron is inactive until separately scheduled.

ALTER TABLE public.discovery_venues
  ADD COLUMN IF NOT EXISTS extracted_emails JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS website_extraction_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS website_extraction_status TEXT
    CHECK (website_extraction_status IS NULL OR website_extraction_status IN (
      'never_attempted',
      'successful',
      'no_emails_found',
      'fetch_failed',
      'blocked_by_robots',
      'rate_limited',
      'timeout'
    )),
  ADD COLUMN IF NOT EXISTS website_extraction_metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS website_extraction_attempts INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_discovery_venues_extraction_pending
  ON public.discovery_venues (website_extraction_attempted_at NULLS FIRST)
  WHERE website IS NOT NULL
    AND website_extraction_status IS DISTINCT FROM 'successful'
    AND website_extraction_status IS DISTINCT FROM 'blocked_by_robots';

COMMENT ON COLUMN public.discovery_venues.extracted_emails IS
  'Array of {email, confidence, source_path, extracted_at, is_likely_booking_contact} extracted from venue website. Populated by venue-website-extractor cron.';

COMMENT ON COLUMN public.discovery_venues.website_extraction_status IS
  'Status of last website extraction attempt. NULL = never attempted.';

COMMENT ON COLUMN public.discovery_venues.website_extraction_metadata IS
  'Structured fetch metadata from venue website email extraction, including attempted paths and errors.';
