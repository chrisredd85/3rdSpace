import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260709178000_make_canonical_venue_confirmation_effects_replayable.sql',
), 'utf8')

describe('canonical venue confirmation effect reconciliation migration', () => {
  it('uses the canonical booking id as a unique key for both route effects', () => {
    expect(migration).toContain('canonical_venue_confirmation_booking_id UUID')
    expect(migration).toContain('notifications_canonical_venue_confirmation_unique')
    expect(migration).toContain('canonical_confirmation_booking_id UUID')
    expect(migration).toContain('venue_booking_audit_canonical_confirmation_unique')
    expect(migration).toContain('ON CONFLICT (canonical_venue_confirmation_booking_id)')
    expect(migration).toContain('ON CONFLICT (canonical_confirmation_booking_id)')
  })

  it('reconciles only exact completed canonical bulk confirmations', () => {
    expect(migration).toContain('ensure_canonical_venue_confirmation_effects')
    expect(migration).toContain("'{confirmation_context,bulk_confirmation}'")
    expect(migration).toContain('canonical_booking_has_execution_provenance')
    expect(migration).toContain("v_booking.status IS DISTINCT FROM 'confirmed'")
    expect(migration).toContain("v_action.status IS DISTINCT FROM 'complete'")
  })

  it('matches confirmation lock order and is callable only by the service role', () => {
    const planLock = migration.indexOf('FOR UPDATE OF plan_row')
    const eventLock = migration.indexOf('FOR SHARE OF event_row')
    const actionLock = migration.indexOf('FOR UPDATE OF action_row')
    const approvalLock = migration.indexOf('FOR UPDATE OF approval_row')
    const venueLock = migration.indexOf('FOR SHARE OF venue')
    const bookingLock = migration.indexOf('FOR UPDATE;')
    expect(planLock).toBeGreaterThan(0)
    expect(eventLock).toBeGreaterThan(planLock)
    expect(actionLock).toBeGreaterThan(eventLock)
    expect(approvalLock).toBeGreaterThan(actionLock)
    expect(venueLock).toBeGreaterThan(approvalLock)
    expect(bookingLock).toBeGreaterThan(venueLock)
    expect(migration).toContain('FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('TO service_role;')
  })
})
