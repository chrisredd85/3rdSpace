jest.mock('server-only', () => ({}))

jest.mock('@/lib/stripe/connect', () => ({
  getAppBaseUrl: jest.fn(() => 'https://3rdplace.test'),
  getStripeClient: jest.fn(),
}))

import {
  BuilderBillingRequiredError,
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
  private rpcQueue = Promise.resolve()

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new BillingMemoryQuery(this, table)
  }

  rpc(name: string, params: Record<string, unknown>) {
    if (name !== 'consume_builder_event_access') {
      return {
        maybeSingle: async () => ({
          data: null,
          error: { message: `Unknown RPC ${name}` },
        }),
      }
    }

    return {
      maybeSingle: () => {
        const result = this.rpcQueue.then(() => this.consumeBuilderEventAccess(params))
        this.rpcQueue = result.then(() => undefined, () => undefined)
        return result
      },
    }
  }

  nextId(table: string) {
    return `${table}-${this.rows[table].length + 1}`
  }

  private async consumeBuilderEventAccess(params: Record<string, unknown>) {
    const builderId = params.p_builder_id as string
    const eventId = params.p_event_id as string
    const defaultFreeEventsGranted = params.p_default_free_events_granted as number
    const payPerEventAmountCents = params.p_pay_per_event_amount_cents as number
    const proMonthlyAmountCents = params.p_pro_monthly_amount_cents as number

    const builderRow = this.rows.builder_profiles.find((row) => row.id === builderId)
    if (!builderRow) {
      return {
        data: null,
        error: { code: 'P0002', message: 'builder_profile_not_found' },
      }
    }

    const existing = this.rows.builder_event_access_consumptions.find((row) => (
      row.builder_id === builderId && row.event_id === eventId
    ))
    if (existing) return { data: existing, error: null }

    const freeEventsGranted = Math.max(
      (builderRow.free_events_granted as number | null | undefined) ?? defaultFreeEventsGranted,
      defaultFreeEventsGranted
    )
    const freeEventsUsed = (builderRow.free_events_used as number | null | undefined) ?? 0
    const paidEventCredits = (builderRow.paid_event_credits as number | null | undefined) ?? 0
    const isPro = (
      (builderRow.billing_tier === 'pro_monthly' || builderRow.billing_tier === 'pro_annual') &&
      builderRow.subscription_status === 'active'
    )

    let source: string
    let amountCents = 0
    let sourceMetadata: Record<string, unknown> = {}

    if (isPro) {
      source = builderRow.billing_tier as string
      sourceMetadata = {
        subscription_id: builderRow.stripe_subscription_id ?? null,
      }
    } else if (freeEventsGranted - freeEventsUsed > 0) {
      source = 'free_trial'
      builderRow.free_events_used = freeEventsUsed + 1
    } else if (paidEventCredits > 0) {
      source = 'pay_per_event'
      amountCents = payPerEventAmountCents
      builderRow.billing_tier = 'pay_per_event'
      builderRow.paid_event_credits = paidEventCredits - 1
    } else {
      return {
        data: null,
        error: { code: 'P0001', message: 'builder_billing_required' },
      }
    }

    const row = {
      id: this.nextId('builder_event_access_consumptions'),
      builder_id: builderId,
      event_id: eventId,
      source,
      amount: Math.floor(amountCents / 100),
      amount_cents: amountCents,
      source_metadata: sourceMetadata,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    this.rows.builder_event_access_consumptions.push(row)

    const usage = this.rows.builder_event_usage[0]
    if (usage) {
      usage.events_booked = ((usage.events_booked as number | undefined) ?? 0) + 1
      usage.total_fees_paid = ((usage.total_fees_paid as number | undefined) ?? 0) + amountCents / 100
      usage.could_have_saved = Math.max(
        (((usage.events_booked as number | undefined) ?? 0) * (payPerEventAmountCents / 100)) -
          (proMonthlyAmountCents / 100),
        0
      )
    } else {
      this.rows.builder_event_usage.push({
        id: this.nextId('builder_event_usage'),
        builder_id: builderId,
        month: '2026-06-01',
        events_booked: 1,
        total_fees_paid: amountCents / 100,
        could_have_saved: Math.max((payPerEventAmountCents - proMonthlyAmountCents) / 100, 0),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }

    return { data: row, error: null }
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

function setupBillingDbWithBuilder(overrides: Partial<BuilderBillingProfile>) {
  const db = new BillingMemoryDb()
  db.rows.builder_profiles.push({ ...builder, ...overrides })
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

  it('does not overconsume free events when two different events race for one remaining free event', async () => {
    const db = setupBillingDbWithBuilder({
      free_events_granted: 2,
      free_events_used: 1,
      paid_event_credits: 0,
    })
    const staleBuilder = {
      ...builder,
      free_events_granted: 2,
      free_events_used: 1,
      paid_event_credits: 0,
    }

    const [first, second] = await Promise.allSettled([
      consumeBuilderEventAccess({
        admin: db,
        builder: staleBuilder,
        eventId: 'event-1',
      }),
      consumeBuilderEventAccess({
        admin: db,
        builder: staleBuilder,
        eventId: 'event-2',
      }),
    ])

    const fulfilled = [first, second].filter(
      (result): result is PromiseFulfilledResult<{ source: string; amount: number }> => result.status === 'fulfilled'
    )
    const rejected = [first, second].filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )

    expect(fulfilled).toHaveLength(1)
    expect(fulfilled[0].value).toEqual({ source: 'free_trial', amount: 0 })
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(BuilderBillingRequiredError)
    expect(db.rows.builder_event_access_consumptions).toHaveLength(1)
    expect(db.rows.builder_profiles[0].free_events_used).toBe(2)
    expect(db.rows.builder_event_usage).toHaveLength(1)
    expect(db.rows.builder_event_usage[0].events_booked).toBe(1)
  })

  it('does not overconsume paid event credits when two different events race for one credit', async () => {
    const db = setupBillingDbWithBuilder({
      billing_tier: 'pay_per_event',
      free_events_granted: 2,
      free_events_used: 2,
      paid_event_credits: 1,
    })
    const staleBuilder = {
      ...builder,
      billing_tier: 'pay_per_event' as const,
      free_events_granted: 2,
      free_events_used: 2,
      paid_event_credits: 1,
    }

    const [first, second] = await Promise.allSettled([
      consumeBuilderEventAccess({
        admin: db,
        builder: staleBuilder,
        eventId: 'event-1',
      }),
      consumeBuilderEventAccess({
        admin: db,
        builder: staleBuilder,
        eventId: 'event-2',
      }),
    ])

    const fulfilled = [first, second].filter(
      (result): result is PromiseFulfilledResult<{ source: string; amount: number }> => result.status === 'fulfilled'
    )
    const rejected = [first, second].filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )

    expect(fulfilled).toHaveLength(1)
    expect(fulfilled[0].value).toEqual({ source: 'pay_per_event', amount: 30 })
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason).toBeInstanceOf(BuilderBillingRequiredError)
    expect(db.rows.builder_event_access_consumptions).toHaveLength(1)
    expect(db.rows.builder_profiles[0].paid_event_credits).toBe(0)
    expect(db.rows.builder_event_usage).toHaveLength(1)
    expect(db.rows.builder_event_usage[0].events_booked).toBe(1)
    expect(db.rows.builder_event_usage[0].total_fees_paid).toBe(30)
  })
})
