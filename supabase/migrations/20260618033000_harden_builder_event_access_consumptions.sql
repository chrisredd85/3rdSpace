-- Migration: Harden builder event access consumption ledger
-- Created: 2026-06-18
-- Context: The P0 concurrency guard created the idempotency ledger. This
-- follow-up keeps that single source of truth and adds metadata for diagnostics
-- while preserving the unique (builder_id, event_id) guarantee.

ALTER TABLE public.builder_event_access_consumptions
  ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS builder_event_access_consumptions_builder_event_key
ON public.builder_event_access_consumptions (builder_id, event_id);

COMMENT ON TABLE public.builder_event_access_consumptions IS
'Idempotency ledger for builder event access consumption. One builder can consume access for a plan/event exactly once; consumeBuilderEventAccess checks this table before any free-event or paid-credit mutation.';

COMMENT ON COLUMN public.builder_event_access_consumptions.source_metadata IS
'Diagnostic metadata for the consumed access source, such as subscription id. No billing counter is stored here.';

CREATE OR REPLACE FUNCTION public.consume_builder_event_access(
  p_builder_id UUID,
  p_event_id UUID,
  p_default_free_events_granted INTEGER DEFAULT 2,
  p_pay_per_event_amount_cents INTEGER DEFAULT 3000,
  p_pro_monthly_amount_cents INTEGER DEFAULT 6900
)
RETURNS TABLE (
  id UUID,
  builder_id UUID,
  event_id UUID,
  source TEXT,
  amount INTEGER,
  amount_cents INTEGER,
  source_metadata JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_builder public.builder_profiles%ROWTYPE;
  v_consumption public.builder_event_access_consumptions%ROWTYPE;
  v_free_events_granted INTEGER;
  v_free_events_used INTEGER;
  v_paid_event_credits INTEGER;
  v_source TEXT;
  v_amount_cents INTEGER := 0;
  v_source_metadata JSONB := '{}'::jsonb;
  v_month DATE := date_trunc('month', now())::date;
  v_events_booked INTEGER;
  v_total_fees_paid NUMERIC;
BEGIN
  IF p_default_free_events_granted < 0
    OR p_pay_per_event_amount_cents < 0
    OR p_pro_monthly_amount_cents < 0 THEN
    RAISE EXCEPTION 'builder_billing_invalid_amount'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_builder
  FROM public.builder_profiles
  WHERE builder_profiles.id = p_builder_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'builder_profile_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_consumption
  FROM public.builder_event_access_consumptions existing
  WHERE existing.builder_id = p_builder_id
    AND existing.event_id = p_event_id;

  IF FOUND THEN
    RETURN QUERY SELECT
      v_consumption.id,
      v_consumption.builder_id,
      v_consumption.event_id,
      v_consumption.source,
      v_consumption.amount,
      v_consumption.amount_cents,
      v_consumption.source_metadata,
      v_consumption.created_at,
      v_consumption.updated_at;
    RETURN;
  END IF;

  v_free_events_granted := GREATEST(
    COALESCE(v_builder.free_events_granted, p_default_free_events_granted),
    p_default_free_events_granted
  );
  v_free_events_used := COALESCE(v_builder.free_events_used, 0);
  v_paid_event_credits := COALESCE(v_builder.paid_event_credits, 0);

  IF v_builder.billing_tier IN ('pro_monthly', 'pro_annual')
    AND v_builder.subscription_status = 'active' THEN
    v_source := v_builder.billing_tier;
    v_amount_cents := 0;
    v_source_metadata := jsonb_build_object(
      'subscription_id',
      v_builder.stripe_subscription_id
    );
  ELSIF (v_free_events_granted - v_free_events_used) > 0 THEN
    v_source := 'free_trial';
    v_amount_cents := 0;

    UPDATE public.builder_profiles
    SET
      free_events_used = v_free_events_used + 1,
      updated_at = now()
    WHERE builder_profiles.id = p_builder_id;
  ELSIF v_paid_event_credits > 0 THEN
    v_source := 'pay_per_event';
    v_amount_cents := p_pay_per_event_amount_cents;

    UPDATE public.builder_profiles
    SET
      billing_tier = 'pay_per_event',
      paid_event_credits = v_paid_event_credits - 1,
      updated_at = now()
    WHERE builder_profiles.id = p_builder_id;
  ELSE
    RAISE EXCEPTION 'builder_billing_required'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.builder_event_access_consumptions (
    builder_id,
    event_id,
    source,
    amount,
    amount_cents,
    source_metadata
  )
  VALUES (
    p_builder_id,
    p_event_id,
    v_source,
    FLOOR(v_amount_cents / 100.0)::INTEGER,
    v_amount_cents,
    v_source_metadata
  )
  RETURNING *
  INTO v_consumption;

  INSERT INTO public.builder_event_usage (
    builder_id,
    month,
    events_booked,
    total_fees_paid,
    could_have_saved
  )
  VALUES (
    p_builder_id,
    v_month,
    1,
    v_amount_cents / 100.0,
    GREATEST((p_pay_per_event_amount_cents - p_pro_monthly_amount_cents) / 100.0, 0)
  )
  ON CONFLICT ON CONSTRAINT builder_event_usage_builder_id_month_key
  DO UPDATE SET
    events_booked = public.builder_event_usage.events_booked + 1,
    total_fees_paid = public.builder_event_usage.total_fees_paid + (v_amount_cents / 100.0),
    updated_at = now();

  SELECT events_booked, total_fees_paid
  INTO v_events_booked, v_total_fees_paid
  FROM public.builder_event_usage
  WHERE builder_event_usage.builder_id = p_builder_id
    AND builder_event_usage.month = v_month;

  UPDATE public.builder_event_usage
  SET
    could_have_saved = GREATEST(
      (COALESCE(v_events_booked, 0) * (p_pay_per_event_amount_cents / 100.0))
        - (p_pro_monthly_amount_cents / 100.0),
      0
    ),
    updated_at = now()
  WHERE builder_event_usage.builder_id = p_builder_id
    AND builder_event_usage.month = v_month;

  RETURN QUERY SELECT
    v_consumption.id,
    v_consumption.builder_id,
    v_consumption.event_id,
    v_consumption.source,
    v_consumption.amount,
    v_consumption.amount_cents,
    v_consumption.source_metadata,
    v_consumption.created_at,
    v_consumption.updated_at;
END;
$$;

COMMENT ON FUNCTION public.consume_builder_event_access(UUID, UUID, INTEGER, INTEGER, INTEGER) IS
'Atomically consumes builder event access under a builder row lock and returns the idempotency ledger row. Same-event retries return the existing row; different-event races serialize before free-event or paid-credit counters mutate.';

GRANT EXECUTE ON FUNCTION public.consume_builder_event_access(UUID, UUID, INTEGER, INTEGER, INTEGER)
  TO service_role;

-- Rollback reference:
-- ALTER TABLE public.builder_event_access_consumptions
--   DROP COLUMN IF EXISTS source_metadata;
-- DROP FUNCTION IF EXISTS public.consume_builder_event_access(UUID, UUID, INTEGER, INTEGER, INTEGER);
