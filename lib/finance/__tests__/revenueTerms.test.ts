import fs from 'fs'
import path from 'path'
import { computeEventActuals, computeEventPnL } from '@/lib/finance/eventActuals'
import {
  applyRevenueTermsToActuals,
  calculateRevenueTermImpact,
  seedPlatformServiceFeeTermsForOrg,
  summarizeRevenueTermImpacts,
  type RevenueTerm,
  type RevenueTermInput,
} from '@/lib/finance/revenueTerms'

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260602000007_add_event_revenue_terms.sql'),
  'utf8'
)

const eventId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const vendorId = '33333333-3333-4333-8333-333333333333'

describe('revenue terms', () => {
  it('calculates deterministic impact for every term type', () => {
    const basis = {
      gross_ticket_revenue_cents: 290000,
      refunds_cents: 10000,
      platform_fees_cents: 5000,
      taxes_collected_cents: 0,
      net_ticket_revenue_cents: 275000,
      bar_revenue_cents: 150000,
      tickets_sold: 100,
      tickets_refunded: 5,
      tickets_checked_in: 80,
    }
    const terms: RevenueTermInput[] = [
      term({ term_type: 'sales_tax', rate: 0.0875, applies_to: 'gross_ticket_revenue' }),
      term({ term_type: 'ticketing_fee', flat_cents: 150, applies_to: 'per_ticket' }),
      term({ term_type: 'service_fee', rate: 0.05, applies_to: 'gross_ticket_revenue' }),
      term({ term_type: 'venue_kickback', rate: 0.1, applies_to: 'bar_revenue' }),
      term({ term_type: 'venue_minimum_spend', flat_cents: 200000, applies_to: 'gross_ticket_revenue' }),
      term({ term_type: 'vendor_rev_share', rate: 0.2, applies_to: 'net_ticket_revenue' }),
      term({ term_type: 'sponsor_credit', flat_cents: 50000, applies_to: 'gross_ticket_revenue' }),
      term({ term_type: 'other', flat_cents: 12345, applies_to: 'gross_ticket_revenue' }),
    ]

    const impacts = terms.map((candidate) => calculateRevenueTermImpact(candidate, basis))

    expect(impacts.map((impact) => [impact.term_type, impact.amount_cents])).toEqual([
      ['sales_tax', 25375],
      ['ticketing_fee', 14250],
      ['service_fee', 14500],
      ['venue_kickback', 15000],
      ['venue_minimum_spend', 200000],
      ['vendor_rev_share', 55000],
      ['sponsor_credit', 50000],
      ['other', 12345],
    ])
    expect(impacts.find((impact) => impact.term_type === 'sales_tax')?.net_revenue_delta_cents).toBe(-25375)
    expect(impacts.find((impact) => impact.term_type === 'service_fee')?.net_revenue_delta_cents).toBe(-14500)
    expect(impacts.find((impact) => impact.term_type === 'venue_kickback')?.net_revenue_delta_cents).toBe(15000)
    expect(impacts.find((impact) => impact.term_type === 'vendor_rev_share')?.cost_delta_cents).toBe(55000)
    expect(impacts.find((impact) => impact.term_type === 'venue_minimum_spend')?.cost_delta_cents).toBe(200000)
    expect(impacts.find((impact) => impact.term_type === 'other')?.net_revenue_delta_cents).toBe(0)
  })

  it('applies taxes, service fees, venue kickbacks, and sponsor credits to actuals without double-counting row fees', () => {
    const actuals = applyRevenueTermsToActuals(
      {
        gross_revenue_cents: 290000,
        refunds_cents: 10000,
        platform_fees_cents: 2000,
        taxes_collected_cents: 0,
        net_revenue_cents: 278000,
        tickets_sold: 100,
        tickets_refunded: 5,
        tickets_checked_in: 80,
      },
      [
        term({ term_type: 'sales_tax', rate: 0.1, applies_to: 'gross_ticket_revenue' }),
        term({ term_type: 'service_fee', rate: 0.05, applies_to: 'gross_ticket_revenue' }),
        term({ term_type: 'venue_kickback', rate: 0.1, applies_to: 'bar_revenue' }),
        term({ term_type: 'sponsor_credit', flat_cents: 25000, applies_to: 'gross_ticket_revenue' }),
      ],
      { bar_revenue_cents: 100000 }
    )

    expect(actuals.platform_fees_cents).toBe(14500)
    expect(actuals.taxes_collected_cents).toBe(29000)
    expect(actuals.net_revenue_cents).toBe(271500)
  })

  it('applies revenue terms inside computeEventActuals', async () => {
    const db = new MemoryRevenueDb({
      events: [{ id: eventId, builder_id: orgId, expected_attendance: 100 }],
      event_sales_data: [
        sale({ ticket_quantity: 2, total_amount_cents: 10000, fees_cents: 0 }),
      ],
      imported_attendees: [],
      event_cost_commitments: [],
      event_revenue_terms: [
        rowTerm({ term_type: 'sales_tax', rate: 0.1, applies_to: 'gross_ticket_revenue' }),
        rowTerm({ term_type: 'service_fee', rate: 0.05, applies_to: 'gross_ticket_revenue', party_name: 'Posh' }),
      ],
      event_kickback_agreements: [],
    })

    const actuals = await computeEventActuals(db, eventId)

    expect(actuals.gross_revenue_cents).toBe(10000)
    expect(actuals.taxes_collected_cents).toBe(1000)
    expect(actuals.platform_fees_cents).toBe(500)
    expect(actuals.net_revenue_cents).toBe(8500)
  })

  it('uses the larger value when a vendor rev-share term conflicts with a manual vendor commitment', async () => {
    const db = new MemoryRevenueDb({
      events: [{ id: eventId, builder_id: orgId, expected_attendance: 100 }],
      event_sales_data: [
        sale({ ticket_quantity: 10, total_amount_cents: 100000 }),
      ],
      imported_attendees: [],
      event_cost_commitments: [
        {
          event_id: eventId,
          org_id: orgId,
          category: 'vendor',
          party_id: vendorId,
          party_name: 'DJ Analog',
          amount_cents: 15000,
          state: 'accepted',
        },
      ],
      event_revenue_terms: [
        rowTerm({
          term_type: 'vendor_rev_share',
          rate: 0.2,
          applies_to: 'gross_ticket_revenue',
          party_id: vendorId,
          party_name: 'DJ Analog',
        }),
      ],
      event_kickback_agreements: [],
    })

    const pnl = await computeEventPnL(db, eventId)

    expect(pnl.costs).toEqual({
      estimated_cents: 0,
      committed_cents: 20000,
      paid_cents: 0,
    })
    expect(pnl.rev_share_adjustments).toEqual([
      { party_name: 'DJ Analog', type: 'vendor_rev_share', amount_cents: 20000 },
    ])
    expect(pnl.terms_conflict).toBe(true)
    expect(pnl.net.expected_cents).toBe(80000)
  })

  it('does not add rev-share cost when the manual vendor commitment is larger, but still flags the conflict', async () => {
    const db = new MemoryRevenueDb({
      events: [{ id: eventId, builder_id: orgId, expected_attendance: 100 }],
      event_sales_data: [
        sale({ ticket_quantity: 10, total_amount_cents: 100000 }),
      ],
      imported_attendees: [],
      event_cost_commitments: [
        {
          event_id: eventId,
          org_id: orgId,
          category: 'vendor',
          party_id: vendorId,
          party_name: 'DJ Analog',
          amount_cents: 30000,
          state: 'accepted',
        },
      ],
      event_revenue_terms: [
        rowTerm({
          term_type: 'vendor_rev_share',
          rate: 0.2,
          applies_to: 'gross_ticket_revenue',
          party_id: vendorId,
          party_name: 'DJ Analog',
        }),
      ],
      event_kickback_agreements: [],
    })

    const pnl = await computeEventPnL(db, eventId)

    expect(pnl.costs.committed_cents).toBe(30000)
    expect(pnl.terms_conflict).toBe(true)
    expect(pnl.net.expected_cents).toBe(70000)
  })

  it('seeds a configurable Posh service-fee term for existing org events', async () => {
    const originalRate = process.env.POSH_DEFAULT_SERVICE_FEE_RATE
    process.env.POSH_DEFAULT_SERVICE_FEE_RATE = '0.055'
    const db = new MemoryRevenueDb({
      events: [{ id: eventId, builder_id: orgId, expected_attendance: 100 }],
      event_sales_data: [],
      imported_attendees: [],
      event_cost_commitments: [],
      event_revenue_terms: [],
      event_kickback_agreements: [],
    })

    try {
      const seeded = await seedPlatformServiceFeeTermsForOrg({
        supabase: db,
        orgId,
        platform: 'posh',
      })

      expect(seeded).toHaveLength(1)
      expect(db.rows.event_revenue_terms[0]).toMatchObject({
        event_id: eventId,
        org_id: orgId,
        term_type: 'service_fee',
        rate: 0.055,
        applies_to: 'gross_ticket_revenue',
        party_name: 'Posh',
        source: 'platform_default',
      })
    } finally {
      restoreEnv('POSH_DEFAULT_SERVICE_FEE_RATE', originalRate)
    }
  })

  it('summarizes running impact for UI labels', () => {
    const summary = summarizeRevenueTermImpacts(
      [
        term({ term_type: 'service_fee', rate: 0.05, applies_to: 'gross_ticket_revenue', party_name: 'Posh' }),
      ],
      {
        gross_ticket_revenue_cents: 290000,
        net_ticket_revenue_cents: 290000,
        tickets_sold: 100,
      }
    )

    expect(summary.platform_fee_cents).toBe(14500)
    expect(summary.impacts[0]).toMatchObject({
      term_type: 'service_fee',
      party_name: 'Posh',
      basis_cents: 290000,
      amount_cents: 14500,
    })
  })

  it('has org-scoped RLS policies', () => {
    expect(migration).toContain('ALTER TABLE public.event_revenue_terms ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('public.can_manage_event_revenue_term_org(org_id)')
    expect(migration).toContain('FOR SELECT')
    expect(migration).toContain('FOR INSERT')
    expect(migration).toContain('FOR UPDATE')
    expect(migration).toContain('FOR DELETE')
    expect(migration).not.toContain('USING (true)')
  })
})

function term(overrides: Partial<RevenueTermInput>): RevenueTermInput {
  return {
    event_id: eventId,
    org_id: orgId,
    term_type: 'service_fee',
    rate: null,
    flat_cents: null,
    applies_to: 'gross_ticket_revenue',
    party_id: null,
    party_name: null,
    notes: null,
    confidence: 'high',
    source: 'manual',
    ...overrides,
  }
}

function rowTerm(overrides: Partial<RevenueTerm>): RevenueTerm {
  return {
    id: `44444444-4444-4444-8444-${String(rowTermCounter++).padStart(12, '0')}`,
    event_id: eventId,
    org_id: orgId,
    term_type: 'service_fee',
    rate: null,
    flat_cents: null,
    applies_to: 'gross_ticket_revenue',
    party_id: null,
    party_name: null,
    notes: null,
    confidence: 'high',
    source: 'manual',
    created_at: '2026-06-02T18:00:00.000Z',
    updated_at: '2026-06-02T18:00:00.000Z',
    ...overrides,
  }
}

let rowTermCounter = 1

function sale(overrides: Record<string, unknown> = {}) {
  return {
    event_id: eventId,
    platform: 'posh',
    source: 'csv_import',
    ticket_quantity: 1,
    ticket_type: 'General Admission',
    ticket_tier_name: 'General Admission',
    total_amount_cents: 5000,
    gross_cents: null,
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

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

class MemoryRevenueDb {
  rows: Record<string, Array<Record<string, unknown>>>

  constructor(tables: Record<string, Array<Record<string, unknown>>>) {
    this.rows = tables
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<{ column: string; value: unknown }> = []
  private orders: Array<{ column: string; ascending: boolean }> = []
  private pendingInsert: Record<string, unknown> | null = null
  private pendingUpdate: Record<string, unknown> | null = null
  private shouldDelete = false
  private limitCount: number | null = null

  constructor(private db: MemoryRevenueDb, private table: string) {}

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

  limit(count: number) {
    this.limitCount = count
    return this
  }

  insert(value: Record<string, unknown>) {
    this.pendingInsert = value
    return this
  }

  update(value: Record<string, unknown>) {
    this.pendingUpdate = value
    return this
  }

  delete() {
    this.shouldDelete = true
    return this
  }

  async maybeSingle() {
    return { data: this.executeRows()[0] ?? null, error: null }
  }

  async single() {
    return { data: this.executeRows()[0] ?? null, error: null }
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    resolve?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve({ data: this.executeRows(), error: null as null }).then(resolve, reject)
  }

  private executeRows() {
    if (this.pendingInsert) {
      const row = this.materializeRow(this.pendingInsert)
      this.db.rows[this.table].push(row)
      return [row]
    }

    const rows = this.matchingRows()
    if (this.pendingUpdate) {
      rows.forEach((row) => Object.assign(row, this.pendingUpdate))
      return rows
    }

    if (this.shouldDelete) {
      const ids = new Set(rows.map((row) => row.id))
      this.db.rows[this.table] = this.db.rows[this.table].filter((row) => !ids.has(row.id))
      return rows
    }

    return rows
  }

  private matchingRows() {
    const filtered = this.db.rows[this.table].filter((row) =>
      this.filters.every((filter) => row[filter.column] === filter.value)
    )

    const sorted = [...filtered].sort((first, second) => {
      for (const order of this.orders) {
        const firstValue = String(first[order.column] ?? '')
        const secondValue = String(second[order.column] ?? '')
        const result = firstValue.localeCompare(secondValue)
        if (result !== 0) return order.ascending ? result : -result
      }
      return 0
    })

    return this.limitCount === null ? sorted : sorted.slice(0, this.limitCount)
  }

  private materializeRow(value: Record<string, unknown>) {
    return {
      id: value.id ?? `55555555-5555-4555-8555-${String(this.db.rows[this.table].length + 1).padStart(12, '0')}`,
      created_at: value.created_at ?? '2026-06-02T18:00:00.000Z',
      updated_at: value.updated_at ?? '2026-06-02T18:00:00.000Z',
      ...value,
    }
  }
}
