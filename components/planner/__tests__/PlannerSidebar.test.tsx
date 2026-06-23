import { render, screen, waitFor } from '@testing-library/react'
import { PlannerSidebar } from '@/components/planner/PlannerSidebar'

const originalFetch = global.fetch

function jsonResponse(body: unknown, init?: ResponseInit) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  }))
}

describe('PlannerSidebar', () => {
  afterEach(() => {
    global.fetch = originalFetch
    window.localStorage.clear()
    jest.clearAllMocks()
  })

  it('shows the signed-in creator account and membership instead of demo workspace copy', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)

      if (url === '/api/auth/user') {
        return jsonResponse({
          user: {
            email: 'julian@example.com',
            userType: 'community_builder',
            companyName: 'Julian Taylor Events',
          },
        })
      }

      if (url === '/api/builder/billing/status') {
        return jsonResponse({
          builder: { name: 'Julian Taylor' },
          billing: { tierLabel: 'Pro Monthly' },
        })
      }

      return jsonResponse({ error: `Unexpected request: ${url}` }, { status: 500 })
    }) as jest.Mock

    render(<PlannerSidebar />)

    expect(screen.queryByText('Embarcadero Collective')).not.toBeInTheDocument()
    expect(screen.queryByText('Founder workspace')).not.toBeInTheDocument()

    expect(await screen.findByText('Julian Taylor Events')).toBeInTheDocument()
    expect(screen.getByText('Community builder account - julian@example.com')).toBeInTheDocument()
    expect(screen.getByText('Pro Monthly')).toBeInTheDocument()
  })

  it('uses neutral account copy while signed out or before account data loads', async () => {
    global.fetch = jest.fn(() => jsonResponse({ error: 'Unauthorized' }, { status: 401 })) as jest.Mock

    render(<PlannerSidebar />)

    expect(screen.getByText('Creator account')).toBeInTheDocument()
    expect(screen.getByText('Sign in to personalize')).toBeInTheDocument()
    expect(screen.getByText('Account')).toBeInTheDocument()
    expect(screen.queryByText('Embarcadero Collective')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/user')
      expect(global.fetch).toHaveBeenCalledWith('/api/builder/billing/status')
    })
  })
})
