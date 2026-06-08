jest.mock('server-only', () => ({}))

jest.mock('@/lib/ai/client', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
  assertOpenAIConfigured: jest.fn(),
}))

import {
  outreachAgentOutputSchema,
  runOutreachAgent,
} from '@/lib/ai/agents/outreachAgent'
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

const validPayload = {
  event_plan: eventPlan,
  target_partner: {
    name: 'Mission Hall',
    type: 'venue',
    contact_email: 'events@missionhall.example',
  },
  outreach_type: 'venue_inquiry',
  organizer_preferences: {
    food_drink_needs: 'Family-style dinner with non-alcoholic options and a cash bar.',
  },
}

const validOutput = {
  subject: 'Founder dinner inquiry for June 19',
  message_body:
    'Hi Mission Hall team, I am planning a 60-person founder dinner in SF on June 19, 2026 with a venue budget around $6,000. Could you confirm availability, pricing, minimums, and whether you can support family-style dinner service with non-alcoholic options and a cash bar? Nothing is confirmed yet, but I would like to understand fit and next steps.',
  requested_info: [
    'Availability for June 19, 2026',
    'Pricing and minimum spend',
    'Food and drink service options',
  ],
  follow_up_date_suggestion: '2026-06-03',
  tone: 'professional and concise',
  approval_required: true,
}

describe('runOutreachAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('generates a validated approval-ready venue inquiry draft', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validOutput) } }],
    })

    const result = await runOutreachAgent(validPayload, { create })

    expect(result.agent_name).toBe('outreach')
    expect(result.model).toBe('gpt-4o')
    expect(result.output).toEqual(validOutput)
    expect(result.output.approval_required).toBe(true)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
    }))
    expect(create.mock.calls[0]?.[0].messages[0].content).toContain('3rdPlace Outreach Agent')
  })

  it('rejects model output when approval_required is not exactly true', () => {
    const result = outreachAgentOutputSchema.safeParse({
      ...validOutput,
      approval_required: false,
    })

    expect(result.success).toBe(false)
  })

  it('throws when the model returns an unknown structured shape', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ subject: 'Missing fields' }) } }],
    })

    await expect(runOutreachAgent(validPayload, { create })).rejects.toThrow()
  })
})
