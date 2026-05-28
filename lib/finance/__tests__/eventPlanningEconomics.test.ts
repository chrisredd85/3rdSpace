import { calculateEventPlanningEconomics } from '@/lib/finance/eventPlanningEconomics'

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

describe('calculateEventPlanningEconomics', () => {
  it('calculates break-even attendance and profit scenarios from cents-only inputs', () => {
    const output = calculateEventPlanningEconomics({
      event_plan: eventPlan,
      budget_line_items: [],
      expected_attendance: 50,
      venue_cost_cents: 150000,
      vendor_cost_cents: 50000,
      ticket_price_cents: 5000,
      sponsorship_revenue_cents: 0,
    })

    expect(output.break_even_attendance).toBe(40)
    expect(output.cost_summary_cents.total_cost_cents).toBe(200000)
    expect(output.revenue_scenarios.conservative).toEqual(expect.objectContaining({
      attendance: 35,
      ticket_revenue_cents: 175000,
      total_revenue_cents: 175000,
      profit_cents: -25000,
    }))
    expect(output.revenue_scenarios.expected).toEqual(expect.objectContaining({
      attendance: 42,
      ticket_revenue_cents: 210000,
      total_revenue_cents: 210000,
      profit_cents: 10000,
    }))
    expect(output.revenue_scenarios.optimistic).toEqual(expect.objectContaining({
      attendance: 50,
      ticket_revenue_cents: 250000,
      total_revenue_cents: 250000,
      profit_cents: 50000,
    }))
    expect(output.profit_projection_cents).toBe(10000)
    expect(output.risk_flags).toContain('Expected scenario is below a 20% projected profit margin.')
  })

  it('includes budget line items in total cost and break-even math', () => {
    const output = calculateEventPlanningEconomics({
      event_plan: eventPlan,
      budget_line_items: [
        { label: 'Decor', amount_cents: 25000 },
        { label: 'Insurance', amount_cents: 10000 },
      ],
      expected_attendance: 50,
      venue_cost_cents: 150000,
      vendor_cost_cents: 50000,
      ticket_price_cents: 5000,
      sponsorship_revenue_cents: 0,
    })

    expect(output.cost_summary_cents.budget_line_items_total_cents).toBe(35000)
    expect(output.cost_summary_cents.total_cost_cents).toBe(235000)
    expect(output.break_even_attendance).toBe(47)
  })

  it('adds venue kickback projection as positive revenue by commercial model', () => {
    const barShareOutput = calculateEventPlanningEconomics({
      event_plan: eventPlan,
      budget_line_items: [],
      expected_attendance: 50,
      venue_cost_cents: 150000,
      vendor_cost_cents: 50000,
      ticket_price_cents: 5000,
      sponsorship_revenue_cents: 0,
      venue_commercial_model: 'bar_revenue_share',
      venue_kickback_rate: 10,
      estimated_spend_per_head_cents: 4000,
    })

    expect(barShareOutput.revenue_scenarios.expected).toEqual(expect.objectContaining({
      attendance: 42,
      kickback_projection_cents: 16800,
      total_revenue_cents: 226800,
      profit_cents: 26800,
    }))
    expect(barShareOutput.profit_projection_cents).toBe(26800)

    const perHeadOutput = calculateEventPlanningEconomics({
      event_plan: eventPlan,
      budget_line_items: [],
      expected_attendance: 50,
      venue_cost_cents: 150000,
      vendor_cost_cents: 50000,
      ticket_price_cents: 5000,
      sponsorship_revenue_cents: 0,
      venue_commercial_model: 'per_head_kickback',
      venue_kickback_rate: 300,
    })

    expect(perHeadOutput.revenue_scenarios.expected.kickback_projection_cents).toBe(12600)
    expect(perHeadOutput.revenue_scenarios.expected.profit_cents).toBe(22600)
  })

  it('returns null break-even attendance when ticket price is zero and flags the risk', () => {
    const output = calculateEventPlanningEconomics({
      event_plan: { ...eventPlan, monetization_model: 'free' },
      budget_line_items: [],
      expected_attendance: 50,
      venue_cost_cents: 150000,
      vendor_cost_cents: 50000,
      ticket_price_cents: 0,
      sponsorship_revenue_cents: 0,
    })

    expect(output.break_even_attendance).toBeNull()
    expect(output.risk_flags).toContain('Ticket price is zero while projected costs exceed sponsorship revenue.')
    expect(output.risk_flags).toContain('Free event has no sponsorship revenue in the planning inputs.')
  })

  it('uses budget as projected spend floor and warns on impossible profit goals', () => {
    const output = calculateEventPlanningEconomics({
      event_plan: {
        ...eventPlan,
        expected_attendance: 32,
        budget: 220000,
        headcount_min: 32,
        headcount_max: 32,
        ticket_price_target: 8500,
        profit_goal: 70000,
      },
      budget_line_items: [],
      expected_attendance: 32,
      venue_cost_cents: 30000,
      vendor_cost_cents: 40000,
      ticket_price_cents: 8500,
      sponsorship_revenue_cents: 0,
    })

    expect(output.cost_summary_cents.total_cost_cents).toBe(220000)
    expect(output.revenue_scenarios.optimistic.ticket_revenue_cents).toBe(272000)
    expect(output.revenue_scenarios.optimistic.profit_cents).toBe(52000)
    expect(output.profit_projection_cents).toBeLessThanOrEqual(output.revenue_scenarios.expected.ticket_revenue_cents)
    expect(output.break_even_attendance).toBe(26)
    expect(output.risk_flags).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Profit goal $700 exceeds the maximum possible $520'),
      ])
    )
  })
})
