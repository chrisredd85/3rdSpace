import fs from 'node:fs'
import path from 'node:path'

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260709169000_allow_waiting_quote_reapproval.sql',
)

describe('waiting canonical quote re-approval migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8')

  it('keeps generic executing actions immutable while identifying one narrow quote reset', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.supersede_approval_version')
    expect(sql).toContain("v_action.status IN ('approved', 'executing')")
    expect(sql).toContain("v_previous.status = 're_approval_required'")
    expect(sql).toContain("v_action.payload_json ->> 'kind' = 'canonical_quote_booking'")
    expect(sql).toContain("v_action.payload_json ->> 'requires_event_materialization' = 'true'")
    expect(sql).toContain("AND NOT v_can_reset_waiting_quote")
    expect(sql).toContain("RAISE EXCEPTION 'approval_version_action_not_editable'")
  })

  it('discovers immutable identity without a lock, then locks plan, action, and approval in canonical order', () => {
    const identityRead = sql.indexOf('SELECT approval_row.plan_id, approval_row.agent_action_id')
    const identityValidation = sql.indexOf('IF NOT FOUND', identityRead)
    const planLock = sql.indexOf('SELECT plan_row.*', identityValidation)
    const actionLock = sql.indexOf('SELECT action_row.*', planLock)
    const approvalLock = sql.indexOf('SELECT approval_row.*', actionLock)
    const contractValidation = sql.indexOf("IF v_action.payload_json ->> 'kind'", approvalLock)

    expect(identityRead).toBeGreaterThan(-1)
    expect(sql.slice(identityRead, identityValidation)).not.toContain('FOR UPDATE')
    expect(planLock).toBeGreaterThan(identityValidation)
    expect(actionLock).toBeGreaterThan(planLock)
    expect(approvalLock).toBeGreaterThan(actionLock)
    expect(contractValidation).toBeGreaterThan(approvalLock)
    expect(sql.slice(planLock, actionLock)).toContain('FOR UPDATE')
    expect(sql.slice(actionLock, approvalLock)).toContain('FOR UPDATE')
    expect(sql.slice(approvalLock, contractValidation)).toContain('FOR UPDATE')
    expect(sql.slice(planLock, actionLock)).toContain('v_plan.user_id IS DISTINCT FROM p_actor_id')
    expect(sql.slice(planLock, actionLock)).toContain("approval_version_actor_mismatch' USING ERRCODE = '42501'")
    expect(sql).toContain('action_row.id = v_identity_action_id')
    expect(sql).toContain('action_row.plan_id = p_plan_id')
    expect(sql).toContain('approval_row.agent_action_id = v_action.id')
    expect(sql).toContain('v_previous.plan_id IS DISTINCT FROM v_identity_plan_id')
    expect(sql).toContain('v_previous.agent_action_id IS DISTINCT FROM v_identity_action_id')
  })

  it('matches the command-side booking, concierge, outbound, retry, and financial evidence gates', () => {
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
      expect(sql).toContain(`public.${table}`)
    }
    expect(sql).toContain("v_action.last_retry_status IS DISTINCT FROM 'in_progress'")
    expect(sql).toContain("NOT COALESCE(v_action.result_metadata ? 'handoff_status', false)")
    expect(sql).toContain("outbound_message_sent' IS DISTINCT FROM 'true'")
    expect(sql).toContain('IF v_is_canonical_reapproval AND NOT v_can_reset_waiting_quote THEN')
    expect(sql).toContain('approval_version_canonical_quote_side_effect_exists')
  })

  it('resets only the proven side-effect-free waiting quote and records the reset', () => {
    expect(sql).toContain("WHEN status = 'approved' OR v_can_reset_waiting_quote THEN 'pending'")
    expect(sql).toContain("'canonical_booking_status', 'reapproval_pending'")
    expect(sql).toContain("'reset_waiting_canonical_quote', v_can_reset_waiting_quote")
    expect(sql).toContain('superseded_by_approval_id = v_next.id')
  })

  it('keeps approval, action, payload, and snapshot cents equal and refuses canonical repricing', () => {
    expect(sql).toContain("(p_snapshot_json #>> '{approval,price_cents}')::INTEGER")
    expect(sql).toContain("(p_snapshot_json #>> '{action,amount_cents}')::INTEGER")
    expect(sql).toContain("(p_action_payload_json ->> 'price_cents')::INTEGER")
    expect(sql).toContain("(p_action_payload_json ->> 'requested_amount_cents')::INTEGER")
    expect(sql).toContain('p_requested_amount_cents, v_previous.fees_cents')
    expect(sql).toContain('canonical_quote_booking_amount_change_requires_fresh_quote')
    expect(sql).toContain("p_action_payload_json -> 'quote_terms'")
  })

  it('remains service-role only', () => {
    expect(sql).toContain('FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('TO service_role;')
  })
})
