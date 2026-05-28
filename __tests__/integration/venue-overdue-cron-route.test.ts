jest.mock('server-only', () => ({}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => {
      const headers = new Headers(init?.headers)
      headers.set('content-type', 'application/json')
      return new Response(JSON.stringify(data), {
        ...init,
        status: init?.status ?? 200,
        headers,
      })
    },
  },
}))

import { GET } from '@/app/api/internal/cron/venue-overdue-check/route'
import { sendVenueOverdueWarningEmail } from '@/lib/email'
import { createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/email', () => ({
  sendVenueOverdueWarningEmail: jest.fn().mockResolvedValue({ sent: true, reason: null }),
}))

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))

type Row = Record<string, unknown>

class MemoryDb {
  rows: Record<string, Row[]> = {
    venues: [
      { id: 'venue-1', venue_name: 'The Roof', last_overdue_count_notified: 2, created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'venue-2', venue_name: 'Bar Down', last_overdue_count_notified: 3, created_at: '2026-01-02T00:00:00.000Z' },
    ],
    event_kickback_agreements: [
      { id: 'agreement-1', venue_id: 'venue-1', event_id: 'event-1', plan_id: null, reported_revenue_cents: null },
      { id: 'agreement-2', venue_id: 'venue-1', event_id: 'event-2', plan_id: null, reported_revenue_cents: null },
      { id: 'agreement-3', venue_id: 'venue-1', event_id: 'event-3', plan_id: null, reported_revenue_cents: null },
      { id: 'agreement-4', venue_id: 'venue-2', event_id: 'event-4', plan_id: null, reported_revenue_cents: null },
      { id: 'agreement-5', venue_id: 'venue-2', event_id: 'event-5', plan_id: null, reported_revenue_cents: null },
    ],
    kickback_payments: [
      { id: 'payment-1', agreement_id: 'agreement-1', status: 'pending_venue_approval', paid_at: null, due_date: null },
      { id: 'payment-2', agreement_id: 'agreement-2', status: 'pending_venue_approval', paid_at: null, due_date: null },
      { id: 'payment-3', agreement_id: 'agreement-3', status: 'pending_venue_approval', paid_at: null, due_date: null },
      { id: 'payment-4', agreement_id: 'agreement-4', status: 'pending_venue_approval', paid_at: null, due_date: null },
      { id: 'payment-5', agreement_id: 'agreement-5', status: 'pending_venue_approval', paid_at: null, due_date: null },
    ],
    events: [
      { id: 'event-1', event_date: '2026-01-01T00:00:00.000Z' },
      { id: 'event-2', event_date: '2026-01-02T00:00:00.000Z' },
      { id: 'event-3', event_date: '2026-01-03T00:00:00.000Z' },
      { id: 'event-4', event_date: '2026-01-04T00:00:00.000Z' },
      { id: 'event-5', event_date: '2026-01-05T00:00:00.000Z' },
    ],
    plans: [],
  }

  from(table: string) {
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'select' | 'update' = 'select'
  private payload: Row | null = null
  private orderField: string | null = null
  private ascending = true

  constructor(private db: MemoryDb, private table: string) {}

  select(_columns = '*') {
    return this
  }

  update(payload: Row) {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value)
    return this
  }

  in(field: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[field]))
    return this
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderField = field
    this.ascending = options?.ascending ?? true
    return this
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private execute() {
    if (this.operation === 'update') {
      const rows = this.applyFilters()
      rows.forEach((row) => Object.assign(row, this.payload))
      return { data: rows, error: null }
    }

    return { data: this.applyFilters(), error: null }
  }

  private applyFilters() {
    let rows = (this.db.rows[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)))
    if (this.orderField) {
      rows = [...rows].sort((first, second) => {
        const firstValue = String(first[this.orderField!] ?? '')
        const secondValue = String(second[this.orderField!] ?? '')
        return this.ascending ? firstValue.localeCompare(secondValue) : secondValue.localeCompare(firstValue)
      })
    }
    return rows
  }
}

function makeRequest(secret: string | null) {
  return {
    headers: new Headers(secret ? { authorization: `Bearer ${secret}` } : {}),
  } as never
}

describe('GET /api/internal/cron/venue-overdue-check', () => {
  const originalSecret = process.env.CRON_SECRET
  let db: MemoryDb

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
    db = new MemoryDb()
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret
  })

  it('rejects requests without the cron bearer secret', async () => {
    const response = await GET(makeRequest(null))

    expect(response.status).toBe(401)
    expect(sendVenueOverdueWarningEmail).not.toHaveBeenCalled()
  })

  it('notifies venues that cross overdue thresholds and stores the current count', async () => {
    const response = await GET(makeRequest('cron-secret'))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      ok: true,
      scanned: 2,
      notified: 1,
      updated: 2,
      failed: 0,
    })
    expect(sendVenueOverdueWarningEmail).toHaveBeenCalledTimes(1)
    expect(sendVenueOverdueWarningEmail).toHaveBeenCalledWith({
      venueId: 'venue-1',
      overdueCount: 3,
    })
    expect(db.rows.venues).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'venue-1', last_overdue_count_notified: 3 }),
      expect.objectContaining({ id: 'venue-2', last_overdue_count_notified: 2 }),
    ]))
  })
})
