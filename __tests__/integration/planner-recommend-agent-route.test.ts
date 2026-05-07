jest.mock('server-only', () => ({}))

import type { NextRequest } from 'next/server'
import { POST as recommendPlan } from '@/app/api/planner/plans/[planId]/recommend/route'
import { runEconomicsAgent } from '@/lib/ai/agents/economicsAgent'
import { runVenueMatchingAgent } from '@/lib/ai/agents/venueMatchingAgent'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/ai/agents/venueMatchingAgent', () => ({
  venueMatchingAgentDefinition: { agentName: 'venue_matching', model: 'gpt-4o' },
  runVenueMatchingAgent: jest.fn(),
}))

jest.mock('@/lib/ai/agents/economicsAgent', () => ({
  economicsAgentDefinition: { agentName: 'economics', model: 'gpt-4o-mini' },
  runEconomicsAgent: jest.fn(),
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

type Row = Record<string, unknown>

class MemoryDb {
  rows: Record<string, Row[]> = {
    plans: [],
    plan_messages: [],
    venues: [],
    recommendations: [],
    audit_logs: [],
    agent_runs: [],
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
  private operation: 'select' | 'insert' = 'select'
  private payload: unknown
  private rowLimit: number | null = null
  private orderBy: { field: string; ascending: boolean } | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select() {
    return this
  }

  insert(payload: unknown) {
    this.operation = 'insert'
    this.payload = payload
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value)
    return this
  }

  ilike(field: string, pattern: string) {
    const needle = pattern.replace(/%/g, '').toLowerCase()
    this.filters.push((row) => String(row[field] ?? '').toLowerCase().includes(needle))
    return this
  }

  or(expression: string) {
    const checks = expression.split(',').map((part) => {
      const [field, operator, rawValue] = part.split('.')
      const expected = Number(rawValue)
      return { field, operator, expected }
    })
    this.filters.push((row) => checks.some((check) => {
      const actual = Number(row[check.field] ?? 0)
      return check.operator === 'gte' && actual >= check.expected
    }))
    return this
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderBy = { field, ascending: options?.ascending ?? true }
    return this
  }

  limit(count: number) {
    this.rowLimit = count
    return this
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
      return { data: inserted, error: null }
    }

    let selected = this.db.rows[this.table].filter((row) => this.filters.every((filter) => filter(row)))
    if (this.orderBy) {
      const { field, ascending } = this.orderBy
      selected = [...selected].sort((a, b) =>
        String(a[field] ?? '').localeCompare(String(b[field] ?? '')) * (ascending ? 1 : -1)
      )
    }
    if (this.rowLimit !== null) selected = selected.slice(0, this.rowLimit)
    return { data: selected, error: null }
  }

  private withDefaults(row: Row) {
    return {
      id: row.id ?? this.db.nextId(this.table),
      created_at: new Date().toISOString(),
      ...row,
    }
  }
}

const mockRunVenueMatchingAgent = runVenueMatchingAgent as jest.Mock
const mockRunEconomicsAgent = runEconomicsAgent as jest.Mock
const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock

function makeRequest(body: Row = {}) {
  return new Request('http://localhost/api/planner/plans/plan-1/recommend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

async function readJson(response: Response) {
  return response.json() as Promise<Row>
}

describe('POST /api/planner/plans/[planId]/recommend', () => {
  const previousOpenAIKey = process.env.OPENAI_API_KEY
  let db: MemoryDb

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OPENAI_API_KEY = 'test-openai-key'
    db = new MemoryDb()
    db.rows.plans.push({
      id: 'plan-1',
      user_id: 'user-1',
      title: 'Founder dinner',
      event_type: 'dinner',
      status: 'ready',
      guest_count: 80,
      budget_cap_cents: 400000,
      neighborhood: 'Mission',
      date_window_start: '2026-06-19',
      date_window_end: '2026-06-19',
      ticketed: true,
      ticketing_model: 'ticketed',
      food_responsibility: 'venue',
      venue_terms: null,
      agent_action: null,
      profit_goal_cents: 100000,
      notes: null,
    })
    db.rows.venues.push({
      id: 'venue-1',
      venue_name: 'Mission Hall',
      venue_type: 'restaurant',
      standing_capacity: 120,
      seated_capacity: 90,
      city: 'San Francisco',
      state: 'CA',
      hourly_rate: 50000,
      minimum_hours: 4,
      is_published: true,
      per_head_kickback: null,
      offers_kickbacks: false,
      deposit_percentage: 25,
      cancellation_terms: 'Refundable until 14 days out.',
      available_days: ['friday'],
      bar_revenue_share_enabled: false,
      venue_amenities: [{ venue_id: 'venue-1', amenity_name: 'private dining room' }],
    })

    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1', user_metadata: { user_type: 'community_builder' } } },
          error: null,
        }),
      },
      from: db.from.bind(db),
    })
    mockCreateServiceRoleClient.mockReturnValue({ from: db.from.bind(db) })

    mockRunVenueMatchingAgent.mockResolvedValue({
      agent_name: 'venue_matching',
      status: 'succeeded',
      model: 'gpt-4o',
      prompt_tokens: 100,
      completion_tokens: 20,
      messages_payload: [{ role: 'system', content: 'Rank venues.' }],
      raw_model_output: '{"ranked_venues":[]}',
      duration_ms: 50,
      output: {
        ranked_venues: [{
          venue_id: 'venue-1',
          venue_name: 'Mission Hall',
          fit_score: 91,
          pros: ['Strong seated capacity and city fit.'],
          cons: ['Deposit terms need confirmation.'],
          questions_to_ask_venue: ['Can you confirm the private dining minimum?'],
        }],
        best_recommendation: 'Mission Hall is the strongest fit.',
        reason_summary: 'Mission Hall fits the city, budget, and headcount.',
        no_match: false,
      },
    })
    mockRunEconomicsAgent.mockResolvedValue({
      agent_name: 'economics',
      status: 'succeeded',
      model: 'gpt-4o-mini',
      prompt_tokens: 80,
      completion_tokens: 16,
      messages_payload: [{ role: 'system', content: 'Explain economics.' }],
      raw_model_output: '{"recommendation_summary":"Works if tickets clear $75."}',
      duration_ms: 40,
      output: {
        break_even_attendance: 67,
        recommended_ticket_price_range: { min_cents: 5900, max_cents: 7400 },
        revenue_scenarios: {
          conservative: {
            attendance: 56,
            ticket_revenue_cents: 392000,
            sponsorship_revenue_cents: 0,
            total_revenue_cents: 392000,
            total_cost_cents: 400000,
            profit_cents: -8000,
            profit_margin: -0.0204,
          },
          expected: {
            attendance: 68,
            ticket_revenue_cents: 476000,
            sponsorship_revenue_cents: 0,
            total_revenue_cents: 476000,
            total_cost_cents: 400000,
            profit_cents: 76000,
            profit_margin: 0.1596,
          },
          optimistic: {
            attendance: 80,
            ticket_revenue_cents: 560000,
            sponsorship_revenue_cents: 0,
            total_revenue_cents: 560000,
            total_cost_cents: 400000,
            profit_cents: 160000,
            profit_margin: 0.2857,
          },
        },
        cost_summary_cents: {
          venue_cost_cents: 200000,
          vendor_cost_cents: 200000,
          budget_line_items_total_cents: 0,
          total_cost_cents: 400000,
        },
        profit_projection_cents: 76000,
        risk_flags: ['Expected scenario is below a 20% projected profit margin.'],
        recommendation_summary: 'Works if tickets clear $75.',
      },
    })
  })

  afterEach(() => {
    process.env.OPENAI_API_KEY = previousOpenAIKey
  })

  it('runs venue matching and economics agents for a ready plan and persists recommendations', async () => {
    const response = await recommendPlan(makeRequest({ venueLimit: 3 }), {
      params: { planId: 'plan-1' },
    })
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(json.ranked_venues).toEqual([expect.objectContaining({
      venue_id: 'venue-1',
      fit_score: 91,
      pros: ['Strong seated capacity and city fit.'],
      cons: ['Deposit terms need confirmation.'],
    })])
    expect(json.economics).toEqual(expect.objectContaining({
      break_even_attendance: 67,
      recommendation_summary: 'Works if tickets clear $75.',
    }))
    expect(mockRunVenueMatchingAgent).toHaveBeenCalledWith(expect.objectContaining({
      event_plan: expect.objectContaining({
        expected_attendance: 80,
        city: 'San Francisco',
        budget: 400000,
      }),
      organizer_preferences: expect.objectContaining({
        budget_cap_cents: 400000,
        guest_count: 80,
        neighborhood: 'Mission',
      }),
    }))
    expect(mockRunEconomicsAgent).toHaveBeenCalledWith(expect.objectContaining({
      expected_attendance: 80,
      venue_cost_cents: 200000,
      vendor_cost_cents: 200000,
    }))
    expect(db.rows.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        plan_id: 'plan-1',
        type: 'venue',
        reference_id: 'venue-1',
        metadata: expect.objectContaining({
          recommendation_type: 'venue',
          entity_id: 'venue-1',
          fit_score: 91,
          questions_to_ask_venue: ['Can you confirm the private dining minimum?'],
        }),
      }),
      expect.objectContaining({
        plan_id: 'plan-1',
        type: 'external',
        metadata: expect.objectContaining({
          recommendation_type: 'economics',
          revenue_scenarios: expect.any(Object),
        }),
      }),
    ]))
    expect(db.rows.agent_runs).toHaveLength(2)
  })
})
