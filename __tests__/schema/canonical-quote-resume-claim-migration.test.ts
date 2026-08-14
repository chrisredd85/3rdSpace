import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260709174000_claim_canonical_quote_booking_resume.sql'),
  'utf8',
)

describe('canonical quote materialization-resume claim migration', () => {
  it('defines a narrow service-only command over the exact identity chain', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.claim_canonical_quote_booking_materialization_resume(',
    )
    for (const argument of [
      'p_plan_id UUID',
      'p_agent_action_id UUID',
      'p_approval_id UUID',
      'p_actor_id UUID',
      'p_expected_snapshot_hash TEXT',
    ]) expect(migration).toContain(argument)
    expect(migration).toContain("current_user = 'service_role' AND auth.role() = 'service_role'")
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.claim_canonical_quote_booking_materialization_resume\([\s\S]+FROM PUBLIC, anon, authenticated/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_canonical_quote_booking_materialization_resume\([\s\S]+TO service_role/)
  })

  it('locks plan, event, action, and approval before the compare-and-swap', () => {
    expect(migration).toMatch(/FROM public\.plans[\s\S]+FOR UPDATE/)
    expect(migration).toMatch(/FROM public\.events[\s\S]+FOR SHARE/)
    expect(migration).toMatch(/FROM public\.agent_actions[\s\S]+FOR UPDATE/)
    expect(migration).toMatch(/FROM public\.approvals[\s\S]+FOR UPDATE/)
    expect(migration).toContain('v_plan.user_id IS DISTINCT FROM p_actor_id')
    expect(migration).toContain('v_approval.snapshot_hash IS DISTINCT FROM p_expected_snapshot_hash')
    expect(migration).toContain("v_action.payload_json ->> 'kind' IS DISTINCT FROM 'canonical_quote_booking'")
    expect(migration).toContain("v_plan.status::TEXT NOT IN ('executing', 'booked')")
    expect(migration).not.toContain("v_plan.status::TEXT NOT IN ('executing', 'booked', 'completed')")
  })

  it('updates action and inserts deterministic audit in the same function transaction', () => {
    const updateAt = migration.indexOf('UPDATE public.agent_actions AS action_row')
    const auditAt = migration.indexOf('INSERT INTO public.agent_action_audit_log')
    expect(updateAt).toBeGreaterThan(-1)
    expect(auditAt).toBeGreaterThan(updateAt)
    expect(migration.slice(updateAt, auditAt)).toContain("AND action_row.status = 'approved'")
    expect(migration).toContain("'canonical_quote_booking.materialization_resume', v_claim_marker")
    expect(migration).toContain("'materialization_resume_claim', v_claim_marker")
  })

  it('accepts only exact replay evidence and never inserts a second audit row', () => {
    expect(migration).toContain("IF v_action.status IN ('executing', 'complete', 'cancelled', 'failed')")
    expect(migration).toContain("'concurrent_execution', true")
    expect(migration).toContain("IF v_action.status IN ('executing', 'complete', 'cancelled', 'failed') THEN")
    expect(migration).toContain('v_existing_audit_count IS DISTINCT FROM 1')
    expect(migration).toContain('claim_canonical_quote_booking_resume_existing_evidence_mismatch')
    expect(migration).toContain("'existing', true")
  })
})
