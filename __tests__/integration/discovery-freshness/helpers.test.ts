jest.mock('server-only', () => ({}))

jest.mock('@/lib/discovery/cascadeInvalidation', () => ({
  cascadeInvalidationForEntityChange: jest.fn().mockResolvedValue({ invalidatedRecommendations: 1 }),
}))

import {
  createOrganizerDiscoveryReport,
  recordStripeAccountDiscoveryFreshness,
  recordVendorProfileSelfUpdate,
} from '@/lib/discovery/freshness'
import { cascadeInvalidationForEntityChange } from '@/lib/discovery/cascadeInvalidation'

type Row = Record<string, any>

class MemoryDb {
  rows: Record<string, Row[]>

  constructor(rows: Record<string, Row[]>) {
    this.rows = rows
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'select' | 'insert' | 'update' | 'upsert' = 'select'
  private payload: Row | Row[] | null = null
  private singleResult = false
  private limitCount: number | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select(_columns = '*') {
    return this
  }

  insert(payload: Row | Row[]) {
    this.operation = 'insert'
    this.payload = payload
    return this
  }

  update(payload: Row) {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  upsert(payload: Row | Row[], _options?: unknown) {
    this.operation = 'upsert'
    this.payload = payload
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value)
    return this
  }

  gt(field: string, value: unknown) {
    this.filters.push((row) => String(row[field] ?? '') > String(value))
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  single() {
    this.singleResult = true
    return this.executeSingle()
  }

  maybeSingle() {
    return this.executeSingle()
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected)
  }

  private async executeSingle() {
    const result = await this.execute()
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: null }
  }

  private async execute() {
    const tableRows = this.db.rows[this.table]

    if (this.operation === 'insert') {
      const inserted = (Array.isArray(this.payload) ? this.payload : [this.payload])
        .filter(Boolean)
        .map((payload) => {
          const row = {
            id: `${this.table}-${tableRows.length + 1}`,
            created_at: new Date().toISOString(),
            ...(payload as Row),
          }
          tableRows.push(row)
          return row
        })
      return { data: this.singleResult ? inserted[0] : inserted, error: null }
    }

    if (this.operation === 'update') {
      const updated: Row[] = []
      tableRows.forEach((row) => {
        if (!this.filters.every((filter) => filter(row))) return
        Object.assign(row, this.payload)
        updated.push(row)
      })
      return { data: updated, error: null }
    }

    if (this.operation === 'upsert') {
      const upserted = (Array.isArray(this.payload) ? this.payload : [this.payload])
        .filter(Boolean)
        .map((payload) => this.upsertRow(payload as Row))
      return { data: this.singleResult ? upserted[0] : upserted, error: null }
    }

    let rows = tableRows.filter((row) => this.filters.every((filter) => filter(row)))
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount)
    return { data: rows, error: null }
  }

  private upsertRow(payload: Row) {
    const rows = this.db.rows[this.table]
    const existing = rows.find((row) => (
      this.table === 'discovery_vendors' &&
      row.source === payload.source &&
      row.source_external_id === payload.source_external_id
    ))

    if (existing) {
      Object.assign(existing, payload)
      return existing
    }

    const row = {
      id: `${this.table}-${rows.length + 1}`,
      ...payload,
      created_at: new Date().toISOString(),
    }
    rows.push(row)
    return row
  }
}

describe('discovery freshness helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('records organizer reports as unapplied change-log rows and admin review tasks', async () => {
    const db = new MemoryDb({
      discovery_change_log: [],
      admin_tasks: [],
    })

    const report = await createOrganizerDiscoveryReport({
      admin: db,
      entityType: 'discovery_venue',
      entityId: 'venue-1',
      planId: 'plan-1',
      userId: 'user-1',
      category: 'wrong_contact',
      details: 'The email bounced.',
    })

    expect(report.id).toBe('discovery_change_log-1')
    expect(db.rows.discovery_change_log).toMatchObject([{
      entity_type: 'discovery_venue',
      entity_id: 'venue-1',
      source: 'organizer_report',
      field_name: 'contact_email',
      confidence: 0.3,
      actor_id: 'user-1',
      applied: false,
    }])
    expect(db.rows.admin_tasks).toHaveLength(1)
    expect(db.rows.admin_tasks[0]).toMatchObject({
      plan_id: 'plan-1',
      task_type: 'catalog_gap',
      status: 'open',
      priority: 'normal',
    })
  })

  it('mirrors vendor self-service updates, stores cents, and cascades location changes', async () => {
    const db = new MemoryDb({
      vendor_profiles: [{
        id: 'vendor-1',
        user_id: 'user-1',
        name: 'Old Catering',
        service_type: 'catering',
        service_area: 'sf_only',
        regions_served: 'sf_only',
        base_rate: 900,
        discovery_vendor_id: null,
      }],
      discovery_vendors: [],
      discovery_change_log: [],
    })

    const result = await recordVendorProfileSelfUpdate({
      admin: db,
      vendorId: 'vendor-1',
      actorId: 'user-1',
      previous: {
        name: 'Old Catering',
        service_type: 'catering',
        service_area: 'sf_only',
        regions_served: 'sf_only',
        base_rate: 900,
      },
      next: {
        name: 'New Catering',
        service_type: 'catering',
        service_area: 'east_bay',
        regions_served: 'east_bay',
        base_rate: 1250,
      },
    })

    expect(result.discoveryVendorId).toBe('discovery_vendors-1')
    expect(result.changes).toBe(4)
    expect(db.rows.vendor_profiles[0].discovery_vendor_id).toBe('discovery_vendors-1')
    expect(db.rows.discovery_vendors[0]).toMatchObject({
      name: 'New Catering',
      service_type: 'catering',
      inferred_package_rate_cents: 125000,
      rate_inference_admin_status: 'pending',
      data_freshness_status: 'changed',
    })
    expect(db.rows.discovery_change_log.map((row) => row.field_name)).toEqual([
      'name',
      'service_area',
      'regions_served',
      'base_rate',
    ])
    expect(db.rows.discovery_change_log.find((row) => row.field_name === 'base_rate')).toMatchObject({
      old_value: 90000,
      new_value: 125000,
      source: 'vendor_self_update',
      applied: true,
    })
    expect(cascadeInvalidationForEntityChange).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'discovery_vendor',
      entityId: 'discovery_vendors-1',
      changedField: 'service_area',
      source: 'vendor_self_update',
    }))
  })

  it('dedupes Stripe account freshness rows inside the five-minute delivery window', async () => {
    const db = new MemoryDb({
      discovery_change_log: [{
        id: 'existing',
        entity_type: 'discovery_venue',
        entity_id: 'venue-1',
        source: 'stripe_account_event',
        field_name: 'stripe_connect_status',
        created_at: new Date().toISOString(),
      }],
    })

    const result = await recordStripeAccountDiscoveryFreshness({
      admin: db,
      entityType: 'discovery_venue',
      entityId: 'venue-1',
      accountId: 'acct_123',
      eventId: 'evt_1',
      previousStatus: 'active',
      nextStatus: 'restricted',
      account: {
        id: 'acct_123',
        object: 'account',
        charges_enabled: false,
        payouts_enabled: false,
        requirements: { disabled_reason: 'requirements.past_due' },
      } as any,
      shouldCascade: true,
    })

    expect(result).toEqual({ inserted: false, cascaded: false })
    expect(db.rows.discovery_change_log).toHaveLength(1)
    expect(cascadeInvalidationForEntityChange).not.toHaveBeenCalled()
  })
})
