-- Migration: Block CHI settlement runs when organizer Stripe accounts are restricted
-- Created: 2026-06-24
-- Context: Stripe account.updated restrictions must pause in-flight CHI settlement
-- runs and checkout charges, not only legacy payment rows.

ALTER TABLE public.settlement_runs
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS blocked_previous_status TEXT,
  ADD COLUMN IF NOT EXISTS blocked_stripe_account_id TEXT,
  ADD COLUMN IF NOT EXISTS account_state_blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS account_state_block_reason TEXT,
  ADD COLUMN IF NOT EXISTS account_state_blocked_event_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_account_recovery_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN public.settlement_runs.blocked_at IS
  'Timestamp when the settlement run was paused because the organizer Stripe Connect account could not receive settlement funds.';
COMMENT ON COLUMN public.settlement_runs.blocked_previous_status IS
  'Previous settlement_runs.status to restore when the same Stripe account becomes active again.';
COMMENT ON COLUMN public.settlement_runs.blocked_stripe_account_id IS
  'Stripe Connect account that caused the account-state block.';
COMMENT ON COLUMN public.settlement_runs.stripe_account_recovery_notified_at IS
  'Last time the organizer was notified to reconnect Stripe for this blocked settlement run.';

ALTER TABLE public.settlement_charges
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS blocked_previous_status TEXT,
  ADD COLUMN IF NOT EXISTS blocked_stripe_account_id TEXT,
  ADD COLUMN IF NOT EXISTS account_state_blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS account_state_block_reason TEXT,
  ADD COLUMN IF NOT EXISTS account_state_blocked_event_id TEXT;

COMMENT ON COLUMN public.settlement_charges.blocked_previous_status IS
  'Previous settlement_charges.status to restore when the same Stripe account becomes active again.';
COMMENT ON COLUMN public.settlement_charges.blocked_stripe_account_id IS
  'Stripe Connect account that caused the account-state block.';

ALTER TABLE public.settlement_runs
  DROP CONSTRAINT IF EXISTS settlement_runs_status_check;

ALTER TABLE public.settlement_runs
  ADD CONSTRAINT settlement_runs_status_check CHECK (status IN (
    'pending',
    'awaiting_attendance',
    'awaiting_organizer_review',
    'awaiting_venue_ack',
    'awaiting_venue_payment',
    'ready_to_settle',
    'blocked',
    'settled',
    'disputed',
    'cancelled'
  ));

ALTER TABLE public.settlement_charges
  DROP CONSTRAINT IF EXISTS settlement_charges_status_check;

ALTER TABLE public.settlement_charges
  ADD CONSTRAINT settlement_charges_status_check CHECK (
    status IN ('checkout_created', 'blocked', 'paid', 'failed', 'cancelled')
  );

CREATE INDEX IF NOT EXISTS settlement_runs_blocked_stripe_account
  ON public.settlement_runs(blocked_stripe_account_id, status, stripe_account_recovery_notified_at)
  WHERE blocked_stripe_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS settlement_charges_blocked_stripe_account
  ON public.settlement_charges(blocked_stripe_account_id, status)
  WHERE blocked_stripe_account_id IS NOT NULL;

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
  v_settlement_runs integer := 0;
  v_settlement_charges integer := 0;
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

  UPDATE public.settlement_charges
  SET
    status = 'blocked',
    blocked_at = v_now,
    blocked_previous_status = status,
    blocked_stripe_account_id = p_stripe_account_id,
    account_state_blocked_at = v_now,
    account_state_block_reason = p_reason,
    account_state_blocked_event_id = p_event_id,
    updated_at = v_now
  WHERE status = 'checkout_created'
    AND stripe_connected_account_id = p_stripe_account_id;
  GET DIAGNOSTICS v_settlement_charges = ROW_COUNT;

  UPDATE public.settlement_runs
  SET
    status = 'blocked',
    blocked_at = v_now,
    blocked_previous_status = status,
    blocked_stripe_account_id = p_stripe_account_id,
    account_state_blocked_at = v_now,
    account_state_block_reason = p_reason,
    account_state_blocked_event_id = p_event_id,
    updated_at = v_now
  WHERE status IN (
      'pending',
      'awaiting_attendance',
      'awaiting_organizer_review',
      'awaiting_venue_ack',
      'awaiting_venue_payment',
      'ready_to_settle'
    )
    AND organizer_id = ANY(v_builder_user_ids);
  GET DIAGNOSTICS v_settlement_runs = ROW_COUNT;

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
    'kickback_payments', v_kickback_payments,
    'settlement_runs', v_settlement_runs,
    'settlement_charges', v_settlement_charges
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.block_inflight_stripe_account_payments(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.unblock_stripe_account_settlements(
  p_stripe_account_id text,
  p_event_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settlement_runs integer := 0;
  v_settlement_charges integer := 0;
  v_now timestamptz := now();
BEGIN
  UPDATE public.settlement_charges
  SET
    status = blocked_previous_status,
    blocked_at = NULL,
    blocked_previous_status = NULL,
    blocked_stripe_account_id = NULL,
    account_state_blocked_at = NULL,
    account_state_block_reason = NULL,
    account_state_blocked_event_id = NULL,
    updated_at = v_now
  WHERE status = 'blocked'
    AND blocked_stripe_account_id = p_stripe_account_id
    AND account_state_blocked_at IS NOT NULL
    AND blocked_previous_status IN ('checkout_created');
  GET DIAGNOSTICS v_settlement_charges = ROW_COUNT;

  UPDATE public.settlement_runs
  SET
    status = blocked_previous_status,
    blocked_at = NULL,
    blocked_previous_status = NULL,
    blocked_stripe_account_id = NULL,
    account_state_blocked_at = NULL,
    account_state_block_reason = NULL,
    account_state_blocked_event_id = NULL,
    updated_at = v_now
  WHERE status = 'blocked'
    AND blocked_stripe_account_id = p_stripe_account_id
    AND account_state_blocked_at IS NOT NULL
    AND blocked_previous_status IN (
      'pending',
      'awaiting_attendance',
      'awaiting_organizer_review',
      'awaiting_venue_ack',
      'awaiting_venue_payment',
      'ready_to_settle'
    );
  GET DIAGNOSTICS v_settlement_runs = ROW_COUNT;

  UPDATE public.builder_stripe_accounts
  SET last_webhook_event_id = p_event_id, last_webhook_event_type = 'account.updated.unblocked', last_webhook_at = v_now
  WHERE stripe_account_id = p_stripe_account_id;

  RAISE LOG 'unblock_stripe_account_settlements account=% runs=% charges=% event=%',
    p_stripe_account_id, v_settlement_runs, v_settlement_charges, p_event_id;

  RETURN jsonb_build_object(
    'settlement_runs', v_settlement_runs,
    'settlement_charges', v_settlement_charges
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.unblock_stripe_account_settlements(text, text) TO service_role;
