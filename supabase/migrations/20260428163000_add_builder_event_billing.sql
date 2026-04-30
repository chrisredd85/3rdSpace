-- ============================================================================
-- BUILDER SUBSCRIPTION & PAYMENT SYSTEM
-- Builder-side access fees only. Vendor payouts remain pass-through with 0%
-- 3rdSpaces platform fee.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE public.builder_profiles
  ADD COLUMN IF NOT EXISTS billing_tier TEXT DEFAULT 'free_trial',
  ADD COLUMN IF NOT EXISTS free_events_granted INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS free_events_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_event_credits INTEGER DEFAULT 0;

ALTER TABLE public.builder_profiles
  DROP CONSTRAINT IF EXISTS builder_profiles_billing_tier_check,
  DROP CONSTRAINT IF EXISTS builder_profiles_free_events_check,
  DROP CONSTRAINT IF EXISTS builder_profiles_paid_event_credits_check,
  DROP CONSTRAINT IF EXISTS builder_profiles_subscription_status_check;

ALTER TABLE public.builder_profiles
  ADD CONSTRAINT builder_profiles_billing_tier_check
    CHECK (billing_tier IN ('free_trial', 'pay_per_event', 'pro_monthly', 'pro_annual')),
  ADD CONSTRAINT builder_profiles_free_events_check
    CHECK (free_events_granted >= 0 AND free_events_used >= 0 AND free_events_used <= free_events_granted),
  ADD CONSTRAINT builder_profiles_paid_event_credits_check
    CHECK (paid_event_credits >= 0),
  ADD CONSTRAINT builder_profiles_subscription_status_check
    CHECK (subscription_status IN ('trial', 'active', 'cancelled', 'past_due', 'trialing', 'incomplete'));

UPDATE public.builder_profiles bp
SET
  free_events_granted = COALESCE(bp.free_events_granted, 1),
  free_events_used = LEAST(COALESCE(bp.free_events_granted, 1), event_counts.event_count),
  paid_event_credits = COALESCE(bp.paid_event_credits, 0),
  billing_tier = COALESCE(bp.billing_tier, 'free_trial'),
  updated_at = NOW()
FROM (
  SELECT builder_id, COUNT(*)::integer AS event_count
  FROM public.events
  GROUP BY builder_id
) event_counts
WHERE event_counts.builder_id = bp.id
  AND COALESCE(bp.free_events_used, 0) = 0;

UPDATE public.builder_profiles
SET
  free_events_granted = COALESCE(free_events_granted, 1),
  free_events_used = COALESCE(free_events_used, 0),
  paid_event_credits = COALESCE(paid_event_credits, 0),
  billing_tier = COALESCE(billing_tier, 'free_trial');

-- Existing baseline tables had a different subscription_plans shape. Keep them
-- compatible while adding the MVP plan fields requested for builder billing.
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS plan_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS plan_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS billing_interval VARCHAR(20);

ALTER TABLE public.subscription_plans
  ALTER COLUMN stripe_price_id DROP NOT NULL;

UPDATE public.subscription_plans
SET
  plan_name = COALESCE(plan_name, name),
  plan_type = COALESCE(plan_type, slug),
  price = COALESCE(price, amount::numeric / 100),
  billing_interval = COALESCE(billing_interval, interval)
WHERE plan_name IS NULL OR plan_type IS NULL OR price IS NULL;

ALTER TABLE public.subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_plan_type_check,
  DROP CONSTRAINT IF EXISTS subscription_plans_billing_interval_check;

ALTER TABLE public.subscription_plans
  ADD CONSTRAINT subscription_plans_plan_type_check
    CHECK (plan_type IN ('pay_per_event', 'pro_monthly', 'pro_annual')),
  ADD CONSTRAINT subscription_plans_billing_interval_check
    CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'year'));

CREATE UNIQUE INDEX IF NOT EXISTS subscription_plans_plan_name_key
  ON public.subscription_plans(plan_name);

INSERT INTO public.subscription_plans (
  name,
  slug,
  description,
  amount,
  currency,
  interval,
  events_per_period,
  features,
  platform_fee_discount,
  stripe_price_id,
  is_active,
  is_featured,
  sort_order,
  plan_name,
  plan_type,
  price,
  billing_interval
) VALUES
  (
    'Pay Per Event',
    'pay_per_event',
    'One event access credit for casual builders.',
    3000,
    'usd',
    'month',
    1,
    '{"events": "unlimited", "support": "standard", "analytics": "basic"}'::jsonb,
    0,
    NULL,
    true,
    false,
    1,
    'Pay Per Event',
    'pay_per_event',
    30.00,
    NULL
  ),
  (
    'Pro Monthly',
    'pro_monthly',
    'Unlimited events for active builders.',
    6900,
    'usd',
    'month',
    NULL,
    '{"events": "unlimited", "support": "priority", "analytics": "advanced", "booking_fee": "free"}'::jsonb,
    0,
    'price_pro_monthly',
    true,
    true,
    2,
    'Pro Monthly',
    'pro_monthly',
    69.00,
    'month'
  ),
  (
    'Pro Annual',
    'pro_annual',
    'Unlimited events with annual savings.',
    69000,
    'usd',
    'year',
    NULL,
    '{"events": "unlimited", "support": "priority", "analytics": "advanced", "booking_fee": "free", "savings": "2 months free"}'::jsonb,
    0,
    'price_pro_annual',
    true,
    false,
    3,
    'Pro Annual',
    'pro_annual',
    690.00,
    'year'
  )
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  amount = EXCLUDED.amount,
  interval = EXCLUDED.interval,
  events_per_period = EXCLUDED.events_per_period,
  features = EXCLUDED.features,
  platform_fee_discount = 0,
  stripe_price_id = EXCLUDED.stripe_price_id,
  is_active = true,
  plan_name = EXCLUDED.plan_name,
  plan_type = EXCLUDED.plan_type,
  price = EXCLUDED.price,
  billing_interval = EXCLUDED.billing_interval,
  updated_at = NOW();

ALTER TABLE public.builder_subscriptions
  ADD COLUMN IF NOT EXISTS builder_id UUID REFERENCES public.builder_profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS plan_type VARCHAR(50) DEFAULT 'pay_per_event',
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

ALTER TABLE public.builder_subscriptions
  ALTER COLUMN user_id DROP NOT NULL,
  ALTER COLUMN plan_id DROP NOT NULL;

ALTER TABLE public.builder_subscriptions
  DROP CONSTRAINT IF EXISTS builder_subscriptions_plan_type_check,
  DROP CONSTRAINT IF EXISTS builder_subscriptions_status_check;

ALTER TABLE public.builder_subscriptions
  ADD CONSTRAINT builder_subscriptions_plan_type_check
    CHECK (plan_type IN ('pay_per_event', 'pro_monthly', 'pro_annual')),
  ADD CONSTRAINT builder_subscriptions_status_check
    CHECK (status IN ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'cancelled', 'unpaid'));

CREATE UNIQUE INDEX IF NOT EXISTS builder_subscriptions_builder_id_key
  ON public.builder_subscriptions(builder_id);

CREATE INDEX IF NOT EXISTS idx_builder_subs_builder
  ON public.builder_subscriptions(builder_id);

CREATE INDEX IF NOT EXISTS idx_builder_subs_status
  ON public.builder_subscriptions(status);

CREATE TABLE IF NOT EXISTS public.platform_fee_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  builder_id UUID REFERENCES public.builder_profiles(id),
  booking_id UUID REFERENCES public.vendor_bookings(id),
  stripe_checkout_session_id VARCHAR(255) UNIQUE,
  stripe_payment_intent_id VARCHAR(255),
  stripe_invoice_id VARCHAR(255),
  amount NUMERIC(10,2) NOT NULL,
  fee_type VARCHAR(50) NOT NULL,
  billing_period_start DATE,
  billing_period_end DATE,
  status VARCHAR(50) DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT platform_fee_transactions_fee_type_check
    CHECK (fee_type IN ('per_event', 'subscription_monthly', 'subscription_annual', 'pro_subscriber_free')),
  CONSTRAINT platform_fee_transactions_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded'))
);

ALTER TABLE public.platform_fee_transactions
  DROP CONSTRAINT IF EXISTS platform_fee_transactions_fee_type_check,
  DROP CONSTRAINT IF EXISTS platform_fee_transactions_status_check;

ALTER TABLE public.platform_fee_transactions
  ADD CONSTRAINT platform_fee_transactions_fee_type_check
    CHECK (fee_type IN ('per_event', 'subscription_monthly', 'subscription_annual', 'pro_subscriber_free')),
  ADD CONSTRAINT platform_fee_transactions_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded'));

CREATE TABLE IF NOT EXISTS public.builder_event_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  builder_id UUID REFERENCES public.builder_profiles(id),
  month DATE NOT NULL,
  events_booked INTEGER DEFAULT 0,
  total_fees_paid NUMERIC(10,2) DEFAULT 0,
  could_have_saved NUMERIC(10,2) DEFAULT 0,
  UNIQUE(builder_id, month)
);

CREATE TABLE IF NOT EXISTS public.builder_payment_methods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  builder_id UUID REFERENCES public.builder_profiles(id),
  stripe_payment_method_id VARCHAR(255) UNIQUE NOT NULL,
  card_brand VARCHAR(50),
  card_last4 VARCHAR(4),
  card_exp_month INTEGER,
  card_exp_year INTEGER,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_fees_builder
  ON public.platform_fee_transactions(builder_id);

CREATE INDEX IF NOT EXISTS idx_platform_fees_booking
  ON public.platform_fee_transactions(booking_id);

CREATE INDEX IF NOT EXISTS idx_platform_fees_status
  ON public.platform_fee_transactions(status);

CREATE INDEX IF NOT EXISTS idx_event_usage_builder_month
  ON public.builder_event_usage(builder_id, month);

CREATE INDEX IF NOT EXISTS idx_payment_methods_builder
  ON public.builder_payment_methods(builder_id);

ALTER TABLE public.platform_fee_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_event_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builders view own transactions" ON public.platform_fee_transactions;
CREATE POLICY "Builders view own transactions" ON public.platform_fee_transactions
  FOR SELECT USING (builder_id IN (SELECT id FROM public.builder_profiles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Builders view own usage" ON public.builder_event_usage;
CREATE POLICY "Builders view own usage" ON public.builder_event_usage
  FOR SELECT USING (builder_id IN (SELECT id FROM public.builder_profiles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Builders manage own payment methods" ON public.builder_payment_methods;
CREATE POLICY "Builders manage own payment methods" ON public.builder_payment_methods
  FOR ALL USING (builder_id IN (SELECT id FROM public.builder_profiles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role full access fees" ON public.platform_fee_transactions;
CREATE POLICY "Service role full access fees" ON public.platform_fee_transactions
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access usage" ON public.builder_event_usage;
CREATE POLICY "Service role full access usage" ON public.builder_event_usage
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access payment methods" ON public.builder_payment_methods;
CREATE POLICY "Service role full access payment methods" ON public.builder_payment_methods
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS update_platform_fees_updated_at ON public.platform_fee_transactions;
CREATE TRIGGER update_platform_fees_updated_at
  BEFORE UPDATE ON public.platform_fee_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_payment_methods_updated_at ON public.builder_payment_methods;
CREATE TRIGGER update_payment_methods_updated_at
  BEFORE UPDATE ON public.builder_payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

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
  SET
    could_have_saved = v_could_have_saved
  WHERE builder_id = p_builder_id AND month = p_month;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.calculate_platform_fee(user_id uuid, booking_amount numeric)
RETURNS TABLE(fee_percentage numeric, fee_amount numeric, total_amount numeric)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY SELECT
    0.00::numeric AS fee_percentage,
    0.00::numeric AS fee_amount,
    COALESCE(booking_amount, 0)::numeric AS total_amount;
END;
$$;

ALTER TABLE public.users
  ALTER COLUMN platform_fee_percentage SET DEFAULT 0;

ALTER TABLE public.vendor_bookings
  ALTER COLUMN platform_fee_percentage SET DEFAULT 0;

ALTER TABLE public.venue_bookings
  ALTER COLUMN platform_fee_percentage SET DEFAULT 0;
