jest.mock('server-only', () => ({}))

import type { NextRequest } from 'next/server'
import { GET as getPlan, PATCH as patchPlan } from '@/app/api/planner/plans/[planId]/route'
import { GET as listPlans, POST as createPlan } from '@/app/api/planner/plans/route'
import { POST as postMessage } from '@/app/api/planner/plans/[planId]/messages/route'
import { runAgent } from '@/lib/ai/agents'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/ai/agents', () => ({
  runAgent: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
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
const mockRunAgent = runAgent as jest.Mock

type Row = Record<string, any>

class MemoryDb {
  rows: Record<string, Row[]> = {
    plans: [],
    plan_messages: [],
    recommendations: [],
    approvals: [],
    agent_actions: [],
    planner_plan_updates: [],
    audit_logs: [],
    event_type_candidates: [],
    builder_profiles: [],
  }

  private sequence = 0

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }

  async rpc(functionName: string, args: Row) {
    if (functionName !== 'transition_plan_status') {
      return { data: null, error: { message: `Unknown RPC ${functionName}` } }
    }

    const plan = this.rows.plans.find((row) => row.id === args.p_plan_id)
    if (!plan || plan.status !== args.p_expected_status) {
      return { data: null, error: { code: '40001', message: 'Plan status compare-and-swap failed' } }
    }

    plan.status = args.p_to_status
    plan.updated_at = new Date().toISOString()
    return { data: [{ ...plan }], error: null }
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
  private orderBy: { field: string; ascending: boolean } | null = null
  private rangeBy: { start: number; end: number } | null = null

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

  in(field: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[field]))
    return this
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderBy = { field, ascending: options?.ascending ?? true }
    return this
  }

  range(start: number, end: number) {
    this.rangeBy = { start, end }
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
      const updates = this.payload as Row
      const updated: Row[] = []
      this.db.rows[this.table] = this.db.rows[this.table].map((row) => {
        if (!this.matches(row)) return row
        const next = { ...row, ...updates, updated_at: new Date().toISOString() }
        updated.push(next)
        return next
      })
      return { data: updated, error: null }
    }

    let selected = this.db.rows[this.table].filter((row) => this.matches(row))
    if (this.orderBy) {
      const { field, ascending } = this.orderBy
      selected = [...selected].sort((a, b) =>
        String(a[field] ?? '').localeCompare(String(b[field] ?? '')) * (ascending ? 1 : -1)
      )
    }
    if (this.rangeBy) selected = selected.slice(this.rangeBy.start, this.rangeBy.end + 1)

    return { data: selected, error: null }
  }

  private matches(row: Row) {
    return this.filters.every((filter) => filter(row))
  }

  private withDefaults(row: Row) {
    const now = new Date().toISOString()
    const id = row.id ?? this.db.nextId(this.table)

    if (this.table === 'plans') {
      return {
        status: 'drafting',
        guest_count: null,
        budget_cap_cents: null,
        neighborhood: null,
        date_window_start: null,
        date_window_end: null,
        ticketed: false,
        profit_goal_cents: null,
        notes: null,
        created_at: now,
        updated_at: now,
        ...row,
        id,
      }
    }

    return { created_at: now, updated_at: now, ...row, id }
  }
}

function makeRequest(path: string, body?: Row, method = body ? 'POST' : 'GET') {
  const url = `http://localhost${path}`
  const request = new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as NextRequest

  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
  })

  return request
}

async function readJson(response: Response) {
  const text = await response.text()
  return (text ? JSON.parse(text) : {}) as Row
}

describe('Planner persistence integration', () => {
  let db: MemoryDb

  beforeAll(() => {
    const responseWithJson = Response as typeof Response & {
      json?: (data: unknown, init?: ResponseInit) => Response
    }

    if (typeof responseWithJson.json !== 'function') {
      responseWithJson.json = (data: unknown, init?: ResponseInit) => {
        const headers = new Headers(init?.headers)
        headers.set('content-type', 'application/json')

        return new Response(JSON.stringify(data), { ...init, headers })
      }
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()
    db = new MemoryDb()
    db.rows.builder_profiles.push({
      id: 'builder-profile-1',
      user_id: 'user-1',
      name: 'Planner Builder',
      billing_tier: 'free_trial',
      subscription_status: 'trial',
      free_events_granted: 2,
      free_events_used: 0,
      paid_event_credits: 0,
    })
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: {
            user: {
              id: 'user-1',
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
      rpc: (functionName: string, args: Row) => db.rpc(functionName, args),
    })
  })

  it('promotes a no-question dinner intake response to recommendations when matching fields are complete', async () => {
    const oldOpenAIKey = process.env.OPENAI_API_KEY
    const oldFetch = global.fetch
    process.env.OPENAI_API_KEY = 'test-openai-key'
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      resolved_archetype: { key: 'private_dinner_celebration', display_name: 'Private dinner / celebration' },
      ranked_venues: [],
      vendor_recommendations: [],
      persisted_recommendation_ids: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    mockRunAgent.mockResolvedValueOnce({
      agent_name: 'intake',
      status: 'succeeded',
      output: {
        reflection: 'Perfect — private dinner celebration in the Mission for 25 guests on May 20, 2026.',
        extracted_fields: {
          event_type: null,
          guest_count: null,
          neighborhood: null,
          date_window_start: null,
          date_window_end: null,
          budget_cap_cents: null,
          ticketed: null,
          ticket_price_target: null,
          food_responsibility: null,
          profit_goal_cents: null,
        },
        updated_event_plan: {
          event_name: 'Private dinner celebration',
          expected_attendance: 25,
          city: 'Mission',
          venue_type: 'Private dinner / celebration',
          budget: null,
          event_date: '2026-05-20',
          monetization_model: null,
          headcount_min: 25,
          headcount_max: 25,
          ticket_price_target: null,
          profit_goal: null,
        },
        neighborhood: 'Mission',
        food_drink_needs: null,
        music_av_needs: null,
        vibe_audience: null,
        hard_constraints: [],
        missing_questions: [],
        confidence_score: 0.92,
        next_best_question: null,
        assumptions_made: [],
      },
    })

    db.rows.plans.push({
      id: 'dinner-plan',
      user_id: 'user-1',
      title: "Women's dinner",
      event_type: 'Private dinner / celebration',
      status: 'drafting',
      guest_count: 25,
      budget_cap_cents: null,
      neighborhood: 'Mission',
      date_window_start: '2026-05-20',
      date_window_end: '2026-05-20',
      ticketed: false,
      ticketing_model: 'rsvp',
      food_responsibility: null,
      venue_terms: null,
      agent_action: null,
      profit_goal_cents: null,
      notes: null,
      metadata: {
        matching_signals: {
          bar_required: false,
          catering_style: 'venue_handles',
          photo_video_priority: 'none',
          private_or_shared: 'private',
        },
      },
      created_at: '2026-05-10T10:00:00Z',
      updated_at: '2026-05-10T10:00:00Z',
    })
    db.rows.plan_messages.push(
      {
        id: 'm1',
        plan_id: 'dinner-plan',
        role: 'user',
        content: "I want to host a women's dinner",
        message_type: 'text',
        metadata: {},
        created_at: '2026-05-10T10:00:00Z',
      },
      {
        id: 'm2',
        plan_id: 'dinner-plan',
        role: 'user',
        content: '25',
        message_type: 'text',
        metadata: {},
        created_at: '2026-05-10T10:01:00Z',
      },
      {
        id: 'm3',
        plan_id: 'dinner-plan',
        role: 'user',
        content: 'the mission',
        message_type: 'text',
        metadata: {},
        created_at: '2026-05-10T10:02:00Z',
      },
      {
        id: 'm4',
        plan_id: 'dinner-plan',
        role: 'user',
        content: 'May 20',
        message_type: 'text',
        metadata: {},
        created_at: '2026-05-10T10:03:00Z',
      },
      {
        id: 'm5',
        plan_id: 'dinner-plan',
        role: 'user',
        content: 'venue handles catering and bar. no photographer needed.',
        message_type: 'text',
        metadata: {},
        created_at: '2026-05-10T10:04:00Z',
      }
    )

    try {
      const response = await postMessage(makeRequest('/api/planner/plans/dinner-plan/messages', { message: 'private room, venue handles food and drinks' }), {
        params: { planId: 'dinner-plan' },
      })
      const json = await readJson(response)
      const agentMessage = json.agent_message

      expect(response.status).toBe(200)
      expect(agentMessage.message_type).toBe('recommendation')
      expect(json.plan.status).toBe('ready')
      expect(json.needs_recommendations).toBe(true)
      expect(json.follow_up_messages).toBeUndefined()
    } finally {
      process.env.OPENAI_API_KEY = oldOpenAIKey
      global.fetch = oldFetch
    }
  })

  it('does not auto-trigger recommendations while a fresh agent question is pending', async () => {
    const oldOpenAIKey = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY

    db.rows.plans.push({
      id: 'pending-question-plan',
      user_id: 'user-1',
      title: 'Networking mixer plan',
      event_type: 'Networking mixer',
      status: 'ready',
      guest_count: 40,
      budget_cap_cents: null,
      neighborhood: 'Oakland',
      date_window_start: '2026-07-10',
      date_window_end: '2026-07-10',
      ticketed: false,
      ticketing_model: 'rsvp',
      food_responsibility: null,
      venue_terms: null,
      agent_action: null,
      profit_goal_cents: null,
      notes: null,
      metadata: {},
      created_at: '2026-05-10T10:00:00Z',
      updated_at: '2026-05-10T10:00:00Z',
    })
    db.rows.recommendations.push({
      id: 'pending-question-rec',
      plan_id: 'pending-question-plan',
      type: 'venue',
      reference_id: 'venue-1',
      external_name: 'Old Oakland Bar',
      price_cents: null,
      notes: null,
      rank: 1,
      is_best_fit: true,
      status: 'pending',
      metadata: {},
      created_at: '2026-05-10T10:05:00Z',
    })
    db.rows.plan_messages.push(
      {
        id: 'pending-question-m1',
        plan_id: 'pending-question-plan',
        role: 'user',
        content: 'I want to host a happy hour on July 10th for 40 people',
        message_type: 'text',
        metadata: {},
        created_at: '2026-05-10T10:00:00Z',
      },
      {
        id: 'pending-question-m2',
        plan_id: 'pending-question-plan',
        role: 'agent',
        content: 'I have enough to start matching Oakland options.',
        message_type: 'recommendation',
        metadata: {
          next_action: 'generate_recommendations',
          requires_response: false,
        },
        created_at: '2026-05-10T10:01:00Z',
      }
    )

    try {
      const response = await postMessage(makeRequest('/api/planner/plans/pending-question-plan/messages', {
        message: 'I want it in Downtown or Uptown Oakland',
      }), {
        params: { planId: 'pending-question-plan' },
      })
      const json = await readJson(response)

      expect(response.status).toBe(200)
      expect(json.agent_message.message_type).toBe('text')
      expect(json.agent_message.metadata).toEqual(expect.objectContaining({
        requires_response: true,
      }))
      expect(json.needs_recommendations).toBeUndefined()
    } finally {
      process.env.OPENAI_API_KEY = oldOpenAIKey
    }
  })

  it('triggers recommendations when the agent pivots on an already-ready plan with no recommendation artifacts', async () => {
    const oldOpenAIKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'test-openai-key'
    mockRunAgent.mockResolvedValueOnce({
      agent_name: 'intake',
      status: 'succeeded',
      output: {
        reflection: 'Locked in — pulling San Francisco venues that fit 35 guests for this networking mixer.',
        extracted_fields: {
          event_type: null,
          guest_count: null,
          neighborhood: null,
          date_window_start: null,
          date_window_end: null,
          budget_cap_cents: null,
          ticketed: null,
          ticket_price_target: null,
          food_responsibility: null,
          profit_goal_cents: null,
        },
        updated_event_plan: {
          event_name: 'Networking mixer',
          expected_attendance: 35,
          city: 'San Francisco',
          venue_type: 'Networking mixer',
          budget: null,
          event_date: '2026-05-30',
          monetization_model: null,
          headcount_min: 35,
          headcount_max: 35,
          ticket_price_target: null,
          profit_goal: null,
        },
        neighborhood: 'San Francisco',
        food_drink_needs: null,
        music_av_needs: null,
        vibe_audience: null,
        hard_constraints: [],
        missing_questions: [],
        confidence_score: 0.92,
        next_best_question: null,
        assumptions_made: [],
      },
    })

    db.rows.plans.push({
      id: 'ready-mixer-plan',
      user_id: 'user-1',
      title: "Women's mixer",
      event_type: 'Networking mixer',
      status: 'ready',
      guest_count: 35,
      budget_cap_cents: null,
      neighborhood: 'San Francisco',
      date_window_start: '2026-05-30',
      date_window_end: '2026-05-30',
      ticketed: false,
      ticketing_model: 'rsvp',
      food_responsibility: null,
      venue_terms: null,
      agent_action: null,
      profit_goal_cents: null,
      notes: null,
      metadata: {
        matching_signals: {
          bar_required: true,
          catering_style: 'venue_handles',
          photo_video_priority: 'none',
        },
      },
      created_at: '2026-05-10T10:00:00Z',
      updated_at: '2026-05-10T10:00:00Z',
    })
    db.rows.plan_messages.push(
      {
        id: 'ready-m1',
        plan_id: 'ready-mixer-plan',
        role: 'user',
        content: 'I want to host a womens mixer',
        message_type: 'text',
        metadata: {},
        created_at: '2026-05-10T10:00:00Z',
      },
      {
        id: 'ready-m2',
        plan_id: 'ready-mixer-plan',
        role: 'user',
        content: 'San Francisco',
        message_type: 'text',
        metadata: {},
        created_at: '2026-05-10T10:01:00Z',
      },
      {
        id: 'ready-m3',
        plan_id: 'ready-mixer-plan',
        role: 'user',
        content: '35',
        message_type: 'text',
        metadata: {},
        created_at: '2026-05-10T10:02:00Z',
      }
    )

    try {
      const response = await postMessage(makeRequest('/api/planner/plans/ready-mixer-plan/messages', { message: 'May 30th' }), {
        params: { planId: 'ready-mixer-plan' },
      })
      const json = await readJson(response)

      expect(response.status).toBe(200)
      expect(json.agent_message.message_type).toBe('recommendation')
      expect(json.plan.status).toBe('ready')
      expect(json.needs_recommendations).toBe(true)
    } finally {
      process.env.OPENAI_API_KEY = oldOpenAIKey
    }
  })

  it('uses a bare numeric reply as guest count and does not repeat the headcount question', async () => {
    const oldOpenAIKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'test-openai-key'
    mockRunAgent.mockResolvedValueOnce({
      agent_name: 'intake',
      status: 'succeeded',
      output: {
        reflection: 'Handling a networking mixer in Oakland on May 15, 2026.',
        extracted_fields: {
          event_type: null,
          guest_count: null,
          neighborhood: null,
          date_window_start: null,
          date_window_end: null,
          budget_cap_cents: null,
          ticketed: null,
          ticket_price_target: null,
          food_responsibility: null,
          profit_goal_cents: null,
        },
        updated_event_plan: {
          event_name: 'Networking mixer plan',
          expected_attendance: null,
          city: null,
          venue_type: 'Networking mixer',
          budget: null,
          event_date: null,
          monetization_model: null,
          headcount_min: null,
          headcount_max: null,
          ticket_price_target: null,
          profit_goal: null,
        },
        neighborhood: null,
        food_drink_needs: null,
        music_av_needs: null,
        vibe_audience: null,
        hard_constraints: [],
        missing_questions: ['How many people are you planning for?'],
        confidence_score: 0.88,
        next_best_question: 'How many people are you planning for?',
        assumptions_made: [],
      },
    })

    db.rows.plans.push({
      id: 'mixer-plan',
      user_id: 'user-1',
      title: 'Networking mixer plan',
      event_type: 'Networking mixer',
      status: 'drafting',
      guest_count: null,
      budget_cap_cents: null,
      neighborhood: 'Oakland',
      date_window_start: '2026-05-15',
      date_window_end: '2026-05-15',
      ticketed: false,
      ticketing_model: 'rsvp',
      food_responsibility: null,
      venue_terms: null,
      agent_action: null,
      profit_goal_cents: null,
      notes: null,
      metadata: {},
      created_at: '2026-05-10T10:00:00Z',
      updated_at: '2026-05-10T10:00:00Z',
    })

    try {
      const response = await postMessage(makeRequest('/api/planner/plans/mixer-plan/messages', { message: '115' }), {
        params: { planId: 'mixer-plan' },
      })
      const json = await readJson(response)

      expect(response.status).toBe(200)
      expect(json.plan.guest_count).toBe(115)
      expect(json.agent_message.content).not.toMatch(/how many people/i)
      expect(json.agent_message.content).toMatch(/full bar|beverage program/i)
    } finally {
      process.env.OPENAI_API_KEY = oldOpenAIKey
    }
  })

  it('creates a plan, persists messages, and blocks generic lifecycle authorization', async () => {
    const createResponse = await createPlan(makeRequest('/api/planner/plans', {
      message: 'I want to plan an event',
    }))
    const created = await readJson(createResponse)
    const planId = created.plan.id as string

    expect(createResponse.status).toBe(200)
    expect(created.messages).toHaveLength(2)

    for (const message of ['Event type: mixer', 'Date: June 12', '40 people', 'Neighborhood: Mission District']) {
      const response = await postMessage(makeRequest(`/api/planner/plans/${planId}/messages`, { message }), {
        params: { planId },
      })
      expect(response.status).toBe(200)
    }

    const persistedPlan = db.rows.plans.find((row) => row.id === planId)!
    if (persistedPlan.status === 'drafting') {
      await db.rpc('transition_plan_status', {
        p_plan_id: planId,
        p_expected_status: 'drafting',
        p_to_status: 'ready',
      })
    }

    const readyResponse = await patchPlan(makeRequest(`/api/planner/plans/${planId}`, { status: 'ready' }, 'PATCH'), {
      params: { planId },
    })
    expect(readyResponse.status).toBe(422)

    const approvedResponse = await patchPlan(makeRequest(`/api/planner/plans/${planId}`, { status: 'approved' }, 'PATCH'), {
      params: { planId },
    })
    expect(approvedResponse.status).toBe(422)
    await expect(readJson(approvedResponse)).resolves.toMatchObject({
      details: { code: 'plan_status_command_required' },
    })

    const listResponse = await listPlans(makeRequest('/api/planner/plans?limit=10'))
    const list = await readJson(listResponse)
    expect(list.plans[0].id).toBe(planId)
    expect(list.plans[0].status).toBe('ready')

    const reloadResponse = await getPlan(makeRequest(`/api/planner/plans/${planId}`), {
      params: { planId },
    })
    const reloaded = await readJson(reloadResponse)

    expect(reloadResponse.status).toBe(200)
    expect(reloaded.plan.status).toBe('ready')
    expect(reloaded.workspace_summary).toEqual(expect.objectContaining({
      current_status: 'on_track',
      blockers: [],
    }))
    expect(reloaded.timeline).toEqual(expect.objectContaining({
      impossible_timeline: expect.any(Boolean),
      planning_milestones: expect.any(Array),
    }))
    expect(reloaded.messages).toHaveLength(10)
    expect(db.rows.planner_plan_updates.filter((row) => row.field === 'status')).toHaveLength(0)
  })

  it('archives through the centralized lifecycle command', async () => {
    db.rows.plans.push({
      id: 'archive-plan',
      user_id: 'user-1',
      title: 'Archive me',
      event_type: 'community_mixer',
      status: 'ready',
      guest_count: 40,
      budget_cap_cents: 100_000,
      neighborhood: 'Mission',
      date_window_start: '2026-08-15',
      date_window_end: '2026-08-15',
      ticketed: false,
      profit_goal_cents: null,
      notes: null,
      metadata: {},
    })

    const response = await patchPlan(
      makeRequest('/api/planner/plans/archive-plan', { status: 'archived' }, 'PATCH'),
      { params: { planId: 'archive-plan' } }
    )

    expect(response.status).toBe(200)
    await expect(readJson(response)).resolves.toMatchObject({ plan: { id: 'archive-plan', status: 'archived' } })
    expect(db.rows.plans.find((row) => row.id === 'archive-plan')?.status).toBe('archived')
  })

  it('does not let generic PATCH split a materialized plan from its event', async () => {
    db.rows.plans.push({
      id: 'materialized-plan',
      user_id: 'user-1',
      title: 'Canonical mixer',
      event_type: 'community_mixer',
      status: 'executing',
      materialized_event_id: 'canonical-event-1',
      guest_count: 40,
      budget_cap_cents: 100_000,
      neighborhood: 'Mission',
      date_window_start: '2026-08-15',
      date_window_end: '2026-08-15',
      ticketed: false,
      profit_goal_cents: null,
      notes: null,
      metadata: {},
    })

    const response = await patchPlan(
      makeRequest('/api/planner/plans/materialized-plan', { guest_count: 75 }, 'PATCH'),
      { params: { planId: 'materialized-plan' } }
    )

    expect(response.status).toBe(409)
    await expect(readJson(response)).resolves.toMatchObject({
      details: { code: 'canonical_event_revision_required' },
    })
    expect(db.rows.plans.find((row) => row.id === 'materialized-plan')?.guest_count).toBe(40)
    expect(db.rows.planner_plan_updates).toHaveLength(0)
  })

  it('does not let generic PATCH change facts covered by an existing authorization', async () => {
    db.rows.plans.push({
      id: 'approved-plan',
      user_id: 'user-1',
      title: 'Approved mixer',
      event_type: 'community_mixer',
      status: 'approved',
      materialized_event_id: null,
      guest_count: 40,
      budget_cap_cents: 100_000,
      neighborhood: 'Mission',
      date_window_start: '2026-08-15',
      date_window_end: '2026-08-15',
      ticketed: false,
      profit_goal_cents: null,
      notes: null,
      metadata: {},
    })

    const response = await patchPlan(
      makeRequest('/api/planner/plans/approved-plan', { date_window_start: '2026-08-22' }, 'PATCH'),
      { params: { planId: 'approved-plan' } }
    )

    expect(response.status).toBe(409)
    expect(db.rows.plans.find((row) => row.id === 'approved-plan')?.date_window_start).toBe('2026-08-15')
    expect(db.rows.planner_plan_updates).toHaveLength(0)
  })

  it('does not let a confirmed chat change split a materialized plan from its event', async () => {
    db.rows.plans.push({
      id: 'materialized-chat-plan',
      user_id: 'user-1',
      title: 'Canonical dinner',
      event_type: 'private_dinner_celebration',
      status: 'executing',
      materialized_event_id: 'canonical-event-2',
      guest_count: 24,
      budget_cap_cents: 200_000,
      neighborhood: 'Mission',
      date_window_start: '2026-08-15',
      date_window_end: '2026-08-15',
      ticketed: false,
      profit_goal_cents: null,
      notes: null,
      metadata: {
        pending_plan_change: {
          field: 'date_window_start',
          from: '2026-08-15',
          to: '2026-08-22',
          raw_value: '2026-08-22',
          prompt: 'Should I update the date?',
        },
      },
    })

    const response = await postMessage(
      makeRequest('/api/planner/plans/materialized-chat-plan/messages', { message: 'Yes, update it' }),
      { params: { planId: 'materialized-chat-plan' } }
    )

    expect(response.status).toBe(409)
    expect(db.rows.plans.find((row) => row.id === 'materialized-chat-plan')?.date_window_start).toBe('2026-08-15')
    expect(db.rows.plan_messages).toHaveLength(0)
  })

  it('returns action-aware approval truth from the full plan read model', async () => {
    db.rows.plans.push({
      id: 'failed-plan',
      user_id: 'user-1',
      title: 'Failed outreach plan',
      event_type: 'Happy hour',
      status: 'ready',
      guest_count: 40,
      budget_cap_cents: 100_000,
      neighborhood: 'Mission',
      date_window_start: '2026-08-10',
      date_window_end: '2026-08-10',
      ticketed: false,
      ticketing_model: 'rsvp',
      food_responsibility: 'venue',
      profit_goal_cents: null,
      notes: null,
      metadata: {},
      created_at: '2026-07-09T00:00:00.000Z',
      updated_at: '2026-07-09T00:00:00.000Z',
    })
    db.rows.agent_actions.push({
      id: 'failed-action',
      plan_id: 'failed-plan',
      action_type: 'email',
      status: 'failed',
      result_metadata: { error: 'Gmail unavailable' },
      last_retry_result: null,
    })
    db.rows.approvals.push({
      id: 'failed-approval',
      plan_id: 'failed-plan',
      agent_action_id: 'failed-action',
      action_label: 'Send outreach',
      provider: 'Gmail',
      status: 'authorized',
      expires_at: '2099-01-01T00:00:00.000Z',
      created_at: '2026-07-09T00:00:00.000Z',
      updated_at: '2026-07-09T00:00:00.000Z',
    })

    const response = await getPlan(makeRequest('/api/planner/plans/failed-plan'), {
      params: { planId: 'failed-plan' },
    })
    const result = await readJson(response)

    expect(response.status).toBe(200)
    expect(result.approvals).toEqual([
      expect.objectContaining({
        id: 'failed-approval',
        action_status: 'failed',
        action_result: { error: 'Gmail unavailable' },
        ui_status: 'failed',
        available_actions: ['retry'],
      }),
    ])
  })

  it('blocks free-tier creation after two active plans', async () => {
    db.rows.plans.push(
      {
        id: 'first-active-plan',
        user_id: 'user-1',
        title: 'First active plan',
        event_type: 'mixer',
        status: 'drafting',
        created_at: '2026-05-10T10:00:00Z',
        updated_at: '2026-05-10T10:00:00Z',
      },
      {
        id: 'second-active-plan',
        user_id: 'user-1',
        title: 'Second active plan',
        event_type: 'dinner',
        status: 'ready',
        created_at: '2026-05-11T10:00:00Z',
        updated_at: '2026-05-11T10:00:00Z',
      }
    )

    const response = await createPlan(makeRequest('/api/planner/plans', {
      message: 'I want to plan a third event',
    }))
    const json = await readJson(response)

    expect(response.status).toBe(402)
    expect(json).toEqual(expect.objectContaining({
      billingRequired: true,
      error: 'Choose pay-per-event or Pro to create another event.',
      billing: expect.objectContaining({
        freeEventsGranted: 2,
      }),
    }))
    expect(db.rows.plans).toHaveLength(2)
  })

  it('marks migrated ready public drafts as needing recommendations', async () => {
    const createResponse = await createPlan(makeRequest('/api/planner/plans', {
      message: 'Game night in downtown Oakland',
      draft: {
        plan: {
          title: 'Game / sports outing plan',
          event_type: 'Game / sports outing',
          status: 'ready',
          guest_count: 50,
          neighborhood: 'Downtown Oakland',
          date_window_start: '2026-05-30',
          date_window_end: '2026-05-30',
          ticketed: false,
          ticketing_model: null,
        },
        messages: [
          {
            role: 'user',
            content: 'I want to host a game night in downtown Oakland for 50 people',
            message_type: 'text',
            metadata: {},
            created_at: '2026-05-16T19:20:00.000Z',
          },
          {
            role: 'agent',
            content: 'I have enough to match venues and vendors for this game / sports outing for 50 guests in Downtown Oakland. Create a planner account to save this draft and unlock real venue matches, vendor picks, financial projections, and approval cards.',
            message_type: 'status_update',
            metadata: {
              state: 'draft_match_signup_gate',
              requires_auth: true,
              next_action: 'signup_to_match',
            },
            created_at: '2026-05-16T19:25:00.000Z',
          },
        ],
      },
    }))
    const created = await readJson(createResponse)

    expect(createResponse.status).toBe(200)
    expect(created.plan.status).toBe('ready')
    expect(created.needs_recommendations).toBe(true)
    expect(created.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message_type: 'status_update',
        metadata: expect.objectContaining({
          state: 'draft_match_signup_gate',
        }),
      }),
    ]))
  })
})
