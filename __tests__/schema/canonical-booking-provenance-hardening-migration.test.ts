import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260709166000_harden_canonical_booking_provenance.sql'),
  'utf8',
)

describe('canonical booking provenance hardening migration', () => {
  it('requires the complete plan-event-action-approval-booking identity chain', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.canonical_booking_has_execution_provenance')
    expect(migration).toContain("action_row.payload_json ->> 'kind' = 'canonical_quote_booking'")
    expect(migration).toContain("action_row.target_id::TEXT = action_row.payload_json ->> 'target_id'")
    expect(migration).toContain("action_row.target_type = action_row.payload_json ->> 'target_type'")
    expect(migration).toContain("approval_row.snapshot_json #> '{action,payload_json}' = action_row.payload_json")
    expect(migration).toContain("action_row.currency = 'usd'")
    expect(migration).toContain('approval_row.provider = action_row.provider')
    expect(migration).toContain("approval_row.snapshot_json #>> '{approval,provider}' = action_row.provider")
    expect(migration).toContain("approval_row.snapshot_json #>> '{action,target_type}' = action_row.target_type")
    expect(migration).toContain("approval_row.snapshot_json #>> '{action,target_id}' = action_row.target_id::TEXT")
    expect(migration).toContain("approval_row.snapshot_json #>> '{counterparty,target_type}' = action_row.target_type")
    expect(migration).toContain("approval_row.snapshot_json #>> '{counterparty,target_id}' = action_row.target_id::TEXT")
    expect(migration).toContain('p_partner_id UUID')
    expect(migration).toContain("discovery_venue.id::TEXT = action_row.payload_json ->> 'target_id'")
    expect(migration).toContain('discovery_venue.claimed_venue_id = p_partner_id')
    expect(migration).toContain("vendor_profile.discovery_vendor_id::TEXT = action_row.payload_json ->> 'target_id'")
    expect(migration).toContain('vendor_profile.id = p_partner_id')
    expect(migration).toContain('approval_row.agent_action_id = action_row.id')
    expect(migration).toContain('approval_row.plan_id = plan_row.id')
    expect(migration).toContain('approval_row.authorized_by = plan_row.user_id')
    expect(migration).toContain('approval_row.authorized_at IS NOT NULL')
    expect(migration).toContain('approval_row.snapshot_json = p_approved_terms_snapshot')
    expect(migration).toContain('approval_row.authorized_amount_cents = p_quoted_price_cents')
    expect(migration).toContain('canonical_booking_requires_exact_executable_provenance')
    expect(migration).toContain('canonical_booking_start_requires_unexpired_approval')
    expect(migration).toContain("action_row.status IN ('executing', 'complete')")
    expect(migration).toMatch(
      /p_booking_status = 'declined'\s+AND action_row\.status = 'cancelled'/,
    )
    expect(migration).toContain("plan_row.status::TEXT IN ('executing', 'booked', 'completed', 'archived')")
    expect(migration).toContain("plan_row.status::TEXT IN ('executing', 'booked')")
    expect(migration).toMatch(
      /p_booking_status = 'confirmed'[\s\S]+?plan_row\.status::TEXT IN \('completed', 'archived'\)[\s\S]+?action_row\.status = 'complete'/,
    )
    expect(migration).toContain('plan_booking_transition_requires_execution_provenance')
  })

  it('enforces provenance on both booking tables and keeps only the named ready-plan bridge', () => {
    expect(migration).toContain('CREATE TRIGGER enforce_venue_booking_execution_provenance_trigger')
    expect(migration).toContain('CREATE TRIGGER enforce_vendor_booking_execution_provenance_trigger')
    expect(migration).toMatch(/enforce_venue_booking_execution_provenance_trigger[\s\S]+?UPDATE OF\s+venue_id,/)
    expect(migration).toMatch(/enforce_vendor_booking_execution_provenance_trigger[\s\S]+?UPDATE OF\s+vendor_id,/)
    expect(migration).toContain("'venue', booking.venue_id, booking.event_id")
    expect(migration).toContain("'vendor', booking.vendor_id, booking.event_id")
    expect(migration).toContain("v_plan_status = 'ready' AND v_is_ready_legacy_bridge")
    expect(migration).toContain('FROM public.builder_event_materializations AS materialization')
    expect(migration).toContain("materialization.status = 'materialized'")
    expect(migration).toContain('ready_legacy_booking_must_not_claim_canonical_provenance')
    expect(migration).toContain('ready_legacy_booking_organizer_does_not_match_plan_owner')
    expect(migration).toContain('ready_legacy_booking_identity_is_immutable')
    expect(migration).toContain('NEW.organizer_id IS DISTINCT FROM v_plan_user_id')
    expect(migration).toMatch(
      /IF v_plan_status = 'ready' AND v_is_ready_legacy_bridge THEN[\s\S]+?IF TG_OP = 'UPDATE' AND \([\s\S]+?NEW\.event_id IS DISTINCT FROM OLD\.event_id[\s\S]+?NEW\.organizer_id IS DISTINCT FROM OLD\.organizer_id[\s\S]+?TG_TABLE_NAME = 'venue_bookings'[\s\S]+?venue_id[\s\S]+?TG_TABLE_NAME = 'vendor_bookings'[\s\S]+?vendor_id[\s\S]+?ready_legacy_booking_identity_is_immutable/,
    )
    expect(migration).toContain('canonical_booking_provenance_identity_is_immutable')
    expect(migration).toContain("TG_OP = 'UPDATE' AND OLD.plan_id IS NOT NULL")
    expect(migration).toContain('NEW.event_id IS DISTINCT FROM OLD.event_id')
    expect(migration).toContain('NEW.approved_terms_snapshot IS DISTINCT FROM OLD.approved_terms_snapshot')
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.enforce_canonical_booking_execution_provenance\(\)[\s\S]+?SECURITY DEFINER/,
    )
    expect(migration).toContain('canonical_booking_mutation_requires_service_command')
    expect(migration).toContain("NULLIF(auth.role()::TEXT, '')")
  })

  it('keeps authenticated booking DML legacy-only and makes confirmed-plan advancement RLS independent', () => {
    const organizerVenuePolicy = migration.match(
      /CREATE POLICY "Organizers can create venue booking requests"[\s\S]+?;\n/,
    )?.[0] ?? ''
    const organizerVendorPolicy = migration.match(
      /CREATE POLICY "Organizers can create vendor booking requests"[\s\S]+?;\n/,
    )?.[0] ?? ''
    const vendorUpdatePolicy = migration.match(
      /CREATE POLICY "Vendors can update own vendor bookings"[\s\S]+?;\n/,
    )?.[0] ?? ''
    const venueUpdatePolicy = migration.match(
      /CREATE POLICY "Venue owners can update own venue bookings"[\s\S]+?;\n/,
    )?.[0] ?? ''

    for (const policy of [organizerVenuePolicy, organizerVendorPolicy, venueUpdatePolicy, vendorUpdatePolicy]) {
      expect(policy).toContain('plan_id IS NULL')
      expect(policy).toContain('agent_action_id IS NULL')
      expect(policy).toContain('approval_id IS NULL')
      expect(policy).toContain('quoted_price_cents IS NULL')
      expect(policy).toContain('approved_terms_snapshot IS NULL')
    }
    expect(venueUpdatePolicy).toContain('venue.owner_id = auth.uid()')
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.advance_plan_after_confirmed_booking\(\)[\s\S]+?SECURITY DEFINER/,
    )
    expect(migration).toContain('canonical_booking_confirmation_requires_service_role')
    expect(migration).toContain('materialization.plan_id = v_plan_id')
  })

  it('freezes canonical booking schedules, headcount, prices, packages, deposits, and terms', () => {
    expect(migration).toContain('canonical_booking_material_terms_do_not_match_approval')
    expect(migration).toContain('canonical_venue_booking_terms_require_reapproval')
    expect(migration).toContain('canonical_vendor_booking_terms_require_reapproval')
    expect(migration).toContain("v_booking_row ->> 'booking_date' IS DISTINCT FROM v_event_date::TEXT")
    expect(migration).toContain("v_booking_row ->> 'guest_count_min' IS DISTINCT FROM v_event_expected_attendance_min::TEXT")
    expect(migration).toContain("v_booking_row ->> 'guest_count' IS DISTINCT FROM v_event_expected_attendance::TEXT")
    expect(migration).toContain("v_booking_row ->> 'vendor_package_id' IS NOT NULL")
    expect(migration).toContain("v_booking_row ->> 'deposit_amount' IS NOT NULL")
    expect(migration).toContain("v_booking_row ->> 'requirements' IS NOT NULL")
    expect(migration).toMatch(/enforce_venue_booking_execution_provenance_trigger[\s\S]+?guest_count_min,[\s\S]+?final_price,[\s\S]+?special_requests/)
    expect(migration).toMatch(/enforce_vendor_booking_execution_provenance_trigger[\s\S]+?requested_date,[\s\S]+?guest_count,[\s\S]+?vendor_package_id,[\s\S]+?deposit_amount/)
    expect(migration).toContain("IF NEW.plan_id IS NOT NULL OR NEW.status <> 'pending' THEN")
  })

  it('makes canonical action material fields immutable except for an exact successor handoff', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.enforce_canonical_agent_action_material_immutability')
    expect(migration).toContain('canonical_agent_action_material_fields_are_immutable')
    expect(migration).toContain("BEFORE UPDATE OF approval_id, action_type, provider, target_type, target_id, amount_cents, currency, payload_json")
    expect(migration).toContain('canonical_agent_action_initial_approval_link_mismatch')
    expect(migration).toContain('NEW.approval_id IS NOT DISTINCT FROM OLD.approval_id')
    expect(migration).toContain("v_previous_approval.status = 'superseded'")
    expect(migration).toContain("v_successor_approval.status = 'pending'")
    expect(migration).toContain('v_successor_approval.supersedes_approval_id = v_previous_approval.id')
    expect(migration).toContain("v_successor_approval.snapshot_json #> '{action,payload_json}' = NEW.payload_json")
    expect(migration).toContain("v_successor_approval.snapshot_json #>> '{action,amount_cents}' = NEW.amount_cents::TEXT")
    expect(migration).toContain("v_successor_approval.snapshot_json #>> '{approval,provider}' = NEW.provider")
    expect(migration).toContain('v_successor_approval.price_cents = NEW.amount_cents')
    expect(migration).toContain('NEW.amount_cents IS NOT DISTINCT FROM OLD.amount_cents')
    expect(migration).toContain('NEW.target_id IS NOT DISTINCT FROM OLD.target_id')
    expect(migration).toContain("(NEW.payload_json ->> 'requested_amount_cents')::INTEGER = NEW.amount_cents")
    expect(migration).toContain("'approval_revision', 'expires_at', 'notes'")
    expect(migration).toContain("OLD.payload_json - ARRAY[")
    expect(migration).toContain("OLD.payload_json ->> 'requires_event_materialization' = 'true'")
    expect(migration).toContain("OLD.last_retry_status IS DISTINCT FROM 'in_progress'")
    expect(migration).toContain("NOT (COALESCE(OLD.result_metadata, '{}'::jsonb) ? 'handoff_status')")
    expect(migration).toContain('OR v_can_reset_waiting_quote')
    expect(migration).toContain('CREATE TRIGGER enforce_canonical_agent_action_material_immutability_trigger')
  })

  it('re-resolves the canonical event when an approved hold completes', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.resolve_admin_task_event_on_hold_completion')
    expect(migration).toContain("action_row.action_type = 'hold_request'")
    expect(migration).toContain('plan_row.materialized_event_id')
    expect(migration).toContain('approval_row.authorized_at IS NOT NULL')
    expect(migration).toContain('NEW.event_id := v_event_id')
    expect(migration).toContain('CREATE TRIGGER resolve_admin_task_event_on_hold_completion_trigger')
  })

  it('keeps all new helpers service-only', () => {
    for (const helper of [
      'canonical_booking_has_execution_provenance',
      'enforce_canonical_agent_action_material_immutability',
      'enforce_canonical_booking_execution_provenance',
      'require_canonical_booking_provenance_for_booked_plan',
      'resolve_admin_task_event_on_hold_completion',
    ]) {
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${helper}\\([\\s\\S]+?FROM PUBLIC, anon, authenticated`))
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${helper}\\([\\s\\S]+?TO service_role`))
    }
  })
})
