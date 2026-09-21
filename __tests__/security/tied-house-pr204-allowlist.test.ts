import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '..', '..')
const allowlistPath = path.join(
  repoRoot,
  'scripts/security/tied-house-pr204-allowlist.json',
)

describe('PR #204 tied-house reviewed allowlist', () => {
  it('pins every reviewed path, literal, and occurrence count exactly', () => {
    expect(JSON.parse(readFileSync(allowlistPath, 'utf8'))).toEqual([
      {
        path: 'lib/planner/templateIdentity.ts',
        text: 'kickback_model: Json',
        count: 1,
      },
      {
        path: 'lib/planner/templateIdentity.ts',
        text: 'chi_model: row.kickback_model,',
        count: 1,
      },
      {
        path: 'lib/planner/templateIdentity.ts',
        text: 'kickback_model: row.kickback_model,',
        count: 1,
      },
      {
        path: 'lib/planner/templateIdentity.ts',
        text: 'kickback_model: {',
        count: 1,
      },
      {
        path: 'lib/types/database-generated.ts',
        text: 'kickback_agreement_id: string | null',
        count: 1,
      },
      {
        path: 'supabase/migrations/20260709120000_lock_down_function_and_view_privileges.sql',
        text: 'REVOKE ALL ON FUNCTION public.calculate_event_kickback(UUID) FROM PUBLIC, anon, authenticated;',
        count: 1,
      },
      {
        path: 'supabase/migrations/20260709120000_lock_down_function_and_view_privileges.sql',
        text: 'REVOKE ALL ON FUNCTION public.get_event_kickback_summary(UUID) FROM PUBLIC, anon, authenticated;',
        count: 1,
      },
      {
        path: 'supabase/migrations/20260709120000_lock_down_function_and_view_privileges.sql',
        text: 'GRANT EXECUTE ON FUNCTION public.calculate_event_kickback(UUID) TO service_role;',
        count: 1,
      },
      {
        path: 'supabase/migrations/20260709120000_lock_down_function_and_view_privileges.sql',
        text: 'GRANT EXECUTE ON FUNCTION public.get_event_kickback_summary(UUID) TO service_role;',
        count: 1,
      },
      {
        path: 'supabase/migrations/20260709120000_lock_down_function_and_view_privileges.sql',
        text: 'GRANT EXECUTE ON FUNCTION public.get_event_kickback_summary(UUID) TO authenticated;',
        count: 1,
      },
      {
        path: 'supabase/migrations/20260709130000_server_owned_execution_control_plane.sql',
        text: "'kickback_payments',",
        count: 1,
      },
      {
        path: 'supabase/migrations/20260709130000_server_owned_execution_control_plane.sql',
        text: "'kickback_payments'",
        count: 1,
      },
    ])
  })
})
