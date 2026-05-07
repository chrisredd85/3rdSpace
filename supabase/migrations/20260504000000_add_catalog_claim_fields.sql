-- Migration: Add claim fields to venues and vendor_profiles for admin-seeded catalog model
-- Created: 2026-05-04
-- Context: Venues and vendors are now admin-seeded. They do not self-signup.
-- Owners claim their listing later via email link triggered by a host interaction.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS contact_email       text,
  ADD COLUMN IF NOT EXISTS is_claimed          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS claimed_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_admin_seeded     boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.venues.contact_email     IS 'Internal only. Used to send claim email. Never shown to hosts.';
COMMENT ON COLUMN public.venues.is_claimed        IS 'False = unclaimed admin listing. True = owner has created account and claimed it.';
COMMENT ON COLUMN public.venues.claimed_user_id   IS 'auth.users.id linked after owner claims listing. NULL until claimed.';
COMMENT ON COLUMN public.venues.is_admin_seeded   IS 'True when inserted by admin catalog API, not owner self-serve.';

ALTER TABLE public.vendor_profiles
  ADD COLUMN IF NOT EXISTS contact_email       text,
  ADD COLUMN IF NOT EXISTS is_claimed          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS claimed_user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_admin_seeded     boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.vendor_profiles.contact_email     IS 'Internal only. Used to send claim email. Never shown to hosts.';
COMMENT ON COLUMN public.vendor_profiles.is_claimed        IS 'False = unclaimed admin listing. True = vendor has claimed it.';
COMMENT ON COLUMN public.vendor_profiles.claimed_user_id   IS 'auth.users.id linked after vendor claims listing.';
COMMENT ON COLUMN public.vendor_profiles.is_admin_seeded   IS 'True when inserted by admin catalog API.';

-- No RLS changes needed. Existing authenticated-read policies cover catalog browsing.
-- Claim enforcement is at the API layer, not DB layer.
