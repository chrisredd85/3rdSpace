-- Prompt 7 / P0.4: one canonical planner identity spine.
--
-- This migration is deliberately additive. Existing event rows remain legacy
-- rows with plan_id = NULL; no title/date/owner guessing is used as a backfill.

-- ---------------------------------------------------------------------------
-- Lossless planner archetype -> event taxonomy
-- ---------------------------------------------------------------------------

CREATE TABLE public.planner_event_taxonomy (
  archetype_key TEXT PRIMARY KEY,
  event_type TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT planner_event_taxonomy_key_check
    CHECK (archetype_key ~ '^[a-z0-9_]+$'),
  CONSTRAINT planner_event_taxonomy_lossless_check
    CHECK (event_type = archetype_key)
);

INSERT INTO public.planner_event_taxonomy (
  archetype_key, event_type, display_name
) VALUES
  ('networking_mixer', 'networking_mixer', 'Networking mixer'),
  ('founder_operator_dinner', 'founder_operator_dinner', 'Founder/operator dinner'),
  ('brand_product_launch', 'brand_product_launch', 'Brand/product launch'),
  ('pop_up_activation', 'pop_up_activation', 'Pop-up / activation'),
  ('workshop_class', 'workshop_class', 'Workshop / class'),
  ('panel_fireside', 'panel_fireside', 'Panel / fireside'),
  ('demo_day_pitch_night', 'demo_day_pitch_night', 'Demo day / pitch night'),
  ('hackathon', 'hackathon', 'Hackathon'),
  ('community_meetup', 'community_meetup', 'Community meetup'),
  ('fundraiser_gala', 'fundraiser_gala', 'Fundraiser / gala'),
  ('private_dinner_celebration', 'private_dinner_celebration', 'Private dinner / celebration'),
  ('day_party_brunch_party', 'day_party_brunch_party', 'Day party / brunch party'),
  ('nightlife_club_night', 'nightlife_club_night', 'Nightlife / club night'),
  ('listening_party_showcase', 'listening_party_showcase', 'Listening party / showcase'),
  ('watch_party_screening', 'watch_party_screening', 'Watch party / screening'),
  ('fitness_wellness_run_club', 'fitness_wellness_run_club', 'Fitness / wellness / run club'),
  ('game_sports_outing', 'game_sports_outing', 'Game / sports outing'),
  ('holiday_reception', 'holiday_reception', 'Holiday reception'),
  ('retreat_offsite', 'retreat_offsite', 'Retreat / offsite');

COMMENT ON TABLE public.planner_event_taxonomy IS
  'The 19 supported planner archetypes mapped losslessly to canonical events.event_type values.';

ALTER TABLE public.planner_event_taxonomy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read planner event taxonomy"
  ON public.planner_event_taxonomy FOR SELECT
  USING (true);

REVOKE ALL ON TABLE public.planner_event_taxonomy FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.planner_event_taxonomy TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON TABLE public.planner_event_taxonomy TO service_role;

-- Keep every previously accepted event type while adding all canonical keys.
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS valid_event_type;
ALTER TABLE public.events
  ADD CONSTRAINT valid_event_type CHECK (event_type::TEXT = ANY (ARRAY[
    'networking', 'conference', 'workshop', 'social_mixer',
    'product_launch', 'all_hands', 'other',
    'networking_mixer', 'founder_operator_dinner', 'brand_product_launch',
    'pop_up_activation', 'workshop_class', 'panel_fireside',
    'demo_day_pitch_night', 'hackathon', 'community_meetup',
    'fundraiser_gala', 'private_dinner_celebration',
    'day_party_brunch_party', 'nightlife_club_night',
    'listening_party_showcase', 'watch_party_screening',
    'fitness_wellness_run_club', 'game_sports_outing',
    'holiday_reception', 'retreat_offsite'
  ]));

-- ---------------------------------------------------------------------------
-- Canonical identity and exact schedule
-- ---------------------------------------------------------------------------

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS plan_id UUID,
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS time_zone TEXT,
  ADD COLUMN IF NOT EXISTS outcome_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outcome_summary JSONB;

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS materialized_event_id UUID;

ALTER TABLE public.templates
  ADD COLUMN IF NOT EXISTS source_event_id UUID;

ALTER TABLE public.events
  ADD CONSTRAINT events_plan_id_unique UNIQUE (plan_id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT events_plan_id_fkey FOREIGN KEY (plan_id)
    REFERENCES public.plans(id) ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT events_exact_schedule_shape_check CHECK (
    (starts_at IS NULL AND ends_at IS NULL AND time_zone IS NULL)
    OR
    (
      starts_at IS NOT NULL AND ends_at IS NOT NULL AND NULLIF(btrim(time_zone), '') IS NOT NULL
      AND ends_at > starts_at
      AND ends_at <= starts_at + INTERVAL '24 hours'
    )
  ),
  ADD CONSTRAINT events_canonical_schedule_required_check CHECK (
    plan_id IS NULL OR (starts_at IS NOT NULL AND ends_at IS NOT NULL AND time_zone IS NOT NULL)
  ),
  ADD CONSTRAINT events_outcome_evidence_shape_check CHECK (
    (outcome_recorded_at IS NULL AND outcome_summary IS NULL)
    OR
    (
      outcome_recorded_at IS NOT NULL
      AND outcome_summary IS NOT NULL
      AND jsonb_typeof(outcome_summary) = 'object'
      AND outcome_summary <> '{}'::jsonb
      AND (
        outcome_summary ? 'actual_attendance'
        OR outcome_summary ? 'gross_revenue_cents'
        OR outcome_summary ? 'total_cost_cents'
        OR (
          jsonb_typeof(outcome_summary -> 'notes') = 'string'
          AND NULLIF(btrim(outcome_summary ->> 'notes'), '') IS NOT NULL
        )
      )
      AND (
        NOT (outcome_summary ? 'notes')
        OR jsonb_typeof(outcome_summary -> 'notes') = 'string'
      )
      AND (
        NOT (outcome_summary ? 'actual_attendance')
        OR (
          jsonb_typeof(outcome_summary -> 'actual_attendance') = 'number'
          AND (outcome_summary ->> 'actual_attendance') ~ '^[0-9]+$'
        )
      )
      AND (
        NOT (outcome_summary ? 'gross_revenue_cents')
        OR (
          jsonb_typeof(outcome_summary -> 'gross_revenue_cents') = 'number'
          AND (outcome_summary ->> 'gross_revenue_cents') ~ '^[0-9]+$'
        )
      )
      AND (
        NOT (outcome_summary ? 'total_cost_cents')
        OR (
          jsonb_typeof(outcome_summary -> 'total_cost_cents') = 'number'
          AND (outcome_summary ->> 'total_cost_cents') ~ '^[0-9]+$'
        )
      )
    )
  );

ALTER TABLE public.plans
  ADD CONSTRAINT plans_materialized_event_id_unique UNIQUE (materialized_event_id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT plans_materialized_event_id_fkey FOREIGN KEY (materialized_event_id)
    REFERENCES public.events(id) ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.templates
  ADD CONSTRAINT templates_source_event_id_fkey FOREIGN KEY (source_event_id)
    REFERENCES public.events(id) ON DELETE SET NULL;

CREATE INDEX templates_source_event_id_lookup ON public.templates(source_event_id);
CREATE INDEX events_starts_at_lookup ON public.events(starts_at);

COMMENT ON COLUMN public.events.plan_id IS
  'Nullable canonical link to the one planner plan that materialized this event. Legacy events intentionally remain NULL.';
COMMENT ON COLUMN public.plans.materialized_event_id IS
  'Nullable reciprocal pointer to the one canonical event materialized from this plan.';
COMMENT ON COLUMN public.events.starts_at IS
  'Exact UTC event start; time_zone preserves the local scheduling intent.';
COMMENT ON COLUMN public.events.outcome_recorded_at IS
  'Service-recorded outcome evidence required before a canonical plan can become completed.';
COMMENT ON COLUMN public.events.outcome_summary IS
  'Non-empty structured outcome evidence; never a caller-supplied completion boolean.';
COMMENT ON COLUMN public.templates.source_event_id IS
  'Canonical completed event whose measured outcome informed this template.';

-- Source provenance is nullable for templates created without a historical run
-- and for privacy deletion. When present, both pointers must describe the same
-- owned, completed canonical event with measured outcome evidence. The check is
-- deferred so ON DELETE SET NULL can clear both pointers in one transaction.
CREATE OR REPLACE FUNCTION public.enforce_template_source_event_provenance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_template public.templates%ROWTYPE;
BEGIN
  SELECT template_row.*
  INTO v_template
  FROM public.templates AS template_row
  WHERE template_row.id = NEW.id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_template.source_plan_id IS NULL AND v_template.source_event_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_template.source_plan_id IS NULL OR v_template.source_event_id IS NULL THEN
    RAISE EXCEPTION 'template_source_plan_and_event_must_be_paired'
      USING ERRCODE = '23514',
            CONSTRAINT = 'templates_source_event_provenance_check';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.plans AS plan_row
    JOIN public.events AS event_row
      ON event_row.id = plan_row.materialized_event_id
     AND event_row.plan_id = plan_row.id
    WHERE plan_row.id = v_template.source_plan_id
      AND event_row.id = v_template.source_event_id
      AND plan_row.user_id = v_template.user_id
      AND plan_row.status::TEXT = 'completed'
      AND event_row.status = 'completed'
      AND event_row.outcome_recorded_at IS NOT NULL
      AND jsonb_typeof(event_row.outcome_summary) = 'object'
      AND event_row.outcome_summary <> '{}'::jsonb
  ) THEN
    RAISE EXCEPTION 'template_source_event_must_be_owned_completed_canonical_event'
      USING ERRCODE = '23514',
            CONSTRAINT = 'templates_source_event_provenance_check';
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_template_source_event_provenance()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_template_source_event_provenance()
  TO service_role;

CREATE CONSTRAINT TRIGGER enforce_template_source_event_provenance_trigger
  AFTER INSERT OR UPDATE OF user_id, source_plan_id, source_event_id
  ON public.templates
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_template_source_event_provenance();

-- The circular links are intentionally deferred so the event and plan can be
-- linked atomically in either statement order. The constraint triggers assert
-- that a transaction may never commit only one side of the identity pair.
CREATE OR REPLACE FUNCTION public.enforce_plan_event_identity_pair()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_plan public.plans%ROWTYPE;
  v_builder_user_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'events' THEN
    SELECT event_row.*
    INTO v_event
    FROM public.events AS event_row
    WHERE event_row.id = NEW.id;

    -- The row may have been removed later in the same deferred transaction.
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    IF v_event.plan_id IS NULL THEN
      IF EXISTS (
        SELECT 1
        FROM public.plans AS plan_row
        WHERE plan_row.materialized_event_id = v_event.id
      ) THEN
        RAISE EXCEPTION 'canonical_event_identity_is_one_sided'
          USING ERRCODE = '23514',
                CONSTRAINT = 'events_plans_reciprocal_identity_check';
      END IF;
      RETURN NULL;
    END IF;

    SELECT plan_row.*
    INTO v_plan
    FROM public.plans AS plan_row
    WHERE plan_row.id = v_event.plan_id;

    IF NOT FOUND OR v_plan.materialized_event_id IS DISTINCT FROM v_event.id THEN
      RAISE EXCEPTION 'canonical_event_identity_is_not_reciprocal'
        USING ERRCODE = '23514',
              CONSTRAINT = 'events_plans_reciprocal_identity_check';
    END IF;

    SELECT builder.user_id
    INTO v_builder_user_id
    FROM public.builder_profiles AS builder
    WHERE builder.id = v_event.builder_id;

    IF v_builder_user_id IS DISTINCT FROM v_plan.user_id THEN
      RAISE EXCEPTION 'canonical_event_owner_does_not_match_plan_owner'
        USING ERRCODE = '23514',
              CONSTRAINT = 'events_plans_owner_identity_check';
    END IF;

    RETURN NULL;
  END IF;

  SELECT plan_row.*
  INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = NEW.id;

  -- The row may have been removed later in the same deferred transaction.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_plan.materialized_event_id IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.events AS event_row
      WHERE event_row.plan_id = v_plan.id
    ) THEN
      RAISE EXCEPTION 'canonical_plan_identity_is_one_sided'
        USING ERRCODE = '23514',
              CONSTRAINT = 'events_plans_reciprocal_identity_check';
    END IF;
    RETURN NULL;
  END IF;

  SELECT event_row.*
  INTO v_event
  FROM public.events AS event_row
  WHERE event_row.id = v_plan.materialized_event_id;

  IF NOT FOUND OR v_event.plan_id IS DISTINCT FROM v_plan.id THEN
    RAISE EXCEPTION 'canonical_plan_identity_is_not_reciprocal'
      USING ERRCODE = '23514',
            CONSTRAINT = 'events_plans_reciprocal_identity_check';
  END IF;

  SELECT builder.user_id
  INTO v_builder_user_id
  FROM public.builder_profiles AS builder
  WHERE builder.id = v_event.builder_id;

  IF v_builder_user_id IS DISTINCT FROM v_plan.user_id THEN
    RAISE EXCEPTION 'canonical_plan_owner_does_not_match_event_owner'
      USING ERRCODE = '23514',
            CONSTRAINT = 'events_plans_owner_identity_check';
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_plan_event_identity_pair()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_plan_event_identity_pair()
  TO service_role;

CREATE CONSTRAINT TRIGGER enforce_event_plan_identity_pair
  AFTER INSERT OR UPDATE OF plan_id, builder_id ON public.events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_plan_event_identity_pair();

CREATE CONSTRAINT TRIGGER enforce_plan_event_identity_pair
  AFTER INSERT OR UPDATE OF materialized_event_id, user_id ON public.plans
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_plan_event_identity_pair();

-- Existing owner policies may continue to mutate legacy events. Once an event
-- participates in the canonical identity spine, browsers cannot rewrite its
-- identity, exact schedule, lifecycle, or outcome evidence directly.
CREATE OR REPLACE FUNCTION public.protect_canonical_event_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_is_privileged BOOLEAN := current_user IN ('postgres', 'service_role');
  v_plan_id UUID;
  v_protected_fields_changed BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.plan_id IS NOT NULL AND NOT v_is_privileged THEN
      RAISE EXCEPTION 'canonical_event_creation_requires_service_role'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  v_plan_id := COALESCE(OLD.plan_id, NEW.plan_id);
  v_protected_fields_changed := (
    NEW.plan_id IS DISTINCT FROM OLD.plan_id
    OR NEW.builder_id IS DISTINCT FROM OLD.builder_id
    OR NEW.event_name IS DISTINCT FROM OLD.event_name
    OR NEW.event_description IS DISTINCT FROM OLD.event_description
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.event_date IS DISTINCT FROM OLD.event_date
    OR NEW.start_time IS DISTINCT FROM OLD.start_time
    OR NEW.end_time IS DISTINCT FROM OLD.end_time
    OR NEW.duration_hours IS DISTINCT FROM OLD.duration_hours
    OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
    OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
    OR NEW.time_zone IS DISTINCT FROM OLD.time_zone
    OR NEW.expected_attendance IS DISTINCT FROM OLD.expected_attendance
    OR NEW.expected_attendance_min IS DISTINCT FROM OLD.expected_attendance_min
    OR NEW.expected_attendance_max IS DISTINCT FROM OLD.expected_attendance_max
    OR NEW.budget IS DISTINCT FROM OLD.budget
    OR NEW.total_budget IS DISTINCT FROM OLD.total_budget
    OR NEW.venue_id IS DISTINCT FROM OLD.venue_id
    OR NEW.venue_confirmed IS DISTINCT FROM OLD.venue_confirmed
    OR NEW.actual_cost IS DISTINCT FROM OLD.actual_cost
    OR NEW.completion_percentage IS DISTINCT FROM OLD.completion_percentage
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.outcome_recorded_at IS DISTINCT FROM OLD.outcome_recorded_at
    OR NEW.outcome_summary IS DISTINCT FROM OLD.outcome_summary
  );

  IF (OLD.plan_id IS NOT NULL OR NEW.plan_id IS NOT NULL)
    AND v_protected_fields_changed
  THEN
    IF NOT v_is_privileged THEN
      RAISE EXCEPTION 'canonical_event_fields_require_service_role'
        USING ERRCODE = '42501';
    END IF;

    IF current_user = 'service_role'
      AND COALESCE(
        current_setting('app.canonical_plan_revision_plan_id', true),
        ''
      ) <> COALESCE(v_plan_id::TEXT, '')
      AND COALESCE(
        current_setting('app.canonical_event_materialization_event_id', true),
        ''
      ) <> NEW.id::TEXT
      AND COALESCE(
        current_setting('app.canonical_event_outcome_event_id', true),
        ''
      ) <> NEW.id::TEXT
    THEN
      RAISE EXCEPTION 'canonical_event_fields_require_dedicated_command'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_canonical_event_fields()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_canonical_event_fields()
  TO service_role;

CREATE TRIGGER protect_canonical_event_fields_trigger
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_canonical_event_fields();

-- A host may continue editing a draft plan through existing owner policies.
-- Once the plan has an exact event, browser roles cannot point it elsewhere or
-- mutate the planning inputs that defined that event behind the event's back.
CREATE OR REPLACE FUNCTION public.protect_canonical_plan_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_is_privileged BOOLEAN := current_user IN ('postgres', 'service_role');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status::TEXT NOT IN ('drafting', 'ready') AND current_user <> 'postgres' THEN
      RAISE EXCEPTION 'plan_creation_cannot_skip_lifecycle_transitions'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.materialized_event_id IS NOT NULL AND NOT v_is_privileged THEN
      RAISE EXCEPTION 'canonical_plan_event_pointer_requires_service_role'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.materialized_event_id IS DISTINCT FROM OLD.materialized_event_id THEN
    IF OLD.materialized_event_id IS NOT NULL THEN
      RAISE EXCEPTION 'canonical_plan_event_pointer_is_immutable'
        USING ERRCODE = '23514';
    END IF;

    IF NOT v_is_privileged THEN
      RAISE EXCEPTION 'canonical_plan_event_pointer_requires_service_role'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF (
      OLD.materialized_event_id IS NOT NULL
      OR OLD.status::TEXT IN (
        'approved', 'executing', 'booked', 'completed', 'complete', 'archived'
      )
    )
    AND (
      NEW.title IS DISTINCT FROM OLD.title
      OR NEW.event_type IS DISTINCT FROM OLD.event_type
      OR NEW.guest_count IS DISTINCT FROM OLD.guest_count
      OR NEW.budget_cap_cents IS DISTINCT FROM OLD.budget_cap_cents
      OR NEW.date_window_start IS DISTINCT FROM OLD.date_window_start
      OR NEW.date_window_end IS DISTINCT FROM OLD.date_window_end
      OR NEW.neighborhood IS DISTINCT FROM OLD.neighborhood
      OR NEW.ticketed IS DISTINCT FROM OLD.ticketed
      OR NEW.ticketing_model IS DISTINCT FROM OLD.ticketing_model
      OR NEW.food_responsibility IS DISTINCT FROM OLD.food_responsibility
      OR NEW.venue_terms IS DISTINCT FROM OLD.venue_terms
      OR NEW.agent_action IS DISTINCT FROM OLD.agent_action
      OR NEW.profit_goal_cents IS DISTINCT FROM OLD.profit_goal_cents
      OR NEW.notes IS DISTINCT FROM OLD.notes
      OR NEW.committed_venue_id IS DISTINCT FROM OLD.committed_venue_id
      OR NEW.committed_venue_quoted_price_cents
        IS DISTINCT FROM OLD.committed_venue_quoted_price_cents
      OR NEW.committed_venue_quoted_deal_model
        IS DISTINCT FROM OLD.committed_venue_quoted_deal_model
      OR NEW.committed_venue_quoted_terms
        IS DISTINCT FROM OLD.committed_venue_quoted_terms
      OR NEW.committed_venue_at IS DISTINCT FROM OLD.committed_venue_at
      OR NEW.committed_vendors IS DISTINCT FROM OLD.committed_vendors
      OR (NEW.metadata #> '{event_archetype_lock}')
        IS DISTINCT FROM (OLD.metadata #> '{event_archetype_lock}')
      OR (NEW.metadata -> 'committed_venue')
        IS DISTINCT FROM (OLD.metadata -> 'committed_venue')
      OR (NEW.metadata -> 'committed_vendors')
        IS DISTINCT FROM (OLD.metadata -> 'committed_vendors')
      OR (NEW.metadata -> 'accepted_quote_state')
        IS DISTINCT FROM (OLD.metadata -> 'accepted_quote_state')
    )
    AND NOT (
      v_is_privileged
      AND (
        COALESCE(
          current_setting('app.canonical_plan_revision_plan_id', true),
          ''
        ) = OLD.id::TEXT
        OR COALESCE(
          current_setting('app.canonical_plan_lineage_plan_id', true),
          ''
        ) = OLD.id::TEXT
      )
    )
  THEN
    RAISE EXCEPTION 'canonical_plan_inputs_require_dedicated_revision_command'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_canonical_plan_fields()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_canonical_plan_fields()
  TO service_role;

CREATE TRIGGER protect_canonical_plan_fields_trigger
  BEFORE INSERT OR UPDATE ON public.plans
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_canonical_plan_fields();

-- ---------------------------------------------------------------------------
-- Audited plan lifecycle
-- ---------------------------------------------------------------------------

-- `complete` is retained for historical rows. New canonical flows use the
-- semantically distinct `booked` and `completed` values.
ALTER TYPE public.planner_plan_status ADD VALUE IF NOT EXISTS 'booked';
ALTER TYPE public.planner_plan_status ADD VALUE IF NOT EXISTS 'completed';

CREATE TABLE public.plan_status_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE NO ACTION,
  from_status public.planner_plan_status NOT NULL,
  to_status public.planner_plan_status NOT NULL,
  transition_trigger TEXT NOT NULL,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE NO ACTION,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT plan_status_transitions_changed_check
    CHECK (from_status IS DISTINCT FROM to_status),
  CONSTRAINT plan_status_transitions_trigger_check
    CHECK (transition_trigger IN (
      'intake_completed',
      'intake_invalidated',
      'approval_authorized',
      'event_materialized',
      'booking_created',
      'outcome_recorded',
      'plan_archived'
    )),
  CONSTRAINT plan_status_transitions_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

COMMENT ON TABLE public.plan_status_transitions IS
  'Append-only audit log written by transition_plan_status for every canonical plan lifecycle change.';

CREATE INDEX plan_status_transitions_plan_time_lookup
  ON public.plan_status_transitions(plan_id, transitioned_at DESC);
CREATE INDEX plan_status_transitions_event_time_lookup
  ON public.plan_status_transitions(event_id, transitioned_at DESC)
  WHERE event_id IS NOT NULL;

ALTER TABLE public.plan_status_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own plan status transitions"
  ON public.plan_status_transitions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.plans AS plan_row
      WHERE plan_row.id = plan_status_transitions.plan_id
        AND plan_row.user_id = auth.uid()
    )
  );

REVOKE ALL ON TABLE public.plan_status_transitions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.plan_status_transitions TO authenticated;
GRANT SELECT, INSERT ON TABLE public.plan_status_transitions TO service_role;

DROP TRIGGER IF EXISTS enforce_planner_plan_status_transition ON public.plans;

CREATE OR REPLACE FUNCTION public.enforce_plan_status_helper_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF current_user NOT IN ('postgres', 'service_role')
    OR current_setting('app.plan_transition_plan_id', true) IS DISTINCT FROM OLD.id::TEXT
    OR current_setting('app.plan_transition_from_status', true) IS DISTINCT FROM OLD.status::TEXT
    OR current_setting('app.plan_transition_to_status', true) IS DISTINCT FROM NEW.status::TEXT
    OR current_setting('app.plan_transition_trigger', true) IS NULL
  THEN
    RAISE EXCEPTION 'plan_status_must_use_transition_plan_status'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_plan_status_helper_only()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_plan_status_helper_only()
  TO service_role;

CREATE TRIGGER enforce_plan_status_helper_only_trigger
  BEFORE UPDATE OF status ON public.plans
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_plan_status_helper_only();

CREATE OR REPLACE FUNCTION public.transition_plan_status(
  p_plan_id UUID,
  p_expected_status TEXT,
  p_to_status TEXT,
  p_trigger TEXT,
  p_actor_id UUID,
  p_context JSONB
)
RETURNS public.plans
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_from_status TEXT;
  v_expected_trigger TEXT;
  v_allowed BOOLEAN := false;
  v_last_transition public.plan_status_transitions%ROWTYPE;
BEGIN
  IF current_user <> 'postgres'
    AND NOT (current_user = 'service_role' AND auth.role() = 'service_role')
  THEN
    RAISE EXCEPTION 'plan_status_transition_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'plan_status_transition_actor_required'
      USING ERRCODE = '22023';
  END IF;

  IF p_context IS NULL OR jsonb_typeof(p_context) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'plan_status_transition_context_must_be_object'
      USING ERRCODE = '22023';
  END IF;

  v_expected_trigger := CASE p_to_status
    WHEN 'ready' THEN 'intake_completed'
    WHEN 'drafting' THEN 'intake_invalidated'
    WHEN 'approved' THEN 'approval_authorized'
    WHEN 'executing' THEN 'event_materialized'
    WHEN 'booked' THEN 'booking_created'
    WHEN 'completed' THEN 'outcome_recorded'
    WHEN 'archived' THEN 'plan_archived'
    ELSE NULL
  END;

  IF v_expected_trigger IS NULL OR p_trigger IS DISTINCT FROM v_expected_trigger THEN
    RAISE EXCEPTION 'plan_status_transition_trigger_mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT plan_row.*
  INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan_status_transition_plan_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_plan.user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'plan_status_transition_actor_mismatch'
      USING ERRCODE = '42501';
  END IF;

  v_from_status := v_plan.status::TEXT;

  -- A retry is idempotent only when it describes the transition that actually
  -- produced the current status. A different actor/trigger/context is a stale
  -- compare-and-swap request, not an equivalent retry.
  IF v_from_status = p_to_status THEN
    SELECT transition_row.*
    INTO v_last_transition
    FROM public.plan_status_transitions AS transition_row
    WHERE transition_row.plan_id = v_plan.id
    ORDER BY transition_row.transitioned_at DESC, transition_row.id DESC
    LIMIT 1;

    IF FOUND
      AND v_last_transition.from_status::TEXT = p_expected_status
      AND v_last_transition.to_status::TEXT = p_to_status
      AND v_last_transition.transition_trigger = p_trigger
      AND v_last_transition.actor_id = p_actor_id
      AND v_last_transition.metadata = p_context
    THEN
      RETURN v_plan;
    END IF;

    RAISE EXCEPTION 'plan_status_transition_retry_does_not_match_last_transition'
      USING ERRCODE = '40001';
  END IF;

  IF v_from_status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'plan_status_compare_and_swap_conflict'
      USING ERRCODE = '40001',
            DETAIL = format('expected %s but found %s', p_expected_status, v_from_status);
  END IF;

  v_allowed := CASE
    WHEN p_expected_status = 'drafting' AND p_to_status = 'ready' THEN true
    WHEN p_expected_status = 'ready' AND p_to_status = 'drafting' THEN true
    WHEN p_expected_status = 'ready' AND p_to_status = 'approved' THEN true
    WHEN p_expected_status = 'approved' AND p_to_status = 'executing' THEN true
    WHEN p_expected_status = 'executing' AND p_to_status = 'booked' THEN true
    WHEN p_expected_status = 'booked' AND p_to_status = 'completed' THEN true
    WHEN p_expected_status <> 'archived' AND p_to_status = 'archived' THEN true
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'illegal_plan_status_transition_from_%_to_%', v_from_status, p_to_status
      USING ERRCODE = '23514';
  END IF;

  IF p_trigger = 'approval_authorized' AND NOT EXISTS (
    SELECT 1
    FROM public.approvals AS approval
    WHERE approval.plan_id = v_plan.id
      AND approval.status IN ('approved', 'authorized')
      AND approval.authorized_by = p_actor_id
      AND approval.authorized_at IS NOT NULL
      AND NULLIF(btrim(approval.snapshot_hash), '') IS NOT NULL
      AND (approval.expires_at IS NULL OR approval.expires_at > transaction_timestamp())
  ) THEN
    RAISE EXCEPTION 'plan_approval_authorization_evidence_missing'
      USING ERRCODE = '23514';
  END IF;

  IF p_trigger = 'event_materialized' AND NOT EXISTS (
    SELECT 1
    FROM public.events AS event_row
    WHERE event_row.id = v_plan.materialized_event_id
      AND event_row.plan_id = v_plan.id
  ) THEN
    RAISE EXCEPTION 'plan_materialized_event_evidence_missing'
      USING ERRCODE = '23514';
  END IF;

  IF p_trigger = 'booking_created' AND NOT (
    EXISTS (
      SELECT 1
      FROM public.venue_bookings AS booking
      WHERE booking.event_id = v_plan.materialized_event_id
        AND booking.status = 'confirmed'
        AND booking.organizer_id = v_plan.user_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.vendor_bookings AS booking
      WHERE booking.event_id = v_plan.materialized_event_id
        AND booking.status = 'confirmed'
        AND booking.organizer_id = v_plan.user_id
    )
  ) THEN
    RAISE EXCEPTION 'plan_confirmed_booking_evidence_missing'
      USING ERRCODE = '23514';
  END IF;

  IF p_trigger = 'outcome_recorded' AND NOT EXISTS (
    SELECT 1
    FROM public.events AS event_row
    WHERE event_row.id = v_plan.materialized_event_id
      AND event_row.plan_id = v_plan.id
      AND event_row.ends_at <= transaction_timestamp()
      AND event_row.status = 'completed'
      AND event_row.outcome_recorded_at IS NOT NULL
      AND jsonb_typeof(event_row.outcome_summary) = 'object'
      AND event_row.outcome_summary <> '{}'::jsonb
  ) THEN
    RAISE EXCEPTION 'plan_outcome_evidence_missing_or_event_not_ended'
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.plan_transition_plan_id', v_plan.id::TEXT, true);
  PERFORM set_config('app.plan_transition_from_status', v_from_status, true);
  PERFORM set_config('app.plan_transition_to_status', p_to_status, true);
  PERFORM set_config('app.plan_transition_trigger', p_trigger, true);

  UPDATE public.plans AS plan_row
  SET status = p_to_status::public.planner_plan_status
  WHERE plan_row.id = v_plan.id
  RETURNING plan_row.* INTO v_plan;

  PERFORM set_config('app.plan_transition_plan_id', '', true);
  PERFORM set_config('app.plan_transition_from_status', '', true);
  PERFORM set_config('app.plan_transition_to_status', '', true);
  PERFORM set_config('app.plan_transition_trigger', '', true);

  INSERT INTO public.plan_status_transitions (
    plan_id,
    event_id,
    from_status,
    to_status,
    transition_trigger,
    actor_id,
    metadata
  ) VALUES (
    v_plan.id,
    v_plan.materialized_event_id,
    v_from_status::public.planner_plan_status,
    p_to_status::public.planner_plan_status,
    p_trigger,
    p_actor_id,
    p_context
  );

  RETURN v_plan;
END;
$function$;

COMMENT ON FUNCTION public.transition_plan_status(UUID, TEXT, TEXT, TEXT, UUID, JSONB) IS
  'Service-only compare-and-swap status machine. Returns the updated plans row and writes one audited transition.';

REVOKE ALL ON FUNCTION public.transition_plan_status(UUID, TEXT, TEXT, TEXT, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_plan_status(UUID, TEXT, TEXT, TEXT, UUID, JSONB)
  TO service_role;

-- Quote commitments are planning snapshots and may be accepted before or after
-- exact materialization. This helper only annotates same-plan JSON snapshots
-- with lineage; it never creates a booking, action, approval, or payment.
CREATE OR REPLACE FUNCTION public.annotate_plan_quote_event_lineage(
  p_plan_id UUID,
  p_event_id UUID
)
RETURNS public.plans
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_metadata JSONB;
  v_annotated JSONB;
  v_committed_vendors JSONB;
BEGIN
  IF current_user <> 'postgres'
    AND NOT (current_user = 'service_role' AND auth.role() = 'service_role')
  THEN
    RAISE EXCEPTION 'annotate_plan_quote_event_lineage_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT plan_row.*
  INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_plan.materialized_event_id IS DISTINCT FROM p_event_id
    OR NOT EXISTS (
      SELECT 1
      FROM public.events AS event_row
      WHERE event_row.id = p_event_id
        AND event_row.plan_id = p_plan_id
    )
  THEN
    RAISE EXCEPTION 'annotate_plan_quote_event_lineage_identity_mismatch'
      USING ERRCODE = '23514';
  END IF;

  v_metadata := COALESCE(v_plan.metadata, '{}'::jsonb);
  v_committed_vendors := v_plan.committed_vendors;

  IF jsonb_typeof(v_metadata -> 'committed_venue') = 'object' THEN
    v_metadata := jsonb_set(
      v_metadata,
      '{committed_venue}',
      (v_metadata -> 'committed_venue') || jsonb_build_object('canonical_event_id', p_event_id),
      false
    );
  END IF;

  IF jsonb_typeof(v_metadata #> '{accepted_quote_state,venue}') = 'object' THEN
    v_metadata := jsonb_set(
      v_metadata,
      '{accepted_quote_state,venue}',
      (v_metadata #> '{accepted_quote_state,venue}')
        || jsonb_build_object('canonical_event_id', p_event_id),
      false
    );
  END IF;

  IF jsonb_typeof(v_committed_vendors) = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN jsonb_typeof(item.value) = 'object'
            THEN item.value || jsonb_build_object('canonical_event_id', p_event_id)
          ELSE item.value
        END
        ORDER BY item.ordinality
      ),
      '[]'::jsonb
    )
    INTO v_committed_vendors
    FROM jsonb_array_elements(v_committed_vendors)
      WITH ORDINALITY AS item(value, ordinality);
  END IF;

  IF jsonb_typeof(v_metadata -> 'committed_vendors') = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN jsonb_typeof(item.value) = 'object'
            THEN item.value || jsonb_build_object('canonical_event_id', p_event_id)
          ELSE item.value
        END
        ORDER BY item.ordinality
      ),
      '[]'::jsonb
    )
    INTO v_annotated
    FROM jsonb_array_elements(v_metadata -> 'committed_vendors')
      WITH ORDINALITY AS item(value, ordinality);

    v_metadata := jsonb_set(v_metadata, '{committed_vendors}', v_annotated, false);
  END IF;

  IF jsonb_typeof(v_metadata #> '{accepted_quote_state,vendors}') = 'array' THEN
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN jsonb_typeof(item.value) = 'object'
            THEN item.value || jsonb_build_object('canonical_event_id', p_event_id)
          ELSE item.value
        END
        ORDER BY item.ordinality
      ),
      '[]'::jsonb
    )
    INTO v_annotated
    FROM jsonb_array_elements(v_metadata #> '{accepted_quote_state,vendors}')
      WITH ORDINALITY AS item(value, ordinality);

    v_metadata := jsonb_set(
      v_metadata,
      '{accepted_quote_state,vendors}',
      v_annotated,
      false
    );
  END IF;

  PERFORM set_config('app.canonical_plan_lineage_plan_id', v_plan.id::TEXT, true);

  UPDATE public.plans AS plan_row
  SET metadata = v_metadata,
      committed_vendors = v_committed_vendors
  WHERE plan_row.id = v_plan.id
  RETURNING plan_row.* INTO v_plan;

  PERFORM set_config('app.canonical_plan_lineage_plan_id', '', true);

  RETURN v_plan;
END;
$function$;

COMMENT ON FUNCTION public.annotate_plan_quote_event_lineage(UUID, UUID) IS
  'Adds canonical_event_id lineage to existing same-plan venue/vendor quote snapshot JSON only.';

REVOKE ALL ON FUNCTION public.annotate_plan_quote_event_lineage(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.annotate_plan_quote_event_lineage(UUID, UUID)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Explicit plan -> exact event materialization
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.materialize_plan_event(
  p_plan_id UUID,
  p_actor_id UUID,
  p_archetype_key TEXT,
  p_event_date DATE,
  p_start_time TIME WITHOUT TIME ZONE,
  p_duration_minutes INTEGER,
  p_time_zone TEXT
)
RETURNS TABLE (
  event_id UUID,
  existing BOOLEAN,
  event_record JSONB,
  plan_status TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_taxonomy public.planner_event_taxonomy%ROWTYPE;
  v_builder_id UUID;
  v_time_zone TEXT := COALESCE(NULLIF(btrim(p_time_zone), ''), 'America/Los_Angeles');
  v_local_start TIMESTAMP WITHOUT TIME ZONE;
  v_starts_at TIMESTAMPTZ;
  v_ends_at TIMESTAMPTZ;
  v_local_end TIMESTAMP WITHOUT TIME ZONE;
  v_roundtrip_count INTEGER;
  v_transition_context JSONB;
  v_locked_archetype_key TEXT;
BEGIN
  IF current_user <> 'postgres'
    AND NOT (current_user = 'service_role' AND auth.role() = 'service_role')
  THEN
    RAISE EXCEPTION 'materialize_plan_event_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL
    OR p_event_date IS NULL
    OR p_start_time IS NULL
    OR NULLIF(btrim(p_archetype_key), '') IS NULL
  THEN
    RAISE EXCEPTION 'materialize_plan_event_required_fields_missing'
      USING ERRCODE = '22023';
  END IF;

  IF p_duration_minutes IS NULL OR p_duration_minutes NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION 'materialize_plan_event_duration_must_be_1_to_1440_minutes'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_timezone_names AS zone
    WHERE zone.name = v_time_zone
  ) THEN
    RAISE EXCEPTION 'materialize_plan_event_unknown_time_zone'
      USING ERRCODE = '22023', DETAIL = v_time_zone;
  END IF;

  SELECT plan_row.*
  INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'materialize_plan_event_plan_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_plan.user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'materialize_plan_event_actor_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF char_length(v_plan.title) > 255 THEN
    RAISE EXCEPTION 'materialize_plan_event_title_exceeds_event_limit'
      USING ERRCODE = '22001';
  END IF;

  SELECT taxonomy.*
  INTO v_taxonomy
  FROM public.planner_event_taxonomy AS taxonomy
  WHERE taxonomy.archetype_key = p_archetype_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'materialize_plan_event_unknown_archetype'
      USING ERRCODE = '22023', DETAIL = p_archetype_key;
  END IF;

  v_locked_archetype_key := NULLIF(
    btrim(v_plan.metadata #>> '{event_archetype_lock,key}'),
    ''
  );

  IF v_locked_archetype_key IS NOT NULL THEN
    IF v_locked_archetype_key IS DISTINCT FROM v_taxonomy.archetype_key THEN
      RAISE EXCEPTION 'materialize_plan_event_archetype_does_not_match_lock'
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_plan.event_type IS DISTINCT FROM v_taxonomy.archetype_key
    AND v_plan.event_type IS DISTINCT FROM v_taxonomy.display_name
  THEN
    RAISE EXCEPTION 'materialize_plan_event_archetype_does_not_match_plan'
      USING ERRCODE = '22023';
  END IF;

  IF v_plan.date_window_start IS NULL
    OR v_plan.date_window_end IS NULL
    OR p_event_date < v_plan.date_window_start
    OR p_event_date > v_plan.date_window_end
  THEN
    RAISE EXCEPTION 'materialize_plan_event_date_outside_plan_window'
      USING ERRCODE = '22023';
  END IF;

  SELECT builder.id
  INTO v_builder_id
  FROM public.builder_profiles AS builder
  WHERE builder.user_id = p_actor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'materialize_plan_event_builder_profile_missing'
      USING ERRCODE = '23503';
  END IF;

  v_local_start := p_event_date + p_start_time;
  v_starts_at := v_local_start AT TIME ZONE v_time_zone;

  -- A nonexistent spring-forward wall time normalizes to another local time.
  IF (v_starts_at AT TIME ZONE v_time_zone) IS DISTINCT FROM v_local_start THEN
    RAISE EXCEPTION 'materialize_plan_event_nonexistent_local_time'
      USING ERRCODE = '22023';
  END IF;

  -- A fall-back wall time maps to two instants. Without an explicit UTC offset
  -- the request is ambiguous, so reject instead of silently choosing one fold.
  SELECT count(*)::INTEGER
  INTO v_roundtrip_count
  FROM generate_series(
    v_starts_at - INTERVAL '3 hours',
    v_starts_at + INTERVAL '3 hours',
    INTERVAL '1 minute'
  ) AS candidate(instant)
  WHERE candidate.instant AT TIME ZONE v_time_zone = v_local_start;

  IF v_roundtrip_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'materialize_plan_event_ambiguous_local_time'
      USING ERRCODE = '22023';
  END IF;

  v_ends_at := v_starts_at + (p_duration_minutes * INTERVAL '1 minute');
  v_local_end := v_ends_at AT TIME ZONE v_time_zone;

  IF v_plan.materialized_event_id IS NOT NULL THEN
    SELECT event_row.*
    INTO v_event
    FROM public.events AS event_row
    WHERE event_row.id = v_plan.materialized_event_id
      AND event_row.plan_id = v_plan.id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'materialize_plan_event_reciprocal_identity_missing'
        USING ERRCODE = '23514';
    END IF;

    IF v_event.builder_id IS DISTINCT FROM v_builder_id
      OR v_event.event_name IS DISTINCT FROM v_plan.title
      OR v_event.event_description IS DISTINCT FROM v_plan.notes
      OR v_event.description IS DISTINCT FROM v_plan.notes
      OR v_event.event_type::TEXT IS DISTINCT FROM v_taxonomy.event_type
      OR v_event.event_date IS DISTINCT FROM p_event_date
      OR v_event.start_time IS DISTINCT FROM p_start_time
      OR v_event.starts_at IS DISTINCT FROM v_starts_at
      OR v_event.ends_at IS DISTINCT FROM v_ends_at
      OR v_event.time_zone IS DISTINCT FROM v_time_zone
      OR v_event.expected_attendance IS DISTINCT FROM v_plan.guest_count
      OR v_event.expected_attendance_min IS DISTINCT FROM v_plan.guest_count
      OR v_event.expected_attendance_max IS DISTINCT FROM v_plan.guest_count
      OR v_event.budget IS DISTINCT FROM (CASE
        WHEN v_plan.budget_cap_cents IS NULL THEN NULL
        ELSE v_plan.budget_cap_cents::NUMERIC / 100
      END)
      OR v_event.total_budget IS DISTINCT FROM (CASE
        WHEN v_plan.budget_cap_cents IS NULL THEN NULL
        ELSE v_plan.budget_cap_cents::NUMERIC / 100
      END)
    THEN
      RAISE EXCEPTION 'materialize_plan_event_idempotency_conflict'
        USING ERRCODE = '22023',
              DETAIL = 'The plan already has a canonical event with different identity or schedule inputs.';
    END IF;

    v_plan := public.annotate_plan_quote_event_lineage(v_plan.id, v_event.id);

    IF v_plan.status::TEXT = 'approved' THEN
      v_transition_context := jsonb_build_object(
        'event_id', v_event.id,
        'archetype_key', v_taxonomy.archetype_key,
        'starts_at', v_starts_at,
        'ends_at', v_ends_at,
        'time_zone', v_time_zone
      );

      v_plan := public.transition_plan_status(
        v_plan.id,
        'approved',
        'executing',
        'event_materialized',
        p_actor_id,
        v_transition_context
      );
    END IF;

    RETURN QUERY SELECT
      v_event.id,
      true,
      to_jsonb(v_event),
      v_plan.status::TEXT;
    RETURN;
  END IF;

  IF v_plan.status::TEXT <> 'approved' THEN
    RAISE EXCEPTION 'materialize_plan_event_plan_must_be_approved'
      USING ERRCODE = '23514', DETAIL = v_plan.status::TEXT;
  END IF;

  INSERT INTO public.events (
    builder_id,
    event_name,
    event_type,
    event_description,
    description,
    event_date,
    start_time,
    end_time,
    duration_hours,
    starts_at,
    ends_at,
    time_zone,
    expected_attendance,
    expected_attendance_min,
    expected_attendance_max,
    budget,
    total_budget,
    status,
    venue_id,
    plan_id
  ) VALUES (
    v_builder_id,
    v_plan.title,
    v_taxonomy.event_type,
    v_plan.notes,
    v_plan.notes,
    p_event_date,
    p_start_time,
    v_local_end::TIME,
    round(p_duration_minutes::NUMERIC / 60, 2),
    v_starts_at,
    v_ends_at,
    v_time_zone,
    v_plan.guest_count,
    v_plan.guest_count,
    v_plan.guest_count,
    CASE
      WHEN v_plan.budget_cap_cents IS NULL THEN NULL
      ELSE v_plan.budget_cap_cents::NUMERIC / 100
    END,
    CASE
      WHEN v_plan.budget_cap_cents IS NULL THEN NULL
      ELSE v_plan.budget_cap_cents::NUMERIC / 100
    END,
    'draft',
    NULL,
    v_plan.id
  )
  RETURNING * INTO v_event;

  UPDATE public.plans AS plan_row
  SET materialized_event_id = v_event.id,
      metadata = COALESCE(plan_row.metadata, '{}'::jsonb) || jsonb_build_object(
        'event_id', v_event.id,
        'canonical_event', jsonb_build_object(
          'event_id', v_event.id,
          'archetype_key', v_taxonomy.archetype_key,
          'starts_at', v_starts_at,
          'ends_at', v_ends_at,
          'time_zone', v_time_zone,
          'materialized_at', transaction_timestamp()
        )
      )
  WHERE plan_row.id = v_plan.id
  RETURNING plan_row.* INTO v_plan;

  v_plan := public.annotate_plan_quote_event_lineage(v_plan.id, v_event.id);

  v_transition_context := jsonb_build_object(
    'event_id', v_event.id,
    'archetype_key', v_taxonomy.archetype_key,
    'starts_at', v_starts_at,
    'ends_at', v_ends_at,
    'time_zone', v_time_zone
  );

  v_plan := public.transition_plan_status(
    v_plan.id,
    'approved',
    'executing',
    'event_materialized',
    p_actor_id,
    v_transition_context
  );

  RETURN QUERY SELECT
    v_event.id,
    false,
    to_jsonb(v_event),
    v_plan.status::TEXT;
END;
$function$;

COMMENT ON FUNCTION public.materialize_plan_event(
  UUID, UUID, TEXT, DATE, TIME WITHOUT TIME ZONE, INTEGER, TEXT
) IS
  'Service-only, row-locked, idempotent conversion of one approved planner plan into one exact timezone-aware canonical event.';

REVOKE ALL ON FUNCTION public.materialize_plan_event(
  UUID, UUID, TEXT, DATE, TIME WITHOUT TIME ZONE, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_plan_event(
  UUID, UUID, TEXT, DATE, TIME WITHOUT TIME ZONE, INTEGER, TEXT
) TO service_role;

-- ---------------------------------------------------------------------------
-- Evidence-driven lifecycle wiring
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.advance_plan_after_approval_authorized()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan_status TEXT;
BEGIN
  IF NEW.status NOT IN ('approved', 'authorized')
    OR (
      TG_OP = 'UPDATE'
      AND OLD.status IN ('approved', 'authorized')
    )
  THEN
    RETURN NEW;
  END IF;

  SELECT plan_row.status::TEXT
  INTO v_plan_status
  FROM public.plans AS plan_row
  WHERE plan_row.id = NEW.plan_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_plan_status = 'ready' THEN
    PERFORM public.transition_plan_status(
      NEW.plan_id,
      'ready',
      'approved',
      'approval_authorized',
      NEW.authorized_by,
      jsonb_build_object(
        'approval_id', NEW.id,
        'agent_action_id', NEW.agent_action_id,
        'snapshot_hash', NEW.snapshot_hash
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.advance_plan_after_approval_authorized()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_plan_after_approval_authorized()
  TO service_role;

CREATE TRIGGER advance_plan_after_approval_authorized_trigger
  AFTER INSERT OR UPDATE OF status ON public.approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.advance_plan_after_approval_authorized();

CREATE OR REPLACE FUNCTION public.advance_plan_after_confirmed_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
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
BEGIN
  IF NEW.status <> 'confirmed'
    OR (
      TG_OP = 'UPDATE'
      AND OLD.status = 'confirmed'
    )
  THEN
    RETURN NEW;
  END IF;

  SELECT event_row.plan_id, plan_row.user_id, plan_row.status::TEXT
  INTO v_plan_id, v_plan_user_id, v_plan_status
  FROM public.events AS event_row
  JOIN public.plans AS plan_row ON plan_row.id = event_row.plan_id
  WHERE event_row.id = NEW.event_id;

  -- Legacy bookings remain on their existing behavior until Prompt 10.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Prompt 6's builder-event materialization bridge predates canonical plan
  -- identity. Keep its ready-plan booking path unchanged until Prompt 10
  -- consolidates legacy imports and booking creation onto the canonical event.
  IF v_plan_status = 'ready'
    AND EXISTS (
      SELECT 1
      FROM public.builder_event_materializations AS materialization
      WHERE materialization.event_id = NEW.event_id
        AND materialization.status = 'materialized'
    )
  THEN
    RETURN NEW;
  END IF;

  IF current_user NOT IN ('postgres', 'service_role') THEN
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

CREATE TRIGGER advance_plan_after_confirmed_venue_booking_trigger
  AFTER INSERT OR UPDATE OF status ON public.venue_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.advance_plan_after_confirmed_booking();

CREATE TRIGGER advance_plan_after_confirmed_vendor_booking_trigger
  AFTER INSERT OR UPDATE OF status ON public.vendor_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.advance_plan_after_confirmed_booking();

CREATE OR REPLACE FUNCTION public.record_plan_event_outcome(
  p_event_id UUID,
  p_actor_id UUID,
  p_outcome_summary JSONB
)
RETURNS public.events
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_plan public.plans%ROWTYPE;
  v_recorded_at TIMESTAMPTZ := transaction_timestamp();
BEGIN
  IF current_user <> 'postgres'
    AND NOT (current_user = 'service_role' AND auth.role() = 'service_role')
  THEN
    RAISE EXCEPTION 'record_plan_event_outcome_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL
    OR p_outcome_summary IS NULL
    OR jsonb_typeof(p_outcome_summary) IS DISTINCT FROM 'object'
    OR p_outcome_summary = '{}'::jsonb
  THEN
    RAISE EXCEPTION 'record_plan_event_outcome_requires_structured_evidence'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (
    p_outcome_summary ? 'actual_attendance'
    OR p_outcome_summary ? 'gross_revenue_cents'
    OR p_outcome_summary ? 'total_cost_cents'
    OR (
      jsonb_typeof(p_outcome_summary -> 'notes') = 'string'
      AND NULLIF(btrim(p_outcome_summary ->> 'notes'), '') IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'record_plan_event_outcome_requires_measured_result_or_notes'
      USING ERRCODE = '22023';
  END IF;

  IF p_outcome_summary ? 'notes'
    AND jsonb_typeof(p_outcome_summary -> 'notes') <> 'string'
  THEN
    RAISE EXCEPTION 'record_plan_event_outcome_notes_must_be_string'
      USING ERRCODE = '22023';
  END IF;

  IF p_outcome_summary ? 'actual_attendance'
    AND (
      jsonb_typeof(p_outcome_summary -> 'actual_attendance') <> 'number'
      OR (p_outcome_summary ->> 'actual_attendance') !~ '^[0-9]+$'
    )
  THEN
    RAISE EXCEPTION 'record_plan_event_outcome_attendance_must_be_nonnegative_integer'
      USING ERRCODE = '22023';
  END IF;

  IF p_outcome_summary ? 'gross_revenue_cents'
    AND (
      jsonb_typeof(p_outcome_summary -> 'gross_revenue_cents') <> 'number'
      OR (p_outcome_summary ->> 'gross_revenue_cents') !~ '^[0-9]+$'
    )
  THEN
    RAISE EXCEPTION 'record_plan_event_outcome_revenue_cents_must_be_nonnegative_integer'
      USING ERRCODE = '22023';
  END IF;

  IF p_outcome_summary ? 'total_cost_cents'
    AND (
      jsonb_typeof(p_outcome_summary -> 'total_cost_cents') <> 'number'
      OR (p_outcome_summary ->> 'total_cost_cents') !~ '^[0-9]+$'
    )
  THEN
    RAISE EXCEPTION 'record_plan_event_outcome_cost_cents_must_be_nonnegative_integer'
      USING ERRCODE = '22023';
  END IF;

  SELECT event_row.*
  INTO v_event
  FROM public.events AS event_row
  WHERE event_row.id = p_event_id
    AND event_row.plan_id IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_plan_event_outcome_canonical_event_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT plan_row.*
  INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = v_event.plan_id
    AND plan_row.materialized_event_id = v_event.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_plan_event_outcome_canonical_event_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_plan.user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'record_plan_event_outcome_actor_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF v_plan.status::TEXT = 'completed' THEN
    IF v_event.outcome_summary = p_outcome_summary
      AND v_event.outcome_recorded_at IS NOT NULL
      AND v_event.status = 'completed'
    THEN
      RETURN v_event;
    END IF;

    RAISE EXCEPTION 'record_plan_event_outcome_idempotency_conflict'
      USING ERRCODE = '40001';
  END IF;

  IF v_plan.status::TEXT <> 'booked' THEN
    RAISE EXCEPTION 'record_plan_event_outcome_plan_must_be_booked'
      USING ERRCODE = '23514', DETAIL = v_plan.status::TEXT;
  END IF;

  IF v_event.ends_at > v_recorded_at THEN
    RAISE EXCEPTION 'record_plan_event_outcome_event_has_not_ended'
      USING ERRCODE = '23514';
  END IF;

  IF v_event.status = 'cancelled' THEN
    RAISE EXCEPTION 'record_plan_event_outcome_cancelled_event_cannot_complete'
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('app.canonical_event_outcome_event_id', v_event.id::TEXT, true);

  UPDATE public.events AS event_row
  SET status = 'completed',
      outcome_recorded_at = v_recorded_at,
      outcome_summary = p_outcome_summary,
      updated_at = v_recorded_at
  WHERE event_row.id = v_event.id
  RETURNING event_row.* INTO v_event;

  PERFORM set_config('app.canonical_event_outcome_event_id', '', true);

  v_plan := public.transition_plan_status(
    v_plan.id,
    'booked',
    'completed',
    'outcome_recorded',
    p_actor_id,
    jsonb_build_object(
      'event_id', v_event.id,
      'outcome_recorded_at', v_event.outcome_recorded_at,
      'outcome_summary', v_event.outcome_summary
    )
  );

  RETURN v_event;
END;
$function$;

COMMENT ON FUNCTION public.record_plan_event_outcome(UUID, UUID, JSONB) IS
  'Records server-timestamped structured outcome evidence after the event ends, then advances booked to completed.';

REVOKE ALL ON FUNCTION public.record_plan_event_outcome(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_plan_event_outcome(UUID, UUID, JSONB)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Compatibility link for future legacy builder materializations
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.link_builder_materialization_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_local_start TIMESTAMP WITHOUT TIME ZONE;
  v_starts_at TIMESTAMPTZ;
  v_ends_at TIMESTAMPTZ;
  v_roundtrip_count INTEGER;
  v_time_zone CONSTANT TEXT := 'America/Los_Angeles';
BEGIN
  IF NEW.status <> 'materialized'
    OR (
      TG_OP = 'UPDATE'
      AND OLD.status = 'materialized'
    )
  THEN
    RETURN NEW;
  END IF;

  SELECT plan_row.*
  INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = NEW.plan_id
  FOR UPDATE;

  SELECT event_row.*
  INTO v_event
  FROM public.events AS event_row
  WHERE event_row.id = NEW.event_id
  FOR UPDATE;

  IF v_plan.id IS NULL OR v_event.id IS NULL THEN
    RAISE EXCEPTION 'builder_materialization_identity_target_missing'
      USING ERRCODE = '23503';
  END IF;

  IF v_plan.user_id IS DISTINCT FROM NEW.user_id
    OR v_event.builder_id IS DISTINCT FROM NEW.builder_id
    OR NOT EXISTS (
      SELECT 1
      FROM public.builder_profiles AS builder
      WHERE builder.id = NEW.builder_id
        AND builder.user_id = NEW.user_id
    )
  THEN
    RAISE EXCEPTION 'builder_materialization_identity_owner_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF (v_event.plan_id IS NOT NULL AND v_event.plan_id IS DISTINCT FROM v_plan.id)
    OR (
      v_plan.materialized_event_id IS NOT NULL
      AND v_plan.materialized_event_id IS DISTINCT FROM v_event.id
    )
  THEN
    RAISE EXCEPTION 'builder_materialization_identity_conflict'
      USING ERRCODE = '23514';
  END IF;

  v_local_start := v_event.event_date + v_event.start_time;
  v_starts_at := v_local_start AT TIME ZONE v_time_zone;

  IF (v_starts_at AT TIME ZONE v_time_zone) IS DISTINCT FROM v_local_start THEN
    RAISE EXCEPTION 'builder_materialization_nonexistent_local_time'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::INTEGER
  INTO v_roundtrip_count
  FROM generate_series(
    v_starts_at - INTERVAL '3 hours',
    v_starts_at + INTERVAL '3 hours',
    INTERVAL '1 minute'
  ) AS candidate(instant)
  WHERE candidate.instant AT TIME ZONE v_time_zone = v_local_start;

  IF v_roundtrip_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'builder_materialization_ambiguous_local_time'
      USING ERRCODE = '22023';
  END IF;

  v_ends_at := v_starts_at + (v_event.duration_hours * INTERVAL '1 hour');

  PERFORM set_config(
    'app.canonical_event_materialization_event_id',
    v_event.id::TEXT,
    true
  );

  UPDATE public.events AS event_row
  SET plan_id = v_plan.id,
      starts_at = v_starts_at,
      ends_at = v_ends_at,
      time_zone = v_time_zone
  WHERE event_row.id = v_event.id;

  PERFORM set_config('app.canonical_event_materialization_event_id', '', true);

  UPDATE public.plans AS plan_row
  SET materialized_event_id = v_event.id,
      metadata = COALESCE(plan_row.metadata, '{}'::jsonb) || jsonb_build_object(
        'event_id', v_event.id,
        'canonical_event', jsonb_build_object(
          'event_id', v_event.id,
          'source', 'builder_events_api',
          'starts_at', v_starts_at,
          'ends_at', v_ends_at,
          'time_zone', v_time_zone,
          'materialization_request_id', NEW.id
        )
      )
  WHERE plan_row.id = v_plan.id
  RETURNING plan_row.* INTO v_plan;

  v_plan := public.annotate_plan_quote_event_lineage(v_plan.id, v_event.id);

  IF v_plan.status::TEXT = 'approved' THEN
    PERFORM public.transition_plan_status(
      v_plan.id,
      'approved',
      'executing',
      'event_materialized',
      v_plan.user_id,
      jsonb_build_object(
        'event_id', v_event.id,
        'source', 'builder_events_api',
        'materialization_request_id', NEW.id,
        'starts_at', v_starts_at,
        'ends_at', v_ends_at,
        'time_zone', v_time_zone
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.link_builder_materialization_identity()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_builder_materialization_identity()
  TO service_role;

CREATE TRIGGER link_builder_materialization_identity_trigger
  AFTER INSERT OR UPDATE OF status, plan_id, event_id
  ON public.builder_event_materializations
  FOR EACH ROW
  EXECUTE FUNCTION public.link_builder_materialization_identity();
