jest.mock('server-only', () => ({}))

import type { NextRequest } from 'next/server'
import { PATCH as updateApproval } from '@/app/api/planner/plans/[planId]/approvals/route'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import * as Sentry from '@sentry/nextjs'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
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
const mockCaptureMessage = Sentry.captureMessage as jest.Mock

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const PLAN_ID = '550e8400-e29b-41d4-a716-446655440001'
const ACTION_ID = '550e8400-e29b-41d4-a716-446655440002'
const APPROVAL_ID = '550e8400-e29b-41d4-a716-446655440003'
const VENUE_ID_1 = '550e8400-e29b-41d4-a716-446655440004'
const VENUE_ID_2 = '550e8400-e29b-41d4-a716-446655440005'

type Row = Record<string, any>

class MemoryDb {
  rows: Record<string, Row[]> = {
    plans: [],
    approvals: [],
    agent_actions: [],
    agent_action_audit_log: [],
    plan_messages: [],
    venues: [],
    venue_opportunity_briefs: [],
    venue_opportunity_invites: [],
    builder_profiles: [],
    builder_event_usage: [],
    builder_event_access_consumptions: [],
  }
  failApprovalRollback = false

  private sequence = 0
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

  nextId(table: string) {
    this.sequence += 1
    return `${table}-${this.sequence}`
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
      id: this.nextId('builder_event_access_consumptions'),
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
        id: this.nextId('builder_event_usage'),
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
  private operation: 'select' | 'insert' | 'update' | 'upsert' = 'select'
  private payload: unknown
  private selectedColumns = '*'
  private limitCount: number | null = null

  constructor(
    private db: MemoryDb,
    private table: string
  ) {}

  select(columns = '*') {
    this.selectedColumns = columns
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
    if (result.error) return { data: null, error: result.error }
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
      const inserted = values.map((value) => this.withDefaults(value as Row))
      this.db.rows[this.table].push(...inserted)
      return {
        data: Array.isArray(this.payload) ? inserted.map((row) => this.project(row)) : this.project(inserted[0]),
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
        data: Array.isArray(this.payload) ? upserted.map((row) => this.project(row)) : this.project(upserted[0]),
        error: null,
      }
    }

    if (this.operation === 'update') {
      const payload = this.payload as Row
      if (
        this.table === 'approvals' &&
        this.db.failApprovalRollback &&
        payload.status === 'pending' &&
        payload.authorized_by === null
      ) {
        return { data: null, error: { message: 'rollback update failed' } }
      }

      const updated: Row[] = []
      this.db.rows[this.table] = this.db.rows[this.table].map((row) => {
        if (!this.matches(row)) return row
        const next = { ...row, ...payload, updated_at: new Date().toISOString() }
        updated.push(next)
        return next
      })
      return { data: updated.map((row) => this.project(row)), error: null }
    }

    let selected = this.db.rows[this.table].filter((row) => this.matches(row))
    if (this.limitCount != null) selected = selected.slice(0, this.limitCount)
    return { data: selected.map((row) => this.project(row)), error: null }
  }

  private matches(row: Row) {
    return (
      this.filters.every(([field, value]) => row[field] === value) &&
      this.inFilters.every(([field, values]) => values.includes(row[field]))
    )
  }

  private project(row: Row) {
    if (this.selectedColumns === '*' || !this.selectedColumns.trim()) return row
    const columns = this.selectedColumns
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean)
      .map((column) => column.split(/\s+/)[0])
    if (columns.length === 0) return row
    return Object.fromEntries(columns.map((column) => [column, row[column]]))
  }

  private withDefaults(row: Row) {
    const now = new Date().toISOString()
    return {
      id: row.id ?? this.db.nextId(this.table),
      created_at: now,
      updated_at: now,
      ...row,
    }
  }
}

function request(path: string, body: Row, method = 'PATCH') {
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
  return response.json() as Promise<Row>
}

function seedDb() {
  const db = new MemoryDb()
  db.rows.plans.push({
    id: PLAN_ID,
    user_id: USER_ID,
    title: 'P0 concurrency plan',
    event_type: 'happy_hour',
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
    metadata: {},
  })
  db.rows.builder_profiles.push({
    id: 'builder-profile-1',
    user_id: USER_ID,
    name: 'P0 Builder',
    billing_tier: 'free_trial',
    subscription_status: 'trial',
    free_events_granted: 2,
    free_events_used: 0,
    paid_event_credits: 0,
  })
  db.rows.venues.push(
    { id: VENUE_ID_1, venue_name: 'Foundry Rooftop', city: 'San Francisco', state: 'CA', standing_capacity: 160, is_claimed: true },
    { id: VENUE_ID_2, venue_name: 'Mission Social Hall', city: 'San Francisco', state: 'CA', standing_capacity: 120, is_claimed: false }
  )
  db.rows.agent_actions.push({
    id: ACTION_ID,
    plan_id: PLAN_ID,
    action_type: 'email',
    description: 'Send venue outreach',
    provider: 'Gmail',
    target_type: 'venue',
    target_id: null,
    payload_json: {
      kind: 'venue_outreach',
      venue_ids: [VENUE_ID_1, VENUE_ID_2],
      summary: 'P0 launch mixer with clear capacity and budget requirements.',
      requirements: { must_haves: ['AV', 'bar'] },
      response_deadline: '2026-08-10T00:00:00.000Z',
    },
    amount_cents: 0,
    currency: 'usd',
    status: 'pending',
    approval_id: APPROVAL_ID,
    result_metadata: {
      action_type_fallback: 'opportunity_send_venues',
    },
  })
  db.rows.approvals.push({
    id: APPROVAL_ID,
    plan_id: PLAN_ID,
    agent_action_id: ACTION_ID,
    action_label: 'Send to venues',
    provider: 'Gmail',
    event_date: '2026-08-01',
    price_cents: 0,
    fees_cents: 0,
    refund_terms: null,
    cancellation_terms: null,
    package_details: 'Venue outreach',
    delivery_email: null,
    payment_method_id: null,
    status: 'pending',
    requested_amount_cents: 0,
    authorized_amount_cents: null,
    authorized_by: null,
    authorized_at: null,
    approved_by: null,
    approved_at: null,
    expires_at: null,
    snapshot_hash: null,
  })
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
  return db
}

describe('P0 approval concurrency hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('allows only one concurrent approval PATCH to win side effects', async () => {
    const db = seedDb()

    const [first, second] = await Promise.all([
      updateApproval(
        request(`/api/planner/plans/${PLAN_ID}/approvals`, {
          approvalId: APPROVAL_ID,
          action: 'authorize',
        }),
        { params: { planId: PLAN_ID } }
      ),
      updateApproval(
        request(`/api/planner/plans/${PLAN_ID}/approvals`, {
          approvalId: APPROVAL_ID,
          action: 'authorize',
        }),
        { params: { planId: PLAN_ID } }
      ),
    ])

    const statuses = [first.status, second.status].sort()
    const stale = first.status === 409 ? first : second
    const staleBody = await readJson(stale)

    expect(statuses).toEqual([200, 409])
    expect(staleBody).toEqual({
      error: 'Approval was updated by another request. Refresh and try again.',
      code: 'approval_stale',
    })
    expect(db.rows.approvals[0].status).toBe('authorized')
    expect(db.rows.builder_event_access_consumptions).toHaveLength(1)
    expect(db.rows.builder_profiles[0].free_events_used).toBe(1)
    expect(db.rows.venue_opportunity_briefs).toHaveLength(1)
    expect(db.rows.venue_opportunity_invites).toHaveLength(2)
    expect(db.rows.agent_actions[0].status).toBe('complete')
    expect(db.rows.agent_action_audit_log).toHaveLength(3)
    expect(db.rows.agent_action_audit_log.map((row) => row.reason)).toEqual([
      'approval.status_changed',
      'approval.execution_started',
      'approval.outreach_drafts_prepared',
    ])
  })

  it('rolls back approval status and skips execution when billing access fails after optimistic update', async () => {
    const db = seedDb()
    db.rows.builder_profiles[0].free_events_used = 2

    const response = await updateApproval(
      request(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        action: 'authorize',
      }),
      { params: { planId: PLAN_ID } }
    )
    const body = await readJson(response)

    expect(response.status).toBe(402)
    expect(body).toEqual(expect.objectContaining({
      error: 'Choose pay-per-event or Pro to approve outreach.',
      billingRequired: true,
    }))
    expect(db.rows.approvals[0]).toEqual(expect.objectContaining({
      status: 'pending',
      authorized_by: null,
      authorized_at: null,
      authorized_amount_cents: null,
      approved_by: null,
      approved_at: null,
    }))
    expect(db.rows.builder_event_access_consumptions).toHaveLength(0)
    expect(db.rows.venue_opportunity_briefs).toHaveLength(0)
    expect(db.rows.venue_opportunity_invites).toHaveLength(0)
    expect(db.rows.agent_actions[0]).toEqual(expect.objectContaining({
      status: 'pending',
      result_metadata: expect.objectContaining({
        approval_access_gate_rollback: expect.objectContaining({
          action: 'approval_access_gate_rollback',
          approval_original_status: 'pending',
          approval_attempted_status: 'authorized',
        }),
      }),
    }))
    expect(db.rows.agent_action_audit_log).toHaveLength(0)
  })

  it('logs Sentry when rollback itself fails and still returns the billing access error', async () => {
    const db = seedDb()
    db.rows.builder_profiles[0].free_events_used = 2
    db.failApprovalRollback = true

    const response = await updateApproval(
      request(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        action: 'authorize',
      }),
      { params: { planId: PLAN_ID } }
    )
    const body = await readJson(response)

    expect(response.status).toBe(402)
    expect(body).toEqual(expect.objectContaining({
      error: 'Choose pay-per-event or Pro to approve outreach.',
      billingRequired: true,
    }))
    expect(db.rows.approvals[0].status).toBe('authorized')
    expect(db.rows.builder_event_access_consumptions).toHaveLength(0)
    expect(db.rows.venue_opportunity_briefs).toHaveLength(0)
    expect(db.rows.venue_opportunity_invites).toHaveLength(0)
    expect(db.rows.agent_action_audit_log).toHaveLength(0)
    expect(mockCaptureMessage).toHaveBeenCalledWith('approval_rollback_failed', expect.objectContaining({
      level: 'error',
      tags: expect.objectContaining({
        action: 'approval_rollback_failed',
        plan_id: PLAN_ID,
        approval_id: APPROVAL_ID,
        original_status: 'pending',
        attempted_status: 'authorized',
      }),
      extra: { error: 'rollback update failed' },
    }))
  })
})
