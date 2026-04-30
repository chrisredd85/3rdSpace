-- ============================================================================
-- UPDATE BUILDER BILLING PRICING
-- Keeps existing environments aligned with the current Stripe price points:
-- $30 pay-per-event, $69/month Pro, $690/year Pro.
-- ============================================================================

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS plan_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.subscription_plans
SET
  plan_type = COALESCE(plan_type, slug),
  price = COALESCE(price, amount::numeric / 100),
  updated_at = NOW()
WHERE plan_type IS NULL
   OR price IS NULL;

UPDATE public.subscription_plans
SET
  amount = 3000,
  price = 30.00,
  description = 'One event access credit for casual builders.',
  updated_at = NOW()
WHERE slug = 'pay_per_event'
   OR plan_type = 'pay_per_event';

UPDATE public.subscription_plans
SET
  amount = 6900,
  price = 69.00,
  description = 'Unlimited events for active builders.',
  updated_at = NOW()
WHERE slug = 'pro_monthly'
   OR plan_type = 'pro_monthly';

UPDATE public.subscription_plans
SET
  amount = 69000,
  price = 690.00,
  description = 'Unlimited events with two months free on annual billing.',
  features = COALESCE(features, '{}'::jsonb) || '{"savings": "2 months free"}'::jsonb,
  updated_at = NOW()
WHERE slug = 'pro_annual'
   OR plan_type = 'pro_annual';

CREATE OR REPLACE FUNCTION public.calculate_builder_savings(p_builder_id UUID, p_month DATE)
RETURNS NUMERIC AS $$
DECLARE
  v_events_count INTEGER;
  v_pay_per_event_cost NUMERIC;
  v_pro_monthly_cost NUMERIC := 69.00;
  v_savings NUMERIC;
BEGIN
  SELECT events_booked INTO v_events_count
  FROM public.builder_event_usage
  WHERE builder_id = p_builder_id AND month = p_month;

  v_pay_per_event_cost := COALESCE(v_events_count, 0) * 30.00;
  v_savings := v_pay_per_event_cost - v_pro_monthly_cost;

  IF v_savings > 0 THEN
    RETURN v_savings;
  END IF;

  RETURN 0;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.increment_event_usage(
  p_builder_id UUID,
  p_month DATE,
  p_fee_paid NUMERIC
)
RETURNS VOID AS $$
DECLARE
  v_events_booked INTEGER;
  v_total_fees_paid NUMERIC;
  v_could_have_saved NUMERIC;
BEGIN
  INSERT INTO public.builder_event_usage (builder_id, month, events_booked, total_fees_paid, could_have_saved)
  VALUES (
    p_builder_id,
    p_month,
    1,
    COALESCE(p_fee_paid, 0),
    GREATEST(30.00 - 69.00, 0)
  )
  ON CONFLICT (builder_id, month)
  DO UPDATE SET
    events_booked = public.builder_event_usage.events_booked + 1,
    total_fees_paid = public.builder_event_usage.total_fees_paid + COALESCE(p_fee_paid, 0);

  SELECT events_booked, total_fees_paid
  INTO v_events_booked, v_total_fees_paid
  FROM public.builder_event_usage
  WHERE builder_id = p_builder_id AND month = p_month;

  v_could_have_saved := GREATEST((COALESCE(v_events_booked, 0) * 30.00) - 69.00, 0);

  UPDATE public.builder_event_usage
  SET could_have_saved = v_could_have_saved
  WHERE builder_id = p_builder_id AND month = p_month;
END;
$$ LANGUAGE plpgsql;
