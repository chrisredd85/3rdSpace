-- Migration: Persist website contact-form fallbacks for discovered supply.
-- Context: Some venues and vendors expose a private-events or catering request
-- form instead of a direct email. Store those links so the planner can show the
-- organizer what the crawler found before outreach, without auto-submitting.

ALTER TABLE public.discovery_venues
  ADD COLUMN IF NOT EXISTS extracted_contact_forms JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.discovery_venues.extracted_contact_forms IS
  'Website contact/request forms found by crawler. Format: array of { url, label, source_path, extracted_at, confidence, is_likely_booking_contact }. Used as manual fallback when no email is available.';

CREATE INDEX IF NOT EXISTS idx_discovery_venues_has_contact_forms
  ON public.discovery_venues (id)
  WHERE jsonb_array_length(extracted_contact_forms) > 0;

ALTER TABLE public.discovery_vendors
  ADD COLUMN IF NOT EXISTS extracted_contact_forms JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.discovery_vendors.extracted_contact_forms IS
  'Website contact/request forms found by crawler. Format: array of { url, label, source_path, extracted_at, confidence, is_likely_booking_contact }. Used as manual fallback when no email is available.';

CREATE INDEX IF NOT EXISTS idx_discovery_vendors_has_contact_forms
  ON public.discovery_vendors (id)
  WHERE jsonb_array_length(extracted_contact_forms) > 0;
