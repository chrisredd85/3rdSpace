-- Migration: Make owner_id/user_id nullable to support admin-seeded catalog listings
-- Created: 2026-05-04
-- Context: Admin-seeded venues and vendors have no owner account yet. Owner links
-- via claimed_user_id once they claim their listing. owner_id/user_id become
-- populated only after claiming.

-- VENUES: drop NOT NULL on owner_id
ALTER TABLE public.venues
  ALTER COLUMN owner_id DROP NOT NULL;

COMMENT ON COLUMN public.venues.owner_id IS
  'NULL for admin-seeded unclaimed listings. Populated when venue owner claims listing.';

-- VENDOR PROFILES: drop NOT NULL on user_id
-- Also replace the UNIQUE constraint with a partial unique index that only
-- enforces uniqueness on non-null values (multiple unclaimed rows can have NULL).
ALTER TABLE public.vendor_profiles
  ALTER COLUMN user_id DROP NOT NULL;

-- Drop the old unique constraint (enforces uniqueness including NULLs in some DBs)
ALTER TABLE public.vendor_profiles
  DROP CONSTRAINT IF EXISTS vendor_profiles_user_id_key;

-- Add partial unique index: only one row per user_id when user_id IS NOT NULL
DROP INDEX IF EXISTS public.idx_vendor_profiles_user_id_unique_nonnull;
CREATE UNIQUE INDEX idx_vendor_profiles_user_id_unique_nonnull
  ON public.vendor_profiles (user_id)
  WHERE user_id IS NOT NULL;

COMMENT ON COLUMN public.vendor_profiles.user_id IS
  'NULL for admin-seeded unclaimed listings. Populated when vendor claims listing.';
