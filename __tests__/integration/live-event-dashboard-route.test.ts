jest.mock('server-only', () => ({}))

import type { NextRequest } from 'next/server'
import {
  GET as getLiveSnapshot,
  PATCH as patchLiveRecommendation,
} from '@/app/api/planner/events/[eventId]/live/route'
import { runLiveEventRecompute } from '@/lib/live-events/recommendations'
import { computeEventPnL } from '@/lib/finance/eventActuals'
import { runEconomicsAgent } from '@/lib/ai/agents/economicsAgent'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'
import type { EventPnL } from '@/lib/finance/eventActuals'

jest.mock('@/lib/finance/eventActuals', () => ({
  computeEventPnL: jest.fn(),
}))

jest.mock('@/lib/ai/agents/economicsAgent', () => ({
  runEconomicsAgent: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/supabase/server-helpers', () => ({
  getBuilderProfileId: jest.fn(),
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

type Row = Record<string, unknown>

const EVENT_ID = '00000000-0000-4000-8000-000000000001'
const BUILDER_ID = '00000000-0000-4000-8000-000000000002'
const RECOMMENDATION_ID = '00000000-0000-4000-8000-000000000003'

describe('live event dashboard route and recompute job', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockComputeEventPnL.mockResolvedValue(makePnl())
    mockRunEconomicsAgent.mockRejectedValue(new Error('OpenAI is not configured'))
  })

  it('dedupes live triggers that already have an open recommendation', async () => {
    const db = new MemoryDb({
      events: [makeEvent()],
      live_recommendations: [
        {
          id: 'recommendation-open',
          event_id: EVENT_ID,
          org_id: BUILDER_ID,
          trigger_key: 'breakeven_crossed',
          state: 'open',
          severity: 'info',
          suggested_action: 'Existing breakeven recommendation',
          evidence: {},
          agent_narrative: 'Existing',
          created_at: '2026-06-02T00:00:00.000Z',
          updated_at: '2026-06-02T00:00:00.000Z',
        },
      ],
    })

    const firstRun = await runLiveEventRecompute(db, EVENT_ID)

    expect(firstRun.inserted).toBe(1)
    expect(firstRun.skipped_open).toBe(1)
    expect(firstRun.recommendations[0]).toMatchObject({
      trigger_key: 'velocity_drop',
      state: 'open',
      severity: 'recommend',
    })
    expect(db.rows.live_recommendations.filter((row) => row.state === 'open')).toHaveLength(2)

    const secondRun = await runLiveEventRecompute(db, EVENT_ID)

    expect(secondRun.inserted).toBe(0)
    expect(secondRun.skipped_open).toBe(2)
    expect(db.rows.live_recommendations.filter((row) => row.trigger_key === 'velocity_drop')).toHaveLength(1)
  })

  it('returns a structured live snapshot for the event owner', async () => {
    const userDb = authenticatedUserDb({
      events: [makeEvent()],
    })
    const adminDb = new MemoryDb({
      builder_ticketing_connections: [
        {
          id: 'connection-1',
          builder_id: BUILDER_ID,
          platform: 'eventbrite',
          status: 'connected',
        },
      ],
      event_revenue_terms: [],
      event_sales_data: [
        {
          event_id: EVENT_ID,
          gross_cents: 25_000,
          is_refund: false,
          purchase_timestamp: new Date().toISOString(),
        },
      ],
      live_recommendations: [
        {
          id: RECOMMENDATION_ID,
          event_id: EVENT_ID,
          org_id: BUILDER_ID,
          trigger_key: 'velocity_drop',
          state: 'open',
          severity: 'recommend',
          suggested_action: 'Review promotion timing.',
          evidence: { last_24h_cents: 1000 },
          agent_narrative: 'Review promotion timing. Evidence: velocity_drop last_24h_cents=1000.',
          created_at: '2026-06-02T00:00:00.000Z',
          updated_at: '2026-06-02T00:00:00.000Z',
        },
      ],
    })
    const basePnl = makePnl()
    mockComputeEventPnL.mockResolvedValue({
      ...basePnl,
      revenue: {
        ...basePnl.revenue,
        refunds_cents: 15_000,
        tickets_refunded: 10,
        tickets_checked_in: 45,
      },
    })
    mockCreateClient.mockReturnValue(userDb)
    mockCreateServiceRoleClient.mockReturnValue(adminDb)
    mockGetBuilderProfileId.mockResolvedValue({ builderProfileId: BUILDER_ID, error: null })

    const response = await getLiveSnapshot(makeRequest(undefined, 'GET'), { params: { eventId: EVENT_ID } })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.snapshot.kpis).toMatchObject({
      tickets_sold: 60,
      gross_revenue_cents: 150000,
      net_revenue_cents: 150000,
      refund_risk_level: 'watch',
    })
    expect(payload.snapshot.signals.attendance).toMatchObject({
      active_tickets: 50,
      checked_in: 45,
      no_show_count: 5,
      no_show_rate: 0.1,
    })
    expect(payload.snapshot.recommendations[0]).toMatchObject({
      id: RECOMMENDATION_ID,
      action_contract: {
        execution_mode: 'analysis_only',
        requires_approval_before_execution: true,
        approval_id: null,
      },
    })
  })

  it('does not load live intelligence for events owned by another builder', async () => {
    const userDb = authenticatedUserDb({
      events: [{ ...makeEvent(), builder_id: '00000000-0000-4000-8000-000000000099' }],
    })
    mockCreateClient.mockReturnValue(userDb)
    mockGetBuilderProfileId.mockResolvedValue({ builderProfileId: BUILDER_ID, error: null })

    const response = await getLiveSnapshot(makeRequest(undefined, 'GET'), { params: { eventId: EVENT_ID } })
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload).toEqual({ error: 'Event not found' })
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
    expect(mockComputeEventPnL).not.toHaveBeenCalled()
  })

  it('persists recommendation state changes through the planner API', async () => {
    const userDb = authenticatedUserDb({
      events: [makeEvent()],
    })
    const adminDb = new MemoryDb({
      live_recommendations: [
        {
          id: RECOMMENDATION_ID,
          event_id: EVENT_ID,
          org_id: BUILDER_ID,
          trigger_key: 'velocity_drop',
          state: 'open',
          severity: 'recommend',
          suggested_action: 'Review promotion timing.',
          evidence: { last_24h_cents: 1000 },
          agent_narrative: 'Review promotion timing. Evidence: velocity_drop last_24h_cents=1000.',
          created_at: '2026-06-02T00:00:00.000Z',
          updated_at: '2026-06-02T00:00:00.000Z',
        },
      ],
    })
    mockCreateClient.mockReturnValue(userDb)
    mockCreateServiceRoleClient.mockReturnValue(adminDb)
    mockGetBuilderProfileId.mockResolvedValue({ builderProfileId: BUILDER_ID, error: null })

    const response = await patchLiveRecommendation(
      makeRequest({ recommendation_id: RECOMMENDATION_ID, state: 'acted_on' }),
      { params: { eventId: EVENT_ID } }
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.recommendation).toMatchObject({
      id: RECOMMENDATION_ID,
      state: 'acted_on',
    })
    expect(adminDb.rows.live_recommendations[0]).toMatchObject({
      id: RECOMMENDATION_ID,
      state: 'acted_on',
    })
  })
})

class MemoryDb {
  rows: Record<string, Row[]>
  auth?: { getUser: jest.Mock }
  private sequence = 0

  constructor(rows: Record<string, Row[]> = {}) {
    this.rows = rows
  }

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
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'select' | 'insert' | 'update' = 'select'
  private payload: unknown

  constructor(private db: MemoryDb, private table: string) {}

  select(_columns = '*') {
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
    this.filters.push((row) => row[field] === value)
    return this
  }

  order(_field: string, _options?: { ascending?: boolean }) {
    return this
  }

  in(field: string, values: unknown[]) {
    const allowed = new Set(values)
    this.filters.push((row) => allowed.has(row[field]))
    return this
  }

  limit(_count: number) {
    return this
  }

  async maybeSingle() {
    const result = await this.execute()
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: null }
  }

  async single() {
    const result = await this.execute()
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: row ? null : { message: 'No row' } }
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
      return { data: inserted, error: null }
    }

    if (this.operation === 'update') {
      const updated: Row[] = []
      this.db.rows[this.table] = this.db.rows[this.table].map((row) => {
        if (!this.filters.every((filter) => filter(row))) return row
        const next = { ...row, ...(this.payload as Row), updated_at: '2026-06-02T01:00:00.000Z' }
        updated.push(next)
        return next
      })
      return { data: updated, error: null }
    }

    return {
      data: this.db.rows[this.table].filter((row) => this.filters.every((filter) => filter(row))),
      error: null,
    }
  }

  private withDefaults(row: Row) {
    return {
      id: row.id ?? this.db.nextId(this.table),
      created_at: row.created_at ?? '2026-06-02T01:00:00.000Z',
      updated_at: row.updated_at ?? '2026-06-02T01:00:00.000Z',
      ...row,
    }
  }
}

function makeEvent() {
  return {
    id: EVENT_ID,
    builder_id: BUILDER_ID,
    event_name: 'Live test event',
    event_type: 'social_mixer',
    event_date: '2026-06-20',
    expected_attendance: 100,
    expected_attendance_max: 100,
    budget: 0,
    total_budget: 0,
    status: 'confirmed',
  }
}

function makePnl(): EventPnL {
  return {
    revenue: {
      gross_revenue_cents: 150000,
      refunds_cents: 0,
      platform_fees_cents: 0,
      taxes_collected_cents: 0,
      net_revenue_cents: 150000,
      tickets_sold: 60,
      tickets_refunded: 0,
      tickets_checked_in: null,
      tier_breakdown: [
        { tier_name: 'GA', sold: 60, gross_cents: 150000, sellout_pct: 0.6 },
      ],
      velocity: {
        last_24h_cents: 1000,
        last_7d_cents: 100000,
        since_launch_cents: 150000,
        projected_sellout_at: null,
      },
      data_sources: ['posh_webhook'],
      confidence: {
        revenue: 'high',
        attendance: 'low',
      },
      last_event_at: '2026-06-02T00:00:00.000Z',
    },
    costs: {
      estimated_cents: 0,
      committed_cents: 50000,
      paid_cents: 0,
    },
    net: {
      conservative_cents: 100000,
      expected_cents: 100000,
      optimistic_cents: 150000,
    },
    breakeven: {
      tickets_needed: 40,
      tickets_to_go: 0,
      crossed_at: '2026-06-02T00:00:00.000Z',
    },
    margin_pct: 20,
    rev_share_adjustments: [],
    terms_conflict: false,
  }
}

function authenticatedUserDb(rows: Record<string, Row[]> = {}) {
  const db = new MemoryDb(rows)
  db.auth = {
    getUser: jest.fn().mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'creator@example.com',
          user_metadata: { user_type: 'community_builder' },
        },
      },
      error: null,
    }),
  }
  return db
}

function makeRequest(body?: Row, method = 'PATCH') {
  return new Request(`http://localhost/api/planner/events/${EVENT_ID}/live`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as NextRequest
}

const mockComputeEventPnL = computeEventPnL as jest.Mock
const mockRunEconomicsAgent = runEconomicsAgent as jest.Mock
const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock
const mockGetBuilderProfileId = getBuilderProfileId as jest.Mock
