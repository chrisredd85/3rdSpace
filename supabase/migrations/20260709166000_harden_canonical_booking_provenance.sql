-- Prompts 7-8 follow-up: make the canonical booking edge as strict as the
-- plan/event identity edge. A planner-native booking is execution evidence only
-- when it names the exact plan, action, executable approval, immutable snapshot,
-- amount, canonical event, and claimed partner targeted by the approved action.
-- The one temporary exception is the pre-existing
-- builder-event materialization bridge while its plan is still `ready`; Prompt
-- 10 owns removal of that compatibility path.

-- Planner-native quote bookings always wait for the canonical confirmation
-- command. Legacy venue requests retain their configured auto-approval behavior.
CREATE OR REPLACE FUNCTION public.apply_venue_booking_auto_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  venue_settings RECORD;
  event_settings RECORD;
  booking_amount NUMERIC;
  min_notice_days INTEGER;
  max_capacity INTEGER;
  event_notice_days INTEGER;
BEGIN
  IF NEW.plan_id IS NOT NULL OR NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT
    bulk_approval_enabled,
    auto_approve_threshold,
    COALESCE(auto_approve_conditions, '{}'::jsonb) AS auto_approve_conditions
  INTO venue_settings
  FROM public.venues
  WHERE id = NEW.venue_id;

  IF venue_settings.bulk_approval_enabled IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  booking_amount := COALESCE(NEW.final_price, NEW.quoted_price, 0);
  IF venue_settings.auto_approve_threshold IS NOT NULL
    AND booking_amount > venue_settings.auto_approve_threshold
  THEN
    RETURN NEW;
  END IF;

  SELECT
    event_row.event_date,
    NULLIF(
      COALESCE(
        to_jsonb(event_row) ->> 'expected_attendees',
        to_jsonb(event_row) ->> 'expected_attendance',
        to_jsonb(event_row) ->> 'expected_attendance_min',
        to_jsonb(event_row) ->> 'expected_attendance_max'
      ),
      ''
    )::INTEGER AS expected_attendees
  INTO event_settings
  FROM public.events AS event_row
  WHERE event_row.id = NEW.event_id;

  min_notice_days := NULLIF(venue_settings.auto_approve_conditions ->> 'minNotice', '')::INTEGER;
  max_capacity := NULLIF(venue_settings.auto_approve_conditions ->> 'maxCapacity', '')::INTEGER;

  IF min_notice_days IS NOT NULL AND event_settings.event_date IS NOT NULL THEN
    event_notice_days := event_settings.event_date::DATE - CURRENT_DATE;
    IF event_notice_days < min_notice_days THEN
      RETURN NEW;
    END IF;
  END IF;

  IF max_capacity IS NOT NULL
    AND event_settings.expected_attendees IS NOT NULL
    AND event_settings.expected_attendees > max_capacity
  THEN
    RETURN NEW;
  END IF;

  NEW.status := 'confirmed';
  NEW.approved_at := COALESCE(NEW.approved_at, transaction_timestamp());
  NEW.approval_source := 'auto';
  NEW.updated_at := transaction_timestamp();
  RETURN NEW;
END;
$function$;

-- Browser booking writes remain available for the legacy request surfaces, but
-- they may never manufacture or mutate planner execution provenance. The
-- SECURITY DEFINER validator below independently resolves the event/plan edge
-- and rejects plan-linked writes outside the exact ready-materialization bridge.
DROP POLICY IF EXISTS "Organizers can create venue booking requests" ON public.venue_bookings;
CREATE POLICY "Organizers can create venue booking requests"
  ON public.venue_bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    organizer_id = auth.uid()
    AND status = 'pending'
    AND plan_id IS NULL
    AND agent_action_id IS NULL
    AND approval_id IS NULL
    AND quoted_price_cents IS NULL
    AND approved_terms_snapshot IS NULL
  );

DROP POLICY IF EXISTS "Organizers can create vendor booking requests" ON public.vendor_bookings;
CREATE POLICY "Organizers can create vendor booking requests"
  ON public.vendor_bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    organizer_id = auth.uid()
    AND status = 'pending'
    AND plan_id IS NULL
    AND agent_action_id IS NULL
    AND approval_id IS NULL
    AND quoted_price_cents IS NULL
    AND approved_terms_snapshot IS NULL
  );

DROP POLICY IF EXISTS "Venue owners can update own venue bookings" ON public.venue_bookings;
CREATE POLICY "Venue owners can update own venue bookings"
  ON public.venue_bookings FOR UPDATE
  TO authenticated
  USING (
    venue_id IN (
      SELECT venue.id
      FROM public.venues AS venue
      WHERE venue.owner_id = auth.uid()
    )
    AND plan_id IS NULL
    AND agent_action_id IS NULL
    AND approval_id IS NULL
    AND quoted_price_cents IS NULL
    AND approved_terms_snapshot IS NULL
  )
  WITH CHECK (
    venue_id IN (
      SELECT venue.id
      FROM public.venues AS venue
      WHERE venue.owner_id = auth.uid()
    )
    AND plan_id IS NULL
    AND agent_action_id IS NULL
    AND approval_id IS NULL
    AND quoted_price_cents IS NULL
    AND approved_terms_snapshot IS NULL
  );

DROP POLICY IF EXISTS "Vendors can update own vendor bookings" ON public.vendor_bookings;
CREATE POLICY "Vendors can update own vendor bookings"
  ON public.vendor_bookings FOR UPDATE
  TO authenticated
  USING (
    vendor_id IN (
      SELECT vendor_profile.id
      FROM public.vendor_profiles AS vendor_profile
      WHERE vendor_profile.user_id = auth.uid()
    )
    AND plan_id IS NULL
    AND agent_action_id IS NULL
    AND approval_id IS NULL
    AND quoted_price_cents IS NULL
    AND approved_terms_snapshot IS NULL
  )
  WITH CHECK (
    vendor_id IN (
      SELECT vendor_profile.id
      FROM public.vendor_profiles AS vendor_profile
      WHERE vendor_profile.user_id = auth.uid()
    )
    AND plan_id IS NULL
    AND agent_action_id IS NULL
    AND approval_id IS NULL
    AND quoted_price_cents IS NULL
    AND approved_terms_snapshot IS NULL
  );

CREATE OR REPLACE FUNCTION public.canonical_booking_has_execution_provenance(
  p_booking_kind TEXT,
  p_partner_id UUID,
  p_event_id UUID,
  p_plan_id UUID,
  p_agent_action_id UUID,
  p_approval_id UUID,
  p_organizer_id UUID,
  p_quoted_price_cents INTEGER,
  p_approved_terms_snapshot JSONB,
  p_booking_status TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_booking_kind IN ('venue', 'vendor')
    AND EXISTS (
      SELECT 1
      FROM public.plans AS plan_row
      JOIN public.events AS event_row
        ON event_row.id = plan_row.materialized_event_id
       AND event_row.plan_id = plan_row.id
      JOIN public.agent_actions AS action_row
        ON action_row.id = p_agent_action_id
       AND action_row.plan_id = plan_row.id
       AND action_row.approval_id = p_approval_id
      JOIN public.approvals AS approval_row
        ON approval_row.id = p_approval_id
       AND approval_row.agent_action_id = action_row.id
       AND approval_row.plan_id = plan_row.id
      WHERE plan_row.id = p_plan_id
        AND event_row.id = p_event_id
        AND plan_row.user_id = p_organizer_id
        AND action_row.payload_json ->> 'kind' = 'canonical_quote_booking'
        AND action_row.payload_json ->> 'quote_kind' = p_booking_kind
        AND action_row.target_type = CASE
          WHEN p_booking_kind = 'venue' THEN 'discovery_venue'
          ELSE 'discovery_vendor'
        END
        AND action_row.target_id::TEXT = action_row.payload_json ->> 'target_id'
        AND action_row.target_type = action_row.payload_json ->> 'target_type'
        AND approval_row.snapshot_schema_version = 2
        AND approval_row.snapshot_json ->> 'schema_version' = '2'
        AND approval_row.snapshot_json #> '{action,payload_json}' = action_row.payload_json
        AND approval_row.snapshot_json #>> '{action,action_type}' = action_row.action_type
        AND action_row.currency = 'usd'
        AND approval_row.provider = action_row.provider
        AND approval_row.snapshot_json #>> '{approval,provider}' = action_row.provider
        AND approval_row.snapshot_json #>> '{counterparty,provider}' = action_row.provider
        AND approval_row.snapshot_json #>> '{action,target_type}' = action_row.target_type
        AND approval_row.snapshot_json #>> '{action,target_id}' = action_row.target_id::TEXT
        AND approval_row.snapshot_json #>> '{action,amount_cents}' = action_row.amount_cents::TEXT
        AND approval_row.snapshot_json #>> '{counterparty,target_type}' = action_row.target_type
        AND approval_row.snapshot_json #>> '{counterparty,target_id}' = action_row.target_id::TEXT
        AND (
          (
            p_booking_kind = 'venue'
            AND EXISTS (
              SELECT 1
              FROM public.discovery_venues AS discovery_venue
              WHERE discovery_venue.id::TEXT = action_row.payload_json ->> 'target_id'
                AND discovery_venue.claimed_venue_id = p_partner_id
            )
          )
          OR
          (
            p_booking_kind = 'vendor'
            AND EXISTS (
              SELECT 1
              FROM public.vendor_profiles AS vendor_profile
              WHERE vendor_profile.discovery_vendor_id::TEXT = action_row.payload_json ->> 'target_id'
                AND vendor_profile.id = p_partner_id
            )
          )
        )
        AND action_row.amount_cents = p_quoted_price_cents
        AND approval_row.requested_amount_cents = p_quoted_price_cents
        AND approval_row.authorized_amount_cents = p_quoted_price_cents
        AND approval_row.price_cents = p_quoted_price_cents
        AND approval_row.authorized_by = plan_row.user_id
        AND approval_row.authorized_at IS NOT NULL
        AND NULLIF(btrim(approval_row.snapshot_hash), '') IS NOT NULL
        AND approval_row.snapshot_json = p_approved_terms_snapshot
        AND approval_row.event_date = event_row.event_date
        AND (
          (
            p_booking_status IN ('cancelled', 'rejected', 'declined')
            AND plan_row.status::TEXT IN ('executing', 'booked', 'completed', 'archived')
            AND approval_row.status IN ('approved', 'authorized', 'cancelled', 'rejected')
            AND (
              (
                p_booking_status = 'declined'
                AND action_row.status = 'cancelled'
              )
              OR (
                p_booking_status IN ('cancelled', 'rejected')
                AND action_row.status IN ('approved', 'executing', 'complete', 'cancelled')
              )
            )
          )
          OR
          (
            p_booking_status NOT IN ('cancelled', 'rejected', 'declined')
            AND (
              plan_row.status::TEXT IN ('executing', 'booked')
              OR (
                p_booking_status = 'confirmed'
                AND plan_row.status::TEXT IN ('completed', 'archived')
                AND action_row.status = 'complete'
              )
            )
            AND approval_row.status IN ('approved', 'authorized')
            AND (
              action_row.status IN ('executing', 'complete')
              OR (
                action_row.status = 'approved'
                AND (
                  approval_row.expires_at IS NULL
                  OR approval_row.expires_at > transaction_timestamp()
                )
              )
            )
          )
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.canonical_booking_has_execution_provenance(
  TEXT, UUID, UUID, UUID, UUID, UUID, UUID, INTEGER, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_booking_has_execution_provenance(
  TEXT, UUID, UUID, UUID, UUID, UUID, UUID, INTEGER, JSONB, TEXT
) TO service_role;

-- Once a canonical action points at an approval, its execution-sensitive fields
-- are immutable. The sole exception is the atomic approval-version successor
-- handoff, whose pending snapshot must describe the replacement action exactly.
CREATE OR REPLACE FUNCTION public.enforce_canonical_agent_action_material_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_previous_approval public.approvals%ROWTYPE;
  v_successor_approval public.approvals%ROWTYPE;
  v_expected_status TEXT;
  v_can_reset_waiting_quote BOOLEAN := false;
BEGIN
  IF NEW.approval_id IS NOT DISTINCT FROM OLD.approval_id
    AND NEW.action_type IS NOT DISTINCT FROM OLD.action_type
    AND NEW.provider IS NOT DISTINCT FROM OLD.provider
    AND NEW.target_type IS NOT DISTINCT FROM OLD.target_type
    AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
    AND NEW.amount_cents IS NOT DISTINCT FROM OLD.amount_cents
    AND NEW.currency IS NOT DISTINCT FROM OLD.currency
    AND NEW.payload_json IS NOT DISTINCT FROM OLD.payload_json
  THEN
    RETURN NEW;
  END IF;

  IF OLD.payload_json ->> 'kind' IS DISTINCT FROM 'canonical_quote_booking'
    AND NEW.payload_json ->> 'kind' IS DISTINCT FROM 'canonical_quote_booking'
  THEN
    RETURN NEW;
  END IF;

  -- Staging creates the immutable fields before an approval is linked. Every
  -- later material edit must create and repoint to an exact successor version.
  IF OLD.approval_id IS NULL THEN
    IF NEW.approval_id IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT approval_row.*
    INTO v_successor_approval
    FROM public.approvals AS approval_row
    WHERE approval_row.id = NEW.approval_id
      AND approval_row.agent_action_id = NEW.id
      AND approval_row.plan_id = NEW.plan_id;

    IF NEW.action_type IS NOT DISTINCT FROM OLD.action_type
      AND NEW.provider IS NOT DISTINCT FROM OLD.provider
      AND NEW.target_type IS NOT DISTINCT FROM OLD.target_type
      AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
      AND NEW.amount_cents IS NOT DISTINCT FROM OLD.amount_cents
      AND NEW.currency IS NOT DISTINCT FROM OLD.currency
      AND NEW.payload_json IS NOT DISTINCT FROM OLD.payload_json
      AND NEW.status IS NOT DISTINCT FROM OLD.status
      AND NEW.executed_at IS NOT DISTINCT FROM OLD.executed_at
      AND NEW.executed_at IS NULL
      AND NEW.currency = 'usd'
      AND v_successor_approval.status = 'pending'
      AND v_successor_approval.version_number = 1
      AND v_successor_approval.root_approval_id = v_successor_approval.id
      AND v_successor_approval.supersedes_approval_id IS NULL
      AND v_successor_approval.snapshot_schema_version = 2
      AND v_successor_approval.snapshot_json ->> 'schema_version' = '2'
      AND v_successor_approval.provider = NEW.provider
      AND v_successor_approval.requested_amount_cents = NEW.amount_cents
      AND v_successor_approval.price_cents = NEW.amount_cents
      AND v_successor_approval.snapshot_json #>> '{approval,provider}' = NEW.provider
      AND v_successor_approval.snapshot_json #>> '{approval,requested_amount_cents}' = NEW.amount_cents::TEXT
      AND v_successor_approval.snapshot_json #>> '{approval,price_cents}' = NEW.amount_cents::TEXT
      AND v_successor_approval.snapshot_json #> '{action,payload_json}' = NEW.payload_json
      AND v_successor_approval.snapshot_json #>> '{action,action_type}' = NEW.action_type
      AND v_successor_approval.snapshot_json #>> '{action,target_type}' = NEW.target_type
      AND v_successor_approval.snapshot_json #>> '{action,target_id}' = NEW.target_id::TEXT
      AND v_successor_approval.snapshot_json #>> '{action,amount_cents}' = NEW.amount_cents::TEXT
      AND v_successor_approval.snapshot_json #>> '{counterparty,provider}' = NEW.provider
      AND v_successor_approval.snapshot_json #>> '{counterparty,target_type}' = NEW.target_type
      AND v_successor_approval.snapshot_json #>> '{counterparty,target_id}' = NEW.target_id::TEXT
      AND NEW.target_id::TEXT = NEW.payload_json ->> 'target_id'
      AND NEW.target_type = NEW.payload_json ->> 'target_type'
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'canonical_agent_action_initial_approval_link_mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT approval_row.*
  INTO v_previous_approval
  FROM public.approvals AS approval_row
  WHERE approval_row.id = OLD.approval_id
    AND approval_row.agent_action_id = OLD.id
    AND approval_row.plan_id = OLD.plan_id;

  SELECT COALESCE(
    OLD.status = 'executing'
    AND OLD.action_type = 'concierge_queue'
    AND OLD.payload_json ->> 'kind' = 'canonical_quote_booking'
    AND OLD.payload_json ->> 'requires_event_materialization' = 'true'
    AND OLD.result_metadata ->> 'canonical_booking_status' IN (
      'waiting_for_event_materialization',
      'resuming_after_event_materialization',
      'reapproval_required'
    )
    AND OLD.result_metadata ->> 'outbound_message_sent' IS DISTINCT FROM 'true'
    AND OLD.last_retry_status IS DISTINCT FROM 'in_progress'
    AND NOT (COALESCE(OLD.result_metadata, '{}'::jsonb) ? 'handoff_status')
    AND NOT EXISTS (
      SELECT 1 FROM public.venue_bookings AS booking_row
      WHERE booking_row.agent_action_id = OLD.id
         OR booking_row.approval_id = OLD.approval_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.vendor_bookings AS booking_row
      WHERE booking_row.agent_action_id = OLD.id
         OR booking_row.approval_id = OLD.approval_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.admin_tasks AS task_row
      WHERE task_row.agent_action_id = OLD.id
         OR task_row.approval_id = OLD.approval_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.outreach_messages AS message_row
      WHERE message_row.agent_action_id = OLD.id
         OR message_row.approval_id = OLD.approval_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.outreach_threads AS thread_row
      WHERE thread_row.source_agent_action_id = OLD.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_intents AS payment_row
      WHERE payment_row.approval_id = OLD.approval_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.vendor_transactions AS transaction_row
      WHERE transaction_row.approval_id = OLD.approval_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.venue_payment_transactions AS transaction_row
      WHERE transaction_row.approval_id = OLD.approval_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.platform_fee_transactions AS transaction_row
      WHERE transaction_row.approval_id = OLD.approval_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.settlement_charges AS charge_row
      WHERE charge_row.approval_id = OLD.approval_id
    ),
    false
  ) INTO v_can_reset_waiting_quote;

  IF NEW.approval_id IS DISTINCT FROM OLD.approval_id
    AND (
      OLD.status NOT IN ('executing', 'complete', 'failed', 'cancelled')
      OR v_can_reset_waiting_quote
    )
  THEN
    SELECT approval_row.*
    INTO v_successor_approval
    FROM public.approvals AS approval_row
    WHERE approval_row.id = NEW.approval_id
      AND approval_row.agent_action_id = NEW.id
      AND approval_row.plan_id = NEW.plan_id;

    v_expected_status := CASE
      WHEN OLD.status = 'approved' OR v_can_reset_waiting_quote THEN 'pending'
      ELSE OLD.status
    END;
    IF v_previous_approval.status = 'superseded'
      AND v_successor_approval.status = 'pending'
      AND v_successor_approval.supersedes_approval_id = v_previous_approval.id
      AND v_successor_approval.root_approval_id = v_previous_approval.root_approval_id
      AND v_successor_approval.version_number = v_previous_approval.version_number + 1
      AND v_successor_approval.snapshot_schema_version = 2
      AND v_successor_approval.snapshot_json ->> 'schema_version' = '2'
      AND NEW.action_type IS NOT DISTINCT FROM OLD.action_type
      AND NEW.target_type IS NOT DISTINCT FROM OLD.target_type
      AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
      AND NEW.amount_cents IS NOT DISTINCT FROM OLD.amount_cents
      AND v_successor_approval.requested_amount_cents = NEW.amount_cents
      AND v_successor_approval.price_cents = NEW.amount_cents
      AND v_successor_approval.provider = NEW.provider
      AND v_successor_approval.snapshot_json #> '{action,payload_json}' = NEW.payload_json
      AND v_successor_approval.snapshot_json #>> '{action,action_type}' = NEW.action_type
      AND v_successor_approval.snapshot_json #>> '{action,target_type}' = NEW.target_type
      AND v_successor_approval.snapshot_json #>> '{action,target_id}' = NEW.target_id::TEXT
      AND v_successor_approval.snapshot_json #>> '{action,amount_cents}' = NEW.amount_cents::TEXT
      AND v_successor_approval.snapshot_json #>> '{approval,provider}' = NEW.provider
      AND v_successor_approval.snapshot_json #>> '{approval,requested_amount_cents}' = NEW.amount_cents::TEXT
      AND v_successor_approval.snapshot_json #>> '{approval,price_cents}' = NEW.amount_cents::TEXT
      AND v_successor_approval.snapshot_json #>> '{counterparty,provider}' = NEW.provider
      AND v_successor_approval.snapshot_json #>> '{counterparty,target_type}' = NEW.target_type
      AND v_successor_approval.snapshot_json #>> '{counterparty,target_id}' = NEW.target_id::TEXT
      AND NEW.provider IS NOT DISTINCT FROM OLD.provider
      AND NEW.currency IS NOT DISTINCT FROM OLD.currency
      AND NEW.currency = 'usd'
      AND NEW.payload_json ->> 'kind' = 'canonical_quote_booking'
      AND NEW.payload_json ->> 'quote_kind' IS NOT DISTINCT FROM OLD.payload_json ->> 'quote_kind'
      AND NEW.target_id::TEXT = NEW.payload_json ->> 'target_id'
      AND NEW.target_type = NEW.payload_json ->> 'target_type'
      AND (NEW.payload_json ->> 'requested_amount_cents')::INTEGER = NEW.amount_cents
      AND (NEW.payload_json ->> 'price_cents')::INTEGER = NEW.amount_cents
      AND (
        NOT (NEW.payload_json ? 'requestedAmountCents')
        OR (NEW.payload_json ->> 'requestedAmountCents')::INTEGER = NEW.amount_cents
      )
      AND (
        NOT (NEW.payload_json ? 'amount_cents')
        OR (NEW.payload_json ->> 'amount_cents')::INTEGER = NEW.amount_cents
      )
      AND (
        NEW.payload_json - ARRAY[
          'approval_revision', 'expires_at', 'notes',
          'requestedAmountCents', 'amount_cents'
        ]::TEXT[]
      ) IS NOT DISTINCT FROM (
        OLD.payload_json - ARRAY[
          'approval_revision', 'expires_at', 'notes',
          'requestedAmountCents', 'amount_cents'
        ]::TEXT[]
      )
      AND NEW.status = v_expected_status
      AND NEW.executed_at IS NULL
    THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'canonical_agent_action_material_fields_are_immutable'
    USING ERRCODE = '23514';
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_canonical_agent_action_material_immutability()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_canonical_agent_action_material_immutability()
  TO service_role;

CREATE TRIGGER enforce_canonical_agent_action_material_immutability_trigger
  BEFORE UPDATE OF approval_id, action_type, provider, target_type, target_id, amount_cents, currency, payload_json
  ON public.agent_actions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_canonical_agent_action_material_immutability();

CREATE OR REPLACE FUNCTION public.enforce_canonical_booking_execution_provenance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan_id UUID;
  v_plan_user_id UUID;
  v_plan_status TEXT;
  v_materialized_event_id UUID;
  v_event_date DATE;
  v_event_start_time TIME;
  v_event_end_time TIME;
  v_event_expected_attendance INTEGER;
  v_event_expected_attendance_min INTEGER;
  v_event_expected_attendance_max INTEGER;
  v_partner_id UUID;
  v_booking_row JSONB;
  v_approved_price NUMERIC;
  v_booking_kind TEXT := CASE
    WHEN TG_TABLE_NAME = 'venue_bookings' THEN 'venue'
    ELSE 'vendor'
  END;
  v_is_ready_legacy_bridge BOOLEAN := false;
  v_caller_role TEXT := COALESCE(
    NULLIF(auth.role()::TEXT, ''),
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    session_user::TEXT
  );
BEGIN
  -- A canonical booking is durable execution history. Never let an UPDATE turn
  -- it back into a legacy row (or rebind it to another event/approval) to evade
  -- the exact-provenance and immutable-term checks below.
  IF TG_OP = 'UPDATE' AND OLD.plan_id IS NOT NULL AND (
    NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.organizer_id IS DISTINCT FROM OLD.organizer_id
    OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
    OR NEW.agent_action_id IS DISTINCT FROM OLD.agent_action_id
    OR NEW.approval_id IS DISTINCT FROM OLD.approval_id
    OR NEW.quoted_price_cents IS DISTINCT FROM OLD.quoted_price_cents
    OR NEW.approved_terms_snapshot IS DISTINCT FROM OLD.approved_terms_snapshot
    OR (
      TG_TABLE_NAME = 'venue_bookings'
      AND to_jsonb(NEW) ->> 'venue_id' IS DISTINCT FROM to_jsonb(OLD) ->> 'venue_id'
    )
    OR (
      TG_TABLE_NAME = 'vendor_bookings'
      AND to_jsonb(NEW) ->> 'vendor_id' IS DISTINCT FROM to_jsonb(OLD) ->> 'vendor_id'
    )
  ) THEN
    RAISE EXCEPTION 'canonical_booking_provenance_identity_is_immutable'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    event_row.plan_id,
    plan_row.user_id,
    plan_row.status::TEXT,
    plan_row.materialized_event_id,
    event_row.event_date,
    event_row.start_time,
    event_row.end_time,
    event_row.expected_attendance,
    event_row.expected_attendance_min,
    event_row.expected_attendance_max
  INTO
    v_plan_id,
    v_plan_user_id,
    v_plan_status,
    v_materialized_event_id,
    v_event_date,
    v_event_start_time,
    v_event_end_time,
    v_event_expected_attendance,
    v_event_expected_attendance_min,
    v_event_expected_attendance_max
  FROM public.events AS event_row
  LEFT JOIN public.plans AS plan_row ON plan_row.id = event_row.plan_id
  WHERE event_row.id = NEW.event_id;

  -- A null plan_id is a legacy/imported event, not planner execution evidence.
  IF v_plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_materialized_event_id IS DISTINCT FROM NEW.event_id THEN
    RAISE EXCEPTION 'canonical_booking_event_plan_identity_mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.builder_event_materializations AS materialization
    WHERE materialization.plan_id = v_plan_id
      AND materialization.event_id = NEW.event_id
      AND materialization.status = 'materialized'
  )
  INTO v_is_ready_legacy_bridge;

  IF v_plan_status = 'ready' AND v_is_ready_legacy_bridge THEN
    IF NEW.organizer_id IS DISTINCT FROM v_plan_user_id THEN
      RAISE EXCEPTION 'ready_legacy_booking_organizer_does_not_match_plan_owner'
        USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' AND (
      NEW.event_id IS DISTINCT FROM OLD.event_id
      OR NEW.organizer_id IS DISTINCT FROM OLD.organizer_id
      OR (
        TG_TABLE_NAME = 'venue_bookings'
        AND to_jsonb(NEW) ->> 'venue_id' IS DISTINCT FROM to_jsonb(OLD) ->> 'venue_id'
      )
      OR (
        TG_TABLE_NAME = 'vendor_bookings'
        AND to_jsonb(NEW) ->> 'vendor_id' IS DISTINCT FROM to_jsonb(OLD) ->> 'vendor_id'
      )
    ) THEN
      RAISE EXCEPTION 'ready_legacy_booking_identity_is_immutable'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.plan_id IS NOT NULL
      OR NEW.agent_action_id IS NOT NULL
      OR NEW.approval_id IS NOT NULL
      OR NEW.quoted_price_cents IS NOT NULL
      OR NEW.approved_terms_snapshot IS NOT NULL
    THEN
      RAISE EXCEPTION 'ready_legacy_booking_must_not_claim_canonical_provenance'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- Trigger functions run as their owner so they can resolve canonical
  -- identity through RLS. Authorize against the original JWT/SET ROLE instead
  -- of current_user: authenticated users must use a service-owned command for
  -- every canonical booking mutation.
  IF v_caller_role NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'canonical_booking_mutation_requires_service_command'
      USING ERRCODE = '42501';
  END IF;

  -- Read the table-specific partner through JSON so the same trigger function
  -- can fail closed on both booking row types.
  v_booking_row := to_jsonb(NEW);
  IF v_booking_kind = 'venue' THEN
    v_partner_id := NULLIF(v_booking_row ->> 'venue_id', '')::UUID;
  ELSE
    v_partner_id := NULLIF(v_booking_row ->> 'vendor_id', '')::UUID;
  END IF;

  -- Expiry blocks starting new work. Once a durable booking row exists and the
  -- action is executing, a later partner confirmation may finish after expiry.
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1
    FROM public.approvals AS approval_row
    WHERE approval_row.id = NEW.approval_id
      AND approval_row.expires_at IS NOT NULL
      AND approval_row.expires_at <= transaction_timestamp()
  ) THEN
    RAISE EXCEPTION 'canonical_booking_start_requires_unexpired_approval'
      USING ERRCODE = '23514';
  END IF;

  IF NOT public.canonical_booking_has_execution_provenance(
    v_booking_kind,
    v_partner_id,
    NEW.event_id,
    NEW.plan_id,
    NEW.agent_action_id,
    NEW.approval_id,
    NEW.organizer_id,
    NEW.quoted_price_cents,
    NEW.approved_terms_snapshot,
    NEW.status
  ) THEN
    RAISE EXCEPTION 'canonical_booking_requires_exact_executable_provenance'
      USING ERRCODE = '23514';
  END IF;

  -- Payment state (Stripe ids/status, paid/refund timestamps, platform fees and
  -- payment totals) remains mutable through its dedicated approval-gated flows.
  -- Booking terms remain the exact canonical event and approved quote snapshot.
  v_approved_price := NEW.quoted_price_cents::NUMERIC / 100;

    IF v_booking_row ->> 'booking_date' IS DISTINCT FROM v_event_date::TEXT
      OR v_booking_row ->> 'start_time' IS DISTINCT FROM v_event_start_time::TEXT
      OR v_booking_row ->> 'end_time' IS DISTINCT FROM v_event_end_time::TEXT
      OR NULLIF(v_booking_row ->> 'quoted_price', '')::NUMERIC IS DISTINCT FROM v_approved_price
      OR NULLIF(v_booking_row ->> 'subtotal', '')::NUMERIC IS DISTINCT FROM v_approved_price
      OR v_booking_row ->> 'final_price' IS NOT NULL
    THEN
      RAISE EXCEPTION 'canonical_booking_material_terms_do_not_match_approval'
        USING ERRCODE = '23514';
    END IF;

    IF v_booking_kind = 'venue' THEN
      IF v_booking_row ->> 'guest_count_min' IS DISTINCT FROM v_event_expected_attendance_min::TEXT
        OR v_booking_row ->> 'guest_count_max' IS DISTINCT FROM v_event_expected_attendance_max::TEXT
        OR v_booking_row ->> 'services_needed' IS NOT NULL
        OR v_booking_row ->> 'special_requests' IS NOT NULL
      THEN
        RAISE EXCEPTION 'canonical_venue_booking_terms_require_reapproval'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      IF v_booking_row ->> 'requested_date' IS DISTINCT FROM v_event_date::TEXT
        OR v_booking_row ->> 'requested_start_time' IS DISTINCT FROM v_event_start_time::TEXT
        OR v_booking_row ->> 'requested_end_time' IS DISTINCT FROM v_event_end_time::TEXT
        OR v_booking_row ->> 'guest_count' IS DISTINCT FROM v_event_expected_attendance::TEXT
        OR v_booking_row ->> 'setup_time' IS NOT NULL
        OR v_booking_row ->> 'requirements' IS NOT NULL
        OR v_booking_row ->> 'notes' IS NOT NULL
        OR v_booking_row ->> 'vendor_offering_id' IS NOT NULL
        OR v_booking_row ->> 'vendor_package_id' IS NOT NULL
        OR v_booking_row ->> 'quantity' IS NOT NULL
        OR v_booking_row ->> 'deposit_amount' IS NOT NULL
      THEN
        RAISE EXCEPTION 'canonical_vendor_booking_terms_require_reapproval'
          USING ERRCODE = '23514';
      END IF;

      IF NEW.status IS DISTINCT FROM 'confirmed' AND (
        v_booking_row ->> 'confirmed_date' IS NOT NULL
        OR v_booking_row ->> 'confirmed_start_time' IS NOT NULL
        OR v_booking_row ->> 'confirmed_end_time' IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'canonical_vendor_booking_confirmation_terms_require_confirmed_status'
          USING ERRCODE = '23514';
      END IF;

      IF NEW.status = 'confirmed' AND (
        v_booking_row ->> 'confirmed_date' IS DISTINCT FROM v_event_date::TEXT
        OR v_booking_row ->> 'confirmed_start_time' IS DISTINCT FROM v_event_start_time::TEXT
        OR v_booking_row ->> 'confirmed_end_time' IS DISTINCT FROM v_event_end_time::TEXT
      ) THEN
        RAISE EXCEPTION 'canonical_vendor_booking_confirmation_terms_do_not_match_event'
          USING ERRCODE = '23514';
      END IF;
    END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_canonical_booking_execution_provenance()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_canonical_booking_execution_provenance()
  TO service_role;

CREATE TRIGGER enforce_venue_booking_execution_provenance_trigger
  BEFORE INSERT OR UPDATE OF
    venue_id, event_id, organizer_id, status, plan_id, agent_action_id, approval_id,
    quoted_price_cents, approved_terms_snapshot, booking_date, start_time, end_time,
    guest_count_min, guest_count_max, quoted_price, final_price, subtotal,
    services_needed, special_requests
  ON public.venue_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_canonical_booking_execution_provenance();

CREATE TRIGGER enforce_vendor_booking_execution_provenance_trigger
  BEFORE INSERT OR UPDATE OF
    vendor_id, event_id, organizer_id, status, plan_id, agent_action_id, approval_id,
    quoted_price_cents, approved_terms_snapshot, booking_date, start_time, end_time,
    requested_date, requested_start_time, requested_end_time, confirmed_date,
    confirmed_start_time, confirmed_end_time, setup_time, guest_count, quoted_price,
    final_price, subtotal, requirements, notes, vendor_offering_id, vendor_package_id,
    quantity, deposit_amount
  ON public.vendor_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_canonical_booking_execution_provenance();

-- Replace Prompt 7's RLS-sensitive AFTER trigger. A vendor/organizer must not
-- be able to make the event/plan lookup disappear and turn a canonical
-- confirmation into a legacy no-op. The exact ready bridge remains unchanged;
-- all other canonical confirmations are service-command-only.
CREATE OR REPLACE FUNCTION public.advance_plan_after_confirmed_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan_id UUID;
  v_plan_user_id UUID;
  v_plan_status TEXT;
  v_booking_kind TEXT := CASE
    WHEN TG_TABLE_NAME = 'venue_bookings' THEN 'venue'
    ELSE 'vendor'
  END;
  v_caller_role TEXT := COALESCE(
    NULLIF(auth.role()::TEXT, ''),
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    session_user::TEXT
  );
BEGIN
  IF NEW.status <> 'confirmed'
    OR (TG_OP = 'UPDATE' AND OLD.status = 'confirmed')
  THEN
    RETURN NEW;
  END IF;

  SELECT event_row.plan_id, plan_row.user_id, plan_row.status::TEXT
  INTO v_plan_id, v_plan_user_id, v_plan_status
  FROM public.events AS event_row
  JOIN public.plans AS plan_row ON plan_row.id = event_row.plan_id
  WHERE event_row.id = NEW.event_id;

  -- Events without reciprocal canonical plan identity keep legacy behavior.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_plan_status = 'ready'
    AND EXISTS (
      SELECT 1
      FROM public.builder_event_materializations AS materialization
      WHERE materialization.plan_id = v_plan_id
        AND materialization.event_id = NEW.event_id
        AND materialization.status = 'materialized'
    )
  THEN
    RETURN NEW;
  END IF;

  IF v_caller_role NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'canonical_booking_confirmation_requires_service_role'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.organizer_id IS DISTINCT FROM v_plan_user_id THEN
    RAISE EXCEPTION 'canonical_booking_organizer_does_not_match_plan_owner'
      USING ERRCODE = '23514';
  END IF;

  IF v_plan_status = 'executing' THEN
    PERFORM public.transition_plan_status(
      v_plan_id,
      'executing',
      'booked',
      'booking_created',
      v_plan_user_id,
      jsonb_build_object(
        'booking_id', NEW.id,
        'booking_kind', v_booking_kind,
        'event_id', NEW.event_id
      )
    );
  ELSIF v_plan_status NOT IN ('booked', 'completed') THEN
    RAISE EXCEPTION 'confirmed_booking_for_ineligible_plan_status'
      USING ERRCODE = '23514', DETAIL = v_plan_status;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.advance_plan_after_confirmed_booking()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_plan_after_confirmed_booking()
  TO service_role;

-- Defense in depth for direct calls to transition_plan_status: even if a
-- confirmed compatibility row exists, executing -> booked cannot commit unless
-- a confirmed, exactly-provenanced booking is present.
CREATE OR REPLACE FUNCTION public.require_canonical_booking_provenance_for_booked_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.status::TEXT <> 'executing' OR NEW.status::TEXT <> 'booked' THEN
    RETURN NEW;
  END IF;

  IF NOT (
    EXISTS (
      SELECT 1
      FROM public.venue_bookings AS booking
      WHERE booking.event_id = NEW.materialized_event_id
        AND booking.plan_id = NEW.id
        AND booking.status = 'confirmed'
        AND public.canonical_booking_has_execution_provenance(
          'venue', booking.venue_id, booking.event_id, booking.plan_id,
          booking.agent_action_id, booking.approval_id, booking.organizer_id,
          booking.quoted_price_cents, booking.approved_terms_snapshot,
          booking.status
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.vendor_bookings AS booking
      WHERE booking.event_id = NEW.materialized_event_id
        AND booking.plan_id = NEW.id
        AND booking.status = 'confirmed'
        AND public.canonical_booking_has_execution_provenance(
          'vendor', booking.vendor_id, booking.event_id, booking.plan_id,
          booking.agent_action_id, booking.approval_id, booking.organizer_id,
          booking.quoted_price_cents, booking.approved_terms_snapshot,
          booking.status
        )
    )
  ) THEN
    RAISE EXCEPTION 'plan_booking_transition_requires_execution_provenance'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.require_canonical_booking_provenance_for_booked_plan()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.require_canonical_booking_provenance_for_booked_plan()
  TO service_role;

CREATE TRIGGER require_canonical_booking_provenance_for_booked_plan_trigger
  BEFORE UPDATE OF status ON public.plans
  FOR EACH ROW
  EXECUTE FUNCTION public.require_canonical_booking_provenance_for_booked_plan();

-- A hold may be authorized and queued before the host confirms the exact event
-- schedule. Re-resolve the reciprocal event at the irreversible operator
-- completion boundary so the durable task, public outcome, and host message all
-- carry the canonical event identity created in the meantime.
CREATE OR REPLACE FUNCTION public.resolve_admin_task_event_on_hold_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event_id UUID;
BEGIN
  IF NEW.status <> 'complete'
    OR OLD.status = 'complete'
    OR NEW.event_id IS NOT NULL
    OR NEW.agent_action_id IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT plan_row.materialized_event_id
  INTO v_event_id
  FROM public.plans AS plan_row
  JOIN public.agent_actions AS action_row
    ON action_row.id = NEW.agent_action_id
   AND action_row.plan_id = plan_row.id
   AND action_row.action_type = 'hold_request'
  JOIN public.approvals AS approval_row
    ON approval_row.id = NEW.approval_id
   AND approval_row.agent_action_id = action_row.id
   AND approval_row.plan_id = plan_row.id
  WHERE plan_row.id = NEW.plan_id
    AND action_row.approval_id = approval_row.id
    AND approval_row.status IN ('approved', 'authorized')
    AND approval_row.authorized_by = plan_row.user_id
    AND approval_row.authorized_at IS NOT NULL
    AND NULLIF(btrim(approval_row.snapshot_hash), '') IS NOT NULL
  FOR KEY SHARE OF plan_row, action_row, approval_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'hold_completion_requires_exact_approved_task_provenance'
      USING ERRCODE = '23514';
  END IF;

  IF v_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.events AS event_row
    WHERE event_row.id = v_event_id
      AND event_row.plan_id = NEW.plan_id
  ) THEN
    RAISE EXCEPTION 'hold_completion_canonical_event_identity_mismatch'
      USING ERRCODE = '23514';
  END IF;

  NEW.event_id := v_event_id;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_admin_task_event_on_hold_completion()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_admin_task_event_on_hold_completion()
  TO service_role;

CREATE TRIGGER resolve_admin_task_event_on_hold_completion_trigger
  BEFORE UPDATE OF status ON public.admin_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.resolve_admin_task_event_on_hold_completion();
