-- Repair the six P0 stored functions that failed against the realized schema.
--
-- These are CREATE OR REPLACE corrections only: signatures and intended state
-- transitions remain unchanged. Function ACL hardening is handled by the
-- immediately-following P0 privilege migration so that these bodies can be
-- safely copied there when cross-plan ownership checks are added.

-- Cast JSON text explicitly before coalescing it with DATE columns.
CREATE OR REPLACE FUNCTION public.apply_plan_revision_atomic(
  p_plan_id UUID,
  p_user_id UUID,
  p_trigger JSONB,
  p_source_message_id UUID DEFAULT NULL,
  p_plan_updates JSONB DEFAULT '{}'::jsonb,
  p_impact JSONB DEFAULT '{}'::jsonb,
  p_reason TEXT DEFAULT 'Plan changed; previous recommendation or approval requires review.'
) RETURNS TABLE (
  revision_id UUID,
  impact JSONB,
  new_revision_count INTEGER
) AS $$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_revision_id UUID;
  v_audit_log_id UUID;
  v_revision_count INTEGER;
  v_superseded_at TIMESTAMPTZ := now();
BEGIN
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'User mismatch for plan revision';
  END IF;

  SELECT *
  INTO v_plan
  FROM public.plans
  WHERE id = p_plan_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found or not owned by user';
  END IF;

  v_revision_count := COALESCE(v_plan.plan_revision_count, 0) + 1;

  UPDATE public.plans
  SET
    plan_revision_count = v_revision_count,
    metadata = COALESCE(p_plan_updates->'metadata', metadata),
    excluded_cuisines = CASE
      WHEN p_plan_updates ? 'excluded_cuisines'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_plan_updates->'excluded_cuisines'))
      ELSE excluded_cuisines
    END,
    excluded_vendor_attributes = COALESCE(p_plan_updates->'excluded_vendor_attributes', excluded_vendor_attributes),
    preferred_vendor_attributes = COALESCE(p_plan_updates->'preferred_vendor_attributes', preferred_vendor_attributes),
    vendor_out_of_city_approved = COALESCE((p_plan_updates->>'vendor_out_of_city_approved')::BOOLEAN, vendor_out_of_city_approved),
    vendor_approved_adjacent_cities = CASE
      WHEN p_plan_updates ? 'vendor_approved_adjacent_cities'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_plan_updates->'vendor_approved_adjacent_cities'))
      ELSE vendor_approved_adjacent_cities
    END,
    date_window_start = COALESCE((p_plan_updates->>'date_window_start')::DATE, date_window_start),
    date_window_end = COALESCE((p_plan_updates->>'date_window_end')::DATE, date_window_end),
    guest_count = COALESCE((p_plan_updates->>'guest_count')::INTEGER, guest_count),
    budget_cap_cents = COALESCE((p_plan_updates->>'budget_cap_cents')::INTEGER, budget_cap_cents),
    neighborhood = COALESCE(p_plan_updates->>'neighborhood', neighborhood),
    event_city = COALESCE(p_plan_updates->>'event_city', event_city),
    updated_at = v_superseded_at
  WHERE id = p_plan_id
    AND user_id = p_user_id;

  INSERT INTO public.plan_revisions (
    plan_id,
    triggered_by_user_id,
    trigger_type,
    trigger_payload,
    source_message_id,
    impact_summary,
    rediscovery_triggered_for
  ) VALUES (
    p_plan_id,
    p_user_id,
    p_trigger->>'type',
    p_trigger,
    p_source_message_id,
    p_impact,
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(p_impact->'triggers_rediscovery')),
      '{}'::TEXT[]
    )
  )
  RETURNING id INTO v_revision_id;

  UPDATE public.recommendations
  SET
    status = 'superseded',
    superseded_at = v_superseded_at,
    superseded_by_revision_id = v_revision_id,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'superseded_reason', p_reason,
      'superseded_at', v_superseded_at,
      'superseded_by_revision_id', v_revision_id
    )
  WHERE id IN (
    SELECT jsonb_array_elements_text(p_impact->'invalidated_recommendation_ids')::UUID
  );

  UPDATE public.approvals
  SET
    status = 'superseded',
    superseded_at = v_superseded_at,
    superseded_by_revision_id = v_revision_id,
    superseded_reason = p_reason
  WHERE id IN (
    SELECT jsonb_array_elements_text(p_impact->'superseded_approval_ids')::UUID
  )
    AND status IN ('pending', 'approved', 'authorized');

  UPDATE public.outreach_threads
  SET
    state = 'cancelled',
    needs_attention = TRUE,
    last_event_at = v_superseded_at
  WHERE id IN (
    SELECT jsonb_array_elements_text(p_impact->'superseded_outreach_thread_ids')::UUID
  )
    AND state = 'draft';

  UPDATE public.outreach_threads
  SET
    state = 'stale',
    needs_attention = TRUE,
    last_event_at = v_superseded_at
  WHERE id IN (
    SELECT jsonb_array_elements_text(p_impact->'superseded_outreach_thread_ids')::UUID
  )
    AND state IN ('awaiting_reply', 'in_negotiation');

  INSERT INTO public.outreach_messages (
    thread_id,
    direction,
    subject,
    body_text,
    headers_json
  )
  SELECT
    thread_id,
    'outbound',
    'Plan update superseded this outreach',
    p_reason,
    jsonb_build_object(
      'system_event', 'plan_revision_superseded',
      'revision_id', v_revision_id,
      'superseded_at', v_superseded_at
    )
  FROM (
    SELECT jsonb_array_elements_text(p_impact->'superseded_outreach_thread_ids')::UUID AS thread_id
  ) threads;

  UPDATE public.plan_messages
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'status', 'superseded',
    'superseded_at', v_superseded_at,
    'superseded_by_revision_id', v_revision_id,
    'superseded_reason', p_reason
  )
  WHERE plan_id = p_plan_id
    AND message_type = 'approval_request'
    AND (
      metadata->'approval'->>'id' IN (
        SELECT jsonb_array_elements_text(p_impact->'superseded_approval_ids')
      )
      OR metadata->>'approval_id' IN (
        SELECT jsonb_array_elements_text(p_impact->'superseded_approval_ids')
      )
    );

  INSERT INTO public.audit_logs (
    user_id,
    plan_id,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state
  ) VALUES (
    p_user_id,
    p_plan_id,
    'planner.plan_revision.applied',
    'plan_revision',
    v_revision_id,
    to_jsonb(v_plan),
    jsonb_build_object(
      'trigger', p_trigger,
      'plan_updates', p_plan_updates,
      'source_message_id', p_source_message_id,
      'impact', p_impact
    )
  )
  RETURNING id INTO v_audit_log_id;

  UPDATE public.plan_revisions
  SET audit_log_id = v_audit_log_id
  WHERE id = v_revision_id;

  revision_id := v_revision_id;
  impact := p_impact;
  new_revision_count := v_revision_count;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- kickback_payments has no updated_at column; preserve its blocking state
-- transition without attempting to write a field that is not in the schema.
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
  v_venue_ids uuid[];
  v_builder_user_ids uuid[];
  v_payment_intents integer := 0;
  v_capturing_payment_intents_preserved integer := 0;
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

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_venue_ids
  FROM public.venues
  WHERE owner_id = ANY(v_venue_owner_ids);

  SELECT COALESCE(array_agg(user_id), ARRAY[]::uuid[])
    INTO v_builder_user_ids
  FROM public.builder_stripe_accounts
  WHERE stripe_account_id = p_stripe_account_id;

  -- A capture that already owns the durable `capturing` reservation must not
  -- be abandoned when the partner account is restricted. Stripe truth and the
  -- capture reconciler finish or fail that attempt; future
  -- pending/requested/authorized intents are blocked below.
  SELECT COUNT(*)
    INTO v_capturing_payment_intents_preserved
  FROM public.payment_intents
  WHERE status = 'capturing'
    AND (
      (partner_kind = 'vendor' AND partner_id = ANY(v_vendor_ids))
      OR (partner_kind = 'venue' AND partner_id = ANY(v_venue_ids))
    );

  UPDATE public.payment_intents
  SET
    status = 'blocked_by_account_state',
    account_state_blocked_previous_status = status,
    account_state_blocked_stripe_account_id = p_stripe_account_id,
    account_state_blocked_at = v_now,
    account_state_block_reason = p_reason,
    updated_at = v_now
  WHERE status IN ('pending', 'requested', 'authorized')
    AND (
      (partner_kind = 'vendor' AND partner_id = ANY(v_vendor_ids))
      OR (partner_kind = 'venue' AND partner_id = ANY(v_venue_ids))
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
    account_state_block_reason = p_reason
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
    'capturing_payment_intents_preserved', v_capturing_payment_intents_preserved,
    'vendor_transactions', v_vendor_transactions,
    'venue_payment_transactions', v_venue_transactions,
    'kickback_payments', v_kickback_payments,
    'settlement_runs', v_settlement_runs,
    'settlement_charges', v_settlement_charges
  );
END;
$$;

-- Qualify duplicate-lookup columns that collide with RETURNS TABLE names and
-- derive authenticated organizer/source-event authority inside the RPC.
CREATE OR REPLACE FUNCTION public.create_venue_invite(
  p_organizer_user_id uuid,
  p_venue_name text,
  p_contact_email text,
  p_contact_name text DEFAULT NULL,
  p_contact_role text DEFAULT NULL,
  p_venue_type text DEFAULT 'other',
  p_city text DEFAULT NULL,
  p_state text DEFAULT 'CA',
  p_standing_capacity integer DEFAULT NULL,
  p_seated_capacity integer DEFAULT NULL,
  p_term_type text DEFAULT 'tbd',
  p_amount_cents integer DEFAULT NULL,
  p_source_event_id uuid DEFAULT NULL
)
RETURNS TABLE (
  venue_id uuid,
  relationship_id uuid,
  term_agreement_id uuid,
  existing boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_venue_id uuid;
  v_relationship_id uuid;
  v_term_agreement_id uuid;
  v_normalized_email text;
  v_venue_type text;
BEGIN
  IF auth.role() NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION 'venue_invite_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_organizer_user_id IS NULL THEN
    RAISE EXCEPTION 'organizer_user_id is required';
  END IF;

  IF auth.role() = 'authenticated'
    AND auth.uid() IS DISTINCT FROM p_organizer_user_id THEN
    RAISE EXCEPTION 'venue_invite_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_source_event_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.events
      JOIN public.builder_profiles
        ON builder_profiles.id = events.builder_id
      WHERE events.id = p_source_event_id
        AND builder_profiles.user_id = p_organizer_user_id
    ) THEN
    RAISE EXCEPTION 'venue_invite_source_event_not_owned'
      USING ERRCODE = '42501';
  END IF;

  IF NULLIF(BTRIM(p_venue_name), '') IS NULL THEN
    RAISE EXCEPTION 'venue_name is required';
  END IF;

  v_normalized_email := LOWER(NULLIF(BTRIM(p_contact_email), ''));
  IF v_normalized_email IS NULL THEN
    RAISE EXCEPTION 'contact_email is required';
  END IF;

  IF p_term_type NOT IN ('flat_rental', 'minimum_spend', 'per_head_chi', 'bar_chi', 'no_charge', 'tbd') THEN
    RAISE EXCEPTION 'unsupported term_type: %', p_term_type;
  END IF;

  IF p_amount_cents IS NOT NULL AND p_amount_cents < 0 THEN
    RAISE EXCEPTION 'amount_cents must be non-negative';
  END IF;

  v_venue_type := CASE p_venue_type
    WHEN 'loft_warehouse' THEN 'loft_warehouse'
    WHEN 'gallery' THEN 'gallery'
    WHEN 'restaurant' THEN 'restaurant'
    WHEN 'rooftop' THEN 'rooftop'
    WHEN 'conference_center' THEN 'conference_center'
    ELSE 'other'
  END;

  SELECT venues.id
  INTO v_venue_id
  FROM public.organizer_venue_relationships
  JOIN public.venues
    ON venues.id = organizer_venue_relationships.venue_id
  WHERE organizer_venue_relationships.organizer_user_id = p_organizer_user_id
    AND LOWER(COALESCE(venues.contact_email, '')) = v_normalized_email
  ORDER BY organizer_venue_relationships.created_at DESC
  LIMIT 1;

  IF v_venue_id IS NOT NULL THEN
    SELECT relationship.id
    INTO v_relationship_id
    FROM public.organizer_venue_relationships AS relationship
    WHERE relationship.organizer_user_id = p_organizer_user_id
      AND relationship.venue_id = v_venue_id
    LIMIT 1;

    SELECT agreement.id
    INTO v_term_agreement_id
    FROM public.venue_term_agreements AS agreement
    WHERE agreement.organizer_user_id = p_organizer_user_id
      AND agreement.venue_id = v_venue_id
    ORDER BY agreement.created_at DESC
    LIMIT 1;

    RETURN QUERY SELECT v_venue_id, v_relationship_id, v_term_agreement_id, true;
    RETURN;
  END IF;

  INSERT INTO public.venues (
    owner_id,
    venue_name,
    venue_type,
    city,
    state,
    standing_capacity,
    seated_capacity,
    contact_email,
    contact_name,
    contact_role,
    claim_status,
    invited_by_user_id,
    invited_at,
    is_published,
    is_claimed,
    is_admin_seeded,
    pricing_model,
    description
  )
  VALUES (
    NULL,
    BTRIM(p_venue_name),
    v_venue_type,
    NULLIF(BTRIM(p_city), ''),
    COALESCE(NULLIF(BTRIM(p_state), ''), 'CA'),
    p_standing_capacity,
    p_seated_capacity,
    v_normalized_email,
    NULLIF(BTRIM(p_contact_name), ''),
    NULLIF(BTRIM(p_contact_role), ''),
    'invited_unclaimed',
    p_organizer_user_id,
    now(),
    false,
    false,
    false,
    NULL,
    'Invited by organizer; pending venue signup.'
  )
  RETURNING id INTO v_venue_id;

  INSERT INTO public.organizer_venue_relationships (
    organizer_user_id,
    venue_id,
    source,
    trust_tier
  )
  VALUES (
    p_organizer_user_id,
    v_venue_id,
    'organizer_invite',
    'known'
  )
  RETURNING id INTO v_relationship_id;

  IF p_term_type <> 'tbd' OR p_amount_cents IS NOT NULL THEN
    INSERT INTO public.venue_term_agreements (
      venue_id,
      organizer_user_id,
      term_type,
      amount_cents,
      source_event_id,
      status
    )
    VALUES (
      v_venue_id,
      p_organizer_user_id,
      p_term_type,
      p_amount_cents,
      p_source_event_id,
      'proposed'
    )
    RETURNING id INTO v_term_agreement_id;
  END IF;

  RETURN QUERY SELECT v_venue_id, v_relationship_id, v_term_agreement_id, false;
END;
$$;

-- Qualify duplicate-lookup columns that collide with RETURNS TABLE names and
-- derive authenticated organizer/source-event authority inside the RPC.
CREATE OR REPLACE FUNCTION public.create_vendor_invite(
  p_organizer_user_id uuid,
  p_vendor_name text,
  p_email text,
  p_phone text,
  p_service_type text,
  p_rate_type text,
  p_amount numeric,
  p_source_event_id uuid DEFAULT NULL
)
RETURNS TABLE (
  vendor_id uuid,
  relationship_id uuid,
  rate_agreement_id uuid,
  existing boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_vendor_id uuid;
  v_relationship_id uuid;
  v_rate_agreement_id uuid;
  v_vendor_type text;
  v_normalized_email text;
BEGIN
  IF auth.role() NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION 'vendor_invite_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_organizer_user_id IS NULL THEN
    RAISE EXCEPTION 'organizer_user_id is required';
  END IF;

  IF auth.role() = 'authenticated'
    AND auth.uid() IS DISTINCT FROM p_organizer_user_id THEN
    RAISE EXCEPTION 'vendor_invite_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_source_event_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.events
      JOIN public.builder_profiles
        ON builder_profiles.id = events.builder_id
      WHERE events.id = p_source_event_id
        AND builder_profiles.user_id = p_organizer_user_id
    ) THEN
    RAISE EXCEPTION 'vendor_invite_source_event_not_owned'
      USING ERRCODE = '42501';
  END IF;

  IF NULLIF(BTRIM(p_vendor_name), '') IS NULL THEN
    RAISE EXCEPTION 'vendor_name is required';
  END IF;

  v_normalized_email := LOWER(NULLIF(BTRIM(p_email), ''));
  IF v_normalized_email IS NULL THEN
    RAISE EXCEPTION 'email is required';
  END IF;

  IF p_rate_type NOT IN ('flat', 'per_person', 'hourly') THEN
    RAISE EXCEPTION 'unsupported rate_type: %', p_rate_type;
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  v_vendor_type := CASE p_service_type
    WHEN 'dj' THEN 'DJ / Music'
    WHEN 'catering' THEN 'Caterer'
    WHEN 'bartending' THEN 'Bartender'
    WHEN 'photography' THEN 'Photographer'
    WHEN 'photographer' THEN 'Photographer'
    WHEN 'videography' THEN 'Photographer'
    WHEN 'videographer' THEN 'Photographer'
    WHEN 'av_tech' THEN 'Audio/Visual Tech'
    WHEN 'av' THEN 'Audio/Visual Tech'
    WHEN 'event_planning' THEN 'Security / Event Staff'
    WHEN 'security' THEN 'Security / Event Staff'
    WHEN 'florist' THEN 'Decorator / Florist'
    WHEN 'decor' THEN 'Decorator / Florist'
    ELSE 'DJ / Music'
  END;

  SELECT vendor_profiles.id
  INTO v_vendor_id
  FROM public.organizer_vendor_relationships
  JOIN public.vendor_profiles
    ON vendor_profiles.id = organizer_vendor_relationships.vendor_id
  WHERE organizer_vendor_relationships.organizer_user_id = p_organizer_user_id
    AND LOWER(COALESCE(vendor_profiles.contact_email, '')) = v_normalized_email
  ORDER BY organizer_vendor_relationships.created_at DESC
  LIMIT 1;

  IF v_vendor_id IS NOT NULL THEN
    SELECT relationship.id
    INTO v_relationship_id
    FROM public.organizer_vendor_relationships AS relationship
    WHERE relationship.organizer_user_id = p_organizer_user_id
      AND relationship.vendor_id = v_vendor_id
    LIMIT 1;

    SELECT agreement.id
    INTO v_rate_agreement_id
    FROM public.vendor_rate_agreements AS agreement
    WHERE agreement.organizer_user_id = p_organizer_user_id
      AND agreement.vendor_id = v_vendor_id
    ORDER BY agreement.created_at DESC
    LIMIT 1;

    RETURN QUERY SELECT v_vendor_id, v_relationship_id, v_rate_agreement_id, true;
    RETURN;
  END IF;

  INSERT INTO public.vendor_profiles (
    user_id,
    name,
    vendor_type,
    service_type,
    contact_email,
    phone,
    claim_status,
    invited_by_user_id,
    invited_at,
    is_published,
    is_claimed,
    is_admin_seeded,
    service_area,
    regions_served,
    availability_notes,
    pricing_model
  )
  VALUES (
    NULL,
    BTRIM(p_vendor_name),
    v_vendor_type,
    p_service_type,
    v_normalized_email,
    NULLIF(BTRIM(p_phone), ''),
    'invited_unclaimed',
    p_organizer_user_id,
    now(),
    false,
    false,
    false,
    'all_bay_area',
    'Bay Area',
    'Invited by organizer; pending vendor signup.',
    CASE WHEN p_rate_type = 'flat' THEN 'flat_rate' ELSE p_rate_type END
  )
  RETURNING id INTO v_vendor_id;

  INSERT INTO public.organizer_vendor_relationships (
    organizer_user_id,
    vendor_id,
    source,
    trust_tier
  )
  VALUES (
    p_organizer_user_id,
    v_vendor_id,
    'organizer_invite',
    'known'
  )
  RETURNING id INTO v_relationship_id;

  INSERT INTO public.vendor_rate_agreements (
    vendor_id,
    organizer_user_id,
    rate_type,
    amount,
    source_event_id,
    status
  )
  VALUES (
    v_vendor_id,
    p_organizer_user_id,
    p_rate_type,
    ROUND(p_amount::numeric, 2),
    p_source_event_id,
    'proposed'
  )
  RETURNING id INTO v_rate_agreement_id;

  RETURN QUERY SELECT v_vendor_id, v_relationship_id, v_rate_agreement_id, false;
END;
$$;

-- builder_event_usage has no updated_at column. Enforce caller-derived builder
-- and plan ownership while keeping same-plan consumption idempotent.
CREATE OR REPLACE FUNCTION public.consume_builder_event_access(
  p_builder_id UUID,
  p_event_id UUID,
  p_default_free_events_granted INTEGER DEFAULT 2,
  p_pay_per_event_amount_cents INTEGER DEFAULT 3000,
  p_pro_monthly_amount_cents INTEGER DEFAULT 7900
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
BEGIN
  IF auth.role() NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION 'builder_billing_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_default_free_events_granted < 0
    OR p_pay_per_event_amount_cents < 0
    OR p_pro_monthly_amount_cents < 0 THEN
    RAISE EXCEPTION 'builder_billing_invalid_amount'
      USING ERRCODE = '22023';
  END IF;

  IF auth.role() = 'authenticated'
    AND (
      p_default_free_events_granted <> 2
      OR p_pay_per_event_amount_cents <> 3000
      OR p_pro_monthly_amount_cents <> 7900
    ) THEN
    RAISE EXCEPTION 'builder_billing_noncanonical_defaults'
      USING ERRCODE = '42501';
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

  IF auth.role() = 'authenticated'
    AND v_builder.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'builder_billing_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.plans
    WHERE plans.id = p_event_id
      AND plans.user_id = v_builder.user_id
  ) THEN
    RAISE EXCEPTION 'builder_event_not_owned'
      USING ERRCODE = '42501';
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
    total_fees_paid = public.builder_event_usage.total_fees_paid + (v_amount_cents / 100.0);

  SELECT events_booked
  INTO v_events_booked
  FROM public.builder_event_usage
  WHERE builder_event_usage.builder_id = p_builder_id
    AND builder_event_usage.month = v_month;

  UPDATE public.builder_event_usage
  SET could_have_saved = GREATEST(
    (COALESCE(v_events_booked, 0) * (p_pay_per_event_amount_cents / 100.0))
      - (p_pro_monthly_amount_cents / 100.0),
    0
  )
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

-- Qualify target fields that collide with RETURNS TABLE output names.
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

  UPDATE public.settlement_charges AS target
     SET status = p_to_status,
         stripe_payment_intent_id = CASE
           WHEN p_patch ? 'stripe_payment_intent_id' THEN p_patch->>'stripe_payment_intent_id'
           ELSE target.stripe_payment_intent_id
         END,
         paid_at = CASE
           WHEN p_patch ? 'paid_at' THEN (p_patch->>'paid_at')::timestamptz
           ELSE target.paid_at
         END,
         failed_at = CASE
           WHEN p_patch ? 'failed_at' THEN (p_patch->>'failed_at')::timestamptz
           ELSE target.failed_at
         END,
         failure_reason = CASE
           WHEN p_patch ? 'failure_reason' THEN p_patch->>'failure_reason'
           ELSE target.failure_reason
         END,
         updated_at = v_now
   WHERE target.id = p_charge_id
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
