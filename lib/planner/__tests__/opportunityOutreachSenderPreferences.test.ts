jest.mock('server-only', () => ({}))

jest.mock('@/lib/ai/agents/outreachAgent', () => ({
  runOutreachAgent: jest.fn(),
}))

jest.mock('@/lib/planner/venueComplianceGate', () => ({
  getVenueComplianceStatus: jest.fn().mockResolvedValue({
    is_compliant: true,
    overdue_count: 0,
    overdue_threshold: 3,
    oldest_overdue_event_date: null,
    reason: null,
  }),
}))

jest.mock('@/lib/server/agent-runs', () => ({
  logAgentRun: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(() => ({})),
}))

import { runOutreachAgent } from '@/lib/ai/agents/outreachAgent'
import { buildVenueOpportunityOutreach } from '@/lib/planner/opportunityOutreach'
import type { Plan } from '@/lib/types'

const mockRunOutreachAgent = runOutreachAgent as jest.Mock

describe('buildVenueOpportunityOutreach sender preferences', () => {
  const previousOpenAIKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OPENAI_API_KEY = 'test-openai-key'
    mockRunOutreachAgent.mockResolvedValue({
      agent_name: 'outreach',
      status: 'succeeded',
      model: 'gpt-4o',
      prompt_tokens: null,
      completion_tokens: null,
      duration_ms: 10,
      messages_payload: [],
      raw_model_output: '{}',
      output: {
        subject: 'Sep 12 — 40-person founder dinner — Over the Top',
        message_body: 'Draft body. Nothing is booked or committed yet.',
        requested_info: ['Availability'],
        follow_up_date_suggestion: null,
        tone: 'warm-professional',
        approval_required: true,
      },
    })
  })

  afterEach(() => {
    process.env.OPENAI_API_KEY = previousOpenAIKey
  })

  it('passes plan sender identity preferences into the outreach agent payload', async () => {
    const plan = makePlan({
      metadata: {
        sender_identity: 'Over the Top',
        creator_display_name: 'Sarah Chen',
        budget_signal_in_subject: true,
      },
    })
    const db = makeDb({
      venues: [{
        id: '550e8400-e29b-41d4-a716-446655440101',
        venue_name: 'The Loft',
        contact_email: 'events@theloft.example',
        city: 'San Francisco',
        state: 'CA',
        venue_type: 'event_space',
        standing_capacity: 80,
      }],
      agent_actions: [{
        id: 'action-1',
        plan_id: plan.id,
        action_type: 'opportunity_send_venues',
        payload_json: {
          venue_ids: ['550e8400-e29b-41d4-a716-446655440101'],
        },
      }],
      approvals: [{
        id: 'approval-1',
        plan_id: plan.id,
        agent_action_id: 'action-1',
        status: 'approved',
      }],
    })

    await buildVenueOpportunityOutreach({
      db,
      plan,
      userId: plan.user_id,
      venueIds: ['550e8400-e29b-41d4-a716-446655440101'],
      summary: 'Founder dinner for the Over the Top community.',
      requirements: { vibe: 'warm private dinner' },
      responseDeadline: null,
    })

    expect(mockRunOutreachAgent).toHaveBeenCalledWith(expect.objectContaining({
      organizer_preferences: expect.objectContaining({
        sender_identity: 'Over the Top',
        creator_display_name: 'Sarah Chen',
        budget_signal_in_subject: true,
        budget_cap_cents: 600000,
        guest_count: 40,
        neighborhood: 'Mission',
      }),
    }))
  })
})

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    user_id: 'user-1',
    title: 'Founder dinner',
    event_type: 'founder dinner',
    status: 'ready',
    guest_count: 40,
    budget_cap_cents: 600000,
    neighborhood: 'Mission',
    date_window_start: '2026-09-12',
    date_window_end: '2026-09-12',
    ticketed: true,
    ticketing_model: 'ticketed',
    food_responsibility: 'venue',
    venue_terms: null,
    agent_action: null,
    profit_goal_cents: 150000,
    notes: null,
    metadata: {},
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeDb(seed: Record<string, Array<Record<string, any>>>) {
  return {
    from(table: string) {
      return makeQuery(table, seed)
    },
  } as any
}

function makeQuery(table: string, seed: Record<string, Array<Record<string, any>>>) {
  const filters: Array<(row: Record<string, any>) => boolean> = []
  const query: any = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value)
      return query
    },
    in: (column: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[column]))
      return query
    },
    then: (onfulfilled: (value: { data: Record<string, any>[]; error: null }) => unknown) => (
      Promise.resolve({ data: (seed[table] ?? []).filter((row) => filters.every((filter) => filter(row))), error: null })
        .then(onfulfilled)
    ),
  }

  return query
}
