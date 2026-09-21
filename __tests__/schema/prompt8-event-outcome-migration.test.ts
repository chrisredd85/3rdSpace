import fs from 'node:fs'
import path from 'node:path'

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260709163000_complete_canonical_event_outcome_command.sql'),
  'utf8'
)

describe('Prompt 8 canonical event outcome command migration', () => {
  it('delegates lifecycle validation to the guarded Prompt 7 command', () => {
    expect(migration).toContain('public.record_plan_event_outcome(')
    expect(migration).not.toContain("SET status = 'completed'")
  })

  it('writes one host-visible completion message in the same command', () => {
    expect(migration).toContain("metadata ->> 'kind' = 'canonical_event_outcome_recorded'")
    expect(migration).toContain("'template_eligible', true")
    expect(migration).toContain('INSERT INTO public.plan_messages')
  })

  it('keeps the command service-only', () => {
    expect(migration).toContain('record_plan_event_outcome_command_unauthorized')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.record_plan_event_outcome_command')
    expect(migration).toContain('TO service_role;')
  })
})
