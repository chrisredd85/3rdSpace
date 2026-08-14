import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260709167000_confirm_external_checkout_handoff.sql'),
  'utf8'
)

describe('Prompt 8 atomic external checkout confirmation migration', () => {
  it('locks the identity chain and atomically completes action, audit, and host evidence', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.confirm_external_checkout_handoff(')
    expect(migration).toMatch(/FROM public\.plans[\s\S]+FOR UPDATE;/)
    expect(migration).toMatch(/FROM public\.agent_actions[\s\S]+FOR UPDATE;/)
    expect(migration).toContain("v_approval.status NOT IN ('approved', 'authorized')")
    expect(migration).toContain("v_approval.snapshot_hash IS DISTINCT FROM p_expected_snapshot_hash")
    expect(migration).toMatch(/UPDATE public\.agent_actions[\s\S]+SET status = 'complete'/)
    expect(migration).toContain("'external_checkout.host_confirmed'")
    expect(migration).toContain("'external_checkout_completed'")
    expect(migration).toContain("'plan_message', to_jsonb(v_message)")
  })

  it('is service-only and repairs exact completed replays without duplicating evidence', () => {
    expect(migration).toContain("v_action.status = 'complete'")
    expect(migration).toContain("v_evidence ->> 'status' = 'completed'")
    expect(migration).toContain('IF NOT EXISTS (')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.confirm_external_checkout_handoff(')
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.confirm_external_checkout_handoff\([\s\S]+TO service_role;/)
  })
})
