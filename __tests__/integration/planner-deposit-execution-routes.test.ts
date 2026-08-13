jest.mock('server-only', () => ({}))

const mockStripePaymentIntentsCreate = jest.fn()
const mockStripePaymentIntentsCapture = jest.fn()
const mockStripePaymentIntentsRetrieve = jest.fn()
const mockStripeAccountsRetrieve = jest.fn()
const mockStripeCustomersRetrievePaymentMethod = jest.fn()
const mockStripeSetupIntentsRetrieve = jest.fn()

import type { NextRequest } from 'next/server'
import { POST as authorizeDeposit } from '@/app/api/planner/plans/[planId]/payments/authorize/route'
import { POST as recordAuthenticationOutcome } from '@/app/api/planner/plans/[planId]/payments/authentication/route'
import { POST as captureDeposit } from '@/app/api/payments/capture/route'
import { confirmBuilderPaymentMethodSetup } from '@/lib/planner/builderPaymentMethods'
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
    customers: {
      retrievePaymentMethod: mockStripeCustomersRetrievePaymentMethod,
    },
    setupIntents: {
      retrieve: mockStripeSetupIntentsRetrieve,
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
const BUILDER_ID = '550e8400-e29b-41d4-a716-446655440006'
const CUSTOMER_ID = 'cus_planner_organizer'

function routeStripeTruth(input: {
  id?: string
  status?: string
  plannerPaymentIntentId?: string
  client_secret?: string
  next_action?: Record<string, unknown> | null
  last_payment_error?: { message?: string | null } | null
  cancellation_reason?: string | null
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
    builder_profiles: [],
    builder_payment_methods: [],
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
        typeof approval.authorized_by !== 'string' || !approval.authorized_by.trim() ||
        typeof approval.authorized_at !== 'string' || !approval.authorized_at.trim() ||
        typeof approval.snapshot_hash !== 'string' || !approval.snapshot_hash.trim() ||
        typeof params.p_expected_snapshot_hash !== 'string' || !params.p_expected_snapshot_hash.trim() ||
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
  private containsFilters: Array<[string, Record<string, unknown>]> = []
  private operation: 'select' | 'insert' | 'update' | 'upsert' = 'select'
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

  upsert(payload: unknown) {
    this.operation = 'upsert'
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

  contains(field: string, value: Record<string, unknown>) {
    this.containsFilters.push([field, value])
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

    if (this.operation === 'upsert') {
      const payload = this.payload as Row
      const paymentMethodId = payload.stripe_payment_method_id
      const existing = this.db.rows[this.table].find((row) => (
        row.stripe_payment_method_id === paymentMethodId
      ))
      if (existing) {
        Object.assign(existing, payload, { updated_at: new Date().toISOString() })
        return { data: existing, error: null }
      }
      const inserted = {
        id: this.db.nextId(this.table),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_default: false,
        ...payload,
      }
      this.db.rows[this.table].push(inserted)
      return { data: inserted, error: null }
    }

    let selected = this.db.rows[this.table].filter((row) => this.matches(row))
    if (this.limitCount != null) selected = selected.slice(0, this.limitCount)
    return { data: selected, error: null }
  }

  private matches(row: Row) {
    return (
      this.filters.every(([field, value]) => row[field] === value) &&
      this.inFilters.every(([field, values]) => values.includes(row[field])) &&
      this.containsFilters.every(([field, expected]) => containsRecord(row[field], expected))
    )
  }
}

function containsRecord(actual: unknown, expected: Record<string, unknown>): boolean {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false
  return Object.entries(expected).every(([key, value]) => {
    const actualValue = (actual as Record<string, unknown>)[key]
    return value && typeof value === 'object' && !Array.isArray(value)
      ? containsRecord(actualValue, value as Record<string, unknown>)
      : actualValue === value
  })
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
  db.rows.builder_profiles.push({
    id: BUILDER_ID,
    user_id: USER_ID,
    stripe_customer_id: CUSTOMER_ID,
  })
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

function seedAuthenticationAttempt(
  db: MemoryDb,
  input: {
    localStatus?: string
    metadataStatus?: string
    metadataPaymentIntentId?: string
    includePaymentIntent?: boolean
  } = {}
) {
  const {
    localStatus = 'pending',
    metadataStatus = 'awaiting_authentication',
    metadataPaymentIntentId = PAYMENT_INTENT_ID,
    includePaymentIntent = true,
  } = input

  db.rows.agent_actions[0].result_metadata = {
    payment_authentication: {
      status: metadataStatus,
      payment_intent_id: metadataPaymentIntentId,
      stripe_status: 'requires_action',
      outcome: null,
      updated_at: new Date().toISOString(),
    },
  }
  if (includePaymentIntent) {
    db.rows.payment_intents.push({
      id: PAYMENT_INTENT_ID,
      plan_id: PLAN_ID,
      approval_id: APPROVAL_ID,
      partner_kind: 'venue',
      partner_id: PARTNER_ID,
      amount_cents: 25_000,
      currency: 'usd',
      status: localStatus,
      stripe_payment_intent_id: 'pi_sca_attempt',
      stripe_payment_method_id: 'pm_sca_attempt',
    })
  }
}

function seedAuthorizedPaymentIntent(db: MemoryDb, stripePaymentIntentId = 'pi_evidence_check') {
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
    stripe_payment_intent_id: stripePaymentIntentId,
    authorized_at: new Date().toISOString(),
    captured_at: null,
    refund_terms: 'Refundable',
    platform_fee_cents: 0,
  })
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
    mockStripeCustomersRetrievePaymentMethod.mockImplementation(async (
      _customerId: string,
      paymentMethodId: string
    ) => ({
      id: paymentMethodId,
      type: 'card',
      customer: CUSTOMER_ID,
      card: {
        brand: 'visa',
        last4: '4242',
        exp_month: 12,
        exp_year: 2032,
      },
    }))
  })

  it('binds an organizer-owned SetupIntent card, then authorizes with that exact method', async () => {
    const db = seedDb()
    const boundPaymentMethodId = 'pm_bound_from_setup'
    mockStripeSetupIntentsRetrieve.mockResolvedValueOnce({
      id: 'seti_planner_bound',
      status: 'succeeded',
      customer: CUSTOMER_ID,
      payment_method: boundPaymentMethodId,
      metadata: {
        builder_id: BUILDER_ID,
        user_id: USER_ID,
      },
    })
    mockStripeCustomersRetrievePaymentMethod.mockImplementation(async (
      customerId: string,
      paymentMethodId: string
    ) => {
      if (customerId !== CUSTOMER_ID || paymentMethodId !== boundPaymentMethodId) {
        throw { code: 'resource_missing' }
      }
      return {
        id: paymentMethodId,
        type: 'card',
        customer: customerId,
        card: {
          brand: 'visa',
          last4: '4242',
          exp_month: 12,
          exp_year: 2032,
        },
      }
    })

    const boundMethod = await confirmBuilderPaymentMethodSetup({
      db,
      builderId: BUILDER_ID,
      userId: USER_ID,
      customerId: CUSTOMER_ID,
      setupIntentId: 'seti_planner_bound',
    })

    expect(boundMethod.id).toBe(boundPaymentMethodId)
    expect(db.rows.builder_payment_methods).toEqual([
      expect.objectContaining({
        builder_id: BUILDER_ID,
        stripe_payment_method_id: boundPaymentMethodId,
      }),
    ])

    const response = await authorizeDeposit(
      request(`/api/planner/plans/${PLAN_ID}/payments/authorize`, {
        approvalId: APPROVAL_ID,
        partnerKind: 'venue',
        partnerId: PARTNER_ID,
        amountCents: 25_000,
        paymentMethodId: boundMethod.id,
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
      expect.objectContaining({
        customer: CUSTOMER_ID,
        payment_method: boundPaymentMethodId,
        payment_method_types: ['card'],
        capture_method: 'manual',
        confirm: true,
        use_stripe_sdk: true,
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining(`planner_deposit_${APPROVAL_ID}_`),
      })
    )
    expect(mockStripePaymentIntentsCreate.mock.calls[0][0]).not.toHaveProperty(
      'automatic_payment_methods'
    )
    expect(mockStripeCustomersRetrievePaymentMethod).toHaveBeenNthCalledWith(
      1,
      CUSTOMER_ID,
      boundPaymentMethodId
    )
    expect(mockStripeCustomersRetrievePaymentMethod).toHaveBeenNthCalledWith(
      2,
      CUSTOMER_ID,
      boundPaymentMethodId
    )
    expect(db.rows.agent_actions[0].status).toBe('executing')
  })

  it('returns safe SCA details, persists the Stripe identity, and reconciles the same intent', async () => {
    const db = seedDb()
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
      paymentMethodId: 'pm_sca_route',
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
    expect(db.rows.agent_actions[0].result_metadata).toEqual(expect.objectContaining({
      payment_authentication: expect.objectContaining({
        status: 'awaiting_authentication',
        payment_intent_id: db.rows.payment_intents[0].id,
        stripe_status: 'requires_action',
      }),
    }))
    expect(db.rows.agent_action_audit_log).toEqual([
      expect.objectContaining({
        action_id: ACTION_ID,
        from_status: 'approved',
        to_status: 'approved',
        reason: 'payment.authentication.awaiting_authentication',
      }),
    ])

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
    expect(db.rows.agent_action_audit_log).toHaveLength(2)
    expect(db.rows.agent_action_audit_log[1]).toEqual(expect.objectContaining({
      reason: 'payment.authorization_recorded',
      metadata: expect.objectContaining({
        payment_authentication: expect.objectContaining({
          status: 'authenticated',
          outcome: 'succeeded',
        }),
      }),
    }))
  })

  it('records a retryable outcome only for the current awaiting Stripe authentication attempt', async () => {
    const db = seedDb()
    seedAuthenticationAttempt(db)
    mockStripePaymentIntentsRetrieve.mockResolvedValueOnce(routeStripeTruth({
      id: 'pi_sca_attempt',
      status: 'requires_action',
      plannerPaymentIntentId: PAYMENT_INTENT_ID,
    }))

    const response = await recordAuthenticationOutcome(
      request(`/api/planner/plans/${PLAN_ID}/payments/authentication`, {
        approvalId: APPROVAL_ID,
        outcome: 'abandoned',
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(200)
    expect(await readJson(response)).toEqual({
      status: 'retry_allowed',
      outcome: 'abandoned',
    })
    expect(mockStripePaymentIntentsRetrieve).toHaveBeenCalledWith('pi_sca_attempt')
    expect(db.rows.agent_actions[0].result_metadata).toEqual(expect.objectContaining({
      payment_authentication: expect.objectContaining({
        status: 'retry_allowed',
        payment_intent_id: PAYMENT_INTENT_ID,
        stripe_status: 'requires_action',
        outcome: 'abandoned',
      }),
    }))
    expect(db.rows.agent_action_audit_log).toEqual([
      expect.objectContaining({
        action_id: ACTION_ID,
        plan_id: PLAN_ID,
        from_status: 'approved',
        to_status: 'approved',
        actor_id: USER_ID,
        actor_role: 'user',
        reason: 'payment.authentication.retry_allowed',
        metadata: expect.objectContaining({
          status: 'retry_allowed',
          payment_intent_id: PAYMENT_INTENT_ID,
          outcome: 'abandoned',
        }),
      }),
    ])
  })

  it('durably releases a failed SCA attempt when Stripe requires a new payment method', async () => {
    const db = seedDb()
    seedAuthenticationAttempt(db)
    mockStripePaymentIntentsRetrieve.mockResolvedValueOnce(routeStripeTruth({
      id: 'pi_sca_attempt',
      status: 'requires_payment_method',
      plannerPaymentIntentId: PAYMENT_INTENT_ID,
      last_payment_error: { message: 'Your card could not be authenticated.' },
    }))

    const response = await recordAuthenticationOutcome(
      request(`/api/planner/plans/${PLAN_ID}/payments/authentication`, {
        approvalId: APPROVAL_ID,
        outcome: 'failed',
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(200)
    expect(await readJson(response)).toEqual({
      status: 'retry_allowed',
      outcome: 'failed',
    })
    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'failed',
      failure_reason: 'Your card could not be authenticated.',
    }))
    expect(db.rows.agent_actions[0].result_metadata).toEqual(expect.objectContaining({
      payment_authentication: expect.objectContaining({
        status: 'retry_allowed',
        payment_intent_id: PAYMENT_INTENT_ID,
        stripe_status: 'requires_payment_method',
        outcome: 'failed',
      }),
    }))
    expect(db.rows.agent_action_audit_log).toEqual([
      expect.objectContaining({
        reason: 'payment.authentication.retry_allowed',
        metadata: expect.objectContaining({
          stripe_status: 'requires_payment_method',
          outcome: 'failed',
        }),
      }),
    ])

    mockStripePaymentIntentsCreate.mockResolvedValueOnce(routeStripeTruth({
      id: 'pi_sca_retry',
      status: 'requires_capture',
      plannerPaymentIntentId: 'payment_intents-2',
    }))

    const retry = await authorizeDeposit(
      request(`/api/planner/plans/${PLAN_ID}/payments/authorize`, {
        approvalId: APPROVAL_ID,
        partnerKind: 'venue',
        partnerId: PARTNER_ID,
        amountCents: 25_000,
        paymentMethodId: 'pm_sca_attempt',
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(retry.status).toBe(200)
    expect(await readJson(retry)).toEqual(expect.objectContaining({
      paymentIntent: expect.objectContaining({ status: 'authorized' }),
    }))
    expect(db.rows.payment_intents).toHaveLength(2)
    expect(db.rows.payment_intents[0].status).toBe('failed')
    expect(db.rows.payment_intents[1].status).toBe('authorized')
    expect(mockStripePaymentIntentsCreate).toHaveBeenCalledTimes(1)
  })

  it('releases a canceled pre-capture SCA attempt for a new explicit authorization', async () => {
    const db = seedDb()
    seedAuthenticationAttempt(db)
    mockStripePaymentIntentsRetrieve.mockResolvedValueOnce(routeStripeTruth({
      id: 'pi_sca_attempt',
      status: 'canceled',
      plannerPaymentIntentId: PAYMENT_INTENT_ID,
      cancellation_reason: 'requested_by_customer',
    }))

    const response = await recordAuthenticationOutcome(
      request(`/api/planner/plans/${PLAN_ID}/payments/authentication`, {
        approvalId: APPROVAL_ID,
        outcome: 'abandoned',
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(200)
    expect(await readJson(response)).toEqual({
      status: 'retry_allowed',
      outcome: 'abandoned',
    })
    expect(db.rows.payment_intents[0]).toEqual(expect.objectContaining({
      status: 'failed',
      failure_reason: 'Stripe PaymentIntent was canceled (requested_by_customer) before capture.',
    }))
    expect(db.rows.agent_actions[0].result_metadata).toEqual(expect.objectContaining({
      payment_authentication: expect.objectContaining({
        status: 'retry_allowed',
        stripe_status: 'canceled',
        outcome: 'abandoned',
      }),
    }))
  })

  it.each(['requires_capture', 'succeeded', 'processing']) (
    'rejects a client retry outcome when live Stripe truth is %s',
    async (stripeStatus) => {
      const db = seedDb()
      seedAuthenticationAttempt(db)
      mockStripePaymentIntentsRetrieve.mockResolvedValueOnce(routeStripeTruth({
        id: 'pi_sca_attempt',
        status: stripeStatus,
        plannerPaymentIntentId: PAYMENT_INTENT_ID,
      }))

      const response = await recordAuthenticationOutcome(
        request(`/api/planner/plans/${PLAN_ID}/payments/authentication`, {
          approvalId: APPROVAL_ID,
          outcome: 'failed',
        }),
        { params: { planId: PLAN_ID } }
      )

      expect(response.status).toBe(409)
      expect(await readJson(response)).toEqual({
        error: 'Stripe authentication state changed. Refresh before retrying.',
      })
      expect(db.rows.payment_intents[0].status).toBe('pending')
      expect(db.rows.agent_actions[0].result_metadata).toEqual(expect.objectContaining({
        payment_authentication: expect.objectContaining({
          status: 'awaiting_authentication',
        }),
      }))
      expect(db.rows.agent_action_audit_log).toHaveLength(0)
    }
  )

  it('rejects an authentication outcome without a matching local PaymentIntent before Stripe', async () => {
    const db = seedDb()
    seedAuthenticationAttempt(db, { includePaymentIntent: false })

    const response = await recordAuthenticationOutcome(
      request(`/api/planner/plans/${PLAN_ID}/payments/authentication`, {
        approvalId: APPROVAL_ID,
        outcome: 'failed',
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(409)
    expect(await readJson(response)).toEqual({
      error: 'No active authentication attempt matches this approval.',
    })
    expect(mockStripePaymentIntentsRetrieve).not.toHaveBeenCalled()
    expect(db.rows.agent_action_audit_log).toHaveLength(0)
    expect(db.rows.agent_actions[0].result_metadata).toEqual(expect.objectContaining({
      payment_authentication: expect.objectContaining({
        status: 'awaiting_authentication',
      }),
    }))
  })

  it.each(['authorized', 'captured'])(
    'rejects an authentication outcome for a local PaymentIntent in %s state before Stripe',
    async (localStatus) => {
      const db = seedDb()
      seedAuthenticationAttempt(db, { localStatus })

      const response = await recordAuthenticationOutcome(
        request(`/api/planner/plans/${PLAN_ID}/payments/authentication`, {
          approvalId: APPROVAL_ID,
          outcome: 'abandoned',
        }),
        { params: { planId: PLAN_ID } }
      )

      expect(response.status).toBe(409)
      expect(await readJson(response)).toEqual({
        error: 'No active authentication attempt matches this approval.',
      })
      expect(mockStripePaymentIntentsRetrieve).not.toHaveBeenCalled()
      expect(db.rows.agent_action_audit_log).toHaveLength(0)
    }
  )

  it.each([
    ['another PaymentIntent', 'awaiting_authentication', 'payment_intents-other'],
    ['an already-authenticated action', 'authenticated', PAYMENT_INTENT_ID],
  ])(
    'rejects authentication outcomes when action metadata points to %s',
    async (_label, metadataStatus, metadataPaymentIntentId) => {
      const db = seedDb()
      seedAuthenticationAttempt(db, { metadataStatus, metadataPaymentIntentId })

      const response = await recordAuthenticationOutcome(
        request(`/api/planner/plans/${PLAN_ID}/payments/authentication`, {
          approvalId: APPROVAL_ID,
          outcome: 'failed',
        }),
        { params: { planId: PLAN_ID } }
      )

      expect(response.status).toBe(409)
      expect(await readJson(response)).toEqual({
        error: 'Payment authentication state changed. Refresh before retrying.',
      })
      expect(mockStripePaymentIntentsRetrieve).not.toHaveBeenCalled()
      expect(db.rows.agent_action_audit_log).toHaveLength(0)
    }
  )

  it.each([
    ['expired', { expires_at: '2020-01-01T00:00:00.000Z' }],
    ['superseded', { superseded_at: '2026-07-11T00:00:00.000Z' }],
    ['rejected', { status: 'rejected' }],
  ])(
    'rejects authentication outcomes when the approval is %s before Stripe',
    async (_label, approvalPatch) => {
      const db = seedDb()
      seedAuthenticationAttempt(db)
      Object.assign(db.rows.approvals[0], approvalPatch)

      const response = await recordAuthenticationOutcome(
        request(`/api/planner/plans/${PLAN_ID}/payments/authentication`, {
          approvalId: APPROVAL_ID,
          outcome: 'abandoned',
        }),
        { params: { planId: PLAN_ID } }
      )

      expect(response.status).toBe(409)
      expect(await readJson(response)).toEqual({
        error: 'This payment approval is no longer eligible for authentication updates.',
      })
      expect(mockStripePaymentIntentsRetrieve).not.toHaveBeenCalled()
      expect(db.rows.agent_action_audit_log).toHaveLength(0)
    }
  )

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

  it.each([
    ['another organizer', 'cus_other_organizer'],
    ['no Stripe Customer', null],
  ])('rejects a payment method bound to %s before creating an authorization', async (_label, customer) => {
    const db = seedDb()
    mockStripeCustomersRetrievePaymentMethod.mockResolvedValueOnce({
      id: 'pm_not_owned',
      type: 'card',
      customer,
      card: {
        brand: 'visa',
        last4: '0002',
        exp_month: 12,
        exp_year: 2032,
      },
    })

    const response = await authorizeDeposit(
      request(`/api/planner/plans/${PLAN_ID}/payments/authorize`, {
        approvalId: APPROVAL_ID,
        partnerKind: 'venue',
        partnerId: PARTNER_ID,
        amountCents: 25_000,
        paymentMethodId: 'pm_not_owned',
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'This payment method is not attached to the authenticated organizer.',
      code: 'builder_payment_method_forbidden',
    })
    expect(mockStripeCustomersRetrievePaymentMethod).toHaveBeenCalledWith(
      CUSTOMER_ID,
      'pm_not_owned'
    )
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled()
    expect(db.rows.payment_intents).toHaveLength(0)
    expect(db.rows.agent_actions[0].status).toBe('approved')
  })

  it('fresh-checks partner Stripe readiness before creating an authorization', async () => {
    const db = seedDb()
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
        paymentMethodId: 'pm_bound_from_setup',
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

  it.each([
    ['missing authorization actor', { authorized_by: null }],
    ['missing authorization time', { authorized_at: null }],
    ['missing snapshot', { snapshot_hash: null }],
    ['blank snapshot', { snapshot_hash: '   ' }],
  ])('rejects deposit authorization with %s before Stripe', async (_label, approvalPatch) => {
    const db = seedDb()
    Object.assign(db.rows.approvals[0], approvalPatch)

    const response = await authorizeDeposit(
      request(`/api/planner/plans/${PLAN_ID}/payments/authorize`, {
        approvalId: APPROVAL_ID,
        partnerKind: 'venue',
        partnerId: PARTNER_ID,
        amountCents: 25_000,
        paymentMethodId: 'pm_missing_evidence',
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Approval is missing authorization evidence. Review the latest terms and approve again.',
    })
    expect(db.rows.payment_intents).toHaveLength(0)
    expect(db.rows.agent_actions[0].status).toBe('approved')
    expect(db.rows.agent_action_audit_log).toHaveLength(0)
    expect(mockStripePaymentIntentsCreate).not.toHaveBeenCalled()
    expect(mockStripePaymentIntentsRetrieve).not.toHaveBeenCalled()
  })

  it.each([
    ['missing authorization actor', { authorized_by: null }],
    ['missing authorization time', { authorized_at: null }],
    ['missing snapshot', { snapshot_hash: null }],
    ['blank snapshot', { snapshot_hash: '   ' }],
  ])('rejects deposit capture with %s before Stripe', async (_label, approvalPatch) => {
    const db = seedDb()
    Object.assign(db.rows.approvals[0], approvalPatch)
    seedAuthorizedPaymentIntent(db)

    const response = await captureDeposit(request('/api/payments/capture', {
      paymentIntentId: PAYMENT_INTENT_ID,
      approvalId: APPROVAL_ID,
      explicitUserConfirmation: true,
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Approval is missing authorization evidence. Review the latest terms and approve again.',
    })
    expect(mockStripePaymentIntentsRetrieve).not.toHaveBeenCalled()
    expect(mockStripePaymentIntentsCapture).not.toHaveBeenCalled()
    expect(db.rows.payment_intents[0].status).toBe('authorized')
    expect(db.rows.payouts).toHaveLength(0)
  })

  it('fails closed in the capture reservation model when stored and expected snapshots are both null', async () => {
    const db = seedDb()
    db.rows.approvals[0].snapshot_hash = null
    seedAuthorizedPaymentIntent(db, 'pi_null_snapshot_reservation')

    const result = await db.rpc('reserve_planner_deposit_capture', {
      p_payment_intent_id: PAYMENT_INTENT_ID,
      p_plan_id: PLAN_ID,
      p_approval_id: APPROVAL_ID,
      p_expected_snapshot_hash: null,
      p_expected_amount_cents: 25_000,
      p_expected_partner_kind: 'venue',
      p_expected_partner_id: PARTNER_ID,
      p_capture_attempt_id: '550e8400-e29b-41d4-a716-446655440099',
    })

    expect(result).toEqual({ data: [], error: null })
    expect(db.rows.payment_intents[0].status).toBe('authorized')
    expect(db.rows.payment_intents[0].capture_attempt_id).toBeUndefined()
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
