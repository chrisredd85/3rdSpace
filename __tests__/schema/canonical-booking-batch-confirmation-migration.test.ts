import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260709168000_confirm_canonical_venue_bookings_batch.sql'),
  'utf8',
)
const generatedTypes = readFileSync(
  join(process.cwd(), 'lib/types/database-generated.ts'),
  'utf8',
)

describe('canonical venue-booking batch confirmation migration', () => {
  it('defines one bounded service-only command for the canonical batch', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.confirm_canonical_venue_bookings_batch',
    )
    expect(migration).toContain('v_requested_count > 100')
    expect(migration).toContain('COUNT(DISTINCT booking_id)')
    expect(migration).toContain('confirm_canonical_venue_bookings_batch_ids_must_be_unique')
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.confirm_canonical_venue_bookings_batch\(UUID\[\], UUID, JSONB\)[\s\S]+FROM PUBLIC, anon, authenticated/,
    )
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.confirm_canonical_venue_bookings_batch\(UUID\[\], UUID, JSONB\)[\s\S]+TO service_role/,
    )
  })

  it('locks in deterministic order and rechecks ownership and complete provenance', () => {
    const body = functionBody('confirm_canonical_venue_bookings_batch')

    expect(body).toContain('ORDER BY requested.booking_id')
    expect(body.indexOf('FOR UPDATE OF plan_row')).toBeLessThan(body.indexOf('FOR UPDATE OF action_row'))
    expect(body.indexOf('FOR UPDATE OF action_row')).toBeLessThan(body.indexOf('FOR UPDATE OF approval_row'))
    expect(body.indexOf('FOR UPDATE OF approval_row')).toBeLessThan(body.indexOf('FOR UPDATE;'))
    expect(body).toContain('FOR SHARE OF venue')
    expect(body).toContain('v_owner_id IS DISTINCT FROM p_actor_id')
    expect(body).toContain('v_plan_id IS NULL OR v_event_id IS NULL')
    expect(body).toContain('OR v_action_id IS NULL OR v_approval_id IS NULL')
  })

  it('delegates every item to the audited canonical command without swallowing failures', () => {
    const body = functionBody('confirm_canonical_venue_bookings_batch')

    expect(body).toContain('v_result := public.confirm_canonical_booking(')
    expect(body).toContain("'bulk_confirmation', true")
    expect(body).toContain("'results', v_results")
    expect(body).toContain("'bookings', v_bookings")
    expect(body).not.toMatch(/EXCEPTION\s+WHEN/i)
    expect(body).not.toMatch(/UPDATE\s+public\.venue_bookings/i)
  })

  it('returns exact per-booking replay provenance and fails closed if the inner result is incomplete', () => {
    const body = functionBody('confirm_canonical_venue_bookings_batch')

    expect(body).toContain("jsonb_typeof(v_result -> 'existing') IS DISTINCT FROM 'boolean'")
    expect(body).toContain("v_result ->> 'booking_id' IS DISTINCT FROM v_booking_id::TEXT")
    expect(body).toContain("v_result ->> 'booking_kind' IS DISTINCT FROM 'venue'")
    expect(body).toContain("v_result ->> 'booking_status' IS DISTINCT FROM 'confirmed'")
    expect(body).toContain("v_result ->> 'action_status' IS DISTINCT FROM 'complete'")
    expect(body).toContain("v_result ->> 'plan_id' IS DISTINCT FROM v_plan_id::TEXT")
    expect(body).toContain("v_result ->> 'event_id' IS DISTINCT FROM v_event_id::TEXT")
    expect(body).toContain('confirm_canonical_venue_bookings_batch_result_invalid')
    expect(body).toContain("'existing_count', v_existing_count")
    expect(body).toContain("'results', v_results")
  })

  it('records the callable RPC in generated database types', () => {
    expect(generatedTypes).toMatch(
      /confirm_canonical_venue_bookings_batch:\s*\{[\s\S]+p_booking_ids: string\[\][\s\S]+Returns: Json/,
    )
  })
})

function functionBody(name: string) {
  return migration.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]+?\\$function\\$;`),
  )?.[0] ?? ''
}
