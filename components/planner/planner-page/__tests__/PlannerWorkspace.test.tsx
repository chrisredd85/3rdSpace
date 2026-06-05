import { render, screen, waitFor } from '@testing-library/react'
import { PlannerWorkspace } from '@/components/planner/planner-page/PlannerWorkspace'
import { ToastProvider } from '@/components/ui/toast'

const replace = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace,
      prefetch: jest.fn(),
      back: jest.fn(),
    }
  },
  usePathname() {
    return '/planner'
  },
  useSearchParams() {
    return new URLSearchParams('draft=Founder%20dinner%20for%2024%20in%20Hayes%20Valley')
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
})
