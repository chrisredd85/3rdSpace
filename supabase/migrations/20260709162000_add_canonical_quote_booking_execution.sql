-- Prompt 8 / P0.5: trusted quote acceptance and canonical booking execution.
--
-- Quote acceptance remains a proposal boundary. It atomically freezes a
-- server-loaded outreach response, creates a concierge-mode agent action and
-- creates the follow-up approval card. A legacy booking row is created only
-- after authorization and exact canonical event materialization.

-- ---------------------------------------------------------------------------
-- Canonical booking provenance (nullable for legacy compatibility)
-- ---------------------------------------------------------------------------

ALTER TABLE public.events
  ADD CONSTRAINT events_id_plan_id_key UNIQUE (id, plan_id);

ALTER TABLE public.approvals
  ADD CONSTRAINT approvals_id_action_plan_id_key
  UNIQUE (id, agent_action_id, plan_id);

ALTER TABLE public.venue_bookings
  ADD COLUMN IF NOT EXISTS plan_id UUID,
  ADD COLUMN IF NOT EXISTS agent_action_id UUID,
  ADD COLUMN IF NOT EXISTS approval_id UUID,
  ADD COLUMN IF NOT EXISTS quoted_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS approved_terms_snapshot JSONB;

ALTER TABLE public.vendor_bookings
  ADD COLUMN IF NOT EXISTS plan_id UUID,
  ADD COLUMN IF NOT EXISTS agent_action_id UUID,
  ADD COLUMN IF NOT EXISTS approval_id UUID,
  ADD COLUMN IF NOT EXISTS quoted_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS approved_terms_snapshot JSONB;

ALTER TABLE public.venue_bookings
  ADD CONSTRAINT venue_bookings_canonical_provenance_shape_check CHECK (
    (
      plan_id IS NULL
      AND agent_action_id IS NULL
      AND approval_id IS NULL
      AND quoted_price_cents IS NULL
      AND approved_terms_snapshot IS NULL
    )
    OR
    (
      plan_id IS NOT NULL
      AND agent_action_id IS NOT NULL
      AND approval_id IS NOT NULL
      AND quoted_price_cents IS NOT NULL
      AND quoted_price_cents >= 0
      AND approved_terms_snapshot IS NOT NULL
      AND jsonb_typeof(approved_terms_snapshot) = 'object'
    )
  ),
  ADD CONSTRAINT venue_bookings_event_plan_consistency_fkey
    FOREIGN KEY (event_id, plan_id)
    REFERENCES public.events(id, plan_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT venue_bookings_action_plan_consistency_fkey
    FOREIGN KEY (agent_action_id, plan_id)
    REFERENCES public.agent_actions(id, plan_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT venue_bookings_approval_action_plan_consistency_fkey
    FOREIGN KEY (approval_id, agent_action_id, plan_id)
    REFERENCES public.approvals(id, agent_action_id, plan_id)
    ON DELETE RESTRICT;

ALTER TABLE public.vendor_bookings
  ADD CONSTRAINT vendor_bookings_canonical_provenance_shape_check CHECK (
    (
      plan_id IS NULL
      AND agent_action_id IS NULL
      AND approval_id IS NULL
      AND quoted_price_cents IS NULL
      AND approved_terms_snapshot IS NULL
    )
    OR
    (
      plan_id IS NOT NULL
      AND agent_action_id IS NOT NULL
      AND approval_id IS NOT NULL
      AND quoted_price_cents IS NOT NULL
      AND quoted_price_cents >= 0
      AND approved_terms_snapshot IS NOT NULL
      AND jsonb_typeof(approved_terms_snapshot) = 'object'
    )
  ),
  ADD CONSTRAINT vendor_bookings_event_plan_consistency_fkey
    FOREIGN KEY (event_id, plan_id)
    REFERENCES public.events(id, plan_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT vendor_bookings_action_plan_consistency_fkey
    FOREIGN KEY (agent_action_id, plan_id)
    REFERENCES public.agent_actions(id, plan_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT vendor_bookings_approval_action_plan_consistency_fkey
    FOREIGN KEY (approval_id, agent_action_id, plan_id)
    REFERENCES public.approvals(id, agent_action_id, plan_id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX venue_bookings_one_canonical_row_per_action
  ON public.venue_bookings(agent_action_id)
  WHERE agent_action_id IS NOT NULL;

CREATE UNIQUE INDEX vendor_bookings_one_canonical_row_per_action
  ON public.vendor_bookings(agent_action_id)
  WHERE agent_action_id IS NOT NULL;

CREATE UNIQUE INDEX venue_bookings_one_canonical_row_per_approval
  ON public.venue_bookings(approval_id)
  WHERE approval_id IS NOT NULL;

CREATE UNIQUE INDEX vendor_bookings_one_canonical_row_per_approval
  ON public.vendor_bookings(approval_id)
  WHERE approval_id IS NOT NULL;

COMMENT ON COLUMN public.venue_bookings.plan_id IS
  'Canonical plan provenance. Null denotes a legacy booking until Prompt 10 migration.';
COMMENT ON COLUMN public.vendor_bookings.plan_id IS
  'Canonical plan provenance. Null denotes a legacy booking until Prompt 10 migration.';
COMMENT ON COLUMN public.venue_bookings.quoted_price_cents IS
  'Authoritative approved venue quote in integer cents; legacy numeric price remains compatibility-only.';
COMMENT ON COLUMN public.vendor_bookings.quoted_price_cents IS
  'Authoritative approved vendor quote in integer cents; legacy numeric price remains compatibility-only.';

-- ---------------------------------------------------------------------------
-- Atomic trusted quote staging
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.stage_plan_quote_booking(
  p_plan_id UUID,
  p_actor_id UUID,
  p_quote_kind TEXT,
  p_response_id UUID,
  p_action_id UUID,
  p_approval_id UUID,
  p_expires_at TIMESTAMPTZ,
  p_action_payload JSONB,
  p_snapshot_json JSONB,
  p_snapshot_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_action public.agent_actions%ROWTYPE;
  v_approval public.approvals%ROWTYPE;
  v_message public.plan_messages%ROWTYPE;
  v_discovery_id UUID;
  v_partner_name TEXT;
  v_service_type TEXT;
  v_amount_cents INTEGER;
  v_deal_model TEXT;
  v_terms JSONB;
  v_quote JSONB;
  v_existing_vendors JSONB;
  v_next_vendors JSONB;
  v_metadata JSONB;
  v_accepted_state JSONB;
  v_booking_slot TEXT;
  v_event_date DATE;
BEGIN
  IF current_user <> 'postgres'
    AND NOT (current_user = 'service_role' AND auth.role() = 'service_role')
  THEN
    RAISE EXCEPTION 'stage_plan_quote_booking_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_quote_kind NOT IN ('venue', 'vendor')
    OR p_actor_id IS NULL
    OR p_response_id IS NULL
    OR p_action_id IS NULL
    OR p_approval_id IS NULL
    OR p_expires_at IS NULL
    OR p_expires_at <= transaction_timestamp()
    OR jsonb_typeof(p_action_payload) IS DISTINCT FROM 'object'
    OR p_action_payload ->> 'kind' IS DISTINCT FROM 'canonical_quote_booking'
    OR p_action_payload ->> 'quote_kind' IS DISTINCT FROM p_quote_kind
    OR p_action_payload ->> 'quote_response_id' IS DISTINCT FROM p_response_id::TEXT
    OR jsonb_typeof(p_snapshot_json) IS DISTINCT FROM 'object'
    OR p_snapshot_json ->> 'schema_version' IS DISTINCT FROM '2'
    OR p_snapshot_hash !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'stage_plan_quote_booking_invalid_contract'
      USING ERRCODE = '22023';
  END IF;

  SELECT plan_row.*
  INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stage_plan_quote_booking_plan_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_plan.user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'stage_plan_quote_booking_actor_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (
    (
      v_plan.materialized_event_id IS NULL
      AND v_plan.status::TEXT IN ('drafting', 'ready')
    )
    OR
    (
      v_plan.materialized_event_id IS NOT NULL
      AND v_plan.status::TEXT IN ('executing', 'booked')
      AND EXISTS (
        SELECT 1
        FROM public.events AS event_row
        WHERE event_row.id = v_plan.materialized_event_id
          AND event_row.plan_id = v_plan.id
      )
    )
  )
  THEN
    RAISE EXCEPTION 'stage_plan_quote_booking_requires_mutable_plan'
      USING ERRCODE = '23514', DETAIL = v_plan.status::TEXT;
  END IF;

  -- Before materialization the plan must already name one exact date. After
  -- materialization the reciprocal canonical event is the exact date source.
  IF v_plan.materialized_event_id IS NULL THEN
    IF v_plan.date_window_start IS NULL
      OR v_plan.date_window_end IS NULL
      OR v_plan.date_window_start IS DISTINCT FROM v_plan.date_window_end
    THEN
      RAISE EXCEPTION 'stage_plan_quote_booking_exact_date_required'
        USING ERRCODE = '23514';
    END IF;
    v_event_date := v_plan.date_window_start;
  ELSE
    SELECT event_row.event_date
    INTO v_event_date
    FROM public.events AS event_row
    WHERE event_row.id = v_plan.materialized_event_id
      AND event_row.plan_id = v_plan.id
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'stage_plan_quote_booking_reciprocal_event_missing'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF p_quote_kind = 'venue' THEN
    SELECT
      response.discovery_venue_id,
      venue.name,
      response.quoted_price_cents,
      response.quoted_deal_model,
      jsonb_build_object(
        'source', 'trusted_outreach_response',
        'response_id', response.id,
        'classification', response.classification,
        'classification_confidence', response.classification_confidence,
        'availability_confirmed', response.availability_confirmed,
        'capacity_confirmed', response.capacity_confirmed,
        'quoted_price_cents', response.quoted_price_cents,
        'quoted_deal_model', response.quoted_deal_model,
        'conditions', COALESCE(response.conditions, '[]'::jsonb),
        'raw_response_excerpt', response.raw_response_excerpt,
        'extracted_at', response.extracted_at
      )
    INTO v_discovery_id, v_partner_name, v_amount_cents, v_deal_model, v_terms
    FROM public.venue_outreach_responses AS response
    JOIN public.discovery_venues AS venue ON venue.id = response.discovery_venue_id
    WHERE response.id = p_response_id
      AND response.plan_id = p_plan_id
    FOR KEY SHARE OF response, venue;
  ELSE
    SELECT
      response.discovery_vendor_id,
      vendor.name,
      vendor.service_type,
      COALESCE(
        response.quoted_package_cents,
        response.quoted_minimum_cents,
        response.quoted_hourly_cents
      ),
      jsonb_build_object(
        'source', 'trusted_outreach_response',
        'response_id', response.id,
        'classification', response.classification,
        'classification_confidence', response.classification_confidence,
        'availability_confirmed', response.availability_confirmed,
        'quoted_hourly_cents', response.quoted_hourly_cents,
        'quoted_package_cents', response.quoted_package_cents,
        'quoted_minimum_cents', response.quoted_minimum_cents,
        'quoted_deposit_pct', response.quoted_deposit_pct,
        'conditions', COALESCE(response.conditions, '[]'::jsonb),
        'raw_response_excerpt', response.raw_response_excerpt,
        'extracted_at', response.extracted_at
      )
    INTO v_discovery_id, v_partner_name, v_service_type, v_amount_cents, v_terms
    FROM public.vendor_outreach_responses AS response
    JOIN public.discovery_vendors AS vendor ON vendor.id = response.discovery_vendor_id
    WHERE response.id = p_response_id
      AND response.plan_id = p_plan_id
    FOR KEY SHARE OF response, vendor;
  END IF;

  IF v_discovery_id IS NULL THEN
    RAISE EXCEPTION 'stage_plan_quote_booking_response_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  -- A plan-owned response is trusted provenance, but a decline or an explicit
  -- unavailable response is never a bookable quote.
  IF v_terms ->> 'classification' = 'no'
    OR v_terms ->> 'availability_confirmed' = 'false'
    OR (
      COALESCE(v_terms ->> 'classification', '') NOT IN ('yes', 'conditional', 'quote_received')
      AND v_terms ->> 'availability_confirmed' IS DISTINCT FROM 'true'
      AND v_amount_cents IS NULL
    )
  THEN
    RAISE EXCEPTION 'stage_plan_quote_booking_response_not_actionable'
      USING ERRCODE = '23514';
  END IF;

  -- Never reinterpret an extraction miss as a free booking. Only a venue
  -- response with an explicit zero-upfront commercial model may freeze at 0.
  IF v_amount_cents IS NULL
    AND NOT (
      p_quote_kind = 'venue'
      AND regexp_replace(lower(btrim(COALESCE(v_deal_model, ''))), '[^a-z0-9]+', '_', 'g') IN (
        'free_space', 'complimentary', 'comped', 'chi',
        'community_host_incentive', 'bar_consumption_chi', 'ticket_chi',
        'per_head_chi', 'consumption_share',
        'bar_consumption_share', 'ticket_consumption_share'
      )
    )
  THEN
    RAISE EXCEPTION 'stage_plan_quote_booking_price_required'
      USING ERRCODE = '23514';
  END IF;

  v_amount_cents := COALESCE(v_amount_cents, 0);
  v_booking_slot := CASE
    WHEN p_quote_kind = 'venue' THEN 'venue'
    ELSE 'vendor:' || COALESCE(NULLIF(btrim(v_service_type), ''), 'other')
  END;

  IF p_action_payload ->> 'target_id' IS DISTINCT FROM v_discovery_id::TEXT
    OR p_action_payload ->> 'booking_slot' IS DISTINCT FROM v_booking_slot
    OR p_action_payload ->> 'event_date' IS DISTINCT FROM v_event_date::TEXT
    OR COALESCE((p_action_payload ->> 'requested_amount_cents')::INTEGER, -1)
      IS DISTINCT FROM v_amount_cents
  THEN
    RAISE EXCEPTION 'stage_plan_quote_booking_payload_does_not_match_response'
      USING ERRCODE = '23514';
  END IF;

  -- Exact retry returns the original aggregate instead of creating a second
  -- approval or action.
  SELECT action_row.*
  INTO v_action
  FROM public.agent_actions AS action_row
  JOIN public.approvals AS approval_row
    ON approval_row.id = action_row.approval_id
   AND approval_row.agent_action_id = action_row.id
   AND approval_row.plan_id = action_row.plan_id
  WHERE action_row.plan_id = p_plan_id
    AND action_row.payload_json ->> 'kind' = 'canonical_quote_booking'
    AND action_row.payload_json ->> 'quote_response_id' = p_response_id::TEXT
    -- A failed action may already own a durable booking/admin-task side effect.
    -- Keep it as the exact recovery record instead of creating a duplicate.
    AND (
      (
        action_row.status IN ('pending', 'proposed', 'approved', 'executing')
        AND approval_row.status IN ('pending', 'approved', 'authorized', 're_approval_required')
      )
      OR action_row.status IN ('failed', 'complete')
    )
  ORDER BY action_row.created_at
  LIMIT 1;

  IF FOUND THEN
    SELECT approval_row.* INTO v_approval
    FROM public.approvals AS approval_row
    WHERE approval_row.id = v_action.approval_id;

    SELECT message_row.* INTO v_message
    FROM public.plan_messages AS message_row
    WHERE message_row.plan_id = p_plan_id
      AND message_row.metadata ->> 'agent_action_id' = v_action.id::TEXT
      AND message_row.message_type = 'approval_request'
    ORDER BY message_row.created_at
    LIMIT 1;

    RETURN jsonb_build_object(
      'existing', true,
      'plan', to_jsonb(v_plan),
      'agent_action', to_jsonb(v_action),
      'approval', to_jsonb(v_approval),
      'approval_message', to_jsonb(v_message)
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agent_actions AS active_action
    JOIN public.approvals AS active_approval
      ON active_approval.id = active_action.approval_id
     AND active_approval.agent_action_id = active_action.id
    WHERE active_action.plan_id = p_plan_id
      AND active_action.payload_json ->> 'kind' = 'canonical_quote_booking'
      AND active_action.payload_json ->> 'booking_slot' = v_booking_slot
      -- A completed slot is a fulfilled commitment, not free capacity for a
      -- second venue/vendor booking. Replacement needs an explicit later
      -- cancellation/reapproval flow rather than silently stacking bookings.
      AND (
        (
          active_action.status IN ('pending', 'proposed', 'approved', 'executing')
          AND active_approval.status IN ('pending', 'approved', 'authorized', 're_approval_required')
        )
        OR active_action.status IN ('failed', 'complete')
      )
  ) THEN
    RAISE EXCEPTION 'stage_plan_quote_booking_active_slot_exists'
      USING ERRCODE = '23505';
  END IF;

  v_quote := jsonb_build_object(
    CASE WHEN p_quote_kind = 'venue' THEN 'discovery_venue_id' ELSE 'discovery_vendor_id' END,
    v_discovery_id,
    'quote_response_id', p_response_id,
    'service_type', v_service_type,
    'quoted_price_cents', CASE WHEN p_quote_kind = 'venue' THEN v_amount_cents ELSE NULL END,
    'quoted_hourly_cents', CASE
      WHEN p_quote_kind = 'vendor' THEN (v_terms ->> 'quoted_hourly_cents')::INTEGER
      ELSE NULL
    END,
    'quoted_package_cents', CASE
      WHEN p_quote_kind = 'vendor' THEN (v_terms ->> 'quoted_package_cents')::INTEGER
      ELSE NULL
    END,
    'quoted_minimum_cents', CASE
      WHEN p_quote_kind = 'vendor' THEN (v_terms ->> 'quoted_minimum_cents')::INTEGER
      ELSE NULL
    END,
    'quoted_deposit_pct', CASE
      WHEN p_quote_kind = 'vendor' THEN (v_terms ->> 'quoted_deposit_pct')::REAL
      ELSE NULL
    END,
    'quoted_deal_model', v_deal_model,
    'quoted_terms', v_terms,
    'committed_at', transaction_timestamp()
  );

  v_metadata := COALESCE(v_plan.metadata, '{}'::jsonb);
  v_accepted_state := COALESCE(v_metadata -> 'accepted_quote_state', '{}'::jsonb);

  -- P7 intentionally allows trusted quote snapshots before or after exact
  -- materialization. Scope its existing lineage guard to this transaction;
  -- no canonical event fact is modified here.
  IF v_plan.materialized_event_id IS NOT NULL THEN
    PERFORM set_config('app.canonical_plan_lineage_plan_id', v_plan.id::TEXT, true);
  END IF;

  IF p_quote_kind = 'venue' THEN
    v_metadata := v_metadata || jsonb_build_object(
      'committed_venue', v_quote,
      'accepted_quote_state', v_accepted_state || jsonb_build_object(
        'venue', v_quote,
        'updated_at', transaction_timestamp()
      )
    );

    UPDATE public.plans AS plan_row
    SET committed_venue_id = v_discovery_id,
        committed_venue_quoted_price_cents = v_amount_cents,
        committed_venue_quoted_deal_model = v_deal_model,
        committed_venue_quoted_terms = v_terms,
        committed_venue_at = transaction_timestamp(),
        metadata = v_metadata
    WHERE plan_row.id = p_plan_id
    RETURNING plan_row.* INTO v_plan;

    UPDATE public.plan_discovery_venue_candidates
    SET status = 'superseded'
    WHERE plan_id = p_plan_id
      AND discovery_venue_id <> v_discovery_id
      AND status IN ('candidate', 'approval_created');

    UPDATE public.plan_discovery_venue_candidates
    SET status = 'approval_created'
    WHERE plan_id = p_plan_id
      AND discovery_venue_id = v_discovery_id
      AND status = 'candidate';
  ELSE
    v_existing_vendors := COALESCE(v_plan.committed_vendors, '[]'::jsonb);

    SELECT COALESCE(jsonb_agg(item.value ORDER BY item.ordinality), '[]'::jsonb)
    INTO v_existing_vendors
    FROM jsonb_array_elements(v_existing_vendors) WITH ORDINALITY AS item(value, ordinality)
    WHERE item.value ->> 'service_type' IS DISTINCT FROM v_service_type;

    v_next_vendors := jsonb_build_array(v_quote) || v_existing_vendors;
    v_metadata := v_metadata || jsonb_build_object(
      'committed_vendors', v_next_vendors,
      'accepted_quote_state', v_accepted_state || jsonb_build_object(
        'vendors', v_next_vendors,
        'updated_at', transaction_timestamp()
      )
    );

    UPDATE public.plans AS plan_row
    SET committed_vendors = v_next_vendors,
        metadata = v_metadata
    WHERE plan_row.id = p_plan_id
    RETURNING plan_row.* INTO v_plan;

    UPDATE public.plan_discovery_vendor_candidates
    SET status = 'superseded'
    WHERE plan_id = p_plan_id
      AND service_type = v_service_type
      AND discovery_vendor_id <> v_discovery_id
      AND status IN ('candidate', 'approval_created');

    UPDATE public.plan_discovery_vendor_candidates
    SET status = 'approval_created'
    WHERE plan_id = p_plan_id
      AND discovery_vendor_id = v_discovery_id
      AND status = 'candidate';
  END IF;

  INSERT INTO public.agent_actions (
    id, plan_id, action_type, description, provider, target_type, target_id,
    payload_json, amount_cents, currency, status, result_metadata
  ) VALUES (
    p_action_id,
    p_plan_id,
    'concierge_queue',
    'Prepare booking from accepted ' || p_quote_kind || ' quote',
    v_partner_name,
    CASE WHEN p_quote_kind = 'venue' THEN 'discovery_venue' ELSE 'discovery_vendor' END,
    v_discovery_id,
    p_action_payload,
    v_amount_cents,
    'usd',
    'pending',
    jsonb_build_object(
      'source', 'trusted_outreach_quote',
      'execution_mode', 'concierge_admin_queue',
      'canonical_booking_status', 'approval_required',
      'outbound_message_sent', false
    )
  ) RETURNING * INTO v_action;

  INSERT INTO public.approvals (
    id, plan_id, agent_action_id, action_label, provider, event_date,
    price_cents, fees_cents, package_details, status,
    requested_amount_cents, expires_at, snapshot_hash, snapshot_json,
    snapshot_schema_version, notes
  ) VALUES (
    p_approval_id,
    p_plan_id,
    p_action_id,
    'Approve booking request with ' || v_partner_name,
    v_partner_name,
    v_event_date,
    v_amount_cents,
    0,
    CASE
      WHEN p_quote_kind = 'venue' THEN COALESCE(v_deal_model, 'Venue quote')
      ELSE COALESCE(v_service_type, 'Vendor service')
    END,
    'pending',
    v_amount_cents,
    p_expires_at,
    p_snapshot_hash,
    p_snapshot_json,
    2,
    NULLIF(v_terms ->> 'raw_response_excerpt', '')
  ) RETURNING * INTO v_approval;

  UPDATE public.agent_actions
  SET approval_id = v_approval.id
  WHERE id = v_action.id
  RETURNING * INTO v_action;

  INSERT INTO public.agent_action_audit_log (
    action_id, plan_id, from_status, to_status, actor_id, actor_role,
    reason, metadata
  ) VALUES (
    v_action.id, p_plan_id, NULL, v_action.status, p_actor_id, 'user',
    'canonical_quote_booking.staged',
    jsonb_build_object('quote_response_id', p_response_id, 'quote_kind', p_quote_kind)
  );

  INSERT INTO public.plan_messages (
    plan_id, role, content, message_type, metadata
  ) VALUES (
    p_plan_id,
    'agent',
    'The ' || p_quote_kind || ' quote from ' || v_partner_name ||
      ' is frozen for review. Approve it before 3rdPlace creates any booking request.',
    'approval_request',
    jsonb_build_object(
      'state', 'canonical_quote_booking_approval_requested',
      'status', 'pending',
      'source', 'trusted_outreach_quote',
      'approval', to_jsonb(v_approval),
      'agent_action_id', v_action.id,
      'quote_response_id', p_response_id,
      'quote_kind', p_quote_kind
    )
  ) RETURNING * INTO v_message;

  RETURN jsonb_build_object(
    'existing', false,
    'plan', to_jsonb(v_plan),
    'agent_action', to_jsonb(v_action),
    'approval', to_jsonb(v_approval),
    'approval_message', to_jsonb(v_message)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.stage_plan_quote_booking(
  UUID, UUID, TEXT, UUID, UUID, UUID, TIMESTAMPTZ, JSONB, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_plan_quote_booking(
  UUID, UUID, TEXT, UUID, UUID, UUID, TIMESTAMPTZ, JSONB, JSONB, TEXT
) TO service_role;

-- A pending quote acceptance is one aggregate: quote metadata, action, and
-- approval are cancelled together. This prevents the old DELETE route from
-- hiding a still-authorizable approval behind cleared plan metadata.
CREATE OR REPLACE FUNCTION public.cancel_staged_plan_quote_booking(
  p_plan_id UUID,
  p_actor_id UUID,
  p_quote_kind TEXT,
  p_response_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_action public.agent_actions%ROWTYPE;
  v_approval public.approvals%ROWTYPE;
  v_action_from_status TEXT;
  v_metadata JSONB;
  v_accepted_state JSONB;
  v_next_vendors JSONB;
  v_discovery_id UUID;
BEGIN
  IF current_user <> 'postgres'
    AND NOT (current_user = 'service_role' AND auth.role() = 'service_role')
  THEN
    RAISE EXCEPTION 'cancel_staged_plan_quote_booking_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_quote_kind NOT IN ('venue', 'vendor')
    OR p_actor_id IS NULL
    OR p_response_id IS NULL
  THEN
    RAISE EXCEPTION 'cancel_staged_plan_quote_booking_invalid_contract'
      USING ERRCODE = '22023';
  END IF;

  SELECT plan_row.*
  INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_staged_plan_quote_booking_plan_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_plan.user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'cancel_staged_plan_quote_booking_actor_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (
    (
      v_plan.materialized_event_id IS NULL
      AND v_plan.status::TEXT IN ('drafting', 'ready')
    )
    OR
    (
      v_plan.materialized_event_id IS NOT NULL
      AND v_plan.status::TEXT IN ('executing', 'booked')
      AND EXISTS (
        SELECT 1
        FROM public.events AS event_row
        WHERE event_row.id = v_plan.materialized_event_id
          AND event_row.plan_id = v_plan.id
      )
    )
  )
  THEN
    RAISE EXCEPTION 'cancel_staged_plan_quote_booking_requires_reapproval'
      USING ERRCODE = '23514', DETAIL = v_plan.status::TEXT;
  END IF;

  SELECT action_row.*
  INTO v_action
  FROM public.agent_actions AS action_row
  WHERE action_row.plan_id = p_plan_id
    AND action_row.payload_json ->> 'kind' = 'canonical_quote_booking'
    AND action_row.payload_json ->> 'quote_kind' = p_quote_kind
    AND action_row.payload_json ->> 'quote_response_id' = p_response_id::TEXT
  ORDER BY action_row.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_staged_plan_quote_booking_action_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT approval_row.*
  INTO v_approval
  FROM public.approvals AS approval_row
  WHERE approval_row.id = v_action.approval_id
    AND approval_row.agent_action_id = v_action.id
    AND approval_row.plan_id = v_action.plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_staged_plan_quote_booking_approval_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_action.status = 'cancelled'
    AND v_approval.status IN ('cancelled', 'rejected')
  THEN
    RETURN jsonb_build_object(
      'existing', true,
      'plan', to_jsonb(v_plan),
      'agent_action', to_jsonb(v_action),
      'approval', to_jsonb(v_approval)
    );
  END IF;

  IF v_action.status NOT IN ('pending', 'proposed')
    OR v_approval.status <> 'pending'
  THEN
    RAISE EXCEPTION 'cancel_staged_plan_quote_booking_requires_pending_approval'
      USING ERRCODE = '23514',
            DETAIL = v_action.status || '|' || v_approval.status;
  END IF;

  v_action_from_status := v_action.status;
  v_discovery_id := (v_action.payload_json ->> 'target_id')::UUID;

  UPDATE public.approvals
  SET status = 'cancelled'
  WHERE id = v_approval.id
    AND status = 'pending'
  RETURNING * INTO v_approval;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_staged_plan_quote_booking_approval_race'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.agent_actions
  SET status = 'cancelled',
      result_metadata = COALESCE(result_metadata, '{}'::jsonb) || jsonb_build_object(
        'canonical_booking_status', 'cancelled_before_authorization',
        'cancelled_at', transaction_timestamp(),
        'outbound_message_sent', false
      )
  WHERE id = v_action.id
    AND status = v_action_from_status
  RETURNING * INTO v_action;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_staged_plan_quote_booking_action_race'
      USING ERRCODE = '40001';
  END IF;

  v_metadata := COALESCE(v_plan.metadata, '{}'::jsonb);
  v_accepted_state := COALESCE(v_metadata -> 'accepted_quote_state', '{}'::jsonb);

  IF v_plan.materialized_event_id IS NOT NULL THEN
    PERFORM set_config('app.canonical_plan_lineage_plan_id', v_plan.id::TEXT, true);
  END IF;

  IF p_quote_kind = 'venue' THEN
    UPDATE public.plans AS plan_row
    SET committed_venue_id = NULL,
        committed_venue_quoted_price_cents = NULL,
        committed_venue_quoted_deal_model = NULL,
        committed_venue_quoted_terms = NULL,
        committed_venue_at = NULL,
        metadata = v_metadata || jsonb_build_object(
          'committed_venue', NULL,
          'accepted_quote_state', v_accepted_state || jsonb_build_object(
            'venue', NULL,
            'updated_at', transaction_timestamp()
          )
        )
    WHERE plan_row.id = v_plan.id
    RETURNING plan_row.* INTO v_plan;

    UPDATE public.plan_discovery_venue_candidates
    SET status = 'candidate'
    WHERE plan_id = p_plan_id
      AND discovery_venue_id = v_discovery_id
      AND status = 'approval_created';
  ELSE
    SELECT COALESCE(jsonb_agg(item.value ORDER BY item.ordinality), '[]'::jsonb)
    INTO v_next_vendors
    FROM jsonb_array_elements(COALESCE(v_plan.committed_vendors, '[]'::jsonb))
      WITH ORDINALITY AS item(value, ordinality)
    WHERE item.value ->> 'quote_response_id' IS DISTINCT FROM p_response_id::TEXT;

    UPDATE public.plans AS plan_row
    SET committed_vendors = v_next_vendors,
        metadata = v_metadata || jsonb_build_object(
          'committed_vendors', v_next_vendors,
          'accepted_quote_state', v_accepted_state || jsonb_build_object(
            'vendors', v_next_vendors,
            'updated_at', transaction_timestamp()
          )
        )
    WHERE plan_row.id = v_plan.id
    RETURNING plan_row.* INTO v_plan;

    UPDATE public.plan_discovery_vendor_candidates
    SET status = 'candidate'
    WHERE plan_id = p_plan_id
      AND discovery_vendor_id = v_discovery_id
      AND status = 'approval_created';
  END IF;

  INSERT INTO public.agent_action_audit_log (
    action_id, plan_id, from_status, to_status, actor_id, actor_role,
    reason, metadata
  ) VALUES (
    v_action.id, v_plan.id, v_action_from_status, 'cancelled', p_actor_id, 'user',
    'canonical_quote_booking.cancelled_before_authorization',
    jsonb_build_object(
      'quote_response_id', p_response_id,
      'quote_kind', p_quote_kind,
      'approval_id', v_approval.id
    )
  );

  INSERT INTO public.plan_messages (plan_id, role, content, message_type, metadata)
  VALUES (
    v_plan.id,
    'system',
    'Cancelled the accepted ' || p_quote_kind || ' quote and its pending booking approval.',
    'status_update',
    jsonb_build_object(
      'kind', 'canonical_quote_booking_cancelled',
      'quote_kind', p_quote_kind,
      'quote_response_id', p_response_id,
      'agent_action_id', v_action.id,
      'approval_id', v_approval.id
    )
  );

  RETURN jsonb_build_object(
    'existing', false,
    'plan', to_jsonb(v_plan),
    'agent_action', to_jsonb(v_action),
    'approval', to_jsonb(v_approval)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_staged_plan_quote_booking(UUID, UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_staged_plan_quote_booking(UUID, UUID, TEXT, UUID)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Idempotent canonical booking creation after exact event materialization
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_canonical_booking_from_approval(
  p_plan_id UUID,
  p_agent_action_id UUID,
  p_approval_id UUID,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_action public.agent_actions%ROWTYPE;
  v_approval public.approvals%ROWTYPE;
  v_venue_booking public.venue_bookings%ROWTYPE;
  v_vendor_booking public.vendor_bookings%ROWTYPE;
  v_quote_kind TEXT;
  v_discovery_id UUID;
  v_partner_id UUID;
  v_amount_cents INTEGER;
  v_action_from_status TEXT;
BEGIN
  IF current_user <> 'postgres'
    AND NOT (current_user = 'service_role' AND auth.role() = 'service_role')
  THEN
    RAISE EXCEPTION 'create_canonical_booking_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT plan_row.*
  INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = p_plan_id
    AND plan_row.materialized_event_id IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'disposition', 'waiting',
      'reason', 'event_materialization_required',
      'plan_id', p_plan_id
    );
  END IF;

  SELECT event_row.*
  INTO v_event
  FROM public.events AS event_row
  WHERE event_row.id = v_plan.materialized_event_id
    AND event_row.plan_id = v_plan.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_canonical_booking_reciprocal_event_missing'
      USING ERRCODE = '23514';
  END IF;

  IF v_plan.user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'create_canonical_booking_actor_mismatch'
      USING ERRCODE = '42501';
  END IF;

  SELECT action_row.*
  INTO v_action
  FROM public.agent_actions AS action_row
  WHERE action_row.id = p_agent_action_id
    AND action_row.plan_id = p_plan_id
    AND action_row.approval_id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_action.payload_json ->> 'kind' IS DISTINCT FROM 'canonical_quote_booking'
  THEN
    RAISE EXCEPTION 'create_canonical_booking_action_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT approval_row.*
  INTO v_approval
  FROM public.approvals AS approval_row
  WHERE approval_row.id = p_approval_id
    AND approval_row.agent_action_id = v_action.id
    AND approval_row.plan_id = v_action.plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_canonical_booking_approval_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_approval.status NOT IN ('approved', 'authorized')
    OR v_approval.authorized_by IS DISTINCT FROM p_actor_id
    OR v_approval.authorized_at IS NULL
    OR NULLIF(btrim(v_approval.snapshot_hash), '') IS NULL
    OR (v_approval.expires_at IS NOT NULL AND v_approval.expires_at <= transaction_timestamp())
  THEN
    RAISE EXCEPTION 'create_canonical_booking_requires_executable_approval'
      USING ERRCODE = '23514';
  END IF;

  IF v_action.status NOT IN ('approved', 'executing') THEN
    RAISE EXCEPTION 'create_canonical_booking_action_not_executable'
      USING ERRCODE = '23514', DETAIL = v_action.status;
  END IF;

  v_action_from_status := v_action.status;

  IF v_plan.status::TEXT <> 'executing' THEN
    IF v_plan.status::TEXT = 'booked' THEN
      -- A prior exact confirmation may have completed this aggregate.
      NULL;
    ELSE
      RAISE EXCEPTION 'create_canonical_booking_plan_not_executing'
        USING ERRCODE = '23514', DETAIL = v_plan.status::TEXT;
    END IF;
  END IF;

  IF v_approval.event_date IS DISTINCT FROM v_event.event_date THEN
    RAISE EXCEPTION 'create_canonical_booking_approved_date_mismatch'
      USING ERRCODE = '23514';
  END IF;

  v_quote_kind := v_action.payload_json ->> 'quote_kind';
  v_discovery_id := (v_action.payload_json ->> 'target_id')::UUID;
  v_amount_cents := COALESCE(v_action.amount_cents, 0);

  IF v_amount_cents IS DISTINCT FROM v_approval.requested_amount_cents
    OR v_amount_cents IS DISTINCT FROM v_approval.price_cents
  THEN
    RAISE EXCEPTION 'create_canonical_booking_approved_amount_mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT booking.* INTO v_venue_booking
  FROM public.venue_bookings AS booking
  WHERE booking.agent_action_id = v_action.id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'disposition', 'executing',
      'existing', true,
      'booking_kind', 'venue',
      'booking_id', v_venue_booking.id,
      'booking_status', v_venue_booking.status,
      'event_id', v_event.id
    );
  END IF;

  SELECT booking.* INTO v_vendor_booking
  FROM public.vendor_bookings AS booking
  WHERE booking.agent_action_id = v_action.id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'disposition', 'executing',
      'existing', true,
      'booking_kind', 'vendor',
      'booking_id', v_vendor_booking.id,
      'booking_status', v_vendor_booking.status,
      'event_id', v_event.id
    );
  END IF;

  IF v_quote_kind = 'venue' THEN
    SELECT venue.claimed_venue_id
    INTO v_partner_id
    FROM public.discovery_venues AS venue
    WHERE venue.id = v_discovery_id;
  ELSIF v_quote_kind = 'vendor' THEN
    SELECT vendor.id
    INTO v_partner_id
    FROM public.vendor_profiles AS vendor
    WHERE vendor.discovery_vendor_id = v_discovery_id
    ORDER BY vendor.created_at, vendor.id
    LIMIT 1;
  ELSE
    RAISE EXCEPTION 'create_canonical_booking_unknown_quote_kind'
      USING ERRCODE = '22023';
  END IF;

  IF v_partner_id IS NULL THEN
    RETURN jsonb_build_object(
      'disposition', 'waiting',
      'reason', 'requires_concierge',
      'requires_concierge', true,
      'quote_kind', v_quote_kind,
      'discovery_id', v_discovery_id,
      'event_id', v_event.id,
      'approval_id', v_approval.id
    );
  END IF;

  IF v_quote_kind = 'venue' THEN
    INSERT INTO public.venue_bookings (
      venue_id, event_id, organizer_id, booking_date, start_time, end_time,
      guest_count_min, guest_count_max, status, quoted_price, subtotal,
      total_amount, payment_status, plan_id, agent_action_id, approval_id,
      quoted_price_cents, approved_terms_snapshot
    ) VALUES (
      v_partner_id, v_event.id, v_plan.user_id, v_event.event_date,
      v_event.start_time, v_event.end_time, v_event.expected_attendance_min,
      v_event.expected_attendance_max, 'pending', v_amount_cents::NUMERIC / 100,
      v_amount_cents::NUMERIC / 100, v_amount_cents::NUMERIC / 100, 'pending',
      v_plan.id, v_action.id, v_approval.id, v_amount_cents, v_approval.snapshot_json
    )
    RETURNING * INTO v_venue_booking;

    -- Existing venue preferences can automatically confirm a pending request.
    -- When that happens, keep the agent action in sync with the externally
    -- confirmed booking instead of leaving an executing action orphaned.
    IF v_venue_booking.status = 'confirmed' THEN
      UPDATE public.agent_actions
      SET status = 'complete',
          executed_at = transaction_timestamp(),
          result_metadata = COALESCE(result_metadata, '{}'::jsonb) || jsonb_build_object(
            'canonical_booking_status', 'confirmed',
            'booking_id', v_venue_booking.id,
            'booking_kind', 'venue',
            'event_id', v_event.id,
            'confirmation_source', COALESCE(v_venue_booking.approval_source, 'partner_auto_approval')
          )
      WHERE id = v_action.id
      RETURNING * INTO v_action;

      INSERT INTO public.agent_action_audit_log (
        action_id, plan_id, from_status, to_status, actor_id, actor_role,
        reason, metadata
      ) VALUES (
        v_action.id, v_plan.id, v_action_from_status, 'complete', NULL, 'system',
        'canonical_quote_booking.partner_auto_confirmed',
        jsonb_build_object(
          'booking_id', v_venue_booking.id,
          'booking_kind', 'venue',
          'event_id', v_event.id,
          'confirmation_source', COALESCE(v_venue_booking.approval_source, 'partner_auto_approval')
        )
      );

      INSERT INTO public.plan_messages (plan_id, role, content, message_type, metadata)
      VALUES (
        v_plan.id,
        'system',
        'The approved venue booking request was confirmed automatically by the venue.',
        'status_update',
        jsonb_build_object(
          'kind', 'canonical_booking_confirmed',
          'booking_kind', 'venue',
          'booking_id', v_venue_booking.id,
          'event_id', v_event.id,
          'agent_action_id', v_action.id,
          'approval_id', v_approval.id
        )
      );

      RETURN jsonb_build_object(
        'disposition', 'executing',
        'existing', false,
        'booking_kind', 'venue',
        'booking_id', v_venue_booking.id,
        'booking_status', v_venue_booking.status,
        'action_status', v_action.status,
        'externally_confirmed', true,
        'event_id', v_event.id
      );
    END IF;

    INSERT INTO public.plan_messages (plan_id, role, content, message_type, metadata)
    VALUES (
      v_plan.id,
      'system',
      'The approved venue booking request is now pending partner confirmation.',
      'status_update',
      jsonb_build_object(
        'kind', 'canonical_booking_created',
        'booking_kind', 'venue',
        'booking_id', v_venue_booking.id,
        'event_id', v_event.id,
        'agent_action_id', v_action.id,
        'approval_id', v_approval.id
      )
    );

    RETURN jsonb_build_object(
      'disposition', 'executing',
      'existing', false,
      'booking_kind', 'venue',
      'booking_id', v_venue_booking.id,
      'booking_status', v_venue_booking.status,
      'event_id', v_event.id
    );
  END IF;

  INSERT INTO public.vendor_bookings (
    vendor_id, event_id, organizer_id, booking_date, start_time, end_time,
    requested_date, requested_start_time, requested_end_time, guest_count,
    status, quoted_price, subtotal, total_amount, payment_status, plan_id,
    agent_action_id, approval_id, quoted_price_cents, approved_terms_snapshot
  ) VALUES (
    v_partner_id, v_event.id, v_plan.user_id, v_event.event_date,
    v_event.start_time, v_event.end_time, v_event.event_date,
    v_event.start_time, v_event.end_time, v_event.expected_attendance,
    'pending', v_amount_cents::NUMERIC / 100, v_amount_cents::NUMERIC / 100,
    v_amount_cents::NUMERIC / 100, 'pending', v_plan.id, v_action.id,
    v_approval.id, v_amount_cents, v_approval.snapshot_json
  )
  RETURNING * INTO v_vendor_booking;

  INSERT INTO public.plan_messages (plan_id, role, content, message_type, metadata)
  VALUES (
    v_plan.id,
    'system',
    'The approved vendor booking request is now pending partner confirmation.',
    'status_update',
    jsonb_build_object(
      'kind', 'canonical_booking_created',
      'booking_kind', 'vendor',
      'booking_id', v_vendor_booking.id,
      'event_id', v_event.id,
      'agent_action_id', v_action.id,
      'approval_id', v_approval.id
    )
  );

  RETURN jsonb_build_object(
    'disposition', 'executing',
    'existing', false,
    'booking_kind', 'vendor',
    'booking_id', v_vendor_booking.id,
    'booking_status', v_vendor_booking.status,
    'event_id', v_event.id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_canonical_booking_from_approval(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_canonical_booking_from_approval(UUID, UUID, UUID, UUID)
  TO service_role;

-- An executable approval is immutable evidence and remains authorized. This
-- command cancels only the still-pending operational booking and action, with
-- its own audit trail, so callers never rewrite approval history.
CREATE OR REPLACE FUNCTION public.cancel_executing_canonical_quote_booking(
  p_plan_id UUID,
  p_agent_action_id UUID,
  p_approval_id UUID,
  p_actor_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_action public.agent_actions%ROWTYPE;
  v_approval public.approvals%ROWTYPE;
  v_booking_id UUID;
  v_booking_kind TEXT;
  v_booking_status TEXT;
  v_action_from_status TEXT;
BEGIN
  IF current_user <> 'postgres'
    AND NOT (current_user = 'service_role' AND auth.role() = 'service_role')
  THEN
    RAISE EXCEPTION 'cancel_executing_canonical_quote_booking_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL OR NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'cancel_executing_canonical_quote_booking_invalid_contract'
      USING ERRCODE = '22023';
  END IF;

  SELECT plan_row.*
  INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_executing_canonical_quote_booking_plan_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_plan.user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'cancel_executing_canonical_quote_booking_actor_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF v_plan.status::TEXT NOT IN ('approved', 'executing', 'booked', 'completed', 'archived') THEN
    RAISE EXCEPTION 'cancel_executing_canonical_quote_booking_plan_not_cancellable'
      USING ERRCODE = '23514', DETAIL = v_plan.status::TEXT;
  END IF;

  SELECT action_row.*
  INTO v_action
  FROM public.agent_actions AS action_row
  WHERE action_row.id = p_agent_action_id
    AND action_row.plan_id = p_plan_id
    AND action_row.approval_id = p_approval_id
    AND action_row.payload_json ->> 'kind' = 'canonical_quote_booking'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_executing_canonical_quote_booking_action_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT approval_row.*
  INTO v_approval
  FROM public.approvals AS approval_row
  WHERE approval_row.id = p_approval_id
    AND approval_row.agent_action_id = v_action.id
    AND approval_row.plan_id = v_action.plan_id
  FOR KEY SHARE;

  IF NOT FOUND
    OR v_approval.status NOT IN ('approved', 'authorized')
    OR v_approval.authorized_by IS DISTINCT FROM p_actor_id
    OR v_approval.authorized_at IS NULL
  THEN
    RAISE EXCEPTION 'cancel_executing_canonical_quote_booking_approval_not_executable'
      USING ERRCODE = '23514';
  END IF;

  SELECT booking.id, 'venue', booking.status
  INTO v_booking_id, v_booking_kind, v_booking_status
  FROM public.venue_bookings AS booking
  WHERE booking.agent_action_id = v_action.id
    AND booking.approval_id = v_approval.id
    AND booking.plan_id = v_plan.id
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT booking.id, 'vendor', booking.status
    INTO v_booking_id, v_booking_kind, v_booking_status
    FROM public.vendor_bookings AS booking
    WHERE booking.agent_action_id = v_action.id
      AND booking.approval_id = v_approval.id
      AND booking.plan_id = v_plan.id
    FOR UPDATE;
  END IF;

  IF v_action.status = 'cancelled'
    AND (v_booking_id IS NULL OR v_booking_status = 'cancelled')
  THEN
    RETURN jsonb_build_object(
      'existing', true,
      'disposition', 'waiting',
      'canonical_booking_status', 'cancelled',
      'booking_id', v_booking_id,
      'booking_kind', v_booking_kind,
      'booking_status', v_booking_status,
      'action_status', v_action.status,
      'approval_status', v_approval.status,
      'plan_status', v_plan.status
    );
  END IF;

  IF v_action.status NOT IN ('approved', 'executing') THEN
    RAISE EXCEPTION 'cancel_executing_canonical_quote_booking_action_not_cancellable'
      USING ERRCODE = '23514', DETAIL = v_action.status;
  END IF;

  IF v_booking_id IS NOT NULL AND v_booking_status <> 'pending' THEN
    RAISE EXCEPTION 'cancel_executing_canonical_quote_booking_booking_not_pending'
      USING ERRCODE = '23514', DETAIL = v_booking_status;
  END IF;

  IF v_booking_kind = 'venue' THEN
    UPDATE public.venue_bookings
    SET status = 'cancelled',
        updated_at = transaction_timestamp()
    WHERE id = v_booking_id
      AND status = 'pending';
  ELSIF v_booking_kind = 'vendor' THEN
    UPDATE public.vendor_bookings
    SET status = 'cancelled',
        updated_at = transaction_timestamp()
    WHERE id = v_booking_id
      AND status = 'pending';
  END IF;

  v_action_from_status := v_action.status;
  UPDATE public.agent_actions
  SET status = 'cancelled',
      result_metadata = COALESCE(result_metadata, '{}'::jsonb) || jsonb_build_object(
        'canonical_booking_status', 'cancelled',
        'booking_id', v_booking_id,
        'booking_kind', v_booking_kind,
        'cancelled_by', p_actor_id,
        'cancelled_at', transaction_timestamp(),
        'cancellation_reason', btrim(p_reason),
        'approval_status_preserved', v_approval.status,
        'outbound_message_sent', false
      )
  WHERE id = v_action.id
  RETURNING * INTO v_action;

  INSERT INTO public.agent_action_audit_log (
    action_id, plan_id, from_status, to_status, actor_id, actor_role,
    reason, metadata
  ) VALUES (
    v_action.id, v_plan.id, v_action_from_status, 'cancelled', p_actor_id, 'user',
    'canonical_quote_booking.cancelled_after_authorization',
    jsonb_build_object(
      'approval_id', v_approval.id,
      'approval_status_preserved', v_approval.status,
      'booking_id', v_booking_id,
      'booking_kind', v_booking_kind,
      'cancellation_reason', btrim(p_reason)
    )
  );

  INSERT INTO public.plan_messages (plan_id, role, content, message_type, metadata)
  VALUES (
    v_plan.id,
    'system',
    CASE
      WHEN v_booking_id IS NULL THEN
        'Cancelled the approved concierge booking handoff. The authorization remains in the audit history.'
      ELSE
        'Cancelled the pending ' || v_booking_kind || ' booking request. The authorization remains in the audit history.'
    END,
    'status_update',
    jsonb_build_object(
      'kind', 'canonical_booking_cancelled',
      'booking_id', v_booking_id,
      'booking_kind', v_booking_kind,
      'agent_action_id', v_action.id,
      'approval_id', v_approval.id,
      'approval_status_preserved', v_approval.status
    )
  );

  RETURN jsonb_build_object(
    'existing', false,
    'disposition', 'waiting',
    'canonical_booking_status', 'cancelled',
    'booking_id', v_booking_id,
    'booking_kind', v_booking_kind,
    'booking_status', CASE WHEN v_booking_id IS NULL THEN NULL ELSE 'cancelled' END,
    'action_status', v_action.status,
    'approval_status', v_approval.status,
    'plan_status', v_plan.status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_executing_canonical_quote_booking(UUID, UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_executing_canonical_quote_booking(UUID, UUID, UUID, UUID, TEXT)
  TO service_role;

-- Cancelling an approval after a request was materialized must not leave a
-- hidden pending booking. Confirmed bookings are intentionally untouched and
-- require the existing partner/operator cancellation workflow.
CREATE OR REPLACE FUNCTION public.cancel_pending_canonical_booking_after_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_action public.agent_actions%ROWTYPE;
  v_venue_booking_id UUID;
  v_vendor_booking_id UUID;
BEGIN
  IF NEW.status NOT IN ('cancelled', 'rejected')
    OR OLD.status IN ('cancelled', 'rejected')
  THEN
    RETURN NEW;
  END IF;

  SELECT action_row.*
  INTO v_action
  FROM public.agent_actions AS action_row
  WHERE action_row.id = NEW.agent_action_id
    AND action_row.plan_id = NEW.plan_id
    AND action_row.payload_json ->> 'kind' = 'canonical_quote_booking';

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  UPDATE public.venue_bookings
  SET status = 'cancelled',
      updated_at = transaction_timestamp()
  WHERE approval_id = NEW.id
    AND agent_action_id = v_action.id
    AND plan_id = NEW.plan_id
    AND status = 'pending'
  RETURNING id INTO v_venue_booking_id;

  UPDATE public.vendor_bookings
  SET status = 'cancelled',
      updated_at = transaction_timestamp()
  WHERE approval_id = NEW.id
    AND agent_action_id = v_action.id
    AND plan_id = NEW.plan_id
    AND status = 'pending'
  RETURNING id INTO v_vendor_booking_id;

  IF v_venue_booking_id IS NOT NULL OR v_vendor_booking_id IS NOT NULL THEN
    INSERT INTO public.plan_messages (plan_id, role, content, message_type, metadata)
    VALUES (
      NEW.plan_id,
      'system',
      'The pending booking request was cancelled with its approval. No payment or outbound send was performed.',
      'status_update',
      jsonb_build_object(
        'kind', 'canonical_booking_cancelled',
        'booking_kind', CASE WHEN v_venue_booking_id IS NOT NULL THEN 'venue' ELSE 'vendor' END,
        'booking_id', COALESCE(v_venue_booking_id, v_vendor_booking_id),
        'agent_action_id', v_action.id,
        'approval_id', NEW.id,
        'outbound_message_sent', false
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_pending_canonical_booking_after_approval()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_pending_canonical_booking_after_approval()
  TO service_role;

CREATE TRIGGER cancel_pending_canonical_booking_after_approval_trigger
  AFTER UPDATE OF status ON public.approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.cancel_pending_canonical_booking_after_approval();

-- ---------------------------------------------------------------------------
-- Service-only canonical confirmation seam
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_canonical_booking(
  p_booking_kind TEXT,
  p_booking_id UUID,
  p_actor_id UUID,
  p_confirmation_context JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan_id UUID;
  v_event_id UUID;
  v_action_id UUID;
  v_approval_id UUID;
  v_partner_id UUID;
  v_partner_actor_id UUID;
  v_status TEXT;
  v_plan_status TEXT;
  v_action_from_status TEXT;
  v_action public.agent_actions%ROWTYPE;
BEGIN
  IF current_user <> 'postgres'
    AND NOT (current_user = 'service_role' AND auth.role() = 'service_role')
  THEN
    RAISE EXCEPTION 'confirm_canonical_booking_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_booking_kind NOT IN ('venue', 'vendor')
    OR p_actor_id IS NULL
    OR jsonb_typeof(COALESCE(p_confirmation_context, '{}'::jsonb)) IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION 'confirm_canonical_booking_invalid_contract'
      USING ERRCODE = '22023';
  END IF;

  IF p_booking_kind = 'venue' THEN
    SELECT booking.plan_id, booking.event_id, booking.agent_action_id,
      booking.approval_id, booking.venue_id, booking.status
    INTO v_plan_id, v_event_id, v_action_id, v_approval_id, v_partner_id, v_status
    FROM public.venue_bookings AS booking
    WHERE booking.id = p_booking_id
      AND booking.plan_id IS NOT NULL;
  ELSE
    SELECT booking.plan_id, booking.event_id, booking.agent_action_id,
      booking.approval_id, booking.vendor_id, booking.status
    INTO v_plan_id, v_event_id, v_action_id, v_approval_id, v_partner_id, v_status
    FROM public.vendor_bookings AS booking
    WHERE booking.id = p_booking_id
      AND booking.plan_id IS NOT NULL;
  END IF;

  IF v_plan_id IS NULL OR v_event_id IS NULL OR v_action_id IS NULL
    OR v_approval_id IS NULL OR v_partner_id IS NULL
  THEN
    RAISE EXCEPTION 'confirm_canonical_booking_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  -- Every canonical booking lifecycle command takes aggregate locks in this
  -- order: plan, event, action, approval, partner, booking. The first booking
  -- read above is only an immutable-lineage lookup; every value is rechecked
  -- after the authoritative booking lock below.
  SELECT plan_row.status::TEXT
  INTO v_plan_status
  FROM public.plans AS plan_row
  WHERE plan_row.id = v_plan_id
    AND plan_row.materialized_event_id = v_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_canonical_booking_plan_mismatch'
      USING ERRCODE = '23514';
  END IF;

  PERFORM event_row.id
  FROM public.events AS event_row
  WHERE event_row.id = v_event_id
    AND event_row.plan_id = v_plan_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_canonical_booking_event_mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT action_row.* INTO v_action
  FROM public.agent_actions AS action_row
  WHERE action_row.id = v_action_id
    AND action_row.plan_id = v_plan_id
    AND action_row.approval_id = v_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_canonical_booking_action_mismatch'
      USING ERRCODE = '23514';
  END IF;

  PERFORM approval_row.id
  FROM public.approvals AS approval_row
  WHERE approval_row.id = v_approval_id
    AND approval_row.plan_id = v_plan_id
    AND approval_row.agent_action_id = v_action_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_canonical_booking_approval_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF p_booking_kind = 'venue' THEN
    SELECT venue.owner_id
    INTO v_partner_actor_id
    FROM public.venues AS venue
    WHERE venue.id = v_partner_id
    FOR SHARE;
  ELSE
    SELECT vendor.user_id
    INTO v_partner_actor_id
    FROM public.vendor_profiles AS vendor
    WHERE vendor.id = v_partner_id
    FOR SHARE;
  END IF;

  IF NOT FOUND OR v_partner_actor_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'confirm_canonical_booking_partner_mismatch'
      USING ERRCODE = '42501', DETAIL = p_booking_id::TEXT;
  END IF;

  IF p_booking_kind = 'venue' THEN
    SELECT booking.status
    INTO v_status
    FROM public.venue_bookings AS booking
    WHERE booking.id = p_booking_id
      AND booking.plan_id = v_plan_id
      AND booking.event_id = v_event_id
      AND booking.agent_action_id = v_action_id
      AND booking.approval_id = v_approval_id
      AND booking.venue_id = v_partner_id
    FOR UPDATE;
  ELSE
    SELECT booking.status
    INTO v_status
    FROM public.vendor_bookings AS booking
    WHERE booking.id = p_booking_id
      AND booking.plan_id = v_plan_id
      AND booking.event_id = v_event_id
      AND booking.agent_action_id = v_action_id
      AND booking.approval_id = v_approval_id
      AND booking.vendor_id = v_partner_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_canonical_booking_provenance_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF v_status = 'confirmed' AND v_action.status = 'complete' THEN
    RETURN jsonb_build_object(
      'existing', true,
      'booking_id', p_booking_id,
      'booking_kind', p_booking_kind,
      'booking_status', v_status,
      'action_status', v_action.status,
      'plan_id', v_plan_id,
      'plan_status', v_plan_status,
      'event_id', v_event_id
    );
  END IF;

  -- A terminal plan may replay already-confirmed evidence above, but it may
  -- never turn a still-pending booking into new positive execution.
  IF v_plan_status NOT IN ('executing', 'booked') THEN
    RAISE EXCEPTION 'confirm_canonical_booking_plan_not_confirmable'
      USING ERRCODE = '23514', DETAIL = v_plan_status;
  END IF;

  IF v_status <> 'pending' OR v_action.status NOT IN ('approved', 'executing') THEN
    RAISE EXCEPTION 'confirm_canonical_booking_invalid_state'
      USING ERRCODE = '23514', DETAIL = v_status || '|' || v_action.status;
  END IF;

  v_action_from_status := v_action.status;

  IF p_booking_kind = 'venue' THEN
    UPDATE public.venue_bookings
    SET status = 'confirmed',
        responded_at = transaction_timestamp(),
        approved_at = transaction_timestamp(),
        approval_source = 'manual',
        updated_at = transaction_timestamp()
    WHERE id = p_booking_id;
  ELSE
    UPDATE public.vendor_bookings
    SET status = 'confirmed',
        confirmed_date = booking_date,
        confirmed_start_time = start_time,
        confirmed_end_time = end_time,
        responded_at = transaction_timestamp(),
        updated_at = transaction_timestamp()
    WHERE id = p_booking_id;
  END IF;

  UPDATE public.agent_actions
  SET status = 'complete',
      executed_at = transaction_timestamp(),
      result_metadata = COALESCE(result_metadata, '{}'::jsonb) || jsonb_build_object(
        'canonical_booking_status', 'confirmed',
        'booking_id', p_booking_id,
        'booking_kind', p_booking_kind,
        'event_id', v_event_id,
        'confirmed_by', p_actor_id,
        'confirmed_at', transaction_timestamp(),
        'confirmation_context', COALESCE(p_confirmation_context, '{}'::jsonb)
      )
  WHERE id = v_action.id
  RETURNING * INTO v_action;

  INSERT INTO public.agent_action_audit_log (
    action_id, plan_id, from_status, to_status, actor_id, actor_role,
    reason, metadata
  ) VALUES (
    v_action.id, v_plan_id, v_action_from_status, 'complete', p_actor_id, 'external',
    'canonical_booking.confirmed',
    jsonb_build_object(
      'booking_id', p_booking_id,
      'booking_kind', p_booking_kind,
      'event_id', v_event_id,
      'confirmation_context', COALESCE(p_confirmation_context, '{}'::jsonb)
    )
  );

  INSERT INTO public.plan_messages (plan_id, role, content, message_type, metadata)
  VALUES (
    v_plan_id,
    'system',
    'The ' || p_booking_kind || ' booking is confirmed. The event is now booked.',
    'status_update',
    jsonb_build_object(
      'kind', 'canonical_booking_confirmed',
      'booking_id', p_booking_id,
      'booking_kind', p_booking_kind,
      'event_id', v_event_id,
      'agent_action_id', v_action.id,
      'approval_id', v_approval_id
    )
  );

  -- The P7 confirmed-booking trigger performs the guarded executing -> booked
  -- transition in this same transaction. Reload it so callers see evidence,
  -- not just optimistic copy.
  SELECT plan_row.status::TEXT
  INTO v_plan_status
  FROM public.plans AS plan_row
  WHERE plan_row.id = v_plan_id;

  RETURN jsonb_build_object(
    'existing', false,
    'booking_id', p_booking_id,
    'booking_kind', p_booking_kind,
    'booking_status', 'confirmed',
    'action_status', v_action.status,
    'plan_id', v_plan_id,
    'plan_status', v_plan_status,
    'event_id', v_event_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_canonical_booking(TEXT, UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_canonical_booking(TEXT, UUID, UUID, JSONB)
  TO service_role;
