jest.mock('server-only', () => ({}))

jest.mock('@/lib/stripe/connect', () => ({
  getAppBaseUrl: jest.fn(() => 'https://3rdplace.test'),
  getStripeClient: jest.fn(),
}))

import {
  consumeBuilderEventAccess,
  type BuilderBillingProfile,
} from '@/lib/billing/builder-billing'

const builder: BuilderBillingProfile = {
  id: 'builder-1',
  user_id: 'user-1',
  name: 'QA Builder',
  billing_tier: 'free_trial',
  subscription_status: 'trial',
  free_events_granted: 2,
  free_events_used: 0,
  paid_event_credits: 0,
}

class BillingMemoryDb {
  rows: Record<string, Array<Record<string, unknown>>> = {
    builder_profiles: [],
    builder_event_access_consumptions: [],
    builder_event_usage: [],
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new BillingMemoryQuery(this, table)
  }

  nextId(table: string) {
    return `${table}-${this.rows[table].length + 1}`
  }
}

class BillingMemoryQuery {
  private filters: Array<[string, unknown]> = []
  private operation: 'select' | 'insert' | 'update' | 'upsert' = 'select'
  private payload: Record<string, unknown> | null = null

  constructor(
    private db: BillingMemoryDb,
    private table: string
  ) {}

  select() {
    return this
  }

  insert(payload: Record<string, unknown>) {
    this.operation = 'insert'
    this.payload = payload
    return this
  }

  update(payload: Record<string, unknown>) {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  upsert(payload: Record<string, unknown>) {
    this.operation = 'upsert'
    this.payload = payload
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push([field, value])
    return this
  }

  async single() {
    const result = await this.execute()
    if (result.error) return result
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: row ? null : { message: 'No row' } }
  }

  async maybeSingle() {
    const result = await this.execute()
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: null }
  }

  then<TResult1 = { data: Record<string, unknown> | Record<string, unknown>[] | null; error: null | { code?: string; message?: string } }, TResult2 = never>(
    onfulfilled?: ((value: { data: Record<string, unknown> | Record<string, unknown>[] | null; error: null | { code?: string; message?: string } }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected)
  }

  private async execute() {
    if (this.operation === 'insert' && this.payload) {
      if (this.table === 'builder_event_access_consumptions') {
        const duplicate = this.db.rows.builder_event_access_consumptions.some((row) => (
          row.builder_id === this.payload?.builder_id &&
          row.event_id === this.payload?.event_id
        ))
        if (duplicate) {
          return {
            data: null,
            error: { message: 'duplicate key value violates unique constraint "builder_event_access_consumptions_builder_event_unique"' },
          }
        }
      }

      const row = this.withDefaults(this.payload)
      this.db.rows[this.table].push(row)
      return { data: row, error: null }
    }

    if ((this.operation === 'update' || this.operation === 'upsert') && this.payload) {
      const matched = this.db.rows[this.table].filter((row) => this.matches(row))
      if (this.operation === 'upsert' && matched.length === 0) {
        const row = this.withDefaults(this.payload)
        this.db.rows[this.table].push(row)
        return { data: row, error: null }
      }

      const updated = matched.map((row) => Object.assign(row, this.payload, { updated_at: new Date().toISOString() }))
      return { data: updated, error: null }
    }

    return {
      data: this.db.rows[this.table].filter((row) => this.matches(row)),
      error: null,
    }
  }

  private matches(row: Record<string, unknown>) {
    return this.filters.every(([field, value]) => row[field] === value)
  }

  private withDefaults(row: Record<string, unknown>) {
    return {
      id: row.id ?? this.db.nextId(this.table),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...row,
    }
  }
}

function setupBillingDb() {
  const db = new BillingMemoryDb()
  db.rows.builder_profiles.push({ ...builder })
  return db
}

describe('builder billing event access idempotency', () => {
  it('returns the stored consumption for sequential calls with the same event id', async () => {
    const db = setupBillingDb()

    const first = await consumeBuilderEventAccess({
      admin: db,
      builder,
      eventId: 'event-1',
    })
    const second = await consumeBuilderEventAccess({
      admin: db,
      builder,
      eventId: 'event-1',
    })

    expect(first).toEqual({ source: 'free_trial', amount: 0 })
    expect(second).toEqual(first)
    expect(db.rows.builder_event_access_consumptions).toHaveLength(1)
    expect(db.rows.builder_profiles[0].free_events_used).toBe(1)
    expect(db.rows.builder_event_usage).toHaveLength(1)
    expect(db.rows.builder_event_usage[0].events_booked).toBe(1)
  })

  it('consumes a free event once for concurrent calls with the same event id', async () => {
    const db = setupBillingDb()

    const [first, second] = await Promise.all([
      consumeBuilderEventAccess({
        admin: db,
        builder,
        eventId: 'event-1',
      }),
      consumeBuilderEventAccess({
        admin: db,
        builder,
        eventId: 'event-1',
      }),
    ])

    expect(first).toEqual({ source: 'free_trial', amount: 0 })
    expect(second).toEqual(first)
    expect(db.rows.builder_event_access_consumptions).toHaveLength(1)
    expect(db.rows.builder_profiles[0].free_events_used).toBe(1)
    expect(db.rows.builder_event_usage).toHaveLength(1)
    expect(db.rows.builder_event_usage[0].events_booked).toBe(1)
  })
})
