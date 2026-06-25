-- Migration: Add CHI settlement audit log and atomic transition helpers
-- Created: 2026-06-24
-- Context: Settlement status changes need actor attribution and audit rows
-- written atomically with the state transition.

CREATE TABLE IF NOT EXISTS public.settlement_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(32) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(64) NOT NULL,
  before_state JSONB,
  after_state JSONB,
  actor_id UUID REFERENCES auth.users(id),
  actor_type VARCHAR(32),
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT settlement_audit_log_entity_type_check
    CHECK (entity_type IN ('settlement_run', 'settlement_charge')),
  CONSTRAINT settlement_audit_log_actor_type_check
    CHECK (
      actor_type IS NULL OR actor_type IN (
        'admin',
        'organizer',
        'venue',
        'system',
        'stripe_webhook'
      )
    )
);

COMMENT ON TABLE public.settlement_audit_log IS
  'Append-only audit log for CHI settlement run and charge state changes.';

CREATE INDEX IF NOT EXISTS idx_settlement_audit_entity
  ON public.settlement_audit_log(entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_settlement_audit_actor
  ON public.settlement_audit_log(actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

ALTER TABLE public.settlement_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage settlement audit log" ON public.settlement_audit_log;
CREATE POLICY "Service role can manage settlement audit log"
  ON public.settlement_audit_log FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT ALL ON TABLE public.settlement_audit_log TO service_role;

ALTER TABLE public.admin_audit_log
  ADD COLUMN IF NOT EXISTS reason TEXT;

CREATE OR REPLACE FUNCTION public.transition_settlement_run_status(
  p_run_id UUID,
  p_from_status TEXT,
  p_to_status TEXT,
  p_action TEXT,
  p_actor_id UUID DEFAULT NULL,
  p_actor_type TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_patch JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  success BOOLEAN,
  failure_reason TEXT,
  run JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before public.settlement_runs%ROWTYPE;
  v_after public.settlement_runs%ROWTYPE;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT *
    INTO v_before
    FROM public.settlement_runs
   WHERE id = p_run_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', NULL::jsonb;
    RETURN;
  END IF;

  IF v_before.status <> p_from_status THEN
    RETURN QUERY SELECT false, 'concurrent_update', to_jsonb(v_before);
    RETURN;
  END IF;

  UPDATE public.settlement_runs
     SET status = p_to_status,
         attendance_count = CASE
           WHEN p_patch ? 'attendance_count' THEN (p_patch->>'attendance_count')::integer
           ELSE attendance_count
         END,
         attendance_source = CASE
           WHEN p_patch ? 'attendance_source' THEN p_patch->>'attendance_source'
           ELSE attendance_source
         END,
         attendance_recorded_at = CASE
           WHEN p_patch ? 'attendance_recorded_at' THEN (p_patch->>'attendance_recorded_at')::timestamptz
           ELSE attendance_recorded_at
         END,
         total_cents = CASE
           WHEN p_patch ? 'total_cents' THEN (p_patch->>'total_cents')::integer
           ELSE total_cents
         END,
         organizer_reviewed_at = CASE
           WHEN p_patch ? 'organizer_reviewed_at' THEN (p_patch->>'organizer_reviewed_at')::timestamptz
           ELSE organizer_reviewed_at
         END,
         organizer_reviewed_by = CASE
           WHEN p_patch ? 'organizer_reviewed_by' THEN (p_patch->>'organizer_reviewed_by')::uuid
           ELSE organizer_reviewed_by
         END,
         disputed_at = CASE
           WHEN p_patch ? 'disputed_at' THEN (p_patch->>'disputed_at')::timestamptz
           ELSE disputed_at
         END,
         dispute_reason = CASE
           WHEN p_patch ? 'dispute_reason' THEN p_patch->>'dispute_reason'
           ELSE dispute_reason
         END,
         updated_at = v_now
   WHERE id = p_run_id
   RETURNING * INTO v_after;

  INSERT INTO public.settlement_audit_log (
    entity_type,
    entity_id,
    action,
    before_state,
    after_state,
    actor_id,
    actor_type,
    reason,
    metadata
  ) VALUES (
    'settlement_run',
    p_run_id,
    p_action,
    to_jsonb(v_before),
    to_jsonb(v_after),
    p_actor_id,
    p_actor_type,
    p_reason,
    COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN QUERY SELECT true, NULL::text, to_jsonb(v_after);
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_settlement_charge_status(
  p_charge_id UUID,
  p_from_status TEXT,
  p_to_status TEXT,
  p_action TEXT,
  p_actor_id UUID DEFAULT NULL,
  p_actor_type TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_patch JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  success BOOLEAN,
  failure_reason TEXT,
  charge JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before public.settlement_charges%ROWTYPE;
  v_after public.settlement_charges%ROWTYPE;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT *
    INTO v_before
    FROM public.settlement_charges
   WHERE id = p_charge_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found', NULL::jsonb;
    RETURN;
  END IF;

  IF v_before.status <> p_from_status THEN
    RETURN QUERY SELECT false, 'concurrent_update', to_jsonb(v_before);
    RETURN;
  END IF;

  UPDATE public.settlement_charges
     SET status = p_to_status,
         stripe_payment_intent_id = CASE
           WHEN p_patch ? 'stripe_payment_intent_id' THEN p_patch->>'stripe_payment_intent_id'
           ELSE stripe_payment_intent_id
         END,
         paid_at = CASE
           WHEN p_patch ? 'paid_at' THEN (p_patch->>'paid_at')::timestamptz
           ELSE paid_at
         END,
         failed_at = CASE
           WHEN p_patch ? 'failed_at' THEN (p_patch->>'failed_at')::timestamptz
           ELSE failed_at
         END,
         failure_reason = CASE
           WHEN p_patch ? 'failure_reason' THEN p_patch->>'failure_reason'
           ELSE failure_reason
         END,
         updated_at = v_now
   WHERE id = p_charge_id
   RETURNING * INTO v_after;

  INSERT INTO public.settlement_audit_log (
    entity_type,
    entity_id,
    action,
    before_state,
    after_state,
    actor_id,
    actor_type,
    reason,
    metadata
  ) VALUES (
    'settlement_charge',
    p_charge_id,
    p_action,
    to_jsonb(v_before),
    to_jsonb(v_after),
    p_actor_id,
    p_actor_type,
    p_reason,
    COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN QUERY SELECT true, NULL::text, to_jsonb(v_after);
END;
$$;

GRANT EXECUTE ON FUNCTION public.transition_settlement_run_status(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  TEXT,
  TEXT,
  JSONB,
  JSONB
) TO service_role;

GRANT EXECUTE ON FUNCTION public.transition_settlement_charge_status(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  UUID,
  TEXT,
  TEXT,
  JSONB,
  JSONB
) TO service_role;
