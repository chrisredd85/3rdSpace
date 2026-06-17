jest.mock('server-only', () => ({}))

import {
  consumeBuilderEventAccess,
  createBuilderCheckoutSession,
  ensureStripeCustomerForBuilder,
  getBuilderBillingSummary,
} from '@/lib/billing/builder-billing'
import { getStripeClient } from '@/lib/stripe/connect'

jest.mock('@/lib/stripe/connect', () => ({
  getAppBaseUrl: jest.fn(() => 'https://3rdplace.test'),
  getStripeClient: jest.fn(),
}))

function createAdminMock() {
  const updates: Array<{ table: string; payload: unknown; filters: Array<[string, unknown]> }> = []

  return {
    updates,
    admin: {
      from: jest.fn((table: string) => ({
        update: jest.fn((payload: unknown) => {
          const entry = { table, payload, filters: [] as Array<[string, unknown]> }
          updates.push(entry)
          const query = {
            eq: jest.fn((column: string, value: unknown) => {
              entry.filters.push([column, value])
              return query
            }),
          }
          return query
        }),
      })),
    },
  }
}

const builder = {
  id: 'builder-1',
  user_id: 'user-1',
  name: 'QA Builder',
  stripe_customer_id: 'cus_existing',
}

describe('builder billing Stripe customer resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('reuses a stored Stripe customer when it exists in the active Stripe mode', async () => {
    const stripe = {
      customers: {
        retrieve: jest.fn().mockResolvedValue({ id: 'cus_existing' }),
        create: jest.fn(),
      },
    }
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
    const { admin, updates } = createAdminMock()

    await expect(
      ensureStripeCustomerForBuilder({
        admin,
        builder,
        email: 'qa@example.com',
      })
    ).resolves.toBe('cus_existing')

    expect(stripe.customers.retrieve).toHaveBeenCalledWith('cus_existing')
    expect(stripe.customers.create).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })

  it('replaces a stored customer id that belongs to the other Stripe mode', async () => {
    const stripe = {
      customers: {
        retrieve: jest.fn().mockRejectedValue({
          code: 'resource_missing',
          message: "No such customer: 'cus_existing'; a similar object exists in test mode, but a live mode key was used to make this request.",
        }),
        create: jest.fn().mockResolvedValue({ id: 'cus_replacement' }),
      },
    }
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
    const { admin, updates } = createAdminMock()

    await expect(
      ensureStripeCustomerForBuilder({
        admin,
        builder,
        email: 'qa@example.com',
      })
    ).resolves.toBe('cus_replacement')

    expect(stripe.customers.retrieve).toHaveBeenCalledWith('cus_existing')
    expect(stripe.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'qa@example.com',
        name: 'QA Builder',
        metadata: {
          builder_id: 'builder-1',
          user_id: 'user-1',
        },
      })
    )
    expect(updates).toEqual([
      {
        table: 'builder_profiles',
        payload: expect.objectContaining({ stripe_customer_id: 'cus_replacement' }),
        filters: [['id', 'builder-1']],
      },
      {
        table: 'builder_subscriptions',
        payload: expect.objectContaining({ stripe_customer_id: 'cus_replacement' }),
        filters: [
          ['builder_id', 'builder-1'],
          ['stripe_customer_id', 'cus_existing'],
        ],
      },
    ])
  })

  it('creates checkout with the replacement customer when the stored one is stale', async () => {
    const stripe = {
      customers: {
        retrieve: jest.fn().mockRejectedValue({
          code: 'resource_missing',
          message: "No such customer: 'cus_existing'; a similar object exists in test mode, but a live mode key was used to make this request.",
        }),
        create: jest.fn().mockResolvedValue({ id: 'cus_replacement' }),
      },
      checkout: {
        sessions: {
          create: jest.fn().mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.test' }),
        },
      },
    }
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
    const { admin } = createAdminMock()

    await createBuilderCheckoutSession({
      admin,
      request: new Request('https://3rdplace.test/planner/billing'),
      builder,
      userEmail: 'qa@example.com',
      type: 'pay_per_event',
    })

    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_replacement',
        mode: 'payment',
      }),
      expect.objectContaining({
        idempotencyKey: `builder_checkout_${builder.id}_pay_per_event`,
      })
    )
  })
})

describe('builder billing free tier summary', () => {
  it('grants two free events by default for new and legacy one-event profiles', () => {
    expect(getBuilderBillingSummary({
      ...builder,
      billing_tier: 'free_trial',
      subscription_status: 'trial',
      free_events_granted: null,
      free_events_used: 0,
      paid_event_credits: 0,
    }).freeEventsGranted).toBe(2)

    expect(getBuilderBillingSummary({
      ...builder,
      billing_tier: 'free_trial',
      subscription_status: 'trial',
      free_events_granted: 1,
      free_events_used: 0,
      paid_event_credits: 0,
    }).freeEventsGranted).toBe(2)
  })
})

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
          return { data: null, error: { code: '23505', message: 'duplicate builder event access consumption' } }
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

describe('builder billing event access idempotency', () => {
  it('consumes a free event once for concurrent calls with the same event id', async () => {
    const db = new BillingMemoryDb()
    const billingBuilder = {
      ...builder,
      billing_tier: 'free_trial' as const,
      subscription_status: 'trial',
      free_events_granted: 2,
      free_events_used: 0,
      paid_event_credits: 0,
    }
    db.rows.builder_profiles.push({ ...billingBuilder })

    const [first, second] = await Promise.all([
      consumeBuilderEventAccess({
        admin: db,
        builder: billingBuilder,
        eventId: 'event-1',
      }),
      consumeBuilderEventAccess({
        admin: db,
        builder: billingBuilder,
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
