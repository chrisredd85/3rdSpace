ALTER TABLE public.vendor_profiles
  ADD COLUMN IF NOT EXISTS portfolio_url text,
  ADD COLUMN IF NOT EXISTS lead_time_days integer,
  ADD COLUMN IF NOT EXISTS emergency_available boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS emergency_rate_uplift numeric(5,2),
  ADD COLUMN IF NOT EXISTS cancellation_terms text;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS cancellation_terms text,
  ADD COLUMN IF NOT EXISTS available_days text[],
  ADD COLUMN IF NOT EXISTS open_from time,
  ADD COLUMN IF NOT EXISTS open_to time,
  ADD COLUMN IF NOT EXISTS loading_address text,
  ADD COLUMN IF NOT EXISTS prep_time_hours integer;
