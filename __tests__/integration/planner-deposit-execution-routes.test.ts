jest.mock('server-only', () => ({}))

const mockStripePaymentIntentsCreate = jest.fn()
const mockStripePaymentIntentsCapture = jest.fn()
const mockStripePaymentIntentsRetrieve = jest.fn()
const mockStripeAccountsRetrieve = jest.fn()

import type { NextRequest } from 'next/server'
import { POST as authorizeDeposit } from '@/app/api/planner/plans/[planId]/payments/authorize/route'
import { POST as captureDeposit } from '@/app/api/payments/capture/route'
import { buildApprovalSnapshotHash } from '@/lib/planner/execution/reapproval'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/stripe/connect', () => ({
  getStripeAccountStatus: jest.fn((account: { charges_enabled?: boolean; payouts_enabled?: boolean; requirements?: { disabled_reason?: string | null; past_due?: unknown[] }; details_submitted?: boolean }) => {
    if (account.charges_enabled && account.payouts_enabled) return 'active'
    if (account.requirements?.disabled_reason) return 'disabled'
    if ((account.requirements?.past_due?.length ?? 0) > 0) return 'restricted'
    return account.details_submitted ? 'onboarding_started' : 'pending_onboarding'
  }),
  isConnectedStripeAccountBlocked: jest.fn((status: string) => (
    status === 'restricted' || status === 'disabled'
  )),
  getStripeClient: jest.fn(() => ({
    accounts: {
      retrieve: mockStripeAccountsRetrieve,
    },
    paymentIntents: {
      capture: mockStripePaymentIntentsCapture,
      create: mockStripePaymentIntentsCreate,
      retrieve: mockStripePaymentIntentsRetrieve,
    },
  })),
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

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const PLAN_ID = '550e8400-e29b-41d4-a716-446655440001'
const ACTION_ID = '550e8400-e29b-41d4-a716-446655440002'
const APPROVAL_ID = '550e8400-e29b-41d4-a716-446655440003'
const PARTNER_ID = '550e8400-e29b-41d4-a716-446655440004'
const PAYMENT_INTENT_ID = '550e8400-e29b-41d4-a716-446655440005'

function routeStripeTruth(input: {
  id?: string
  status?: string
  plannerPaymentIntentId?: string
  client_secret?: string
  next_action?: Record<string, unknown> | null
} = {}) {
  const {
    plannerPaymentIntentId = 'payment_intents-1',
    ...overrides
  } = input
  return {
    id: 'pi_planner_authorized',
    status: 'requires_capture',
    amount: 25_000,
    currency: 'usd',
    capture_method: 'manual',
    metadata: {
      payment_kind: 'planner_deposit',
      planner_payment_intent_id: plannerPaymentIntentId,
      plan_id: PLAN_ID,
      approval_id: APPROVAL_ID,
      partner_kind: 'venue',
      partner_id: PARTNER_ID,
      platform_fee_cents: '0',
    },
    ...overrides,
  }
}

type Row = Record<string, unknown>

class MemoryDb {
  rows: Record<string, Row[]> = {
    plans: [],
    approvals: [],
    agent_actions: [],
    agent_action_audit_log: [],
    payment_intents: [],
    payouts: [],
    venues: [],
    venue_stripe_accounts: [],
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }

  async rpc(name: string, params: Row) {
    if (name === 'reserve_planner_deposit_capture') {
      const payment = this.rows.payment_intents.find((row) => (
        row.id === params.p_payment_intent_id &&
        row.plan_id === params.p_plan_id &&
        row.approval_id === params.p_approval_id &&
        (row.status === 'requested' || row.status === 'authorized')
      ))
      const approval = this.rows.approvals.find((row) => row.id === params.p_approval_id)
      const action = this.rows.agent_actions.find((row) => row.id === approval?.agent_action_id)
      if (
        !payment || !approval || !action ||
        !['approved', 'authorized'].includes(String(approval.status)) ||
        (approval.expires_at != null && Date.parse(String(approval.expires_at)) <= Date.now()) ||
        approval.snapshot_hash !== params.p_expected_snapshot_hash ||
        !['approved', 'executing'].includes(String(action.status)) ||
        action.target_type !== params.p_expected_partner_kind ||
        action.target_id !== params.p_expected_partner_id
      ) {
        return { data: [], error: null }
      }
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
    }
    if (name === 'ensure_planner_deposit_payout') {
      const payment = this.rows.payment_intents.find((row) => row.id === params.p_payment_intent_id)
      const amount = Math.max(
        0,
        Number(payment?.amount_cents ?? 0) -
          Number(payment?.platform_fee_cents ?? 0) -
          Number(payment?.refunded_amount_cents ?? 0)
      )
      const existing = this.rows.payouts.find((row) => row.payment_intent_id === payment?.id)
      if (payment && !existing && amount > 0) {
        this.rows.payouts.push({
          id: this.nextId('payouts'),
          payment_intent_id: payment.id,
          partner_kind: payment.partner_kind,
          partner_id: payment.partner_id,
          amount_cents: amount,
          currency: payment.currency,
          status: 'pending',
        })
      }
      return { data: { created: Boolean(payment && !existing && amount > 0) }, error: null }
    }
    if (name === 'unblock_stripe_account_settlements') {
      for (const row of this.rows.payment_intents) {
        if (
          row.status === 'blocked_by_account_state' &&
          row.account_state_blocked_stripe_account_id === params.p_stripe_account_id
        ) {
          row.status = row.account_state_blocked_previous_status
          row.account_state_blocked_previous_status = null
          row.account_state_blocked_stripe_account_id = null
        }
      }
      return { data: { payment_intents: 0 }, error: null }
    }
    if (name === 'block_inflight_stripe_account_payments') {
      for (const row of this.rows.payment_intents) {
        if (['pending', 'requested', 'authorized'].includes(String(row.status))) {
          row.account_state_blocked_previous_status = row.status
          row.account_state_blocked_stripe_account_id = params.p_stripe_account_id
          row.status = 'blocked_by_account_state'
        }
      }
      return { data: { payment_intents: 1 }, error: null }
    }
    return { data: null, error: { message: `Unknown RPC ${name}` } }
  }

  nextId(table: string) {
    return `${table}-${this.rows[table].length + 1}`
  }
}

class MemoryQuery {
  private filters: Array<[string, unknown]> = []
  private inFilters: Array<[string, unknown[]]> = []
  private operation: 'select' | 'insert' | 'update' = 'select'
  private payload: unknown
  private limitCount: number | null = null

  constructor(private db: MemoryDb, private table: string) {}

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

  eq(field: string, value: unknown) {
    this.filters.push([field, value])
    return this
  }

  is(field: string, value: unknown) {
    this.filters.push([field, value])
    return this
  }

  in(field: string, values: unknown[]) {
    this.inFilters.push([field, values])
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

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected)
  }

  private async execute() {
    if (this.operation === 'insert') {
      const values = Array.isArray(this.payload) ? this.payload : [this.payload]
      const inserted = values.map((value) => ({
        id: (value as Row)?.id ?? this.db.nextId(this.table),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(value as Row),
      }))
      this.db.rows[this.table].push(...inserted)
      return { data: Array.isArray(this.payload) ? inserted : inserted[0], error: null }
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
      this.filters.every(([field, value]) => row[field] === value) &&
      this.inFilters.every(([field, values]) => values.includes(row[field]))
    )
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

async function readJson(response: Response) {
  return JSON.parse(await response.text()) as Row
}

function seedDb() {
  const db = new MemoryDb()
  const plan = {
    id: PLAN_ID,
    user_id: USER_ID,
    title: 'Deposit test',
    event_type: 'mixer',
    status: 'ready',
    guest_count: 80,
    budget_cap_cents: 500_000,
    neighborhood: 'Mission',
    date_window_start: '2026-08-01',
    date_window_end: '2026-08-01',
    ticketed: true,
    ticketing_model: 'paid',
    food_responsibility: 'venue',
    profit_goal_cents: 100_000,
  }
  const action = {
    id: ACTION_ID,
    plan_id: PLAN_ID,
    action_type: 'payment',
    description: 'Authorize venue deposit',
    provider: 'Mission Hall',
    target_type: 'venue',
    target_id: PARTNER_ID,
    payload_json: {},
    amount_cents: 25_000,
    currency: 'usd',
    status: 'approved',
    approval_id: APPROVAL_ID,
    executed_at: null,
    result_metadata: {},
  }
  const approval = {
    id: APPROVAL_ID,
    plan_id: PLAN_ID,
    agent_action_id: ACTION_ID,
    action_label: 'Authorize venue deposit',
    provider: 'Mission Hall',
    event_date: '2026-08-01',
    price_cents: 25_000,
    fees_cents: 0,
    refund_terms: 'Refundable',
    cancellation_terms: 'Cancel before signing',
    package_details: 'Venue deposit',
    delivery_email: null,
    payment_method_id: null,
    status: 'authorized',
    requested_amount_cents: 25_000,
    authorized_amount_cents: 25_000,
    authorized_by: USER_ID,
    authorized_at: new Date().toISOString(),
    approved_by: USER_ID,
    approved_at: new Date().toISOString(),
    expires_at: null,
    snapshot_hash: buildApprovalSnapshotHash({ plan: plan as any, approval: approvalLike(), action: action as any }),
  }

  db.rows.plans.push(plan)
  db.rows.venues.push({ id: PARTNER_ID, owner_id: 'venue-owner-1' })
  db.rows.venue_stripe_accounts.push({
    owner_id: 'venue-owner-1',
    stripe_account_id: 'acct_venue_ready',
  })
  db.rows.agent_actions.push(action)
  db.rows.approvals.push(approval)
  mockCreateClient.mockReturnValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: USER_ID, user_metadata: { user_type: 'community_builder' } } },
        error: null,
      }),
    },
  })
  mockCreateServiceRoleClient.mockReturnValue({
    from: (table: string) => db.from(table),
    rpc: (name: string, params: Row) => db.rpc(name, params),
  })
  return db
}

function approvalLike() {
  return {
    event_date: '2026-08-01',
    price_cents: 25_000,
    fees_cents: 0,
    requested_amount_cents: 25_000,
    provider: 'Mission Hall',
    refund_terms: 'Refundable',
    cancellation_terms: 'Cancel before signing',
    package_details: 'Venue deposit',
  }
}

describe('planner deposit execution routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.STRIPE_SECRET_KEY
    mockStripePaymentIntentsCreate.mockResolvedValue(routeStripeTruth({
      id: 'pi_planner_authorized',
      status: 'requires_capture',
    }))
    mockStripePaymentIntentsRetrieve.mockImplementation(async (id: string) => routeStripeTruth({
      id,
      status: 'requires_capture',
      plannerPaymentIntentId: PAYMENT_INTENT_ID,
    }))
    mockStripePaymentIntentsCapture.mockImplementation(async (id: string) => routeStripeTruth({
      id,
      status: 'succeeded',
      plannerPaymentIntentId: PAYMENT_INTENT_ID,
    }))
    mockStripeAccountsRetrieve.mockResolvedValue({
      id: 'acct_venue_ready',
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: {},
    })
  })

  it('authorizes with the approval payment method and moves the action to executing', async () => {
    const db = seedDb()
    db.rows.approvals[0].payment_method_id = 'pm_approval_saved'

    const response = await authorizeDeposit(
      request(`/api/planner/plans/${PLAN_ID}/payments/authorize`, {
        approvalId: APPROVAL_ID,
        partnerKind: 'venue',
        partnerId: PARTNER_ID,
        amountCents: 25_000,
      }),
      { params: { planId: PLAN_ID } }
    )
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(json.paymentIntent).toEqual(expect.objectContaining({
      approval_id: APPROVAL_ID,
      amount_cents: 25_000,
      status: 'authorized',
      stripe_payment_intent_id: 'pi_planner_authorized',
    }))
    expect(mockStripePaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_method: 'pm_approval_saved' }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining(`planner_deposit_${APPROVAL_ID}_`),
      })
    )
    expect(db.rows.agent_actions[0].status).toBe('executing')
  })

  it('returns safe SCA details, persists the Stripe identity, and reconciles the same intent', async () => {
    const db = seedDb()
    db.rows.approvals[0].payment_method_id = 'pm_sca_route'
    mockStripePaymentIntentsCreate.mockResolvedValueOnce(routeStripeTruth({
      id: 'pi_sca_route',
      status: 'requires_action',
      client_secret: 'pi_sca_route_secret_test',
      next_action: { type: 'use_stripe_sdk' },
    }))
    mockStripePaymentIntentsRetrieve.mockResolvedValueOnce(routeStripeTruth({
      id: 'pi_sca_route',
      status: 'requires_capture',
    }))
    const body = {
      approvalId: APPROVAL_ID,
      partnerKind: 'venue',
      partnerId: PARTNER_ID,
      amountCents: 25_000,
    }

    const actionRequired = await authorizeDeposit(
      request(`/api/planner/plans/${PLAN_ID}/payments/authorize`, body),
      { params: { planId: PLAN_ID } }
    )

    expect(actionRequired.status).toBe(200)
    expect(await readJson(actionRequired)).toEqual(expect.objectContaining({
      paymentIntent: expect.objectContaining({
        status: 'pending',
        stripe_payment_intent_id: 'pi_sca_route',
      }),
      requires_action: true,
      stripe_status: 'requires_action',
      client_secret: 'pi_sca_route_secret_test',
      next_action: { type: 'use_stripe_sdk' },
    }))
    expect(db.rows.agent_actions[0].status).toBe('approved')
    expect(db.rows.agent_action_audit_log).toHaveLength(0)

    const reconciled = await authorizeDeposit(
      request(`/api/planner/plans/${PLAN_ID}/payments/authorize`, body),
      { params: { planId: PLAN_ID } }
    )

    expect(reconciled.status).toBe(200)
    expect(await readJson(reconciled)).toEqual(expect.objectContaining({
      paymentIntent: expect.objectContaining({
        status: 'authorized',
        stripe_payment_intent_id: 'pi_sca_route',
      }),
    }))
    expect(mockStripePaymentIntentsCreate).toHaveBeenCalledTimes(1)
    expect(mockStripePaymentIntentsRetrieve).toHaveBeenCalledTimes(1)
    expect(mockStripePaymentIntentsRetrieve).toHaveBeenCalledWith('pi_sca_route')
    expect(db.rows.agent_actions[0].status).toBe('executing')
    expect(db.rows.agent_action_audit_log).toHaveLength(1)
  })

  it('rejects a missing payment method before reserving or transitioning the action', async () => {
    const db = seedDb()

    const response = await authorizeDeposit(
      request(`/api/planner/plans/${PLAN_ID}/payments/authorize`, {
        approvalId: APPROVAL_ID,
        partnerKind: 'venue',
        partnerId: PARTNER_ID,
        amountCents: 25_000,
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: 'A payment method is required to authorize this deposit.',
    })
    expect(db.rows.payment_intents).toHaveLength(0)
    expect(db.rows.agent_actions[0].status).toBe('approved')
    expect(db.rows.agent_action_audit_log).toHaveLength(0)
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('fresh-checks partner Stripe readiness before creating an authorization', async () => {
    const db = seedDb()
    db.rows.approvals[0].payment_method_id = 'pm_approval_saved'
    mockStripeAccountsRetrieve.mockResolvedValueOnce({
      id: 'acct_venue_ready',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: { disabled_reason: 'requirements.past_due' },
    })

    const response = await authorizeDeposit(
      request(`/api/planner/plans/${PLAN_ID}/payments/authorize`, {
        approvalId: APPROVAL_ID,
        partnerKind: 'venue',
        partnerId: PARTNER_ID,
        amountCents: 25_000,
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(409)
    expect(db.rows.payment_intents).toHaveLength(0)
    expect(db.rows.agent_actions[0].status).toBe('approved')
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('rejects a request partner that differs from the approved action', async () => {
    const db = seedDb()

    const response = await authorizeDeposit(
      request(`/api/planner/plans/${PLAN_ID}/payments/authorize`, {
        approvalId: APPROVAL_ID,
        partnerKind: 'vendor',
        partnerId: PARTNER_ID,
        amountCents: 25_000,
        paymentMethodId: 'pm_request',
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(409)
    expect(db.rows.payment_intents).toHaveLength(0)
    expect(db.rows.agent_actions[0].status).toBe('approved')
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('rejects payment method or refund-term overrides after approval', async () => {
    const db = seedDb()
    db.rows.approvals[0].payment_method_id = 'pm_approved'

    const paymentMethodResponse = await authorizeDeposit(
      request(`/api/planner/plans/${PLAN_ID}/payments/authorize`, {
        approvalId: APPROVAL_ID,
        partnerKind: 'venue',
        partnerId: PARTNER_ID,
        amountCents: 25_000,
        paymentMethodId: 'pm_changed',
      }),
      { params: { planId: PLAN_ID } }
    )
    const termsResponse = await authorizeDeposit(
      request(`/api/planner/plans/${PLAN_ID}/payments/authorize`, {
        approvalId: APPROVAL_ID,
        partnerKind: 'venue',
        partnerId: PARTNER_ID,
        amountCents: 25_000,
        paymentMethodId: 'pm_approved',
        refundTerms: 'No refunds',
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(paymentMethodResponse.status).toBe(409)
    expect(termsResponse.status).toBe(409)
    expect(db.rows.payment_intents).toHaveLength(0)
    expect(db.rows.agent_actions[0].status).toBe('approved')
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('derives the platform fee from the approval and rejects a client mismatch', async () => {
    const db = seedDb()

    const response = await authorizeDeposit(
      request(`/api/planner/plans/${PLAN_ID}/payments/authorize`, {
        approvalId: APPROVAL_ID,
        partnerKind: 'venue',
        partnerId: PARTNER_ID,
        amountCents: 25_000,
        paymentMethodId: 'pm_request',
        platformFeeCents: 500,
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Platform fee changed after approval. Review and approve the updated fee before authorizing.',
    })
    expect(db.rows.payment_intents).toHaveLength(0)
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('blocks deposit authorization before approval', async () => {
    const db = seedDb()
    db.rows.approvals[0].status = 'pending'

    const response = await authorizeDeposit(
      request(`/api/planner/plans/${PLAN_ID}/payments/authorize`, {
        approvalId: APPROVAL_ID,
        partnerKind: 'venue',
        partnerId: PARTNER_ID,
        amountCents: 25_000,
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(422)
    expect(db.rows.payment_intents).toHaveLength(0)
  })

  it('rejects an expired approval before creating a Stripe authorization', async () => {
    const db = seedDb()
    db.rows.approvals[0].expires_at = '2020-01-01T00:00:00.000Z'

    const response = await authorizeDeposit(
      request(`/api/planner/plans/${PLAN_ID}/payments/authorize`, {
        approvalId: APPROVAL_ID,
        partnerKind: 'venue',
        partnerId: PARTNER_ID,
        amountCents: 25_000,
        paymentMethodId: 'pm_expired_approval',
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Approval expired. Review the latest terms and approve again.',
    })
    expect(db.rows.payment_intents).toHaveLength(0)
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled()
  })

  it('rejects an expired approval before capturing an existing authorization', async () => {
    const db = seedDb()
    db.rows.approvals[0].expires_at = '2020-01-01T00:00:00.000Z'
    db.rows.agent_actions[0].status = 'executing'
    db.rows.payment_intents.push({
      id: PAYMENT_INTENT_ID,
      plan_id: PLAN_ID,
      'plans.user_id': USER_ID,
      approval_id: APPROVAL_ID,
      partner_kind: 'venue',
      partner_id: PARTNER_ID,
      amount_cents: 25_000,
      currency: 'usd',
      status: 'authorized',
      stripe_payment_intent_id: 'pi_expired_approval',
      authorized_at: new Date().toISOString(),
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: 0,
    })

    const response = await captureDeposit(request('/api/payments/capture', {
      paymentIntentId: PAYMENT_INTENT_ID,
      approvalId: APPROVAL_ID,
      explicitUserConfirmation: true,
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Approval expired. Review the latest terms and approve again.',
    })
    expect(mockStripePaymentIntentsCapture).not.toHaveBeenCalled()
    expect(db.rows.payment_intents[0].status).toBe('authorized')
  })

  it('does not capture when the approval is superseded after route validation', async () => {
    const db = seedDb()
    db.rows.agent_actions[0].status = 'executing'
    db.rows.payment_intents.push({
      id: PAYMENT_INTENT_ID,
      plan_id: PLAN_ID,
      'plans.user_id': USER_ID,
      approval_id: APPROVAL_ID,
      partner_kind: 'venue',
      partner_id: PARTNER_ID,
      amount_cents: 25_000,
      currency: 'usd',
      status: 'authorized',
      stripe_payment_intent_id: 'pi_superseded_during_capture',
      authorized_at: new Date().toISOString(),
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: 0,
    })
    mockStripePaymentIntentsRetrieve.mockImplementationOnce(async () => {
      db.rows.approvals[0].status = 'superseded'
      return routeStripeTruth({
        id: 'pi_superseded_during_capture',
        status: 'requires_capture',
        plannerPaymentIntentId: PAYMENT_INTENT_ID,
      })
    })

    const response = await captureDeposit(request('/api/payments/capture', {
      paymentIntentId: PAYMENT_INTENT_ID,
      approvalId: APPROVAL_ID,
      explicitUserConfirmation: true,
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Payment capture is already in progress. Refresh and try again.',
      code: 'payment_capture_in_progress',
    })
    expect(mockStripePaymentIntentsCapture).not.toHaveBeenCalled()
    expect(db.rows.payment_intents[0].status).toBe('authorized')
    expect(db.rows.payouts).toHaveLength(0)
  })

  it('refuses controlled capture without a Stripe PaymentIntent', async () => {
    const db = seedDb()
    db.rows.agent_actions[0].status = 'executing'
    db.rows.payment_intents.push({
      id: PAYMENT_INTENT_ID,
      plan_id: PLAN_ID,
      'plans.user_id': USER_ID,
      approval_id: APPROVAL_ID,
      partner_kind: 'venue',
      partner_id: PARTNER_ID,
      amount_cents: 25_000,
      currency: 'usd',
      status: 'authorized',
      stripe_payment_intent_id: null,
      authorized_at: new Date().toISOString(),
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: 0,
    })

    const response = await captureDeposit(request('/api/payments/capture', {
      paymentIntentId: PAYMENT_INTENT_ID,
      approvalId: APPROVAL_ID,
      explicitUserConfirmation: true,
    }))

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: 'A Stripe payment authorization is required before capture.',
      code: 'payment_capture_not_funded',
    })
    expect(db.rows.payment_intents[0].status).toBe('authorized')
    expect(db.rows.agent_actions[0].status).toBe('executing')
    expect(db.rows.payouts).toHaveLength(0)
  })

  it('blocks an authorized row when fresh partner readiness fails before capture', async () => {
    const db = seedDb()
    db.rows.agent_actions[0].status = 'executing'
    db.rows.payment_intents.push({
      id: PAYMENT_INTENT_ID,
      plan_id: PLAN_ID,
      'plans.user_id': USER_ID,
      approval_id: APPROVAL_ID,
      partner_kind: 'venue',
      partner_id: PARTNER_ID,
      amount_cents: 25_000,
      currency: 'usd',
      status: 'authorized',
      stripe_payment_intent_id: 'pi_partner_not_ready',
      authorized_at: new Date().toISOString(),
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: 0,
    })
    mockStripeAccountsRetrieve.mockResolvedValueOnce({
      id: 'acct_venue_ready',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: { disabled_reason: 'requirements.past_due' },
    })

    const response = await captureDeposit(request('/api/payments/capture', {
      paymentIntentId: PAYMENT_INTENT_ID,
      approvalId: APPROVAL_ID,
      explicitUserConfirmation: true,
    }))

    expect(response.status).toBe(409)
    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'blocked_by_account_state',
      account_state_blocked_previous_status: 'authorized',
    }))
    expect(mockStripePaymentIntentsCapture).not.toHaveBeenCalled()
    expect(db.rows.payouts).toHaveLength(0)
  })

  it('freshly verifies and restores a blocked authorization only for an explicit capture', async () => {
    const db = seedDb()
    db.rows.agent_actions[0].status = 'executing'
    db.rows.payment_intents.push({
      id: PAYMENT_INTENT_ID,
      plan_id: PLAN_ID,
      'plans.user_id': USER_ID,
      approval_id: APPROVAL_ID,
      partner_kind: 'venue',
      partner_id: PARTNER_ID,
      amount_cents: 25_000,
      currency: 'usd',
      status: 'blocked_by_account_state',
      stripe_payment_intent_id: 'pi_blocked_ready',
      authorized_at: new Date().toISOString(),
      captured_at: null,
      refund_terms: 'Refundable',
      platform_fee_cents: 0,
      capture_attempt_id: null,
      capture_started_at: null,
      capture_effects_started_at: null,
      capture_effects_completed_at: null,
      account_state_blocked_previous_status: 'authorized',
      account_state_blocked_stripe_account_id: 'acct_venue_ready',
    })
    mockStripePaymentIntentsCapture.mockResolvedValueOnce(routeStripeTruth({
      id: 'pi_blocked_ready',
      status: 'succeeded',
      plannerPaymentIntentId: PAYMENT_INTENT_ID,
    }))

    const response = await captureDeposit(request('/api/payments/capture', {
      paymentIntentId: PAYMENT_INTENT_ID,
      approvalId: APPROVAL_ID,
      explicitUserConfirmation: true,
    }))

    expect(response.status).toBe(200)
    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'captured',
      account_state_blocked_previous_status: null,
      account_state_blocked_stripe_account_id: null,
    }))
    expect(mockStripePaymentIntentsCapture).toHaveBeenCalledTimes(1)
    expect(db.rows.payouts).toHaveLength(1)
    expect(db.rows.agent_actions[0].status).toBe('complete')
  })

  it('rejects capture without explicit confirmation', async () => {
    seedDb()

    const response = await captureDeposit(request('/api/payments/capture', {
      paymentIntentId: PAYMENT_INTENT_ID,
      approvalId: APPROVAL_ID,
      explicitUserConfirmation: false,
    }))

    expect(response.status).toBe(400)
  })
})
