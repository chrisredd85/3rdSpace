import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260709177000_harden_terminal_plan_execution_boundary.sql'),
  'utf8',
)

describe('terminal plan positive execution boundary migration', () => {
  it('blocks every generic action insert and positive action advancement on completed or archived plans', () => {
    const body = functionBody('enforce_agent_action_plan_execution_boundary')

    expect(body).toContain("v_positive_mutation BOOLEAN := TG_OP = 'INSERT'")
    expect(body).toContain('NEW.action_type IS DISTINCT FROM OLD.action_type')
    expect(body).toContain('NEW.payload_json IS DISTINCT FROM OLD.payload_json')
    expect(body).toContain('NEW.approval_id IS DISTINCT FROM OLD.approval_id')
    expect(body).toContain("NEW.status IN ('cancelled', 'failed')")
    expect(body).toContain("OLD.status IN ('pending', 'proposed', 'approved', 'executing')")
    expect(body).toContain('NOT v_negative_terminal_transition')
    expect(body).toContain('NEW.result_metadata IS DISTINCT FROM OLD.result_metadata')
    expect(body).toContain('FOR SHARE NOWAIT')
    expect(body).toContain("v_plan_status IN ('complete', 'completed', 'archived')")
    expect(body).toContain('agent_action_terminal_plan_positive_execution_forbidden')
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON public.agent_actions')
  })

  it('blocks fresh pending approvals, reapprovals, and executable authorization while preserving negative statuses', () => {
    const body = functionBody('enforce_approval_execution_invariants')

    expect(body).toContain("NEW.status IN ('pending', 'approved', 'authorized', 're_approval_required')")
    expect(body).toContain("v_positive_mutation := TG_OP = 'INSERT'")
    expect(body).toContain('NEW.authorized_by IS DISTINCT FROM OLD.authorized_by')
    expect(body).toContain('NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash')
    expect(body).toContain('FOR SHARE NOWAIT')
    expect(body).toContain("v_plan_status IN ('complete', 'completed', 'archived')")
    expect(body).toContain('approval_terminal_plan_positive_execution_forbidden')
    expect(body).toContain("IF NEW.status IN ('approved', 'authorized') THEN")
    expect(body).not.toMatch(/NEW\.status IN \([^)]*cancelled[^)]*\)/)
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON public.approvals')
  })

  it('keeps both trigger helpers unavailable to browser roles', () => {
    for (const helper of [
      'enforce_agent_action_plan_execution_boundary',
      'enforce_approval_execution_invariants',
    ]) {
      expect(migration).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${helper}\\(\\)[\\s\\S]+?FROM PUBLIC, anon, authenticated`),
      )
      expect(migration).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${helper}\\(\\)[\\s\\S]+?TO service_role`),
      )
    }
  })
})

function functionBody(name: string) {
  return migration.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)[\\s\\S]+?\\$function\\$;`),
  )?.[0] ?? ''
}
