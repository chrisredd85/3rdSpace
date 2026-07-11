import type { NextRequest } from 'next/server'
import { GET } from '@/app/api/admin/reconcile/captured-deposits/route'
import { getWorkerOrAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import * as Sentry from '@sentry/nextjs'

const mockStripeCapture = jest.fn()
const mockStripeRetrieve = jest.fn()
const mockStripeChargeRetrieve = jest.fn()

jest.mock('@/lib/stripe/connect', () => ({
  getStripeClient: jest.fn(() => ({
    paymentIntents: {
      capture: mockStripeCapture,
      retrieve: mockStripeRetrieve,
    },
    charges: {
      retrieve: mockStripeChargeRetrieve,
    },
  })),
}))

jest.mock('@/lib/server/admin-auth', () => ({
  getWorkerOrAdminContext: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  metrics: {
    count: jest.fn(),
  },
}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => {
      const headers = new Headers(init?.headers)
      headers.set('content-type', 'application/json')
      return new Response(JSON.stringify(data), {
        ...init,
        status: init?.status ?? 200,
        headers,
      })
    },
  },
}))

const mockGetWorkerOrAdminContext = getWorkerOrAdminContext as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock
const mockCaptureException = Sentry.captureException as jest.Mock
const mockCaptureMessage = Sentry.captureMessage as jest.Mock
const mockMetricCount = Sentry.metrics.count as jest.Mock

type Row = Record<string, unknown>

class MemoryDb {
  rows: Record<string, Row[]> = {
    payment_intents: [],
    payouts: [],
    approvals: [],
    agent_actions: [],
    agent_action_audit_log: [],
  }
  staleCaptureSelectBarrier: (() => Promise<void>) | null = null
  beforePayoutInsert: (() => Promise<void>) | null = null
  refundRpcCalls = 0

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }

  async rpc(name: string, params: Row) {
    if (name === 'apply_planner_deposit_refund') {
      this.refundRpcCalls += 1
      const payment = this.rows.payment_intents.find(
        (row) => row.stripe_payment_intent_id === params.p_stripe_payment_intent_id
      )
      if (!payment) return { data: { matched: false }, error: null }

      const previousRefund = Number(payment.refunded_amount_cents ?? 0)
      const effectiveRefund = Math.max(
        previousRefund,
        Number(params.p_refunded_amount_cents ?? 0)
      )
      const targetAmount = Math.max(
        0,
        Number(payment.amount_cents ?? 0) -
          Number(payment.platform_fee_cents ?? 0) -
          effectiveRefund
      )
      const payout = this.rows.payouts.find((row) => row.payment_intent_id === payment.id)
      if (payout) {
        payout.amount_cents = targetAmount
        payout.status = targetAmount === 0 ? 'cancelled' : 'pending'
      } else if (targetAmount > 0) {
        this.rows.payouts.push({
          id: this.nextId('payouts'),
          payment_intent_id: payment.id,
          partner_kind: payment.partner_kind,
          partner_id: payment.partner_id,
          amount_cents: targetAmount,
          currency: payment.currency,
          status: 'pending',
        })
      }
      payment.refunded_amount_cents = effectiveRefund
      payment.refund_updated_at = new Date().toISOString()
      payment.last_refund_event_id = params.p_event_id
      payment.status = effectiveRefund === Number(payment.amount_cents)
        ? 'refunded'
        : 'captured'
      payment.updated_at = new Date().toISOString()

      return {
        data: {
          matched: true,
          status: payment.status,
          refunded_amount_cents: effectiveRefund,
          target_payout_amount_cents: targetAmount,
        },
        error: null,
      }
    }
    if (name !== 'ensure_planner_deposit_payout') {
      return { data: null, error: { message: `Unknown RPC ${name}` } }
    }
    await this.beforePayoutInsert?.()
    const payment = this.rows.payment_intents.find((row) => row.id === params.p_payment_intent_id)
    if (!payment) return { data: null, error: { message: 'Payment not found' } }
    const existing = this.rows.payouts.find((row) => row.payment_intent_id === payment.id)
    const amount = Math.max(
      0,
      Number(payment.amount_cents ?? 0) -
        Number(payment.platform_fee_cents ?? 0) -
        Number(payment.refunded_amount_cents ?? 0)
    )
    if (!existing && amount > 0) {
      this.rows.payouts.push({
        id: this.nextId('payouts'),
        payment_intent_id: payment.id,
        partner_kind: payment.partner_kind,
        partner_id: payment.partner_id,
        amount_cents: amount,
        currency: payment.currency,
        status: 'pending',
      })
      return { data: { created: true }, error: null }
    }
    return { data: { created: false }, error: null }
  }

  nextId(table: string) {
    return `${table}-${this.rows[table].length + 1}`
  }
}

class MemoryQuery {
  private filters: Array<[string, unknown]> = []
  private nullFilters: string[] = []
  private notNullFilters: string[] = []
  private lessThanFilters: Array<[string, string]> = []
  private operation: 'select' | 'insert' | 'update' = 'select'
  private payload: Row | null = null
  private limitCount: number | null = null

  constructor(
    private db: MemoryDb,
    private table: string
  ) {}

  select() {
    return this
  }

  insert(payload: Row) {
    this.operation = 'insert'
    this.payload = payload
    return this
  }

  update(payload: Row) {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push([field, value])
    return this
  }

  is(field: string, value: unknown) {
    if (value === null) this.nullFilters.push(field)
    return this
  }

  not(field: string, operator: string, value: unknown) {
    if (operator === 'is' && value === null) this.notNullFilters.push(field)
    return this
  }

  lt(field: string, value: string) {
    this.lessThanFilters.push([field, value])
    return this
  }

  order() {
    return this
  }

  limit(count: number) {
    this.limitCount = count
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

  then<TResult1 = { data: Row | Row[] | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row | Row[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected)
  }

  private async execute() {
    if (this.operation === 'insert' && this.payload) {
      if (this.table === 'payouts') await this.db.beforePayoutInsert?.()
      if (this.payload.force_error) {
        return { data: null, error: { message: String(this.payload.force_error) } }
      }
      if (
        this.table === 'payouts' &&
        this.db.rows.payouts.some((row) => row.payment_intent_id === this.payload?.payment_intent_id)
      ) {
        return { data: null, error: { code: '23505', message: 'duplicate payout for payment_intent_id' } }
      }

      const row = {
        id: this.payload.id ?? this.db.nextId(this.table),
        created_at: new Date().toISOString(),
        ...this.payload,
      }
      this.db.rows[this.table].push(row)
      return { data: row, error: null }
    }

    if (
      this.operation === 'select' &&
      this.table === 'payment_intents' &&
      this.filters.some(([field, value]) => field === 'status' && value === 'capturing')
    ) {
      await this.db.staleCaptureSelectBarrier?.()
    }

    if (this.operation === 'update' && this.payload) {
      const updated = this.db.rows[this.table]
        .filter((row) => this.matches(row))
        .map((row) => Object.assign(row, this.payload, { updated_at: new Date().toISOString() }))
      return { data: updated.map((row) => ({ ...row })), error: null }
    }

    let selected = this.db.rows[this.table].filter((row) => this.matches(row))
    if (this.limitCount != null) selected = selected.slice(0, this.limitCount)
    return { data: selected.map((row) => ({ ...row })), error: null }
  }

  private matches(row: Row) {
    return (
      this.filters.every(([field, value]) => row[field] === value) &&
      this.nullFilters.every((field) => row[field] == null) &&
      this.notNullFilters.every((field) => row[field] != null) &&
      this.lessThanFilters.every(([field, value]) => String(row[field]) < value)
    )
  }
}

function request() {
  return new Request('http://localhost/api/admin/reconcile/captured-deposits', {
    method: 'GET',
  }) as NextRequest
}

async function readJson(response: Response) {
  return response.json() as Promise<{
    reconciled?: number
    skipped?: number
    errors?: Array<{ payment_intent_id: string; error: string }>
    error?: string
  }>
}

function createBarrier(count: number) {
  let waiting = 0
  let release: (() => void) | null = null
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })

  return async () => {
    waiting += 1
    if (waiting >= count) release?.()
    await promise
  }
}

function oldIso(minutes = 10) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

function paymentIntent(overrides: Row = {}): Row {
  return {
    id: 'payment-intent-1',
    plan_id: 'plan-1',
    approval_id: 'approval-1',
    partner_kind: 'venue',
    partner_id: 'venue-1',
    amount_cents: 25_000,
    platform_fee_cents: 1_000,
    currency: 'usd',
    status: 'capturing',
    stripe_payment_intent_id: 'pi_manual_capture',
    authorized_at: oldIso(30),
    captured_at: null,
    refund_terms: 'Refundable',
    failure_reason: null,
    capture_attempt_id: '11111111-1111-4111-8111-111111111111',
    capture_started_at: oldIso(),
    capture_effects_started_at: null,
    capture_effects_completed_at: null,
    created_at: oldIso(30),
    updated_at: oldIso(),
    ...overrides,
  }
}

function plannerStripeTruth(status: string, overrides: Row = {}) {
  return {
    id: 'pi_manual_capture',
    status,
    amount: 25_000,
    currency: 'usd',
    capture_method: 'manual',
    ...overrides,
    metadata: {
      payment_kind: 'planner_deposit',
      planner_payment_intent_id: 'payment-intent-1',
      plan_id: 'plan-1',
      approval_id: 'approval-1',
      partner_kind: 'venue',
      partner_id: 'venue-1',
      platform_fee_cents: '1000',
      ...(overrides.metadata ?? {}),
    },
  }
}

function seedLinkedAction(db: MemoryDb, status = 'executing') {
  db.rows.approvals.push({
    id: 'approval-1',
    plan_id: 'plan-1',
    agent_action_id: 'action-1',
  })
  db.rows.agent_actions.push({
    id: 'action-1',
    plan_id: 'plan-1',
    action_type: 'payment',
    description: 'Pay venue deposit',
    provider: 'stripe',
    target_type: 'venue',
    target_id: 'venue-1',
    payload_json: {},
    amount_cents: 25_000,
    currency: 'usd',
    status,
    approval_id: 'approval-1',
    executed_at: null,
    result_metadata: {},
    created_at: oldIso(30),
    updated_at: oldIso(30),
  })
}

function authorizedDb() {
  mockGetWorkerOrAdminContext.mockResolvedValue({
    authorized: true,
    user: { id: 'admin-1', email: 'admin@example.com' },
  })
  const db = new MemoryDb()
  seedLinkedAction(db)
  mockCreateServiceRoleClient.mockReturnValue(db)
  return db
}

describe('capture reconciler route', () => {
  beforeEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
    mockStripeCapture.mockResolvedValue(plannerStripeTruth('succeeded'))
    mockStripeRetrieve.mockResolvedValue(plannerStripeTruth('requires_capture'))
    mockStripeChargeRetrieve.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('rejects unauthorized callers before loading service-role Supabase', async () => {
    mockGetWorkerOrAdminContext.mockResolvedValue({
      authorized: false,
      status: 401,
      error: 'Unauthorized',
    })

    const response = await GET(request())
    const body = await readJson(response)

    expect(response.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
  })

  it('keeps a legacy unknown refund durable until exact Stripe truth can adjust its payout', async () => {
    const db = authorizedDb()
    db.rows.payment_intents.push(paymentIntent({
      status: 'refund_reconciliation_required',
      captured_at: oldIso(10),
      refunded_amount_cents: 0,
      refund_updated_at: oldIso(2),
      capture_effects_completed_at: oldIso(10),
      updated_at: oldIso(2),
    }))
    db.rows.payouts.push({
      id: 'payout-1',
      payment_intent_id: 'payment-intent-1',
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 24_000,
      currency: 'usd',
      status: 'pending',
    })
    mockStripeRetrieve.mockRejectedValueOnce(new Error('Stripe refund truth unavailable'))

    const failed = await readJson(await GET(request()))

    expect(failed).toEqual({
      reconciled: 0,
      skipped: 0,
      errors: [{
        payment_intent_id: 'payment-intent-1',
        error: 'Stripe refund truth unavailable',
      }],
    })
    expect(db.refundRpcCalls).toBe(0)
    expect(db.rows.payment_intents[0].status).toBe('refund_reconciliation_required')
    expect(db.rows.payouts[0]).toEqual(expect.objectContaining({ amount_cents: 24_000 }))

    mockStripeRetrieve.mockResolvedValueOnce(plannerStripeTruth('succeeded', {
      latest_charge: {
        id: 'ch_partial_refund',
        payment_intent: 'pi_manual_capture',
        amount_captured: 25_000,
        amount_refunded: 5_000,
        currency: 'usd',
        refunded: false,
      },
    }))

    const recovered = await readJson(await GET(request()))

    expect(recovered).toEqual({ reconciled: 1, skipped: 0, errors: [] })
    expect(db.refundRpcCalls).toBe(1)
    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'captured',
      refunded_amount_cents: 5_000,
    }))
    expect(db.rows.payouts[0]).toEqual(expect.objectContaining({
      amount_cents: 19_000,
      status: 'pending',
    }))
  })

  it('keeps a legacy unknown refund durable when Stripe PaymentIntent identity drifts', async () => {
    const db = authorizedDb()
    db.rows.payment_intents.push(paymentIntent({
      status: 'refund_reconciliation_required',
      captured_at: oldIso(10),
      refunded_amount_cents: 0,
      refund_updated_at: oldIso(2),
      capture_effects_completed_at: oldIso(10),
      updated_at: oldIso(2),
    }))
    db.rows.payouts.push({
      id: 'payout-1',
      payment_intent_id: 'payment-intent-1',
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 24_000,
      currency: 'usd',
      status: 'pending',
    })
    mockStripeRetrieve.mockResolvedValueOnce(plannerStripeTruth('succeeded', {
      metadata: { approval_id: 'different-approval' },
      latest_charge: {
        id: 'ch_identity_drift',
        payment_intent: 'pi_manual_capture',
        amount_captured: 25_000,
        amount_refunded: 5_000,
        currency: 'usd',
        refunded: false,
      },
    }))

    const body = await readJson(await GET(request()))

    expect(body).toEqual({
      reconciled: 0,
      skipped: 0,
      errors: [{
        payment_intent_id: 'payment-intent-1',
        error: 'Stripe PaymentIntent details do not match the approved planner payment.',
      }],
    })
    expect(db.refundRpcCalls).toBe(0)
    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'refund_reconciliation_required',
      refunded_amount_cents: 0,
    }))
    expect(db.rows.payouts[0]).toEqual(expect.objectContaining({ amount_cents: 24_000 }))
  })

  it('recovers death before Stripe by retrieving first and re-attempting once with the durable key', async () => {
    const db = authorizedDb()
    db.rows.payment_intents.push(paymentIntent())

    const response = await GET(request())
    const body = await readJson(response)

    expect(response.status).toBe(200)
    expect(body).toEqual({ reconciled: 1, skipped: 0, errors: [] })
    expect(mockStripeRetrieve).toHaveBeenCalledTimes(1)
    expect(mockStripeCapture).toHaveBeenCalledTimes(1)
    expect(mockStripeRetrieve.mock.invocationCallOrder[0]).toBeLessThan(
      mockStripeCapture.mock.invocationCallOrder[0]
    )
    expect(mockStripeCapture).toHaveBeenCalledWith(
      'pi_manual_capture',
      {},
      {
        idempotencyKey: 'planner_deposit_capture_pi_manual_capture_11111111-1111-4111-8111-111111111111',
      }
    )
    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'captured',
      captured_at: expect.any(String),
      capture_effects_completed_at: expect.any(String),
    }))
    expect(db.rows.payouts).toHaveLength(1)
    expect(db.rows.agent_actions[0]).toEqual(expect.objectContaining({
      status: 'complete',
      executed_at: expect.any(String),
    }))
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      'stale_payment_capture_detected',
      expect.objectContaining({ level: 'warning' })
    )
    expect(mockMetricCount).toHaveBeenCalledWith(
      'planner.stale_capturing.reconciled',
      1,
      expect.any(Object)
    )
  })

  it('recovers death after Stripe success without issuing another capture', async () => {
    const db = authorizedDb()
    db.rows.payment_intents.push(paymentIntent())
    mockStripeRetrieve.mockResolvedValueOnce(plannerStripeTruth('succeeded'))

    const response = await GET(request())
    const body = await readJson(response)

    expect(body).toEqual({ reconciled: 1, skipped: 0, errors: [] })
    expect(mockStripeRetrieve).toHaveBeenCalledTimes(1)
    expect(mockStripeCapture).not.toHaveBeenCalled()
    expect(db.rows.payouts).toHaveLength(1)
    expect(db.rows.agent_actions[0].status).toBe('complete')
  })

  it('repairs payout/action effects after local captured state, then becomes a no-op', async () => {
    const db = authorizedDb()
    db.rows.payment_intents.push(paymentIntent({
      status: 'captured',
      captured_at: oldIso(2),
      updated_at: oldIso(2),
    }))

    const first = await readJson(await GET(request()))
    const second = await readJson(await GET(request()))

    expect(first).toEqual({ reconciled: 1, skipped: 0, errors: [] })
    expect(second).toEqual({ reconciled: 0, skipped: 0, errors: [] })
    expect(mockStripeRetrieve).not.toHaveBeenCalled()
    expect(mockStripeCapture).not.toHaveBeenCalled()
    expect(db.rows.payouts).toHaveLength(1)
    expect(db.rows.agent_actions[0].status).toBe('complete')
    expect(db.rows.agent_action_audit_log).toHaveLength(1)
  })

  it('does not let a staggered worker reclaim active terminal effects', async () => {
    const db = authorizedDb()
    db.rows.payment_intents.push(paymentIntent({
      status: 'captured',
      captured_at: oldIso(2),
      updated_at: oldIso(2),
    }))
    let releaseFirst: (() => void) | null = null
    let markFirstEntered: (() => void) | null = null
    const firstEntered = new Promise<void>((resolve) => { markFirstEntered = resolve })
    const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve })
    let payoutInsertCalls = 0
    db.beforePayoutInsert = async () => {
      payoutInsertCalls += 1
      if (payoutInsertCalls !== 1) return
      markFirstEntered?.()
      await firstReleased
    }

    const firstPromise = GET(request())
    await firstEntered
    const second = await readJson(await GET(request()))
    releaseFirst?.()
    const first = await readJson(await firstPromise)

    expect(first).toEqual({ reconciled: 1, skipped: 0, errors: [] })
    expect(second).toEqual({ reconciled: 0, skipped: 1, errors: [] })
    expect(payoutInsertCalls).toBe(1)
    expect(db.rows.payouts).toHaveLength(1)
    expect(db.rows.agent_action_audit_log).toHaveLength(1)
    expect(db.rows.payment_intents[0].capture_effects_completed_at).toEqual(expect.any(String))
  })

  it('renews the CAS lease after a reconciler crash and safely resumes after the timeout', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-10T12:00:00.000Z'))
    const db = authorizedDb()
    db.rows.payment_intents.push(paymentIntent({
      capture_started_at: '2026-07-10T11:50:00.000Z',
      updated_at: '2026-07-10T11:50:00.000Z',
    }))
    mockStripeRetrieve.mockRejectedValueOnce(new Error('Stripe temporarily unavailable'))

    const failedRun = await readJson(await GET(request()))
    expect(failedRun.errors).toEqual([
      { payment_intent_id: 'payment-intent-1', error: 'Stripe temporarily unavailable' },
    ])
    expect(db.rows.payment_intents[0].status).toBe('capturing')

    const immediateRun = await readJson(await GET(request()))
    expect(immediateRun).toEqual({ reconciled: 0, skipped: 0, errors: [] })
    expect(mockStripeRetrieve).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(6 * 60 * 1000)
    mockStripeRetrieve.mockResolvedValueOnce(plannerStripeTruth('requires_capture'))
    const recoveredRun = await readJson(await GET(request()))

    expect(recoveredRun).toEqual({ reconciled: 1, skipped: 0, errors: [] })
    expect(mockStripeCapture).toHaveBeenCalledTimes(1)
    expect(db.rows.payment_intents[0].status).toBe('captured')
  })

  it('allows one concurrent reconciler winner with one Stripe capture and one set of effects', async () => {
    const db = authorizedDb()
    db.staleCaptureSelectBarrier = createBarrier(2)
    db.rows.payment_intents.push(paymentIntent())

    const [firstResponse, secondResponse] = await Promise.all([GET(request()), GET(request())])
    const [first, second] = await Promise.all([readJson(firstResponse), readJson(secondResponse)])

    expect(mockStripeRetrieve).toHaveBeenCalledTimes(1)
    expect(mockStripeCapture).toHaveBeenCalledTimes(1)
    expect(db.rows.payouts).toHaveLength(1)
    expect(db.rows.agent_actions[0].status).toBe('complete')
    expect(db.rows.agent_action_audit_log).toHaveLength(1)
    expect(Number(first.reconciled) + Number(second.reconciled)).toBe(1)
    expect(first.errors).toEqual([])
    expect(second.errors).toEqual([])
  })

  it('marks Stripe-terminal capture failure and the linked action failed without a payout', async () => {
    const db = authorizedDb()
    db.rows.payment_intents.push(paymentIntent())
    mockStripeRetrieve.mockResolvedValueOnce(plannerStripeTruth('canceled', {
      last_payment_error: { message: 'Authorization expired' },
    }))

    const body = await readJson(await GET(request()))

    expect(body).toEqual({ reconciled: 1, skipped: 0, errors: [] })
    expect(mockStripeCapture).not.toHaveBeenCalled()
    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'failed',
      failure_reason: 'Authorization expired',
    }))
    expect(db.rows.agent_actions[0].status).toBe('failed')
    expect(db.rows.payouts).toHaveLength(0)
    expect(db.rows.payment_intents[0].capture_effects_completed_at).toEqual(expect.any(String))
    expect(mockMetricCount).toHaveBeenCalledWith(
      'planner.stale_capturing.reconciled',
      1,
      expect.objectContaining({ attributes: expect.objectContaining({ failed_count: 1 }) })
    )
  })

  it('repairs a failed capture action after a crash and then becomes a no-op', async () => {
    const db = authorizedDb()
    db.rows.payment_intents.push(paymentIntent({
      status: 'failed',
      failure_reason: 'Authorization expired',
      updated_at: oldIso(2),
    }))

    const first = await readJson(await GET(request()))
    const second = await readJson(await GET(request()))

    expect(first).toEqual({ reconciled: 1, skipped: 0, errors: [] })
    expect(second).toEqual({ reconciled: 0, skipped: 0, errors: [] })
    expect(db.rows.agent_actions[0].status).toBe('failed')
    expect(db.rows.agent_action_audit_log).toHaveLength(1)
    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'failed',
      failure_reason: 'Authorization expired',
      capture_effects_completed_at: expect.any(String),
    }))
  })

  it('counts pending stale-capture reconciliation work in the run metric', async () => {
    const db = authorizedDb()
    db.rows.payment_intents.push(paymentIntent())
    mockStripeRetrieve.mockResolvedValueOnce(plannerStripeTruth('processing'))

    const body = await readJson(await GET(request()))

    expect(body).toEqual({ reconciled: 0, skipped: 0, errors: [] })
    expect(db.rows.payment_intents[0].status).toBe('capturing')
    expect(mockMetricCount).toHaveBeenCalledWith(
      'planner.stale_capturing.reconciled',
      1,
      expect.objectContaining({ attributes: expect.objectContaining({ pending_count: 1 }) })
    )
  })

  it('creates only the net payout when a partial refund precedes terminal effects', async () => {
    const db = authorizedDb()
    db.rows.payment_intents.push(paymentIntent({
      status: 'captured',
      captured_at: oldIso(2),
      refunded_amount_cents: 5_000,
      updated_at: oldIso(2),
    }))

    const body = await readJson(await GET(request()))

    expect(body).toEqual({ reconciled: 1, skipped: 0, errors: [] })
    expect(db.rows.payouts).toEqual([
      expect.objectContaining({
        payment_intent_id: 'payment-intent-1',
        amount_cents: 19_000,
        status: 'pending',
      }),
    ])
    expect(db.rows.agent_actions[0].status).toBe('complete')
  })

  it('completes legacy full-refund effects without a payout when no capture attempt was recorded', async () => {
    const db = authorizedDb()
    db.rows.payment_intents.push(paymentIntent({
      status: 'refunded',
      captured_at: oldIso(2),
      refunded_amount_cents: 25_000,
      capture_attempt_id: null,
      capture_started_at: null,
      updated_at: oldIso(2),
    }))

    const body = await readJson(await GET(request()))

    expect(body).toEqual({ reconciled: 1, skipped: 0, errors: [] })
    expect(db.rows.payouts).toHaveLength(0)
    expect(db.rows.agent_actions[0].status).toBe('complete')
    expect(db.rows.payment_intents[0].capture_effects_completed_at).toEqual(expect.any(String))
  })

  it('logs effect errors, holds the lease, and reclaims it after the timeout', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-10T12:00:00.000Z'))
    const db = authorizedDb()
    db.rows.payment_intents.push(paymentIntent({
      status: 'captured',
      captured_at: oldIso(2),
      updated_at: oldIso(2),
    }))
    const originalRpc = db.rpc.bind(db)
    let failNextPayout = true
    jest.spyOn(db, 'rpc').mockImplementation(async (name: string, params: Row) => {
      if (name === 'ensure_planner_deposit_payout' && failNextPayout) {
        failNextPayout = false
        return { data: null, error: { message: 'payout insert failed' } }
      }
      return originalRpc(name, params)
    })

    const failed = await readJson(await GET(request()))
    const immediate = await readJson(await GET(request()))

    expect(failed).toEqual({
      reconciled: 0,
      skipped: 0,
      errors: [{ payment_intent_id: 'payment-intent-1', error: 'payout insert failed' }],
    })
    expect(immediate).toEqual({ reconciled: 0, skipped: 1, errors: [] })
    expect(db.rows.payment_intents[0].capture_effects_completed_at).toBeNull()
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ action: 'capture_reconcile_failed' }) })
    )

    jest.advanceTimersByTime(6 * 60 * 1000)
    const recovered = await readJson(await GET(request()))

    expect(recovered).toEqual({ reconciled: 1, skipped: 0, errors: [] })
    expect(db.rows.payouts).toHaveLength(1)
    expect(db.rows.payment_intents[0].capture_effects_completed_at).toEqual(expect.any(String))
  })
})
