jest.mock('server-only', () => ({}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data), {
      ...init,
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  },
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/supabase/server-helpers', () => ({
  getBuilderProfileId: jest.fn(),
}))

jest.mock('@/lib/finance/calculate-event-financials', () => ({
  recalculateEventFinancials: jest.fn(),
}))

import type { NextRequest } from 'next/server'
import { POST } from '@/app/api/planner/events/import/[importId]/finalize/route'
import { recalculateEventFinancials } from '@/lib/finance/calculate-event-financials'
import { computeEventActuals } from '@/lib/finance/eventActuals'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

type Row = Record<string, any>
type AggregateSource = 'screenshot' | 'manual'
type RecalculationInput = { sales: Row[]; attendees: Row[] }
type QueryResult = { data: Row[]; error: { message: string } | null }

const EVENT_ID = 'event-1'
const IMPORT_ID = 'import-1'
const BUILDER_ID = 'builder-1'
const INTEGRATION_ID = 'integration-1'
const SOURCES: AggregateSource[] = ['screenshot', 'manual']
const realRecalculate = jest.requireActual<typeof import('@/lib/finance/calculate-event-financials')>(
  '@/lib/finance/calculate-event-financials'
).recalculateEventFinancials

// Both representations describe the same two $25 tickets: 2 tickets / $50 total.
const SALES_TOTALS = { tickets_sold: 2, gross_revenue_cents: 5000 }

describe('event import finalization source conflicts', () => {
  let db: MemoryDb
  let recalculationInputs: RecalculationInput[]

  beforeEach(() => {
    jest.clearAllMocks()
    db = new MemoryDb()
    recalculationInputs = []
    ;(createClient as jest.Mock).mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1', user_metadata: { user_type: 'community_builder' } } },
          error: null,
        }),
      },
    })
    ;(getBuilderProfileId as jest.Mock).mockResolvedValue({ builderProfileId: BUILDER_ID, error: null })
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
    ;(recalculateEventFinancials as jest.Mock).mockImplementation(async (client, eventId) => {
      expect(client).toBe(db)
      expect(eventId).toBe(EVENT_ID)
      recalculationInputs.push(clone({
        sales: db.rows.event_sales_data.filter((row) => row.event_id === eventId),
        attendees: db.rows.imported_attendees.filter((row) => row.event_id === eventId),
      }))
      return realRecalculate(client, eventId)
    })
  })

  async function finalize(payload: Row, body: Row = {}) {
    db.rows.event_import_sessions[0].payload = {
      event: { event_name: 'Staged event', event_date: '2026-09-30', expected_attendance: 2 },
      ...payload,
    }
    const before = clone(db.rows)
    const response = await POST(new Request('http://localhost/api/planner/events/import/import-1/finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: { event_name: 'Finalized event' }, ...body }),
    }) as NextRequest, { params: Promise.resolve({ importId: IMPORT_ID }) })
    return { response, body: await response.json(), before }
  }

  function expectConflict(result: Awaited<ReturnType<typeof finalize>>, domains: string[]) {
    // These assertions precede the status assertion so the regression proves the
    // failure is before every mutation, including event/integration/session writes.
    expect(db.mutation).not.toHaveBeenCalled()
    expect(db.rows).toEqual(result.before)
    expect(recalculateEventFinancials).not.toHaveBeenCalled()
    expect(recalculationInputs).toEqual([])
    expect(result.response.status).toBe(409)
    expect(result.body).toMatchObject({
      code: 'IMPORT_SOURCE_CONFLICT',
      conflicting_domains: domains,
      error: expect.any(String),
    })
    expect(result.body.error).toMatch(/choose|select/i)
    expect(result.body.error).toMatch(/source/i)
  }

  function expectSuccessfulImport(
    result: Awaited<ReturnType<typeof finalize>>,
    expected: {
      sales: 'detail' | 'aggregate' | 'none'
      attendees: 'detail' | 'aggregate' | 'none'
      written?: { sales: number; attendees: number }
    }
  ) {
    expect(result.response.status).toBe(200)
    expect(recalculateEventFinancials).toHaveBeenCalledTimes(1)
    expect(recalculationInputs).toHaveLength(1)
    const input = recalculationInputs[0]
    for (const domain of ['sales', 'attendees'] as const) {
      const rows = input[domain]
      const aggregate = rows.filter((row) => row.raw_data?.aggregate_row === true)
      const detail = rows.filter((row) => row.raw_data?.aggregate_row !== true)
      expect(aggregate.length > 0 && detail.length > 0).toBe(false)
      if (expected[domain] === 'none') expect(rows).toEqual([])
      if (expected[domain] === 'detail') {
        expect(detail.length).toBeGreaterThan(0)
        expect(aggregate).toEqual([])
      }
      if (expected[domain] === 'aggregate') {
        expect(aggregate.length).toBeGreaterThan(0)
        expect(detail).toEqual([])
      }
      rows.forEach((row) => expect(row).toMatchObject({ event_id: EVENT_ID, integration_id: INTEGRATION_ID }))
    }
    expect(result.body).toMatchObject({
      eventId: EVENT_ID,
      importId: IMPORT_ID,
      attendeesWritten: expected.written?.attendees ?? input.attendees.length,
      salesWritten: expected.written?.sales ?? input.sales.length,
      redirectUrl: `/planner/events/${EVENT_ID}/report`,
    })
    expect(db.rows.event_import_sessions[0]).toMatchObject({ status: 'finalized' })
    expect(db.rows.events[0].event_name).toBe('Finalized event')
    expect(db.rows.event_financial_summary).toHaveLength(1)
    if (expected.sales !== 'none') {
      expect(input.sales).toHaveLength(1)
      expect(input.sales[0]).toMatchObject({ ticket_quantity: 2, total_amount_cents: 5000, is_refund: false })
      // The real calculator reads the just-written rows: 2 × $25 = $50, not 4 / $100.
      expect(db.rows.event_financial_summary[0]).toMatchObject({
        tickets_sold: 2,
        gross_revenue: 50,
        total_refunds: 0,
        net_revenue: 50,
        average_ticket_price: 25,
      })
    }
    return input
  }

  describe.each(SOURCES)('%s aggregate source', (source) => {
    it('rejects itemized two-ticket/$50 sales plus the same aggregate before any writes', async () => {
      const staged = stageAggregate(source, SALES_TOTALS, { sales: detailSales() })
      expectConflict(await finalize(staged.payload, staged.body), ['sales'])
    })

    it('rejects itemized sales plus refund-only aggregate before any writes', async () => {
      const staged = stageAggregate(source, { refunds_cents: 2500 }, { sales: detailSales() })
      expectConflict(await finalize(staged.payload, staged.body), ['sales'])
    })

    it('rejects detailed checked-in attendees plus aggregate check-ins before any writes', async () => {
      const staged = stageAggregate(source, { checked_in_count: 1 }, { attendees: detailAttendees() })
      expectConflict(await finalize(staged.payload, staged.body), ['attendees', 'check_ins'])
    })

    it('rejects attendee detail even when no detailed attendee is checked in', async () => {
      const attendees = detailAttendees().map((row) => ({ ...row, checked_in: false }))
      const staged = stageAggregate(source, { checked_in_count: 1 }, { attendees })
      expectConflict(await finalize(staged.payload, staged.body), ['attendees'])
    })

    it('returns every conflicting domain in stable order without changing any table', async () => {
      const staged = stageAggregate(source, { ...SALES_TOTALS, checked_in_count: 1 }, {
        sales: detailSales(),
        attendees: detailAttendees(),
      })
      expectConflict(await finalize(staged.payload, staged.body), ['sales', 'attendees', 'check_ins'])
    })

    it('allows attendee detail and aggregate sales, retaining only one sales source at recalculation', async () => {
      const staged = stageAggregate(source, SALES_TOTALS, { attendees: detailAttendees() })
      const input = expectSuccessfulImport(await finalize(staged.payload, staged.body), {
        sales: 'aggregate', attendees: 'detail',
      })
      expect(input.attendees).toHaveLength(2)
      expect(input.attendees.filter((row) => row.checked_in)).toHaveLength(1)
      expect(input.attendees.map((row) => row.external_attendee_id)).toEqual(['posh:guest-1', 'posh:guest-2'])
    })

    it('allows sales detail and aggregate check-ins without adding synthetic sales', async () => {
      const staged = stageAggregate(source, { checked_in_count: 1 }, { sales: detailSales() })
      const input = expectSuccessfulImport(await finalize(staged.payload, staged.body), {
        sales: 'detail', attendees: 'aggregate',
      })
      expect(input.sales[0].order_id).toBe('posh:order-1')
      expect(input.attendees).toHaveLength(1)
      expect(input.attendees[0].checked_in).toBe(true)
    })

    it('allows aggregate-only sales and check-ins without duplicate rows', async () => {
      const staged = stageAggregate(source, { ...SALES_TOTALS, checked_in_count: 1 })
      const input = expectSuccessfulImport(await finalize(staged.payload, staged.body), {
        sales: 'aggregate', attendees: 'aggregate',
      })
      expect(input.attendees).toHaveLength(1)
      expect(input.attendees[0].checked_in).toBe(true)
    })

    it.each([
      { label: 'partial', refundCents: 1000, netCents: 4000 },
      { label: 'full monetary', refundCents: 5000, netCents: 0 },
    ])('reduces revenue for a $label aggregate refund without inferring ticket cancellation', async ({ refundCents, netCents }) => {
      const staged = stageAggregate(source, {
        ...SALES_TOTALS,
        refunds_cents: refundCents,
        checked_in_count: 1,
      })
      const result = await finalize(staged.payload, staged.body)

      expect(result.response.status).toBe(200)
      expect(result.body.salesWritten).toBe(2)
      expect(recalculateEventFinancials).toHaveBeenCalledTimes(1)
      expect(db.rows.event_sales_data).toHaveLength(2)
      const actuals = await computeEventActuals(db, EVENT_ID)

      // Two $25 tickets minus a $10/$50 refund leaves $40/$0. The refund
      // amount alone does not establish that either ticket was canceled.
      expect({ summary: db.rows.event_financial_summary[0], actuals }).toMatchObject({
        summary: {
          tickets_sold: 2,
          current_attendance: 2,
          gross_revenue: 50,
          total_refunds: refundCents / 100,
          net_revenue: netCents / 100,
        },
        actuals: {
          tickets_sold: 2,
          tickets_refunded: 0,
          tickets_checked_in: 1,
          gross_revenue_cents: 5000,
          refunds_cents: refundCents,
          net_revenue_cents: netCents,
        },
      })
    })

    it('does not reject or synthesize rows for explicit zero totals alongside detail', async () => {
      const staged = stageAggregate(source, {
        tickets_sold: 0, gross_revenue_cents: 0, refunds_cents: 0, checked_in_count: 0,
      }, { sales: detailSales(), attendees: detailAttendees() })
      const input = expectSuccessfulImport(await finalize(staged.payload, staged.body), {
        sales: 'detail', attendees: 'detail',
      })
      expect(input.attendees).toHaveLength(2)
      expect(input.attendees.filter((row) => row.checked_in)).toHaveLength(1)
    })

    it('accepts an aggregate-only zero report without inventing a ticket or attendee', async () => {
      const staged = stageAggregate(source, {
        tickets_sold: 0, gross_revenue_cents: 0, refunds_cents: 0, checked_in_count: 0,
      })
      expectSuccessfulImport(await finalize(staged.payload, staged.body), { sales: 'none', attendees: 'none' })
      expect(db.rows.event_financial_summary[0]).toMatchObject({ tickets_sold: 0, gross_revenue: 0, net_revenue: 0 })
    })
  })

  it('allows detail-only sales and attendees with exact rows at recalculation', async () => {
    const input = expectSuccessfulImport(await finalize({ sales: detailSales(), attendees: detailAttendees() }), {
      sales: 'detail', attendees: 'detail',
    })
    expect(input.sales[0].order_id).toBe('posh:order-1')
    expect(input.attendees).toHaveLength(2)
    expect(input.attendees.filter((row) => row.checked_in)).toHaveLength(1)
  })

  describe.each([
    { domain: 'sales', table: 'event_sales_data', detail: detailSales, aggregate: aggregateSales, totals: SALES_TOTALS, conflicts: ['sales'] },
    { domain: 'attendees', table: 'imported_attendees', detail: detailAttendees, aggregate: aggregateAttendees, totals: { checked_in_count: 1 }, conflicts: ['attendees', 'check_ins'] },
  ])('persisted $domain', ({ domain, table, detail, aggregate, totals, conflicts }) => {
    it('rejects new detail when aggregate rows already exist for the event', async () => {
      db.rows[table] = persisted(aggregate())
      expectConflict(await finalize({ [domain]: detail() }), conflicts)
    })

    it('rejects new aggregates when detail rows already exist for the event', async () => {
      db.rows[table] = persisted(detail())
      expectConflict(await finalize({}, { gap_fill: totals }), conflicts)
    })

    it('rejects pre-existing overlap even without incoming rows', async () => {
      db.rows[table] = persisted([...detail(), ...aggregate()])
      expectConflict(await finalize({}), conflicts)
    })

    it('finds overlap beyond a short server page and reads through the empty page', async () => {
      // A one-row server cap is below the route's requested 1,000-row page.
      // The conflicting aggregate is behind a compatible detail row.
      db.pageSize = 1
      db.rows[table] = persisted([detail()[0], ...aggregate()])
      expectConflict(await finalize({ [domain]: detail() }), conflicts)
      expect(db.rangeRead.mock.calls.filter(([readTable]) => readTable === table)).toEqual([
        [table, 0, 999], [table, 1, 1000], [table, 2, 1001],
      ])
    })

    it('stops before every write if the persisted-row read fails', async () => {
      db.readErrors[table] = 'Import source preflight unavailable'
      const result = await finalize({ sales: detailSales(), attendees: detailAttendees() })
      expect(db.mutation).not.toHaveBeenCalled()
      expect(db.rows).toEqual(result.before)
      expect(recalculateEventFinancials).not.toHaveBeenCalled()
      expect(recalculationInputs).toEqual([])
      expect(result.response.status).toBe(500)
      expect(result.body.error).toEqual(expect.any(String))
    })
  })

  it('rejects detail staged after a completed manual aggregate import, even when gap_fill is omitted', async () => {
    expectSuccessfulImport(await finalize({}, { gap_fill: { ...SALES_TOTALS, checked_in_count: 1 } }), {
      sales: 'aggregate', attendees: 'aggregate',
    })
    db.mutation.mockClear()
    ;(recalculateEventFinancials as jest.Mock).mockClear()
    recalculationInputs.length = 0
    expectConflict(await finalize({ sales: detailSales(), attendees: detailAttendees() }), ['sales', 'attendees', 'check_ins'])
  })

  it.each(['detail', 'aggregate'] as const)('allows a same-%s retry without duplicating saved rows', async (source) => {
    const payload = source === 'detail' ? { sales: detailSales(), attendees: detailAttendees() } : {}
    const body = source === 'aggregate' ? { gap_fill: { ...SALES_TOTALS, checked_in_count: 1 } } : {}
    const first = expectSuccessfulImport(await finalize(payload, body), { sales: source, attendees: source })
    ;(recalculateEventFinancials as jest.Mock).mockClear()
    recalculationInputs.length = 0
    const retry = expectSuccessfulImport(await finalize(payload, body), { sales: source, attendees: source })
    expect(retry.sales.map((row) => row.order_id)).toEqual(first.sales.map((row) => row.order_id))
    expect(retry.attendees.map((row) => row.external_attendee_id)).toEqual(first.attendees.map((row) => row.external_attendee_id))
  })

  it('allows new attendee detail alongside saved aggregate sales', async () => {
    db.rows.event_sales_data = persisted(aggregateSales())
    const input = expectSuccessfulImport(await finalize({ attendees: detailAttendees() }), {
      sales: 'aggregate', attendees: 'detail', written: { sales: 0, attendees: 2 },
    })
    expect(input.attendees).toHaveLength(2)
    expect(input.attendees.filter((row) => row.checked_in)).toHaveLength(1)
  })

  it('allows new sales detail alongside saved aggregate check-ins', async () => {
    db.rows.imported_attendees = persisted(aggregateAttendees())
    const input = expectSuccessfulImport(await finalize({ sales: detailSales() }), {
      sales: 'detail', attendees: 'aggregate', written: { sales: 1, attendees: 0 },
    })
    expect(input.attendees).toHaveLength(1)
    expect(input.attendees[0].checked_in).toBe(true)
  })

  it('ignores opposite representations belonging to another event', async () => {
    db.rows.event_sales_data = persisted(aggregateSales()).map((row) => ({ ...row, event_id: 'other-event' }))
    db.rows.imported_attendees = persisted(aggregateAttendees()).map((row) => ({ ...row, event_id: 'other-event', integration_id: 'other-integration' }))
    const input = expectSuccessfulImport(await finalize({ sales: detailSales(), attendees: detailAttendees() }), {
      sales: 'detail', attendees: 'detail',
    })
    expect(input.attendees).toHaveLength(2)
    expect(db.rows.event_sales_data).toHaveLength(2)
    expect(db.rows.imported_attendees).toHaveLength(3)
  })

  it('treats an unmarked persisted sale as detail instead of assuming it is safely disjoint', async () => {
    db.rows.event_sales_data = persisted(detailSales()).map((row) => ({ ...row, raw_data: null }))
    expectConflict(await finalize({}, { gap_fill: SALES_TOTALS }), ['sales'])
  })
})

function stageAggregate(source: AggregateSource, totals: Row, detail: Row = {}) {
  return source === 'screenshot'
    ? { payload: { ...detail, screenshot_extraction: totals }, body: {} }
    : { payload: detail, body: { gap_fill: totals } }
}

function detailSales(): Row[] {
  return [{
    order_id: 'posh:order-1', platform: 'posh', ticket_quantity: 2,
    ticket_price_cents: 2500, total_amount_cents: 5000, total_amount: 50,
    fees_cents: 0, fees: 0, is_refund: false, source: 'csv_import',
    raw_data: { order_id: 'order-1' },
  }]
}

function detailAttendees(): Row[] {
  return [true, false].map((checkedIn, index) => ({
    external_attendee_id: `posh:guest-${index + 1}`,
    email: `guest-${index + 1}@example.com`,
    checked_in: checkedIn,
    raw_data: { guest_id: `guest-${index + 1}` },
  }))
}

function aggregateSales(): Row[] {
  return [{
    ...detailSales()[0],
    order_id: `posh:aggregate-sale:${IMPORT_ID}`,
    source: 'manual_gap_fill',
    raw_data: { aggregate_row: true, import_session_id: IMPORT_ID, source: 'posh' },
  }]
}

function aggregateAttendees(): Row[] {
  return [{
    external_attendee_id: `posh:aggregate-checkin:${IMPORT_ID}:1`,
    checked_in: true,
    raw_data: { aggregate_row: true, import_session_id: IMPORT_ID, source: 'posh' },
  }]
}

function persisted(rows: Row[]): Row[] {
  return rows.map((row, index) => ({ id: `saved-${index + 1}`, event_id: EVENT_ID, integration_id: INTEGRATION_ID, ...row }))
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

class MemoryDb {
  // One journal catches mutation attempts on every table, even an unawaited query.
  mutation = jest.fn()
  rangeRead = jest.fn()
  readErrors: Record<string, string> = {}
  pageSize = Infinity
  rows: Record<string, Row[]> = {
    events: [{ id: EVENT_ID, event_name: 'Original event', expected_attendance: 2, venue_id: null }],
    event_import_sessions: [{
      id: IMPORT_ID, builder_id: BUILDER_ID, event_id: EVENT_ID,
      source: 'posh', event_url: 'https://posh.vip/e/example', status: 'ready', payload: {},
    }],
    external_event_integrations: [{ id: INTEGRATION_ID, event_id: EVENT_ID, platform: 'posh', sync_status: 'pending' }],
    event_sales_data: [],
    imported_attendees: [],
    venue_bookings: [],
    vendor_bookings: [],
    event_kickback_agreements: [],
    event_revenue_terms: [],
    event_financial_summary: [{ event_id: EVENT_ID, gross_revenue: 999 }],
  }

  from(table: string) {
    if (!this.rows[table]) throw new Error(`Unexpected table: ${table}`)
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery implements PromiseLike<QueryResult> {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'insert' | 'upsert' | 'update' | 'delete' | null = null
  private values: Row[] = []
  private conflictKeys: string[] = []
  private orderBy: { field: string; ascending: boolean } | null = null
  private page: { start: number; end: number } | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select() { return this }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value)
    return this
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderBy = { field, ascending: options?.ascending ?? true }
    return this
  }

  range(start: number, end: number) {
    this.db.rangeRead(this.table, start, end)
    this.page = { start, end }
    return this
  }

  insert(value: Row | Row[]) { return this.recordMutation('insert', value) }
  update(value: Row) { return this.recordMutation('update', value) }
  delete() { return this.recordMutation('delete', []) }

  upsert(value: Row | Row[], options?: { onConflict?: string }) {
    this.conflictKeys = options?.onConflict?.split(',').map((key) => key.trim()) ?? []
    return this.recordMutation('upsert', value)
  }

  private recordMutation(operation: NonNullable<MemoryQuery['operation']>, value: Row | Row[]) {
    this.db.mutation(this.table, operation, clone(value))
    this.operation = operation
    this.values = clone(Array.isArray(value) ? value : [value])
    return this
  }

  async maybeSingle() {
    const result = this.execute()
    return { data: result.data[0] ?? null, error: result.error }
  }
  async single() { return this.maybeSingle() }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private execute(): QueryResult {
    if (!this.operation && this.db.readErrors[this.table]) {
      return { data: [], error: { message: this.db.readErrors[this.table] } }
    }
    const target = this.db.rows[this.table]
    let matching = target.filter((row) => this.filters.every((filter) => filter(row)))
    if (this.orderBy) {
      const { field, ascending } = this.orderBy
      matching.sort((left, right) => String(left[field]).localeCompare(String(right[field])) * (ascending ? 1 : -1))
    }
    if (this.page) matching = matching.slice(this.page.start, Math.min(this.page.end + 1, this.page.start + this.db.pageSize))
    if (this.operation === 'update') matching.forEach((row) => Object.assign(row, this.values[0]))
    if (this.operation === 'delete') this.db.rows[this.table] = target.filter((row) => !matching.includes(row))
    if (this.operation === 'insert' || this.operation === 'upsert') {
      const written = this.values.map((value) => {
        const existing = this.operation === 'upsert' && this.conflictKeys.length > 0
          ? target.find((row) => this.conflictKeys.every((key) => row[key] === value[key]))
          : undefined
        if (existing) {
          Object.assign(existing, value)
          return existing
        }
        const row = { id: `${this.table}-${target.length + 1}`, ...value }
        target.push(row)
        return row
      })
      return { data: clone(written), error: null }
    }
    return { data: clone(matching), error: null }
  }
}
