import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlannerWorkspace } from '@/components/planner/planner-page/PlannerWorkspace'
import { shouldStartNewPlanFromReply } from '@/components/planner/planner-page/plannerState'
import { ToastProvider } from '@/components/ui/toast'
import type { Plan } from '@/lib/types'

const mockReplace = jest.fn()
const mockPush = jest.fn()
let mockPathname = '/planner'
let mockSearchParams = 'draft=Founder%20dinner%20for%2024%20in%20Hayes%20Valley'

jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: mockPush,
      replace: mockReplace,
      prefetch: jest.fn(),
      back: jest.fn(),
    }
  },
  usePathname() {
    return mockPathname
  },
  useSearchParams() {
    return new URLSearchParams(mockSearchParams)
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

function renderPlannerWorkspace() {
  return render(
    <ToastProvider>
      <PlannerWorkspace />
    </ToastProvider>
  )
}

describe('PlannerWorkspace desktop draft handoff', () => {
  const originalFetch = global.fetch
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    jest.clearAllMocks()
    mockPathname = '/planner'
    mockSearchParams = 'draft=Founder%20dinner%20for%2024%20in%20Hayes%20Valley'
    window.localStorage.clear()
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: query === '(min-width: 1024px)',
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }))

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url === '/api/auth/user') {
        return jsonResponse({ user: { organization_name: 'nsbe' } })
      }

      if (url === '/api/planner/plans' && init?.method === 'POST') {
        return new Promise<Response>(() => {})
      }

      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock
  })

  afterEach(() => {
    global.fetch = originalFetch
    window.matchMedia = originalMatchMedia
  })

  it('shows a passive loading state instead of the empty composer while a splash draft starts', async () => {
    renderPlannerWorkspace()

    await waitFor(() => expect(screen.getByTestId('planner-initial-draft-loading')).toBeInTheDocument())

    expect(screen.getByText('Building your event plan.')).toBeInTheDocument()
    expect(screen.getByText('Using the event you just described. Nothing books, pays, or sends until you approve it.')).toBeInTheDocument()
    expect(screen.queryByText('What should we plan next?')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Describe your next event...')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/planner/plans',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ message: 'Founder dinner for 24 in Hayes Valley' }),
        })
      )
    })
  })

  it('keeps /planner/new-plan on a clean intake instead of loading the latest saved plan', async () => {
    mockPathname = '/planner/new-plan'
    mockSearchParams = ''

    renderPlannerWorkspace()

    await waitFor(() => expect(screen.getByText('What should we plan next?')).toBeInTheDocument())

    expect(global.fetch).not.toHaveBeenCalledWith('/api/planner/plans?limit=10', expect.anything())
    expect(screen.queryByText('Building your event plan.')).not.toBeInTheDocument()
  })

  it('archives an unfinished server plan before starting a new planner chat', async () => {
    mockPathname = '/planner'
    mockSearchParams = ''
    const user = userEvent.setup()
    const activePlan = makePlan()

    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url === '/api/auth/user') {
        return jsonResponse({ user: { organization_name: 'nsbe' } })
      }

      if (url === '/api/planner/plans?limit=10') {
        return jsonResponse({ plans: [activePlan], count: 1 })
      }

      if (url === `/api/planner/plans/${activePlan.id}` && init?.method === 'PATCH') {
        return jsonResponse({ plan: { ...activePlan, status: 'archived' } })
      }

      if (url === `/api/planner/plans/${activePlan.id}`) {
        return jsonResponse({
          plan: activePlan,
          messages: [],
          recommendations: [],
          approvals: [],
          workspace_summary: null,
        })
      }

      if (url === `/api/planner/plans/${activePlan.id}/agent-actions?limit=50`) {
        return jsonResponse({ agentActions: [] })
      }

      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock

    renderPlannerWorkspace()

    expect(await screen.findByRole('heading', { name: activePlan.title })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New plan' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/planner/plans/${activePlan.id}`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'archived' }),
        })
      )
    })

    expect(mockPush).toHaveBeenCalledWith('/planner/new-plan')
  })

  it('treats a literal new chat request as a fresh planner conversation', () => {
    expect(shouldStartNewPlanFromReply('new chat', makePlan())).toBe(true)
    expect(shouldStartNewPlanFromReply('fresh conversation please', makePlan())).toBe(true)
    expect(shouldStartNewPlanFromReply('start over with a clean workspace', makePlan())).toBe(true)
  })
})

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: 'builder-1',
    title: 'Unfinished mixer plan',
    event_type: 'mixer',
    status: 'drafting',
    guest_count: 40,
    budget_cap_cents: 500000,
    neighborhood: 'Mission',
    date_window_start: '2026-11-14',
    date_window_end: '2026-11-14',
    ticketed: false,
    ticketing_model: null,
    food_responsibility: null,
    venue_terms: null,
    agent_action: null,
    profit_goal_cents: null,
    notes: null,
    metadata: {},
    created_at: '2026-06-16T12:00:00.000Z',
    updated_at: '2026-06-16T12:00:00.000Z',
    ...overrides,
  }
}
