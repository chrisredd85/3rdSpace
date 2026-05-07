jest.mock('server-only', () => ({}))

jest.mock('@/lib/ai/client', () => ({
  openai: { chat: { completions: { create: jest.fn() } } },
  assertOpenAIConfigured: jest.fn(),
}))

import { economicsAgentOutputSchema, runEconomicsAgent } from '@/lib/ai/agents/economicsAgent'

const eventPlan = {
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
}

const economicsInput = {
  event_plan: eventPlan,
  budget_line_items: [],
  expected_attendance: 50,
  venue_cost_cents: 150000,
  vendor_cost_cents: 50000,
  ticket_price_cents: 5000,
  sponsorship_revenue_cents: 0,
}

describe('runEconomicsAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('combines deterministic calculations with a validated model recommendation', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            recommendation_summary: 'At $50, the expected case is profitable but below the target 20% margin.',
          }),
        },
      }],
    })

    const result = await runEconomicsAgent(economicsInput, { create })

    expect(result.agent_name).toBe('economics')
    expect(result.model).toBe('gpt-4o-mini')
    expect(result.output.break_even_attendance).toBe(40)
    expect(result.output.revenue_scenarios.expected.profit_cents).toBe(10000)
    expect(result.output.recommendation_summary).toMatch(/expected case/i)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
    }))
  })

  it('rejects invalid final economics output shape', () => {
    expect(() => economicsAgentOutputSchema.parse({
      break_even_attendance: 40,
      recommendation_summary: 'Missing required calculated fields.',
    })).toThrow()
  })

  it('rejects invalid model recommendation output', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ summary: 'wrong key' }) } }],
    })

    await expect(runEconomicsAgent(economicsInput, { create })).rejects.toThrow()
  })
})
