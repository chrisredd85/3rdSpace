jest.mock('server-only', () => ({}))

jest.mock('@/lib/ai/client', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
  assertOpenAIConfigured: jest.fn(),
}))

import { runWorkspaceAgent, workspaceAgentOutputSchema } from '@/lib/ai/agents/workspaceAgent'
import type { EventPlan } from '@/lib/ai/types'

const eventPlan: EventPlan = {
  event_name: 'Founder dinner',
  expected_attendance: 60,
  city: 'SF',
  venue_type: 'restaurant',
  budget: 600000,
  event_date: '2026-06-19',
  monetization_model: 'ticketed',
  headcount_min: 50,
  headcount_max: 70,
  ticket_price_target: 12500,
  profit_goal: 150000,
}

const workspacePayload = {
  event_plan: eventPlan,
  tasks: [{
    id: 'task-1',
    event_id: 'event-1',
    title: 'Sign venue contract',
    due_date: '2026-05-01',
    status: 'open',
    assigned_to: 'user-1',
  }],
  venue_bookings: [{
    id: 'venue-booking-1',
    event_id: 'event-1',
    venue_id: 'venue-1',
    status: 'pending',
    quoted_price: 250000,
  }],
  vendor_bookings: [{
    id: 'vendor-booking-1',
    event_id: 'event-1',
    vendor_id: 'vendor-1',
    status: 'pending',
    quoted_price: null,
  }],
  budget_summary: {
    event_id: 'event-1',
    expected_profit: 100000,
    profit_margin: 18,
    break_even_tickets: 48,
    net_revenue: 650000,
    total_costs: 550000,
  },
}

const modelOutput = {
  workspace_summary: 'The event has open booking and budget issues that need operator follow-up.',
  current_status: 'on_track',
  blockers: [],
  overdue_items: [],
  recommended_next_actions: ['Review the workspace with the organizer.'],
  approvals_needed: [],
}

describe('runWorkspaceAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns deterministic blockers for pending venue confirmation and missing vendor quotes', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(modelOutput) } }],
    })

    const result = await runWorkspaceAgent(workspacePayload, { create })

    expect(result.agent_name).toBe('workspace')
    expect(result.model).toBe('gpt-4o-mini')
    expect(result.output.current_status).toBe('blocked')
    expect(result.output.blockers).toEqual(expect.arrayContaining([
      'Venue booking venue-booking-1 is missing venue confirmation.',
      'Vendor booking vendor-booking-1 is missing a quoted price.',
      'Budget risk: projected profit margin is below 20%.',
      'Unsigned contract task still open: Sign venue contract.',
      'Overdue task: Sign venue contract.',
    ]))
    expect(result.output.recommended_next_actions).toEqual(expect.arrayContaining([
      'Follow up on venue booking venue-booking-1 for confirmation and terms.',
      'Request a quote for vendor booking vendor-booking-1.',
      'Rework pricing or costs to lift projected margin above 20%.',
    ]))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
    }))
  })

  it('passes deterministic overdue items to the model before final validation', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(modelOutput) } }],
    })

    await runWorkspaceAgent(workspacePayload, { create })

    const request = create.mock.calls[0][0]
    const userMessage = request.messages[1]?.content
    if (typeof userMessage !== 'string') {
      throw new Error('Expected workspace user message content to be a string')
    }
    const parsedRequest = JSON.parse(userMessage) as {
      deterministic_signals: { overdue_items: string[] }
    }

    expect(parsedRequest.deterministic_signals.overdue_items).toEqual(['Sign venue contract'])
  })

  it('rejects invalid workspace status values', () => {
    const result = workspaceAgentOutputSchema.safeParse({
      ...modelOutput,
      current_status: 'busy',
    })

    expect(result.success).toBe(false)
  })
})
