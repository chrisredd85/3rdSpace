-- P0.1: replace inherited public execution with an explicit least-privilege ACL.
--
-- This migration intentionally names every realized SECURITY DEFINER signature.
-- Adding a new privileged function requires adding it to the classification and
-- realized-database tripwire in __tests__/security/database-privileges.test.ts.

-- New objects must opt in to API access. The remote baseline granted future
-- functions and relations to both API roles, which is unsafe for privileged
-- routines and non-RLS views.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

-- Billing consumption is authenticated-callable, but the caller cannot choose
-- another builder/plan or override canonical pricing inputs. Service callers
-- still pass through the same builder-to-plan aggregate check.
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
  IF p_default_free_events_granted < 0
    OR p_pay_per_event_amount_cents < 0
    OR p_pro_monthly_amount_cents < 0 THEN
    RAISE EXCEPTION 'builder_billing_invalid_amount'
      USING ERRCODE = '22023';
  END IF;

  IF auth.role() <> 'service_role'
    AND (
      p_default_free_events_granted <> 2
      OR p_pay_per_event_amount_cents <> 3000
      OR p_pro_monthly_amount_cents <> 7900
    ) THEN
    RAISE EXCEPTION 'builder_billing_configuration_forbidden'
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

  IF auth.role() <> 'service_role'
    AND (auth.uid() IS NULL OR v_builder.user_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'builder_billing_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.plans
    WHERE plans.id = p_event_id
      AND plans.user_id = v_builder.user_id
  ) THEN
    RAISE EXCEPTION 'builder_billing_plan_scope_mismatch'
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

COMMENT ON FUNCTION public.consume_builder_event_access(UUID, UUID, INTEGER, INTEGER, INTEGER) IS
  'Atomically consumes builder access after deriving authenticated identity and proving that the plan belongs to the builder aggregate.';

-- Invitation RPCs are callable by an authenticated organizer and by the
-- service-role server actions. They never trust a caller-supplied organizer or
-- source event without checking the authenticated aggregate.
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
  IF p_organizer_user_id IS NULL THEN
    RAISE EXCEPTION 'organizer_user_id is required';
  END IF;

  IF auth.role() <> 'service_role'
    AND (auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_organizer_user_id) THEN
    RAISE EXCEPTION 'organizer_invite_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_source_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.events
    JOIN public.builder_profiles
      ON builder_profiles.id = events.builder_id
    WHERE events.id = p_source_event_id
      AND builder_profiles.user_id = p_organizer_user_id
  ) THEN
    RAISE EXCEPTION 'organizer_invite_event_scope_mismatch'
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
    SELECT organizer_vendor_relationships.id
    INTO v_relationship_id
    FROM public.organizer_vendor_relationships
    WHERE organizer_vendor_relationships.organizer_user_id = p_organizer_user_id
      AND organizer_vendor_relationships.vendor_id = v_vendor_id
    LIMIT 1;

    SELECT vendor_rate_agreements.id
    INTO v_rate_agreement_id
    FROM public.vendor_rate_agreements
    WHERE vendor_rate_agreements.organizer_user_id = p_organizer_user_id
      AND vendor_rate_agreements.vendor_id = v_vendor_id
    ORDER BY vendor_rate_agreements.created_at DESC
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
  RETURNING vendor_profiles.id INTO v_vendor_id;

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
  RETURNING organizer_vendor_relationships.id INTO v_relationship_id;

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
  RETURNING vendor_rate_agreements.id INTO v_rate_agreement_id;

  RETURN QUERY SELECT v_vendor_id, v_relationship_id, v_rate_agreement_id, false;
END;
$$;

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
  IF p_organizer_user_id IS NULL THEN
    RAISE EXCEPTION 'organizer_user_id is required';
  END IF;

  IF auth.role() <> 'service_role'
    AND (auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_organizer_user_id) THEN
    RAISE EXCEPTION 'organizer_invite_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_source_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.events
    JOIN public.builder_profiles
      ON builder_profiles.id = events.builder_id
    WHERE events.id = p_source_event_id
      AND builder_profiles.user_id = p_organizer_user_id
  ) THEN
    RAISE EXCEPTION 'organizer_invite_event_scope_mismatch'
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
    SELECT organizer_venue_relationships.id
    INTO v_relationship_id
    FROM public.organizer_venue_relationships
    WHERE organizer_venue_relationships.organizer_user_id = p_organizer_user_id
      AND organizer_venue_relationships.venue_id = v_venue_id
    LIMIT 1;

    SELECT venue_term_agreements.id
    INTO v_term_agreement_id
    FROM public.venue_term_agreements
    WHERE venue_term_agreements.organizer_user_id = p_organizer_user_id
      AND venue_term_agreements.venue_id = v_venue_id
    ORDER BY venue_term_agreements.created_at DESC
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
  RETURNING venues.id INTO v_venue_id;

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
  RETURNING organizer_venue_relationships.id INTO v_relationship_id;

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
    RETURNING venue_term_agreements.id INTO v_term_agreement_id;
  END IF;

  RETURN QUERY SELECT v_venue_id, v_relationship_id, v_term_agreement_id, false;
END;
$$;

-- The revision transaction owns one plan aggregate. Every passed identifier is
-- validated before the first write, including the optional source message.
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
    RAISE EXCEPTION 'User mismatch for plan revision'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_plan
  FROM public.plans
  WHERE id = p_plan_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found or not owned by user'
      USING ERRCODE = '42501';
  END IF;

  IF p_source_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.plan_messages
    WHERE plan_messages.id = p_source_message_id
      AND plan_messages.plan_id = p_plan_id
  ) THEN
    RAISE EXCEPTION 'Plan revision source message is outside the plan aggregate'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(p_impact->'invalidated_recommendation_ids', '[]'::jsonb)) ids(id)
    LEFT JOIN public.recommendations
      ON recommendations.id = ids.id::UUID
     AND recommendations.plan_id = p_plan_id
    WHERE recommendations.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Plan revision recommendation is outside the plan aggregate'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(p_impact->'superseded_approval_ids', '[]'::jsonb)) ids(id)
    LEFT JOIN public.approvals
      ON approvals.id = ids.id::UUID
     AND approvals.plan_id = p_plan_id
    WHERE approvals.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Plan revision approval is outside the plan aggregate'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(p_impact->'superseded_outreach_thread_ids', '[]'::jsonb)) ids(id)
    LEFT JOIN public.outreach_threads
      ON outreach_threads.id = ids.id::UUID
     AND outreach_threads.plan_id = p_plan_id
     AND outreach_threads.user_id = p_user_id
    WHERE outreach_threads.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Plan revision outreach thread is outside the plan aggregate'
      USING ERRCODE = '42501';
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
  WHERE plan_id = p_plan_id
    AND id IN (
      SELECT jsonb_array_elements_text(p_impact->'invalidated_recommendation_ids')::UUID
    );

  UPDATE public.approvals
  SET
    status = 'superseded',
    superseded_at = v_superseded_at,
    superseded_by_revision_id = v_revision_id,
    superseded_reason = p_reason
  WHERE plan_id = p_plan_id
    AND id IN (
      SELECT jsonb_array_elements_text(p_impact->'superseded_approval_ids')::UUID
    )
    AND status IN ('pending', 'approved', 'authorized');

  UPDATE public.outreach_threads
  SET
    state = 'cancelled',
    needs_attention = TRUE,
    last_event_at = v_superseded_at
  WHERE plan_id = p_plan_id
    AND user_id = p_user_id
    AND id IN (
      SELECT jsonb_array_elements_text(p_impact->'superseded_outreach_thread_ids')::UUID
    )
    AND state = 'draft';

  UPDATE public.outreach_threads
  SET
    state = 'stale',
    needs_attention = TRUE,
    last_event_at = v_superseded_at
  WHERE plan_id = p_plan_id
    AND user_id = p_user_id
    AND id IN (
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
    outreach_threads.id,
    'outbound',
    'Plan update superseded this outreach',
    p_reason,
    jsonb_build_object(
      'system_event', 'plan_revision_superseded',
      'revision_id', v_revision_id,
      'superseded_at', v_superseded_at
    )
  FROM public.outreach_threads
  WHERE outreach_threads.plan_id = p_plan_id
    AND outreach_threads.user_id = p_user_id
    AND outreach_threads.id IN (
      SELECT jsonb_array_elements_text(p_impact->'superseded_outreach_thread_ids')::UUID
    );

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

COMMENT ON FUNCTION public.apply_plan_revision_atomic(UUID, UUID, JSONB, UUID, JSONB, JSONB, TEXT) IS
  'Atomically applies one owned plan revision after validating every referenced record belongs to the same plan aggregate.';

-- Start from no API execution for every privileged routine. PUBLIC must be
-- revoked because role-specific revokes do not override a PUBLIC grant.
REVOKE ALL ON FUNCTION public.apply_plan_revision_atomic(UUID, UUID, JSONB, UUID, JSONB, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_inflight_stripe_account_payments(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calculate_event_kickback(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_manage_event_cost_commitment_org(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_manage_event_revenue_term_org(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_manage_live_recommendation_org(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_manage_plan_read_model(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_app_jobs(INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_builder_event_access(UUID, UUID, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_webhook_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_vendor_invite(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_venue_invite(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, INTEGER, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_event_kickback_summary(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_stripe_webhook_duplicate_count(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_stripe_webhook_duplicate_count(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.insert_grouped_notification(UUID, TEXT, TEXT, TEXT, TEXT, UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_event_builder(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_event_collaborator(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_vendor_invoice_number(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_review_events() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_vendor_booking_events() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_vendor_transaction_events() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_vendor_review_stats(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_stripe_webhook_event_result(TEXT, TEXT, JSONB, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_projection_baselines() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_vendor_analytics() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_stale_stripe_webhook_reservations(INTERVAL) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_stripe_webhook_event(TEXT, TEXT, JSONB, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_vendor_review_stats() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_settlement_charge_status(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_settlement_run_status(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unblock_stripe_account_settlements(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_event_cost_commitment_scope() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_event_revenue_term_scope() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_live_recommendation_scope() FROM PUBLIC, anon, authenticated;

-- All privileged routines remain available to trusted server paths.
GRANT EXECUTE ON FUNCTION public.apply_plan_revision_atomic(UUID, UUID, JSONB, UUID, JSONB, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.block_inflight_stripe_account_payments(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.calculate_event_kickback(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_event_cost_commitment_org(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_event_revenue_term_org(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_live_recommendation_org(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_plan_read_model(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_app_jobs(INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_builder_event_access(UUID, UUID, INTEGER, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_webhook_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_vendor_invite(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_venue_invite(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, INTEGER, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_event_kickback_summary(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_stripe_webhook_duplicate_count(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_stripe_webhook_duplicate_count(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.insert_grouped_notification(UUID, TEXT, TEXT, TEXT, TEXT, UUID, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_event_builder(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_event_collaborator(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_vendor_invoice_number(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_review_events() TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_vendor_booking_events() TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_vendor_transaction_events() TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_vendor_review_stats(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_stripe_webhook_event_result(TEXT, TEXT, JSONB, TEXT, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_projection_baselines() TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_vendor_analytics() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_stale_stripe_webhook_reservations(INTERVAL) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_stripe_webhook_event(TEXT, TEXT, JSONB, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_vendor_review_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_settlement_charge_status(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_settlement_run_status(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.unblock_stripe_account_settlements(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_event_cost_commitment_scope() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_event_revenue_term_scope() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_live_recommendation_scope() TO service_role;

-- Explicit authenticated allowlist: aggregate-scoped mutation/read RPCs and
-- RLS helper functions only. Anonymous receives no privileged function grants.
GRANT EXECUTE ON FUNCTION public.apply_plan_revision_atomic(UUID, UUID, JSONB, UUID, JSONB, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_event_cost_commitment_org(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_event_revenue_term_org(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_live_recommendation_org(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_plan_read_model(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_builder_event_access(UUID, UUID, INTEGER, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_vendor_invite(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_venue_invite(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TEXT, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_kickback_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_event_builder(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_event_collaborator(UUID) TO authenticated;

-- A regular view can enforce source-table RLS with invoker semantics. The two
-- materialized views cannot, so they are accessible only through scoped server
-- routes using the service-role client.
ALTER VIEW public.event_ticket_sales_rollups SET (security_invoker = true);

REVOKE ALL ON TABLE public.event_ticket_sales_rollups FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.event_ticket_sales_rollups TO authenticated, service_role;

REVOKE ALL ON TABLE public.organizer_baselines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.organizer_baselines TO service_role;

REVOKE ALL ON TABLE public.vendor_analytics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vendor_analytics TO service_role;
