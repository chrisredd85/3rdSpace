jest.mock('server-only', () => ({}))

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
  getStripeClient: jest.fn(() => ({
    paymentIntents: {
      capture: jest.fn(),
      create: jest.fn(),
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

type Row = Record<string, unknown>

class MemoryDb {
  rows: Record<string, Row[]> = {
    plans: [],
    approvals: [],
    agent_actions: [],
    agent_action_audit_log: [],
    payment_intents: [],
    payouts: [],
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
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
  mockCreateServiceRoleClient.mockReturnValue({ from: (table: string) => db.from(table) })
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
  })

  it('authorizes a deposit only after approval and moves the action to executing', async () => {
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
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(json.paymentIntent).toEqual(expect.objectContaining({
      approval_id: APPROVAL_ID,
      amount_cents: 25_000,
      status: 'requested',
    }))
    expect(db.rows.agent_actions[0].status).toBe('executing')
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

  it('captures only with explicit user confirmation and completes the action', async () => {
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

    expect(response.status).toBe(200)
    expect(db.rows.payment_intents[0].status).toBe('captured')
    expect(db.rows.agent_actions[0].status).toBe('complete')
    expect(db.rows.payouts).toHaveLength(1)
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
