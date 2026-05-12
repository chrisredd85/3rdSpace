jest.mock('server-only', () => ({}))

jest.mock('@/lib/ai/client', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
  assertOpenAIConfigured: jest.fn(),
}))

import { runAgent } from '@/lib/ai/agents'

const validOutput = {
  event_plan: {
    event_name: 'Founder mixer',
    expected_attendance: 120,
    city: 'San Francisco',
    venue_type: 'rooftop',
    budget: 12000,
    event_date: '2026-06-15',
    monetization_model: 'ticketed',
    headcount_min: 90,
    headcount_max: 140,
    ticket_price_target: 45,
    profit_goal: 3000,
  },
  summary: 'A ticketed founder mixer with approval-gated booking work.',
  missing_fields: [],
  recommendations: ['Shortlist venues before drafting outreach.'],
  risks: ['Venue terms are not confirmed.'],
  approval_required: true,
  approval_actions: [
    {
      title: 'Approve venue outreach',
      rationale: 'Venue outreach creates external commitments and should be reviewed first.',
      requires_human_approval: true,
    },
  ],
}

const validIntakeOutput = {
  reflection: 'Perfect — 60 person founder dinner in SF.',
  extracted_fields: {
    event_type: 'dinner',
    guest_count: 60,
    neighborhood: null,
    date_window_start: null,
    date_window_end: null,
    budget_cap_cents: null,
    ticketed: null,
    ticket_price_target: null,
    food_responsibility: 'Dinner service needed, details not confirmed.',
    profit_goal_cents: null,
  },
  updated_event_plan: {
    event_name: 'Founder dinner',
    expected_attendance: 60,
    city: 'SF',
    venue_type: null,
    budget: null,
    event_date: null,
    monetization_model: null,
    headcount_min: 60,
    headcount_max: 60,
    ticket_price_target: null,
    profit_goal: null,
  },
  neighborhood: null,
  food_drink_needs: 'Dinner service needed, details not confirmed.',
  music_av_needs: null,
  vibe_audience: 'Founder audience.',
  hard_constraints: [],
  missing_questions: [
    'What date or date window should I plan around?',
  ],
  confidence_score: 0.72,
  next_best_question: 'What date or date window should I plan around?',
  assumptions_made: ['Founder dinner implies a seated meal.'],
}

const ticketingPlatformQuestionOutput = {
  reflection: 'Clear — ticketed founder dinner in the Mission.',
  extracted_fields: {
    event_type: 'dinner',
    guest_count: 50,
    neighborhood: 'Mission',
    date_window_start: '2026-06-15',
    date_window_end: '2026-06-15',
    budget_cap_cents: 500000,
    ticketed: true,
    ticket_price_target: 7500,
    food_responsibility: null,
    profit_goal_cents: null,
  },
  updated_event_plan: {
    event_name: 'Founder dinner',
    expected_attendance: 50,
    city: 'San Francisco',
    venue_type: 'dinner',
    budget: 500000,
    event_date: '2026-06-15',
    monetization_model: 'ticketed',
    headcount_min: 50,
    headcount_max: 50,
    ticket_price_target: 7500,
    profit_goal: null,
  },
  neighborhood: 'Mission',
  food_drink_needs: null,
  music_av_needs: null,
  vibe_audience: 'Founder audience.',
  hard_constraints: [],
  missing_questions: ['Which ticketing platform are you using? Eventbrite, Luma, Posh, or Partiful?'],
  confidence_score: 0.84,
  next_best_question: 'Which ticketing platform are you using? Eventbrite, Luma, Posh, or Partiful?',
  assumptions_made: [],
}

const economicsPayload = {
  event_plan: {
    event_name: 'Founder dinner',
    expected_attendance: 50,
    city: 'San Francisco',
    venue_type: 'restaurant',
    budget: 200000,
    event_date: null,
    monetization_model: 'ticketed',
    headcount_min: 40,
    headcount_max: 60,
    ticket_price_target: 5000,
    profit_goal: null,
  },
  budget_line_items: [],
  expected_attendance: 50,
  venue_cost_cents: 150000,
  vendor_cost_cents: 50000,
  ticket_price_cents: 5000,
  sponsorship_revenue_cents: 0,
}

const venueMatchingPayload = {
  event_plan: {
    event_name: 'Founder dinner',
    expected_attendance: 80,
    city: 'SF',
    venue_type: 'restaurant',
    budget: 400000,
    event_date: '2026-06-19',
    monetization_model: 'ticketed',
    headcount_min: 70,
    headcount_max: 90,
    ticket_price_target: 7500,
    profit_goal: 100000,
  },
  candidate_venues: [{
    id: 'venue-1',
    venue_name: 'Mission Hall',
    venue_type: 'restaurant',
    standing_capacity: 100,
    seated_capacity: 85,
    city: 'San Francisco',
    state: 'CA',
    hourly_rate: 125000,
    minimum_hours: 3,
    is_published: true,
    per_head_kickback: null,
    offers_kickbacks: false,
    deposit_percentage: 25,
    cancellation_terms: 'Refundable until 14 days out.',
    available_days: ['friday', 'saturday'],
    bar_revenue_share_enabled: false,
    venue_amenities: [{ amenity_name: 'private dining room' }],
  }],
}

const outreachPayload = {
  event_plan: {
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
  },
  target_partner: {
    name: 'Mission Hall',
    type: 'venue',
    contact_email: 'events@missionhall.example',
  },
  outreach_type: 'venue_inquiry',
  organizer_preferences: {
    food_drink_needs: 'Family-style dinner with non-alcoholic options.',
  },
}

const responseAnalysisPayload = {
  raw_email_text:
    'We are available March 15. The minimum spend is $2,500, and we require a 25% deposit to hold the date.',
  event_plan: {
    event_name: 'Founder dinner',
    expected_attendance: 60,
    city: 'SF',
    venue_type: 'restaurant',
    budget: 600000,
    event_date: '2026-03-15',
    monetization_model: 'ticketed',
    headcount_min: 50,
    headcount_max: 70,
    ticket_price_target: 12500,
    profit_goal: 150000,
  },
  partner_type: 'venue',
}

const workspacePayload = {
  event_plan: {
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
  },
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

const timelinePayload = {
  event_plan: {
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
  },
  event_date: '2026-06-19',
  confirmed_venue_bookings: [],
  confirmed_vendor_bookings: [],
  venue_requirements: [],
}

describe('runAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns a validated structured result for the selected agent', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validOutput) } }],
    })

    const result = await runAgent(
      {
        agent_name: 'event_plan_extractor',
        payload: { message: 'Plan a founder mixer for 120 people in SF' },
        user_id: 'user-1',
        event_id: null,
      },
      { create }
    )

    expect(result.agent_name).toBe('event_plan_extractor')
    expect(result.model).toBe('gpt-4o-mini')
    expect(result.output.event_plan.event_name).toBe('Founder mixer')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
    }))
  })

  it('routes intake through the dedicated intake agent schema', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validIntakeOutput) } }],
    })

    const result = await runAgent(
      {
        agent_name: 'intake',
        payload: { user_message: 'I want to host a 60 person founder dinner in SF' },
        user_id: 'user-1',
        event_id: null,
      },
      { create }
    )

    expect(result.agent_name).toBe('intake')
    expect(result.model).toBe('gpt-4o')
    expect(result.output).toEqual(validIntakeOutput)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
    }))
  })

  it('intake agent asks for platform when builder has no connections and event is ticketed', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(ticketingPlatformQuestionOutput) } }],
    })

    const result = await runAgent(
      {
        agent_name: 'intake',
        payload: {
          user_message: 'I want a 50 person ticketed founder dinner in the Mission on June 15 at $75 per person',
          current_plan: {
            event_type: 'dinner',
            guest_count: 50,
            neighborhood: 'Mission',
            date_window_start: '2026-06-15',
            budget_cap_cents: 500000,
            ticketed: true,
          },
          connected_platforms: [],
        },
        user_id: 'user-1',
        event_id: null,
      },
      { create }
    )

    expect(result.agent_name).toBe('intake')
    expect(result.output.next_best_question).toBe(
      'Which ticketing platform are you using? Eventbrite, Luma, Posh, or Partiful?'
    )
    expect(result.output.missing_questions).toEqual([
      'Which ticketing platform are you using? Eventbrite, Luma, Posh, or Partiful?',
    ])
    const createInput = create.mock.calls[0]?.[0] as { messages?: Array<{ role: string; content: string }> }
    const userPayload = JSON.parse(createInput.messages?.[1]?.content ?? '{}') as { connected_platforms?: string[] }
    expect(userPayload.connected_platforms).toEqual([])
  })

  it('routes economics through the dedicated economics agent schema', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            recommendation_summary: 'Raise price or reduce costs to reach a 20% margin.',
          }),
        },
      }],
    })

    const result = await runAgent(
      {
        agent_name: 'economics',
        payload: economicsPayload,
        user_id: 'user-1',
        event_id: null,
      },
      { create }
    )

    expect(result.agent_name).toBe('economics')
    expect(result.model).toBe('gpt-4o-mini')
    expect(result.output.break_even_attendance).toBe(40)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
    }))
  })

  it('routes venue matching through the dedicated venue matching agent schema', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            ranked_venues: [{
              venue_id: 'venue-1',
              venue_name: 'Mission Hall',
              fit_score: 95,
              pros: ['Capacity and city match the plan.'],
              cons: ['Final terms still need confirmation.'],
              questions_to_ask_venue: ['Is the requested date available?'],
            }],
            best_recommendation: 'Mission Hall is the strongest match.',
            reason_summary: 'The venue passed deterministic city and capacity filtering before ranking.',
            no_match: false,
          }),
        },
      }],
    })

    const result = await runAgent(
      {
        agent_name: 'venue_matching',
        payload: venueMatchingPayload,
        user_id: 'user-1',
        event_id: null,
      },
      { create }
    )

    expect(result.agent_name).toBe('venue_matching')
    expect(result.model).toBe('gpt-4o')
    expect(result.output.no_match).toBe(false)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
    }))
  })

  it('routes outreach through the dedicated outreach agent schema', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            subject: 'Founder dinner inquiry for June 19',
            message_body:
              'Hi Mission Hall team, I am planning a 60-person founder dinner in SF on June 19, 2026. Could you confirm availability, pricing, minimums, and food service options? Nothing is confirmed yet.',
            requested_info: [
              'Availability for June 19, 2026',
              'Pricing and minimum spend',
              'Food service options',
            ],
            follow_up_date_suggestion: '2026-06-03',
            tone: 'professional and concise',
            approval_required: true,
          }),
        },
      }],
    })

    const result = await runAgent(
      {
        agent_name: 'outreach',
        payload: outreachPayload,
        user_id: 'user-1',
        event_id: null,
      },
      { create }
    )

    expect(result.agent_name).toBe('outreach')
    expect(result.model).toBe('gpt-4o')
    expect(result.output.approval_required).toBe(true)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
    }))
  })

  it('routes response analysis through the dedicated response analysis agent schema', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            availability_status: 'available',
            quoted_price_cents: null,
            minimum_spend_cents: 250000,
            deposit_required_cents: null,
            capacity_notes: null,
            included_services: [],
            exclusions: [],
            hidden_fees: [],
            cancellation_terms: null,
            required_next_steps: ['Confirm the date hold.'],
            summary: 'The venue is available March 15 with a $2,500 minimum spend.',
            risk_flags: [],
            extracted_questions: [],
          }),
        },
      }],
    })

    const result = await runAgent(
      {
        agent_name: 'response_analysis',
        payload: responseAnalysisPayload,
        user_id: 'user-1',
        event_id: null,
      },
      { create }
    )

    expect(result.agent_name).toBe('response_analysis')
    expect(result.model).toBe('gpt-4o-mini')
    expect(result.output.minimum_spend_cents).toBe(250000)
    expect(result.output.deposit_required_cents).toBe(62500)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
    }))
  })

  it('routes workspace through the dedicated workspace agent schema', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            workspace_summary: 'The event has open workspace blockers.',
            current_status: 'at_risk',
            blockers: ['Venue confirmation and vendor quote need follow-up.'],
            overdue_items: [],
            recommended_next_actions: ['Review the workspace with the organizer.'],
            approvals_needed: [],
          }),
        },
      }],
    })

    const result = await runAgent(
      {
        agent_name: 'workspace',
        payload: workspacePayload,
        user_id: 'user-1',
        event_id: null,
      },
      { create }
    )

    expect(result.agent_name).toBe('workspace')
    expect(result.model).toBe('gpt-4o-mini')
    expect(result.output.current_status).toBe('blocked')
    expect(result.output.blockers).toContain('Venue booking venue-booking-1 is missing venue confirmation.')
    expect(result.output.blockers).toContain('Vendor booking vendor-booking-1 is missing a quoted price.')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
    }))
  })

  it('routes timeline through the dedicated timeline agent schema', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            planning_milestones: [],
            day_of_timeline: [],
            staffing_needs: [],
            reminders: [],
            dependency_warnings: [],
            impossible_timeline: false,
          }),
        },
      }],
    })

    const result = await runAgent(
      {
        agent_name: 'timeline',
        payload: timelinePayload,
        user_id: 'user-1',
        event_id: null,
      },
      { create }
    )

    expect(result.agent_name).toBe('timeline')
    expect(result.model).toBe('gpt-4o-mini')
    expect(result.output.planning_milestones).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Confirm venue booking', is_blocking: true }),
      expect.objectContaining({ title: 'Doors open' }),
    ]))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
    }))
  })

  it('throws when the model output does not match the schema', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ summary: 'missing required fields' }) } }],
    })

    await expect(runAgent(
      {
        agent_name: 'booking_ops_assistant',
        payload: { event_name: 'Vendor booking' },
        user_id: 'user-1',
      },
      { create }
    )).rejects.toThrow()
  })
})
