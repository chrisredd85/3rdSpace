import { asRecord } from '@/lib/discovery/foundation/provenance'
import { assertDurableVendorContent } from '@/lib/discovery/vendorPersistence'
import { assertDurableVenueContent, readSafeVenueSnapshot } from '@/lib/discovery/venuePersistence'
import { readLegacyVenueContent } from '@/lib/discovery/venueLegacyReads'

export const COMMITTED_RESPONSE_UNAVAILABLE = 'COMMITTED_RESPONSE_UNAVAILABLE'
const aggregateRpcs = new Set(['stage_vendor_quote_booking_checked', 'stage_plan_quote_booking', 'cancel_staged_plan_quote_booking', 'apply_plan_revision_atomic'])

/** Explicit response contracts only. SQL success is committed even if a legacy
 * signed result is unreadable. Never alter signed records or retry that mutation.
 */
export function readDiscoveryRpcResponse(name: string, input: unknown): unknown {
  if (!aggregateRpcs.has(name)) {
    assertDurableVenueContent(input)
    assertDurableVendorContent(input)
    return input
  }
  const row = asRecord(input)
  if (!row) throw new Error('Unrecognized committed RPC aggregate')
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (key === 'plan') output[key] = readLegacyVenueContent('plans', readSafeVenueSnapshot(value))
    else if (key === 'approval_message') output[key] = readLegacyVenueContent('plan_messages', readSafeVenueSnapshot(value))
    else {
      // Action, approval and revision evidence is preserve-or-reject, never rehashed.
      assertDurableVenueContent(value)
      assertDurableVendorContent(value)
      output[key] = value
    }
  }
  return output
}

export function committedResponseUnavailable() {
  return {
    code: COMMITTED_RESPONSE_UNAVAILABLE,
    message: COMMITTED_RESPONSE_UNAVAILABLE,
    details: 'The database committed this request. Reload current state; do not automatically repeat the mutation.',
    hint: null,
  }
}

/** Preserve the authoritative database outcome; callers must not finalize failed. */
export function isCommittedResponseUnavailable(error: unknown): boolean {
  const row = asRecord(error)
  return row?.code === COMMITTED_RESPONSE_UNAVAILABLE || (error instanceof Error && error.message.includes(COMMITTED_RESPONSE_UNAVAILABLE))
}
export function committedResponseRecoveryBody() {
  return { code: COMMITTED_RESPONSE_UNAVAILABLE, error: 'Committed result needs source verification', committed: true, recovery_pending: true, retryable: false,
    message: 'The database saved this request. Reload the plan; source verification is needed before another action.' }
}
