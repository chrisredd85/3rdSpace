import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlannerBriefStrip } from '@/components/planner/PlannerBriefStrip'
import type { Plan, PlanMessage } from '@/lib/types/planner'

describe('PlannerBriefStrip', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('renders compact active plan context and links to the full experience brief', () => {
    render(<PlannerBriefStrip plan={makePlan()} messages={[]} accountId="builder-1" />)

    expect(screen.getByLabelText('Active event brief summary')).toBeInTheDocument()
    expect(screen.getByText('Founder Dinner')).toBeInTheDocument()
    expect(screen.getByText('Jun 28')).toBeInTheDocument()
    expect(screen.getByText('Mission')).toBeInTheDocument()
    expect(screen.getByText('72 guests')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open full brief/i })).toHaveAttribute(
      'href',
      '/planner/experiences/plan-brief-strip'
    )
  })

  it('persists collapsed state per active account', async () => {
    const user = userEvent.setup()
    render(<PlannerBriefStrip plan={makePlan()} messages={[]} accountId="builder-1" />)

    await user.click(screen.getByRole('button', { name: /founder dinner/i }))

    expect(window.localStorage.getItem('brief_strip_collapsed:builder-1')).toBe('true')
    expect(screen.queryByText('72 guests')).not.toBeInTheDocument()
    expect(screen.getByText('Founder Dinner')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /founder dinner/i }))

    expect(window.localStorage.getItem('brief_strip_collapsed:builder-1')).toBe('false')
    expect(screen.getByText('72 guests')).toBeInTheDocument()
  })

  it('surfaces outreach status when pending approvals exist', () => {
    render(<PlannerBriefStrip plan={makePlan()} messages={[makePendingApprovalMessage()]} accountId="builder-1" />)

    expect(screen.getByText('Outreach')).toBeInTheDocument()
  })

  it('does not render without an active plan', () => {
    render(<PlannerBriefStrip plan={null} messages={[]} />)

    expect(screen.queryByLabelText('Active event brief summary')).not.toBeInTheDocument()
  })
})

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-brief-strip',
    user_id: 'builder-1',
    title: 'Founder Dinner',
    event_type: 'founder_dinner',
    status: 'ready',
    guest_count: 72,
    budget_cap_cents: 500000,
    neighborhood: 'Mission',
    date_window_start: '2026-06-28',
    date_window_end: '2026-06-28',
    ticketed: true,
    ticketing_model: 'Ticketed',
    food_responsibility: null,
    venue_terms: null,
    agent_action: null,
    profit_goal_cents: null,
    notes: null,
    metadata: {},
    created_at: '2026-06-01T12:00:00.000Z',
    updated_at: '2026-06-20T12:00:00.000Z',
    ...overrides,
  }
}

function makePendingApprovalMessage(): PlanMessage {
  return {
    id: 'message-approval-1',
    plan_id: 'plan-brief-strip',
    role: 'agent',
    content: 'Approve outreach to Moongate Lounge.',
    message_type: 'confirmation_card',
    metadata: {
      approval: {
        id: 'approval-1',
        status: 'pending',
      },
    },
    created_at: '2026-06-20T12:01:00.000Z',
  }
}
