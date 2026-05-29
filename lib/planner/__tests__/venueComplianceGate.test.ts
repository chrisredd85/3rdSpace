jest.mock('server-only', () => ({}))

import { getVenueComplianceStatus } from '@/lib/planner/venueComplianceGate'

type Row = Record<string, unknown>

class MemoryDb {
  rows: Record<string, Row[]> = {
    event_kickback_agreements: [],
    kickback_payments: [],
    events: [],
    plans: [],
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []

  constructor(private db: MemoryDb, private table: string) {}

  select(_columns = '*') {
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

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({
      data: (this.db.rows[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row))),
      error: null,
    }).then(onfulfilled, onrejected)
  }
}

describe('getVenueComplianceStatus', () => {
  it('blocks venues with three overdue unreported or unpaid kickbacks', async () => {
    const db = new MemoryDb()
    db.rows.event_kickback_agreements = [
      { id: 'agreement-1', venue_id: 'venue-1', event_id: 'event-1', plan_id: null, reported_revenue_cents: null },
      { id: 'agreement-2', venue_id: 'venue-1', event_id: 'event-2', plan_id: null, reported_revenue_cents: 400000 },
      { id: 'agreement-3', venue_id: 'venue-1', event_id: null, plan_id: 'plan-3', reported_revenue_cents: null },
      { id: 'agreement-4', venue_id: 'venue-1', event_id: 'event-4', plan_id: null, reported_revenue_cents: null },
    ]
    db.rows.kickback_payments = [
      { id: 'payment-1', agreement_id: 'agreement-1', status: 'pending_venue_approval', paid_at: null, due_date: null },
      { id: 'payment-2', agreement_id: 'agreement-2', status: 'invoice_sent', paid_at: null, due_date: '2026-01-20T00:00:00.000Z' },
      { id: 'payment-3', agreement_id: 'agreement-3', status: 'pending_venue_approval', paid_at: null, due_date: null },
      { id: 'payment-4', agreement_id: 'agreement-4', status: 'paid', paid_at: '2026-01-25T00:00:00.000Z', due_date: null },
    ]
    db.rows.events = [
      { id: 'event-1', event_date: '2026-01-01T00:00:00.000Z' },
      { id: 'event-2', event_date: '2026-01-02T00:00:00.000Z' },
      { id: 'event-4', event_date: '2026-01-04T00:00:00.000Z' },
    ]
    db.rows.plans = [{ id: 'plan-3', date_window_start: '2026-01-03T00:00:00.000Z' }]

    const status = await getVenueComplianceStatus(db as never, 'venue-1')

    expect(status).toMatchObject({
      is_compliant: false,
      overdue_count: 3,
      overdue_threshold: 3,
      oldest_overdue_event_date: '2026-01-01T00:00:00.000Z',
    })
    expect(status.reason).toContain('3 overdue revenue reports')
  })

  it('restores compliance once overdue count drops below threshold', async () => {
    const db = new MemoryDb()
    db.rows.event_kickback_agreements = [
      { id: 'agreement-1', venue_id: 'venue-1', event_id: 'event-1', plan_id: null, reported_revenue_cents: 100000 },
      { id: 'agreement-2', venue_id: 'venue-1', event_id: 'event-2', plan_id: null, reported_revenue_cents: null },
    ]
    db.rows.kickback_payments = [
      { id: 'payment-1', agreement_id: 'agreement-1', status: 'pending_venue_approval', paid_at: null, due_date: null },
      { id: 'payment-2', agreement_id: 'agreement-2', status: 'pending_venue_approval', paid_at: null, due_date: null },
    ]
    db.rows.events = [
      { id: 'event-1', event_date: '2026-01-01T00:00:00.000Z' },
      { id: 'event-2', event_date: '2026-01-02T00:00:00.000Z' },
    ]

    const status = await getVenueComplianceStatus(db as never, 'venue-1')

    expect(status).toMatchObject({
      is_compliant: true,
      overdue_count: 1,
      reason: null,
    })
  })
})
