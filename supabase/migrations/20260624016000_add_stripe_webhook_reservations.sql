-- Migration: Reserve Stripe webhook events before side effects
-- Created: 2026-06-24
-- Context: Concurrent Stripe retries must not both pass the ledger read before
-- processing. This adds an atomic reservation step keyed by event + endpoint.

ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS in_flight BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.stripe_webhook_events
SET
  completed_at = COALESCE(completed_at, processed_at),
  in_flight = false
WHERE processed IS TRUE
  AND completed_at IS NULL;

ALTER TABLE public.stripe_webhook_events
  DROP CONSTRAINT IF EXISTS stripe_webhook_events_stripe_event_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS stripe_webhook_events_event_endpoint_key
  ON public.stripe_webhook_events(stripe_event_id, endpoint_path);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_in_flight_reserved
  ON public.stripe_webhook_events(in_flight, reserved_at)
  WHERE in_flight IS TRUE;

CREATE OR REPLACE FUNCTION public.reserve_stripe_webhook_event(
  p_stripe_event_id TEXT,
  p_event_type TEXT,
  p_payload JSONB,
  p_source TEXT,
  p_endpoint_path TEXT,
  p_livemode BOOLEAN DEFAULT false
) RETURNS TABLE (
  existed BOOLEAN,
  in_flight BOOLEAN,
  completed BOOLEAN,
  reserved_now BOOLEAN,
  processed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.stripe_webhook_events%ROWTYPE;
  v_now TIMESTAMPTZ := now();
BEGIN
  INSERT INTO public.stripe_webhook_events (
    stripe_event_id,
    event_type,
    payload,
    source,
    endpoint_path,
    livemode,
    processed,
    processing_outcome,
    received_at,
    in_flight,
    reserved_at
  )
  VALUES (
    p_stripe_event_id,
    p_event_type,
    COALESCE(p_payload, '{}'::jsonb),
    p_source,
    p_endpoint_path,
    COALESCE(p_livemode, false),
    false,
    'received',
    v_now,
    true,
    v_now
  )
  ON CONFLICT (stripe_event_id, endpoint_path) DO NOTHING
  RETURNING * INTO v_existing;

  IF v_existing.id IS NOT NULL THEN
    RETURN QUERY SELECT false, true, false, true, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT *
    INTO v_existing
    FROM public.stripe_webhook_events
   WHERE stripe_event_id = p_stripe_event_id
     AND endpoint_path = p_endpoint_path
   FOR UPDATE;

  IF v_existing.completed_at IS NOT NULL OR v_existing.processed IS TRUE THEN
    UPDATE public.stripe_webhook_events
       SET duplicate_count = duplicate_count + 1
     WHERE id = v_existing.id;

    RETURN QUERY SELECT true, false, true, false, COALESCE(v_existing.completed_at, v_existing.processed_at);
    RETURN;
  END IF;

  IF v_existing.in_flight IS TRUE THEN
    RETURN QUERY SELECT true, true, false, false, NULL::timestamptz;
    RETURN;
  END IF;

  UPDATE public.stripe_webhook_events
     SET event_type = p_event_type,
         payload = COALESCE(p_payload, payload, '{}'::jsonb),
         source = p_source,
         endpoint_path = p_endpoint_path,
         livemode = COALESCE(p_livemode, false),
         processing_outcome = 'received',
         last_error = NULL,
         error = NULL,
         in_flight = true,
         reserved_at = v_now,
         received_at = COALESCE(received_at, v_now)
   WHERE id = v_existing.id;

  RETURN QUERY SELECT true, true, false, true, NULL::timestamptz;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_stripe_webhook_event_result(
  p_stripe_event_id text,
  p_event_type text,
  p_payload jsonb,
  p_source text,
  p_endpoint_path text,
  p_livemode boolean,
  p_processing_outcome text,
  p_processed boolean,
  p_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_processed_at timestamptz := CASE WHEN p_processed THEN v_now ELSE NULL END;
  v_completed_at timestamptz := CASE WHEN p_processed THEN v_now ELSE NULL END;
BEGIN
  INSERT INTO public.stripe_webhook_events (
    stripe_event_id,
    event_type,
    payload,
    source,
    endpoint_path,
    livemode,
    processed,
    processed_at,
    completed_at,
    in_flight,
    processing_outcome,
    last_error,
    error,
    received_at
  )
  VALUES (
    p_stripe_event_id,
    p_event_type,
    p_payload,
    p_source,
    p_endpoint_path,
    COALESCE(p_livemode, false),
    COALESCE(p_processed, false),
    v_processed_at,
    v_completed_at,
    false,
    p_processing_outcome,
    LEFT(p_error, 1000),
    LEFT(p_error, 1000),
    v_now
  )
  ON CONFLICT (stripe_event_id, endpoint_path) DO UPDATE
  SET
    event_type = EXCLUDED.event_type,
    payload = EXCLUDED.payload,
    source = EXCLUDED.source,
    endpoint_path = EXCLUDED.endpoint_path,
    livemode = EXCLUDED.livemode,
    processed = EXCLUDED.processed,
    processed_at = EXCLUDED.processed_at,
    completed_at = EXCLUDED.completed_at,
    in_flight = false,
    processing_outcome = EXCLUDED.processing_outcome,
    last_error = EXCLUDED.last_error,
    error = EXCLUDED.error,
    received_at = COALESCE(public.stripe_webhook_events.received_at, EXCLUDED.received_at);

  RETURN jsonb_build_object(
    'stripe_event_id', p_stripe_event_id,
    'endpoint_path', p_endpoint_path,
    'processing_outcome', p_processing_outcome,
    'processed', COALESCE(p_processed, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_stripe_webhook_duplicate_count(
  p_stripe_event_id text,
  p_endpoint_path text DEFAULT NULL
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.stripe_webhook_events
  SET duplicate_count = duplicate_count + 1
  WHERE stripe_event_id = p_stripe_event_id
    AND (p_endpoint_path IS NULL OR endpoint_path = p_endpoint_path);
$$;

CREATE OR REPLACE FUNCTION public.release_stale_stripe_webhook_reservations(
  p_older_than INTERVAL DEFAULT '5 minutes'
) RETURNS TABLE (
  released_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  UPDATE public.stripe_webhook_events
     SET in_flight = false,
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('stale_reservation', true),
         last_error = COALESCE(last_error, 'stale reservation released')
   WHERE in_flight IS TRUE
     AND reserved_at < now() - p_older_than;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reserve_stripe_webhook_event(
  TEXT,
  TEXT,
  JSONB,
  TEXT,
  TEXT,
  BOOLEAN
) TO service_role;

GRANT EXECUTE ON FUNCTION public.record_stripe_webhook_event_result(
  TEXT,
  TEXT,
  JSONB,
  TEXT,
  TEXT,
  BOOLEAN,
  TEXT,
  BOOLEAN,
  TEXT
) TO service_role;

GRANT EXECUTE ON FUNCTION public.increment_stripe_webhook_duplicate_count(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_stale_stripe_webhook_reservations(INTERVAL) TO service_role;
