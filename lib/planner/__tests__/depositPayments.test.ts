jest.mock('server-only', () => ({}))

jest.mock('@/lib/stripe/connect', () => ({
  getStripeClient: jest.fn(() => ({
    paymentIntents: {
      capture: jest.fn(),
      create: jest.fn(),
    },
  })),
}))

import {
  authorizePlannerDeposit,
  capturePlannerDeposit,
  type PlannerPaymentIntentRow,
} from '../depositPayments'
import type { Approval, Plan } from '@/lib/types'

const plan = {
  id: 'plan-1',
  user_id: 'user-1',
  title: 'Launch event',
} as Plan

const approval = {
  id: 'approval-1',
  plan_id: 'plan-1',
  agent_action_id: 'action-1',
  status: 'authorized',
  requested_amount_cents: 12_500,
  authorized_amount_cents: 12_500,
} as Approval

function memoryDb() {
  const rows: Record<string, Record<string, unknown>[]> = {
    payment_intents: [],
    payouts: [],
  }

  return {
    rows,
    from(table: string) {
      if (!rows[table]) rows[table] = []
      return new MemoryQuery(rows, table)
    },
  }
}

class MemoryQuery {
  private filters: Array<[string, unknown]> = []
  private operation: 'select' | 'insert' | 'update' = 'select'
  private payload: Record<string, unknown> | null = null

  constructor(
    private rows: Record<string, Record<string, unknown>[]>,
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

  eq(field: string, value: unknown) {
    this.filters.push([field, value])
    return this
  }

  in(field: string, values: unknown[]) {
    this.filters.push([field, { $in: values }])
    return this
  }

  order() {
    return this
  }

  limit() {
    return this
  }

  async single() {
    const result = await this.execute()
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: row ? null : { message: 'No row' } }
  }

  async maybeSingle() {
    const result = await this.execute()
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: null }
  }

  private async execute() {
    if (this.operation === 'insert' && this.payload) {
      const row = {
        id: `${this.table}-${this.rows[this.table].length + 1}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...this.payload,
      }
      this.rows[this.table].push(row)
      return { data: row, error: null }
    }

    if (this.operation === 'update' && this.payload) {
      const updated = this.rows[this.table]
        .filter((row) => this.matches(row))
        .map((row) => Object.assign(row, this.payload, { updated_at: new Date().toISOString() }))
      return { data: updated, error: null }
    }

    return {
      data: this.rows[this.table].filter((row) => this.matches(row)),
      error: null,
    }
  }

  private matches(row: Record<string, unknown>) {
    return this.filters.every(([field, value]) => {
      if (typeof value === 'object' && value && '$in' in value) {
        return (value.$in as unknown[]).includes(row[field])
      }
      return row[field] === value
    })
  }
}

describe('planner deposit payments', () => {
  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY
  })

  it('requires explicit approval before authorization', async () => {
    await expect(authorizePlannerDeposit({
      db: memoryDb(),
      plan,
      approval: { ...approval, status: 'pending' },
      userId: 'user-1',
      partnerKind: 'venue',
      partnerId: 'venue-1',
      amountCents: 12_500,
    })).rejects.toThrow(/Approval must be authorized/)
  })

  it('rejects unsafe cents instead of rounding', async () => {
    await expect(authorizePlannerDeposit({
      db: memoryDb(),
      plan,
      approval,
      userId: 'user-1',
      partnerKind: 'venue',
      partnerId: 'venue-1',
      amountCents: 12_500.25,
    })).rejects.toThrow(/safe integer/)
  })

  it('requires explicit user confirmation before capture', async () => {
    const intent = {
      id: 'payment-intent-1',
      plan_id: 'plan-1',
      approval_id: 'approval-1',
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 12_500,
      currency: 'usd',
      status: 'authorized',
      stripe_payment_intent_id: null,
      authorized_at: new Date().toISOString(),
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } satisfies PlannerPaymentIntentRow

    await expect(capturePlannerDeposit({
      db: memoryDb(),
      paymentIntent: intent,
      approval,
      explicitUserConfirmation: false,
    })).rejects.toThrow(/Explicit user confirmation/)
  })
})
