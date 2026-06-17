ALTER TABLE public.vendor_profiles
  ADD COLUMN IF NOT EXISTS stripe_skipped_at TIMESTAMPTZ;

COMMENT ON COLUMN public.vendor_profiles.stripe_skipped_at IS
  'Set when a vendor explicitly skipped Stripe Connect during claim or signup. Cleared (set NULL) when they later connect successfully. Used to drive the dashboard reminder banner.';
