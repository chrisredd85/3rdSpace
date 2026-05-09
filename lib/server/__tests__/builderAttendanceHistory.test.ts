jest.mock('server-only', () => ({}))

import {
  summarizeBuilderAttendance,
  type BuilderAttendanceDb,
} from '@/lib/server/builderAttendanceHistory'

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

  order(_column: string, _options?: Record<string, unknown>): MockQuery {
    return this
  }

  limit(count: number): MockQuery {
    this.rows = this.rows.slice(0, count)
    return this
  }

  maybeSingle(): Promise<QueryResult> {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null })
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected)
  }
}

function createDb(tables: Record<string, Row[]>): BuilderAttendanceDb {
  return {
    from: (table: string) => new MockQuery(tables[table] ?? []),
  }
}

function makeEvents(count: number, overrides: Partial<Row> = {}): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `event-${index + 1}`,
    builder_id: 'builder-1',
    event_name: `Mixer ${index + 1}`,
    event_type: 'networking mixer',
    event_date: `2026-0${Math.floor(index / 4) + 1}-${String((index % 28) + 1).padStart(2, '0')}`,
    ...overrides,
  }))
}

function makeSales(ticketQuantities: number[]): Row[] {
  return ticketQuantities.map((ticketQuantity, index) => ({
    event_id: `event-${index + 1}`,
    ticket_quantity: ticketQuantity,
    is_refund: false,
    purchase_timestamp: '2026-01-01T00:00:00.000Z',
  }))
}

describe('builder attendance history', () => {
  it('returns correct p75 for high-confidence history', async () => {
    const db = createDb({
      events: makeEvents(10),
      event_sales_data: makeSales([100, 110, 120, 130, 140, 150, 160, 170, 180, 190]),
      imported_attendees: [],
    })

    const summary = await summarizeBuilderAttendance(db, 'builder-1', { archetype_key: 'networking_mixer' })

    expect(summary.sample_size).toBe(10)
    expect(summary.confidence).toBe('high')
    expect(summary.p75_tickets_sold).toBe(170)
  })

  it('returns low-confidence zeros for empty history', async () => {
    const db = createDb({
      events: [],
      event_sales_data: [],
      imported_attendees: [],
    })

    const summary = await summarizeBuilderAttendance(db, 'builder-1')

    expect(summary.sample_size).toBe(0)
    expect(summary.confidence).toBe('low')
    expect(summary.p75_tickets_sold).toBe(0)
  })

  it('excludes refunded orders from attendance totals', async () => {
    const db = createDb({
      events: makeEvents(1),
      event_sales_data: [
        ...makeSales([100]),
        {
          event_id: 'event-1',
          ticket_quantity: 50,
          is_refund: true,
          purchase_timestamp: '2026-01-01T00:00:00.000Z',
        },
      ],
      imported_attendees: [],
    })

    const summary = await summarizeBuilderAttendance(db, 'builder-1')

    expect(summary.sample_size).toBe(1)
    expect(summary.avg_tickets_sold).toBe(100)
  })

  it('filters events by requested archetype', async () => {
    const db = createDb({
      events: [
        ...makeEvents(1),
        {
          id: 'event-2',
          builder_id: 'builder-1',
          event_name: 'Founder dinner',
          event_type: 'founder dinner',
          event_date: '2026-02-01',
        },
      ],
      event_sales_data: [
        {
          event_id: 'event-1',
          ticket_quantity: 120,
          is_refund: false,
          purchase_timestamp: '2026-01-01T00:00:00.000Z',
        },
        {
          event_id: 'event-2',
          ticket_quantity: 24,
          is_refund: false,
          purchase_timestamp: '2026-01-02T00:00:00.000Z',
        },
      ],
      imported_attendees: [],
    })

    const summary = await summarizeBuilderAttendance(db, 'builder-1', { archetype_key: 'founder_operator_dinner' })

    expect(summary.sample_size).toBe(1)
    expect(summary.median_tickets_sold).toBe(24)
  })
})
