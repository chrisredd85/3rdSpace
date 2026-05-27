-- Migration: Normalize marketplace money columns to integer cents
-- Created: 2026-05-27
-- Context: Phase 0 money unit cleanup before rev-share settlement work.

-- Vendor payment transactions: keep legacy dollar numeric columns during transition,
-- but add canonical integer-cent columns for every amount this flow touches.
ALTER TABLE public.vendor_transactions
  ADD COLUMN IF NOT EXISTS amount_cents integer,
  ADD COLUMN IF NOT EXISTS platform_fee_cents integer,
  ADD COLUMN IF NOT EXISTS stripe_fee_cents integer,
  ADD COLUMN IF NOT EXISTS vendor_payout_cents integer;

UPDATE public.vendor_transactions
SET
  amount_cents = COALESCE(amount_cents, ROUND(amount * 100)::integer),
  platform_fee_cents = COALESCE(platform_fee_cents, ROUND(platform_fee * 100)::integer, 0),
  stripe_fee_cents = COALESCE(stripe_fee_cents, ROUND(stripe_fee * 100)::integer, 0),
  vendor_payout_cents = COALESCE(vendor_payout_cents, ROUND(vendor_payout * 100)::integer, 0)
WHERE amount_cents IS NULL
  OR platform_fee_cents IS NULL
  OR stripe_fee_cents IS NULL
  OR vendor_payout_cents IS NULL;

ALTER TABLE public.vendor_transactions
  ALTER COLUMN amount_cents SET NOT NULL,
  ALTER COLUMN platform_fee_cents SET NOT NULL,
  ALTER COLUMN platform_fee_cents SET DEFAULT 0,
  ALTER COLUMN stripe_fee_cents SET NOT NULL,
  ALTER COLUMN stripe_fee_cents SET DEFAULT 0,
  ALTER COLUMN vendor_payout_cents SET NOT NULL,
  ALTER COLUMN vendor_payout_cents SET DEFAULT 0;

ALTER TABLE public.vendor_transactions
  DROP CONSTRAINT IF EXISTS vendor_transactions_amount_cents_check,
  DROP CONSTRAINT IF EXISTS vendor_transactions_platform_fee_cents_check,
  DROP CONSTRAINT IF EXISTS vendor_transactions_stripe_fee_cents_check,
  DROP CONSTRAINT IF EXISTS vendor_transactions_vendor_payout_cents_check;

ALTER TABLE public.vendor_transactions
  ADD CONSTRAINT vendor_transactions_amount_cents_check
    CHECK (amount_cents >= 0),
  ADD CONSTRAINT vendor_transactions_platform_fee_cents_check
    CHECK (platform_fee_cents >= 0),
  ADD CONSTRAINT vendor_transactions_stripe_fee_cents_check
    CHECK (stripe_fee_cents >= 0),
  ADD CONSTRAINT vendor_transactions_vendor_payout_cents_check
    CHECK (vendor_payout_cents >= 0);

CREATE INDEX IF NOT EXISTS idx_vendor_transactions_amount_cents
  ON public.vendor_transactions(amount_cents);

COMMENT ON COLUMN public.vendor_transactions.amount_cents IS
  'Canonical vendor payment amount in integer cents. Legacy amount is dollars.';
COMMENT ON COLUMN public.vendor_transactions.platform_fee_cents IS
  'Canonical platform fee amount in integer cents. Legacy platform_fee is dollars.';
COMMENT ON COLUMN public.vendor_transactions.stripe_fee_cents IS
  'Canonical Stripe processing fee amount in integer cents. Legacy stripe_fee is dollars.';
COMMENT ON COLUMN public.vendor_transactions.vendor_payout_cents IS
  'Canonical vendor payout amount in integer cents. Legacy vendor_payout is dollars.';

CREATE OR REPLACE FUNCTION public.sync_vendor_transaction_money_units()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.amount_cents IS NULL THEN
    NEW.amount_cents := ROUND(COALESCE(NEW.amount, 0) * 100)::integer;
  END IF;

  IF NEW.platform_fee_cents IS NULL THEN
    NEW.platform_fee_cents := ROUND(COALESCE(NEW.platform_fee, 0) * 100)::integer;
  END IF;

  IF NEW.stripe_fee_cents IS NULL THEN
    NEW.stripe_fee_cents := ROUND(COALESCE(NEW.stripe_fee, 0) * 100)::integer;
  END IF;

  IF NEW.vendor_payout_cents IS NULL THEN
    NEW.vendor_payout_cents := ROUND(COALESCE(NEW.vendor_payout, 0) * 100)::integer;
  END IF;

  NEW.amount := ROUND((NEW.amount_cents::numeric / 100), 2);
  NEW.platform_fee := ROUND((NEW.platform_fee_cents::numeric / 100), 2);
  NEW.stripe_fee := ROUND((NEW.stripe_fee_cents::numeric / 100), 2);
  NEW.vendor_payout := ROUND((NEW.vendor_payout_cents::numeric / 100), 2);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_vendor_transaction_money_units
  ON public.vendor_transactions;

CREATE TRIGGER sync_vendor_transaction_money_units
  BEFORE INSERT OR UPDATE OF
    amount,
    amount_cents,
    platform_fee,
    platform_fee_cents,
    stripe_fee,
    stripe_fee_cents,
    vendor_payout,
    vendor_payout_cents
  ON public.vendor_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_vendor_transaction_money_units();

-- Venue pricing: add cents columns alongside legacy dollar columns. Some legacy
-- fields exist only in application-level DTOs or older hosted schemas, so optional
-- backfills are guarded by information_schema checks.
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS hourly_rate_cents integer,
  ADD COLUMN IF NOT EXISTS daily_rate_cents integer,
  ADD COLUMN IF NOT EXISTS price_per_night_cents integer,
  ADD COLUMN IF NOT EXISTS deposit_amount_cents integer;

UPDATE public.venues
SET hourly_rate_cents = COALESCE(hourly_rate_cents, ROUND(hourly_rate * 100)::integer)
WHERE hourly_rate IS NOT NULL
  AND hourly_rate_cents IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'venues'
      AND column_name = 'daily_rate'
  ) THEN
    EXECUTE $sql$
      UPDATE public.venues
      SET daily_rate_cents = COALESCE(daily_rate_cents, ROUND(daily_rate * 100)::integer)
      WHERE daily_rate IS NOT NULL
        AND daily_rate_cents IS NULL
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'venues'
      AND column_name = 'price_per_night'
  ) THEN
    EXECUTE $sql$
      UPDATE public.venues
      SET price_per_night_cents = COALESCE(price_per_night_cents, ROUND(price_per_night * 100)::integer)
      WHERE price_per_night IS NOT NULL
        AND price_per_night_cents IS NULL
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'venues'
      AND column_name = 'deposit_amount'
  ) THEN
    EXECUTE $sql$
      UPDATE public.venues
      SET deposit_amount_cents = COALESCE(deposit_amount_cents, ROUND(deposit_amount * 100)::integer)
      WHERE deposit_amount IS NOT NULL
        AND deposit_amount_cents IS NULL
    $sql$;
  END IF;
END $$;

UPDATE public.venues
SET per_head_kickback_cents = COALESCE(
  NULLIF(per_head_kickback_cents, 0),
  ROUND(COALESCE(per_head_kickback_amount, per_head_kickback, 0) * 100)::integer,
  0
)
WHERE per_head_kickback_cents = 0
  AND COALESCE(per_head_kickback_amount, per_head_kickback, 0) > 0;

ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS venues_hourly_rate_cents_check,
  DROP CONSTRAINT IF EXISTS venues_daily_rate_cents_check,
  DROP CONSTRAINT IF EXISTS venues_price_per_night_cents_check,
  DROP CONSTRAINT IF EXISTS venues_deposit_amount_cents_check,
  DROP CONSTRAINT IF EXISTS venues_per_head_kickback_cents_check;

ALTER TABLE public.venues
  ADD CONSTRAINT venues_hourly_rate_cents_check
    CHECK (hourly_rate_cents IS NULL OR hourly_rate_cents >= 0),
  ADD CONSTRAINT venues_daily_rate_cents_check
    CHECK (daily_rate_cents IS NULL OR daily_rate_cents >= 0),
  ADD CONSTRAINT venues_price_per_night_cents_check
    CHECK (price_per_night_cents IS NULL OR price_per_night_cents >= 0),
  ADD CONSTRAINT venues_deposit_amount_cents_check
    CHECK (deposit_amount_cents IS NULL OR deposit_amount_cents >= 0),
  ADD CONSTRAINT venues_per_head_kickback_cents_check
    CHECK (per_head_kickback_cents >= 0);

CREATE INDEX IF NOT EXISTS idx_venues_hourly_rate_cents
  ON public.venues(hourly_rate_cents);

CREATE INDEX IF NOT EXISTS idx_venues_growth_path_cents
  ON public.venues(is_published, city, venue_type, standing_capacity, hourly_rate_cents);

COMMENT ON COLUMN public.venues.hourly_rate_cents IS
  'Canonical venue hourly rate in integer cents. Legacy hourly_rate is dollars.';
COMMENT ON COLUMN public.venues.daily_rate_cents IS
  'Canonical venue daily or flat rate in integer cents. Legacy daily_rate, when present, is dollars.';
COMMENT ON COLUMN public.venues.price_per_night_cents IS
  'Canonical signup/listing nightly venue rate in integer cents. Legacy price_per_night, when present, is dollars.';
COMMENT ON COLUMN public.venues.deposit_amount_cents IS
  'Canonical venue deposit amount in integer cents. Legacy deposit_amount is dollars.';
COMMENT ON COLUMN public.venues.per_head_kickback_cents IS
  'Canonical fixed venue kickback in integer cents per confirmed attendee.';

CREATE OR REPLACE FUNCTION public.sync_venue_money_units()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.hourly_rate_cents IS NULL AND NEW.hourly_rate IS NOT NULL THEN
    NEW.hourly_rate_cents := ROUND(NEW.hourly_rate * 100)::integer;
  END IF;

  IF NEW.deposit_amount_cents IS NULL AND NEW.deposit_amount IS NOT NULL THEN
    NEW.deposit_amount_cents := ROUND(NEW.deposit_amount * 100)::integer;
  END IF;

  IF (NEW.per_head_kickback_cents IS NULL OR NEW.per_head_kickback_cents = 0)
    AND COALESCE(NEW.per_head_kickback_amount, NEW.per_head_kickback, 0) > 0 THEN
    NEW.per_head_kickback_cents := ROUND(COALESCE(NEW.per_head_kickback_amount, NEW.per_head_kickback, 0) * 100)::integer;
  END IF;

  IF NEW.hourly_rate_cents IS NOT NULL THEN
    NEW.hourly_rate := ROUND((NEW.hourly_rate_cents::numeric / 100), 2);
  END IF;

  IF NEW.deposit_amount_cents IS NOT NULL THEN
    NEW.deposit_amount := ROUND((NEW.deposit_amount_cents::numeric / 100), 2);
  END IF;

  NEW.per_head_kickback_cents := COALESCE(NEW.per_head_kickback_cents, 0);
  NEW.per_head_kickback_amount := ROUND((NEW.per_head_kickback_cents::numeric / 100), 2);
  NEW.per_head_kickback := ROUND((NEW.per_head_kickback_cents::numeric / 100), 2);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_venue_money_units
  ON public.venues;

CREATE TRIGGER sync_venue_money_units
  BEFORE INSERT OR UPDATE OF
    hourly_rate,
    hourly_rate_cents,
    deposit_amount,
    deposit_amount_cents,
    per_head_kickback,
    per_head_kickback_amount,
    per_head_kickback_cents
  ON public.venues
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_venue_money_units();

-- Down migration reference:
-- DROP TRIGGER IF EXISTS sync_vendor_transaction_money_units ON public.vendor_transactions;
-- DROP FUNCTION IF EXISTS public.sync_vendor_transaction_money_units();
-- DROP TRIGGER IF EXISTS sync_venue_money_units ON public.venues;
-- DROP FUNCTION IF EXISTS public.sync_venue_money_units();
-- ALTER TABLE public.vendor_transactions
--   DROP COLUMN IF EXISTS amount_cents,
--   DROP COLUMN IF EXISTS platform_fee_cents,
--   DROP COLUMN IF EXISTS stripe_fee_cents,
--   DROP COLUMN IF EXISTS vendor_payout_cents;
-- ALTER TABLE public.venues
--   DROP COLUMN IF EXISTS hourly_rate_cents,
--   DROP COLUMN IF EXISTS daily_rate_cents,
--   DROP COLUMN IF EXISTS price_per_night_cents,
--   DROP COLUMN IF EXISTS deposit_amount_cents;
-- DROP INDEX IF EXISTS public.idx_vendor_transactions_amount_cents;
-- DROP INDEX IF EXISTS public.idx_venues_hourly_rate_cents;
-- DROP INDEX IF EXISTS public.idx_venues_growth_path_cents;
