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
            narrative: 'At $50, the expected case is profitable but below the target 20% margin.',
            price_points: [
              { price_cents: 5000, recommendation: 'recommended', reasoning: 'Best current balance.' },
            ],
            recommended_price_cents: 5000,
            historical_anchor: null,
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
    expect(result.output.price_points.length).toBeGreaterThan(0)
    expect(result.output.recommended_price_cents).toBe(5000)
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

  it('keeps high-confidence premium-first recommendation inside the historical band', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            recommendation_summary: 'Push toward the upper tier.',
            narrative: 'Push toward the upper tier.',
            price_points: [
              { price_cents: 7500, recommendation: 'conservative', reasoning: 'Floor of the historical band.' },
              { price_cents: 9000, recommendation: 'recommended', reasoning: 'Best upside within the historical band.' },
            ],
            recommended_price_cents: 10000,
            historical_anchor: 'model anchor',
          }),
        },
      }],
    })

    const result = await runEconomicsAgent({
      ...economicsInput,
      ticket_price_sweep_cents: [7500, 7900, 8800, 9000],
      elasticity: {
        archetype_key: 'networking_mixer',
        sample_size: 6,
        confidence: 'high',
        tier_pattern: 'premium_first',
        velocity_vector: [],
        recommended_price_floor_cents: 7500,
        recommended_price_ceiling_cents: 9000,
        reasoning_for_agent: 'Across 6 past mixers, your $75 tier sold out fastest.',
      },
    }, { create })

    expect(result.output.recommended_price_cents).toBeGreaterThanOrEqual(7500)
    expect(result.output.recommended_price_cents).toBeLessThanOrEqual(9000)
    expect(result.output.historical_anchor).toBe('Across 6 past mixers, your $75 tier sold out fastest.')
    expect(result.output.narrative.startsWith(result.output.historical_anchor ?? '')).toBe(true)
  })

  it('does not recommend the highest price point when VIP is historically dead', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            recommendation_summary: 'Avoid the top tier.',
            narrative: 'Avoid the top tier.',
            price_points: [],
            recommended_price_cents: 20000,
            historical_anchor: null,
          }),
        },
      }],
    })

    const result = await runEconomicsAgent({
      ...economicsInput,
      ticket_price_sweep_cents: [5000, 10000, 15000, 20000],
      elasticity: {
        archetype_key: 'networking_mixer',
        sample_size: 6,
        confidence: 'high',
        tier_pattern: 'vip_dead',
        velocity_vector: [],
        recommended_price_floor_cents: 7500,
        recommended_price_ceiling_cents: 15000,
        reasoning_for_agent: 'Across 6 past events, the top tier rarely sold out.',
      },
    }, { create })

    expect(result.output.recommended_price_cents).not.toBe(20000)
    expect(result.output.price_points.find((point) => point.price_cents === 20000)?.recommendation).toBe('avoid')
  })

  it('falls back to non-historical pricing when elasticity is null', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            recommendation_summary: 'Use archetype defaults.',
            narrative: 'Use archetype defaults.',
            price_points: [],
            recommended_price_cents: 5000,
            historical_anchor: null,
          }),
        },
      }],
    })

    const result = await runEconomicsAgent({
      ...economicsInput,
      ticket_price_sweep_cents: [2500, 5000, 7500],
      elasticity: null,
    }, { create })

    expect(result.output.historical_anchor).toBeNull()
    expect(result.output.price_points.map((point) => point.price_cents)).toEqual([2500, 5000, 7500])
  })
})
