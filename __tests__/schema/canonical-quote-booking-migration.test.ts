import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260709162000_add_canonical_quote_booking_execution.sql'),
  'utf8',
)
const identityMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260709150000_add_canonical_plan_event_identity.sql'),
  'utf8',
)

describe('canonical quote booking migration', () => {
  it('adds relational provenance and integer-cent evidence without changing payment execution', () => {
    for (const table of ['venue_bookings', 'vendor_bookings']) {
      expect(migration).toMatch(new RegExp(`ALTER TABLE public\\.${table}[\\s\\S]+ADD COLUMN IF NOT EXISTS plan_id UUID`))
      expect(migration).toMatch(new RegExp(`${table}_event_plan_consistency_fkey[\\s\\S]+REFERENCES public\\.events\\(id, plan_id\\)`))
      expect(migration).toMatch(new RegExp(`${table}_action_plan_consistency_fkey[\\s\\S]+REFERENCES public\\.agent_actions\\(id, plan_id\\)`))
      expect(migration).toMatch(new RegExp(`${table}_approval_action_plan_consistency_fkey[\\s\\S]+REFERENCES public\\.approvals\\(id, agent_action_id, plan_id\\)`))
      expect(migration).toContain(`${table}_one_canonical_row_per_action`)
      expect(migration).toContain(`${table}_one_canonical_row_per_approval`)
    }

    expect(migration).toContain('quoted_price_cents INTEGER')
    expect(migration).toContain('quoted_price_cents >= 0')
    expect(migration).toContain('approved_terms_snapshot IS NOT NULL')
    expect(migration).not.toMatch(/stripe|payment_intent|capture|charge/i)
  })

  it('stages only a plan-owned actionable response with one action, approval, audit, and host message', () => {
    const stage = functionBody('stage_plan_quote_booking')

    expect(stage).toContain('response.plan_id = p_plan_id')
    expect(stage).toContain("v_plan.status::TEXT IN ('executing', 'booked')")
    expect(stage).toContain("set_config('app.canonical_plan_lineage_plan_id'")
    expect(stage).toContain('v_event_date := v_plan.date_window_start')
    expect(stage).toContain('event_row.id = v_plan.materialized_event_id')
    expect(stage).toContain('FOR KEY SHARE OF response')
    expect(stage).toContain('stage_plan_quote_booking_response_not_actionable')
    expect(stage).toContain('stage_plan_quote_booking_price_required')
    expect(stage).toContain("regexp_replace(lower(btrim(COALESCE(v_deal_model, '')))")
    expect(stage).toContain("'community_host_incentive', 'bar_consumption_chi', 'ticket_chi'")
    expect(stage).toContain("'per_head_chi', 'consumption_share'")
    expect(stage).toContain("'bar_consumption_share', 'ticket_consumption_share'")
    for (const unsupportedLegacyAlias of [
      "'revenue_share'",
      "'bar_revenue_share'",
      "'ticket_revenue_share'",
    ]) {
      expect(stage).not.toContain(unsupportedLegacyAlias)
    }
    const priceRequiredError = stage.indexOf(
      "RAISE EXCEPTION 'stage_plan_quote_booking_price_required'",
    )
    expect(priceRequiredError).toBeGreaterThan(-1)
    expect(priceRequiredError).toBeLessThan(stage.indexOf('INSERT INTO public.agent_actions'))
    expect(priceRequiredError).toBeLessThan(stage.indexOf('INSERT INTO public.approvals'))
    expect(stage).toContain("action_row.payload_json ->> 'quote_response_id' = p_response_id::TEXT")
    expect(stage).toContain("action_row.status IN ('pending', 'proposed', 'approved', 'executing')")
    expect(stage).toContain("OR action_row.status IN ('failed', 'complete')")
    expect(stage).toContain("active_action.status IN ('pending', 'proposed', 'approved', 'executing')")
    expect(stage).toContain("OR active_action.status IN ('failed', 'complete')")
    expect(stage).toContain('stage_plan_quote_booking_active_slot_exists')
    expect(stage).toContain("'concierge_queue'")
    expect(stage).toContain("'canonical_quote_booking'")
    expect(stage).toContain("'pending'")
    expect(stage).toContain('snapshot_schema_version')
    expect(stage).toContain("'approval_request'")
    expect(stage).toContain("'outbound_message_sent', false")
  })

  it('cancels quote metadata, action, and approval together before authorization', () => {
    const cancel = functionBody('cancel_staged_plan_quote_booking')

    expect(cancel).toContain("v_action.status NOT IN ('pending', 'proposed')")
    expect(cancel).toContain("v_approval.status <> 'pending'")
    expect(cancel).toContain("v_plan.status::TEXT IN ('executing', 'booked')")
    expect(cancel).toContain("SET status = 'cancelled'")
    expect(cancel).toContain('committed_venue_id = NULL')
    expect(cancel).toContain('committed_vendors = v_next_vendors')
    expect(cancel).toContain("'canonical_quote_booking.cancelled_before_authorization'")
    expect(cancel).toContain("'canonical_quote_booking_cancelled'")
  })

  it('creates or reuses a pending booking only after authorization and exact materialization', () => {
    const create = functionBody('create_canonical_booking_from_approval')

    expect(create).toContain('plan_row.materialized_event_id IS NOT NULL')
    expect(create).toContain('event_row.id = v_plan.materialized_event_id')
    expect(create).toContain("v_approval.status NOT IN ('approved', 'authorized')")
    expect(create).toContain('v_approval.authorized_by IS DISTINCT FROM p_actor_id')
    expect(create).toContain('v_approval.event_date IS DISTINCT FROM v_event.event_date')
    expect(create).toContain('create_canonical_booking_approved_amount_mismatch')
    expect(create).toContain('WHERE booking.agent_action_id = v_action.id')
    expect(create).toContain("'existing', true")
    expect(create).toContain("'requires_concierge', true")
    expect(create).toContain("'pending', v_amount_cents::NUMERIC / 100")
    expect(create.match(/v_approval\.snapshot_json/g)?.length).toBeGreaterThanOrEqual(2)
    expect(create).toContain("'canonical_booking_created'")
    expect(create).toContain('pending partner confirmation')
  })

  it('turns external confirmation into action completion and host-visible booked evidence', () => {
    const confirm = functionBody('confirm_canonical_booking')

    expect(confirm).toContain('venue.owner_id')
    expect(confirm).toContain('vendor.user_id')
    expect(confirm).toContain('confirm_canonical_booking_partner_mismatch')
    expect(confirm.indexOf('FOR UPDATE;')).toBeLessThan(confirm.indexOf('FOR UPDATE;', confirm.indexOf('FOR UPDATE;') + 1))
    expect(confirm.indexOf('FROM public.plans AS plan_row')).toBeLessThan(confirm.indexOf('FROM public.agent_actions AS action_row'))
    expect(confirm.indexOf('FROM public.agent_actions AS action_row')).toBeLessThan(confirm.indexOf('FROM public.approvals AS approval_row'))
    expect(confirm.indexOf('FROM public.approvals AS approval_row')).toBeLessThan(confirm.indexOf('FROM public.venues AS venue'))
    expect(confirm).toContain("v_status = 'confirmed' AND v_action.status = 'complete'")
    expect(confirm).toContain("v_plan_status NOT IN ('executing', 'booked')")
    expect(confirm).toContain('confirm_canonical_booking_plan_not_confirmable')
    expect(confirm.indexOf("v_status = 'confirmed' AND v_action.status = 'complete'")).toBeLessThan(
      confirm.indexOf("v_plan_status NOT IN ('executing', 'booked')"),
    )
    expect(confirm).toContain("v_status <> 'pending'")
    expect(confirm).toContain("SET status = 'confirmed'")
    expect(confirm).toContain("SET status = 'complete'")
    expect(confirm).toContain("'canonical_booking.confirmed'")
    expect(confirm).toContain("'canonical_booking_confirmed'")
    expect(confirm).toContain('The event is now booked')

    expect(identityMigration).toContain('CREATE TRIGGER advance_plan_after_confirmed_venue_booking_trigger')
    expect(identityMigration).toContain('CREATE TRIGGER advance_plan_after_confirmed_vendor_booking_trigger')
    expect(identityMigration).toContain("'executing',\n      'booked',\n      'booking_created'")
  })

  it('cancels a materialized pending booking when its approval is cancelled', () => {
    const cancellationTrigger = functionBody('cancel_pending_canonical_booking_after_approval')

    expect(cancellationTrigger).toContain("NEW.status NOT IN ('cancelled', 'rejected')")
    expect(cancellationTrigger.match(/AND status = 'pending'/g)).toHaveLength(2)
    expect(cancellationTrigger.match(/SET status = 'cancelled'/g)).toHaveLength(2)
    expect(cancellationTrigger).toContain("'canonical_booking_cancelled'")
    expect(cancellationTrigger).toContain("'outbound_message_sent', false")
    expect(migration).toContain('CREATE TRIGGER cancel_pending_canonical_booking_after_approval_trigger')
  })

  it('exposes an idempotent post-authorization cancellation command without mutating approval history', () => {
    const cancel = functionBody('cancel_executing_canonical_quote_booking')

    expect(cancel.indexOf('FROM public.plans AS plan_row')).toBeLessThan(cancel.indexOf('FROM public.agent_actions AS action_row'))
    expect(cancel.indexOf('FROM public.agent_actions AS action_row')).toBeLessThan(cancel.indexOf('FROM public.approvals AS approval_row'))
    expect(cancel.indexOf('FROM public.approvals AS approval_row')).toBeLessThan(cancel.indexOf('FROM public.venue_bookings AS booking'))
    expect(cancel).toContain("v_approval.status NOT IN ('approved', 'authorized')")
    expect(cancel).toContain("v_plan.status::TEXT NOT IN ('approved', 'executing', 'booked', 'completed', 'archived')")
    expect(cancel).toContain("v_action.status = 'cancelled'")
    expect(cancel).toContain("v_booking_status = 'cancelled'")
    expect(cancel).toContain("v_booking_status <> 'pending'")
    expect(cancel).toContain("SET status = 'cancelled'")
    expect(cancel).toContain("'approval_status_preserved', v_approval.status")
    expect(cancel).toContain("'canonical_quote_booking.cancelled_after_authorization'")
    expect(cancel).not.toMatch(/UPDATE public\.approvals|SET status = 'cancelled'[\s\S]+public\.approvals/)
  })

  it('keeps every write RPC service-only', () => {
    for (const signature of [
      'stage_plan_quote_booking',
      'cancel_staged_plan_quote_booking',
      'create_canonical_booking_from_approval',
      'cancel_executing_canonical_quote_booking',
      'confirm_canonical_booking',
    ]) {
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature}[\\s\\S]+?FROM PUBLIC, anon, authenticated`))
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature}[\\s\\S]+?TO service_role`))
    }
  })
})

function functionBody(name: string) {
  return migration.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]+?\\$function\\$;`),
  )?.[0] ?? ''
}
