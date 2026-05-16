jest.mock('server-only', () => ({}))

import type { NextRequest } from 'next/server'
import { PATCH as patchPlan } from '@/app/api/planner/plans/[planId]/route'
import { POST as recommendPlan } from '@/app/api/planner/plans/[planId]/recommend/route'
import { runAgent } from '@/lib/ai/agents'
import { runEconomicsAgent } from '@/lib/ai/agents/economicsAgent'
import { runVenueMatchingAgent } from '@/lib/ai/agents/venueMatchingAgent'
import { ARCHETYPES } from '@/lib/planner/archetypes'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/ai/agents', () => ({
  runAgent: jest.fn(),
}))

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

const VENUE_ID = '550e8400-e29b-41d4-a716-446655440101'

class MemoryDb {
  rows: Record<string, Row[]> = {
    plans: [],
    plan_messages: [],
    venues: [],
    recommendations: [],
    agent_actions: [],
    approvals: [],
    planner_plan_updates: [],
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
  private operation: 'select' | 'insert' | 'update' = 'select'
  private payload: unknown
  private rowLimit: number | null = null
  private orderBy: { field: string; ascending: boolean } | null = null

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
        const next = { ...row, ...(this.payload as Row), updated_at: new Date().toISOString() }
        updated.push(next)
        return next
      })
      return { data: updated, error: null }
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
const mockRunAgent = runAgent as jest.Mock
const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock

function makeRequest(
  body: Row = {},
  path = '/api/planner/plans/plan-1/recommend',
  method = 'POST'
) {
  return new Request(`http://localhost${path}`, {
    method,
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
    db.rows.plan_messages.push(
      {
        id: 'message-1',
        plan_id: 'plan-1',
        role: 'agent',
        content: 'What setup, load-in, sound-check, and breakdown window should I plan around?',
        message_type: 'text',
        metadata: {
          archetype_question: {
            id: 'operational_timing',
            prompt: 'What setup, load-in, sound-check, and breakdown window should I plan around?',
          },
        },
        created_at: '2026-05-01T10:00:00Z',
      },
      {
        id: 'message-2',
        plan_id: 'plan-1',
        role: 'user',
        content: 'Plan for a two hour load-in, quick sound check, and one hour of breakdown.',
        message_type: 'text',
        metadata: {},
        created_at: '2026-05-01T10:01:00Z',
      }
    )
    db.rows.venues.push({
      id: VENUE_ID,
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
      venue_amenities: [{ venue_id: VENUE_ID, amenity_name: 'private dining room' }],
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
          venue_id: VENUE_ID,
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
    mockRunAgent.mockImplementation(async ({ agent_name }: { agent_name: string }) => ({
      agent_name,
      status: 'succeeded',
      model: 'gpt-4o-mini',
      prompt_tokens: 30,
      completion_tokens: 12,
      messages_payload: [{ role: 'system', content: `Run ${agent_name}.` }],
      raw_model_output: '{}',
      duration_ms: 25,
      output: agent_name === 'timeline'
        ? {
            planning_milestones: [{
              title: 'Confirm venue booking',
              due_date: '2026-05-20',
              category: 'booking',
              is_blocking: true,
            }],
            day_of_timeline: [],
            staffing_needs: [],
            reminders: [],
            dependency_warnings: [],
            impossible_timeline: false,
          }
        : {
            workspace_summary: 'Mission Hall is queued for approval and outreach.',
            current_status: 'at_risk',
            blockers: ['User approval is required before outreach.'],
            overdue_items: [],
            recommended_next_actions: ['Approve outreach.'],
            approvals_needed: ['Approve venue outreach.'],
          },
    }))
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
      venue_id: VENUE_ID,
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
      archetype_intake: expect.objectContaining({
        answer_text: expect.stringContaining('two hour load-in'),
        question_ids_asked: ['operational_timing'],
      }),
      conversation_history: expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('two hour load-in'),
        }),
      ]),
    }))
    expect(mockRunEconomicsAgent).toHaveBeenCalledWith(expect.objectContaining({
      expected_attendance: 80,
      venue_cost_cents: 200000,
      vendor_cost_cents: 0,
      cost_confidence: 'estimated',
      negotiated_savings_cents: 0,
      archetype_intake: expect.objectContaining({
        answer_text: expect.stringContaining('two hour load-in'),
      }),
      conversation_history: expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('two hour load-in'),
        }),
      ]),
    }))
    expect(mockRunAgent).toHaveBeenCalledWith(expect.objectContaining({
      agent_name: 'timeline',
      payload: expect.objectContaining({
        archetype_intake: expect.objectContaining({
          answer_text: expect.stringContaining('two hour load-in'),
        }),
      }),
    }))
    expect(mockRunAgent).toHaveBeenCalledWith(expect.objectContaining({
      agent_name: 'workspace',
      payload: expect.objectContaining({
        archetype_intake: expect.objectContaining({
          answer_text: expect.stringContaining('two hour load-in'),
        }),
      }),
    }))
    expect(db.rows.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        plan_id: 'plan-1',
        type: 'venue',
        reference_id: VENUE_ID,
        metadata: expect.objectContaining({
          recommendation_type: 'venue',
          entity_id: VENUE_ID,
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
    expect(db.rows.agent_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        plan_id: 'plan-1',
        action_type: 'email',
        status: 'pending',
        payload_json: expect.objectContaining({
          kind: 'venue_outreach',
          venue_ids: [VENUE_ID],
          requires_user_action: true,
          requirements: expect.objectContaining({
            archetype_intake: expect.objectContaining({
              answer_text: expect.stringContaining('two hour load-in'),
            }),
          }),
        }),
        result_metadata: expect.objectContaining({
          action_type_fallback: 'opportunity_send_venues',
        }),
      }),
    ]))
    expect(db.rows.approvals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        plan_id: 'plan-1',
        status: 'pending',
        snapshot_hash: expect.any(String),
      }),
    ]))
    expect(db.rows.plan_messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        plan_id: 'plan-1',
        message_type: 'approval_request',
        metadata: expect.objectContaining({
          kind: 'venue_outreach',
          venue_ids: [VENUE_ID],
          requires_user_action: true,
        }),
      }),
    ]))
    expect(json.outreach_approval_message_id).toEqual(expect.any(String))
    expect(db.rows.agent_runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ agent_name: 'timeline', status: 'succeeded' }),
      expect.objectContaining({ agent_name: 'workspace', status: 'succeeded' }),
    ]))
    expect(db.rows.agent_runs).toHaveLength(4)
  })

  it('completes recommendation generation for every supported archetype with unknown ticket price', async () => {
    for (const archetype of ARCHETYPES) {
      const planId = `plan-${archetype.key}`
      db.rows.plans.push({
        id: planId,
        user_id: 'user-1',
        title: `${archetype.display_name} plan`,
        event_type: archetype.display_name,
        status: 'ready',
        guest_count: 80,
        budget_cap_cents: 400000,
        neighborhood: 'Mission',
        date_window_start: '2026-06-19',
        date_window_end: '2026-06-19',
        ticketed: false,
        ticketing_model: 'rsvp',
        food_responsibility: 'venue handles food and drinks',
        venue_terms: null,
        agent_action: null,
        profit_goal_cents: null,
        notes: null,
        metadata: {
          matching_signals: {
            setup_format: 'seated',
            private_or_shared: 'private',
            indoor_outdoor: 'indoor',
            duration_days: 1,
            duration_minutes: 120,
            av_intensity: 'standard',
            stage_required: true,
            demo_stations_needed: true,
            screens_count: 1,
            mics_count: 2,
            music_format: 'dj',
            photo_video_priority: 'none',
            catering_style: 'venue_handles',
            bar_required: false,
            security_needs: 'none',
          },
        },
      })

      const response = await recommendPlan(
        makeRequest({ venueLimit: 3, vendorLimit: 3 }, `/api/planner/plans/${planId}/recommend`),
        { params: { planId } }
      )
      const json = await readJson(response)

      expect(response.status).toBe(200)
      expect(json.resolved_archetype).toEqual(expect.objectContaining({
        key: archetype.key,
        display_name: archetype.display_name,
      }))
      expect(json.ranked_venues).toEqual(expect.arrayContaining([
        expect.objectContaining({ venue_id: VENUE_ID }),
      ]))
    }
  })

  it('falls back to catalog recommendations when the OpenAI venue pipeline fails', async () => {
    mockRunVenueMatchingAgent.mockRejectedValueOnce(new Error('invalid api key'))

    const response = await recommendPlan(makeRequest({ venueLimit: 3 }), {
      params: { planId: 'plan-1' },
    })
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(json.ranked_venues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        venue_id: VENUE_ID,
        venue_name: 'Mission Hall',
      }),
    ]))
    expect(db.rows.audit_logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'planner.catalog_recommendations.generated',
        after_state: expect.objectContaining({
          fallback_reason: 'invalid api key',
        }),
      }),
    ]))
  })

  it('supersedes stale recommendations and refreshes the thread when match-affecting fields change', async () => {
    const initialResponse = await recommendPlan(makeRequest({ venueLimit: 3 }), {
      params: { planId: 'plan-1' },
    })
    expect(initialResponse.status).toBe(200)

    const staleRecommendationIds = db.rows.recommendations.map((row) => row.id)
    expect(staleRecommendationIds).toHaveLength(2)

    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => (
      recommendPlan(makeRequest({ venueLimit: 3 }), {
        params: { planId: 'plan-1' },
      }) as Promise<Response>
    ))

    try {
      const response = await patchPlan(
        makeRequest({ guest_count: 120 }, '/api/planner/plans/plan-1', 'PATCH'),
        { params: { planId: 'plan-1' } }
      )
      const json = await readJson(response)

      expect(response.status).toBe(200)
      expect(json.plan).toEqual(expect.objectContaining({ guest_count: 120 }))
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('http://localhost/api/planner/plans/plan-1/recommend')
      expect(fetchSpy.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: 'POST' }))

      const staleRecommendations = db.rows.recommendations.filter((row) =>
        staleRecommendationIds.includes(row.id)
      )
      expect(staleRecommendations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          status: 'rejected',
          metadata: expect.objectContaining({
            superseded_reason: 'match_affecting_plan_change',
            superseded_changed_fields: ['guest_count'],
          }),
        }),
      ]))
      expect(staleRecommendations.every((row) =>
        typeof (row.metadata as Row).superseded_at === 'string'
      )).toBe(true)

      const refreshedRecommendations = db.rows.recommendations.filter((row) =>
        !staleRecommendationIds.includes(row.id)
      )
      expect(refreshedRecommendations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          plan_id: 'plan-1',
          status: 'pending',
          type: 'venue',
          reference_id: VENUE_ID,
        }),
        expect.objectContaining({
          plan_id: 'plan-1',
          status: 'pending',
          type: 'external',
        }),
      ]))

      expect(db.rows.approvals).toEqual(expect.arrayContaining([
        expect.objectContaining({
          status: 're_approval_required',
        }),
        expect.objectContaining({
          status: 'pending',
          snapshot_hash: expect.any(String),
        }),
      ]))
      expect(json.follow_up_messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: 'agent',
          message_type: 'status_update',
          content: 'Updated the plan — re-checking venues against the new numbers.',
        }),
        expect.objectContaining({
          role: 'agent',
          message_type: 'recommendation',
        }),
        expect.objectContaining({
          role: 'agent',
          message_type: 'approval_request',
        }),
      ]))
      expect(json.follow_up_messages[0]).toEqual(expect.objectContaining({
        message_type: 'status_update',
      }))
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
