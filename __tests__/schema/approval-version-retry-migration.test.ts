import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260709140000_add_approval_version_retry_contract.sql'),
  'utf8',
)

describe('approval version and retry migration', () => {
  it('creates immutable new-row approval lineage after the server-owned control plane', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS root_approval_id UUID')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL DEFAULT 1')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS supersedes_approval_id UUID')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS superseded_by_approval_id UUID')
    expect(migration).toContain('CREATE UNIQUE INDEX approvals_root_version_unique')
    expect(migration).toContain('CREATE UNIQUE INDEX approvals_single_direct_successor')
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED')
    expect(migration).toContain('approval_successor_requires_v2_snapshot')
  })

  it('supersedes before inserting, repoints the action, and refreshes the message cache atomically', () => {
    const supersede = migration.indexOf("SET status = 'superseded'")
    const insert = migration.indexOf('INSERT INTO public.approvals (')
    const repointAction = migration.indexOf('SET approval_id = v_next.id')
    const repointMessage = migration.indexOf('UPDATE public.plan_messages message')

    expect(supersede).toBeGreaterThan(-1)
    expect(insert).toBeGreaterThan(supersede)
    expect(repointAction).toBeGreaterThan(insert)
    expect(repointMessage).toBeGreaterThan(repointAction)
    expect(migration).toContain("v_previous.snapshot_hash IS NULL AND p_expected_snapshot_hash = 'legacy-missing'")
    expect(migration).toContain("v_previous.status NOT IN ('pending', 'expired', 're_approval_required')")
  })

  it('keeps approval and retry mutation functions service-only', () => {
    for (const functionName of [
      'supersede_approval_version',
      'claim_failed_action_retry',
      'finalize_failed_action_retry',
    ]) {
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${functionName}`))
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${functionName}[\\s\\S]+TO service_role`))
    }
  })

  it('adds narrow current retry state without preempting execution-attempt history', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS last_retry_idempotency_key TEXT')
    expect(migration).toContain("last_retry_status IN ('in_progress', 'succeeded', 'failed')")
    expect(migration).toContain("SET status = 'executing'")
    expect(migration).toContain("v_action_status := CASE WHEN p_outcome = 'succeeded' THEN 'complete' ELSE 'failed' END")
    expect(migration).not.toMatch(/CREATE TABLE[^;]+execution_attempt/i)
  })

  it('adds per-recipient dispatch identity and ambiguous-send recovery indexes', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS dispatch_idempotency_key TEXT')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS rfc_message_id TEXT')
    expect(migration).toContain("delivery_status IN ('pending', 'sending', 'sent', 'failed', 'ambiguous')")
    expect(migration).toContain('CREATE UNIQUE INDEX outreach_messages_action_dispatch_unique')
    expect(migration).toContain('CREATE UNIQUE INDEX outreach_messages_rfc_message_id_unique')
    expect(migration).toContain('CREATE INDEX outreach_messages_delivery_recovery')
  })
})
