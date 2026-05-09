jest.mock('server-only', () => ({}))

import {
  summarizeBuilderTierElasticity,
  type BuilderTierElasticityDb,
} from '@/lib/server/builderTierElasticity'

type Row = Record<string, unknown>
type QueryResult = { data: unknown; error: null }

class MockQuery implements PromiseLike<QueryResult> {
  private rows: Row[]

  constructor(rows: Row[]) {
    this.rows = rows
  }

  select(_columns: string): MockQuery {
    return this
  }

  eq(column: string, value: unknown): MockQuery {
    this.rows = this.rows.filter((row) => row[column] === value)
    return this
  }

  in(column: string, values: unknown[]): MockQuery {
    this.rows = this.rows.filter((row) => values.includes(row[column]))
    return this
  }

  gte(column: string, value: unknown): MockQuery {
    if (typeof value !== 'string') return this
    this.rows = this.rows.filter((row) => typeof row[column] !== 'string' || row[column] >= value)
    return this
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected)
  }
}

function createDb(tables: Record<string, Row[]>): BuilderTierElasticityDb {
  return {
    from: (table: string) => new MockQuery(tables[table] ?? []),
  }
}

function makeEvents(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `event-${index + 1}`,
    builder_id: 'builder-1',
    event_name: `Mixer ${index + 1}`,
    event_type: 'networking mixer',
    event_date: '2026-01-30',
    created_at: '2026-01-01T00:00:00.000Z',
  }))
}

function makeIntegrations(count: number, capacities: Record<string, number>): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `integration-${index + 1}`,
    event_id: `event-${index + 1}`,
    created_at: '2026-01-01T00:00:00.000Z',
    config: { tier_capacities: capacities },
  }))
}

function tierSale(eventId: string, tierName: string, priceCents: number, quantity: number, day: number): Row {
  return {
    event_id: eventId,
    ticket_tier_name: tierName,
    ticket_type: tierName,
    ticket_price_cents: priceCents,
    ticket_quantity: quantity,
    is_refund: false,
    purchase_timestamp: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
  }
}

describe('builder tier elasticity', () => {
  it('detects premium-first pattern and recommends a higher band', async () => {
    const events = makeEvents(5)
    const sales = events.flatMap((event) => [
      tierSale(String(event.id), 'GA', 4000, 40, 20),
      tierSale(String(event.id), 'VIP', 7500, 10, 3),
    ])
    const db = createDb({
      events,
      event_sales_data: sales,
      external_event_integrations: makeIntegrations(5, { GA: 40, VIP: 10 }),
    })

    const signal = await summarizeBuilderTierElasticity(db, 'builder-1', { archetype_key: 'networking_mixer' })

    expect(signal.tier_pattern).toBe('premium_first')
    expect(signal.recommended_price_floor_cents).toBe(7500)
    expect(signal.recommended_price_ceiling_cents).toBe(9000)
  })

  it('detects budget-first pattern and caps at the low median tier', async () => {
    const events = makeEvents(4)
    const sales = events.flatMap((event) => [
      tierSale(String(event.id), 'Early Bird', 4000, 10, 3),
      tierSale(String(event.id), 'GA', 7500, 10, 15),
    ])
    const db = createDb({
      events,
      event_sales_data: sales,
      external_event_integrations: makeIntegrations(4, { 'Early Bird': 10, GA: 10 }),
    })

    const signal = await summarizeBuilderTierElasticity(db, 'builder-1', { archetype_key: 'networking_mixer' })

    expect(signal.tier_pattern).toBe('budget_first')
    expect(signal.recommended_price_ceiling_cents).toBe(4000)
  })

  it('detects dead VIP tiers', async () => {
    const events = makeEvents(6)
    const sales = events.flatMap((event) => [
      tierSale(String(event.id), 'GA', 5000, 40, 5),
      tierSale(String(event.id), 'VIP', 20000, 1, 20),
    ])
    const db = createDb({
      events,
      event_sales_data: sales,
      external_event_integrations: makeIntegrations(6, { GA: 40, VIP: 10 }),
    })

    const signal = await summarizeBuilderTierElasticity(db, 'builder-1', { archetype_key: 'networking_mixer' })

    expect(signal.tier_pattern).toBe('vip_dead')
  })

  it('detects proportional tier movement', async () => {
    const events = makeEvents(4)
    const sales = events.flatMap((event) => [
      tierSale(String(event.id), 'GA', 4000, 10, 10),
      tierSale(String(event.id), 'VIP', 7500, 10, 12),
    ])
    const db = createDb({
      events,
      event_sales_data: sales,
      external_event_integrations: makeIntegrations(4, { GA: 10, VIP: 10 }),
    })

    const signal = await summarizeBuilderTierElasticity(db, 'builder-1', { archetype_key: 'networking_mixer' })

    expect(signal.tier_pattern).toBe('proportional')
  })

  it('returns low-confidence unknown signal for empty history', async () => {
    const db = createDb({
      events: [],
      event_sales_data: [],
      external_event_integrations: [],
    })

    const signal = await summarizeBuilderTierElasticity(db, 'builder-1')

    expect(signal.confidence).toBe('low')
    expect(signal.tier_pattern).toBe('unknown')
    expect(signal.recommended_price_floor_cents).toBeNull()
    expect(signal.recommended_price_ceiling_cents).toBeNull()
  })
})
