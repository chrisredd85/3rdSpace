/** Actual stage SQL aggregates must remain readable by the deployed app. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readDiscoveryRpcResponse } from '../../lib/supabase/discoveryRpcResponse'
import { venueBoundaryFetch } from '../../lib/supabase/venueBoundaryFetch'

async function main() {
  const rows = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { case_number: number; result: Record<string, unknown> }[]
  assert.equal(rows.length, 3)
  for (const { case_number: n, result } of rows) {
    const rpc = n === 1 ? 'stage_vendor_quote_booking_checked' : 'stage_plan_quote_booking'
    const before = JSON.stringify(result)
    const approval = result.approval as Record<string, unknown>
    assert.equal(approval.notes, 'Partner confirmed the $700 package includes setup.')
    const snapshot = approval.snapshot_json as { approval: { notes: string } }
    assert.equal(snapshot.approval.notes, approval.notes)
    const parsed = readDiscoveryRpcResponse(rpc, result) as Record<string, unknown>
    assert.equal(parsed.approval, result.approval, 'Signed approval is returned unchanged')
    assert.equal(JSON.stringify(result), before)
    let calls = 0
    const boundary = venueBoundaryFetch(async () => {
      calls += 1
      return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const response = await boundary(`https://example.com/rest/v1/rpc/${rpc}`, { method: 'POST', body: '{}' })
    assert.equal(response.status, 200, 'Committed real stage response remains readable')
    assert.deepEqual(await response.json(), parsed)
    assert.equal(calls, 1)
    console.log(`PASS stage ${n}: real quote notes + signed response readable through ${rpc}`)
  }
  console.log(JSON.stringify({ status: 'PASS', actual_stage_receipts: rows.length, producer: 'gateway vendor/direct vendor/direct venue' }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
