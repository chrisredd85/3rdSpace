import fs from 'fs'
import path from 'path'

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260624010000_add_projection_baselines.sql'
)

describe('projection baseline migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8')

  it('creates privacy-floored materialized views with concurrent refresh indexes', () => {
    expect(sql).toContain('CREATE MATERIALIZED VIEW public.organizer_baselines')
    expect(sql).toContain('CREATE MATERIALIZED VIEW public.archetype_baselines')
    expect(sql).toContain('HAVING COUNT(*) >= 3')
    expect(sql).toContain('HAVING COUNT(*) >= 5')
    expect(sql).toContain('CREATE UNIQUE INDEX organizer_baselines_identity')
    expect(sql).toContain('CREATE UNIQUE INDEX archetype_baselines_identity')
    expect(sql).toContain('GRANT SELECT ON public.organizer_baselines TO service_role')
    expect(sql).toContain('GRANT SELECT ON public.archetype_baselines TO service_role')
    expect(sql).not.toContain('GRANT SELECT ON public.organizer_baselines TO authenticated')
    expect(sql).not.toContain('GRANT SELECT ON public.archetype_baselines TO authenticated')
  })

  it('adds the refresh RPC used by the cron route', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.refresh_projection_baselines()')
    expect(sql).toContain('REFRESH MATERIALIZED VIEW CONCURRENTLY public.organizer_baselines')
    expect(sql).toContain('REFRESH MATERIALIZED VIEW CONCURRENTLY public.archetype_baselines')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.refresh_projection_baselines() TO service_role')
  })
})
