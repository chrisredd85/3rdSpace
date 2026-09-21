import { readFileSync } from 'fs'
import path from 'path'

describe('atomic vendor base-rate repair migration', () => {
  const migration = readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260709114000_atomic_vendor_base_rate_repair.sql'),
    'utf8'
  )

  it('keeps the update and audit insert inside one SECURITY INVOKER function', () => {
    expect(migration).toContain('SECURITY INVOKER')
    expect(migration).not.toContain('SECURITY DEFINER')
    expect(migration).toContain('FROM public.vendor_profiles AS vendor')
    expect(migration).toContain('FOR UPDATE')
    expect(migration).toContain('UPDATE public.vendor_profiles')
    expect(migration).toContain('INSERT INTO public.admin_audit_log')
    expect(migration).toContain("'reason', 'legacy_vendor_base_rate_dollars_to_cents'")
    const auditColumns = migration.match(
      /INSERT INTO public\.admin_audit_log \(([\s\S]*?)\)\s*VALUES/
    )?.[1]
    expect(auditColumns).not.toMatch(/\breason\b/)
  })

  it('exposes the function only to service_role', () => {
    expect(migration).toContain('FROM PUBLIC')
    expect(migration).toContain('FROM anon')
    expect(migration).toContain('FROM authenticated')
    expect(migration).toContain('TO service_role')
  })
})
