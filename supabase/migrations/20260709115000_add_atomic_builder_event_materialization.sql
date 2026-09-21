-- Bridge the legacy builder event-creation route onto the planner/billing
-- identity used by builder_event_access_consumptions.
--
-- Prompt 7 will add direct plans <-> events identity columns. Until then this
-- service-only transaction records the exact bridge without weakening the
-- existing consumption FK to plans(id). Prompt 15 Option B treats this atomic
-- materialization as the point where one event access credit is consumed.

CREATE TABLE public.builder_event_materializations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  builder_id UUID NOT NULL REFERENCES public.builder_profiles(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  plan_id UUID REFERENCES public.plans(id) ON DELETE RESTRICT,
  event_id UUID REFERENCES public.events(id) ON DELETE RESTRICT,
  consumption_id UUID REFERENCES public.builder_event_access_consumptions(id) ON DELETE RESTRICT,
  materialized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT builder_event_materializations_idempotency_key_check
    CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  CONSTRAINT builder_event_materializations_payload_hash_check
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT builder_event_materializations_status_check
    CHECK (status IN ('pending', 'materialized')),
  CONSTRAINT builder_event_materializations_completed_state_check
    CHECK (
      (status = 'pending' AND plan_id IS NULL AND event_id IS NULL AND consumption_id IS NULL AND materialized_at IS NULL)
      OR
      (status = 'materialized' AND plan_id IS NOT NULL AND event_id IS NOT NULL AND consumption_id IS NOT NULL AND materialized_at IS NOT NULL)
    ),
  CONSTRAINT builder_event_materializations_user_key_unique
    UNIQUE (user_id, idempotency_key),
  CONSTRAINT builder_event_materializations_plan_unique UNIQUE (plan_id),
  CONSTRAINT builder_event_materializations_event_unique UNIQUE (event_id),
  CONSTRAINT builder_event_materializations_consumption_unique UNIQUE (consumption_id)
);

COMMENT ON TABLE public.builder_event_materializations IS
  'Idempotency and identity bridge for atomic legacy event materialization. Prompt 7 may replace the bridge with direct plan/event FKs after a deterministic backfill.';
COMMENT ON COLUMN public.builder_event_materializations.idempotency_key IS
  'Caller-supplied retry key scoped to one user. Reuse with a different payload is rejected.';
COMMENT ON COLUMN public.builder_event_materializations.payload_hash IS
  'Server-computed SHA-256 of the normalized event materialization payload.';

CREATE INDEX builder_event_materializations_builder_created
  ON public.builder_event_materializations(builder_id, created_at DESC);

ALTER TABLE public.builder_event_materializations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage builder event materializations"
  ON public.builder_event_materializations
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON TABLE public.builder_event_materializations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.builder_event_materializations TO service_role;

CREATE OR REPLACE FUNCTION public.materialize_builder_event_with_access(
  p_user_id UUID,
  p_builder_id UUID,
  p_idempotency_key TEXT,
  p_payload_hash TEXT,
  p_title TEXT,
  p_description TEXT,
  p_event_type TEXT,
  p_event_date DATE,
  p_start_time TIME WITHOUT TIME ZONE,
  p_end_time TIME WITHOUT TIME ZONE,
  p_duration_hours NUMERIC,
  p_expected_attendance INTEGER,
  p_budget_cents INTEGER,
  p_status TEXT
)
RETURNS TABLE (
  plan_id UUID,
  event_id UUID,
  consumption_id UUID,
  access_source TEXT,
  amount_cents INTEGER,
  existing BOOLEAN,
  event_record JSONB
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_request public.builder_event_materializations%ROWTYPE;
  v_plan public.plans%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_consumption public.builder_event_access_consumptions%ROWTYPE;
  v_start_time TIME WITHOUT TIME ZONE;
  v_end_time TIME WITHOUT TIME ZONE;
  v_materialized_at TIMESTAMPTZ := now();
BEGIN
  IF current_user <> 'service_role' OR auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'builder_event_materialization_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_builder_id IS NULL THEN
    RAISE EXCEPTION 'builder_event_materialization_identity_required'
      USING ERRCODE = '22023';
  END IF;

  IF NULLIF(BTRIM(p_idempotency_key), '') IS NULL
    OR char_length(p_idempotency_key) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'builder_event_materialization_invalid_idempotency_key'
      USING ERRCODE = '22023';
  END IF;

  IF p_payload_hash IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'builder_event_materialization_invalid_payload_hash'
      USING ERRCODE = '22023';
  END IF;

  IF NULLIF(BTRIM(p_title), '') IS NULL OR p_event_date IS NULL THEN
    RAISE EXCEPTION 'builder_event_materialization_required_fields'
      USING ERRCODE = '22023';
  END IF;

  IF p_duration_hours IS NULL OR p_duration_hours <= 0 OR p_duration_hours > 24 THEN
    RAISE EXCEPTION 'builder_event_materialization_invalid_duration'
      USING ERRCODE = '22023';
  END IF;

  IF p_expected_attendance IS NOT NULL AND p_expected_attendance < 0 THEN
    RAISE EXCEPTION 'builder_event_materialization_invalid_attendance'
      USING ERRCODE = '22023';
  END IF;

  IF p_budget_cents IS NOT NULL AND p_budget_cents < 0 THEN
    RAISE EXCEPTION 'builder_event_materialization_invalid_budget'
      USING ERRCODE = '22023';
  END IF;

  IF p_status NOT IN ('draft', 'venue_pending', 'confirmed', 'cancelled', 'completed') THEN
    RAISE EXCEPTION 'builder_event_materialization_invalid_status'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.builder_profiles AS builder
    WHERE builder.id = p_builder_id
      AND builder.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'builder_event_materialization_builder_mismatch'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.builder_event_materializations (
    user_id,
    builder_id,
    idempotency_key,
    payload_hash
  ) VALUES (
    p_user_id,
    p_builder_id,
    BTRIM(p_idempotency_key),
    p_payload_hash
  )
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING * INTO v_request;

  IF NOT FOUND THEN
    SELECT materialization.*
    INTO v_request
    FROM public.builder_event_materializations AS materialization
    WHERE materialization.user_id = p_user_id
      AND materialization.idempotency_key = BTRIM(p_idempotency_key)
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'builder_event_materialization_retry_state_missing';
    END IF;

    IF v_request.payload_hash <> p_payload_hash THEN
      RAISE EXCEPTION 'builder_event_materialization_idempotency_conflict'
        USING ERRCODE = '22023';
    END IF;

    IF v_request.status <> 'materialized'
      OR v_request.plan_id IS NULL
      OR v_request.event_id IS NULL
      OR v_request.consumption_id IS NULL THEN
      RAISE EXCEPTION 'builder_event_materialization_retry_incomplete';
    END IF;

    SELECT plan_row.*
    INTO v_plan
    FROM public.plans AS plan_row
    WHERE plan_row.id = v_request.plan_id;

    SELECT event_row.*
    INTO v_event
    FROM public.events AS event_row
    WHERE event_row.id = v_request.event_id;

    SELECT consumption.*
    INTO v_consumption
    FROM public.builder_event_access_consumptions AS consumption
    WHERE consumption.id = v_request.consumption_id;

    IF v_plan.id IS NULL OR v_event.id IS NULL OR v_consumption.id IS NULL THEN
      RAISE EXCEPTION 'builder_event_materialization_retry_target_missing';
    END IF;

    RETURN QUERY SELECT
      v_plan.id,
      v_event.id,
      v_consumption.id,
      v_consumption.source,
      v_consumption.amount_cents,
      TRUE,
      to_jsonb(v_event);
    RETURN;
  END IF;

  v_start_time := COALESCE(p_start_time, TIME '00:00');
  v_end_time := CASE
    WHEN p_end_time IS NULL OR p_end_time = v_start_time
      THEN (v_start_time + (p_duration_hours * INTERVAL '1 hour'))::TIME
    ELSE p_end_time
  END;

  INSERT INTO public.plans (
    user_id,
    title,
    event_type,
    status,
    guest_count,
    budget_cap_cents,
    date_window_start,
    date_window_end,
    metadata
  ) VALUES (
    p_user_id,
    BTRIM(p_title),
    p_event_type,
    'ready',
    p_expected_attendance,
    p_budget_cents,
    p_event_date,
    p_event_date,
    jsonb_build_object(
      'identity_bridge', jsonb_build_object(
        'source', 'builder_events_api',
        'materialization_request_id', v_request.id,
        'idempotency_key', BTRIM(p_idempotency_key),
        'payload_hash', p_payload_hash
      )
    )
  )
  RETURNING * INTO v_plan;

  INSERT INTO public.events (
    builder_id,
    event_name,
    event_description,
    description,
    event_type,
    event_date,
    start_time,
    end_time,
    duration_hours,
    expected_attendance,
    expected_attendance_min,
    expected_attendance_max,
    budget,
    total_budget,
    status,
    venue_id
  ) VALUES (
    p_builder_id,
    BTRIM(p_title),
    p_description,
    p_description,
    p_event_type,
    p_event_date,
    v_start_time,
    v_end_time,
    p_duration_hours,
    p_expected_attendance,
    p_expected_attendance,
    p_expected_attendance,
    CASE WHEN p_budget_cents IS NULL THEN NULL ELSE p_budget_cents / 100.0 END,
    CASE WHEN p_budget_cents IS NULL THEN NULL ELSE p_budget_cents / 100.0 END,
    p_status,
    NULL
  )
  RETURNING * INTO v_event;

  SELECT
    consumption.id,
    consumption.builder_id,
    consumption.event_id,
    consumption.source,
    consumption.amount,
    consumption.amount_cents,
    consumption.created_at,
    consumption.updated_at,
    consumption.source_metadata
  INTO v_consumption
  FROM public.consume_builder_event_access(
    p_builder_id,
    v_plan.id,
    2,
    3000,
    7900
  ) AS consumption;

  IF v_consumption.id IS NULL THEN
    RAISE EXCEPTION 'builder_event_materialization_consumption_missing';
  END IF;

  UPDATE public.plans AS plan_row
  SET metadata = COALESCE(plan_row.metadata, '{}'::jsonb) || jsonb_build_object(
    'event_id', v_event.id,
    'identity_bridge', jsonb_build_object(
      'source', 'builder_events_api',
      'materialization_request_id', v_request.id,
      'legacy_event_id', v_event.id,
      'idempotency_key', BTRIM(p_idempotency_key),
      'payload_hash', p_payload_hash,
      'materialized_at', v_materialized_at
    ),
    'product_gate', jsonb_build_object(
      'event_access_consumed_at', v_materialized_at,
      'event_access_source', v_consumption.source,
      'event_access_amount', v_consumption.amount,
      'event_access_amount_cents', v_consumption.amount_cents,
      'event_access_reason', 'event_materialized',
      'point_of_no_return', 'event_materialization'
    )
  )
  WHERE plan_row.id = v_plan.id
  RETURNING * INTO v_plan;

  UPDATE public.builder_event_materializations AS materialization
  SET
    status = 'materialized',
    plan_id = v_plan.id,
    event_id = v_event.id,
    consumption_id = v_consumption.id,
    materialized_at = v_materialized_at,
    updated_at = v_materialized_at
  WHERE materialization.id = v_request.id
  RETURNING * INTO v_request;

  RETURN QUERY SELECT
    v_plan.id,
    v_event.id,
    v_consumption.id,
    v_consumption.source,
    v_consumption.amount_cents,
    FALSE,
    to_jsonb(v_event);
END;
$$;

COMMENT ON FUNCTION public.materialize_builder_event_with_access(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  DATE,
  TIME WITHOUT TIME ZONE,
  TIME WITHOUT TIME ZONE,
  NUMERIC,
  INTEGER,
  INTEGER,
  TEXT
) IS
  'Service-only, SECURITY INVOKER transaction that creates a minimal plan, legacy event, and one plan-keyed access consumption. Same-key retries return the original materialization.';

REVOKE ALL ON FUNCTION public.materialize_builder_event_with_access(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  DATE,
  TIME WITHOUT TIME ZONE,
  TIME WITHOUT TIME ZONE,
  NUMERIC,
  INTEGER,
  INTEGER,
  TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.materialize_builder_event_with_access(
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  DATE,
  TIME WITHOUT TIME ZONE,
  TIME WITHOUT TIME ZONE,
  NUMERIC,
  INTEGER,
  INTEGER,
  TEXT
) TO service_role;
