import fs from 'fs'
import path from 'path'

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260624015000_add_settlement_audit_log.sql',
)

describe('settlement audit log migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8')

  it('creates append-only settlement audit table for runs and charges', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.settlement_audit_log')
    expect(sql).toContain("entity_type IN ('settlement_run', 'settlement_charge')")
    expect(sql).toContain('before_state JSONB')
    expect(sql).toContain('after_state JSONB')
    expect(sql).toContain('actor_id UUID REFERENCES auth.users(id)')
    expect(sql).toContain('actor_type VARCHAR(32)')
  })

  it('enables service-role-only access for settlement audit rows', () => {
    expect(sql).toContain('ALTER TABLE public.settlement_audit_log ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('Service role can manage settlement audit log')
    expect(sql).toContain('GRANT ALL ON TABLE public.settlement_audit_log TO service_role')
    expect(sql).not.toContain('GRANT SELECT ON TABLE public.settlement_audit_log TO authenticated')
  })

  it('adds admin resolution reason attribution without recreating admin audit log', () => {
    expect(sql).toContain('ALTER TABLE public.admin_audit_log')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS reason TEXT')
    expect(sql).not.toContain('CREATE TABLE IF NOT EXISTS public.admin_audit_log')
  })

  it('adds atomic transition RPCs for run and charge status changes', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.transition_settlement_run_status')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.transition_settlement_charge_status')
    expect(sql).toContain('FOR UPDATE')
    expect(sql).toContain('INSERT INTO public.settlement_audit_log')
    expect(sql).toContain("RETURN QUERY SELECT false, 'concurrent_update'")
  })
})
