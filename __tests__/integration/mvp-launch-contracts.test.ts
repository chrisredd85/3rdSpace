jest.mock('server-only', () => ({}))

import type { NextRequest } from 'next/server'
import { POST as createAgentAction } from '@/app/api/planner/plans/[planId]/agent-actions/route'
import { PATCH as updateApproval } from '@/app/api/planner/plans/[planId]/approvals/route'
import { POST as createVenueOpportunity } from '@/app/api/planner/plans/[planId]/opportunities/venues/route'
import { GET as listPublicVendors } from '@/app/api/vendors/route'
import { GET as listAdminVendors } from '@/app/api/admin/catalog/vendors/route'
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
    venues: [],
    vendor_profiles: [],
    builder_profiles: [],
    builder_event_usage: [],
  }

  selects: Array<{ table: string; columns: string }> = []
  private sequence = 0

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }

  nextId(table: string) {
    this.sequence += 1
    return `${table}-${this.sequence}`
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

  neq(field: string, value: unknown) {
    this.filters.push([field, { not: value }])
    return this
  }

  is(field: string, value: unknown) {
    this.filters.push([field, value])
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
      const values = Array.isArray(this.payload) ? this.payload : [this.payload]
      const inserted = values.map((value) => this.withDefaults(value as Row))
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
      this.filters.every(([field, value]) => {
        if (value && typeof value === 'object' && 'not' in (value as Row)) {
          return row[field] !== (value as Row).not
        }
        return row[field] === value
      }) &&
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

function mockPlannerClient(db: MemoryDb) {
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
    from: (table: string) => db.from(table),
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

  it('POST planner agent-actions creates the agent_action and approval_request rows', async () => {
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
    expect(db.rows.agent_actions).toHaveLength(1)
    expect(db.rows.approvals).toHaveLength(1)
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

  it('PATCH planner approvals authorizes send-to-venues and prepares Gmail drafts', async () => {
    db.rows.venues.push(
      { id: VENUE_ID_1, venue_name: 'Foundry Rooftop', contact_email: 'events@foundry.example', city: 'San Francisco', state: 'CA', standing_capacity: 160, is_claimed: true },
      { id: VENUE_ID_2, venue_name: 'Mission Social Hall', contact_email: 'bookings@mission.example', city: 'San Francisco', state: 'CA', standing_capacity: 120, is_claimed: false }
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
    db.rows.approvals.push({
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Send to venues',
      status: 'pending',
      price_cents: 0,
    })

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        action: 'authorize',
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(200)
    expect(db.rows.approvals[0].status).toBe('authorized')
    expect(db.rows.agent_actions[0].status).toBe('approved')
    expect(db.rows.builder_profiles[0].free_events_used).toBe(1)
    expect(db.rows.plans[0].metadata.product_gate.event_access_source).toBe('free_trial')
    expect(db.rows.outreach_threads).toHaveLength(2)
    expect(db.rows.outreach_messages).toHaveLength(2)
    expect(db.rows.outreach_threads.map((thread) => thread.state)).toEqual(['draft', 'draft'])
    expect(db.rows.outreach_messages.map((message) => message.direction)).toEqual(['outbound', 'outbound'])
    expect(db.rows.venue_opportunity_briefs).toHaveLength(0)
    expect(db.rows.venue_opportunity_invites).toHaveLength(0)
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
    db.rows.approvals.push({
      id: APPROVAL_ID,
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      action_label: 'Send to venues',
      status: 'pending',
      price_cents: 0,
    })

    const response = await updateApproval(
      makeRequest(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        action: 'authorize',
      }, 'PATCH'),
      { params: { planId: PLAN_ID } }
    )
    const json = await readJson(response)

    expect(response.status).toBe(402)
    expect(json).toEqual(expect.objectContaining({
      billingRequired: true,
      error: 'Choose pay-per-event or Pro to approve outreach.',
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
      ...Array.from({ length: 10 }, () => ({ platform: 'eventbrite', ticket_tier_name: 'GA', ticket_tier_category: classifyTicketTier('GA'), ticket_quantity: 1, total_amount_cents: 4000, fees_cents: 400, currency: 'usd' })),
      ...Array.from({ length: 5 }, () => ({ platform: 'eventbrite', ticket_tier_name: 'VIP Table', ticket_tier_category: classifyTicketTier('VIP Table'), ticket_quantity: 1, total_amount_cents: 9000, fees_cents: 900, currency: 'usd' })),
    ]

    const rollups = buildTicketTierRollups(rows)

    expect(rollups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ticket_tier_category: 'early_bird', tickets_sold: 5, gross_revenue_cents: 12_500 }),
        expect.objectContaining({ ticket_tier_category: 'ga', tickets_sold: 10, gross_revenue_cents: 40_000 }),
        expect.objectContaining({ ticket_tier_category: 'vip', tickets_sold: 5, gross_revenue_cents: 45_000 }),
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
