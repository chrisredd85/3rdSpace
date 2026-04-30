ALTER TABLE public.builder_profiles
  ADD COLUMN IF NOT EXISTS preferred_ticket_platforms TEXT[] DEFAULT '{}'::text[];

ALTER TABLE public.vendor_profiles
  ADD COLUMN IF NOT EXISTS bank_account_holder_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS availability_notes TEXT;
