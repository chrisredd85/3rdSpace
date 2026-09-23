import { act, render, screen, within } from '@testing-library/react'
import { PlannerLivePlanPanel } from '@/components/planner/PlannerLivePlanPanel'
import { PlannerMessageMetadata } from '@/components/planner/planner-page/PlannerConversation'
import { calculateEventPlanningEconomics } from '@/lib/finance/eventPlanningEconomics'
import type { PlanMessage } from '@/lib/types/planner'

jest.mock('@/components/planner/InviteVenueModal', () => ({ InviteVenueModal: () => null }))
jest.mock('@/components/planner/InviteVendorModal', () => ({ InviteVendorModal: () => null }))

const planId = 'mock-plan-economics-parity'
const originalFetch = global.fetch

beforeEach(() => {
  window.localStorage.clear()
  global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ baseline: null }), { status: 200 }))
})

afterEach(() => {
  global.fetch = originalFetch
})

describe('planner economics display parity', () => {
  it.each([
    { name: 'above attendance', costCents: 300000, priceCents: 2000, expected: 150, nested: false },
    { name: 'above attendance in nested metadata', costCents: 300000, priceCents: 2000, expected: 150, nested: true },
    { name: 'no ticket price', costCents: 300000, priceCents: 0, expected: null, nested: false },
    { name: 'no ticket price in nested metadata', costCents: 300000, priceCents: 0, expected: null, nested: true },
    { name: 'zero net costs', costCents: 0, priceCents: 2000, expected: 0, nested: false },
    { name: 'zero net costs in nested metadata', costCents: 0, priceCents: 2000, expected: 0, nested: true },
  ])('renders the same recommended-price break-even for $name', ({ costCents, priceCents, expected, nested }) => {
    const budgetCapCents = expected === 150 ? 200000 : 900000
    const original = calculateEconomics(costCents, 1000, budgetCapCents)
    const recommended = calculateEconomics(costCents, priceCents, budgetCapCents)
    expect(recommended.break_even_attendance).toBe(expected)
    const message = recommendationMessage({
      ...original,
      narrative: 'Projection from the supplied cost estimates.',
      recommended_price_cents: priceCents,
      price_points: [
        pricePoint(1000, original, 'conservative'),
        pricePoint(priceCents, recommended, 'recommended'),
      ],
    }, nested)
    seedPlan({ ticketed: true, guestCount: 100, budgetCapCents })

    const { container } = render(
      <>
        <div data-testid="conversation-economics">
          <PlannerMessageMetadata
            message={message}
            planId={planId}
            isAuthenticated
            onAuthRequired={jest.fn()}
            onApprovalStatusChange={jest.fn()}
            onToast={jest.fn()}
          />
        </div>
        <PlannerLivePlanPanel messages={[message]} planId={planId} inline />
      </>
    )

    const conversation = within(screen.getByTestId('conversation-economics'))
    const panel = within(profitWindow(container))
    const recommendedRow = conversation.getByText('recommended').closest('div.rounded-xl') as HTMLElement
    expect(within(recommendedRow).getByText(expected === null
      ? 'Break-even N/A — no ticket price'
      : `Break-even ${expected} tickets`)).toBeInTheDocument()
    const thresholdRow = panel.getByText(`Break-even tickets at ${money(priceCents)}/ticket`).parentElement as HTMLElement
    expect(within(thresholdRow).getByText(expected === null ? 'N/A — no ticket price' : String(expected))).toBeInTheDocument()
    // Agent price points use the full planned attendance, matching this scenario.
    const projectedNetCents = recommended.revenue_scenarios.optimistic.profit_cents
    expect(within(recommendedRow).getByText(`Net ${money(projectedNetCents)}`)).toBeInTheDocument()
    expect(within(panel.getByText('Projected net').parentElement as HTMLElement).getByText(money(projectedNetCents))).toBeInTheDocument()
    expect(within(panel.getByText('Modeled costs').parentElement as HTMLElement).getByText(money(costCents))).toBeInTheDocument()
    expect(panel.queryByText('Range')).not.toBeInTheDocument()
    expect(panel.queryByText('Platform + payment fees (4.9%)')).not.toBeInTheDocument()
    expect(panel.getByText('Latest recommendation estimate. Refresh recommendations after changing costs or ticket assumptions.')).toBeInTheDocument()
    expect(panel.getByText(original.risk_flags.find((flag) => /incomplete/i.test(flag))!)).toBeInTheDocument()
    if (expected === 150) {
      const feasibilityWarning = 'Break-even attendance is higher than expected attendance.'
      expect(original.risk_flags[0]).toMatch(/incomplete/i)
      expect(original.risk_flags[1]).toMatch(/exceeds the budget ceiling/i)
      expect(original.risk_flags.indexOf(feasibilityWarning)).toBeGreaterThan(1)
      expect(conversation.getByText(feasibilityWarning)).toBeInTheDocument()
      expect(panel.getByText(feasibilityWarning)).toBeInTheDocument()
    }
  })

  it('keeps supplied estimates unchanged when only the spending cap changes', () => {
    seedPlan({ guestCount: 100, ticketed: true, budgetCapCents: 200000 })
    const { container } = render(
      <PlannerLivePlanPanel
        planId={planId}
        budgetLineItems={[
          { label: 'Venue estimate', amountCents: 100000 },
          { label: 'Vendor estimate', amountCents: 50000 },
        ]}
        inline
      />
    )
    const initialProjection = profitWindow(container).textContent
    expect(initialProjection).toContain('$1,000')
    expect(initialProjection).toContain('$500')

    act(() => {
      window.dispatchEvent(new CustomEvent('planner-live-plan:update', {
        detail: planPayload({ guestCount: 100, ticketed: true, budgetCapCents: 900000 }),
      }))
    })

    expect(profitWindow(container).textContent).toBe(initialProjection)
  })

  it('does not turn a spending cap into fallback costs', () => {
    seedPlan({ guestCount: 100, ticketed: false, budgetCapCents: 900000 })
    const { container } = render(<PlannerLivePlanPanel planId={planId} inline />)
    const panel = within(profitWindow(container))

    expect(panel.getByText(/Estimate incomplete — based only on supplied costs/)).toBeInTheDocument()
    expect(panel.getByText('N/A — no ticket price')).toBeInTheDocument()
    expect(panel.queryByText('$4,950')).not.toBeInTheDocument()
    expect(panel.queryByText('$2,700')).not.toBeInTheDocument()
  })

  it('renders zero fallback break-even when a positive ticket price has zero modeled costs', () => {
    seedPlan({ guestCount: 0, ticketed: true, budgetCapCents: 900000 })
    const { container } = render(<PlannerLivePlanPanel planId={planId} inline />)
    const panel = within(profitWindow(container))
    const thresholdRow = panel.getByText(/Break-even tickets at .*\/ticket/).parentElement as HTMLElement

    expect(within(thresholdRow).getByText('0')).toBeInTheDocument()
    expect(panel.getByText(/Estimate incomplete/)).toBeInTheDocument()
  })
})

function calculateEconomics(costCents: number, ticketPriceCents: number, budgetCapCents = 900000) {
  return calculateEventPlanningEconomics({
    event_plan: {
      event_name: 'Monthly community event',
      expected_attendance: 100,
      city: 'San Francisco',
      venue_type: 'event_space',
      budget: budgetCapCents,
      event_date: null,
      monetization_model: 'ticketed',
      headcount_min: 100,
      headcount_max: 100,
      ticket_price_target: ticketPriceCents,
      profit_goal: null,
    },
    expected_attendance: 100,
    venue_cost_cents: costCents,
    vendor_cost_cents: 0,
    ticket_price_cents: ticketPriceCents,
  })
}

function pricePoint(priceCents: number, output: ReturnType<typeof calculateEconomics>, recommendation: string) {
  return {
    price_cents: priceCents,
    projected_net_cents: output.revenue_scenarios.optimistic.profit_cents,
    break_even_tickets: output.break_even_attendance,
    recommendation,
    reasoning: 'Calculated from the supplied estimates.',
  }
}

function recommendationMessage(economics: Record<string, unknown>, nested: boolean): PlanMessage {
  return {
    id: 'recommendation-economics',
    plan_id: planId,
    role: 'agent',
    content: 'Review the pricing projection.',
    message_type: 'recommendation',
    metadata: (nested ? { recommendation_response: { economics } } : { economics }) as PlanMessage['metadata'],
    created_at: '2026-09-22T16:00:00.000Z',
  }
}

function seedPlan(overrides: Record<string, unknown>) {
  window.localStorage.setItem('planner-live-plan', JSON.stringify(planPayload(overrides)))
}

function planPayload(overrides: Record<string, unknown>) {
  return {
    planId,
    messages: [],
    plan: {
      title: 'Monthly community event',
      eventType: 'mixer',
      status: 'ready',
      guestCount: 100,
      ticketed: true,
      vendorNeedStatus: 'needed',
      ...overrides,
    },
  }
}

function profitWindow(container: HTMLElement): HTMLElement {
  return container.querySelector('#profit-window') as HTMLElement
}

function money(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}
