import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlannerBillingAccessBanner } from '@/components/planner/PlannerBillingAccessBanner'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  )
}

describe('PlannerBillingAccessBanner', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    window.sessionStorage.clear()
    jest.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('renders remaining free events from the billing summary', async () => {
    global.fetch = jest.fn(() => jsonResponse({
      billing: {
        freeEventsRemaining: 2,
        paidEventCredits: 0,
        hasProAccess: false,
      },
    })) as jest.Mock

    render(<PlannerBillingAccessBanner />)

    expect(await screen.findByText('2 free events remaining')).toBeInTheDocument()
    expect(screen.getByText(/After your free events, planner sessions are \$30 each or \$69\/mo unlimited./)).toBeInTheDocument()
  })

  it('renders upgrade state when free events and paid access are unavailable', async () => {
    global.fetch = jest.fn(() => jsonResponse({
      billing: {
        freeEventsRemaining: 0,
        paidEventCredits: 0,
        hasProAccess: false,
      },
    })) as jest.Mock

    render(<PlannerBillingAccessBanner />)

    expect(await screen.findByText("You've used your 2 free events.")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upgrade' })).toHaveAttribute('href', '/planner/billing')
  })

  it('is dismissible for the current browser session', async () => {
    const user = userEvent.setup()
    global.fetch = jest.fn(() => jsonResponse({
      billing: {
        freeEventsRemaining: 1,
        paidEventCredits: 0,
        hasProAccess: false,
      },
    })) as jest.Mock

    const { rerender } = render(<PlannerBillingAccessBanner />)

    expect(await screen.findByText('1 free event remaining')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss billing access banner' }))

    await waitFor(() => {
      expect(screen.queryByText('1 free event remaining')).not.toBeInTheDocument()
    })

    rerender(<PlannerBillingAccessBanner />)

    expect(screen.queryByText('1 free event remaining')).not.toBeInTheDocument()
  })
})
