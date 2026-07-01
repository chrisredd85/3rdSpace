import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MobilePlanner } from '@/components/planner/mobile/MobilePlanner'

let mockSearchParams = 'draft=Stress%20test%20dinner%20for%2018%20in%20Hayes%20Valley%20with%20a%20%244500%20budget'

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
    return new URLSearchParams(mockSearchParams)
  },
}))

jest.mock('@/components/planner/PlannerTicketingSetupGuideSection', () => ({
  PlannerTicketingSetupGuideSection: ({ className }: { className?: string }) => (
    <section data-testid="mobile-ticketing-setup-guide" className={className}>Ticketing setup guide</section>
  ),
}))

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  )
}

const connectedGmailAccount = {
  id: 'gmail-account-1',
  provider: 'gmail',
  email_address: 'organizer@example.com',
}

function setMobileViewport() {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 812 })
  window.dispatchEvent(new Event('resize'))
}

describe('MobilePlanner local draft flow', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    setMobileViewport()
    mockSearchParams = 'draft=Stress%20test%20dinner%20for%2018%20in%20Hayes%20Valley%20with%20a%20%244500%20budget'
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

    expect(screen.getByPlaceholderText('Ask the agent or update the brief...')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Ask the agent or update the brief...'), {
      target: { value: 'Change the total budget to $6500.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message to 3rdPlace agent' }))

    await waitFor(() => expect(screen.getByText(/Dinner · Hayes Valley · 18 guests · \$6,500/i)).toBeInTheDocument())
    expect(screen.getByText('Instruction saved privately')).toBeInTheDocument()
    expect(screen.queryByText('Unable to save instruction')).not.toBeInTheDocument()

    const urls = (global.fetch as jest.Mock).mock.calls.map(([input]) => String(input))
    expect(urls.some((url) => /\/api\/planner\/plans\/mock-plan-.*\/messages/.test(url))).toBe(false)
  })
})

describe('MobilePlanner operating loop parity', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    setMobileViewport()
    mockSearchParams = ''
    window.scrollTo = jest.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('makes batch outreach the primary mobile next step when contact-ready venues exist', async () => {
    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/planner/plans?limit=10') return jsonResponse({ plans: [plan] })
      if (url === '/api/planner/plans/plan-1') return jsonResponse(plannerPayload)
      if (url === '/api/planner/plans/plan-1/mobile-home') return jsonResponse({ plan, pending_approvals: [], pending_approval_count: 0, problem: null, progress: [], updates: [] })
      if (url === '/api/planner/plans/plan-1/budget') return jsonResponse({ target_cents: 500000, low_total_cents: 0, high_total_cents: 0, committed_total_cents: 0, projected_delta_cents: null, projected_buffer_low_cents: null, projected_buffer_high_cents: null, lines: [] })
      if (url === '/api/planner/plans/plan-1/activity') return jsonResponse({ activities: [] })
      if (url === '/api/builder/billing/status') return jsonResponse({ billing: { tier: 'free', status: 'active', freeEventsRemaining: 1, canCreateEvent: true } })
      if (url === '/api/planner/ticketing/analytics') return jsonResponse({ summary: { tickets_sold: 0, net_revenue_cents: 0 }, events: [] })
      if (url === '/api/integrations/ticketing/connections') return jsonResponse({ connections: [] })
      if (url === '/api/integrations/gmail/account') return jsonResponse({ account: connectedGmailAccount })
      if (url === '/api/planner/analytics') return jsonResponse({ events_per_year: 0, average_margin_percent: null, rebook_rate_percent: null, best_format: null, recommendation: 'No data', recent_events: [] })
      if (url === '/api/planner/plans/plan-1/outreach/approve-batch' && init?.method === 'POST') {
        return jsonResponse({ created_count: 1, target_count: 1, approvals: [] })
      }
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    })
    global.fetch = fetchMock as jest.Mock

    render(<MobilePlanner />)

    expect(await screen.findByText('Create outreach batch first.')).toBeInTheDocument()
    expect(screen.getByText(/This mirrors desktop/i)).toBeInTheDocument()
    expect(screen.getByText('Confirm brief')).toBeInTheDocument()
    expect(screen.getByText('Venue outreach')).toBeInTheDocument()
    expect(screen.getByText('Budget')).toBeInTheDocument()
    expect(screen.getByText('Message approval')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Create outreach batch$/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/planner/plans/plan-1/outreach/approve-batch',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ discovery_venue_ids: ['11111111-1111-4111-8111-111111111111'] }),
        })
      )
    })
    expect(await screen.findByText('Agent-led partner outreach.')).toBeInTheDocument()
    expect(screen.getByText('1 outreach approval created for 1 venue. Review before send.')).toBeInTheDocument()
  })

  it('keeps mobile next-step rows tappable when the API returns sparse progress', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/planner/plans?limit=10') return jsonResponse({ plans: [plan] })
      if (url === '/api/planner/plans/plan-1') return jsonResponse(plannerPayload)
      if (url === '/api/planner/plans/plan-1/mobile-home') return jsonResponse({
        plan,
        pending_approvals: [],
        pending_approval_count: 0,
        problem: null,
        progress: [{ id: 'brief', label: 'Confirm brief', detail: 'Review before outreach', status: 'Ready', tone: 'forest' }],
        updates: [],
      })
      if (url === '/api/planner/plans/plan-1/budget') return jsonResponse({ target_cents: 500000, low_total_cents: 0, high_total_cents: 0, committed_total_cents: 0, projected_delta_cents: null, projected_buffer_low_cents: null, projected_buffer_high_cents: null, lines: [] })
      if (url === '/api/planner/plans/plan-1/activity') return jsonResponse({ activities: [] })
      if (url === '/api/builder/billing/status') return jsonResponse({ billing: { tier: 'free', status: 'active', freeEventsRemaining: 1, canCreateEvent: true } })
      if (url === '/api/planner/ticketing/analytics') return jsonResponse({ summary: { tickets_sold: 0, net_revenue_cents: 0 }, events: [] })
      if (url === '/api/integrations/ticketing/connections') return jsonResponse({ connections: [] })
      if (url === '/api/integrations/gmail/account') return jsonResponse({ account: connectedGmailAccount })
      if (url === '/api/planner/analytics') return jsonResponse({ events_per_year: 0, average_margin_percent: null, rebook_rate_percent: null, best_format: null, recommendation: 'No data', recent_events: [] })
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock

    render(<MobilePlanner />)

    expect(await screen.findByText('Confirm brief')).toBeInTheDocument()
    expect(screen.getByText('Venue outreach')).toBeInTheDocument()
    expect(screen.getByText('Budget')).toBeInTheDocument()
    expect(screen.getByText('Message approval')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Budget'))
    expect(await screen.findByText('Keep the run inside $5,000.')).toBeInTheDocument()
  })

  it('does not duplicate fallback next-action copy on the mobile landing', async () => {
    const noRecommendationPayload = { ...plannerPayload, recommendations: [] }
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/planner/plans?limit=10') return jsonResponse({ plans: [plan] })
      if (url === '/api/planner/plans/plan-1') return jsonResponse(noRecommendationPayload)
      if (url === '/api/planner/plans/plan-1/mobile-home') return jsonResponse({ plan, pending_approvals: [], pending_approval_count: 0, problem: null, progress: [], updates: [] })
      if (url === '/api/planner/plans/plan-1/budget') return jsonResponse({ target_cents: 500000, low_total_cents: 0, high_total_cents: 0, committed_total_cents: 0, projected_delta_cents: null, projected_buffer_low_cents: null, projected_buffer_high_cents: null, lines: [] })
      if (url === '/api/planner/plans/plan-1/activity') return jsonResponse({ activities: [] })
      if (url === '/api/builder/billing/status') return jsonResponse({ billing: { tier: 'free', status: 'active', freeEventsRemaining: 1, canCreateEvent: true } })
      if (url === '/api/planner/ticketing/analytics') return jsonResponse({ summary: { tickets_sold: 0, net_revenue_cents: 0 }, events: [] })
      if (url === '/api/integrations/ticketing/connections') return jsonResponse({ connections: [] })
      if (url === '/api/integrations/gmail/account') return jsonResponse({ account: connectedGmailAccount })
      if (url === '/api/planner/analytics') return jsonResponse({ events_per_year: 0, average_margin_percent: null, rebook_rate_percent: null, best_format: null, recommendation: 'No data', recent_events: [] })
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock

    render(<MobilePlanner />)

    expect(await screen.findByText('Confirm before outreach.')).toBeInTheDocument()
    expect(screen.getByText('Confirm the brief, budget, and approval rules before 3rdPlace prepares external outreach.')).toBeInTheDocument()
    expect(screen.getByText('Use the composer for corrections, then review the message approval. Nothing sends from this draft.')).toBeInTheDocument()
    expect(screen.queryByText(/The plan can move toward venue and vendor outreach after you confirm the facts/i)).not.toBeInTheDocument()
  })

  it('routes pending outreach batches to the mobile outreach review loop', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/planner/plans?limit=10') return jsonResponse({ plans: [plan] })
      if (url === '/api/planner/plans/plan-1') return jsonResponse(plannerPayloadWithOutreachApproval)
      if (url === '/api/planner/plans/plan-1/mobile-home') return jsonResponse({ plan, pending_approvals: [outreachApproval], pending_approval_count: 1, problem: null, progress: [], updates: [] })
      if (url === '/api/planner/plans/plan-1/budget') return jsonResponse({ target_cents: 500000, low_total_cents: 0, high_total_cents: 0, committed_total_cents: 0, projected_delta_cents: null, projected_buffer_low_cents: null, projected_buffer_high_cents: null, lines: [] })
      if (url === '/api/planner/plans/plan-1/activity') return jsonResponse({ activities: [] })
      if (url === '/api/builder/billing/status') return jsonResponse({ billing: { tier: 'free', status: 'active', freeEventsRemaining: 1, canCreateEvent: true } })
      if (url === '/api/planner/ticketing/analytics') return jsonResponse({ summary: { tickets_sold: 0, net_revenue_cents: 0 }, events: [] })
      if (url === '/api/integrations/ticketing/connections') return jsonResponse({ connections: [] })
      if (url === '/api/integrations/gmail/account') return jsonResponse({ account: null })
      if (url === '/api/planner/analytics') return jsonResponse({ events_per_year: 0, average_margin_percent: null, rebook_rate_percent: null, best_format: null, recommendation: 'No data', recent_events: [] })
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock

    render(<MobilePlanner />)

    expect(await screen.findByText('Outreach batch is waiting.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Review outreach batch/i }))

    expect(await screen.findByText('Agent-led partner outreach.')).toBeInTheDocument()
    expect(screen.getByText('1 outreach batch waiting on you.')).toBeInTheDocument()
  })

  it('requires Gmail connection before mobile can create a venue outreach batch', async () => {
    const fetchMock = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/planner/plans?limit=10') return jsonResponse({ plans: [plan] })
      if (url === '/api/planner/plans/plan-1') return jsonResponse(plannerPayload)
      if (url === '/api/planner/plans/plan-1/mobile-home') return jsonResponse({ plan, pending_approvals: [], pending_approval_count: 0, problem: null, progress: [], updates: [] })
      if (url === '/api/planner/plans/plan-1/budget') return jsonResponse({ target_cents: 500000, low_total_cents: 0, high_total_cents: 0, committed_total_cents: 0, projected_delta_cents: null, projected_buffer_low_cents: null, projected_buffer_high_cents: null, lines: [] })
      if (url === '/api/planner/plans/plan-1/activity') return jsonResponse({ activities: [] })
      if (url === '/api/builder/billing/status') return jsonResponse({ billing: { tier: 'free', status: 'active', freeEventsRemaining: 1, canCreateEvent: true } })
      if (url === '/api/planner/ticketing/analytics') return jsonResponse({ summary: { tickets_sold: 0, net_revenue_cents: 0 }, events: [] })
      if (url === '/api/integrations/ticketing/connections') return jsonResponse({ connections: [] })
      if (url === '/api/integrations/gmail/account') return jsonResponse({ account: null })
      if (url === '/api/planner/analytics') return jsonResponse({ events_per_year: 0, average_margin_percent: null, rebook_rate_percent: null, best_format: null, recommendation: 'No data', recent_events: [] })
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    })
    global.fetch = fetchMock as jest.Mock

    render(<MobilePlanner initialView="venues" />)

    const connectLink = await screen.findByRole('link', { name: /Connect Gmail to create batch/i })
    expect(connectLink).toHaveAttribute(
      'href',
      '/api/integrations/gmail/connect?returnTo=%2Fplanner%3Fplan%3Dplan-1%26view%3Dvenues'
    )
    expect(screen.queryByRole('button', { name: /Create outreach batch/i })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/planner/plans/plan-1/outreach/approve-batch',
      expect.anything()
    )
  })

  it('routes parsed replies to mobile quote comparison before new hold approvals', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/planner/plans?limit=10') return jsonResponse({ plans: [planWithQuote] })
      if (url === '/api/planner/plans/plan-1') return jsonResponse({ ...plannerPayload, plan: planWithQuote })
      if (url === '/api/planner/plans/plan-1/mobile-home') return jsonResponse({ plan: planWithQuote, pending_approvals: [], pending_approval_count: 0, problem: null, progress: [], updates: [] })
      if (url === '/api/planner/plans/plan-1/budget') return jsonResponse({ target_cents: 500000, low_total_cents: 0, high_total_cents: 0, committed_total_cents: 0, projected_delta_cents: null, projected_buffer_low_cents: null, projected_buffer_high_cents: null, lines: [] })
      if (url === '/api/planner/plans/plan-1/activity') return jsonResponse({ activities: [] })
      if (url === '/api/builder/billing/status') return jsonResponse({ billing: { tier: 'free', status: 'active', freeEventsRemaining: 1, canCreateEvent: true } })
      if (url === '/api/planner/ticketing/analytics') return jsonResponse({ summary: { tickets_sold: 0, net_revenue_cents: 0 }, events: [] })
      if (url === '/api/integrations/ticketing/connections') return jsonResponse({ connections: [] })
      if (url === '/api/integrations/gmail/account') return jsonResponse({ account: connectedGmailAccount })
      if (url === '/api/planner/analytics') return jsonResponse({ events_per_year: 0, average_margin_percent: null, rebook_rate_percent: null, best_format: null, recommendation: 'No data', recent_events: [] })
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock

    render(<MobilePlanner />)

    expect(await screen.findByText('Compare returned terms.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Compare replies/i }))

    expect(await screen.findByText('Best next step from replies')).toBeInTheDocument()
    expect(screen.getAllByText('Moongate Lounge').length).toBeGreaterThan(0)
  })

  it('shows contact rescue, readiness state, and creates venue outreach approvals from mobile', async () => {
    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/planner/plans?limit=10') return jsonResponse({ plans: [plan] })
      if (url === '/api/planner/plans/plan-1') return jsonResponse(plannerPayload)
      if (url === '/api/planner/plans/plan-1/mobile-home') return jsonResponse({ plan, pending_approvals: [], pending_approval_count: 0, problem: null, progress: [], updates: [] })
      if (url === '/api/planner/plans/plan-1/budget') return jsonResponse({ target_cents: 500000, low_total_cents: 0, high_total_cents: 0, committed_total_cents: 0, projected_delta_cents: null, projected_buffer_low_cents: null, projected_buffer_high_cents: null, lines: [] })
      if (url === '/api/planner/plans/plan-1/activity') return jsonResponse({ activities: [] })
      if (url === '/api/builder/billing/status') return jsonResponse({ billing: { tier: 'free', status: 'active', freeEventsRemaining: 1, canCreateEvent: true } })
      if (url === '/api/planner/ticketing/analytics') return jsonResponse({ summary: { tickets_sold: 0, net_revenue_cents: 0 }, events: [] })
      if (url === '/api/integrations/ticketing/connections') return jsonResponse({ connections: [] })
      if (url === '/api/integrations/gmail/account') return jsonResponse({ account: connectedGmailAccount })
      if (url === '/api/planner/analytics') return jsonResponse({ events_per_year: 0, average_margin_percent: null, rebook_rate_percent: null, best_format: null, recommendation: 'No data', recent_events: [] })
      if (url === '/api/planner/discovery-venues/22222222-2222-4222-8222-222222222222/contact-email' && init?.method === 'POST') {
        return jsonResponse({ venue: { id: '22222222-2222-4222-8222-222222222222' }, draft_results: [{ status: 'draft_created' }] })
      }
      if (url === '/api/planner/plans/plan-1/outreach/approve-batch' && init?.method === 'POST') {
        return jsonResponse({ created_count: 1, target_count: 1, approvals: [] })
      }
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    })
    global.fetch = fetchMock as jest.Mock

    render(<MobilePlanner initialView="venues" />)

    expect(await screen.findByText('Moongate Lounge')).toBeInTheDocument()
    expect(screen.getByText('Stripe pending')).toBeInTheDocument()
    expect(screen.getByText('Add email')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Add contact email'))
    fireEvent.change(screen.getByPlaceholderText('booking@example.com'), {
      target: { value: 'events@stable.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Save and create draft/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/planner/discovery-venues/22222222-2222-4222-8222-222222222222/contact-email',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'events@stable.example' }),
        })
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /Create outreach batch/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/planner/plans/plan-1/outreach/approve-batch',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ discovery_venue_ids: ['11111111-1111-4111-8111-111111111111'] }),
        })
      )
    })
    expect(await screen.findByText('Agent-led partner outreach.')).toBeInTheDocument()
  })

  it('renders reply quote cards and commits accepted venue quotes through the mobile flow', async () => {
    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/planner/plans?limit=10') return jsonResponse({ plans: [planWithQuote] })
      if (url === '/api/planner/plans/plan-1') return jsonResponse({ ...plannerPayload, plan: planWithQuote })
      if (url === '/api/planner/plans/plan-1/mobile-home') return jsonResponse({ plan: planWithQuote, pending_approvals: [], pending_approval_count: 0, problem: null, progress: [], updates: [] })
      if (url === '/api/planner/plans/plan-1/budget') return jsonResponse({ target_cents: 500000, low_total_cents: 0, high_total_cents: 0, committed_total_cents: 0, projected_delta_cents: null, projected_buffer_low_cents: null, projected_buffer_high_cents: null, lines: [] })
      if (url === '/api/planner/plans/plan-1/activity') return jsonResponse({ activities: [] })
      if (url === '/api/builder/billing/status') return jsonResponse({ billing: { tier: 'free', status: 'active', freeEventsRemaining: 1, canCreateEvent: true } })
      if (url === '/api/planner/ticketing/analytics') return jsonResponse({ summary: { tickets_sold: 0, net_revenue_cents: 0 }, events: [] })
      if (url === '/api/integrations/ticketing/connections') return jsonResponse({ connections: [] })
      if (url === '/api/planner/analytics') return jsonResponse({ events_per_year: 0, average_margin_percent: null, rebook_rate_percent: null, best_format: null, recommendation: 'No data', recent_events: [] })
      if (url === '/api/planner/plans/plan-1/commit-venue' && init?.method === 'POST') return jsonResponse({ plan: planWithQuote })
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    })
    global.fetch = fetchMock as jest.Mock

    render(<MobilePlanner activeSection="outreach" />)

    expect(await screen.findByText('Best next step from replies')).toBeInTheDocument()
    expect(screen.getAllByText('Moongate Lounge').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /Use this venue quote/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/planner/plans/plan-1/commit-venue',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"discovery_venue_id":"11111111-1111-4111-8111-111111111111"'),
        })
      )
    })
  })

  it('mounts the mobile ticketing setup guide on Tickets', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/planner/plans?limit=10') return jsonResponse({ plans: [plan] })
      if (url === '/api/planner/plans/plan-1') return jsonResponse(plannerPayload)
      if (url === '/api/planner/plans/plan-1/mobile-home') return jsonResponse({ plan, pending_approvals: [], pending_approval_count: 0, problem: null, progress: [], updates: [] })
      if (url === '/api/planner/plans/plan-1/budget') return jsonResponse({ target_cents: 500000, low_total_cents: 0, high_total_cents: 0, committed_total_cents: 0, projected_delta_cents: null, projected_buffer_low_cents: null, projected_buffer_high_cents: null, lines: [] })
      if (url === '/api/planner/plans/plan-1/activity') return jsonResponse({ activities: [] })
      if (url === '/api/builder/billing/status') return jsonResponse({ billing: { tier: 'free', status: 'active', freeEventsRemaining: 1, canCreateEvent: true } })
      if (url === '/api/planner/ticketing/analytics') return jsonResponse({ summary: { tickets_sold: 0, net_revenue_cents: 0 }, events: [] })
      if (url === '/api/integrations/ticketing/connections') {
        return jsonResponse({
          connections: [
            { id: 'luma', platform: 'luma', status: 'pending', account_label: null, last_connected_at: null },
            { id: 'eventbrite', platform: 'eventbrite', status: 'pending', account_label: null, last_connected_at: null },
            { id: 'posh', platform: 'posh', status: 'pending', account_label: null, last_connected_at: null },
            { id: 'partiful', platform: 'partiful', status: 'pending', account_label: null, last_connected_at: null },
          ],
        })
      }
      if (url === '/api/planner/analytics') return jsonResponse({ events_per_year: 0, average_margin_percent: null, rebook_rate_percent: null, best_format: null, recommendation: 'No data', recent_events: [] })
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock

    render(<MobilePlanner activeSection="ticketing" />)

    expect(await screen.findByTestId('mobile-ticketing-setup-guide')).toBeInTheDocument()
    expect(screen.getByText('Luma')).toBeInTheDocument()
    expect(screen.getByText('Eventbrite')).toBeInTheDocument()
    expect(screen.getByText('Posh')).toBeInTheDocument()
    expect(screen.getByText('Partiful')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Connect Eventbrite/i })).toHaveAttribute('href', '/planner/integrations/eventbrite')
    expect(screen.getByRole('link', { name: /Set up Posh/i })).toHaveAttribute('href', '/planner/integrations/posh')
    expect(screen.getByRole('link', { name: /Import Luma CSV or screenshots/i })).toHaveAttribute('href', '/planner/events/import?source=luma')
    expect(screen.getByRole('link', { name: /Import Partiful CSV or screenshots/i })).toHaveAttribute('href', '/planner/events/import?source=partiful')
  })

  it('turns missing mobile brief facts into direct shortcuts', async () => {
    const draftPlan = {
      ...plan,
      ticketed: false,
      ticketing_model: null,
      venue_terms: null,
      agent_action: null,
      metadata: {},
    }

    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/planner/plans?limit=10') return jsonResponse({ plans: [draftPlan] })
      if (url === '/api/planner/plans/plan-1') return jsonResponse({ ...plannerPayload, plan: draftPlan })
      if (url === '/api/planner/plans/plan-1/mobile-home') return jsonResponse({ plan: draftPlan, pending_approvals: [], pending_approval_count: 0, problem: null, progress: [], updates: [] })
      if (url === '/api/planner/plans/plan-1/budget') return jsonResponse({ target_cents: 500000, low_total_cents: 0, high_total_cents: 0, committed_total_cents: 0, projected_delta_cents: null, projected_buffer_low_cents: null, projected_buffer_high_cents: null, lines: [] })
      if (url === '/api/planner/plans/plan-1/activity') return jsonResponse({ activities: [] })
      if (url === '/api/builder/billing/status') return jsonResponse({ billing: { tier: 'free', status: 'active', freeEventsRemaining: 1, canCreateEvent: true } })
      if (url === '/api/planner/ticketing/analytics') return jsonResponse({ summary: { tickets_sold: 0, net_revenue_cents: 0 }, events: [] })
      if (url === '/api/integrations/ticketing/connections') return jsonResponse({ connections: [] })
      if (url === '/api/planner/analytics') return jsonResponse({ events_per_year: 0, average_margin_percent: null, rebook_rate_percent: null, best_format: null, recommendation: 'No data', recent_events: [] })
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock

    render(<MobilePlanner initialView="brief" />)

    expect(await screen.findByText('Confirmed facts')).toBeInTheDocument()
    expect(screen.getByText('Tickets / RSVPs').closest('a')).toHaveAttribute('href', '/planner/tickets')
    expect(screen.getByText('Venue Terms').closest('a')).toHaveAttribute('href', '/planner/outreach?plan=plan-1')
    expect(screen.getByText('Revenue Model').closest('a')).toHaveAttribute('href', '/planner/experiences/plan-1#profit-window')
    expect(screen.getByText('Agent Action').closest('a')).toHaveAttribute('href', '/planner/settings#approval-rules')
  })

  it('shows compact active event context above the mobile approvals queue', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/planner/plans?limit=10') return jsonResponse({ plans: [plan] })
      if (url === '/api/planner/plans/plan-1') return jsonResponse(plannerPayloadWithOutreachApproval)
      if (url === '/api/planner/plans/plan-1/mobile-home') return jsonResponse({ plan, pending_approvals: [outreachApproval], pending_approval_count: 1, problem: null, progress: [], updates: [] })
      if (url === '/api/planner/plans/plan-1/budget') return jsonResponse({ target_cents: 500000, low_total_cents: 0, high_total_cents: 0, committed_total_cents: 0, projected_delta_cents: null, projected_buffer_low_cents: null, projected_buffer_high_cents: null, lines: [] })
      if (url === '/api/planner/plans/plan-1/activity') return jsonResponse({ activities: [] })
      if (url === '/api/builder/billing/status') return jsonResponse({ billing: { tier: 'free', status: 'active', freeEventsRemaining: 1, canCreateEvent: true } })
      if (url === '/api/planner/ticketing/analytics') return jsonResponse({ summary: { tickets_sold: 0, net_revenue_cents: 0 }, events: [] })
      if (url === '/api/integrations/ticketing/connections') return jsonResponse({ connections: [] })
      if (url === '/api/planner/analytics') return jsonResponse({ events_per_year: 0, average_margin_percent: null, rebook_rate_percent: null, best_format: null, recommendation: 'No data', recent_events: [] })
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock

    render(<MobilePlanner activeSection="approvals" />)

    expect(await screen.findByText('Active event')).toBeInTheDocument()
    expect(screen.getByText('Oakland happy hour')).toBeInTheDocument()
    expect(screen.getByText(/Downtown Oakland · 40 guests/)).toBeInTheDocument()
    expect(screen.getByText('1 pending')).toBeInTheDocument()
  })

  it('loads the same requested plan as desktop when the mobile URL includes plan', async () => {
    mockSearchParams = 'plan=plan-2'
    const fetchMock = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/planner/plans?limit=10') return jsonResponse({ error: 'Plan list should not load for explicit plan links' }, 500)
      if (url === '/api/planner/plans/plan-2') return jsonResponse({ ...plannerPayload, plan: planTwo, approvals: [], recommendations: [] })
      if (url === '/api/planner/plans/plan-2/mobile-home') return jsonResponse({ plan: planTwo, pending_approvals: [], pending_approval_count: 0, problem: null, progress: [], updates: [] })
      if (url === '/api/planner/plans/plan-2/budget') return jsonResponse({ target_cents: 300000, low_total_cents: 0, high_total_cents: 0, committed_total_cents: 0, projected_delta_cents: null, projected_buffer_low_cents: null, projected_buffer_high_cents: null, lines: [] })
      if (url === '/api/planner/plans/plan-2/activity') return jsonResponse({ activities: [] })
      if (url === '/api/builder/billing/status') return jsonResponse({ billing: { tier: 'free', status: 'active', freeEventsRemaining: 1, canCreateEvent: true } })
      if (url === '/api/planner/ticketing/analytics') return jsonResponse({ summary: { tickets_sold: 0, net_revenue_cents: 0 }, events: [] })
      if (url === '/api/integrations/ticketing/connections') return jsonResponse({ connections: [] })
      if (url === '/api/planner/analytics') return jsonResponse({ events_per_year: 0, average_margin_percent: null, rebook_rate_percent: null, best_format: null, recommendation: 'No data', recent_events: [] })
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    })
    global.fetch = fetchMock as jest.Mock

    render(<MobilePlanner />)

    expect(await screen.findByText('Berkeley supper club')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/planner/plans?limit=10', expect.anything())
  })

  it('exposes every desktop planner section from the mobile navigation drawer', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/planner/plans?limit=10') return jsonResponse({ plans: [plan] })
      if (url === '/api/planner/plans/plan-1') return jsonResponse(plannerPayload)
      if (url === '/api/planner/plans/plan-1/mobile-home') return jsonResponse({ plan, pending_approvals: [], pending_approval_count: 0, problem: null, progress: [], updates: [] })
      if (url === '/api/planner/plans/plan-1/budget') return jsonResponse({ target_cents: 500000, low_total_cents: 0, high_total_cents: 0, committed_total_cents: 0, projected_delta_cents: null, projected_buffer_low_cents: null, projected_buffer_high_cents: null, lines: [] })
      if (url === '/api/planner/plans/plan-1/activity') return jsonResponse({ activities: [] })
      if (url === '/api/builder/billing/status') return jsonResponse({ billing: { tier: 'free', status: 'active', freeEventsRemaining: 1, canCreateEvent: true } })
      if (url === '/api/planner/ticketing/analytics') return jsonResponse({ summary: { tickets_sold: 0, net_revenue_cents: 0 }, events: [] })
      if (url === '/api/integrations/ticketing/connections') return jsonResponse({ connections: [] })
      if (url === '/api/planner/analytics') return jsonResponse({ events_per_year: 0, average_margin_percent: null, rebook_rate_percent: null, best_format: null, recommendation: 'No data', recent_events: [] })
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock

    render(<MobilePlanner />)

    await screen.findByText('Oakland happy hour')
    fireEvent.click(screen.getByRole('button', { name: /Open navigation/i }))

    const expectedLinks = [
      ['Agent Planner', '/planner'],
      ['Experiences', '/planner/experiences'],
      ['Templates', '/planner/templates'],
      ['Venues', '/planner/venues'],
      ['Tickets', '/planner/tickets'],
      ['Vendors', '/planner/vendors'],
      ['Outreach', '/planner/outreach'],
      ['Messages', '/planner/messages'],
      ['Approvals', '/planner/approvals'],
      ['Payments', '/planner/payments'],
      ['Settlements', '/planner/settlements'],
      ['Billing', '/planner/billing'],
      ['Analytics', '/planner/analytics'],
      ['Support', '/planner/support'],
      ['Settings', '/planner/settings'],
    ]

    for (const [label, href] of expectedLinks) {
      expect(screen.getByRole('link', { name: new RegExp(label, 'i') })).toHaveAttribute('href', href)
    }
  })

  it('gives mobile settings direct links for integrations, billing, and data actions', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/planner/plans?limit=10') return jsonResponse({ plans: [plan] })
      if (url === '/api/planner/plans/plan-1') return jsonResponse(plannerPayload)
      if (url === '/api/planner/plans/plan-1/mobile-home') return jsonResponse({ plan, pending_approvals: [], pending_approval_count: 0, problem: null, progress: [], updates: [] })
      if (url === '/api/planner/plans/plan-1/budget') return jsonResponse({ target_cents: 500000, low_total_cents: 0, high_total_cents: 0, committed_total_cents: 0, projected_delta_cents: null, projected_buffer_low_cents: null, projected_buffer_high_cents: null, lines: [] })
      if (url === '/api/planner/plans/plan-1/activity') return jsonResponse({ activities: [] })
      if (url === '/api/builder/billing/status') return jsonResponse({ billing: { tier: 'free', status: 'active', freeEventsRemaining: 1, canCreateEvent: true } })
      if (url === '/api/planner/ticketing/analytics') return jsonResponse({ summary: { tickets_sold: 0, net_revenue_cents: 0 }, events: [] })
      if (url === '/api/integrations/ticketing/connections') return jsonResponse({ connections: [] })
      if (url === '/api/planner/analytics') return jsonResponse({ events_per_year: 0, average_margin_percent: null, rebook_rate_percent: null, best_format: null, recommendation: 'No data', recent_events: [] })
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock

    render(<MobilePlanner activeSection="settings" />)

    expect(await screen.findByText('3rdPlace defaults.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Manage Gmail and integrations/i })).toHaveAttribute('href', '/planner/settings/integrations')
    expect(screen.getByRole('link', { name: /Edit account settings/i })).toHaveAttribute('href', '/planner/settings')
    expect(screen.getByRole('link', { name: /Manage billing/i })).toHaveAttribute('href', '/planner/billing')
    expect(screen.getByRole('link', { name: /Data and account deletion/i })).toHaveAttribute('href', '/planner/settings/delete-account')
    expect(screen.queryByRole('link', { name: /Edit on desktop/i })).not.toBeInTheDocument()
  })
})

const plan = {
  id: 'plan-1',
  user_id: 'user-1',
  title: 'Oakland happy hour',
  event_type: 'networking_mixer',
  status: 'ready',
  guest_count: 40,
  budget_cap_cents: 500000,
  neighborhood: 'Downtown Oakland',
  date_window_start: '2026-07-10',
  date_window_end: '2026-07-10',
  ticketed: true,
  profit_goal_cents: 100000,
  notes: null,
  metadata: {},
  created_at: '2026-06-24T00:00:00.000Z',
  updated_at: '2026-06-24T00:00:00.000Z',
}

const planTwo = {
  ...plan,
  id: 'plan-2',
  title: 'Berkeley supper club',
  neighborhood: 'Berkeley',
  guest_count: 24,
  budget_cap_cents: 300000,
  date_window_start: '2026-08-15',
  date_window_end: '2026-08-15',
}

const planWithQuote = {
  ...plan,
  metadata: {
    outreach_response_summary: {
      venues: [{
        discovery_venue_id: '11111111-1111-4111-8111-111111111111',
        venue_name: 'Moongate Lounge',
        status: 'favorable',
        quote_cents: 180000,
        summary: 'Available with a minimum spend and private room.',
        confidence: 0.92,
      }],
      vendors: [],
    },
  },
}

const outreachApproval = {
  id: 'approval-1',
  action_label: 'Review Gmail outreach batch',
  provider: 'Gmail',
  event_date: null,
  price_cents: null,
  fees_cents: null,
  refund_terms: null,
  cancellation_terms: null,
  package_details: 'Approve outreach to 1 venue before anything sends.',
  status: 'pending',
  requested_amount_cents: null,
  authorized_amount_cents: null,
  updated_at: '2026-06-24T00:00:00.000Z',
  created_at: '2026-06-24T00:00:00.000Z',
}

const plannerPayload = {
  plan,
  messages: [],
  approvals: [],
  recommendations: [
    {
      id: 'rec-1',
      type: 'venue',
      reference_id: null,
      external_name: 'Moongate Lounge',
      price_cents: 180000,
      rank: 1,
      status: 'candidate',
      is_best_fit: true,
      metadata: {
        discovery_venue_id: '11111111-1111-4111-8111-111111111111',
        contact_status: 'ready_to_reach_out',
        contact_email: 'events@moongate.example',
        is_claimed: true,
        stripe_connect_status: 'incomplete',
        capacity_known: false,
        source: 'Places',
      },
    },
    {
      id: 'rec-2',
      type: 'venue',
      reference_id: null,
      external_name: 'Stable Cafe',
      price_cents: 120000,
      rank: 2,
      status: 'candidate',
      is_best_fit: false,
      metadata: {
        discovery_venue_id: '22222222-2222-4222-8222-222222222222',
        contact_status: 'no_contact_available',
        website: 'https://stable.example',
        source: 'Places',
      },
    },
  ],
}

const plannerPayloadWithOutreachApproval = {
  ...plannerPayload,
  approvals: [outreachApproval],
}
