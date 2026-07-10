import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260709170000_require_canonical_quote_booking_reapproval.sql'),
  'utf8',
)
const generatedTypes = readFileSync(
  join(process.cwd(), 'lib/types/database-generated.ts'),
  'utf8',
)

describe('canonical quote reapproval command migration', () => {
  it('defines the agreed service-only RPC contract', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.require_canonical_quote_booking_reapproval(',
    )
    for (const argument of [
      'p_plan_id UUID',
      'p_agent_action_id UUID',
      'p_approval_id UUID',
      'p_actor_id UUID',
      'p_expected_snapshot_hash TEXT',
      'p_reason TEXT',
    ]) {
      expect(migration).toContain(argument)
    }
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.require_canonical_quote_booking_reapproval\([\s\S]+?FROM PUBLIC, anon, authenticated/,
    )
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.require_canonical_quote_booking_reapproval\([\s\S]+?TO service_role/,
    )
  })

  it('locks and verifies the exact actor, plan, action, approval, and snapshot', () => {
    const body = functionBody()

    expect(body).toMatch(/FROM public\.plans[\s\S]+FOR UPDATE/)
    expect(body).toMatch(/FROM public\.agent_actions[\s\S]+FOR UPDATE/)
    expect(body).toMatch(/FROM public\.approvals[\s\S]+FOR UPDATE/)
    expect(body).toContain('v_plan.user_id IS DISTINCT FROM p_actor_id')
    expect(body).toContain('v_action.approval_id IS DISTINCT FROM p_approval_id')
    expect(body).toContain("v_action.action_type IS DISTINCT FROM 'concierge_queue'")
    expect(body).toContain("v_action.payload_json ->> 'kind' IS DISTINCT FROM 'canonical_quote_booking'")
    expect(body).toContain("v_action.status NOT IN ('approved', 'executing')")
    expect(body).toContain('v_approval.snapshot_hash IS DISTINCT FROM p_expected_snapshot_hash')
    expect(body).toContain('v_approval.authorized_by IS DISTINCT FROM p_actor_id')
  })

  it('fails closed on every named durable side-effect identity', () => {
    const body = functionBody()

    for (const table of [
      'venue_bookings',
      'vendor_bookings',
      'admin_tasks',
      'outreach_messages',
      'outreach_threads',
      'payment_intents',
      'vendor_transactions',
      'venue_payment_transactions',
      'platform_fee_transactions',
      'settlement_charges',
    ]) {
      expect(body).toContain(`public.${table}`)
    }
    expect(body).toContain("v_action.last_retry_status = 'in_progress'")
    expect(body).toContain("v_action.result_metadata ->> 'outbound_message_sent' = 'true'")
    expect(body).toContain('require_canonical_quote_booking_reapproval_started_work_evidence')
  })

  it('proves expiry or snapshot staleness before reopening the action', () => {
    const body = functionBody()

    expect(body).toContain("p_reason NOT IN ('approval_expired', 'approval_stale')")
    expect(body).toContain("v_approval.status = 'expired'")
    expect(body).toContain('v_approval.expires_at <= v_now')
    expect(body).toContain("v_approval.snapshot_json -> 'plan' IS DISTINCT FROM jsonb_build_object")
    expect(body).toContain("v_approval.snapshot_json #> '{action,payload_json}' IS DISTINCT FROM v_action.payload_json")
    expect(body).toContain('require_canonical_quote_booking_reapproval_reason_not_proven')
  })

  it('refuses changed canonical quote money and trusted quote terms', () => {
    const body = functionBody()

    expect(body).toContain('v_approval.requested_amount_cents IS DISTINCT FROM v_approval.price_cents')
    expect(body).toContain('v_approval.requested_amount_cents IS DISTINCT FROM v_action.amount_cents')
    expect(body).toContain("(v_action.payload_json ->> 'requested_amount_cents')::INTEGER")
    expect(body).toContain("(v_action.payload_json ->> 'price_cents')::INTEGER")
    expect(body).toContain("v_approval.snapshot_json #> '{action,payload_json,quote_terms}'")
    expect(body).toContain('require_canonical_quote_booking_reapproval_fresh_trusted_quote_required')
  })

  it('preserves authorization evidence and only reopens the canonical action for versioning', () => {
    const body = functionBody()
    const approvalUpdate = body.match(/UPDATE public\.approvals[\s\S]+?RETURNING approval_row\.\* INTO v_approval;/)?.[0] ?? ''
    const actionUpdate = body.match(/UPDATE public\.agent_actions[\s\S]+?RETURNING action_row\.\* INTO v_action;/)?.[0] ?? ''

    expect(approvalUpdate).toContain("SET status = 're_approval_required'")
    expect(approvalUpdate).not.toMatch(/authorized_by\s*=|authorized_at\s*=|authorized_amount_cents\s*=/)
    expect(actionUpdate).toContain("SET status = 'approved'")
    expect(actionUpdate).toContain("'canonical_booking_status', 'reapproval_required'")
    expect(body).toContain("'canonical_quote_booking.reapproval_required'")
    expect(body).toContain("'canonical_quote_booking_reapproval_required'")
  })

  it('makes exact replay observable without duplicate evidence', () => {
    const body = functionBody()

    expect(body).toContain("v_marker := v_action.result_metadata -> 'canonical_quote_reapproval'")
    expect(body).toContain("'existing', true")
    expect(body).toContain('require_canonical_quote_booking_reapproval_idempotency_conflict')
    expect(body).toContain("'disposition', 'reapproval_required'")
  })

  it('records the RPC in generated database types', () => {
    expect(generatedTypes).toMatch(
      /require_canonical_quote_booking_reapproval:\s*\{[\s\S]+p_agent_action_id: string[\s\S]+p_expected_snapshot_hash: string[\s\S]+p_reason: string[\s\S]+Returns: Json/,
    )
  })
})

function functionBody() {
  return migration.match(
    /CREATE OR REPLACE FUNCTION public\.require_canonical_quote_booking_reapproval\([\s\S]+?\$function\$;/,
  )?.[0] ?? ''
}
