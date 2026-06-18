import { recalculateEventFinancials } from '@/lib/finance/calculate-event-financials'

const EVENT_ID = 'event-consumption-profit'

describe('recalculateEventFinancials', () => {
  it('includes venue consumption and CHI projections in expected profit', async () => {
    const db = new MemorySupabase({
      events: [{ id: EVENT_ID, expected_attendance: 100, venue_id: 'venue-1' }],
      event_sales_data: [
        {
          event_id: EVENT_ID,
          ticket_quantity: 10,
          total_amount: 1000,
          fees: 50,
          is_refund: false,
        },
      ],
      venue_bookings: [{ event_id: EVENT_ID, final_price: 400, quoted_price: null }],
      vendor_bookings: [{ event_id: EVENT_ID, final_price: 100, quoted_price: null }],
      event_kickback_agreements: [{ event_id: EVENT_ID, per_head_amount: 3 }],
      venues: [{ id: 'venue-1', ticket_sales_share_enabled: true, ticket_sales_share_percent: 10 }],
      event_financial_summary: [],
    })

    const metrics = await recalculateEventFinancials(db as never, EVENT_ID)

    expect(metrics.net_revenue).toBe(950)
    expect(metrics.venue_sales_share_projection).toBe(995)
    expect(metrics.venue_chi_projection).toBe(1019)
    expect(metrics.expected_profit).toBe(1469)
    expect(metrics.profit_margin).toBe(74.61)
    expect(db.rows.event_financial_summary[0]).toEqual(expect.objectContaining({
      event_id: EVENT_ID,
      expected_profit: 1469,
      venue_chi_projection: 1019,
    }))
  })
})

type Row = Record<string, unknown>

class MemorySupabase {
  rows: Record<string, Row[]>

  constructor(rows: Record<string, Row[]>) {
    this.rows = rows
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<{ column: string; value: unknown }> = []
  private pendingUpsert: Row | null = null

  constructor(private readonly db: MemorySupabase, private readonly table: string) {}

  select() {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value })
    return this
  }

  upsert(value: Row) {
    this.pendingUpsert = value
    return this
  }

  maybeSingle() {
    return Promise.resolve({
      data: this.applyFilters()[0] ?? null,
      error: null,
    })
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.resolve().then(onfulfilled, onrejected)
  }

  private async resolve() {
    if (this.pendingUpsert) {
      const rows = this.db.rows[this.table]
      const eventId = this.pendingUpsert.event_id
      const existingIndex = rows.findIndex((row) => row.event_id === eventId)
      if (existingIndex >= 0) rows[existingIndex] = { ...rows[existingIndex], ...this.pendingUpsert }
      else rows.push(this.pendingUpsert)
      return { data: this.pendingUpsert, error: null }
    }

    return {
      data: this.applyFilters(),
      error: null,
    }
  }

  private applyFilters() {
    return this.db.rows[this.table].filter((row) => (
      this.filters.every((filter) => row[filter.column] === filter.value)
    ))
  }
}
