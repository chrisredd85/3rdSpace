jest.mock('server-only', () => ({}))

import { lookupBaseline } from '@/lib/planner/baselines'

type Row = Record<string, unknown>

class BaselineDb {
  constructor(private rows: Record<string, Row[]>) {}

  from(table: string) {
    return new Query(this.rows[table] ?? [])
  }
}

class Query {
  private filters: Array<(row: Row) => boolean> = []

  constructor(private rows: Row[]) {}

  select(_columns: string) {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  async maybeSingle() {
    return {
      data: this.rows.find((row) => this.filters.every((filter) => filter(row))) ?? null,
      error: null,
    }
  }
}

describe('lookupBaseline', () => {
  it('returns a personal organizer baseline before archetype averages', async () => {
    const db = new BaselineDb({
      organizer_baselines: [baselineRow({ organizer_id: 'user-1', archetype: 'founder_dinner', n_events: 4 })],
      archetype_baselines: [baselineRow({ archetype: 'founder_dinner', neighborhood: 'mission', n_events: 9 })],
    })

    await expect(lookupBaseline(db as never, {
      organizerId: 'user-1',
      archetype: 'Founder dinner',
      neighborhood: 'Mission',
    })).resolves.toMatchObject({
      source: 'personal',
      nEvents: 4,
      basisLabel: 'Based on your last 4 events',
    })
  })

  it('falls back to archetype baseline when no personal row meets the materialized view floor', async () => {
    const db = new BaselineDb({
      organizer_baselines: [],
      archetype_baselines: [baselineRow({ archetype: 'happy_hour', neighborhood: 'downtown_oakland', n_events: 6 })],
    })

    await expect(lookupBaseline(db as never, {
      organizerId: 'user-1',
      archetype: 'Happy hour',
      neighborhood: 'Downtown Oakland',
    })).resolves.toMatchObject({
      source: 'archetype',
      nEvents: 6,
      basisLabel: 'Based on 6 similar events',
    })
  })

  it('returns default assumptions when neither baseline exists', async () => {
    const db = new BaselineDb({
      organizer_baselines: [],
      archetype_baselines: [],
    })

    await expect(lookupBaseline(db as never, {
      organizerId: 'user-1',
      archetype: 'Panel',
      neighborhood: 'Mission',
    })).resolves.toMatchObject({
      source: 'default',
      avgSellThrough: 0.85,
      avgNoShowRate: 0.15,
      avgAttendanceRate: 0.85,
      basisLabel: 'Industry default',
    })
  })
})

function baselineRow(overrides: Row = {}): Row {
  return {
    organizer_id: 'user-1',
    archetype: 'founder_dinner',
    neighborhood: 'mission',
    n_events: 5,
    avg_sell_through: 0.8,
    avg_no_show_rate: 0.1,
    avg_attendance_rate: 0.9,
    avg_margin_cents: 120000,
    stddev_margin_cents: 25000,
    ...overrides,
  }
}
