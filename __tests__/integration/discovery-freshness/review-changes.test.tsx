/** @jest-environment node */
jest.mock('server-only', () => ({}))
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('@/lib/server/admin-auth', () => ({ getAdminContext: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: jest.fn() }))
jest.mock('@/lib/discovery/cascadeInvalidation', () => ({ cascadeInvalidationForEntityChange: jest.fn().mockResolvedValue({}) }))

import React from 'react'
import Page from '@/app/admin/discovery/review-changes/page'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { independentVendorEvidence } from '@/lib/discovery/vendorRepository'

type Row = Record<string, any>
class ReviewDb {
  change: Row = { id: 'change-1', entity_type: 'discovery_vendor', entity_id: 'vendor-1', source: 'vendor_self_update', field_name: 'name',
    old_value: 'OLD_GOOGLE_CANARY', new_value: 'Independent Catering', confidence: 1, source_evidence: 'GOOGLE_EVIDENCE_CANARY', created_at: '2026-11-10T00:00:00Z' }
  vendor: Row = { id: 'vendor-1', name: 'Independent Catering', field_provenance: {
    name: independentVendorEvidence('host_input', 'profile:vendor-1'),
  } }
  rpc = jest.fn(async (_name: string, _args: Row) => ({ data: this.vendor, error: null as { message: string } | null }))
  updates: Row[] = []
  from(table: string) {
    const db = this
    let payload: Row | null = null
    const query: any = {
      select: () => query, eq: () => query, order: () => query, limit: () => query, in: () => query,
      update: (value: Row) => { payload = value; return query },
      maybeSingle: async () => ({ data: table === 'discovery_vendors_safe' ? db.vendor : db.change, error: null }),
      then: (resolve: (value: unknown) => void) => {
        if (payload) db.updates.push({ table, ...payload })
        return Promise.resolve({ data: table === 'discovery_vendors_safe' ? [db.vendor] : [db.change], error: null }).then(resolve)
      },
    }
    if (!['discovery_change_log', 'discovery_vendors_safe'].includes(table)) throw new Error(`Unexpected direct table: ${table}`)
    return query
  }
}

function findActions(node: unknown): Array<(data: FormData) => Promise<void>> {
  if (Array.isArray(node)) return node.flatMap(findActions)
  if (!React.isValidElement(node)) return []
  const props = node.props as { action?: (data: FormData) => Promise<void>; children?: unknown }
  return [...(typeof props.action === 'function' ? [props.action] : []), ...findActions(props.children)]
}

function form() { const data = new FormData(); data.set('id', 'change-1'); return data }

describe('vendor historical-change review boundary', () => {
  let db: ReviewDb
  beforeEach(() => {
    jest.clearAllMocks()
    db = new ReviewDb()
    ;(getAdminContext as jest.Mock).mockResolvedValue({ authorized: true, user: { id: 'admin-1' } })
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
  })

  it('never renders legacy Google values or evidence bodies, and hides unproven replay', async () => {
    db.vendor.field_provenance = {}
    const page = await Page()
    expect(JSON.stringify(page)).not.toContain('GOOGLE_CANARY')
    expect(JSON.stringify(page)).not.toContain('GOOGLE_EVIDENCE_CANARY')
    expect(JSON.stringify(page)).not.toContain('Independent Catering')
    expect(findActions(page)).toHaveLength(1) // reject remains available; apply is gated
  })

  it('does not reclassify Google history because an independent value happens to match', async () => {
    const [apply] = findActions(await Page())
    db.change.source = 'places_refresh'
    const page = await Page()
    expect(findActions(page)).toHaveLength(1)
    await expect(apply(form())).rejects.toThrow('Google history cannot be reapplied')
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('reuses current independent evidence and the fact RPC, never promotes admin approval to origin', async () => {
    const [apply] = findActions(await Page())
    await apply(form())
    expect(db.rpc).toHaveBeenCalledWith('write_discovery_vendor_independent_facts', expect.objectContaining({
      p_vendor_id: 'vendor-1', p_values: { name: 'Independent Catering' },
      p_field_provenance: { name: db.vendor.field_provenance.name },
    }))
    expect(db.updates).toContainEqual(expect.objectContaining({ table: 'discovery_change_log', applied: true }))
  })

  it('rechecks admin authorization when the server action is invoked directly', async () => {
    const [apply] = findActions(await Page())
    ;(getAdminContext as jest.Mock).mockResolvedValue({ authorized: false, status: 403 })
    await expect(apply(form())).rejects.toThrow('Admin access required')
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('rejects a stale or unproven proposed value even if a form was rendered before the change', async () => {
    const [apply] = findActions(await Page())
    db.change.new_value = 'NEW_GOOGLE_CANARY'
    await expect(apply(form())).rejects.toThrow('independently reacquired evidence')
    expect(db.rpc).not.toHaveBeenCalled()
    expect(db.updates).toEqual([])
  })

  it('does not mark history applied when the safe fact write fails', async () => {
    const [apply] = findActions(await Page())
    db.rpc.mockResolvedValue({ data: db.vendor, error: { message: 'denied' } })
    await expect(apply(form())).rejects.toThrow('Unable to apply independent vendor change')
    expect(db.updates).toEqual([])
  })
})
