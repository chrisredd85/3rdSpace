import { asRecord } from '@/lib/discovery/foundation/provenance'
import { assertDurableVendorContent, isDiscoveryVendor } from '@/lib/discovery/vendorPersistence'
import { assertDurableVenueContent, isVenueProvider, readSafeVenueSnapshot } from '@/lib/discovery/venuePersistence'
import { readLegacyVenueContent } from '@/lib/discovery/venueLegacyReads'

export const COMMITTED_RESPONSE_UNAVAILABLE = 'COMMITTED_RESPONSE_UNAVAILABLE'
const aggregateRpcs = new Set(['stage_vendor_quote_booking_checked', 'stage_plan_quote_booking', 'cancel_staged_plan_quote_booking', 'apply_plan_revision_atomic'])
const conciergeRpcs = new Set(['complete_admin_task_execution', 'cancel_admin_task_execution', 'cancel_approved_admin_task'])
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

type ConciergeTaskReceipt = Record<string, unknown> & {
  id: string
  plan_id: string
  agent_action_id: string | null
  approval_id: string | null
  description: string
  notes: string | null
  metadata: Record<string, unknown>
  outcome_payload: Record<string, unknown>
}

function assertOperatorText(value: unknown): void {
  if (value != null && typeof value !== 'string') throw new Error('Invalid concierge operator text')
}

/** Both SQL160 and the proposed SQL161 return public.admin_tasks. Only mutable
 * presentation differs; the audit projection is not a new response wrapper.
 * Validate a temporary view, never strip fields from the returned task or alter
 * signed evidence. These exemptions belong to this RPC contract, not discovery.
 */
function readConciergeTaskResponse(name: string, input: unknown, requestArgs?: unknown): unknown {
  if (Array.isArray(input) && input.length !== 1) throw new Error('Expected one concierge task')
  const row = asRecord(Array.isArray(input) ? input[0] : input)
  const metadata = asRecord(row?.metadata)
  const outcome = asRecord(row?.outcome_payload)
  if (!row || !metadata || !outcome
    || typeof row.id !== 'string' || !uuid.test(row.id)
    || typeof row.plan_id !== 'string' || !uuid.test(row.plan_id)
    || !['agent_action_id', 'approval_id'].every(key => row[key] === null || typeof row[key] === 'string' && uuid.test(row[key]))
    || typeof row.description !== 'string'
    || !(row.notes === null || typeof row.notes === 'string')
    || row.status !== (name === 'complete_admin_task_execution' ? 'complete' : 'cancelled')) {
    throw new Error('Invalid concierge task response')
  }
  // Transport supplies the actual request. SQL/RLS still owns authorization and
  // saved-fact verification; JSON evidence alone cannot prove source truth.
  if (requestArgs !== undefined) {
    const args = asRecord(requestArgs)
    const bindings = name === 'cancel_approved_admin_task'
      ? { plan_id: 'p_plan_id', agent_action_id: 'p_action_id', approval_id: 'p_approval_id' }
      : { id: 'p_task_id' }
    if (!args || Object.entries(bindings).some(([field, arg]) => {
      const expected = args[arg]
      const actual = row[field]
      return typeof expected !== 'string' || !uuid.test(expected) || typeof actual !== 'string'
        || actual.toLowerCase() !== expected.toLowerCase()
    })) {
      throw new Error('Concierge response identity mismatch')
    }
  }
  const task = row as ConciergeTaskReceipt
  const checked: Record<string, unknown> = { ...task }
  delete checked.notes
  delete checked.description // Task instructions, not metadata's business description.
  const checkedOutcome = { ...outcome }
  // Do not let a fact/signed object masquerade as an operator outcome container.
  // Reuse the validators' context rules, including source/kind and nested
  // metadata envelopes; a hand-maintained subset could exempt a discovery fact.
  const factContainer = isDiscoveryVendor(outcome) || isVenueProvider(outcome)
    || 'snapshot_json' in outcome || 'snapshot_hash' in outcome
    || outcome.schema_version === 2 && 'plan' in outcome && 'action' in outcome && 'approval' in outcome
  if (!factContainer) {
    for (const key of ['reason', 'summary', 'hold_reference']) {
      assertOperatorText(outcome[key])
      delete checkedOutcome[key]
    }
  }
  checked.outcome_payload = checkedOutcome
  // Metadata, unknown descendants, fact subobjects and consent remain intact in
  // this view. In particular there is no recursive notes/reason/name exemption.
  assertDurableVenueContent(checked)
  assertDurableVendorContent(checked)
  return input
}

/** Explicit response contracts only. SQL success is committed even if a legacy
 * signed result is unreadable. Never alter signed records or retry that mutation.
 */
export function readDiscoveryRpcResponse(name: string, input: unknown, requestArgs?: unknown): unknown {
  if (conciergeRpcs.has(name)) return readConciergeTaskResponse(name, input, requestArgs)
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
