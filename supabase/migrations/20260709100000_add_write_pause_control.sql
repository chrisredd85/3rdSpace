-- Durable release write-pause control.
--
-- This migration is intentionally ordered after the payment-capture expansion
-- (20260709090000) and before the Prompt 1-8 control-plane bundle
-- (20260709110000+). It must be applied and its small middleware/control-plane
-- release deployed before the coordinated bundle window begins.

CREATE TABLE IF NOT EXISTS public.release_runtime_controls (
  control_key TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'open',
  enabled BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  enabled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by TEXT NOT NULL DEFAULT 'migration',
  revision BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT release_runtime_controls_key_check
    CHECK (control_key = 'write_pause'),
  CONSTRAINT release_runtime_controls_reason_check
    CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
  CONSTRAINT release_runtime_controls_changed_by_check
    CHECK (char_length(changed_by) BETWEEN 1 AND 320),
  CONSTRAINT release_runtime_controls_revision_check
    CHECK (revision >= 0)
);

ALTER TABLE public.release_runtime_controls
  ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'open';

-- Preserve a partially applied v1 control row while upgrading the flag into a
-- state machine. `enabled` remains as a compatibility projection for the
-- small schema-first/application-second deployment window.
UPDATE public.release_runtime_controls
SET state = CASE WHEN enabled THEN 'paused' ELSE 'open' END
WHERE state IS DISTINCT FROM CASE WHEN enabled THEN 'paused' ELSE 'open' END;

ALTER TABLE public.release_runtime_controls
  DROP CONSTRAINT IF EXISTS release_runtime_controls_state_check;
ALTER TABLE public.release_runtime_controls
  ADD CONSTRAINT release_runtime_controls_state_check
    CHECK (state IN ('open', 'paused', 'draining'));

ALTER TABLE public.release_runtime_controls
  DROP CONSTRAINT IF EXISTS release_runtime_controls_enabled_at_check;
ALTER TABLE public.release_runtime_controls
  ADD CONSTRAINT release_runtime_controls_enabled_at_check
    CHECK (
      (state = 'open' AND enabled IS FALSE AND enabled_at IS NULL)
      OR (
        state IN ('paused', 'draining')
        AND enabled IS TRUE
        AND enabled_at IS NOT NULL
      )
    );

COMMENT ON TABLE public.release_runtime_controls IS
  'Durable, singleton release controls shared by every serverless instance. The write_pause row gates API mutations during coordinated releases.';

INSERT INTO public.release_runtime_controls (
  control_key,
  state,
  enabled,
  reason,
  enabled_at,
  changed_by,
  revision
)
VALUES ('write_pause', 'open', false, NULL, NULL, 'migration', 0)
ON CONFLICT (control_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.stamp_release_runtime_control()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_enabled_changed BOOLEAN := NEW.enabled IS DISTINCT FROM OLD.enabled;
  v_state_changed BOOLEAN := NEW.state IS DISTINCT FROM OLD.state;
BEGIN
  IF NEW.control_key IS DISTINCT FROM OLD.control_key THEN
    RAISE EXCEPTION 'release runtime control keys are immutable';
  END IF;

  -- New callers update `state`; the previous control route updated `enabled`.
  -- Keep both representations coherent during the coordinated rollout.
  IF v_state_changed AND v_enabled_changed THEN
    IF NEW.enabled IS DISTINCT FROM (NEW.state <> 'open') THEN
      RAISE EXCEPTION 'release runtime control state and enabled flag disagree';
    END IF;
  ELSIF v_state_changed THEN
    NEW.enabled := NEW.state <> 'open';
  ELSIF v_enabled_changed THEN
    NEW.state := CASE WHEN NEW.enabled THEN 'paused' ELSE 'open' END;
  END IF;

  NEW.updated_at := clock_timestamp();
  NEW.revision := OLD.revision + 1;

  IF NEW.state = 'open' THEN
    NEW.enabled := false;
    NEW.enabled_at := NULL;
  ELSE
    NEW.enabled := true;
    NEW.enabled_at := CASE
      WHEN OLD.state = 'open' THEN NEW.updated_at
      ELSE OLD.enabled_at
    END;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_release_runtime_control()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_release_runtime_control()
  TO service_role;

DROP TRIGGER IF EXISTS stamp_release_runtime_control
  ON public.release_runtime_controls;
CREATE TRIGGER stamp_release_runtime_control
  BEFORE UPDATE ON public.release_runtime_controls
  FOR EACH ROW EXECUTE FUNCTION public.stamp_release_runtime_control();

ALTER TABLE public.release_runtime_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_runtime_controls FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read write pause status"
  ON public.release_runtime_controls;
CREATE POLICY "Public can read write pause status"
  ON public.release_runtime_controls
  FOR SELECT
  TO anon, authenticated
  USING (control_key = 'write_pause');

DROP POLICY IF EXISTS "Service role can manage release runtime controls"
  ON public.release_runtime_controls;
CREATE POLICY "Service role can manage release runtime controls"
  ON public.release_runtime_controls
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.release_runtime_controls
  FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  control_key,
  state,
  enabled,
  reason,
  enabled_at,
  updated_at,
  revision
) ON public.release_runtime_controls TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.release_runtime_controls TO service_role;

-- Middleware is the user-facing chokepoint, but this prerequisite is deployed
-- before 20260709130000 removes historical browser mutation grants. Protect
-- those legacy direct-to-Supabase paths at the database boundary as well.
--
-- This is a statement trigger (rather than a row trigger), so normal writes
-- pay one singleton lookup per statement. Requests receive a PostgREST-native
-- 503 body, while migration/maintenance sessions without an application JWT
-- role remain able to apply the coordinated schema bundle.
CREATE OR REPLACE FUNCTION public.reject_write_during_release_pause()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_request_role TEXT;
BEGIN
  v_request_role := NULLIF(current_setting('request.jwt.claim.role', true), '');

  IF v_request_role IS NULL THEN
    BEGIN
      v_request_role := NULLIF(
        current_setting('request.jwt.claims', true)::jsonb ->> 'role',
        ''
      );
    EXCEPTION
      WHEN invalid_text_representation THEN
        v_request_role := NULL;
    END;
  END IF;

  v_request_role := COALESCE(v_request_role, current_user);

  IF (
    v_request_role IN ('anon', 'authenticated')
    OR (
      v_request_role = 'service_role'
      AND EXISTS (
        SELECT 1
        FROM public.release_runtime_controls
        WHERE control_key = 'write_pause'
          AND state = 'paused'
      )
    )
  )
    AND EXISTS (
      SELECT 1
      FROM public.release_runtime_controls
      WHERE control_key = 'write_pause'
        AND state <> 'open'
    )
  THEN
    RAISE SQLSTATE 'PGRST'
      USING MESSAGE = '{"code":"maintenance_in_progress","message":"Maintenance in progress. Please retry shortly.","details":null,"hint":"Retry after 60 seconds."}',
            DETAIL = '{"status":503,"headers":{"Retry-After":"60","Cache-Control":"no-store"}}';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_write_during_release_pause()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_write_during_release_pause()
  TO anon, authenticated, service_role;

DO $write_pause_triggers$
DECLARE
  v_table TEXT;
  v_tables CONSTANT TEXT[] := ARRAY[
    'plans',
    'plan_messages',
    'plan_versions',
    'plan_revisions',
    'plan_derived_state',
    'planner_plan_updates',
    'plan_activity',
    'partnership_threads',
    'partnership_messages',
    'partnership_milestones',
    'partnership_documents',
    'recommendations',
    'agent_actions',
    'approvals',
    'admin_tasks',
    'agent_authorizations',
    'agent_action_audit_log',
    'agent_runs',
    'audit_logs',
    'venue_booking_approval_audit',
    'outreach_threads',
    'outreach_messages',
    'creator_outreach_policies',
    'venue_opportunity_briefs',
    'venue_opportunity_invites',
    'vendor_opportunity_briefs',
    'vendor_opportunity_invites',
    'payment_intents',
    'vendor_transactions',
    'platform_fee_transactions',
    'kickback_payments',
    'settlement_charges',
    'venue_bookings',
    'vendor_bookings',
    'event_financial_summary'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'write-pause protected table is missing: public.%', v_table;
    END IF;

    EXECUTE format(
      'DROP TRIGGER IF EXISTS reject_write_during_release_pause ON public.%I',
      v_table
    );
    EXECUTE format(
      'CREATE TRIGGER reject_write_during_release_pause BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.reject_write_during_release_pause()',
      v_table
    );
  END LOOP;
END;
$write_pause_triggers$;

-- Stripe deliveries must be acknowledged and durably retained during the
-- pause, but their business side effects are replayed only in draining state.
ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS maintenance_deferred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reservation_token UUID;

ALTER TABLE public.stripe_webhook_events
  DROP CONSTRAINT IF EXISTS stripe_webhook_events_outcome_check;
ALTER TABLE public.stripe_webhook_events
  ADD CONSTRAINT stripe_webhook_events_outcome_check
    CHECK (processing_outcome IN (
      'received',
      'processed',
      'ignored',
      'observed',
      'rate_limited',
      'failed',
      'deferred_maintenance'
    ));

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_maintenance_deferred
  ON public.stripe_webhook_events(maintenance_deferred_at, received_at)
  WHERE maintenance_deferred_at IS NOT NULL
    AND processed IS FALSE;

-- All release-state changes use a row lock and an expected revision. Opening
-- is deliberately excluded: only complete_write_pause_drain() may perform the
-- draining -> open transition after proving the durable queue is empty.
CREATE OR REPLACE FUNCTION public.transition_release_runtime_control(
  p_expected_revision BIGINT,
  p_target_state TEXT,
  p_reason TEXT,
  p_changed_by TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_control public.release_runtime_controls%ROWTYPE;
BEGIN
  IF p_target_state NOT IN ('paused', 'draining') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'target state must be paused or draining';
  END IF;

  IF NULLIF(btrim(p_reason), '') IS NULL
    OR NULLIF(btrim(p_changed_by), '') IS NULL
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'reason and changed_by are required';
  END IF;

  SELECT *
    INTO v_control
    FROM public.release_runtime_controls
   WHERE control_key = 'write_pause'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'write_pause control row is missing';
  END IF;

  IF v_control.revision <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'applied', false,
      'code', 'revision_conflict',
      'control', to_jsonb(v_control)
    );
  END IF;

  IF p_target_state = 'draining' AND v_control.state <> 'paused' THEN
    RETURN jsonb_build_object(
      'applied', false,
      'code', 'invalid_transition',
      'control', to_jsonb(v_control)
    );
  END IF;

  UPDATE public.release_runtime_controls
     SET state = p_target_state,
         reason = btrim(p_reason),
         changed_by = btrim(p_changed_by)
   WHERE control_key = 'write_pause'
  RETURNING * INTO v_control;

  RETURN jsonb_build_object(
    'applied', true,
    'code', 'state_changed',
    'control', to_jsonb(v_control)
  );
END;
$$;

-- The final queue check and state transition share the same control-row lock
-- used by webhook reservation. A delivery therefore either queues before this
-- count or waits, observes open, and becomes a normal delivery afterward.
CREATE OR REPLACE FUNCTION public.complete_write_pause_drain(
  p_expected_revision BIGINT,
  p_reason TEXT,
  p_changed_by TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_control public.release_runtime_controls%ROWTYPE;
  v_remaining BIGINT := 0;
BEGIN
  IF NULLIF(btrim(p_reason), '') IS NULL
    OR NULLIF(btrim(p_changed_by), '') IS NULL
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'reason and changed_by are required';
  END IF;

  SELECT *
    INTO v_control
    FROM public.release_runtime_controls
   WHERE control_key = 'write_pause'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'write_pause control row is missing';
  END IF;

  IF v_control.revision <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'applied', false,
      'opened', false,
      'code', 'revision_conflict',
      'remaining', NULL,
      'control', to_jsonb(v_control)
    );
  END IF;

  IF v_control.state = 'open' THEN
    RETURN jsonb_build_object(
      'applied', true,
      'opened', true,
      'code', 'already_open',
      'remaining', 0,
      'control', to_jsonb(v_control)
    );
  END IF;

  IF v_control.state <> 'draining' THEN
    RETURN jsonb_build_object(
      'applied', false,
      'opened', false,
      'code', 'invalid_transition',
      'remaining', NULL,
      'control', to_jsonb(v_control)
    );
  END IF;

  SELECT count(*)
    INTO v_remaining
    FROM public.stripe_webhook_events AS swe
   WHERE swe.processed IS FALSE
     AND (
       swe.maintenance_deferred_at IS NOT NULL
       OR swe.in_flight IS TRUE
     );

  IF v_remaining > 0 THEN
    RETURN jsonb_build_object(
      'applied', false,
      'opened', false,
      'code', 'queue_not_empty',
      'remaining', v_remaining,
      'control', to_jsonb(v_control)
    );
  END IF;

  UPDATE public.release_runtime_controls
     SET state = 'open',
         reason = btrim(p_reason),
         changed_by = btrim(p_changed_by)
   WHERE control_key = 'write_pause'
  RETURNING * INTO v_control;

  RETURN jsonb_build_object(
    'applied', true,
    'opened', true,
    'code', 'drain_complete',
    'remaining', 0,
    'control', to_jsonb(v_control)
  );
END;
$$;

-- Token-aware, state-aware reservation used by the new application release.
-- The seventh argument avoids breaking a schema-first deployment of the
-- previous six-argument caller while making every new reservation fenced.
CREATE OR REPLACE FUNCTION public.reserve_stripe_webhook_event(
  p_stripe_event_id TEXT,
  p_event_type TEXT,
  p_payload JSONB,
  p_source TEXT,
  p_endpoint_path TEXT,
  p_livemode BOOLEAN,
  p_replay_authorized BOOLEAN
) RETURNS TABLE (
  existed BOOLEAN,
  in_flight BOOLEAN,
  completed BOOLEAN,
  reserved_now BOOLEAN,
  processed_at TIMESTAMPTZ,
  reservation_token UUID,
  deferred BOOLEAN,
  control_state TEXT,
  queued_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_control_state TEXT;
  v_existing public.stripe_webhook_events%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_should_defer BOOLEAN;
  v_token UUID;
BEGIN
  SELECT rrc.state
    INTO v_control_state
    FROM public.release_runtime_controls AS rrc
   WHERE rrc.control_key = 'write_pause'
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'write_pause control row is missing';
  END IF;

  IF COALESCE(p_replay_authorized, false) AND v_control_state <> 'draining' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'authorized webhook replay requires draining state';
  END IF;

  v_should_defer := v_control_state IN ('paused', 'draining')
    AND NOT (v_control_state = 'draining' AND COALESCE(p_replay_authorized, false));
  v_token := CASE WHEN v_should_defer THEN NULL ELSE gen_random_uuid() END;

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
    processing_outcome,
    received_at,
    in_flight,
    reserved_at,
    reservation_token,
    maintenance_deferred_at
  )
  VALUES (
    p_stripe_event_id,
    p_event_type,
    COALESCE(p_payload, '{}'::jsonb),
    p_source,
    p_endpoint_path,
    COALESCE(p_livemode, false),
    false,
    NULL,
    NULL,
    CASE WHEN v_should_defer THEN 'deferred_maintenance' ELSE 'received' END,
    v_now,
    NOT v_should_defer,
    CASE WHEN v_should_defer THEN NULL ELSE v_now END,
    v_token,
    CASE WHEN v_should_defer THEN v_now ELSE NULL END
  )
  ON CONFLICT (stripe_event_id, endpoint_path) DO NOTHING
  RETURNING * INTO v_existing;

  IF v_existing.id IS NOT NULL THEN
    RETURN QUERY SELECT
      false,
      NOT v_should_defer,
      false,
      NOT v_should_defer,
      NULL::timestamptz,
      v_token,
      v_should_defer,
      v_control_state,
      CASE WHEN v_should_defer THEN v_now ELSE NULL::timestamptz END;
    RETURN;
  END IF;

  SELECT swe.*
    INTO v_existing
    FROM public.stripe_webhook_events AS swe
   WHERE swe.stripe_event_id = p_stripe_event_id
     AND swe.endpoint_path = p_endpoint_path
   FOR UPDATE;

  IF v_existing.completed_at IS NOT NULL OR v_existing.processed IS TRUE THEN
    UPDATE public.stripe_webhook_events AS swe
       SET duplicate_count = swe.duplicate_count + 1
     WHERE swe.id = v_existing.id;

    RETURN QUERY SELECT
      true,
      false,
      true,
      false,
      COALESCE(v_existing.completed_at, v_existing.processed_at),
      NULL::uuid,
      false,
      v_control_state,
      NULL::timestamptz;
    RETURN;
  END IF;

  -- Never steal an active lease. In particular, a duplicate external
  -- delivery during draining cannot fence out the authorized replay owner.
  IF v_existing.in_flight IS TRUE THEN
    RETURN QUERY SELECT
      true,
      true,
      false,
      false,
      NULL::timestamptz,
      NULL::uuid,
      false,
      v_control_state,
      NULL::timestamptz;
    RETURN;
  END IF;

  IF v_should_defer THEN
    UPDATE public.stripe_webhook_events AS swe
       SET event_type = p_event_type,
           payload = COALESCE(p_payload, swe.payload, '{}'::jsonb),
           source = p_source,
           endpoint_path = p_endpoint_path,
           livemode = COALESCE(p_livemode, false),
           processed = false,
           processed_at = NULL,
           completed_at = NULL,
           processing_outcome = 'deferred_maintenance',
           maintenance_deferred_at = v_now,
           in_flight = false,
           reserved_at = NULL,
           reservation_token = NULL,
           last_error = NULL,
           error = NULL,
           received_at = COALESCE(swe.received_at, v_now)
     WHERE swe.id = v_existing.id;

    RETURN QUERY SELECT
      true,
      false,
      false,
      false,
      NULL::timestamptz,
      NULL::uuid,
      true,
      v_control_state,
      v_now;
    RETURN;
  END IF;

  UPDATE public.stripe_webhook_events AS swe
     SET event_type = p_event_type,
         payload = COALESCE(p_payload, swe.payload, '{}'::jsonb),
         source = p_source,
         endpoint_path = p_endpoint_path,
         livemode = COALESCE(p_livemode, false),
         processing_outcome = 'received',
         in_flight = true,
         reserved_at = v_now,
         reservation_token = v_token,
         last_error = NULL,
         error = NULL,
         received_at = COALESCE(swe.received_at, v_now)
   WHERE swe.id = v_existing.id;

  RETURN QUERY SELECT
    true,
    true,
    false,
    true,
    NULL::timestamptz,
    v_token,
    false,
    v_control_state,
    NULL::timestamptz;
END;
$$;

-- Preserve the previous six-argument caller during the schema-first rollout.
-- It receives the old result shape and an unfenced legacy reservation; all new
-- code calls the seven-argument function above and must present its token.
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
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_reservation RECORD;
BEGIN
  SELECT *
    INTO v_reservation
    FROM public.reserve_stripe_webhook_event(
      p_stripe_event_id,
      p_event_type,
      p_payload,
      p_source,
      p_endpoint_path,
      p_livemode,
      false
    );

  IF v_reservation.reserved_now
    AND v_reservation.reservation_token IS NOT NULL
  THEN
    UPDATE public.stripe_webhook_events AS swe
       SET reservation_token = NULL
     WHERE swe.stripe_event_id = p_stripe_event_id
       AND swe.endpoint_path = p_endpoint_path
       AND swe.reservation_token = v_reservation.reservation_token;
  END IF;

  -- A stale/rolling legacy route has no token-aware maintenance branch. Expose
  -- a deferred delivery as already in flight, never as owned by that caller, so
  -- the old normalizer returns 409 without running business side effects. The
  -- event is already durable and the final release replays it while draining.
  RETURN QUERY SELECT
    COALESCE(v_reservation.existed, false),
    CASE WHEN v_reservation.deferred THEN true ELSE COALESCE(v_reservation.in_flight, false) END,
    COALESCE(v_reservation.completed, false),
    CASE WHEN v_reservation.deferred THEN false ELSE COALESCE(v_reservation.reserved_now, false) END,
    v_reservation.processed_at::timestamptz;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_stripe_webhook_event_result(
  p_stripe_event_id TEXT,
  p_event_type TEXT,
  p_payload JSONB,
  p_source TEXT,
  p_endpoint_path TEXT,
  p_livemode BOOLEAN,
  p_processing_outcome TEXT,
  p_processed BOOLEAN,
  p_error TEXT,
  p_reservation_token UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_count INTEGER := 0;
BEGIN
  IF p_reservation_token IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'reservation token is required';
  END IF;

  UPDATE public.stripe_webhook_events AS swe
     SET event_type = p_event_type,
         payload = COALESCE(p_payload, swe.payload, '{}'::jsonb),
         source = p_source,
         endpoint_path = p_endpoint_path,
         livemode = COALESCE(p_livemode, false),
         processed = COALESCE(p_processed, false),
         processed_at = CASE WHEN p_processed THEN v_now ELSE NULL END,
         completed_at = CASE WHEN p_processed THEN v_now ELSE NULL END,
         in_flight = false,
         reservation_token = NULL,
         processing_outcome = p_processing_outcome,
         maintenance_deferred_at = CASE
           WHEN p_processed THEN NULL
           ELSE swe.maintenance_deferred_at
         END,
         last_error = LEFT(p_error, 1000),
         error = LEFT(p_error, 1000),
         received_at = COALESCE(swe.received_at, v_now)
   WHERE swe.stripe_event_id = p_stripe_event_id
     AND swe.endpoint_path = p_endpoint_path
     AND swe.in_flight IS TRUE
     AND swe.reservation_token = p_reservation_token;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Stripe webhook reservation ownership was lost';
  END IF;

  RETURN jsonb_build_object(
    'stripe_event_id', p_stripe_event_id,
    'endpoint_path', p_endpoint_path,
    'processing_outcome', p_processing_outcome,
    'processed', COALESCE(p_processed, false)
  );
END;
$$;

-- The old result function may finish only reservations made by the old
-- six-argument reserve wrapper, which deliberately clears its token.
CREATE OR REPLACE FUNCTION public.record_stripe_webhook_event_result(
  p_stripe_event_id TEXT,
  p_event_type TEXT,
  p_payload JSONB,
  p_source TEXT,
  p_endpoint_path TEXT,
  p_livemode BOOLEAN,
  p_processing_outcome TEXT,
  p_processed BOOLEAN,
  p_error TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_count INTEGER := 0;
BEGIN
  UPDATE public.stripe_webhook_events AS swe
     SET event_type = p_event_type,
         payload = COALESCE(p_payload, swe.payload, '{}'::jsonb),
         source = p_source,
         endpoint_path = p_endpoint_path,
         livemode = COALESCE(p_livemode, false),
         processed = COALESCE(p_processed, false),
         processed_at = CASE WHEN p_processed THEN v_now ELSE NULL END,
         completed_at = CASE WHEN p_processed THEN v_now ELSE NULL END,
         in_flight = false,
         processing_outcome = p_processing_outcome,
         maintenance_deferred_at = CASE
           WHEN p_processed THEN NULL
           ELSE swe.maintenance_deferred_at
         END,
         last_error = LEFT(p_error, 1000),
         error = LEFT(p_error, 1000),
         received_at = COALESCE(swe.received_at, v_now)
   WHERE swe.stripe_event_id = p_stripe_event_id
     AND swe.endpoint_path = p_endpoint_path
     AND swe.in_flight IS TRUE
     AND swe.reservation_token IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'legacy Stripe webhook reservation ownership was lost';
  END IF;

  RETURN jsonb_build_object(
    'stripe_event_id', p_stripe_event_id,
    'endpoint_path', p_endpoint_path,
    'processing_outcome', p_processing_outcome,
    'processed', COALESCE(p_processed, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.defer_stripe_webhook_for_maintenance(
  p_stripe_event_id TEXT,
  p_endpoint_path TEXT,
  p_reservation_token UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_control_state TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_count INTEGER := 0;
BEGIN
  SELECT rrc.state
    INTO v_control_state
    FROM public.release_runtime_controls AS rrc
   WHERE rrc.control_key = 'write_pause'
   FOR SHARE;

  IF v_control_state NOT IN ('paused', 'draining') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'write pause is not blocking';
  END IF;

  UPDATE public.stripe_webhook_events AS swe
     SET processed = false,
         processed_at = NULL,
         completed_at = NULL,
         in_flight = false,
         reservation_token = NULL,
         processing_outcome = 'deferred_maintenance',
         maintenance_deferred_at = v_now,
         last_error = NULL,
         error = NULL
   WHERE swe.stripe_event_id = p_stripe_event_id
     AND swe.endpoint_path = p_endpoint_path
     AND swe.in_flight IS TRUE
     AND swe.reservation_token = p_reservation_token;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Stripe webhook reservation ownership was lost';
  END IF;

  RETURN jsonb_build_object(
    'stripe_event_id', p_stripe_event_id,
    'endpoint_path', p_endpoint_path,
    'queued_at', v_now,
    'control_state', v_control_state
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_stale_stripe_webhook_reservations(
  p_older_than INTERVAL DEFAULT '5 minutes'
) RETURNS TABLE (
  released_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  IF p_older_than < INTERVAL '5 minutes' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Stripe webhook reservation lease must be at least 5 minutes';
  END IF;

  UPDATE public.stripe_webhook_events AS swe
     SET in_flight = false,
         reservation_token = NULL,
         metadata = COALESCE(swe.metadata, '{}'::jsonb)
           || jsonb_build_object('stale_reservation', true),
         last_error = COALESCE(swe.last_error, 'stale reservation released')
   WHERE swe.in_flight IS TRUE
     AND swe.reserved_at < clock_timestamp() - p_older_than;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_release_runtime_control(BIGINT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_write_pause_drain(BIGINT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_stripe_webhook_event(TEXT, TEXT, JSONB, TEXT, TEXT, BOOLEAN, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_stripe_webhook_event(TEXT, TEXT, JSONB, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_stripe_webhook_event_result(TEXT, TEXT, JSONB, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_stripe_webhook_event_result(TEXT, TEXT, JSONB, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.defer_stripe_webhook_for_maintenance(TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_stale_stripe_webhook_reservations(INTERVAL)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.transition_release_runtime_control(BIGINT, TEXT, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_write_pause_drain(BIGINT, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_stripe_webhook_event(TEXT, TEXT, JSONB, TEXT, TEXT, BOOLEAN, BOOLEAN)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_stripe_webhook_event(TEXT, TEXT, JSONB, TEXT, TEXT, BOOLEAN)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_stripe_webhook_event_result(TEXT, TEXT, JSONB, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_stripe_webhook_event_result(TEXT, TEXT, JSONB, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.defer_stripe_webhook_for_maintenance(TEXT, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_stale_stripe_webhook_reservations(INTERVAL)
  TO service_role;
