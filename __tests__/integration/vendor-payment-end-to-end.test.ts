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

import type { NextRequest } from 'next/server'
import { PATCH as updateApproval } from '@/app/api/planner/plans/[planId]/approvals/route'
import { POST as authorizeDeposit } from '@/app/api/planner/plans/[planId]/payments/authorize/route'
import { POST as captureDeposit } from '@/app/api/payments/capture/route'
import { GET as reconcileCapturedDeposits } from '@/app/api/admin/reconcile/captured-deposits/route'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getWorkerOrAdminContext } from '@/lib/server/admin-auth'
import type { Approval, Plan } from '@/lib/types'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/server/admin-auth', () => ({
  getWorkerOrAdminContext: jest.fn(),
}))

jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
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

const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock
const mockGetWorkerOrAdminContext = getWorkerOrAdminContext as jest.Mock

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const BUILDER_ID = '550e8400-e29b-41d4-a716-446655440010'
const PLAN_ID = '550e8400-e29b-41d4-a716-446655440001'
const ACTION_ID = '550e8400-e29b-41d4-a716-446655440002'
const APPROVAL_ID = '550e8400-e29b-41d4-a716-446655440003'
const VENDOR_ID = '550e8400-e29b-41d4-a716-446655440004'
const PAYMENT_INTENT_ID = '550e8400-e29b-41d4-a716-446655440005'
const STRIPE_PAYMENT_INTENT_ID = 'pi_vendor_deposit_test'
const AMOUNT_CENTS = 20_000
const PLATFORM_FEE_CENTS = 1_250

type Row = Record<string, any>

class MemoryDb {
  rows: Record<string, Row[]> = {
    plans: [],
    approvals: [],
    agent_actions: [],
    agent_action_audit_log: [],
    plan_messages: [],
    builder_profiles: [],
    builder_event_usage: [],
    builder_event_access_consumptions: [],
    vendor_profiles: [],
    vendor_stripe_accounts: [],
    vendor_bookings: [],
    payment_intents: [],
    payouts: [],
  }

  private sequence = 100
  private rpcQueue = Promise.resolve()

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
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

  nextId() {
    this.sequence += 1
    return `550e8400-e29b-41d4-a716-44665544${this.sequence.toString(16).padStart(4, '0')}`
  }

  private async consumeBuilderEventAccess(params: Record<string, unknown>) {
    const builderId = params.p_builder_id as string
    const eventId = params.p_event_id as string
    const defaultFreeEventsGranted = params.p_default_free_events_granted as number
    const payPerEventAmountCents = params.p_pay_per_event_amount_cents as number
    const proMonthlyAmountCents = params.p_pro_monthly_amount_cents as number
    const builderRow = this.rows.builder_profiles.find((row) => row.id === builderId)

    if (!builderRow) {
      return { data: null, error: { code: 'P0002', message: 'builder_profile_not_found' } }
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

    if (isPro) {
      source = builderRow.billing_tier
    } else if (freeEventsGranted - freeEventsUsed > 0) {
      source = 'free_trial'
      builderRow.free_events_used = freeEventsUsed + 1
    } else if (paidEventCredits > 0) {
      source = 'pay_per_event'
      amountCents = payPerEventAmountCents
      builderRow.billing_tier = 'pay_per_event'
      builderRow.paid_event_credits = paidEventCredits - 1
    } else {
      return { data: null, error: { code: 'P0001', message: 'builder_billing_required' } }
    }

    const now = new Date().toISOString()
    const row = {
      id: this.nextId(),
      builder_id: builderId,
      event_id: eventId,
      source,
      amount: Math.floor(amountCents / 100),
      amount_cents: amountCents,
      source_metadata: {},
      created_at: now,
      updated_at: now,
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
      usage.updated_at = now
    } else {
      this.rows.builder_event_usage.push({
        id: this.nextId(),
        builder_id: builderId,
        month: '2026-06-01',
        events_booked: 1,
        total_fees_paid: amountCents / 100,
        could_have_saved: Math.max((payPerEventAmountCents - proMonthlyAmountCents) / 100, 0),
        created_at: now,
        updated_at: now,
      })
    }

    return { data: row, error: null }
  }
}

class MemoryQuery {
  private filters: Array<[string, unknown]> = []
  private inFilters: Array<[string, unknown[]]> = []
  private nullFilters: string[] = []
  private operation: 'select' | 'insert' | 'update' | 'upsert' = 'select'
  private payload: unknown
  private limitCount: number | null = null

  constructor(
    private db: MemoryDb,
    private table: string
  ) {}

  select() {
    return this
  }

  insert(payload: unknown) {
    this.operation = 'insert'
    this.payload = payload
    return this
  }

  update(payload: unknown) {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  upsert(payload: unknown) {
    this.operation = 'upsert'
    this.payload = payload
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push([field, value])
    return this
  }

  in(field: string, values: unknown[]) {
    this.inFilters.push([field, values])
    return this
  }

  is(field: string, value: unknown) {
    if (value === null) this.nullFilters.push(field)
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
    if (result.error) return result
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: row ? null : { message: 'No row' } }
  }

  async maybeSingle() {
    const result = await this.execute()
    if (result.error) return result
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: null }
  }

  then<TResult1 = { data: Row | Row[] | null; error: null | { code?: string; message?: string } }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row | Row[] | null; error: null | { code?: string; message?: string } }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected)
  }

  private async execute() {
    if (this.operation === 'insert') {
      const values = Array.isArray(this.payload) ? this.payload : [this.payload]
      const inserted: Row[] = []

      for (const value of values) {
        const row = this.withDefaults(value as Row)
        if (this.table === 'payment_intents' && this.hasActivePaymentIntent(row.approval_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate active payment intent' } }
        }
        if (this.table === 'builder_event_access_consumptions' && this.hasBuilderConsumption(row)) {
          return { data: null, error: { code: '23505', message: 'duplicate builder event access consumption' } }
        }
        this.db.rows[this.table].push(row)
        inserted.push(row)
      }

      return {
        data: Array.isArray(this.payload) ? inserted : inserted[0],
        error: null,
      }
    }

    if (this.operation === 'upsert') {
      const values = Array.isArray(this.payload) ? this.payload : [this.payload]
      const upserted = values.map((value) => {
        const row = value as Row
        const existing = this.db.rows[this.table].find((item) => (
          this.table === 'builder_event_usage' &&
          item.builder_id === row.builder_id &&
          item.month === row.month
        ))
        if (existing) {
          Object.assign(existing, row, { updated_at: new Date().toISOString() })
          return existing
        }
        const inserted = this.withDefaults(row)
        this.db.rows[this.table].push(inserted)
        return inserted
      })
      return {
        data: Array.isArray(this.payload) ? upserted : upserted[0],
        error: null,
      }
    }

    if (this.operation === 'update') {
      const updated: Row[] = []
      this.db.rows[this.table] = this.db.rows[this.table].map((row) => {
        if (!this.matches(row)) return row
        const next = { ...row, ...(this.payload as Row), updated_at: new Date().toISOString() }
        updated.push(next)
        return next
      })
      return { data: updated, error: null }
    }

    let selected = this.db.rows[this.table].filter((row) => this.matches(row))
    if (this.limitCount != null) selected = selected.slice(0, this.limitCount)
    return { data: selected, error: null }
  }

  private matches(row: Row) {
    return (
      this.filters.every(([field, value]) => this.resolveField(row, field) === value) &&
      this.inFilters.every(([field, values]) => values.includes(this.resolveField(row, field))) &&
      this.nullFilters.every((field) => {
        if (this.table === 'payment_intents' && field === 'payouts.id') {
          return !this.db.rows.payouts.some((payout) => payout.payment_intent_id === row.id)
        }
        return this.resolveField(row, field) == null
      })
    )
  }

  private resolveField(row: Row, field: string) {
    if (this.table === 'payment_intents' && field === 'plans.user_id') {
      return this.db.rows.plans.find((plan) => plan.id === row.plan_id)?.user_id
    }
    return row[field]
  }

  private hasActivePaymentIntent(approvalId: unknown) {
    const activeStatuses = new Set(['pending', 'requested', 'authorized', 'captured'])
    return this.db.rows.payment_intents.some((row) => (
      row.approval_id === approvalId &&
      activeStatuses.has(String(row.status))
    ))
  }

  private hasBuilderConsumption(row: Row) {
    return this.db.rows.builder_event_access_consumptions.some((item) => (
      item.builder_id === row.builder_id &&
      item.event_id === row.event_id
    ))
  }

  private withDefaults(row: Row) {
    const now = new Date().toISOString()
    return {
      id: row.id ?? this.db.nextId(),
      created_at: now,
      updated_at: now,
      ...row,
    }
  }
}

function request(path: string, body: Row, method = 'POST') {
  const url = `http://localhost${path}`
  const req = new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest

  Object.defineProperty(req, 'nextUrl', { value: new URL(url) })
  return req
}

function reconcileRequest() {
  const url = 'http://localhost/api/admin/reconcile/captured-deposits'
  const req = new Request(url, { method: 'GET' }) as NextRequest
  Object.defineProperty(req, 'nextUrl', { value: new URL(url) })
  return req
}

async function readJson(response: Response) {
  return response.json() as Promise<Row>
}

function setupSupabaseMocks(db: MemoryDb) {
  mockCreateClient.mockReturnValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: USER_ID, user_metadata: { user_type: 'community_builder' } } },
        error: null,
      }),
    },
    from: (table: string) => db.from(table),
  })
  mockCreateServiceRoleClient.mockReturnValue({
    from: (table: string) => db.from(table),
    rpc: (name: string, params: Record<string, unknown>) => db.rpc(name, params),
  })
}

function seedDb(input: {
  approvalStatus?: Approval['status']
  actionStatus?: Row['status']
  amountCents?: number
} = {}) {
  const db = new MemoryDb()
  const amountCents = input.amountCents ?? AMOUNT_CENTS
  const now = new Date().toISOString()

  const plan = {
    id: PLAN_ID,
    user_id: USER_ID,
    title: 'Vendor payout happy hour',
    event_type: 'happy_hour',
    status: 'ready',
    guest_count: 80,
    budget_cap_cents: 500_000,
    neighborhood: 'Mission',
    date_window_start: '2026-08-01',
    date_window_end: '2026-08-01',
    ticketed: true,
    ticketing_model: 'paid',
    food_responsibility: 'vendor',
    profit_goal_cents: 100_000,
    notes: null,
    metadata: {},
    created_at: now,
    updated_at: now,
  } satisfies Plan

  db.rows.plans.push(plan)
  db.rows.builder_profiles.push({
    id: BUILDER_ID,
    user_id: USER_ID,
    name: 'Vendor Payout Builder',
    billing_tier: 'free_trial',
    subscription_status: 'trial',
    free_events_granted: 2,
    free_events_used: 0,
    paid_event_credits: 0,
  })
  db.rows.vendor_profiles.push({
    id: VENDOR_ID,
    user_id: '550e8400-e29b-41d4-a716-446655440050',
    business_name: 'Moon Gate Catering',
    is_published: false,
  })
  db.rows.vendor_stripe_accounts.push({
    id: '550e8400-e29b-41d4-a716-446655440051',
    vendor_id: VENDOR_ID,
    stripe_account_id: 'acct_vendor_ready',
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
  })
  db.rows.agent_actions.push({
    id: ACTION_ID,
    plan_id: PLAN_ID,
    action_type: 'payment',
    description: 'Authorize Moon Gate Catering deposit',
    provider: 'Stripe',
    target_type: 'vendor',
    target_id: VENDOR_ID,
    payload_json: {
      kind: 'vendor_deposit',
      vendor_id: VENDOR_ID,
      deposit_amount_cents: amountCents,
    },
    amount_cents: amountCents,
    currency: 'usd',
    status: input.actionStatus ?? 'pending',
    approval_id: APPROVAL_ID,
    executed_at: null,
    result_metadata: {},
    created_at: now,
    updated_at: now,
  })
  db.rows.approvals.push({
    id: APPROVAL_ID,
    plan_id: PLAN_ID,
    agent_action_id: ACTION_ID,
    action_label: 'Authorize vendor deposit',
    provider: 'Moon Gate Catering',
    event_date: '2026-08-01',
    price_cents: amountCents,
    fees_cents: 0,
    refund_terms: 'Refundable until 7 days before event',
    cancellation_terms: 'Cancel before final invoice',
    package_details: 'Food vendor deposit',
    delivery_email: null,
    payment_method_id: null,
    status: input.approvalStatus ?? 'pending',
    requested_amount_cents: amountCents,
    authorized_amount_cents: input.approvalStatus === 'authorized' || input.approvalStatus === 'approved'
      ? amountCents
      : null,
    authorized_by: input.approvalStatus === 'authorized' || input.approvalStatus === 'approved' ? USER_ID : null,
    authorized_at: input.approvalStatus === 'authorized' || input.approvalStatus === 'approved' ? now : null,
    approved_by: input.approvalStatus === 'authorized' || input.approvalStatus === 'approved' ? USER_ID : null,
    approved_at: input.approvalStatus === 'authorized' || input.approvalStatus === 'approved' ? now : null,
    expires_at: null,
    snapshot_hash: null,
    created_at: now,
    updated_at: now,
  })

  setupSupabaseMocks(db)
  return db
}

async function approveVendorPayment(db: MemoryDb) {
  const response = await updateApproval(
    request(`/api/planner/plans/${PLAN_ID}/approvals`, {
      approvalId: APPROVAL_ID,
      action: 'authorize',
    }, 'PATCH'),
    { params: { planId: PLAN_ID } }
  )
  expect(response.status).toBe(200)
  expect(db.rows.approvals[0].status).toBe('authorized')
  expect(db.rows.agent_actions[0].status).toBe('approved')
  return readJson(response)
}

async function authorizeVendorDeposit(input: {
  amountCents?: number
  paymentMethodId?: string | null
  platformFeeCents?: number
} = {}) {
  return authorizeDeposit(
    request(`/api/planner/plans/${PLAN_ID}/payments/authorize`, {
      approvalId: APPROVAL_ID,
      partnerKind: 'vendor',
      partnerId: VENDOR_ID,
      amountCents: input.amountCents ?? AMOUNT_CENTS,
      paymentMethodId: input.paymentMethodId ?? 'pm_card_visa',
      platformFeeCents: input.platformFeeCents ?? PLATFORM_FEE_CENTS,
    }),
    { params: { planId: PLAN_ID } }
  )
}

describe('vendor payment approval to payout chain', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.STRIPE_SECRET_KEY
    mockStripePaymentIntentsCreate.mockResolvedValue({
      id: STRIPE_PAYMENT_INTENT_ID,
      status: 'requires_capture',
    })
    mockStripePaymentIntentsCapture.mockResolvedValue({
      id: STRIPE_PAYMENT_INTENT_ID,
      status: 'succeeded',
    })
    mockGetWorkerOrAdminContext.mockResolvedValue({
      authorized: true,
      user: { id: 'admin-1', email: 'admin@example.com' },
    })
  })

  it('runs the happy path from approval to vendor payout without bypassing explicit payment steps', async () => {
    const db = seedDb()

    await approveVendorPayment(db)

    expect(db.rows.builder_event_access_consumptions).toHaveLength(1)
    expect(db.rows.builder_profiles[0].free_events_used).toBe(1)
    expect(db.rows.payment_intents).toHaveLength(0)

    const authorizeResponse = await authorizeVendorDeposit()
    const authorizeBody = await readJson(authorizeResponse)

    expect(authorizeResponse.status).toBe(200)
    expect(authorizeBody.paymentIntent).toEqual(expect.objectContaining({
      approval_id: APPROVAL_ID,
      partner_kind: 'vendor',
      partner_id: VENDOR_ID,
      amount_cents: AMOUNT_CENTS,
      platform_fee_cents: PLATFORM_FEE_CENTS,
      status: 'authorized',
      stripe_payment_intent_id: STRIPE_PAYMENT_INTENT_ID,
    }))
    expect(db.rows.agent_actions[0].status).toBe('executing')
    expect(mockStripePaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: AMOUNT_CENTS,
        capture_method: 'manual',
        confirm: true,
        payment_method: 'pm_card_visa',
        metadata: expect.objectContaining({
          payment_kind: 'planner_deposit',
          planner_payment_intent_id: authorizeBody.paymentIntent.id,
          plan_id: PLAN_ID,
          approval_id: APPROVAL_ID,
          user_id: USER_ID,
          partner_kind: 'vendor',
          partner_id: VENDOR_ID,
          platform_fee_cents: String(PLATFORM_FEE_CENTS),
        }),
      }),
      { idempotencyKey: `planner_deposit_${APPROVAL_ID}_${AMOUNT_CENTS}` }
    )

    const paymentIntentId = authorizeBody.paymentIntent.id
    const captureResponse = await captureDeposit(request('/api/payments/capture', {
      paymentIntentId,
      approvalId: APPROVAL_ID,
      explicitUserConfirmation: true,
    }))

    expect(captureResponse.status).toBe(200)
    expect(mockStripePaymentIntentsCapture).toHaveBeenCalledWith(STRIPE_PAYMENT_INTENT_ID)
    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      id: paymentIntentId,
      status: 'captured',
    }))
    expect(db.rows.agent_actions[0].status).toBe('complete')
    expect(db.rows.payouts).toEqual([
      expect.objectContaining({
        payment_intent_id: paymentIntentId,
        partner_kind: 'vendor',
        partner_id: VENDOR_ID,
        amount_cents: AMOUNT_CENTS - PLATFORM_FEE_CENTS,
        currency: 'usd',
        status: 'pending',
      }),
    ])
  })

  it('allows only one concurrent approval PATCH to consume access and unlock payment authorization', async () => {
    const db = seedDb()

    const [first, second] = await Promise.all([
      updateApproval(
        request(`/api/planner/plans/${PLAN_ID}/approvals`, {
          approvalId: APPROVAL_ID,
          action: 'authorize',
        }, 'PATCH'),
        { params: { planId: PLAN_ID } }
      ),
      updateApproval(
        request(`/api/planner/plans/${PLAN_ID}/approvals`, {
          approvalId: APPROVAL_ID,
          action: 'authorize',
        }, 'PATCH'),
        { params: { planId: PLAN_ID } }
      ),
    ])

    const statuses = [first.status, second.status].sort()
    const stale = first.status === 409 ? first : second

    expect(statuses).toEqual([200, 409])
    expect(await readJson(stale)).toEqual({
      error: 'Approval was updated by another request. Refresh and try again.',
      code: 'approval_stale',
    })
    expect(db.rows.approvals[0].status).toBe('authorized')
    expect(db.rows.agent_actions[0].status).toBe('approved')
    expect(db.rows.builder_event_access_consumptions).toHaveLength(1)
    expect(db.rows.payment_intents).toHaveLength(0)
  })

  it('returns one active vendor payment intent when authorization requests race', async () => {
    const db = seedDb({ approvalStatus: 'authorized', actionStatus: 'approved' })

    const [first, second] = await Promise.all([
      authorizeVendorDeposit(),
      authorizeVendorDeposit(),
    ])
    const firstBody = await readJson(first)
    const secondBody = await readJson(second)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(db.rows.payment_intents).toHaveLength(1)
    expect(firstBody.paymentIntent.id).toBe(secondBody.paymentIntent.id)
    expect(firstBody.paymentIntent).toEqual(expect.objectContaining({
      partner_kind: 'vendor',
      amount_cents: AMOUNT_CENTS,
      status: 'authorized',
    }))
    expect(mockStripePaymentIntentsCreate).toHaveBeenCalledTimes(1)
    expect(mockStripePaymentIntentsCreate.mock.calls.map((call) => call[1])).toEqual([
      { idempotencyKey: `planner_deposit_${APPROVAL_ID}_${AMOUNT_CENTS}` },
    ])
  })

  it('blocks capture when the approval has not been authorized', async () => {
    const db = seedDb({ approvalStatus: 'pending', actionStatus: 'pending' })
    db.rows.payment_intents.push({
      id: PAYMENT_INTENT_ID,
      plan_id: PLAN_ID,
      approval_id: APPROVAL_ID,
      partner_kind: 'vendor',
      partner_id: VENDOR_ID,
      amount_cents: AMOUNT_CENTS,
      currency: 'usd',
      status: 'authorized',
      stripe_payment_intent_id: STRIPE_PAYMENT_INTENT_ID,
      authorized_at: new Date().toISOString(),
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: PLATFORM_FEE_CENTS,
    })

    const response = await captureDeposit(request('/api/payments/capture', {
      paymentIntentId: PAYMENT_INTENT_ID,
      approvalId: APPROVAL_ID,
      explicitUserConfirmation: true,
    }))
    const body = await readJson(response)

    expect(response.status).toBe(422)
    expect(body.error).toBe('Approval must be authorized before capture')
    expect(mockStripePaymentIntentsCapture).not.toHaveBeenCalled()
    expect(db.rows.payouts).toHaveLength(0)
  })

  it('rejects capture without explicit confirmation before loading or mutating payment state', async () => {
    const db = seedDb({ approvalStatus: 'authorized', actionStatus: 'executing' })
    db.rows.payment_intents.push({
      id: PAYMENT_INTENT_ID,
      plan_id: PLAN_ID,
      approval_id: APPROVAL_ID,
      partner_kind: 'vendor',
      partner_id: VENDOR_ID,
      amount_cents: AMOUNT_CENTS,
      currency: 'usd',
      status: 'authorized',
      stripe_payment_intent_id: STRIPE_PAYMENT_INTENT_ID,
      authorized_at: new Date().toISOString(),
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: PLATFORM_FEE_CENTS,
    })

    const response = await captureDeposit(request('/api/payments/capture', {
      paymentIntentId: PAYMENT_INTENT_ID,
      approvalId: APPROVAL_ID,
      explicitUserConfirmation: false,
    }))

    expect(response.status).toBe(400)
    expect(db.rows.payment_intents[0].status).toBe('authorized')
    expect(mockStripePaymentIntentsCapture).not.toHaveBeenCalled()
    expect(db.rows.payouts).toHaveLength(0)
  })

  it('reconciles a captured vendor deposit with no payout row', async () => {
    const db = seedDb({ approvalStatus: 'authorized', actionStatus: 'complete' })
    db.rows.payment_intents.push({
      id: PAYMENT_INTENT_ID,
      plan_id: PLAN_ID,
      approval_id: APPROVAL_ID,
      partner_kind: 'vendor',
      partner_id: VENDOR_ID,
      amount_cents: AMOUNT_CENTS,
      currency: 'usd',
      status: 'captured',
      stripe_payment_intent_id: STRIPE_PAYMENT_INTENT_ID,
      authorized_at: new Date().toISOString(),
      captured_at: new Date().toISOString(),
      refund_terms: 'Refundable',
      platform_fee_cents: PLATFORM_FEE_CENTS,
    })

    const response = await reconcileCapturedDeposits(reconcileRequest())
    const body = await readJson(response)

    expect(response.status).toBe(200)
    expect(body).toEqual({ reconciled: 1, skipped: 0, errors: [] })
    expect(db.rows.payouts).toEqual([
      expect.objectContaining({
        payment_intent_id: PAYMENT_INTENT_ID,
        partner_kind: 'vendor',
        partner_id: VENDOR_ID,
        amount_cents: AMOUNT_CENTS - PLATFORM_FEE_CENTS,
        status: 'pending',
      }),
    ])
  })

  it('marks the reserved payment intent failed and does not transition the action when Stripe authorization fails', async () => {
    const db = seedDb({ approvalStatus: 'authorized', actionStatus: 'approved' })
    mockStripePaymentIntentsCreate.mockRejectedValueOnce(new Error('Stripe authorization failed'))

    const response = await authorizeVendorDeposit()
    const body = await readJson(response)

    expect(response.status).toBe(500)
    expect(body.error).toBe('Stripe authorization failed')
    expect(db.rows.payment_intents).toEqual([
      expect.objectContaining({
        approval_id: APPROVAL_ID,
        amount_cents: AMOUNT_CENTS,
        status: 'failed',
        stripe_payment_intent_id: null,
        failure_reason: 'Stripe authorization failed',
      }),
    ])
    expect(db.rows.agent_actions[0].status).toBe('approved')
    expect(db.rows.agent_action_audit_log).toHaveLength(0)
  })

  it('rejecting the approval cancels the action and leaves the money chain empty', async () => {
    const db = seedDb()

    const response = await updateApproval(
      request(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        action: 'reject',
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(200)
    expect(db.rows.approvals[0].status).toBe('rejected')
    expect(db.rows.agent_actions[0].status).toBe('cancelled')
    expect(db.rows.payment_intents).toHaveLength(0)
    expect(db.rows.payouts).toHaveLength(0)
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled()
    expect(mockStripePaymentIntentsCapture).not.toHaveBeenCalled()
  })
})
