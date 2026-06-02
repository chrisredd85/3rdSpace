import { computeEventActuals, computeEventPnL } from '@/lib/finance/eventActuals'

const eventId = '11111111-1111-4111-8111-111111111111'

describe('event actuals', () => {
  it('returns a zero-sales actuals and P&L shape', async () => {
    const db = new MemorySupabase({
      events: [{ id: eventId, expected_attendance: 100 }],
      event_sales_data: [],
      imported_attendees: [],
      event_cost_commitments: [],
    })

    const actuals = await computeEventActuals(db, eventId)
    const pnl = await computeEventPnL(db, eventId)

    expect(actuals).toEqual(expect.objectContaining({
      gross_revenue_cents: 0,
      refunds_cents: 0,
      platform_fees_cents: 0,
      taxes_collected_cents: 0,
      net_revenue_cents: 0,
      tickets_sold: 0,
      tickets_refunded: 0,
      tickets_checked_in: null,
      tier_breakdown: [],
      data_sources: [],
      confidence: { revenue: 'low', attendance: 'low' },
      last_event_at: null,
    }))
    expect(actuals.velocity).toEqual({
      last_24h_cents: 0,
      last_7d_cents: 0,
      since_launch_cents: 0,
      projected_sellout_at: null,
    })
    expect(pnl.net).toEqual({
      conservative_cents: 0,
      expected_cents: 0,
      optimistic_cents: 0,
    })
    expect(pnl.breakeven).toEqual({
      tickets_needed: 0,
      tickets_to_go: 0,
      crossed_at: null,
    })
  })

  it('computes high-confidence actuals from all-CSV sales and check-ins', async () => {
    const twoHoursAgo = isoHoursAgo(2)
    const tenDaysAgo = isoHoursAgo(24 * 10)
    const oneHourAgo = isoHoursAgo(1)
    const db = new MemorySupabase({
      events: [{ id: eventId, expected_attendance: 100 }],
      event_sales_data: [
        sale({
          source: 'csv_import',
          ticket_quantity: 2,
          ticket_tier_name: 'Early Bird',
          total_amount_cents: 10000,
          fees_cents: 500,
          purchase_timestamp: twoHoursAgo,
          raw_data: { quantity_total: 50 },
          field_confidence: {
            total_amount: { confidence: 'high', source: 'csv_import' },
          },
        }),
        sale({
          source: 'csv_import',
          ticket_quantity: 1,
          ticket_tier_name: 'VIP',
          total_amount_cents: 7000,
          fees_cents: 250,
          purchase_timestamp: tenDaysAgo,
          raw_data: { quantity_total: 10 },
          field_confidence: {
            total_amount: { confidence: 'high', source: 'csv_import' },
          },
        }),
      ],
      imported_attendees: [
        attendee({ checked_in: true, check_in_time: oneHourAgo }),
        attendee({ checked_in: true, check_in_time: oneHourAgo }),
        attendee({ checked_in: false, updated_at: oneHourAgo }),
      ],
      event_cost_commitments: [],
    })

    const actuals = await computeEventActuals(db, eventId)

    expect(actuals.gross_revenue_cents).toBe(17000)
    expect(actuals.platform_fees_cents).toBe(750)
    expect(actuals.net_revenue_cents).toBe(16250)
    expect(actuals.tickets_sold).toBe(3)
    expect(actuals.tickets_checked_in).toBe(2)
    expect(actuals.data_sources).toEqual(['csv_import'])
    expect(actuals.confidence).toEqual({ revenue: 'high', attendance: 'high' })
    expect(actuals.velocity.last_24h_cents).toBe(10000)
    expect(actuals.velocity.last_7d_cents).toBe(10000)
    expect(actuals.velocity.since_launch_cents).toBe(17000)
    expect(actuals.velocity.projected_sellout_at).toEqual(expect.any(String))
    expect(actuals.tier_breakdown).toEqual([
      { tier_name: 'Early Bird', sold: 2, gross_cents: 10000, sellout_pct: 0.04 },
      { tier_name: 'VIP', sold: 1, gross_cents: 7000, sellout_pct: 0.1 },
    ])
  })

  it('handles mixed sources, taxes, and medium confidence without inventing metrics', async () => {
    const db = new MemorySupabase({
      events: [{ id: eventId, expected_attendance: 80 }],
      event_sales_data: [
        sale({
          source: 'posh_webhook',
          ticket_quantity: 2,
          total_amount_cents: 10000,
          fees_cents: 500,
          raw_data: { tax_amount_cents: 800 },
          field_confidence: {
            total_amount: { confidence: 'high', source: 'posh_webhook' },
          },
        }),
        sale({
          source: 'screenshot_import',
          ticket_quantity: 1,
          total_amount_cents: 8000,
          fees_cents: 0,
          field_confidence: {
            gross_revenue_cents: { confidence: 'medium', source: 'screenshot' },
          },
        }),
        sale({
          source: 'manual_gap_fill',
          ticket_quantity: -1,
          total_amount_cents: -3000,
          is_refund: true,
          field_confidence: {
            refunds_cents: { confidence: 'low', source: 'manual_gap_fill' },
          },
        }),
      ],
      imported_attendees: [],
      event_cost_commitments: [],
    })

    const actuals = await computeEventActuals(db, eventId)

    expect(actuals.gross_revenue_cents).toBe(18000)
    expect(actuals.refunds_cents).toBe(3000)
    expect(actuals.platform_fees_cents).toBe(500)
    expect(actuals.taxes_collected_cents).toBe(800)
    expect(actuals.net_revenue_cents).toBe(13700)
    expect(actuals.data_sources).toEqual(['manual_gap_fill', 'posh_webhook', 'screenshot_import'])
    expect(actuals.confidence).toEqual({ revenue: 'medium', attendance: 'low' })
  })

  it('computes P&L and the timestamp where actual sales crossed breakeven', async () => {
    const firstSaleAt = '2026-06-01T18:00:00.000Z'
    const secondSaleAt = '2026-06-01T19:00:00.000Z'
    const db = new MemorySupabase({
      events: [{ id: eventId, expected_attendance: 10 }],
      event_sales_data: [
        sale({ total_amount_cents: 6000, purchase_timestamp: firstSaleAt }),
        sale({ total_amount_cents: 6000, purchase_timestamp: secondSaleAt }),
      ],
      imported_attendees: [],
      event_cost_commitments: [
        { event_id: eventId, state: 'accepted', amount_cents: 10000 },
      ],
    })

    const pnl = await computeEventPnL(db, eventId)

    expect(pnl.costs).toEqual({
      estimated_cents: 0,
      committed_cents: 10000,
      paid_cents: 0,
    })
    expect(pnl.net).toEqual({
      conservative_cents: 2000,
      expected_cents: 2000,
      optimistic_cents: 12000,
    })
    expect(pnl.breakeven).toEqual({
      tickets_needed: 2,
      tickets_to_go: 0,
      crossed_at: secondSaleAt,
    })
    expect(pnl.margin_pct).toBe(16.6667)
    expect(pnl.rev_share_adjustments).toEqual([])
  })

  it('keeps refund-heavy events deterministic and separates sold from refunded tickets', async () => {
    const db = new MemorySupabase({
      events: [{ id: eventId, expected_attendance: 50 }],
      event_sales_data: [
        sale({
          ticket_quantity: 4,
          total_amount_cents: 20000,
          fees_cents: 1000,
          purchase_timestamp: '2026-06-01T18:00:00.000Z',
        }),
        sale({
          ticket_quantity: -3,
          total_amount_cents: -15000,
          is_refund: true,
          purchase_timestamp: '2026-06-01T20:00:00.000Z',
        }),
      ],
      imported_attendees: [],
      event_cost_commitments: [],
    })

    const actuals = await computeEventActuals(db, eventId)

    expect(actuals.gross_revenue_cents).toBe(20000)
    expect(actuals.refunds_cents).toBe(15000)
    expect(actuals.platform_fees_cents).toBe(1000)
    expect(actuals.net_revenue_cents).toBe(4000)
    expect(actuals.tickets_sold).toBe(4)
    expect(actuals.tickets_refunded).toBe(3)
    expect(actuals.velocity.since_launch_cents).toBe(5000)
  })

  it('returns null sellout projections when no event capacity signal exists', async () => {
    const db = new MemorySupabase({
      events: [{ id: eventId, expected_attendance: null, expected_attendance_max: null }],
      event_sales_data: [
        sale({
          ticket_quantity: 10,
          ticket_tier_name: 'General Admission',
          total_amount_cents: 100000,
          purchase_timestamp: isoHoursAgo(3),
        }),
      ],
      imported_attendees: [],
      event_cost_commitments: [],
    })

    const actuals = await computeEventActuals(db, eventId)

    expect(actuals.velocity.projected_sellout_at).toBeNull()
    expect(actuals.tier_breakdown).toEqual([
      { tier_name: 'General Admission', sold: 10, gross_cents: 100000, sellout_pct: null },
    ])
  })
})

function sale(overrides: Record<string, unknown> = {}) {
  return {
    event_id: eventId,
    platform: 'posh',
    source: 'csv_import',
    ticket_quantity: 1,
    ticket_type: 'General Admission',
    ticket_tier_name: 'General Admission',
    total_amount: null,
    total_amount_cents: 5000,
    gross_cents: null,
    fees: null,
    fees_cents: 0,
    is_refund: false,
    purchase_timestamp: '2026-06-01T12:00:00.000Z',
    received_at: null,
    created_at: '2026-06-01T12:00:00.000Z',
    updated_at: '2026-06-01T12:00:00.000Z',
    raw_data: {},
    field_confidence: {
      total_amount: { confidence: 'high', source: 'csv_import' },
    },
    ...overrides,
  }
}

function attendee(overrides: Record<string, unknown> = {}) {
  return {
    event_id: eventId,
    checked_in: true,
    check_in_time: '2026-06-01T19:00:00.000Z',
    check_in_method: 'csv_import',
    created_at: '2026-06-01T19:00:00.000Z',
    updated_at: '2026-06-01T19:00:00.000Z',
    raw_data: { source: 'csv_import' },
    field_confidence: {
      checked_in: { confidence: 'high', source: 'csv_import' },
    },
    ...overrides,
  }
}

function isoHoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

class MemorySupabase {
  constructor(private tables: Record<string, Array<Record<string, unknown>>>) {}

  from(table: string) {
    return new MemoryQuery(this.tables[table] ?? [])
  }
}

class MemoryQuery {
  private filters: Array<{ column: string; value: unknown }> = []
  private orders: Array<{ column: string; ascending: boolean }> = []

  constructor(private rows: Array<Record<string, unknown>>) {}

  select() {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value })
    return this
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending !== false })
    return this
  }

  async maybeSingle() {
    return { data: this.resolveRows()[0] ?? null, error: null }
  }

  then(
    resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown,
    reject?: (reason: unknown) => unknown
  ) {
    Promise.resolve({ data: this.resolveRows(), error: null as null }).then(resolve, reject)
  }

  private resolveRows() {
    const filtered = this.rows.filter((row) =>
      this.filters.every((filter) => row[filter.column] === filter.value)
    )

    return [...filtered].sort((first, second) => {
      for (const order of this.orders) {
        const firstValue = String(first[order.column] ?? '')
        const secondValue = String(second[order.column] ?? '')
        const result = firstValue.localeCompare(secondValue)
        if (result !== 0) return order.ascending ? result : -result
      }
      return 0
    })
  }
}
