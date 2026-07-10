import fs from 'fs'
import path from 'path'

const root = process.cwd()
const migrationPath = path.join(
  root,
  'supabase/migrations/20260709171000_decline_canonical_bookings.sql',
)
const provenancePath = path.join(
  root,
  'supabase/migrations/20260709166000_harden_canonical_booking_provenance.sql',
)

const sql = fs.readFileSync(migrationPath, 'utf8')
const provenanceSql = fs.readFileSync(provenancePath, 'utf8')
const generatedTypes = fs.readFileSync(path.join(root, 'lib/types/database-generated.ts'), 'utf8')

describe('canonical booking partner decline migration', () => {
  it('exposes one service-only atomic command with a bounded batch contract', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.decline_canonical_bookings\([\s\S]*p_booking_ids UUID\[\]/)
    expect(sql).toContain('SECURITY INVOKER')
    expect(sql).toContain("current_user = 'service_role' AND auth.role() = 'service_role'")
    expect(sql).toMatch(/v_requested_count < 1[\s\S]*v_requested_count > 100/)
    expect(sql).toContain('decline_canonical_bookings_ids_must_be_unique')
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.decline_canonical_bookings[\s\S]*FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.decline_canonical_bookings[\s\S]*TO service_role/)
  })

  it('locks the complete booking set deterministically before any mutation', () => {
    const firstLoop = sql.indexOf('-- Lock every requested aggregate')
    const firstMutation = sql.indexOf('UPDATE public.agent_actions AS action_row')
    expect(firstLoop).toBeGreaterThan(-1)
    const lockSet = sql.slice(firstLoop, firstMutation)
    expect(lockSet.indexOf('FOR UPDATE OF plan_row')).toBeLessThan(lockSet.indexOf('FOR UPDATE OF action_row'))
    expect(lockSet.indexOf('FOR UPDATE OF action_row')).toBeLessThan(lockSet.indexOf('FOR UPDATE OF approval_row'))
    expect(lockSet).toContain('ORDER BY booking.id')
    expect(lockSet).toContain('FOR UPDATE;')
    expect(firstMutation).toBeGreaterThan(firstLoop)
  })

  it('requires partner ownership and exact canonical execution provenance', () => {
    expect(sql).toContain('venue.owner_id')
    expect(sql).toContain('vendor.user_id')
    expect(sql).toContain('decline_canonical_bookings_partner_mismatch')
    expect(sql).toContain('v_plan.materialized_event_id IS DISTINCT FROM v_event_id')
    expect(sql).toContain("v_action.payload_json ->> 'kind' IS DISTINCT FROM 'canonical_quote_booking'")
    expect(sql).toContain('public.canonical_booking_has_execution_provenance(')
    expect(sql).toMatch(/v_approval\.status NOT IN \('approved', 'authorized'\)/)
  })

  it('makes decline terminal and non-retryable before changing the booking row', () => {
    const actionMutation = sql.indexOf('UPDATE public.agent_actions AS action_row')
    const terminalProvenance = sql.lastIndexOf('IF NOT public.canonical_booking_has_execution_provenance(')
    const venueMutation = sql.indexOf('UPDATE public.venue_bookings AS booking')
    expect(actionMutation).toBeGreaterThan(-1)
    expect(actionMutation).toBeLessThan(venueMutation)
    expect(terminalProvenance).toBeGreaterThan(actionMutation)
    expect(terminalProvenance).toBeLessThan(venueMutation)
    expect(sql.slice(terminalProvenance, venueMutation)).toContain("'declined'")
    expect(sql.slice(actionMutation, venueMutation)).toContain("SET status = 'cancelled'")
    expect(sql).toMatch(/WHERE booking\.id = v_booking_id[\s\S]*AND booking\.status = 'pending'/)
    expect(sql).toContain("SET status = 'declined'")
    expect(sql).not.toMatch(/UPDATE public\.approvals[\s\S]*SET status/)
  })

  it('keeps declined booking provenance command-exclusive at the trigger boundary', () => {
    const terminalBranch = provenanceSql.slice(
      provenanceSql.indexOf("p_booking_status IN ('cancelled', 'rejected', 'declined')"),
      provenanceSql.indexOf("p_booking_status NOT IN ('cancelled', 'rejected', 'declined')"),
    )
    expect(terminalBranch).toContain("p_booking_status = 'declined'")
    expect(terminalBranch).toContain("action_row.status = 'cancelled'")
    expect(terminalBranch).toContain("approval_row.status IN ('approved', 'authorized', 'cancelled', 'rejected')")
    expect(provenanceSql).toMatch(/BEFORE INSERT OR UPDATE OF[\s\S]*status[\s\S]*ON public\.venue_bookings/)
    expect(provenanceSql).toMatch(/BEFORE INSERT OR UPDATE OF[\s\S]*status[\s\S]*ON public\.vendor_bookings/)
  })

  it('records exactly replayable evidence without repeating side effects', () => {
    const replayBranch = sql.indexOf("IF v_booking_status = 'declined' THEN")
    const liveProvenance = sql.lastIndexOf('IF NOT public.canonical_booking_has_execution_provenance(')
    expect(replayBranch).toBeGreaterThan(-1)
    expect(replayBranch).toBeLessThan(liveProvenance)
    expect(sql).toContain("v_marker ->> 'approval_id' IS DISTINCT FROM v_approval_id::TEXT")
    expect(sql).toContain("v_marker ->> 'declined_by' IS DISTINCT FROM p_actor_id::TEXT")
    expect(sql).toContain("v_marker ->> 'reason' IS DISTINCT FROM v_reason")
    expect(sql).toContain("- 'source' - 'route_confirmed'")
    expect(sql).toContain("'canonical_booking.partner_declined'")
    expect(sql).toContain("'kind', 'canonical_booking_declined'")
    expect(sql).toMatch(/IF v_booking_status = 'declined' THEN[\s\S]*CONTINUE;/)
  })

  it('publishes the generated RPC type', () => {
    expect(generatedTypes).toMatch(/decline_canonical_bookings:\s*{[\s\S]*p_booking_ids: string\[\][\s\S]*p_decline_context\?: Json/)
  })
})
