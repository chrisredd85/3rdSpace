/** Actual disposable SQL161 receipts -> deployed typed RPC contract + fetch boundary.
 * SQL request arguments are captured from fixture inputs, never inferred from the
 * response. No DB/provider connection, credentials or mutation occurs here.
 * Usage: tsx scripts/release/verify-vendor-boundary-rpc-responses.ts receipts.json
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readDiscoveryRpcResponse } from '../../lib/supabase/discoveryRpcResponse'
import { venueBoundaryFetch } from '../../lib/supabase/venueBoundaryFetch'
import { NonDurableDiscoveryContentError } from '../../lib/discovery/foundation/boundary'
import { VendorPersistenceError } from '../../lib/discovery/vendorPersistence'

type Receipt = {
  scenario: string
  rpc: 'complete_admin_task_execution' | 'cancel_admin_task_execution' | 'cancel_approved_admin_task'
  request_args: Record<string, unknown>
  result: Record<string, unknown>
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

async function main() {
  const path = process.argv[2]
  const ledger = process.argv[3] ?? '161'
  assert.ok(path, 'Actual disposable SQL receipts required; no synthetic fallback')
  const receipts = JSON.parse(readFileSync(path, 'utf8')) as Receipt[]
  assert.ok(Array.isArray(receipts))
  const required = new Set(['complete', 'complete_repeat', 'cancel', 'cancel_repeat', 'host_cancel'])
  let checks = 0
  for (const receipt of receipts) {
    assert.ok(required.has(receipt.scenario), `Unexpected/duplicate scenario ${receipt.scenario}`)
    required.delete(receipt.scenario)
    const row = receipt.result
    const before = JSON.stringify(receipt)
    assert.equal(readDiscoveryRpcResponse(receipt.rpc, row, receipt.request_args), row)
    assert.equal(typeof row.description, 'string')
    assert.ok(typeof row.notes === 'string' && row.notes.includes('Prior operator note.'))
    assert.ok(row.notes.includes(receipt.scenario.startsWith('complete') ? 'Operator confirmed setup' : 'Host requested cancellation'))
    assert.equal(row.status, receipt.scenario.startsWith('complete') ? 'complete' : 'cancelled')
    const metadata = row.metadata as Record<string, unknown>
    assert.ok(metadata.vendor_data, 'Validated vendor metadata must not be dropped')
    let requests = 0
    const boundary = venueBoundaryFetch(async () => {
      requests += 1
      return new Response(JSON.stringify(row), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const response = await boundary(`https://example.com/rest/v1/rpc/${receipt.rpc}`, {
      method: 'POST', body: JSON.stringify(receipt.request_args),
    })
    assert.equal(response.status, 200, 'Committed SQL receipt remains readable, not recovery409')
    assert.deepEqual(await response.json(), row)
    assert.equal(requests, 1, 'No automatic repeat')
    assert.equal(JSON.stringify(receipt), before, 'Receipt, signed fields and notes unchanged')
    console.log(`PASS ${receipt.scenario}: actual SQL${ledger} receipt preserved through reader and fetch boundary`)
    checks += 1
  }
  assert.equal(required.size, 0, `Missing actual receipts: ${[...required]}`)
  const host = receipts.find(r => r.scenario === 'host_cancel')!
  // The typed task contract permits nullable links in other admin tasks. The
  // host wrapper requires the complete request tuple; null must not pass via
  // JS truthiness or by simply omitting requestArgs in this proof.
  for (const [arg, field] of Object.entries({ p_plan_id: 'plan_id', p_action_id: 'agent_action_id', p_approval_id: 'approval_id' })) {
    for (const value of [null, undefined, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee']) {
      const args = { ...host.request_args, [arg]: value }
      if (value === undefined) delete args[arg]
      assert.throws(() => readDiscoveryRpcResponse(host.rpc, host.result, args), /identity mismatch/)
      checks += 1
    }
    const row = { ...host.result, [field]: null }
    assert.throws(() => readDiscoveryRpcResponse(host.rpc, row, host.request_args), /identity mismatch|Invalid concierge/)
    checks += 1
  }
  for (const field of ['notes', 'reason', 'name']) {
    const row = clone(host.result)
    const metadata = row.metadata as Record<string, unknown>
    const envelope = metadata.vendor_data as Record<string, unknown>
    envelope.values = { ...(envelope.values as object), [field]: 'UNPROVEN' }
    // JSON readers verify the envelope contract, not saved source truth; the
    // SQL proof above rejects a changed name even with syntactically valid proof.
    if (field === 'name') delete (envelope.field_provenance as Record<string, unknown>).name
    assert.throws(() => readDiscoveryRpcResponse(host.rpc, row, host.request_args), NonDurableDiscoveryContentError)
    checks += 1
  }
  const forgedOutcome = clone(host.result)
  forgedOutcome.outcome_payload = {
    target_type: 'discovery_vendor', target_id: ((host.result.metadata as Record<string, unknown>).vendor_data as { identity: { id: string } }).identity.id,
    reason: 'Unproven discovery prose', vendor_data: (host.result.metadata as Record<string, unknown>).vendor_data,
  }
  assert.throws(() => readDiscoveryRpcResponse(host.rpc, forgedOutcome, host.request_args), VendorPersistenceError)
  checks += 1
  console.log(JSON.stringify({ ledger, actual_sql_receipts: receipts.length, checks, status: 'PASS' }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
