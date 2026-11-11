/** @jest-environment node */
jest.mock('server-only', () => ({}))
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('@/lib/server/admin-auth', () => ({ getAdminContext: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: jest.fn() }))

import { approveRate, rejectRate, editRate } from '@/app/admin/discovery/vendor-rate-review/actions'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { independentVendorEvidence } from '@/lib/discovery/vendorRepository'
import { revalidatePath } from 'next/cache'

const id = '10000000-0000-4000-8000-000000000001'
const evidence = independentVendorEvidence('venue_site', 'https://partner.example/rates', '2026-11-10T12:00:00Z')
const actionCases = [
  ['approve', approveRate, 'approved'],
  ['reject', rejectRate, 'rejected'],
  ['edit', editRate, 'edited'],
] as const
type DbError = { message: string; code?: string } | null
type Row = Record<string, unknown>
type ReadResult = { data: Row | null; error: DbError }
type Query = {
  select: jest.Mock<Query, [string]>
  eq: jest.Mock<Query, [string, string]>
  maybeSingle: jest.Mock<Promise<ReadResult>, []>
}

function makeDb() {
  const row: Row = {
    id, source: 'google_places', source_external_id: 'place-one',
    inferred_hourly_rate_cents: 2500,
    inferred_package_rate_cents: 10000,
    inferred_minimum_cents: null,
    rate_inference_admin_status: 'pending',
    field_provenance: { inferred_hourly_rate_cents: evidence, inferred_package_rate_cents: evidence },
  }
  const state = { row: row as Row | null, error: null as DbError }
  let columns = '*'
  const query: Query = {
    select: jest.fn((value: string) => { columns = value; return query }),
    eq: jest.fn<Query, [string, string]>(() => query),
    maybeSingle: jest.fn(async () => ({
      // Model PostgREST's selected-column projection so omitting provenance
      // cannot accidentally pass because the mock returned an entire row.
      data: !state.row || columns === '*' ? state.row
        : Object.fromEntries(columns.split(',').map(key => key.trim()).map(key => [key, state.row![key]])),
      error: state.error,
    })),
  }
  const from = jest.fn((table: string) => {
    if (table !== 'discovery_vendors_safe') throw new Error(`Unexpected direct table access: ${table}`)
    return query
  })
  const rpc = jest.fn<Promise<{ data: Row | null; error: DbError }>, [string, Record<string, unknown>]>(
    async () => ({ data: state.row, error: null })
  )
  return { state, from, rpc, query }
}

function form(values: Record<string, string | File | null> = {}) {
  const result = new FormData()
  result.set('id', id)
  result.set('package_cents', '10000')
  for (const [key, value] of Object.entries(values)) {
    if (value === null) result.delete(key)
    else result.set(key, value)
  }
  return result
}

describe('vendor rate-review server actions', () => {
  let db: ReturnType<typeof makeDb>
  beforeEach(() => {
    jest.clearAllMocks()
    db = makeDb()
    ;(getAdminContext as jest.Mock).mockResolvedValue({ authorized: true, user: { id: 'admin-one', email: 'admin@example.com' } })
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
  })

  describe.each(actionCases)('%s', (_label, action, status) => {
    it.each([401, 403])('denies authorization status %s before constructing a privileged client', async deniedStatus => {
      ;(getAdminContext as jest.Mock).mockResolvedValue({ authorized: false, status: deniedStatus })
      await expect(action(form())).rejects.toThrow('Admin access required')
      expect(createServiceRoleClient).not.toHaveBeenCalled()
      expect(db.from).not.toHaveBeenCalled()
      expect(db.rpc).not.toHaveBeenCalled()
      expect(revalidatePath).not.toHaveBeenCalled()
    })

    it('authenticates, reads the safe row, and writes only review state through the real fact RPC helper', async () => {
      const original = JSON.stringify(db.state.row)
      await action(form())
      expect(getAdminContext).toHaveBeenCalledTimes(1)
      expect((getAdminContext as jest.Mock).mock.invocationCallOrder[0])
        .toBeLessThan((createServiceRoleClient as jest.Mock).mock.invocationCallOrder[0])
      expect(db.from).toHaveBeenCalledWith('discovery_vendors_safe')
      expect(db.query.eq).toHaveBeenCalledWith('id', id)
      expect(db.query.maybeSingle.mock.invocationCallOrder[0]).toBeLessThan(db.rpc.mock.invocationCallOrder[0])
      expect(db.rpc).toHaveBeenCalledTimes(1)
      expect(db.rpc).toHaveBeenCalledWith('write_discovery_vendor_independent_facts', {
        p_vendor_id: id, p_values: {}, p_field_provenance: {},
        p_operational: { rate_inference_admin_status: status },
      })
      expect(JSON.stringify(db.state.row)).toBe(original)
      expect(revalidatePath).toHaveBeenCalledTimes(1)
      expect(revalidatePath).toHaveBeenCalledWith('/admin/discovery/vendor-rate-review')
      expect(db.rpc.mock.invocationCallOrder[0]).toBeLessThan((revalidatePath as jest.Mock).mock.invocationCallOrder[0])
    })

    it.each([null, '', 'not-a-uuid', '10000000-0000-4000-8000-00000000000z'])('rejects invalid vendor ID %p without writing', async invalidId => {
      await expect(action(form({ id: invalidId }))).rejects.toThrow()
      expect(db.rpc).not.toHaveBeenCalled()
      expect(revalidatePath).not.toHaveBeenCalled()
    })

    it('rejects a file submitted as the vendor ID', async () => {
      await expect(action(form({ id: new File([id], 'vendor.txt') }))).rejects.toThrow('Invalid vendor id')
      expect(db.rpc).not.toHaveBeenCalled()
      expect(revalidatePath).not.toHaveBeenCalled()
    })

    it.each(['missing', 'read-error', 'read-throw'])('does not write after %s', async failure => {
      if (failure === 'missing') db.state.row = null
      if (failure === 'read-error') db.state.error = { code: '42501', message: 'LOOKUP_PRIVATE_CANARY' }
      if (failure === 'read-throw') db.query.maybeSingle.mockRejectedValueOnce(new Error('LOOKUP_PRIVATE_CANARY'))
      await expect(action(form())).rejects.toThrow()
      expect(db.rpc).not.toHaveBeenCalled()
      expect(revalidatePath).not.toHaveBeenCalled()
    })

    it.each(['returned-error', 'transport-throw', 'response-validation', 'null-data'])('reports %s without retrying or signaling success', async failure => {
      if (failure === 'returned-error') db.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'PRIVATE_DATABASE_CANARY' } })
      if (failure === 'transport-throw') db.rpc.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_CANARY'))
      if (failure === 'response-validation') db.rpc.mockResolvedValueOnce({ data: { ...db.state.row, id: '' }, error: null })
      if (failure === 'null-data') db.rpc.mockResolvedValueOnce({ data: null, error: null })
      await expect(action(form())).rejects.toThrow(/reload.*retry/i)
      expect(db.rpc).toHaveBeenCalledTimes(1)
      expect(revalidatePath).not.toHaveBeenCalled()
    })
  })

  it.each(['0', '2147483647'])('retains the valid integer-cent boundary %s without rewriting the amount or evidence', async amount => {
    db.state.row!.inferred_package_rate_cents = Number(amount)
    await editRate(form({ package_cents: amount }))
    expect(db.rpc).toHaveBeenCalledWith('write_discovery_vendor_independent_facts', expect.objectContaining({
      p_values: {}, p_field_provenance: {}, p_operational: { rate_inference_admin_status: 'edited' },
    }))
  })

  it.each(['abc', '1.5', '-1', '2147483648', '9007199254740993', 'Infinity', 'NaN', '1e3', '0x10'])('rejects malformed or out-of-range cents %p before writing', async amount => {
    await expect(editRate(form({ package_cents: amount }))).rejects.toThrow()
    expect(db.rpc).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('rejects a file submitted as cents instead of coercing it to unknown', async () => {
    await expect(editRate(form({ package_cents: new File(['10000'], 'rate.txt') }))).rejects.toThrow()
    expect(db.rpc).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('rejects a changed amount rather than attaching the old independent provenance to it', async () => {
    await expect(editRate(form({ package_cents: '10001' }))).rejects.toThrow()
    expect(db.rpc).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it.each(['google', 'unresolved', 'google-lineage'])('cannot promote %s evidence through an equal value or an existing approved status', async source => {
    const google = { ...evidence, source: 'google_places', confirmation_status: 'venue_confirmed' }
    const provenance = source === 'google' ? google : source === 'unresolved'
      ? { resolution: 'unresolved', reason: 'legacy_unknown_lineage' }
      : { ...evidence, source: 'derived', lineage: [{ field: 'google_price_level', provenance: google }] }
    db.state.row!.field_provenance = { inferred_package_rate_cents: provenance }
    db.state.row!.rate_inference_admin_status = 'approved'
    await expect(editRate(form())).rejects.toThrow()
    expect(db.rpc).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it.each([null, '', '   '])('preserves known and unknown omitted fields %p while another evidenced field is reviewed', async omitted => {
    await editRate(form({ hourly_cents: omitted, minimum_cents: omitted }))
    expect(db.rpc).toHaveBeenCalledWith('write_discovery_vendor_independent_facts', expect.objectContaining({ p_values: {}, p_field_provenance: {} }))
    expect(db.state.row).toMatchObject({ inferred_hourly_rate_cents: 2500, inferred_package_rate_cents: 10000, inferred_minimum_cents: null })
  })

  it.each([null, '', '   '])('rejects an empty review %p rather than clearing any known amount', async empty => {
    await expect(editRate(form({ package_cents: empty, hourly_cents: empty, minimum_cents: empty }))).rejects.toThrow('No evidenced rates to review')
    expect(db.rpc).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
