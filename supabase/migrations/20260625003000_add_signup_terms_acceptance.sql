-- Migration: Add signup legal acceptance tracking
-- Created: 2026-06-25

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS signup_terms_version VARCHAR(16),
  ADD COLUMN IF NOT EXISTS signup_terms_accepted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.users.signup_terms_version IS
  'Terms of Service and Privacy Policy version accepted during signup.';

COMMENT ON COLUMN public.users.signup_terms_accepted_at IS
  'Timestamp when the user accepted the signup legal agreement.';

