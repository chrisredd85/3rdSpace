import type { NextRequest } from 'next/server'
import { GET as getPlan, PATCH as patchPlan } from '@/app/api/planner/plans/[planId]/route'
import { GET as listPlans, POST as createPlan } from '@/app/api/planner/plans/route'
import { POST as postMessage } from '@/app/api/planner/plans/[planId]/messages/route'
import { runAgent } from '@/lib/ai/agents'
import { createClient } from '@/lib/supabase/server'

jest.mock('@/lib/ai/agents', () => ({
  runAgent: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
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
const mockRunAgent = runAgent as jest.Mock

type Row = Record<string, any>

class MemoryDb {
  rows: Record<string, Row[]> = {
    plans: [],
    plan_messages: [],
    recommendations: [],
    approvals: [],
    planner_plan_updates: [],
    audit_logs: [],
    event_type_candidates: [],
  }

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
      ticketing_model: null,
      food_responsibility: null,
      venue_terms: null,
      agent_action: null,
      profit_goal_cents: null,
      notes: null,
      metadata: {},
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
      }
    )

    try {
      const response = await postMessage(makeRequest('/api/planner/plans/dinner-plan/messages', { message: 'private room' }), {
        params: { planId: 'dinner-plan' },
      })
      const json = await readJson(response)
      const agentMessage = json.agent_message

      expect(response.status).toBe(200)
      expect(agentMessage.message_type).toBe('recommendation')
      expect(json.plan.status).toBe('ready')
      expect(json.follow_up_messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ message_type: 'recommendation' }),
      ]))
    } finally {
      process.env.OPENAI_API_KEY = oldOpenAIKey
      global.fetch = oldFetch
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
      expect(json.agent_message.content).toMatch(/115/)
    } finally {
      process.env.OPENAI_API_KEY = oldOpenAIKey
    }
  })

  it('creates a plan, appends messages, transitions status, and reloads persisted state', async () => {
    const createResponse = await createPlan(makeRequest('/api/planner/plans', {
      message: 'I want to plan an event',
    }))
    const created = await readJson(createResponse)
    const planId = created.plan.id as string

    expect(createResponse.status).toBe(200)
    expect(created.messages).toHaveLength(2)

    for (const message of ['Event type: mixer', 'Date: June 12', '40 people']) {
      const response = await postMessage(makeRequest(`/api/planner/plans/${planId}/messages`, { message }), {
        params: { planId },
      })
      expect(response.status).toBe(200)
    }

    const readyResponse = await patchPlan(makeRequest(`/api/planner/plans/${planId}`, { status: 'ready' }, 'PATCH'), {
      params: { planId },
    })
    expect(readyResponse.status).toBe(200)

    const approvedResponse = await patchPlan(makeRequest(`/api/planner/plans/${planId}`, { status: 'approved' }, 'PATCH'), {
      params: { planId },
    })
    expect(approvedResponse.status).toBe(200)

    const listResponse = await listPlans(makeRequest('/api/planner/plans?limit=10'))
    const list = await readJson(listResponse)
    expect(list.plans[0].id).toBe(planId)
    expect(list.plans[0].status).toBe('approved')

    const reloadResponse = await getPlan(makeRequest(`/api/planner/plans/${planId}`), {
      params: { planId },
    })
    const reloaded = await readJson(reloadResponse)

    expect(reloadResponse.status).toBe(200)
    expect(reloaded.plan.status).toBe('approved')
    expect(reloaded.workspace_summary).toEqual(expect.objectContaining({
      current_status: 'on_track',
      blockers: [],
    }))
    expect(reloaded.timeline).toEqual(expect.objectContaining({
      impossible_timeline: expect.any(Boolean),
      planning_milestones: expect.any(Array),
    }))
    expect(reloaded.messages).toHaveLength(8)
    expect(db.rows.planner_plan_updates.filter((row) => row.field === 'status')).toHaveLength(2)
  })
})
