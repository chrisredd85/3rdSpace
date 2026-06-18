import fs from 'fs'
import path from 'path'

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260618024000_add_settlement_runs.sql',
)

describe('settlement runs migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8')

  it('creates additive settlement tables with one run per event', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.settlement_runs')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.settlement_attendance_evidence')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS settlement_runs_one_per_event')
    expect(sql).toContain('ON public.settlement_runs (event_id)')
  })

  it('enforces the epsilon.2 status and source state space', () => {
    expect(sql).toContain("'awaiting_attendance'")
    expect(sql).toContain("'awaiting_organizer_review'")
    expect(sql).toContain("'awaiting_venue_ack'")
    expect(sql).toContain("'eventbrite_api'")
    expect(sql).toContain("'webhook_posh'")
    expect(sql).toContain("'organizer_manual'")
  })

  it('enables organizer RLS and service-role management', () => {
    expect(sql).toContain('ALTER TABLE public.settlement_runs ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('auth.uid() = organizer_id')
    expect(sql).toContain('Service role manages settlement runs')
    expect(sql).toContain('Service role manages evidence')
  })

  it('does not add eligibility columns to events or move money', () => {
    expect(sql).not.toMatch(/ALTER TABLE public\.events[\s\S]*chi_eligible/i)
    expect(sql).not.toMatch(/stripe/i)
    expect(sql).not.toMatch(/ledger/i)
  })
})
