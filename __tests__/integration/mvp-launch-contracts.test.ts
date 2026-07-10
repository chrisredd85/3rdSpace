jest.mock('server-only', () => ({}))

import type { NextRequest } from 'next/server'
import { POST as createAgentAction } from '@/app/api/planner/plans/[planId]/agent-actions/route'
import { PATCH as updateApproval } from '@/app/api/planner/plans/[planId]/approvals/route'
import { POST as createVenueOpportunity } from '@/app/api/planner/plans/[planId]/opportunities/venues/route'
import { GET as listPublicVendors } from '@/app/api/vendors/route'
import { GET as listAdminVendors } from '@/app/api/admin/catalog/vendors/route'
import {
  buildApprovalSnapshotHashV2,
  buildApprovalSnapshotV2,
} from '@/lib/planner/execution/reapproval'
import { buildTicketTierRollups, classifyTicketTier } from '@/lib/server/ticket-normalization'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { enqueueOpportunityInviteSendJobs } from '@/lib/server/opportunity-email-worker'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/server/admin-auth', () => ({
  getAdminContext: jest.fn().mockResolvedValue({
    authorized: true,
    user: { id: 'admin-1', email: 'ops@3rdspace.com' },
  }),
}))

jest.mock('@/lib/server/opportunity-email-worker', () => ({
  enqueueOpportunityInviteSendJobs: jest.fn().mockResolvedValue(undefined),
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
const mockEnqueueOpportunityInviteSendJobs = enqueueOpportunityInviteSendJobs as jest.Mock

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const PLAN_ID = '550e8400-e29b-41d4-a716-446655440001'
const ACTION_ID = '550e8400-e29b-41d4-a716-446655440002'
const APPROVAL_ID = '550e8400-e29b-41d4-a716-446655440003'
const VENUE_ID_1 = '550e8400-e29b-41d4-a716-446655440004'
const VENUE_ID_2 = '550e8400-e29b-41d4-a716-446655440005'
const VENDOR_ID = '550e8400-e29b-41d4-a716-446655440006'

type Row = Record<string, any>

class MemoryDb {
  rows: Record<string, Row[]> = {
    plans: [],
    agent_actions: [],
    approvals: [],
    plan_messages: [],
    venue_opportunity_briefs: [],
    venue_opportunity_invites: [],
    vendor_opportunity_briefs: [],
    vendor_opportunity_invites: [],
    venues: [],
    venue_stripe_accounts: [],
    vendor_profiles: [],
    vendor_stripe_accounts: [],
    builder_profiles: [],
    builder_event_usage: [],
    builder_event_access_consumptions: [],
  }

  selects: Array<{ table: string; columns: string }> = []
  mutations: Array<{ table: string; operation: 'insert' | 'update' }> = []
  private sequence = 0
  private rpcQueue = Promise.resolve()

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }

  rpc(name: string, params: Record<string, unknown>) {
    const result = name === 'consume_builder_event_access'
      ? this.rpcQueue.then(() => this.consumeBuilderEventAccess(params))
      : name === 'supersede_approval_version'
        ? Promise.resolve(this.supersedeApprovalVersion(params))
        : Promise.resolve({ data: null, error: { message: `Unknown RPC ${name}` } })
    if (name === 'consume_builder_event_access') {
      this.rpcQueue = result.then(() => undefined, () => undefined)
    }
    return Object.assign(result, { maybeSingle: () => result })
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

  private supersedeApprovalVersion(params: Record<string, unknown>) {
    const previous = this.rows.approvals.find((row) => (
      row.id === params.p_approval_id && row.plan_id === params.p_plan_id
    ))
    if (!previous || (previous.snapshot_hash ?? 'legacy-missing') !== params.p_expected_snapshot_hash) {
      return { data: null, error: { code: '40001', message: 'approval_snapshot_mismatch' } }
    }
    const action = this.rows.agent_actions.find((row) => row.id === previous.agent_action_id)
    if (!action) return { data: null, error: { code: 'P0002', message: 'approval_version_action_not_found' } }

    const now = new Date().toISOString()
    const replacement = {
      ...previous,
      id: '650e8400-e29b-41d4-a716-446655440099',
      status: 'pending',
      requested_amount_cents: params.p_requested_amount_cents,
      event_date: params.p_event_date,
      notes: params.p_notes,
      expires_at: params.p_expires_at,
      snapshot_json: params.p_snapshot_json,
      snapshot_hash: params.p_snapshot_hash,
      snapshot_schema_version: 2,
      root_approval_id: previous.root_approval_id ?? previous.id,
      version_number: (previous.version_number ?? 1) + 1,
      supersedes_approval_id: previous.id,
      superseded_by_approval_id: null,
      version_created_by: params.p_actor_id,
      version_reason: params.p_reason,
      authorized_amount_cents: null,
      authorized_by: null,
      authorized_at: null,
      approved_by: null,
      approved_at: null,
      created_at: now,
      updated_at: now,
    }
    previous.status = 'superseded'
    previous.superseded_at = now
    previous.superseded_by_approval_id = replacement.id
    action.approval_id = replacement.id
    action.amount_cents = params.p_requested_amount_cents
    action.payload_json = params.p_action_payload_json
    action.status = 'pending'
    this.rows.approvals.push(replacement)
    return { data: replacement, error: null }
  }
}

class MemoryQuery {
  private filters: Array<[string, unknown]> = []
  private inFilters: Array<[string, unknown[]]> = []
  private operation: 'select' | 'insert' | 'update' = 'select'
  private payload: unknown
  private selectedColumns = '*'
  private orderBy: { field: string; ascending: boolean } | null = null
  private limitCount: number | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select(columns = '*') {
    this.selectedColumns = columns
    this.db.selects.push({ table: this.table, columns })
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
    this.operation = 'insert'
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

  order(field: string, options?: { ascending?: boolean }) {
    this.orderBy = { field, ascending: options?.ascending ?? true }
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
      this.db.mutations.push({ table: this.table, operation: 'insert' })
      const values = Array.isArray(this.payload) ? this.payload : [this.payload]
      const inserted = values.map((value) => this.withDefaults(value as Row))
      this.db.rows[this.table].push(...inserted)
      return { data: Array.isArray(this.payload) ? inserted : inserted[0], error: null }
    }

    if (this.operation === 'update') {
      this.db.mutations.push({ table: this.table, operation: 'update' })
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
    if (this.orderBy) {
      selected = [...selected].sort((a, b) => {
        const compare = String(a[this.orderBy!.field] ?? '').localeCompare(String(b[this.orderBy!.field] ?? ''))
        return this.orderBy!.ascending ? compare : -compare
      })
    }
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
      created_at: now,
      updated_at: now,
      ...row,
      id: row.id ?? this.db.nextId(this.table),
    }
  }
}

function makeRequest(path: string, body?: Row, method = body ? 'POST' : 'GET') {
  const url = `http://localhost${path}`
  const request = new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as NextRequest

  Object.defineProperty(request, 'nextUrl', { value: new URL(url) })
  return request
}

async function readJson(response: Response) {
  return JSON.parse(await response.text()) as Row
}

function setV2ApprovalSnapshot(
  db: MemoryDb,
  approvalId: string,
  planOverride?: Row,
) {
  const approval = db.rows.approvals.find((row) => row.id === approvalId)!
  const action = db.rows.agent_actions.find((row) => row.id === approval.agent_action_id)!
  const plan = planOverride ?? db.rows.plans.find((row) => row.id === approval.plan_id)!
  const snapshotInput = {
    plan: plan as any,
    approval: approval as any,
    action: action as any,
    payload: action.payload_json as Record<string, unknown>,
  }
  approval.snapshot_hash = buildApprovalSnapshotHashV2(snapshotInput)
  approval.snapshot_json = buildApprovalSnapshotV2(snapshotInput)
  approval.snapshot_schema_version = 2
  return approval.snapshot_hash as string
}

function mockPlannerClient(db: MemoryDb, writeDb: MemoryDb = db) {
  mockCreateClient.mockReturnValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: {
          user: {
            id: USER_ID,
            user_metadata: { user_type: 'community_builder' },
          },
        },
        error: null,
      }),
    },
    from: (table: string) => db.from(table),
  })
  mockCreateServiceRoleClient.mockReturnValue({
    from: (table: string) => writeDb.from(table),
    rpc: (name: string, params: Record<string, unknown>) => writeDb.rpc(name, params),
  })
}

describe('MVP launch API contracts', () => {
  let db: MemoryDb

  beforeEach(() => {
    jest.clearAllMocks()
    db = new MemoryDb()
    db.rows.plans.push({
      id: PLAN_ID,
      user_id: USER_ID,
      title: 'MVP launch plan',
      event_type: 'mixer',
      status: 'ready',
      guest_count: 80,
      budget_cap_cents: 800_000,
      neighborhood: 'Mission',
      date_window_start: '2026-08-01',
      date_window_end: '2026-08-02',
      ticketed: true,
      metadata: {},
    })
    db.rows.builder_profiles.push({
      id: 'builder-profile-1',
      user_id: USER_ID,
      name: 'MVP Builder',
      billing_tier: 'free_trial',
      subscription_status: 'trial',
      free_events_granted: 2,
      free_events_used: 0,
      paid_event_credits: 0,
    })
    mockPlannerClient(db)
  })

  it('POST planner agent-actions creates the agent_action, approval row, and visible approval_request message', async () => {
    const response = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'hold_request',
        targetType: 'venue',
        targetId: VENUE_ID_1,
        requestedAmountCents: 500_000,
        payloadJson: {
          action_label: 'Request hold',
          provider: 'Foundry Rooftop',
          package_details: '48-hour soft hold',
        },
      }),
      { params: { planId: PLAN_ID } }
    )
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(json.agentAction).toEqual(expect.objectContaining({
      plan_id: PLAN_ID,
      action_type: 'hold_request',
      amount_cents: 500_000,
    }))
    expect(json.approval).toEqual(expect.objectContaining({
      plan_id: PLAN_ID,
      price_cents: 500_000,
      status: 'pending',
    }))
    expect(json.approvalMessage).toEqual(expect.objectContaining({
      plan_id: PLAN_ID,
      message_type: 'approval_request',
      metadata: expect.objectContaining({
        state: 'recommendation_action_approval_requested',
        status: 'pending',
        source: 'planner_recommendation_action',
        approval: expect.objectContaining({
          id: json.approval.id,
          status: 'pending',
        }),
      }),
    }))
    expect(db.rows.agent_actions).toHaveLength(1)
    expect(db.rows.approvals).toHaveLength(1)
    const snapshotInput = {
      plan: db.rows.plans[0] as any,
      approval: db.rows.approvals[0] as any,
      action: db.rows.agent_actions[0] as any,
      payload: db.rows.agent_actions[0].payload_json as Record<string, unknown>,
    }
    expect(db.rows.approvals[0]).toEqual(expect.objectContaining({
      snapshot_schema_version: 2,
      snapshot_hash: buildApprovalSnapshotHashV2(snapshotInput),
      snapshot_json: buildApprovalSnapshotV2(snapshotInput),
    }))
    expect(db.rows.plan_messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        plan_id: PLAN_ID,
        message_type: 'approval_request',
        metadata: expect.objectContaining({
          approval: expect.objectContaining({
            id: json.approval.id,
          }),
        }),
      }),
    ]))
  })

  it('POST planner agent-actions creates an approval before exposing external checkout', async () => {
    const response = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'external_checkout',
        targetType: 'external',
        requestedAmountCents: 9_500,
        payloadJson: {
          action_label: 'External checkout',
          provider: 'Ticketing partner',
          url: 'https://tickets.example/event/123',
          package_details: 'External ticketing checkout requires approval before the link is used.',
        },
      }),
      { params: { planId: PLAN_ID } }
    )
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(json.agentAction).toEqual(expect.objectContaining({
      plan_id: PLAN_ID,
      action_type: 'external_checkout',
      approval_id: expect.any(String),
    }))
    expect(json.approval).toEqual(expect.objectContaining({
      plan_id: PLAN_ID,
      status: 'pending',
      price_cents: 9_500,
    }))
    expect(db.rows.agent_actions).toHaveLength(1)
    expect(db.rows.approvals).toHaveLength(1)
  })

  it('POST planner agent-actions creates a first-class controlled payment with no seeded card', async () => {
    db.rows.venues.push({
      id: VENUE_ID_1,
      owner_id: '550e8400-e29b-41d4-a716-446655440099',
      venue_name: 'Foundry Rooftop',
    })
    db.rows.venue_stripe_accounts.push({
      owner_id: '550e8400-e29b-41d4-a716-446655440099',
      stripe_account_id: 'acct_venue_ready',
      account_status: 'active',
      charges_enabled: true,
      payouts_enabled: true,
      disabled_reason: null,
    })

    const response = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'payment',
        targetType: 'venue',
        targetId: VENUE_ID_1,
        requestedAmountCents: 50_000,
        payloadJson: {
          action_label: 'Authorize Foundry Rooftop deposit',
          provider: 'Foundry Rooftop',
          fees_cents: 0,
          package_details: 'Confirmed venue deposit',
          refund_terms: 'Refundable until 14 days before the event',
          cancellation_terms: 'New approval required if terms change',
          execution_mode: 'controlled_payment',
          has_controlled_payment_account: true,
          payment_required: true,
        },
      }),
      { params: { planId: PLAN_ID } }
    )
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(json.agentAction).toEqual(expect.objectContaining({
      action_type: 'payment',
      target_type: 'venue',
      target_id: VENUE_ID_1,
      amount_cents: 50_000,
    }))
    expect(json.approval).toEqual(expect.objectContaining({
      status: 'pending',
      price_cents: 50_000,
      payment_method_id: null,
    }))
    expect(json.approvalMessage).toEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        action_type: 'payment',
        execution_mode: 'controlled_payment',
        approval: expect.objectContaining({ payment_method_id: null }),
      }),
    }))
  })

  it('edits $95.50 as a superseding pending version before separate authorization', async () => {
    const createResponse = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'external_checkout',
        targetType: 'external',
        requestedAmountCents: 9_500,
        payloadJson: {
          action_label: 'External checkout',
          provider: 'Ticketing partner',
          url: 'https://tickets.example/event/123',
          package_details: 'External checkout handoff',
          event_date: '2026-08-01',
          notes: 'Initial terms',
        },
      }),
      { params: { planId: PLAN_ID } }
    )
    const created = await readJson(createResponse)
    const generatedActionId = created.agentAction.id as string
    const generatedApprovalId = created.approval.id as string
    const actionRow = db.rows.agent_actions.find((row) => row.id === generatedActionId)!
    const approvalRow = db.rows.approvals.find((row) => row.id === generatedApprovalId)!
    actionRow.id = ACTION_ID
    actionRow.approval_id = APPROVAL_ID
    approvalRow.id = APPROVAL_ID
    approvalRow.agent_action_id = ACTION_ID
    created.agentAction.id = ACTION_ID
    created.agentAction.approval_id = APPROVAL_ID
    created.approval.id = APPROVAL_ID
    created.approval.agent_action_id = ACTION_ID
    const originalApprovalId = APPROVAL_ID

    const editResponse = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: originalApprovalId,
        command: 'edit',
        expectedSnapshotHash: created.approval.snapshot_hash,
        changes: {
          requestedAmountCents: 9_550,
          eventDate: '2026-08-02',
          notes: 'Exact host-edited terms',
        },
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )
    const edited = await readJson(editResponse)

    expect(editResponse.status).toBe(200)
    expect(edited.approval).toEqual(expect.objectContaining({
      id: '650e8400-e29b-41d4-a716-446655440099',
      status: 'pending',
      requested_amount_cents: 9_550,
      authorized_amount_cents: null,
      event_date: '2026-08-02',
      notes: 'Exact host-edited terms',
      supersedes_approval_id: originalApprovalId,
      snapshot_schema_version: 2,
    }))
    expect(new Date(edited.approval.expires_at).getTime()).toBeGreaterThan(Date.now())
    expect(db.rows.approvals.find((row) => row.id === originalApprovalId)?.status).toBe('superseded')
    expect(db.rows.agent_actions[0]).toEqual(expect.objectContaining({
      approval_id: edited.approval.id,
      amount_cents: 9_550,
      status: 'pending',
    }))
    const editedSnapshotInput = {
      plan: db.rows.plans[0] as any,
      approval: edited.approval as any,
      action: db.rows.agent_actions[0] as any,
      payload: db.rows.agent_actions[0].payload_json as Record<string, unknown>,
    }
    expect(edited.approval.snapshot_hash).toBe(buildApprovalSnapshotHashV2(editedSnapshotInput))
    expect(edited.approval.snapshot_json).toEqual(buildApprovalSnapshotV2(editedSnapshotInput))

    const authorizeResponse = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: edited.approval.id,
        command: 'authorize',
        expectedSnapshotHash: edited.approval.snapshot_hash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )
    const authorized = await readJson(authorizeResponse)

    expect(authorizeResponse.status).toBe(200)
    expect(authorized.approval).toEqual(expect.objectContaining({
      status: 'authorized',
      requested_amount_cents: 9_550,
      authorized_amount_cents: 9_550,
    }))
    expect(authorized.confirmationSnapshot).toEqual(expect.objectContaining({
      approval: expect.objectContaining({
        requested_amount_cents: 9_550,
        event_date: '2026-08-02',
        notes: 'Exact host-edited terms',
      }),
    }))
    expect(db.rows.agent_actions[0].status).toBe('approved')
  })

  it('POST planner agent-actions keeps trusted mutations on the service writer', async () => {
    const writeDb = new MemoryDb()
    writeDb.rows = db.rows
    mockPlannerClient(db, writeDb)

    const response = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'hold_request',
        targetType: 'venue',
        targetId: VENUE_ID_1,
        requestedAmountCents: 500_000,
        payloadJson: {
          action_label: 'Request hold',
          provider: 'Foundry Rooftop',
          package_details: '48-hour soft hold',
        },
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(200)
    expect(db.mutations.filter(({ table }) => [
      'agent_actions',
      'approvals',
      'agent_action_audit_log',
      'plan_messages',
    ].includes(table))).toEqual([])
    expect(writeDb.mutations).toEqual(expect.arrayContaining([
      { table: 'agent_actions', operation: 'insert' },
      { table: 'approvals', operation: 'insert' },
      { table: 'agent_action_audit_log', operation: 'insert' },
      { table: 'plan_messages', operation: 'insert' },
    ]))
  })

  it('POST planner agent-actions never creates a service writer for a non-owned plan', async () => {
    db.rows.plans[0].user_id = 'another-user'

    const response = await createAgentAction(
      makeRequest(`/api/planner/plans/${PLAN_ID}/agent-actions`, {
        actionType: 'hold_request',
        targetType: 'venue',
        targetId: VENUE_ID_1,
        requestedAmountCents: 500_000,
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(404)
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
  })

  it('PATCH planner approvals prepares outreach drafts without sending outbound jobs', async () => {
    db.rows.venues.push(
      { id: VENUE_ID_1, venue_name: 'Foundry Rooftop', city: 'San Francisco', state: 'CA', standing_capacity: 160, is_claimed: true },
      { id: VENUE_ID_2, venue_name: 'Mission Social Hall', city: 'San Francisco', state: 'CA', standing_capacity: 120, is_claimed: false }
    )
    db.rows.agent_actions.push({
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: 'email',
      payload_json: {
        kind: 'venue_outreach',
        venue_ids: [VENUE_ID_1, VENUE_ID_2],
        summary: 'MVP launch mixer with clear capacity and budget requirements.',
        requirements: { must_haves: ['AV', 'bar'] },
        response_deadline: '2026-08-10T00:00:00.000Z',
      },
      result_metadata: {
        action_type_fallback: 'opportunity_send_venues',
      },
      status: 'pending',
    })
    const outreachApproval = {
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Send to venues',
      status: 'pending',
      price_cents: 0,
      fees_cents: 0,
      requested_amount_cents: 0,
    }
    db.rows.approvals.push(outreachApproval)
    const snapshotHash = setV2ApprovalSnapshot(db, APPROVAL_ID)

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'authorize',
        expectedSnapshotHash: snapshotHash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(200)
    expect(db.rows.approvals[0].status).toBe('authorized')
    expect(db.rows.agent_actions[0].status).toBe('complete')
    expect(db.rows.agent_actions[0].result_metadata).toEqual(expect.objectContaining({
      outbound_message_sent: false,
      send_requires_explicit_flow: true,
      venue_invite_count: 2,
    }))
    expect(db.rows.builder_profiles[0].free_events_used).toBe(1)
    expect(db.rows.plans[0].metadata.product_gate.event_access_source).toBe('free_trial')
    expect(db.rows.venue_opportunity_briefs).toHaveLength(1)
    expect(db.rows.venue_opportunity_invites).toHaveLength(2)
    expect(db.rows.venue_opportunity_invites.map((invite) => invite.status)).toEqual(['queued', 'queued'])
    expect(new Set(db.rows.venue_opportunity_invites.map((invite) => invite.magic_link_token)).size).toBe(2)
    db.rows.venue_opportunity_invites.forEach((invite) => {
      expect(invite.magic_link_token).toMatch(/^[a-f0-9]{64}$/)
      expect(new Date(invite.magic_link_expires_at).getTime()).toBeGreaterThan(Date.now())
    })
    expect(mockEnqueueOpportunityInviteSendJobs).not.toHaveBeenCalled()
    expect(db.rows.plan_messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message_type: 'status_update',
        metadata: expect.objectContaining({
          status: 'drafts_prepared',
          approval_id: APPROVAL_ID,
        }),
      }),
    ]))
  })

  it('PATCH planner approvals prepares one mixed venue and vendor outreach batch', async () => {
    db.rows.venues.push(
      { id: VENUE_ID_1, venue_name: 'Foundry Rooftop', city: 'San Francisco', state: 'CA', standing_capacity: 160, is_claimed: true },
      { id: VENUE_ID_2, venue_name: 'Mission Social Hall', city: 'San Francisco', state: 'CA', standing_capacity: 120, is_claimed: true }
    )
    db.rows.vendor_profiles.push({
      id: VENDOR_ID,
      name: 'Mission Photo Co.',
      vendor_type: 'photography',
      service_type: 'photo',
      is_claimed: true,
      is_admin_seeded: false,
    })
    db.rows.agent_actions.push({
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: 'email',
      payload_json: {
        kind: 'venue_outreach',
        venue_ids: [VENUE_ID_1, VENUE_ID_2],
        vendor_ids: [VENDOR_ID],
        partner_targets: [
          { kind: 'venue', id: VENUE_ID_1, name: 'Foundry Rooftop' },
          { kind: 'venue', id: VENUE_ID_2, name: 'Mission Social Hall' },
          { kind: 'vendor', id: VENDOR_ID, name: 'Mission Photo Co.' },
        ],
        comparison_goal: 'Collect availability, fit, pricing, and next steps.',
        summary: 'MVP launch mixer with venue and vendor comparison requirements.',
        requirements: { must_haves: ['AV', 'photo'] },
        response_deadline: '2026-08-10T00:00:00.000Z',
      },
      result_metadata: {
        action_type_fallback: 'opportunity_send_venues',
      },
      status: 'pending',
    })
    const mixedOutreachApproval = {
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Approve outreach to 2 venues, 1 vendor',
      status: 'pending',
      price_cents: 0,
      fees_cents: 0,
      requested_amount_cents: 0,
    }
    db.rows.approvals.push(mixedOutreachApproval)
    const snapshotHash = setV2ApprovalSnapshot(db, APPROVAL_ID)

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'authorize',
        expectedSnapshotHash: snapshotHash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(200)
    expect(db.rows.agent_actions[0].status).toBe('complete')
    expect(db.rows.agent_actions[0].result_metadata).toEqual(expect.objectContaining({
      outbound_message_sent: false,
      send_requires_explicit_flow: true,
      venue_invite_count: 2,
      vendor_invite_count: 1,
    }))
    expect(db.rows.agent_actions[0].payload_json).toEqual(expect.objectContaining({
      opportunity_brief_id: expect.any(String),
      vendor_opportunity_brief_id: expect.any(String),
      invite_ids: expect.arrayContaining([expect.any(String)]),
      vendor_invite_ids: expect.arrayContaining([expect.any(String)]),
      queued_invite_count: 2,
      queued_vendor_invite_count: 1,
      partner_targets: expect.arrayContaining([
        expect.objectContaining({ kind: 'venue', name: 'Foundry Rooftop' }),
        expect.objectContaining({ kind: 'vendor', name: 'Mission Photo Co.' }),
      ]),
    }))
    expect(db.rows.venue_opportunity_briefs).toHaveLength(1)
    expect(db.rows.venue_opportunity_invites).toHaveLength(2)
    expect(db.rows.vendor_opportunity_briefs).toHaveLength(1)
    expect(db.rows.vendor_opportunity_invites).toHaveLength(1)
    expect(mockEnqueueOpportunityInviteSendJobs).not.toHaveBeenCalled()
  })

  it('PATCH planner approvals requires re-approval when approval-sensitive fields changed', async () => {
    db.rows.agent_actions.push({
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: 'hold_request',
      payload_json: {
        venue_ids: [VENUE_ID_1],
        seats: 80,
      },
      result_metadata: {},
      status: 'pending',
    })
    db.rows.approvals.push({
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Request hold',
      status: 'pending',
      price_cents: 50_000,
      fees_cents: 0,
      requested_amount_cents: 50_000,
      provider: 'Foundry Rooftop',
      event_date: '2026-08-01',
    })
    const staleSnapshotHash = setV2ApprovalSnapshot(db, APPROVAL_ID, {
      ...db.rows.plans[0],
      guest_count: 70,
    })

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'authorize',
        expectedSnapshotHash: staleSnapshotHash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(409)
    expect(db.rows.approvals[0].status).toBe('re_approval_required')
    expect(db.rows.agent_actions[0].status).toBe('pending')
  })

  it('PATCH planner approvals cannot make a snapshot-less approval executable', async () => {
    db.rows.agent_actions.push({
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: 'hold_request',
      payload_json: {
        venue_ids: [VENUE_ID_1],
        seats: 80,
      },
      result_metadata: {},
      status: 'pending',
    })
    db.rows.approvals.push({
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Request hold',
      status: 'pending',
      price_cents: 50_000,
      fees_cents: 0,
      requested_amount_cents: 50_000,
      provider: 'Foundry Rooftop',
      event_date: '2026-08-01',
      snapshot_hash: null,
    })

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        action: 'authorize',
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(409)
    expect(db.rows.approvals[0].status).toBe('re_approval_required')
    expect(db.rows.approvals[0].authorized_by).toBeUndefined()
    expect(db.rows.approvals[0].authorized_at).toBeUndefined()
    expect(db.rows.agent_actions[0].status).toBe('pending')
  })

  it('PATCH planner approvals cancels rejected actions without preparing outreach', async () => {
    db.rows.agent_actions.push({
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: 'email',
      payload_json: {
        kind: 'venue_outreach',
        venue_ids: [VENUE_ID_1],
      },
      result_metadata: {
        action_type_fallback: 'opportunity_send_venues',
      },
      status: 'pending',
    })
    db.rows.approvals.push({
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Prepare venue outreach',
      status: 'pending',
      price_cents: 0,
      snapshot_hash: buildApprovalSnapshotHash({
        plan: db.rows.plans[0] as any,
        approval: { price_cents: 0 },
        action: db.rows.agent_actions[0] as any,
      }),
    })

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        action: 'reject',
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(200)
    expect(db.rows.approvals[0].status).toBe('rejected')
    expect(db.rows.agent_actions[0].status).toBe('cancelled')
    expect(db.rows.venue_opportunity_briefs).toHaveLength(0)
    expect(mockEnqueueOpportunityInviteSendJobs).not.toHaveBeenCalled()
  })

  it('PATCH planner approvals cancels stale pending approvals even when linked action is terminal', async () => {
    db.rows.agent_actions.push({
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: 'email',
      payload_json: {
        kind: 'venue_outreach',
        venue_ids: [VENUE_ID_1],
      },
      result_metadata: {
        action_type_fallback: 'opportunity_send_venues',
      },
      status: 'complete',
    })
    db.rows.approvals.push({
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Prepare venue outreach',
      status: 'pending',
      price_cents: 0,
    })

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        action: 'cancel',
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(200)
    expect(db.rows.approvals[0].status).toBe('cancelled')
    expect(db.rows.agent_actions[0].status).toBe('complete')
    expect(db.rows.venue_opportunity_briefs).toHaveLength(0)
    expect(mockEnqueueOpportunityInviteSendJobs).not.toHaveBeenCalled()
  })

  it('PATCH planner approvals blocks execution when builder has no product access', async () => {
    db.rows.builder_profiles[0] = {
      ...db.rows.builder_profiles[0],
      free_events_granted: 2,
      free_events_used: 2,
      paid_event_credits: 0,
      billing_tier: 'free_trial',
      subscription_status: 'trial',
    }
    db.rows.agent_actions.push({
      id: ACTION_ID,
      plan_id: PLAN_ID,
      action_type: 'email',
      payload_json: {
        kind: 'venue_outreach',
        venue_ids: [VENUE_ID_1],
      },
      status: 'pending',
    })
    const accessApproval = {
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Send to venues',
      status: 'pending',
      price_cents: 0,
      fees_cents: 0,
      requested_amount_cents: 0,
    }
    db.rows.approvals.push(accessApproval)
    const snapshotHash = setV2ApprovalSnapshot(db, APPROVAL_ID)

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        command: 'authorize',
        expectedSnapshotHash: snapshotHash,
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )
    const json = await readJson(response)

    expect(response.status).toBe(402)
    expect(json).toEqual(expect.objectContaining({
      billingRequired: true,
      error: 'Choose pay-per-event or Pro to continue planning this event.',
    }))
    expect(db.rows.approvals[0].status).toBe('pending')
    expect(db.rows.agent_actions[0].status).toBe('pending')
  })

  it('POST venue opportunities blocks outreach draft generation before approval', async () => {
    db.rows.venues.push({ id: VENUE_ID_1, venue_name: 'Foundry Rooftop', standing_capacity: 160, is_claimed: true })

    const response = await createVenueOpportunity(
      makeRequest(`/api/planner/plans/${PLAN_ID}/opportunities/venues`, {
        venue_ids: [VENUE_ID_1],
        summary: 'Venue fit request for MVP launch mixer.',
        requirements: { must_haves: ['AV'] },
        response_deadline: '2026-08-10T00:00:00.000Z',
      }),
      { params: { planId: PLAN_ID } }
    )
    const json = await readJson(response)

    expect(response.status).toBe(403)
    expect(json.error).toMatch(/Approved outreach approval is required/)
    expect(db.rows.venue_opportunity_briefs).toHaveLength(0)
    expect(db.rows.venue_opportunity_invites).toHaveLength(0)
  })

  it('normalizes Eventbrite tier data into rollups used by analytics', () => {
    const rows = [
      ...Array.from({ length: 5 }, () => ({ platform: 'eventbrite', ticket_tier_name: 'Early Bird', ticket_tier_category: classifyTicketTier('Early Bird'), ticket_quantity: 1, total_amount_cents: 2500, fees_cents: 250, currency: 'usd' })),
      { platform: 'eventbrite', ticket_tier_name: 'Bird', ticket_tier_category: classifyTicketTier('Bird'), ticket_quantity: 1, total_amount_cents: 3000, fees_cents: 300, currency: 'usd' },
      ...Array.from({ length: 10 }, () => ({ platform: 'eventbrite', ticket_tier_name: 'GA', ticket_tier_category: classifyTicketTier('GA'), ticket_quantity: 1, total_amount_cents: 4000, fees_cents: 400, currency: 'usd' })),
      ...Array.from({ length: 5 }, () => ({ platform: 'eventbrite', ticket_tier_name: 'VIP Table', ticket_tier_category: classifyTicketTier('VIP Table'), ticket_quantity: 1, total_amount_cents: 9000, fees_cents: 900, currency: 'usd' })),
      { platform: 'eventbrite', ticket_tier_name: 'Founder Circle', ticket_tier_category: classifyTicketTier('Founder Circle'), ticket_quantity: 1, total_amount_cents: 12000, fees_cents: 1200, currency: 'usd' },
      { platform: 'eventbrite', ticket_tier_name: 'GA', ticket_tier_category: classifyTicketTier('GA'), ticket_quantity: -2, total_amount_cents: -8000, fees_cents: 0, currency: 'usd', is_refund: true },
    ]

    const rollups = buildTicketTierRollups(rows)

    expect(rollups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ticket_tier_name: 'Early Bird', ticket_tier_category: 'early_bird', tickets_sold: 5, gross_revenue_cents: 12_500 }),
        expect.objectContaining({ ticket_tier_name: 'Bird', ticket_tier_category: 'early_bird', tickets_sold: 1, gross_revenue_cents: 3_000 }),
        expect.objectContaining({ ticket_tier_name: 'GA', ticket_tier_category: 'ga', tickets_sold: 10, tickets_refunded: 2, gross_revenue_cents: 40_000, refund_amount_cents: 8_000, net_revenue_cents: 28_000 }),
        expect.objectContaining({ ticket_tier_name: 'VIP Table', ticket_tier_category: 'vip', tickets_sold: 5, gross_revenue_cents: 45_000 }),
        expect.objectContaining({ ticket_tier_name: 'Founder Circle', ticket_tier_category: 'vip', tickets_sold: 1, gross_revenue_cents: 12_000 }),
      ])
    )
  })

  it('keeps contact_email out of anon catalog responses while admin catalog can see it', async () => {
    db.rows.vendor_profiles.push({
      id: VENDOR_ID,
      user_id: null,
      name: 'Saffron Catering',
      business_name: 'Saffron Catering',
      vendor_type: 'Caterer',
      service_type: 'catering',
      bio: 'Bay Area catering',
      city: 'San Francisco',
      state: 'CA',
      pricing_model: 'flat',
      is_published: true,
      is_admin_seeded: true,
      contact_email: 'owner@saffron.example',
    })

    const publicResponse = await listPublicVendors(makeRequest('/api/vendors'))
    const publicJson = await readJson(publicResponse)
    const publicVendorSelect = db.selects.find((select) => select.table === 'vendor_profiles')?.columns ?? ''

    expect(publicResponse.status).toBe(200)
    expect(publicVendorSelect).not.toMatch(/contact_email/i)
    expect(JSON.stringify(publicJson)).not.toContain('owner@saffron.example')

    const adminResponse = await listAdminVendors()
    const adminJson = await readJson(adminResponse)

    expect(adminResponse.status).toBe(200)
    expect(adminJson.vendors[0].contact_email).toBe('owner@saffron.example')
  })
})
