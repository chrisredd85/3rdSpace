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
    expect(result.output.revenue_scenarios.expected.profit_margin).toBe(4.7619)
    expect(result.output.recommendation_summary).toMatch(/expected case/i)
    expect(result.output.price_points.length).toBeGreaterThan(0)
    expect(result.output.recommended_price_cents).toBe(5000)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
    }))
    const messages = create.mock.calls[0][0].messages
    const userPayload = JSON.parse(messages[1].content)
    expect(userPayload.calculated_output_cents.revenue_scenarios.expected.profit_margin).toBe(4.7619)
    expect(userPayload.input_cents.cost_estimate_complete).toBe(false)
  })

  it('passes vendor cost confidence and negotiated savings as deterministic model inputs', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            recommendation_summary: 'Use confirmed vendor rates where available.',
            narrative: 'Use confirmed vendor rates where available.',
            price_points: [],
            recommended_price_cents: 5000,
            historical_anchor: null,
          }),
        },
      }],
    })

    await runEconomicsAgent({
      ...economicsInput,
      cost_confidence: 'mixed',
      cost_estimate_complete: true,
      negotiated_savings_cents: 25000,
    }, { create })

    const messages = create.mock.calls[0][0].messages
    const userPayload = JSON.parse(messages[1].content)
    expect(userPayload.input_cents).toMatchObject({
      cost_confidence: 'mixed',
      cost_estimate_complete: true,
      negotiated_savings_cents: 25000,
    })
    expect(userPayload.cost_confidence).toBe('mixed')
    expect(userPayload.negotiated_savings_cents).toBe(25000)
  })

  it('passes venue CHI inputs and labels expected CHI in narrative', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            recommendation_summary: 'Use the current ticket price with venue upside.',
            narrative: 'Use the current ticket price with venue upside.',
            price_points: [],
            recommended_price_cents: 5000,
            historical_anchor: null,
          }),
        },
      }],
    })

    const result = await runEconomicsAgent({
      ...economicsInput,
      venue_commercial_model: 'bar_consumption_share',
      venue_chi_rate: 10,
      estimated_spend_per_head_cents: 4000,
    }, { create })

    const messages = create.mock.calls[0][0].messages
    const userPayload = JSON.parse(messages[1].content)
    expect(userPayload.input_cents).toMatchObject({
      venue_commercial_model: 'bar_consumption_share',
      venue_chi_rate: 10,
      estimated_spend_per_head_cents: 4000,
    })
    expect(result.output.revenue_scenarios.expected.venue_chi_projection_cents).toBe(16800)
    expect(result.output.narrative).toContain('Expected Community Host Incentive: $168.')
    expect(result.output.price_points.find((point) => point.price_cents === 5000)?.projected_net_cents).toBe(70000)
  })

  it('normalizes object price points and non-string historical anchors from the model', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            recommendation_summary: 'Use a tighter event-pricing band.',
            narrative: 'Use a tighter event-pricing band.',
            price_points: {
              conservative: {
                price_cents: '5000',
                projected_net_cents: 10000,
                break_even_tickets: 40,
                reasoning: 'Good balance for the expected crowd.',
              },
            },
            recommended_price_cents: '5000',
            historical_anchor: [{ note: 'model returned an array here' }],
          }),
        },
      }],
    })

    const result = await runEconomicsAgent(economicsInput, { create })

    expect(result.output.recommended_price_cents).toBe(5000)
    expect(result.output.price_points.find((point) => point.price_cents === 5000)?.reasoning)
      .toMatch(/Good balance/i)
  })

  it('normalizes primitive object price point maps from the model', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            recommendation_summary: 'Use the target price point.',
            narrative: 'Use the target price point.',
            price_points: {
              low: 2500,
              target: '5000',
              high: 7500,
            },
            recommended_price_cents: '5000',
            historical_anchor: null,
          }),
        },
      }],
    })

    const result = await runEconomicsAgent(economicsInput, { create })

    expect(result.output.recommended_price_cents).toBe(5000)
    expect(result.output.price_points.find((point) => point.price_cents === 5000)?.recommendation).toBe('recommended')
  })

  it('uses explicit costs instead of the budget and ignores model financial math', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            recommendation_summary: 'Use the stated ticket price and confirm quotes.',
            narrative: 'Use the stated ticket price and confirm quotes.',
            price_points: [
              {
                price_cents: 8500,
                projected_net_cents: 238200,
                break_even_tickets: 1,
                recommendation: 'recommended',
                reasoning: 'Model attempted impossible math.',
              },
            ],
            recommended_price_cents: 8500,
            historical_anchor: null,
          }),
        },
      }],
    })

    const result = await runEconomicsAgent({
      ...economicsInput,
      event_plan: {
        ...eventPlan,
        expected_attendance: 32,
        budget: 220000,
        headcount_min: 32,
        headcount_max: 32,
        ticket_price_target: 8500,
        profit_goal: 70000,
      },
      expected_attendance: 32,
      venue_cost_cents: 30000,
      vendor_cost_cents: 40000,
      ticket_price_cents: 8500,
      ticket_price_sweep_cents: [8500],
    }, { create })

    // $300 venue + $400 vendor = $700 costs; the $2,200 budget is a spending limit.
    expect(result.output.cost_summary_cents.total_cost_cents).toBe(70000)
    expect(result.output.break_even_attendance).toBe(9)
    expect(result.output.price_points[0]).toEqual(
      expect.objectContaining({
        price_cents: 8500,
        projected_net_cents: 202000,
        break_even_tickets: 9,
      })
    )
    // floor(32 * 85%) = 27 tickets; 27 * $85 - $700 = $1,595.
    expect(result.output.revenue_scenarios.expected).toMatchObject({
      attendance: 27,
      ticket_revenue_cents: 229500,
      total_cost_cents: 70000,
      profit_cents: 159500,
    })
    expect(result.output.profit_projection_cents).toBe(159500)
    expect(result.output.risk_flags).toEqual(expect.arrayContaining([
      expect.stringContaining('Cost estimate incomplete:'),
    ]))
    const userPayload = JSON.parse(create.mock.calls[0][0].messages[1].content)
    expect(userPayload.calculated_output_cents.cost_summary_cents.total_cost_cents).toBe(70000)
    expect(userPayload.score_breakdown.financial.details.price_points[0]).toMatchObject({
      projected_net_cents: 202000,
      break_even_tickets: 9,
    })
  })

  it.each([
    {
      label: 'reports 150 tickets needed when expected attendance is only 100',
      expectedAttendance: 100,
      costCents: 750000,
      sponsorshipCents: 0,
      priceCents: 5000,
      breakEven: 150,
      projectedNetCents: -250000,
    },
    {
      label: 'reports zero tickets needed when sponsorship covers all costs',
      expectedAttendance: 50,
      costCents: 200000,
      sponsorshipCents: 200000,
      priceCents: 5000,
      breakEven: 0,
      projectedNetCents: 250000,
    },
    {
      label: 'reports unavailable ticket break-even for a free event with uncovered costs',
      expectedAttendance: 50,
      costCents: 200000,
      sponsorshipCents: 0,
      priceCents: 0,
      breakEven: null,
      projectedNetCents: -200000,
    },
    {
      label: 'keeps ticket break-even unavailable for a free event even when costs are covered',
      expectedAttendance: 50,
      costCents: 200000,
      sponsorshipCents: 200000,
      priceCents: 0,
      breakEven: null,
      projectedNetCents: 0,
    },
    {
      label: 'retains the required ticket count when expected attendance is zero',
      expectedAttendance: 0,
      costCents: 200000,
      sponsorshipCents: 0,
      priceCents: 5000,
      breakEven: 40,
      projectedNetCents: -200000,
    },
  ])('$label', async ({ expectedAttendance, costCents, sponsorshipCents, priceCents, breakEven, projectedNetCents }) => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        recommendation_summary: 'Use the supplied financial assumptions.',
        price_points: [{ price_cents: priceCents, projected_net_cents: 999999, break_even_tickets: 1 }],
        recommended_price_cents: priceCents,
      }) } }],
    })

    const result = await runEconomicsAgent({
      ...economicsInput,
      expected_attendance: expectedAttendance,
      venue_cost_cents: costCents,
      vendor_cost_cents: 0,
      sponsorship_revenue_cents: sponsorshipCents,
      ticket_price_cents: priceCents,
      ticket_price_sweep_cents: [priceCents],
    }, { create })

    expect(result.output.break_even_attendance).toBe(breakEven)
    expect(result.output.price_points).toHaveLength(1)
    expect(result.output.price_points[0]).toMatchObject({
      price_cents: priceCents,
      break_even_tickets: breakEven,
      projected_net_cents: projectedNetCents,
    })
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
