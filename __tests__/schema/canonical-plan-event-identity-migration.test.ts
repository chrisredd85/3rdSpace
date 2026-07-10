import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260709150000_add_canonical_plan_event_identity.sql'),
  'utf8',
)
const documentation = readFileSync(join(process.cwd(), 'docs/EVENT_IDENTITY.md'), 'utf8')

const archetypeKeys = [
  'networking_mixer',
  'founder_operator_dinner',
  'brand_product_launch',
  'pop_up_activation',
  'workshop_class',
  'panel_fireside',
  'demo_day_pitch_night',
  'hackathon',
  'community_meetup',
  'fundraiser_gala',
  'private_dinner_celebration',
  'day_party_brunch_party',
  'nightlife_club_night',
  'listening_party_showcase',
  'watch_party_screening',
  'fitness_wellness_run_club',
  'game_sports_outing',
  'holiday_reception',
  'retreat_offsite',
] as const

describe('canonical plan and event identity migration', () => {
  it('stores the 19 planner archetypes losslessly without invented fallbacks or durations', () => {
    const taxonomyInsert = migration.match(
      /INSERT INTO public\.planner_event_taxonomy[\s\S]+?;\n\nCOMMENT ON TABLE/,
    )?.[0] ?? ''
    const insertedKeys = [...taxonomyInsert.matchAll(/\('([a-z0-9_]+)',\s*'\1',\s*'[^']+'\)/g)]
      .map((match) => match[1])

    expect(insertedKeys).toEqual(archetypeKeys)
    expect(new Set(insertedKeys).size).toBe(19)
    expect(migration).toContain('CHECK (event_type = archetype_key)')
    expect(migration).not.toContain('legacy_fallback_event_type')
    expect(migration).not.toContain('default_duration_minutes')

    for (const key of archetypeKeys) {
      expect(migration).toContain(`'${key}'`)
      expect(documentation).toContain(`| \`${key}\` | \`${key}\``)
    }
  })

  it('adds a fail-closed reciprocal one-to-one identity without guessing a legacy backfill', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS plan_id UUID')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS materialized_event_id UUID')
    expect(migration).toContain('events_plan_id_unique UNIQUE (plan_id)')
    expect(migration).toContain('plans_materialized_event_id_unique UNIQUE (materialized_event_id)')
    expect(migration.match(/ON DELETE NO ACTION/g)).toHaveLength(4)
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/g)?.length).toBeGreaterThanOrEqual(6)
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER enforce_event_plan_identity_pair')
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER enforce_plan_event_identity_pair')
    expect(migration).toContain('canonical_event_owner_does_not_match_plan_owner')
    expect(migration).not.toContain('events_plan_id_lookup')
    expect(migration).not.toContain('plans_materialized_event_id_lookup')

    expect(documentation).toContain('does not infer links from titles, dates, owners, metadata, or approximate times')
    expect(documentation).toContain('non-canonical analytics compatibility records')
    expect(documentation).toMatch(/never\s+sufficient authorization for a booking, payment/)
  })

  it('materializes exact timezone-aware schedules behind a service-only idempotent RPC', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.materialize_plan_event\(\s*p_plan_id UUID,\s*p_actor_id UUID,\s*p_archetype_key TEXT,\s*p_event_date DATE,\s*p_start_time TIME WITHOUT TIME ZONE,\s*p_duration_minutes INTEGER,\s*p_time_zone TEXT\s*\)/)
    expect(migration).toMatch(/RETURNS TABLE \(\s*event_id UUID,\s*existing BOOLEAN,\s*event_record JSONB,\s*plan_status TEXT\s*\)/)
    expect(migration).toContain("'America/Los_Angeles'")
    expect(migration).toContain('pg_catalog.pg_timezone_names')
    expect(migration).toContain('materialize_plan_event_nonexistent_local_time')
    expect(migration).toContain('materialize_plan_event_ambiguous_local_time')
    expect(migration).toContain('materialize_plan_event_idempotency_conflict')
    expect(migration).toContain("metadata #>> '{event_archetype_lock,key}'")
    expect(migration).toContain('v_plan.event_type IS DISTINCT FROM v_taxonomy.display_name')
    expect(migration).toContain('v_event.expected_attendance IS DISTINCT FROM v_plan.guest_count')
    expect(migration).toContain('v_event.budget IS DISTINCT FROM (CASE')
    expect(migration).toContain('FOR UPDATE')
    expect(migration).toContain("'approved',\n    'executing',\n    'event_materialized'")
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.materialize_plan_event[\s\S]+FROM PUBLIC, anon, authenticated/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.materialize_plan_event[\s\S]+TO service_role/)
  })

  it('enforces the exact compare-and-swap status contract and writes an owner-readable audit', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.transition_plan_status\(\s*p_plan_id UUID,\s*p_expected_status TEXT,\s*p_to_status TEXT,\s*p_trigger TEXT,\s*p_actor_id UUID,\s*p_context JSONB\s*\)/)
    expect(migration).toContain('RETURNS public.plans')
    expect(migration).toContain('plan_status_compare_and_swap_conflict')
    expect(migration).toContain('plan_status_transition_retry_does_not_match_last_transition')
    expect(migration).toContain('v_last_transition.metadata = p_context')
    expect(migration).toContain('CREATE TABLE public.plan_status_transitions')
    expect(migration).toContain('CREATE POLICY "Users can read own plan status transitions"')
    expect(migration).toContain('plan_status_must_use_transition_plan_status')
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.transition_plan_status\(UUID, TEXT, TEXT, TEXT, UUID, JSONB\)[\s\S]+FROM PUBLIC, anon, authenticated/)

    for (const trigger of [
      'intake_completed',
      'intake_invalidated',
      'approval_authorized',
      'event_materialized',
      'booking_created',
      'outcome_recorded',
      'plan_archived',
    ]) {
      expect(migration).toContain(`'${trigger}'`)
      expect(documentation).toContain(`\`${trigger}\``)
    }

    expect(migration).toContain("ALTER TYPE public.planner_plan_status ADD VALUE IF NOT EXISTS 'booked'")
    expect(migration).toContain("ALTER TYPE public.planner_plan_status ADD VALUE IF NOT EXISTS 'completed'")
    expect(documentation).toContain('historical enum value `complete` remains readable')
  })

  it('advances approval, booking, and outcome states only from relational evidence', () => {
    expect(migration).toContain('CREATE TRIGGER advance_plan_after_approval_authorized_trigger')
    expect(migration).toContain('CREATE TRIGGER advance_plan_after_confirmed_venue_booking_trigger')
    expect(migration).toContain('CREATE TRIGGER advance_plan_after_confirmed_vendor_booking_trigger')
    expect(migration).toContain('approval.authorized_at IS NOT NULL')
    expect(migration).toContain("booking.status = 'confirmed'")
    expect(migration).toContain('event_row.ends_at <= transaction_timestamp()')
    expect(migration).toContain("event_row.status = 'completed'")
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS outcome_summary JSONB')
    expect(migration).toContain('record_plan_event_outcome_requires_measured_result_or_notes')
    expect(migration).toContain('record_plan_event_outcome_notes_must_be_string')
    expect(migration).toContain("jsonb_typeof(outcome_summary -> 'notes') = 'string'")
    expect(migration).toContain('record_plan_event_outcome_revenue_cents_must_be_nonnegative_integer')
    expect(migration).not.toMatch(/p_(is_)?completed\s+BOOLEAN/i)
  })

  it('connects templates and future legacy materializations without changing purchase safety', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS source_event_id UUID')
    expect(migration).toContain('REFERENCES public.events(id) ON DELETE SET NULL')
    expect(migration).toContain('CREATE CONSTRAINT TRIGGER enforce_template_source_event_provenance_trigger')
    expect(migration).toContain('template_source_plan_and_event_must_be_paired')
    expect(migration).toContain('template_source_event_must_be_owned_completed_canonical_event')
    expect(migration).toContain("plan_row.status::TEXT = 'completed'")
    expect(migration).toContain('CREATE TRIGGER link_builder_materialization_identity_trigger')
    expect(migration).toContain("v_plan_status = 'ready'")
    expect(migration).toContain('FROM public.builder_event_materializations AS materialization')
    expect(migration).toContain("materialization.status = 'materialized'")
    expect(migration).toContain("v_time_zone CONSTANT TEXT := 'America/Los_Angeles'")
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.annotate_plan_quote_event_lineage')
    expect(migration).toContain("jsonb_build_object('canonical_event_id', p_event_id)")
    expect(migration).not.toMatch(/payment_intents|stripe|webhook/i)

    expect(documentation).toContain('`plans.materialized_event_id` is the authoritative canonical event id')
    expect(documentation).toContain('approved agent action, executable approval')
    expect(documentation).toMatch(/Quote commitments are\s+planning-only and may precede materialization/)
    expect(documentation).toMatch(/they do not materialize a plan on\s+demand/)
    expect(documentation).toContain("Prompt 15's Option-B billing interface is also unchanged")
    expect(documentation).toMatch(/planner event\s+imports and Eventbrite\/history synchronization/)
    expect(documentation).toMatch(/legacy venue-booking\s+route until Prompt 10/)
  })

  it('freezes canonical plan facts for browser and direct service updates', () => {
    expect(migration).toContain('CREATE TRIGGER protect_canonical_plan_fields_trigger')
    expect(migration).toContain('canonical_plan_event_pointer_requires_service_role')
    expect(migration).toContain('canonical_plan_event_pointer_is_immutable')
    expect(migration).toContain('canonical_plan_inputs_require_dedicated_revision_command')
    expect(migration).toContain("current_setting('app.canonical_plan_revision_plan_id', true)")
    expect(migration).toContain('NEW.guest_count IS DISTINCT FROM OLD.guest_count')
    expect(migration).toContain('NEW.budget_cap_cents IS DISTINCT FROM OLD.budget_cap_cents')
    expect(migration).toContain('NEW.date_window_start IS DISTINCT FROM OLD.date_window_start')
    expect(migration).toContain("OLD.status::TEXT IN (\n        'approved', 'executing', 'booked', 'completed', 'complete', 'archived'")
    expect(migration).toContain("NEW.metadata #> '{event_archetype_lock}'")
    expect(migration).toContain('NEW.committed_venue_quoted_price_cents')
    expect(migration).toContain('NEW.committed_vendors IS DISTINCT FROM OLD.committed_vendors')
    expect(migration).toContain("NEW.metadata -> 'accepted_quote_state'")
    expect(migration).toContain("current_setting('app.canonical_plan_lineage_plan_id', true)")
    expect(migration).toContain('NEW.event_name IS DISTINCT FROM OLD.event_name')
    expect(migration).toContain('NEW.expected_attendance IS DISTINCT FROM OLD.expected_attendance')
    expect(migration).toContain('NEW.budget IS DISTINCT FROM OLD.budget')
    expect(migration).toContain('NEW.venue_id IS DISTINCT FROM OLD.venue_id')
    expect(migration).toContain('canonical_event_fields_require_dedicated_command')
    expect(migration).toContain('plan_creation_cannot_skip_lifecycle_transitions')
  })

  it('requires booking evidence to belong to the plan owner', () => {
    const bookingEvidence = migration.match(
      /IF p_trigger = 'booking_created'[\s\S]+?plan_confirmed_booking_evidence_missing/,
    )?.[0] ?? ''

    expect(bookingEvidence.match(/booking\.organizer_id = v_plan\.user_id/g)).toHaveLength(2)
  })
})
