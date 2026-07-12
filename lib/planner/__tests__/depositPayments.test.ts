jest.mock('server-only', () => ({}))

const mockStripePaymentIntentsCapture = jest.fn()
const mockStripePaymentIntentsCreate = jest.fn()
const mockStripePaymentIntentsRetrieve = jest.fn()

jest.mock('@/lib/stripe/connect', () => ({
  getStripeClient: jest.fn(() => ({
    paymentIntents: {
      capture: mockStripePaymentIntentsCapture,
      create: mockStripePaymentIntentsCreate,
      retrieve: mockStripePaymentIntentsRetrieve,
    },
  })),
}))

import {
  applyPlannerStripePaymentIntentWebhook,
  applyPlannerStripeRefundWebhook,
  authorizePlannerDeposit,
  capturePlannerDeposit,
  PaymentCaptureAlreadyInProgressError,
  PlannerDepositNotFundedError,
  PlannerDepositPaymentMethodRequiredError,
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

function plannerStripeTruth(input: {
  id?: string
  status?: string
  plannerPaymentIntentId?: string
  platformFeeCents?: number
  amount?: number
  currency?: string
  capture_method?: string
  client_secret?: string | null
  next_action?: Record<string, unknown> | null
  last_payment_error?: { message?: string | null } | null
  metadata?: Record<string, string>
} = {}) {
  const {
    plannerPaymentIntentId = 'payment_intents-1',
    platformFeeCents = 0,
    metadata,
    ...overrides
  } = input
  return {
    id: 'pi_planner_deposit_test',
    status: 'requires_capture',
    amount: 12_500,
    currency: 'usd',
    capture_method: 'manual',
    metadata: {
      payment_kind: 'planner_deposit',
      planner_payment_intent_id: plannerPaymentIntentId,
      plan_id: plan.id,
      approval_id: approval.id,
      partner_kind: 'venue',
      partner_id: 'venue-1',
      platform_fee_cents: String(platformFeeCents),
      ...(metadata ?? {}),
    },
    ...overrides,
  }
}

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
    async rpc(name: string, params: Record<string, unknown>) {
      if (name !== 'reserve_planner_deposit_capture') {
        return { data: null, error: { message: `Unknown RPC ${name}` } }
      }
      const payment = rows.payment_intents.find((row) => (
        row.id === params.p_payment_intent_id &&
        row.plan_id === params.p_plan_id &&
        row.approval_id === params.p_approval_id &&
        (row.status === 'requested' || row.status === 'authorized')
      ))
      if (!payment) return { data: [], error: null }
      Object.assign(payment, {
        status: 'capturing',
        failure_reason: null,
        capture_attempt_id: params.p_capture_attempt_id,
        capture_started_at: new Date().toISOString(),
        capture_effects_started_at: null,
        capture_effects_completed_at: null,
        updated_at: new Date().toISOString(),
      })
      return { data: [{ ...payment }], error: null }
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

  is(field: string, value: unknown) {
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

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected)
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
        const activeStatuses = new Set([
          'pending',
          'requested',
          'authorized',
          'capturing',
          'captured',
          'refunded',
          'refund_reconciliation_required',
          'blocked_by_account_state',
        ])
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
    mockStripePaymentIntentsRetrieve.mockReset()
    mockStripePaymentIntentsCapture.mockResolvedValue(plannerStripeTruth({
      id: 'pi_manual_capture',
      status: 'succeeded',
      plannerPaymentIntentId: 'payment-intent-1',
      platformFeeCents: 500,
    }))
    mockStripePaymentIntentsRetrieve.mockResolvedValue(plannerStripeTruth({
      id: 'pi_manual_capture',
      status: 'requires_capture',
      plannerPaymentIntentId: 'payment-intent-1',
      platformFeeCents: 500,
    }))
    mockStripePaymentIntentsCreate.mockResolvedValue(plannerStripeTruth({
      id: 'pi_planner_deposit_test',
      status: 'requires_capture',
    }))
  })

  it('requires explicit approval before authorization', async () => {
    await expect(authorizePlannerDeposit({
      db: memoryDb(),
      plan,
      approval: { ...approval, status: 'pending' },
      userId: 'user-1',
      customerId: 'cus_test_builder',
      partnerKind: 'venue',
      partnerId: 'venue-1',
      amountCents: 12_500,
      paymentMethodId: 'pm_test',
    })).rejects.toThrow(/Approval must be authorized/)
  })

  it('rejects unsafe cents instead of rounding', async () => {
    await expect(authorizePlannerDeposit({
      db: memoryDb(),
      plan,
      approval,
      userId: 'user-1',
      customerId: 'cus_test_builder',
      partnerKind: 'venue',
      partnerId: 'venue-1',
      amountCents: 12_500.25,
      paymentMethodId: 'pm_test',
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
      failure_reason: null,
      capture_attempt_id: null,
      capture_started_at: null,
      capture_effects_started_at: null,
      capture_effects_completed_at: null,
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

  it('reserves capture before Stripe so only one concurrent capture reaches Stripe', async () => {
    const db = memoryDb()
    const intent = {
      id: 'payment-intent-1',
      plan_id: 'plan-1',
      approval_id: 'approval-1',
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 12_500,
      currency: 'usd',
      status: 'authorized',
      stripe_payment_intent_id: 'pi_manual_capture',
      authorized_at: new Date().toISOString(),
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: 500,
      failure_reason: null,
      capture_attempt_id: null,
      capture_started_at: null,
      capture_effects_started_at: null,
      capture_effects_completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } satisfies PlannerPaymentIntentRow
    db.rows.payment_intents.push(intent)

    const results = await Promise.allSettled([
      capturePlannerDeposit({
        db,
        paymentIntent: intent,
        approval,
        explicitUserConfirmation: true,
      }),
      capturePlannerDeposit({
        db,
        paymentIntent: intent,
        approval,
        explicitUserConfirmation: true,
      }),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({
      reason: expect.any(PaymentCaptureAlreadyInProgressError),
    })
    expect(mockStripePaymentIntentsCapture).toHaveBeenCalledTimes(1)
    expect(mockStripePaymentIntentsCapture).toHaveBeenCalledWith(
      'pi_manual_capture',
      {},
      {
        idempotencyKey: expect.stringMatching(
          /^planner_deposit_capture_pi_manual_capture_[0-9a-f-]{36}$/
        ),
      }
    )
    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'captured',
      captured_at: expect.any(String),
    }))
    expect(db.rows.payouts).toHaveLength(0)
  })

  it('refuses to capture or create a payout without a Stripe PaymentIntent', async () => {
    const db = memoryDb()
    const intent = {
      id: 'payment-intent-unfunded',
      plan_id: 'plan-1',
      approval_id: 'approval-1',
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 12_500,
      currency: 'usd',
      status: 'requested',
      stripe_payment_intent_id: null,
      authorized_at: null,
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: 0,
      failure_reason: null,
      capture_attempt_id: null,
      capture_started_at: null,
      capture_effects_started_at: null,
      capture_effects_completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } satisfies PlannerPaymentIntentRow
    db.rows.payment_intents.push(intent)

    await expect(capturePlannerDeposit({
      db,
      paymentIntent: intent,
      approval,
      explicitUserConfirmation: true,
    })).rejects.toBeInstanceOf(PlannerDepositNotFundedError)

    expect(db.rows.payment_intents[0].status).toBe('requested')
    expect(db.rows.payouts).toHaveLength(0)
    expect(mockStripePaymentIntentsCapture).not.toHaveBeenCalled()
  })

  it('fails closed before capture when Stripe truth uses automatic capture', async () => {
    const db = memoryDb()
    const intent = {
      id: 'payment-intent-automatic-capture',
      plan_id: plan.id,
      approval_id: approval.id,
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 12_500,
      currency: 'usd',
      status: 'authorized',
      stripe_payment_intent_id: 'pi_automatic_capture',
      authorized_at: new Date().toISOString(),
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: 0,
      failure_reason: null,
      capture_attempt_id: null,
      capture_started_at: null,
      capture_effects_started_at: null,
      capture_effects_completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } satisfies PlannerPaymentIntentRow
    db.rows.payment_intents.push(intent)
    mockStripePaymentIntentsRetrieve.mockResolvedValueOnce(plannerStripeTruth({
      id: 'pi_automatic_capture',
      status: 'succeeded',
      plannerPaymentIntentId: intent.id,
      capture_method: 'automatic',
    }))

    await expect(capturePlannerDeposit({
      db,
      paymentIntent: intent,
      approval,
      explicitUserConfirmation: true,
    })).rejects.toMatchObject({ code: 'payment_stripe_invariant_mismatch' })

    expect(db.rows.payment_intents[0].status).toBe('authorized')
    expect(db.rows.payouts).toHaveLength(0)
    expect(mockStripePaymentIntentsCapture).not.toHaveBeenCalled()
  })

  it('requires a payment method before reserving a planner deposit', async () => {
    const db = memoryDb()

    await expect(authorizePlannerDeposit({
      db,
      plan,
      approval,
      userId: 'user-1',
      customerId: 'cus_test_builder',
      partnerKind: 'venue',
      partnerId: 'venue-1',
      amountCents: 12_500,
      paymentMethodId: '   ',
    })).rejects.toBeInstanceOf(PlannerDepositPaymentMethodRequiredError)

    expect(db.rows.payment_intents).toHaveLength(0)
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('rejects an active intent with a different amount regardless of reservation age', async () => {
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
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: new Date().toISOString(),
    })

    await expect(authorizePlannerDeposit({
      db,
      plan,
      approval,
      userId: 'user-1',
      customerId: 'cus_test_builder',
      partnerKind: 'venue',
      partnerId: 'venue-1',
      amountCents: 12_500,
      paymentMethodId: 'pm_test',
    })).rejects.toThrow(
      'Deposit authorization amount conflicts with the active reservation (existing: $100.00, requested: $125.00). Refresh and review the approved payment.'
    )
  })

  it('reserves before Stripe and converges same-amount races on one Stripe idempotency key', async () => {
    const db = memoryDb()

    const [first, second] = await Promise.all([
      authorizePlannerDeposit({
        db,
        plan,
        approval,
        userId: 'user-1',
        customerId: 'cus_test_builder',
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
        customerId: 'cus_test_builder',
        partnerKind: 'venue',
        partnerId: 'venue-1',
        amountCents: 12_500,
        paymentMethodId: 'pm_test_same_amount',
      }),
    ])

    expect(db.rows.payment_intents).toHaveLength(1)
    expect(first).toEqual(second)
    expect(first).toEqual(expect.objectContaining({
      approval_id: approval.id,
      amount_cents: 12_500,
      status: 'authorized',
      stripe_payment_intent_id: 'pi_planner_deposit_test',
    }))
    expect(mockStripePaymentIntentsCreate.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(mockStripePaymentIntentsCreate.mock.calls.length).toBeLessThanOrEqual(2)
    expect(new Set(mockStripePaymentIntentsCreate.mock.calls.map((call) => call[1].idempotencyKey))).toEqual(
      new Set([`planner_deposit_${approval.id}_${first.id}_12500`])
    )
    expect(mockStripePaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          payment_kind: 'planner_deposit',
          planner_payment_intent_id: first.id,
          approval_id: approval.id,
        }),
      }),
      { idempotencyKey: `planner_deposit_${approval.id}_${first.id}_12500` }
    )
  })

  it('repairs a legacy null-Stripe reservation and converges concurrent retries', async () => {
    const db = memoryDb()
    mockStripePaymentIntentsCreate.mockResolvedValue(plannerStripeTruth({
      plannerPaymentIntentId: 'payment-intent-legacy-null-stripe',
    }))
    db.rows.payment_intents.push({
      id: 'payment-intent-legacy-null-stripe',
      plan_id: plan.id,
      approval_id: approval.id,
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 12_500,
      currency: 'usd',
      status: 'requested',
      stripe_payment_intent_id: null,
      stripe_payment_method_id: null,
      authorized_at: null,
      captured_at: null,
      refund_terms: 'Refundable up to 7 days before the event unless partner terms override.',
      platform_fee_cents: 0,
      failure_reason: null,
      capture_attempt_id: null,
      capture_started_at: null,
      capture_effects_started_at: null,
      capture_effects_completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    const results = await Promise.all([
      authorizePlannerDeposit({
        db,
        plan,
        approval,
        userId: 'user-1',
        customerId: 'cus_test_builder',
        partnerKind: 'venue',
        partnerId: 'venue-1',
        amountCents: 12_500,
        paymentMethodId: 'pm_legacy_recovery',
      }),
      authorizePlannerDeposit({
        db,
        plan,
        approval,
        userId: 'user-1',
        customerId: 'cus_test_builder',
        partnerKind: 'venue',
        partnerId: 'venue-1',
        amountCents: 12_500,
        paymentMethodId: 'pm_legacy_recovery',
      }),
    ])

    expect(results[0]).toEqual(results[1])
    expect(results[0]).toEqual(expect.objectContaining({
      id: 'payment-intent-legacy-null-stripe',
      status: 'authorized',
      stripe_payment_intent_id: 'pi_planner_deposit_test',
    }))
    expect(mockStripePaymentIntentsCreate).toHaveBeenCalledTimes(2)
    expect(mockStripePaymentIntentsCreate.mock.calls.map((call) => call[1])).toEqual([
      {
        idempotencyKey: `planner_deposit_${approval.id}_payment-intent-legacy-null-stripe_12500`,
      },
      {
        idempotencyKey: `planner_deposit_${approval.id}_payment-intent-legacy-null-stripe_12500`,
      },
    ])
  })

  it('rejects a conflicting payment method before a same-amount race can reach Stripe', async () => {
    const db = memoryDb()
    const results = await Promise.allSettled([
      authorizePlannerDeposit({
        db,
        plan,
        approval,
        userId: 'user-1',
        customerId: 'cus_test_builder',
        partnerKind: 'venue',
        partnerId: 'venue-1',
        amountCents: 12_500,
        paymentMethodId: 'pm_race_first',
      }),
      authorizePlannerDeposit({
        db,
        plan,
        approval,
        userId: 'user-1',
        customerId: 'cus_test_builder',
        partnerKind: 'venue',
        partnerId: 'venue-1',
        amountCents: 12_500,
        paymentMethodId: 'pm_race_second',
      }),
    ])

    const fulfilled = results.find((result) => result.status === 'fulfilled')
    const rejected = results.find((result) => result.status === 'rejected')
    expect(fulfilled).toEqual(expect.objectContaining({ status: 'fulfilled' }))
    expect(rejected).toEqual(expect.objectContaining({
      status: 'rejected',
      reason: expect.objectContaining({
        code: 'payment_authorization_conflict',
      }),
    }))
    expect(db.rows.payment_intents).toHaveLength(1)
    expect(mockStripePaymentIntentsCreate).toHaveBeenCalledTimes(1)
    expect(mockStripePaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_method: db.rows.payment_intents[0].stripe_payment_method_id,
        metadata: expect.objectContaining({
          partner_kind: db.rows.payment_intents[0].partner_kind,
          partner_id: db.rows.payment_intents[0].partner_id,
        }),
      }),
      expect.any(Object)
    )
  })

  it('binds a Stripe authorization returned after the local reservation was account-blocked', async () => {
    const db = memoryDb()
    mockStripePaymentIntentsCreate.mockImplementationOnce(async () => {
      Object.assign(db.rows.payment_intents[0], {
        status: 'blocked_by_account_state',
        account_state_blocked_previous_status: 'pending',
        account_state_blocked_stripe_account_id: 'acct_blocked_during_create',
      })
      return plannerStripeTruth({ id: 'pi_blocked_during_create' })
    })

    await expect(authorizePlannerDeposit({
      db,
      plan,
      approval,
      userId: 'user-1',
      customerId: 'cus_test_builder',
      partnerKind: 'venue',
      partnerId: 'venue-1',
      amountCents: 12_500,
      paymentMethodId: 'pm_blocked_during_create',
    })).rejects.toMatchObject({ code: 'payment_account_blocked' })

    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'blocked_by_account_state',
      stripe_payment_intent_id: 'pi_blocked_during_create',
      account_state_blocked_previous_status: 'authorized',
      authorized_at: expect.any(String),
    }))
  })

  it('keeps an account-blocked Stripe hold in the active authorization guard', async () => {
    const db = memoryDb()
    db.rows.payment_intents.push({
      id: 'payment-intent-account-blocked',
      plan_id: plan.id,
      approval_id: approval.id,
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 12_500,
      currency: 'usd',
      status: 'blocked_by_account_state',
      stripe_payment_intent_id: 'pi_account_blocked_hold',
      stripe_payment_method_id: 'pm_account_blocked',
      authorized_at: new Date().toISOString(),
      captured_at: null,
      refund_terms: 'Refundable up to 7 days before the event unless partner terms override.',
      platform_fee_cents: 0,
      failure_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    await expect(authorizePlannerDeposit({
      db,
      plan,
      approval,
      userId: 'user-1',
      customerId: 'cus_test_builder',
      partnerKind: 'venue',
      partnerId: 'venue-1',
      amountCents: 12_500,
      paymentMethodId: 'pm_account_blocked',
    })).rejects.toMatchObject({ code: 'payment_account_blocked' })

    expect(db.rows.payment_intents).toHaveLength(1)
    expect(db.rows.payment_intents[0].stripe_payment_intent_id).toBe('pi_account_blocked_hold')
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('blocks the loser before Stripe when concurrent authorizations use different amounts', async () => {
    const db = memoryDb()

    const results = await Promise.allSettled([
      authorizePlannerDeposit({
        db,
        plan,
        approval,
        userId: 'user-1',
        customerId: 'cus_test_builder',
        partnerKind: 'venue',
        partnerId: 'venue-1',
        amountCents: 12_500,
        paymentMethodId: 'pm_test_winner',
      }),
      authorizePlannerDeposit({
        db,
        plan,
        approval,
        userId: 'user-1',
        customerId: 'cus_test_builder',
        partnerKind: 'venue',
        partnerId: 'venue-1',
        amountCents: 15_000,
        paymentMethodId: 'pm_test_loser',
      }),
    ])

    expect(db.rows.payment_intents).toHaveLength(1)
    expect(mockStripePaymentIntentsCreate).toHaveBeenCalledTimes(1)
    expect(mockStripePaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 12_500,
        payment_method: 'pm_test_winner',
      }),
      { idempotencyKey: `planner_deposit_${approval.id}_payment_intents-1_12500` }
    )

    const rejected = results.find((result) => result.status === 'rejected')
    const fulfilled = results.find((result) => result.status === 'fulfilled')
    expect(fulfilled).toEqual(expect.objectContaining({ status: 'fulfilled' }))
    expect(rejected).toEqual(expect.objectContaining({
      status: 'rejected',
      reason: expect.any(Error),
    }))
    if (rejected?.status === 'rejected') {
      expect(rejected.reason.message).toBe(
        'Deposit authorization amount conflicts with the active reservation (existing: $125.00, requested: $150.00). Refresh and review the approved payment.'
      )
    }
  })

  it('keeps an ambiguous Stripe error on the same active reservation and idempotency key', async () => {
    const db = memoryDb()
    mockStripePaymentIntentsCreate.mockRejectedValueOnce(new Error('Stripe request timed out'))

    await expect(authorizePlannerDeposit({
      db,
      plan,
      approval,
      userId: 'user-1',
      customerId: 'cus_test_builder',
      partnerKind: 'venue',
      partnerId: 'venue-1',
      amountCents: 12_500,
      paymentMethodId: 'pm_card_visa',
    })).rejects.toThrow('Stripe request timed out')

    expect(db.rows.payment_intents).toHaveLength(1)
    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      approval_id: approval.id,
      amount_cents: 12_500,
      status: 'pending',
      stripe_payment_intent_id: null,
      stripe_payment_method_id: 'pm_card_visa',
      failure_reason: null,
    }))

    const retried = await authorizePlannerDeposit({
      db,
      plan,
      approval,
      userId: 'user-1',
      customerId: 'cus_test_builder',
      partnerKind: 'venue',
      partnerId: 'venue-1',
      amountCents: 12_500,
      paymentMethodId: 'pm_card_visa',
    })

    expect(retried).toEqual(expect.objectContaining({
      id: 'payment_intents-1',
      status: 'authorized',
    }))
    expect(mockStripePaymentIntentsCreate.mock.calls.map((call) => call[1])).toEqual([
      { idempotencyKey: `planner_deposit_${approval.id}_payment_intents-1_12500` },
      { idempotencyKey: `planner_deposit_${approval.id}_payment_intents-1_12500` },
    ])
  })

  it('retires an authorization reservation only after Stripe retrieval proves terminal failure', async () => {
    const db = memoryDb()
    mockStripePaymentIntentsCreate.mockRejectedValueOnce(Object.assign(
      new Error('Card authorization failed'),
      { payment_intent: { id: 'pi_terminal_authorization_error' } }
    ))
    mockStripePaymentIntentsRetrieve.mockResolvedValueOnce(plannerStripeTruth({
      id: 'pi_terminal_authorization_error',
      status: 'requires_payment_method',
      last_payment_error: { message: 'Card declined after Stripe verification' },
    }))

    await expect(authorizePlannerDeposit({
      db,
      plan,
      approval,
      userId: 'user-1',
      customerId: 'cus_test_builder',
      partnerKind: 'venue',
      partnerId: 'venue-1',
      amountCents: 12_500,
      paymentMethodId: 'pm_card_declined',
    })).rejects.toThrow('Card declined after Stripe verification')

    expect(mockStripePaymentIntentsRetrieve).toHaveBeenCalledWith(
      'pi_terminal_authorization_error'
    )
    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'failed',
      stripe_payment_intent_id: 'pi_terminal_authorization_error',
      failure_reason: 'Card declined after Stripe verification',
    }))
  })

  it('uses a new Stripe idempotency key for a new local intent after a failed authorization', async () => {
    const db = memoryDb()
    mockStripePaymentIntentsCreate
      .mockResolvedValueOnce(plannerStripeTruth({
        id: 'pi_declined_first_authorization',
        status: 'requires_payment_method',
        last_payment_error: { message: 'Card declined' },
      }))
      .mockResolvedValueOnce(plannerStripeTruth({
        plannerPaymentIntentId: 'payment_intents-2',
      }))

    await expect(authorizePlannerDeposit({
      db,
      plan,
      approval,
      userId: 'user-1',
      customerId: 'cus_test_builder',
      partnerKind: 'venue',
      partnerId: 'venue-1',
      amountCents: 12_500,
      paymentMethodId: 'pm_card_declined',
    })).rejects.toThrow('Card declined')

    const authorized = await authorizePlannerDeposit({
      db,
      plan,
      approval,
      userId: 'user-1',
      customerId: 'cus_test_builder',
      partnerKind: 'venue',
      partnerId: 'venue-1',
      amountCents: 12_500,
      paymentMethodId: 'pm_card_replacement',
    })

    expect(authorized).toEqual(expect.objectContaining({
      id: 'payment_intents-2',
      status: 'authorized',
    }))
    expect(mockStripePaymentIntentsCreate.mock.calls.map((call) => call[1])).toEqual([
      { idempotencyKey: `planner_deposit_${approval.id}_payment_intents-1_12500` },
      { idempotencyKey: `planner_deposit_${approval.id}_payment_intents-2_12500` },
    ])
  })

  it('fails the reservation when Stripe does not produce a capturable authorization', async () => {
    const db = memoryDb()
    mockStripePaymentIntentsCreate.mockResolvedValueOnce(plannerStripeTruth({
      id: 'pi_declined_authorization',
      status: 'requires_payment_method',
      last_payment_error: { message: 'Your card was declined.' },
    }))

    await expect(authorizePlannerDeposit({
      db,
      plan,
      approval,
      userId: 'user-1',
      customerId: 'cus_test_builder',
      partnerKind: 'venue',
      partnerId: 'venue-1',
      amountCents: 12_500,
      paymentMethodId: 'pm_card_declined',
    })).rejects.toThrow('Your card was declined.')

    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'failed',
      stripe_payment_intent_id: 'pi_declined_authorization',
      failure_reason: 'Your card was declined.',
    }))
  })

  it.each(['requires_action', 'requires_confirmation']) (
    'persists a %s authorization and retrieves the same Stripe intent on retry',
    async (stripeStatus) => {
      const db = memoryDb()
      const stripeTruth = plannerStripeTruth({
        id: `pi_${stripeStatus}`,
        status: stripeStatus,
        client_secret: `secret_${stripeStatus}`,
        next_action: { type: 'use_stripe_sdk' },
      })
      mockStripePaymentIntentsCreate.mockResolvedValueOnce(stripeTruth)
      mockStripePaymentIntentsRetrieve.mockResolvedValueOnce(stripeTruth)

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(authorizePlannerDeposit({
          db,
          plan,
          approval,
          userId: 'user-1',
          customerId: 'cus_test_builder',
          partnerKind: 'venue',
          partnerId: 'venue-1',
          amountCents: 12_500,
          paymentMethodId: 'pm_action_required',
        })).rejects.toMatchObject({
          code: 'payment_authorization_action_required',
          stripeStatus,
          clientSecret: `secret_${stripeStatus}`,
          nextAction: { type: 'use_stripe_sdk' },
        })
      }

      expect(db.rows.payment_intents).toHaveLength(1)
      expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
        status: 'pending',
        stripe_payment_intent_id: `pi_${stripeStatus}`,
      }))
      expect(mockStripePaymentIntentsCreate).toHaveBeenCalledTimes(1)
      expect(mockStripePaymentIntentsRetrieve).toHaveBeenCalledTimes(1)
      expect(mockStripePaymentIntentsRetrieve).toHaveBeenCalledWith(`pi_${stripeStatus}`)
    }
  )

  it('reconciles the same SCA PaymentIntent to requires_capture without creating another', async () => {
    const db = memoryDb()
    mockStripePaymentIntentsCreate.mockResolvedValueOnce(plannerStripeTruth({
      id: 'pi_sca_reconcile',
      status: 'requires_action',
      client_secret: 'secret_sca_reconcile',
      next_action: { type: 'use_stripe_sdk' },
    }))
    mockStripePaymentIntentsRetrieve.mockResolvedValueOnce(plannerStripeTruth({
      id: 'pi_sca_reconcile',
      status: 'requires_capture',
    }))

    await expect(authorizePlannerDeposit({
      db,
      plan,
      approval,
      userId: 'user-1',
      customerId: 'cus_test_builder',
      partnerKind: 'venue',
      partnerId: 'venue-1',
      amountCents: 12_500,
      paymentMethodId: 'pm_sca_reconcile',
    })).rejects.toMatchObject({ code: 'payment_authorization_action_required' })

    const reconciled = await authorizePlannerDeposit({
      db,
      plan,
      approval,
      userId: 'user-1',
      customerId: 'cus_test_builder',
      partnerKind: 'venue',
      partnerId: 'venue-1',
      amountCents: 12_500,
      paymentMethodId: 'pm_sca_reconcile',
    })

    expect(reconciled).toEqual(expect.objectContaining({
      status: 'authorized',
      stripe_payment_intent_id: 'pi_sca_reconcile',
      authorized_at: expect.any(String),
    }))
    expect(mockStripePaymentIntentsCreate).toHaveBeenCalledTimes(1)
    expect(mockStripePaymentIntentsRetrieve).toHaveBeenCalledTimes(1)
  })

  it('keeps a nonterminal capture state reserved for reconciliation', async () => {
    const db = memoryDb()
    const intent = {
      id: 'payment-intent-capture-action',
      plan_id: plan.id,
      approval_id: approval.id,
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 12_500,
      currency: 'usd',
      status: 'authorized',
      stripe_payment_intent_id: 'pi_capture_action',
      authorized_at: new Date().toISOString(),
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: 0,
      failure_reason: null,
      capture_attempt_id: null,
      capture_started_at: null,
      capture_effects_started_at: null,
      capture_effects_completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } satisfies PlannerPaymentIntentRow
    db.rows.payment_intents.push(intent)
    mockStripePaymentIntentsRetrieve.mockResolvedValueOnce(plannerStripeTruth({
      id: 'pi_capture_action',
      status: 'requires_capture',
      plannerPaymentIntentId: 'payment-intent-capture-action',
    }))
    mockStripePaymentIntentsCapture.mockReset().mockResolvedValueOnce(plannerStripeTruth({
      id: 'pi_capture_action',
      status: 'requires_action',
      plannerPaymentIntentId: 'payment-intent-capture-action',
    }))

    await expect(capturePlannerDeposit({
      db,
      paymentIntent: intent,
      approval,
      explicitUserConfirmation: true,
    })).rejects.toBeInstanceOf(PaymentCaptureAlreadyInProgressError)

    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'capturing',
      failure_reason: expect.stringContaining('reconciliation will retry'),
    }))
  })

  it('keeps captured state when an older failure webhook arrives', async () => {
    const db = memoryDb()
    db.rows.payment_intents.push({
      id: 'payment-intent-webhook-order',
      plan_id: plan.id,
      approval_id: approval.id,
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 12_500,
      currency: 'usd',
      status: 'authorized',
      stripe_payment_intent_id: 'pi_webhook_order',
      authorized_at: new Date().toISOString(),
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: 0,
      failure_reason: null,
      capture_attempt_id: '11111111-1111-4111-8111-111111111111',
      capture_started_at: new Date().toISOString(),
      capture_effects_started_at: null,
      capture_effects_completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    await applyPlannerStripePaymentIntentWebhook(db, plannerStripeTruth({
      id: 'pi_webhook_order',
      status: 'succeeded',
      plannerPaymentIntentId: 'payment-intent-webhook-order',
    }))
    mockStripePaymentIntentsRetrieve.mockResolvedValueOnce(plannerStripeTruth({
      id: 'pi_webhook_order',
      status: 'succeeded',
      plannerPaymentIntentId: 'payment-intent-webhook-order',
    }))
    await applyPlannerStripePaymentIntentWebhook(db, {
      id: 'pi_webhook_order',
      status: 'requires_payment_method',
      metadata: {
        payment_kind: 'planner_deposit',
        planner_payment_intent_id: 'payment-intent-webhook-order',
      },
      last_payment_error: { message: 'Older failed attempt' },
    })

    expect(mockStripePaymentIntentsRetrieve).toHaveBeenCalledWith('pi_webhook_order')
    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'captured',
      failure_reason: null,
    }))
  })

  it('does not let an older PaymentIntent event clear unknown refund work', async () => {
    const db = memoryDb()
    db.rows.payment_intents.push({
      id: 'payment-intent-refund-unknown',
      plan_id: plan.id,
      approval_id: approval.id,
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 12_500,
      currency: 'usd',
      status: 'refund_reconciliation_required',
      stripe_payment_intent_id: 'pi_refund_unknown',
      refunded_amount_cents: 0,
      authorized_at: new Date().toISOString(),
      captured_at: new Date().toISOString(),
      refund_terms: 'Refundable',
      platform_fee_cents: 0,
      failure_reason: null,
      capture_attempt_id: '22222222-2222-4222-8222-222222222223',
      capture_started_at: new Date().toISOString(),
      capture_effects_started_at: null,
      capture_effects_completed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    await expect(applyPlannerStripePaymentIntentWebhook(db, plannerStripeTruth({
      id: 'pi_refund_unknown',
      status: 'succeeded',
      plannerPaymentIntentId: 'payment-intent-refund-unknown',
    }))).resolves.toBe(true)

    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'refund_reconciliation_required',
      refunded_amount_cents: 0,
    }))
  })

  it('throws when the planner webhook database update fails so delivery remains retriable', async () => {
    const db = memoryDb()
    db.rows.payment_intents.push({
      id: 'payment-intent-webhook-error',
      plan_id: plan.id,
      approval_id: approval.id,
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 12_500,
      currency: 'usd',
      status: 'authorized',
      stripe_payment_intent_id: 'pi_webhook_error',
      authorized_at: new Date().toISOString(),
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: 0,
      failure_reason: null,
      capture_attempt_id: '22222222-2222-4222-8222-222222222222',
      capture_started_at: new Date().toISOString(),
      capture_effects_started_at: null,
      capture_effects_completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    const originalFrom = db.from.bind(db)
    jest.spyOn(db, 'from').mockImplementation((table: string) => {
      const query = originalFrom(table)
      if (table === 'payment_intents') {
        const originalUpdate = query.update.bind(query)
        query.update = (payload: Record<string, unknown>) => {
          const updateQuery = originalUpdate(payload)
          updateQuery.maybeSingle = async () => ({
            data: null,
            error: { message: 'planner webhook update unavailable' },
          })
          return updateQuery
        }
      }
      return query
    })

    await expect(applyPlannerStripePaymentIntentWebhook(db, plannerStripeTruth({
      id: 'pi_webhook_error',
      status: 'succeeded',
      plannerPaymentIntentId: 'payment-intent-webhook-error',
    }))).rejects.toThrow('planner webhook update unavailable')
  })

  it('rejects webhook metadata that points at a row bound to another Stripe PaymentIntent', async () => {
    const db = memoryDb()
    db.rows.payment_intents.push({
      id: 'payment-intent-webhook-identity',
      plan_id: plan.id,
      approval_id: approval.id,
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 12_500,
      currency: 'usd',
      status: 'authorized',
      stripe_payment_intent_id: 'pi_expected_identity',
      authorized_at: new Date().toISOString(),
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: 0,
      failure_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    await expect(applyPlannerStripePaymentIntentWebhook(db, {
      id: 'pi_wrong_identity',
      status: 'succeeded',
      metadata: {
        payment_kind: 'planner_deposit',
        planner_payment_intent_id: 'payment-intent-webhook-identity',
      },
    })).rejects.toThrow('Planner deposit Stripe identity mismatch')

    expect(db.rows.payment_intents[0].status).toBe('authorized')
  })

  it.each([
    ['amount', { amount: 12_501 }],
    ['metadata', { metadata: { plan_id: 'plan-drifted' } }],
  ])('rejects bound webhook %s drift before a local transition', async (_label, drift) => {
    const db = memoryDb()
    const localId = 'payment-intent-bound-drift'
    db.rows.payment_intents.push({
      id: localId,
      plan_id: plan.id,
      approval_id: approval.id,
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 12_500,
      currency: 'usd',
      status: 'authorized',
      stripe_payment_intent_id: 'pi_bound_drift',
      authorized_at: new Date().toISOString(),
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: 0,
      failure_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    const driftRecord = drift as {
      amount?: number
      metadata?: Record<string, string>
    }

    await expect(applyPlannerStripePaymentIntentWebhook(db, plannerStripeTruth({
      id: 'pi_bound_drift',
      status: 'succeeded',
      plannerPaymentIntentId: localId,
      ...(driftRecord.amount === undefined ? {} : { amount: driftRecord.amount }),
      metadata: driftRecord.metadata,
    }))).rejects.toMatchObject({ code: 'payment_stripe_invariant_mismatch' })

    expect(db.rows.payment_intents[0].status).toBe('authorized')
    expect(db.rows.payouts).toHaveLength(0)
  })

  it('validates complete Stripe identity before initially binding an amount-capturable webhook', async () => {
    const db = memoryDb()
    db.rows.payment_intents.push({
      id: 'payment-intent-webhook-initial-bind',
      plan_id: plan.id,
      approval_id: approval.id,
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 12_500,
      currency: 'usd',
      status: 'pending',
      stripe_payment_intent_id: null,
      stripe_payment_method_id: 'pm_initial_bind',
      authorized_at: null,
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: 500,
      failure_reason: null,
      capture_attempt_id: null,
      capture_started_at: null,
      capture_effects_started_at: null,
      capture_effects_completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    await expect(applyPlannerStripePaymentIntentWebhook(db, {
      id: 'pi_webhook_initial_bind',
      status: 'requires_capture',
      amount: 12_500,
      currency: 'USD',
      capture_method: 'manual',
      metadata: {
        payment_kind: 'planner_deposit',
        planner_payment_intent_id: 'payment-intent-webhook-initial-bind',
        plan_id: plan.id,
        approval_id: approval.id,
        partner_kind: 'venue',
        partner_id: 'venue-1',
        platform_fee_cents: '500',
      },
    })).resolves.toBe(true)

    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'authorized',
      stripe_payment_intent_id: 'pi_webhook_initial_bind',
      authorized_at: expect.any(String),
    }))
  })

  it.each([
    ['amount', { amount: 12_501 }],
    ['currency', { currency: 'eur' }],
    ['plan', { metadata: { plan_id: 'plan-wrong' } }],
    ['approval', { metadata: { approval_id: 'approval-wrong' } }],
    ['partner kind', { metadata: { partner_kind: 'vendor' } }],
    ['partner id', { metadata: { partner_id: 'venue-wrong' } }],
    ['platform fee', { metadata: { platform_fee_cents: '501' } }],
    ['capture method', { capture_method: 'automatic' }],
  ])('rejects an unbound webhook with mismatched %s identity', async (_label, mismatch) => {
    const db = memoryDb()
    db.rows.payment_intents.push({
      id: 'payment-intent-webhook-unbound-mismatch',
      plan_id: plan.id,
      approval_id: approval.id,
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 12_500,
      currency: 'usd',
      status: 'pending',
      stripe_payment_intent_id: null,
      authorized_at: null,
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: 500,
      failure_reason: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    const baseMetadata = {
      payment_kind: 'planner_deposit',
      planner_payment_intent_id: 'payment-intent-webhook-unbound-mismatch',
      plan_id: plan.id,
      approval_id: approval.id,
      partner_kind: 'venue',
      partner_id: 'venue-1',
      platform_fee_cents: '500',
    }
    const mismatchRecord = mismatch as {
      amount?: number
      currency?: string
      capture_method?: string
      metadata?: Record<string, string>
    }

    await expect(applyPlannerStripePaymentIntentWebhook(db, {
      id: 'pi_webhook_unbound_mismatch',
      status: 'requires_capture',
      amount: mismatchRecord.amount ?? 12_500,
      currency: mismatchRecord.currency ?? 'usd',
      capture_method: mismatchRecord.capture_method ?? 'manual',
      metadata: { ...baseMetadata, ...(mismatchRecord.metadata ?? {}) },
    })).rejects.toThrow('Stripe PaymentIntent details do not match the approved planner payment')

    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'pending',
      stripe_payment_intent_id: null,
    }))
  })

  it('retries a planner-tagged PaymentIntent webhook when the local row is missing', async () => {
    await expect(applyPlannerStripePaymentIntentWebhook(memoryDb(), {
      id: 'pi_missing_local',
      status: 'succeeded',
      metadata: {
        payment_kind: 'planner_deposit',
        planner_payment_intent_id: 'payment-intent-missing-local',
      },
    })).rejects.toThrow('Planner deposit webhook has no matching local payment')
  })

  it('throws when the planner refund webhook database update fails so delivery remains retriable', async () => {
    const db = {
      from: jest.fn(),
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'planner refund update unavailable' },
      }),
    }

    await expect(
      applyPlannerStripeRefundWebhook(db, 'pi_refund_webhook_error', {
        chargeAmountCapturedCents: 12_500,
        refundedAmountCents: 2_500,
        currency: 'usd',
        eventId: 'evt_refund_error',
        fullyRefunded: false,
      })
    ).rejects.toThrow('planner refund update unavailable')
  })

  it('retries a planner-tagged refund when no local payment row matched', async () => {
    const db = {
      from: jest.fn(),
      rpc: jest.fn().mockResolvedValue({ data: { matched: false }, error: null }),
    }
    await expect(
      applyPlannerStripeRefundWebhook(db, 'pi_missing_planner_refund', {
        chargeAmountCapturedCents: 12_500,
        refundedAmountCents: 2_500,
        currency: 'usd',
        eventId: 'evt_missing_refund',
        fullyRefunded: false,
      }, true)
    ).rejects.toThrow('Planner deposit refund has no matching local payment')
  })

  it('passes cumulative partial and full Stripe refund snapshots to the atomic RPC', async () => {
    const db = {
      from: jest.fn(),
      rpc: jest.fn()
        .mockResolvedValueOnce({
          data: { matched: true, status: 'captured', refunded_amount_cents: 2_500 },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { matched: true, status: 'refunded', refunded_amount_cents: 12_500 },
          error: null,
        }),
    }

    await expect(applyPlannerStripeRefundWebhook(db, 'pi_refund_cumulative', {
      chargeAmountCapturedCents: 12_500,
      refundedAmountCents: 2_500,
      currency: 'usd',
      eventId: 'evt_refund_partial',
      fullyRefunded: false,
    }, true)).resolves.toBe(true)
    await expect(applyPlannerStripeRefundWebhook(db, 'pi_refund_cumulative', {
      chargeAmountCapturedCents: 12_500,
      refundedAmountCents: 12_500,
      currency: 'usd',
      eventId: 'evt_refund_full',
      fullyRefunded: true,
    }, true)).resolves.toBe(true)

    expect(db.rpc).toHaveBeenNthCalledWith(1, 'apply_planner_deposit_refund', {
      p_stripe_payment_intent_id: 'pi_refund_cumulative',
      p_charge_amount_captured_cents: 12_500,
      p_refunded_amount_cents: 2_500,
      p_currency: 'usd',
      p_event_id: 'evt_refund_partial',
      p_charge_refunded: false,
    })
    expect(db.rpc).toHaveBeenNthCalledWith(2, 'apply_planner_deposit_refund', {
      p_stripe_payment_intent_id: 'pi_refund_cumulative',
      p_charge_amount_captured_cents: 12_500,
      p_refunded_amount_cents: 12_500,
      p_currency: 'usd',
      p_event_id: 'evt_refund_full',
      p_charge_refunded: true,
    })
  })
})
