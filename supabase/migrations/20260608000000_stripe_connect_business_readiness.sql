-- Phase 2 Stripe/Connect readiness.
-- Keeps Stripe deliveries endpoint-aware, expands Connect account states, and
-- blocks in-flight money rows atomically when a connected account is disabled.

ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS endpoint_path text,
  ADD COLUMN IF NOT EXISTS livemode boolean,
  ADD COLUMN IF NOT EXISTS processing_outcome text,
  ADD COLUMN IF NOT EXISTS duplicate_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS received_at timestamptz NOT NULL DEFAULT now();

UPDATE public.stripe_webhook_events
SET
  source = COALESCE(source, 'platform'),
  endpoint_path = COALESCE(endpoint_path, '/api/webhooks/stripe'),
  livemode = COALESCE(livemode, false),
  processing_outcome = COALESCE(
    processing_outcome,
    CASE WHEN processed IS TRUE THEN 'processed' ELSE 'received' END
  ),
  received_at = COALESCE(received_at, created_at, now())
WHERE source IS NULL
   OR endpoint_path IS NULL
   OR livemode IS NULL
   OR processing_outcome IS NULL;

ALTER TABLE public.stripe_webhook_events
  ALTER COLUMN source SET NOT NULL,
  ALTER COLUMN endpoint_path SET NOT NULL,
  ALTER COLUMN livemode SET NOT NULL,
  DROP CONSTRAINT IF EXISTS stripe_webhook_events_source_check,
  DROP CONSTRAINT IF EXISTS stripe_webhook_events_outcome_check,
  DROP CONSTRAINT IF EXISTS stripe_webhook_events_duplicate_count_check;

ALTER TABLE public.stripe_webhook_events
  ADD CONSTRAINT stripe_webhook_events_source_check
    CHECK (source IN ('platform', 'connect')),
  ADD CONSTRAINT stripe_webhook_events_outcome_check
    CHECK (processing_outcome IN ('received', 'processed', 'ignored', 'observed', 'rate_limited', 'failed')),
  ADD CONSTRAINT stripe_webhook_events_duplicate_count_check
    CHECK (duplicate_count >= 0);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_source_received
  ON public.stripe_webhook_events(source, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_outcome_received
  ON public.stripe_webhook_events(processing_outcome, received_at DESC);

DROP POLICY IF EXISTS "Service role can manage stripe webhook events"
  ON public.stripe_webhook_events;
CREATE POLICY "Service role can manage stripe webhook events"
  ON public.stripe_webhook_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.vendor_stripe_accounts
  DROP CONSTRAINT IF EXISTS vendor_stripe_accounts_status_check;
ALTER TABLE public.vendor_stripe_accounts
  ADD CONSTRAINT vendor_stripe_accounts_status_check
    CHECK (account_status IN (
      'pending',
      'pending_onboarding',
      'onboarding_started',
      'capabilities_pending',
      'active',
      'complete',
      'restricted',
      'disabled'
    )),
  ADD COLUMN IF NOT EXISTS disabled_reason text,
  ADD COLUMN IF NOT EXISTS last_webhook_event_id text,
  ADD COLUMN IF NOT EXISTS last_webhook_event_type text,
  ADD COLUMN IF NOT EXISTS last_webhook_at timestamptz;

ALTER TABLE public.venue_stripe_accounts
  DROP CONSTRAINT IF EXISTS venue_stripe_accounts_status_check;
ALTER TABLE public.venue_stripe_accounts
  ADD CONSTRAINT venue_stripe_accounts_status_check
    CHECK (account_status IN (
      'pending',
      'pending_onboarding',
      'onboarding_started',
      'capabilities_pending',
      'active',
      'complete',
      'restricted',
      'disabled'
    )),
  ADD COLUMN IF NOT EXISTS disabled_reason text,
  ADD COLUMN IF NOT EXISTS last_webhook_event_id text,
  ADD COLUMN IF NOT EXISTS last_webhook_event_type text,
  ADD COLUMN IF NOT EXISTS last_webhook_at timestamptz;

ALTER TABLE public.builder_stripe_accounts
  DROP CONSTRAINT IF EXISTS builder_stripe_accounts_status_check;
ALTER TABLE public.builder_stripe_accounts
  ADD CONSTRAINT builder_stripe_accounts_status_check
    CHECK (account_status IN (
      'pending',
      'pending_onboarding',
      'onboarding_started',
      'capabilities_pending',
      'active',
      'complete',
      'restricted',
      'disabled'
    )),
  ADD COLUMN IF NOT EXISTS disabled_reason text,
  ADD COLUMN IF NOT EXISTS last_webhook_event_id text,
  ADD COLUMN IF NOT EXISTS last_webhook_event_type text,
  ADD COLUMN IF NOT EXISTS last_webhook_at timestamptz;

ALTER TABLE public.payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_status_check;
ALTER TABLE public.payment_intents
  ADD CONSTRAINT payment_intents_status_check
    CHECK (status IN ('requested', 'authorized', 'captured', 'refunded', 'failed', 'blocked_by_account_state')),
  ADD COLUMN IF NOT EXISTS account_state_blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS account_state_block_reason text;

ALTER TABLE public.vendor_transactions
  DROP CONSTRAINT IF EXISTS vendor_transactions_status_check;
ALTER TABLE public.vendor_transactions
  ADD CONSTRAINT vendor_transactions_status_check
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'refunded', 'blocked_by_account_state')),
  ADD COLUMN IF NOT EXISTS account_state_blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS account_state_block_reason text;

ALTER TABLE public.platform_fee_transactions
  ADD COLUMN IF NOT EXISTS amount_cents integer;

UPDATE public.platform_fee_transactions
SET amount_cents = COALESCE(amount_cents, ROUND(amount * 100)::integer)
WHERE amount_cents IS NULL;

ALTER TABLE public.platform_fee_transactions
  ALTER COLUMN amount_cents SET NOT NULL,
  DROP CONSTRAINT IF EXISTS platform_fee_transactions_amount_cents_check;

ALTER TABLE public.platform_fee_transactions
  ADD CONSTRAINT platform_fee_transactions_amount_cents_check
    CHECK (amount_cents >= 0);

ALTER TABLE public.venue_payment_transactions
  DROP CONSTRAINT IF EXISTS venue_payment_transactions_status_check;
ALTER TABLE public.venue_payment_transactions
  ADD COLUMN IF NOT EXISTS approval_id uuid REFERENCES public.approvals(id) ON DELETE SET NULL,
  ADD CONSTRAINT venue_payment_transactions_status_check
    CHECK (status IN (
      'pending_builder_payment',
      'checkout_created',
      'paid',
      'refund_requested',
      'refund_approved',
      'refunded_partial',
      'refunded_full',
      'cancelled',
      'failed',
      'blocked_by_account_state'
    )),
  ADD COLUMN IF NOT EXISTS account_state_blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS account_state_block_reason text;

CREATE INDEX IF NOT EXISTS idx_venue_payment_transactions_approval_id
  ON public.venue_payment_transactions(approval_id)
  WHERE approval_id IS NOT NULL;

ALTER TABLE public.kickback_payments
  DROP CONSTRAINT IF EXISTS kickback_payments_status_check;
ALTER TABLE public.kickback_payments
  ADD CONSTRAINT kickback_payments_status_check
    CHECK (status IN (
      'pending',
      'processing',
      'completed',
      'failed',
      'refunded',
      'pending_venue_approval',
      'invoice_sent',
      'paid',
      'invoice_failed',
      'refund_requested',
      'refund_approved',
      'refund_processing',
      'refunded_full',
      'refunded_partial',
      'blocked_by_account_state'
    )),
  ADD COLUMN IF NOT EXISTS account_state_blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS account_state_block_reason text;

CREATE OR REPLACE FUNCTION public.increment_stripe_webhook_duplicate_count(
  p_stripe_event_id text
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.stripe_webhook_events
  SET duplicate_count = duplicate_count + 1
  WHERE stripe_event_id = p_stripe_event_id;
$$;

GRANT EXECUTE ON FUNCTION public.increment_stripe_webhook_duplicate_count(text) TO service_role;

CREATE OR REPLACE FUNCTION public.block_inflight_stripe_account_payments(
  p_stripe_account_id text,
  p_reason text,
  p_event_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vendor_ids uuid[];
  v_venue_owner_ids uuid[];
  v_builder_user_ids uuid[];
  v_payment_intents integer := 0;
  v_vendor_transactions integer := 0;
  v_venue_transactions integer := 0;
  v_kickback_payments integer := 0;
  v_now timestamptz := now();
BEGIN
  SELECT COALESCE(array_agg(vendor_id), ARRAY[]::uuid[])
    INTO v_vendor_ids
  FROM public.vendor_stripe_accounts
  WHERE stripe_account_id = p_stripe_account_id;

  SELECT COALESCE(array_agg(owner_id), ARRAY[]::uuid[])
    INTO v_venue_owner_ids
  FROM public.venue_stripe_accounts
  WHERE stripe_account_id = p_stripe_account_id;

  SELECT COALESCE(array_agg(user_id), ARRAY[]::uuid[])
    INTO v_builder_user_ids
  FROM public.builder_stripe_accounts
  WHERE stripe_account_id = p_stripe_account_id;

  UPDATE public.payment_intents
  SET
    status = 'blocked_by_account_state',
    account_state_blocked_at = v_now,
    account_state_block_reason = p_reason,
    updated_at = v_now
  WHERE status IN ('requested', 'authorized')
    AND (
      (partner_kind = 'vendor' AND partner_id = ANY(v_vendor_ids))
      OR (partner_kind = 'venue' AND partner_id = ANY(v_venue_owner_ids))
    );
  GET DIAGNOSTICS v_payment_intents = ROW_COUNT;

  UPDATE public.vendor_transactions
  SET
    status = 'blocked_by_account_state',
    account_state_blocked_at = v_now,
    account_state_block_reason = p_reason
  WHERE status IN ('pending', 'processing')
    AND vendor_id = ANY(v_vendor_ids);
  GET DIAGNOSTICS v_vendor_transactions = ROW_COUNT;

  UPDATE public.venue_payment_transactions
  SET
    status = 'blocked_by_account_state',
    account_state_blocked_at = v_now,
    account_state_block_reason = p_reason,
    updated_at = v_now
  WHERE status IN ('pending_builder_payment', 'checkout_created')
    AND venue_owner_id = ANY(v_venue_owner_ids);
  GET DIAGNOSTICS v_venue_transactions = ROW_COUNT;

  UPDATE public.kickback_payments
  SET
    status = 'blocked_by_account_state',
    account_state_blocked_at = v_now,
    account_state_block_reason = p_reason,
    updated_at = v_now
  WHERE status IN ('pending', 'processing', 'pending_venue_approval', 'invoice_sent')
    AND recipient_id = ANY(v_builder_user_ids);
  GET DIAGNOSTICS v_kickback_payments = ROW_COUNT;

  UPDATE public.vendor_stripe_accounts
  SET last_webhook_event_id = p_event_id, last_webhook_event_type = p_reason, last_webhook_at = v_now
  WHERE stripe_account_id = p_stripe_account_id;

  UPDATE public.venue_stripe_accounts
  SET last_webhook_event_id = p_event_id, last_webhook_event_type = p_reason, last_webhook_at = v_now
  WHERE stripe_account_id = p_stripe_account_id;

  UPDATE public.builder_stripe_accounts
  SET last_webhook_event_id = p_event_id, last_webhook_event_type = p_reason, last_webhook_at = v_now
  WHERE stripe_account_id = p_stripe_account_id;

  RETURN jsonb_build_object(
    'payment_intents', v_payment_intents,
    'vendor_transactions', v_vendor_transactions,
    'venue_payment_transactions', v_venue_transactions,
    'kickback_payments', v_kickback_payments
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.block_inflight_stripe_account_payments(text, text, text) TO service_role;
