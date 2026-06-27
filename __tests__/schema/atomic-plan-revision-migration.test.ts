import fs from 'node:fs'
import path from 'node:path'

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260626002000_add_atomic_plan_revision_and_derived_state.sql'
)

describe('atomic plan revision and derived-state migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8')

  it('adds brief render version fields and the derived-state cache table with RLS', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS brief_render_version INTEGER NOT NULL DEFAULT 0')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS derived_state_recomputed_at TIMESTAMPTZ')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.plan_derived_state')
    expect(sql).toContain('ALTER TABLE public.plan_derived_state ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('Users can view own plan derived state')
    expect(sql).toContain('Service role can manage plan derived state')
  })

  it('creates one atomic RPC with ownership and row-lock protection', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.apply_plan_revision_atomic')
    expect(sql).toContain("auth.uid() IS DISTINCT FROM p_user_id")
    expect(sql).toContain('FOR UPDATE')
    expect(sql).toContain('WHERE id = p_plan_id')
    expect(sql).toContain('AND user_id = p_user_id')
  })

  it('keeps plan update, revision insert, supersession, outreach stale mark, and audit insert inside the RPC', () => {
    expect(sql).toContain('UPDATE public.plans')
    expect(sql).toContain('INSERT INTO public.plan_revisions')
    expect(sql).toContain('UPDATE public.recommendations')
    expect(sql).toContain('UPDATE public.approvals')
    expect(sql).toContain('UPDATE public.outreach_threads')
    expect(sql).toContain('INSERT INTO public.audit_logs')
  })
})
