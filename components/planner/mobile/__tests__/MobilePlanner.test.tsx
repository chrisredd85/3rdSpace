import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MobilePlanner } from '@/components/planner/mobile/MobilePlanner'

jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
    }
  },
  usePathname() {
    return '/planner'
  },
  useSearchParams() {
    return new URLSearchParams('draft=Stress%20test%20dinner%20for%2018%20in%20Hayes%20Valley%20with%20a%20%244500%20budget')
  },
}))

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  )
}

describe('MobilePlanner local draft flow', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    window.scrollTo = jest.fn()

    let publicIntakeCalls = 0
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url === '/api/planner/plans' && init?.method === 'POST') {
        return jsonResponse({ error: 'Authentication required' }, 401)
      }

      if (url === '/api/planner/public-intake' && init?.method === 'POST') {
        publicIntakeCalls += 1
        const budgetCents = publicIntakeCalls === 1 ? 450000 : 650000

        return jsonResponse({
          data: {
            plan_patch: {
              event_type: 'dinner',
              guest_count: 18,
              neighborhood: 'Hayes Valley',
              budget_cap_cents: budgetCents,
              notes: 'Private draft only. No Supabase writes.',
            },
            agent_draft: {
              content: publicIntakeCalls === 1
                ? 'Drafted privately. No outreach, hold, booking, or payment has been sent.'
                : 'Budget updated privately. No external action was taken.',
              message_type: 'status_update',
              metadata: {},
            },
          },
        })
      }

      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('saves budget corrections locally instead of posting mock plans to the server messages route', async () => {
    render(<MobilePlanner />)

    await waitFor(() => expect(screen.getByText(/Dinner · Hayes Valley · 18 guests · \$4,500/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Review next steps' })).toBeInTheDocument()
    expect(screen.getByText('Next action steps')).toBeInTheDocument()
    expect(screen.getByText('Confirm before outreach.')).toBeInTheDocument()
    expect(screen.queryByText('Open review queue')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Add a constraint, preference, or correction...'), {
      target: { value: 'Change the total budget to $6500.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.getByText(/Dinner · Hayes Valley · 18 guests · \$6,500/i)).toBeInTheDocument())
    expect(screen.getByText('Instruction saved privately')).toBeInTheDocument()
    expect(screen.queryByText('Unable to save instruction')).not.toBeInTheDocument()

    const urls = (global.fetch as jest.Mock).mock.calls.map(([input]) => String(input))
    expect(urls.some((url) => /\/api\/planner\/plans\/mock-plan-.*\/messages/.test(url))).toBe(false)
  })
})
