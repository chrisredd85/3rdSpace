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
      profit_margin: -14.2857,
    }))
    expect(output.revenue_scenarios.expected).toEqual(expect.objectContaining({
      attendance: 42,
      ticket_revenue_cents: 210000,
      total_revenue_cents: 210000,
      profit_cents: 10000,
      profit_margin: 4.7619,
    }))
    expect(output.revenue_scenarios.optimistic).toEqual(expect.objectContaining({
      attendance: 50,
      ticket_revenue_cents: 250000,
      total_revenue_cents: 250000,
      profit_cents: 50000,
      profit_margin: 20,
    }))
    expect(output.profit_projection_cents).toBe(10000)
    expect(output.risk_flags).toContain('Expected scenario is below a 20% projected profit margin.')
  })

  it('compares the 20 percent risk threshold in percentage points', () => {
    const output = calculateEventPlanningEconomics({
      event_plan: eventPlan,
      budget_line_items: [],
      expected_attendance: 50,
      venue_cost_cents: 150000,
      vendor_cost_cents: 50000,
      ticket_price_cents: 6000,
      sponsorship_revenue_cents: 0,
    })

    expect(output.revenue_scenarios.expected.profit_margin).toBe(20.6349)
    expect(output.risk_flags).not.toContain('Expected scenario is below a 20% projected profit margin.')
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

  it('adds venue CHI projection as positive revenue by commercial model', () => {
    const barShareOutput = calculateEventPlanningEconomics({
      event_plan: eventPlan,
      budget_line_items: [],
      expected_attendance: 50,
      venue_cost_cents: 150000,
      vendor_cost_cents: 50000,
      ticket_price_cents: 5000,
      sponsorship_revenue_cents: 0,
      venue_commercial_model: 'bar_consumption_share',
      venue_chi_rate: 10,
      estimated_spend_per_head_cents: 4000,
    })

    expect(barShareOutput.revenue_scenarios.expected).toEqual(expect.objectContaining({
      attendance: 42,
      venue_chi_projection_cents: 16800,
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
      venue_commercial_model: 'per_head_chi_cents',
      venue_chi_rate: 300,
    })

    expect(perHeadOutput.revenue_scenarios.expected.venue_chi_projection_cents).toBe(12600)
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

  it('projects $700 of explicit costs under a $2,200 ceiling without padding spend', () => {
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

    // $300 venue + $400 vendors = $700, regardless of the $2,200 ceiling.
    // Expected attendance: floor(32 * .85) = 27; 27 * $85 - $700 = $1,595.
    expect(output.cost_summary_cents.total_cost_cents).toBe(70000)
    expect(output.revenue_scenarios.conservative.total_cost_cents).toBe(70000)
    expect(output.revenue_scenarios.expected.total_cost_cents).toBe(70000)
    expect(output.revenue_scenarios.optimistic.total_cost_cents).toBe(70000)
    expect(output.revenue_scenarios.optimistic.ticket_revenue_cents).toBe(272000)
    expect(output.revenue_scenarios.optimistic.profit_cents).toBe(202000)
    expect(output.revenue_scenarios.expected.attendance).toBe(27)
    expect(output.profit_projection_cents).toBe(159500)
    expect(output.break_even_attendance).toBe(9) // ceil($700 / $85)
    expect(output.recommended_ticket_price_range).toEqual({ min_cents: 2600, max_cents: 3300 })
    expect(output.risk_flags.some((flag) => flag.startsWith('Profit goal'))).toBe(false)
  })

  it('returns 150 required tickets for 100 expected attendees and preserves the feasibility warning', () => {
    const output = calculateEventPlanningEconomics({
      event_plan: { ...eventPlan, budget: 100000 },
      expected_attendance: 100,
      venue_cost_cents: 100000,
      vendor_cost_cents: 50000,
      ticket_price_cents: 1000,
      cost_estimate_complete: true,
    })

    expect(output.cost_summary_cents.total_cost_cents).toBe(150000)
    expect(output.break_even_attendance).toBe(150) // $1,500 / $10, never capped to 100.
    expect(output.risk_flags).toContain('Break-even attendance is higher than expected attendance.')
    expect(output.risk_flags).toContain('Projected spend $1,500 exceeds the budget ceiling of $1,000.')
  })

  it.each([
    { label: 'absent costs', venue: 0, vendor: 0 },
    { label: 'partial costs', venue: 30000, vendor: 0 },
  ])('marks $label incomplete without converting the budget into spend', ({ venue, vendor }) => {
    const output = calculateEventPlanningEconomics({
      event_plan: { ...eventPlan, budget: 220000 },
      expected_attendance: 32,
      venue_cost_cents: venue,
      vendor_cost_cents: vendor,
      ticket_price_cents: 8500,
    })

    expect(output.cost_summary_cents.total_cost_cents).toBe(venue + vendor)
    expect(output.risk_flags).toContain(
      'Cost estimate incomplete: projected spend includes only supplied costs and estimates. Confirm remaining costs before relying on profit.'
    )
  })

  it('accepts an explicitly complete zero-cost estimate without claiming missing costs', () => {
    const output = calculateEventPlanningEconomics({
      event_plan: eventPlan,
      expected_attendance: 50,
      venue_cost_cents: 0,
      vendor_cost_cents: 0,
      ticket_price_cents: 5000,
      cost_estimate_complete: true,
    })

    expect(output.cost_summary_cents.total_cost_cents).toBe(0)
    expect(output.break_even_attendance).toBe(0)
    expect(output.risk_flags.some((flag) => flag.startsWith('Cost estimate incomplete'))).toBe(false)
  })

  it('uses explicit line-item estimates and only compares the budget with their true total', () => {
    const input = {
      event_plan: { ...eventPlan, budget: 220000 },
      expected_attendance: 50,
      venue_cost_cents: 30000,
      vendor_cost_cents: 40000,
      budget_line_items: [{ label: 'Estimated staffing', amount_cents: 10000 }],
      ticket_price_cents: 5000,
      cost_estimate_complete: false,
    }
    const underBudget = calculateEventPlanningEconomics(input)
    const overBudget = calculateEventPlanningEconomics({
      ...input,
      event_plan: { ...input.event_plan, budget: 60000 },
    })

    expect(underBudget.cost_summary_cents.total_cost_cents).toBe(80000)
    expect(underBudget.break_even_attendance).toBe(16)
    expect(overBudget.revenue_scenarios).toEqual(underBudget.revenue_scenarios)
    expect(overBudget.break_even_attendance).toBe(underBudget.break_even_attendance)
    expect(underBudget.risk_flags.some((flag) => flag.includes('exceeds the budget ceiling'))).toBe(false)
    expect(overBudget.risk_flags).toContain('Projected spend $800 exceeds the budget ceiling of $600.')
  })

  it.each([
    { label: 'fully sponsored', price: 5000, sponsor: 200000, attendance: 50, required: 0 },
    { label: 'over-sponsored', price: 5000, sponsor: 250000, attendance: 50, required: 0 },
    { label: 'no ticket price', price: 0, sponsor: 0, attendance: 50, required: null },
    { label: 'no ticket price even when sponsored', price: 0, sponsor: 200000, attendance: 50, required: null },
    { label: 'zero attendance with uncovered costs', price: 5000, sponsor: 0, attendance: 0, required: 40 },
  ])('preserves mathematical break-even for $label', ({ price, sponsor, attendance, required }) => {
    const output = calculateEventPlanningEconomics({
      event_plan: eventPlan,
      expected_attendance: attendance,
      venue_cost_cents: 150000,
      vendor_cost_cents: 50000,
      ticket_price_cents: price,
      sponsorship_revenue_cents: sponsor,
    })

    expect(output.break_even_attendance).toBe(required)
    if (required !== null && required > attendance) {
      expect(output.risk_flags).toContain('Break-even attendance is higher than expected attendance.')
    }
  })

  it('still warns about an impossible profit goal using explicit spending', () => {
    const output = calculateEventPlanningEconomics({
      event_plan: { ...eventPlan, budget: 220000, profit_goal: 300000 },
      expected_attendance: 32,
      venue_cost_cents: 30000,
      vendor_cost_cents: 40000,
      ticket_price_cents: 8500,
    })

    expect(output.risk_flags).toContain(
      'Profit goal $3,000 exceeds the maximum possible $2,020 at 32 guests and $85 tickets with current projected costs.'
    )
  })
})
