jest.mock('server-only', () => ({}))

const mockStripePaymentIntentsCapture = jest.fn()
const mockStripePaymentIntentsCreate = jest.fn()

jest.mock('@/lib/stripe/connect', () => ({
  getStripeClient: jest.fn(() => ({
    paymentIntents: {
      capture: mockStripePaymentIntentsCapture,
      create: mockStripePaymentIntentsCreate,
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
    if (result.error) return result
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
      if (this.table === 'payment_intents') {
        const incoming = this.payload as Record<string, unknown>
        const approvalId = incoming.approval_id
        const activeStatuses = new Set(['requested', 'authorized', 'captured'])
        const duplicate = this.rows.payment_intents.some((row) => (
          row.approval_id === approvalId &&
          activeStatuses.has(String(row.status))
        ))
        if (duplicate) {
          return { data: null, error: { code: '23505', message: 'duplicate active payment intent' } }
        }
      }

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
    mockStripePaymentIntentsCapture.mockReset()
    mockStripePaymentIntentsCreate.mockReset()
    mockStripePaymentIntentsCreate.mockResolvedValue({
      id: 'pi_planner_deposit_test',
      status: 'requires_capture',
    })
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

  it('returns the winning active intent when concurrent authorizations race the unique index', async () => {
    const db = memoryDb()

    const [first, second] = await Promise.all([
      authorizePlannerDeposit({
        db,
        plan,
        approval,
        userId: 'user-1',
        partnerKind: 'venue',
        partnerId: 'venue-1',
        amountCents: 12_500,
      }),
      authorizePlannerDeposit({
        db,
        plan,
        approval,
        userId: 'user-1',
        partnerKind: 'venue',
        partnerId: 'venue-1',
        amountCents: 12_500,
      }),
    ])

    expect(db.rows.payment_intents).toHaveLength(1)
    expect(first).toEqual(second)
    expect(first).toEqual(expect.objectContaining({
      approval_id: approval.id,
      amount_cents: 12_500,
      status: 'requested',
    }))
  })

  it('rejects a fresh active intent with a different amount during an authorization race', async () => {
    const db = memoryDb()
    db.rows.payment_intents.push({
      id: 'payment-intents-1',
      plan_id: plan.id,
      approval_id: approval.id,
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 10_000,
      currency: 'usd',
      status: 'requested',
      stripe_payment_intent_id: null,
      authorized_at: null,
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    await expect(authorizePlannerDeposit({
      db,
      plan,
      approval,
      userId: 'user-1',
      partnerKind: 'venue',
      partnerId: 'venue-1',
      amountCents: 12_500,
    })).rejects.toThrow(
      'Concurrent deposit authorization attempted with different amount (existing: $100.00, requested: $125.00). Refresh and try again.'
    )
  })

  it('uses the same Stripe idempotency key for same-approval concurrent authorizations', async () => {
    const db = memoryDb()

    const [first, second] = await Promise.all([
      authorizePlannerDeposit({
        db,
        plan,
        approval,
        userId: 'user-1',
        partnerKind: 'venue',
        partnerId: 'venue-1',
        amountCents: 12_500,
        paymentMethodId: 'pm_test_same_amount',
      }),
      authorizePlannerDeposit({
        db,
        plan,
        approval,
        userId: 'user-1',
        partnerKind: 'venue',
        partnerId: 'venue-1',
        amountCents: 12_500,
        paymentMethodId: 'pm_test_same_amount',
      }),
    ])

    expect(db.rows.payment_intents).toHaveLength(1)
    expect(first).toEqual(second)
    expect(mockStripePaymentIntentsCreate).toHaveBeenCalledTimes(2)
    expect(mockStripePaymentIntentsCreate.mock.calls.map((call) => call[1])).toEqual([
      { idempotencyKey: `planner_deposit_${approval.id}_12500` },
      { idempotencyKey: `planner_deposit_${approval.id}_12500` },
    ])
  })
})
