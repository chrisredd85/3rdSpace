/** @jest-environment node */
import { readDiscoveryRpcResponse } from '../discoveryRpcResponse'
import { venueBoundaryFetch } from '../venueBoundaryFetch'
import { assertDurableVendorContent } from '@/lib/discovery/vendorPersistence'
import { readSafeDiscoveryVenue, independentVenueEvidence } from '@/lib/discovery/venueRepository'
import capturedReceipts from './fixtures/concierge-receipts-160.json'

type Row = Record<string, unknown>
type Receipt = { scenario: string; rpc: string; result: Row }
const receipts: Receipt[] = capturedReceipts
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const object = (value: unknown): Row => value as Row
const base = (): Row => clone(receipts.find(receipt => receipt.scenario === 'complete')!.result)
const vendorData = () => clone(object(base().metadata).vendor_data)
const otherId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const args = (receipt: Receipt): Row => receipt.rpc === 'cancel_approved_admin_task'
  ? { p_plan_id: receipt.result.plan_id, p_action_id: receipt.result.agent_action_id, p_approval_id: receipt.result.approval_id, p_actor_id: otherId }
  : { p_task_id: receipt.result.id, [receipt.rpc.startsWith('complete') ? 'p_admin_user_id' : 'p_actor_id']: otherId }
const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json', etag: 'old-value', 'content-length': '999' },
})
async function transport(receipt: Receipt, value: unknown, request = args(receipt)) {
  const fetcher = jest.fn().mockResolvedValue(jsonResponse(value))
  const response = await venueBoundaryFetch(fetcher)(`https://example.com/rest/v1/rpc/${receipt.rpc}`, {
    method: 'POST', body: JSON.stringify(request),
  })
  return { fetcher, response, body: await response.json() }
}

// This is the planned mutable task projection, not a receipt from an applied161.
function projected161(row: Row): Row {
  return { ...row, description: '', metadata: { ...object(row.metadata) } }
}

describe('typed concierge RPC receipts across the160/161 deploy window', () => {
  it.each(receipts)('$scenario: reproduces the former blanket-validator rejection', receipt => {
    expect(() => assertDurableVendorContent(receipt.result)).toThrow('$.notes')
  })

  describe.each(['160-full', '161-projected'] as const)('%s', version => {
    it.each(receipts)('$scenario preserves every field through the real transport, once', async receipt => {
      const row = version === '160-full' ? clone(receipt.result) : projected161(clone(receipt.result))
      const before = JSON.stringify(row)
      expect(readDiscoveryRpcResponse(receipt.rpc, row, args(receipt))).toBe(row)
      const { response, body, fetcher } = await transport(receipt, row)
      expect(response.status).toBe(200)
      expect(body).toEqual(row)
      expect(body.notes).toBe(row.notes)
      expect(body.metadata).toEqual(row.metadata)
      expect(JSON.stringify(row)).toBe(before)
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(fetcher.mock.calls[0][1].cache).toBe('no-store')
      expect(response.headers.get('Cache-Control')).toContain('no-store')
      expect(response.headers.get('CDN-Cache-Control')).toBe('no-store')
      expect(response.headers.get('Vercel-CDN-Cache-Control')).toBe('no-store')
      expect(response.headers.has('etag')).toBe(false)
    })
  })

  it.each(receipts)('$scenario accepts the singleton composite-array representation without rewriting it', async receipt => {
    const rows = [clone(receipt.result)]
    const { response, body } = await transport(receipt, rows)
    expect(response.status).toBe(200)
    expect(body).toEqual(rows)
  })

  it('keeps known operator prose literal even when its text happens to resemble serialized discovery JSON', () => {
    const row = base()
    const prose = '{"vendor_data":{"notes":"operator copied a diagnostic example"}}'
    row.notes = prose
    row.description = 'Operator handoff'
    row.outcome_payload = { outcome: 'completed', summary: prose, reason: prose, hold_reference: prose }
    expect(readDiscoveryRpcResponse('complete_admin_task_execution', row, { p_task_id: row.id })).toBe(row)
    expect(row.notes).toBe(prose)
  })

  it.each(['notes', 'description'])('requires scalar typed task.%s rather than exempting arbitrary containers', field => {
    const row = { ...base(), [field]: { googleLive: { name: 'provider copy' } } }
    expect(() => readDiscoveryRpcResponse('complete_admin_task_execution', row, { p_task_id: row.id })).toThrow()
  })

  it.each(['reason', 'summary', 'hold_reference'])('requires scalar outcome_payload.%s', field => {
    const row = { ...base(), outcome_payload: { outcome: 'completed', [field]: { vendor_data: vendorData() } } }
    expect(() => readDiscoveryRpcResponse('complete_admin_task_execution', row, { p_task_id: row.id })).toThrow()
  })

  it('does not grant a root reason exemption: it is not an admin_tasks column', () => {
    const row = { ...base(), reason: 'Unevidenced discovery ranking reason' }
    expect(() => readDiscoveryRpcResponse('complete_admin_task_execution', row, { p_task_id: row.id })).toThrow()
  })

  it('does not alter default RPC validation', () => {
    const row = base()
    expect(() => readDiscoveryRpcResponse('unreviewed_rpc', row)).toThrow('$.notes')
  })

  it.each([[], [base(), base()], null, 'not a task'].map(input => [input]))('rejects malformed/non-single task results %#', input => {
    expect(() => readDiscoveryRpcResponse('complete_admin_task_execution', input, { p_task_id: base().id })).toThrow()
  })
})

describe('concierge discovery and consent validation stays strict', () => {
  it.each(['notes', 'reason', 'name'])('rejects %s inside the vendor fact object despite allowed operator notes', field => {
    const row = base()
    const envelope = object(vendorData())
    const provenance = { ...object(envelope.field_provenance) }
    delete provenance[field]
    object(row.metadata).vendor_data = { ...envelope, values: { ...object(envelope.values), [field]: 'UNPROVEN' }, field_provenance: provenance }
    expect(() => readDiscoveryRpcResponse('complete_admin_task_execution', row, { p_task_id: row.id })).toThrow()
  })

  it.each(['notes', 'reason', 'name'])('rejects unevidenced metadata.%s without a global exemption', field => {
    const row = base()
    object(row.metadata)[field] = 'UNPROVEN'
    expect(() => readDiscoveryRpcResponse('complete_admin_task_execution', row, { p_task_id: row.id })).toThrow()
  })

  it.each(['notes', 'reason', 'name'])('still inspects explicit discovery facts nested inside an outcome (%s)', field => {
    const row = base()
    const envelope = object(vendorData())
    row.outcome_payload = { outcome: 'completed', summary: 'Operator summary', fact: {
      target_type: 'discovery_vendor', target_id: object(envelope.identity).id, vendor_data: envelope, [field]: 'UNPROVEN',
    } }
    expect(() => readDiscoveryRpcResponse('complete_admin_task_execution', row, { p_task_id: row.id })).toThrow()
  })

  it('does not exempt outcome prose when the outcome itself declares a discovery fact container', () => {
    const row = base()
    const envelope = object(vendorData())
    row.outcome_payload = { outcome: 'completed', target_type: 'discovery_vendor', target_id: object(envelope.identity).id,
      vendor_data: envelope, reason: 'Unevidenced vendor ranking' }
    expect(() => readDiscoveryRpcResponse('complete_admin_task_execution', row, { p_task_id: row.id })).toThrow()
  })

  it.each([
    ['source/kind vendor', () => ({ source: 'discovery', kind: 'vendor', payload_json: { vendor_data: vendorData() } })],
    ['nested metadata vendor envelope', () => ({ metadata: { vendor_data: vendorData() } })],
    ['Google source', () => ({ source: 'google_places' })],
  ] as const)('keeps an outcome reason strict in the %s context', (_label, context) => {
    const row = base()
    row.outcome_payload = { ...context(), outcome: 'completed', reason: 'UNPROVEN' }
    expect(() => readDiscoveryRpcResponse('complete_admin_task_execution', row, { p_task_id: row.id })).toThrow('reason')
  })

  it.each(['google_places', 'unresolved'])('rejects %s vendor evidence, never inventing independent origin', source => {
    const row = base()
    const envelope = object(vendorData())
    const provenance = object(envelope.field_provenance)
    object(row.metadata).vendor_data = { ...envelope, field_provenance: {
      ...provenance, name: source === 'unresolved' ? { resolution: 'unresolved' } : { ...object(provenance.name), source },
    } }
    expect(() => readDiscoveryRpcResponse('complete_admin_task_execution', row, { p_task_id: row.id })).toThrow()
  })

  it('rejects vendor identity substitution against the metadata target', () => {
    const row = base()
    row.metadata = { ...object(row.metadata), target_type: 'discovery_vendor', target_id: otherId }
    expect(() => readDiscoveryRpcResponse('complete_admin_task_execution', row, { p_task_id: row.id })).toThrow()
  })

  it('preserves independent venue metadata plus operator prose but rejects venue aliases and nested fact notes', () => {
    const row = base()
    const evidence = independentVenueEvidence('host_input', 'fixture:host-venue', '2026-11-10T00:00:00Z')
    const venue = readSafeDiscoveryVenue({ id: otherId, source: 'google_places', source_external_id: 'fixture-venue', name: 'Independent Hall',
      metadata: { venue_boundary_version: 1, field_provenance: { name: evidence } } })
    row.metadata = { target_type: 'discovery_venue', target_id: otherId, provider: venue.name, venue_data: venue.venue_data }
    row.outcome_payload = { outcome: 'completed', summary: 'Operator completed the request' }
    expect(readDiscoveryRpcResponse('complete_admin_task_execution', row, { p_task_id: row.id })).toBe(row)
    for (const field of ['provider', 'notes', 'reason']) {
      const bad = { ...row, metadata: { ...object(row.metadata), [field]: 'UNPROVEN' } }
      expect(() => readDiscoveryRpcResponse('complete_admin_task_execution', bad, { p_task_id: row.id })).toThrow()
    }
  })

  it('preserves signed snapshots, hashes, authorization and cents; a changed signed provider still rejects', () => {
    const row = base()
    const envelope = object(vendorData())
    const provider = object(envelope.values).name
    const target = object(envelope.identity).id
    const payload = { target_type: 'discovery_vendor', target_id: target, target_name: provider, vendor_data: envelope, amount_cents: 70000 }
    const signed = { snapshot_hash: 'exact-approved-hash', snapshot_schema_version: 2, authorized_by: otherId,
      authorized_at: '2026-11-10T00:00:00Z', requested_amount_cents: 70000,
      snapshot_json: { schema_version: 2, plan: { id: row.plan_id }, approval: { provider }, counterparty: { provider, target_id: target, target_type: 'discovery_vendor' },
        action: { target_type: 'discovery_vendor', target_id: target, payload_json: payload } } }
    object(row.metadata).approved_record = signed
    const before = JSON.stringify(signed)
    expect(readDiscoveryRpcResponse('complete_admin_task_execution', row, { p_task_id: row.id })).toBe(row)
    expect(JSON.stringify(object(row.metadata).approved_record)).toBe(before)
    const bad = clone(row)
    const badSigned = object(object(bad.metadata).approved_record)
    object(object(badSigned.snapshot_json).counterparty).provider = 'UNPROVEN'
    expect(() => readDiscoveryRpcResponse('complete_admin_task_execution', bad, { p_task_id: row.id })).toThrow()
    expect(JSON.stringify(signed)).toBe(before)
  })
})

describe('receipt identity binding and committed recovery', () => {
  it.each(receipts.filter(receipt => receipt.rpc !== 'cancel_approved_admin_task'))('$scenario rejects another task receipt after success without retrying', async receipt => {
    const { response, body, fetcher } = await transport(receipt, receipt.result, { ...args(receipt), p_task_id: otherId })
    expect(response.status).toBe(409)
    expect(body.code).toBe('COMMITTED_RESPONSE_UNAVAILABLE')
    expect(body.details).toContain('committed')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each(['p_plan_id', 'p_action_id', 'p_approval_id'])('host wrapper rejects a mismatched %s', async key => {
    const receipt = receipts.find(value => value.scenario === 'host_cancel')!
    const { response, body, fetcher } = await transport(receipt, receipt.result, { ...args(receipt), [key]: otherId })
    expect(response.status).toBe(409)
    expect(body.code).toBe('COMMITTED_RESPONSE_UNAVAILABLE')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each(receipts)('$scenario accepts uppercase UUID arguments without changing returned identity', async receipt => {
    const uppercase = Object.fromEntries(Object.entries(args(receipt)).map(([key, value]) => [key, typeof value === 'string' ? value.toUpperCase() : value]))
    const { response, body } = await transport(receipt, receipt.result, uppercase)
    expect(response.status).toBe(200)
    expect(body).toEqual(receipt.result)
  })

  it('requires request identity for a successful transport response', async () => {
    const receipt = receipts.find(value => value.scenario === 'complete')!
    const { response, body, fetcher } = await transport(receipt, receipt.result, {})
    expect(response.status).toBe(409)
    expect(body.code).toBe('COMMITTED_RESPONSE_UNAVAILABLE')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('a committed but unreadable vendor alias remains recovery-pending, never a fabricated rollback or automatic retry', async () => {
    const receipt = receipts.find(value => value.scenario === 'complete')!
    const row = clone(receipt.result)
    object(row.metadata).name = 'UNPROVEN'
    const { response, body, fetcher } = await transport(receipt, row)
    expect(response.status).toBe(409)
    expect(body.code).toBe('COMMITTED_RESPONSE_UNAVAILABLE')
    expect(body.details).toContain('Reload current state')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(object(row.metadata).name).toBe('UNPROVEN')
  })
})
