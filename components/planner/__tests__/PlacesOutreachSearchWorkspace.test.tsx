import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlacesOutreachSearchWorkspace } from '@/components/planner/PlacesOutreachSearchWorkspace'

const discoveryResponse = {
  summary: {
    total: 2,
    ready_to_reach_out: 1,
    contact_form_available: 1,
    contact_pending: 0,
    no_contact_available: 0,
  },
  candidates: [
    {
      candidate_id: 'candidate-1',
      discovery_venue_id: '11111111-1111-4111-8111-111111111111',
      name: 'Moongate Lounge',
      address: '123 Mission St',
      neighborhood: 'Mission',
      city: 'San Francisco',
      state: 'CA',
      website: 'https://moongate.example',
      contact_phone: '(415) 555-0100',
      contact_email: 'booking@moongate.example',
      contact_email_source: 'organizer_provided',
      contact_email_confidence: 'high',
      contact_form_url: null,
      contact_form_label: null,
      contact_form_source_path: null,
      contact_status: 'ready_to_reach_out',
      extraction_status: 'successful',
      fit_score: 91,
      status: 'candidate',
      google_rating: 4.8,
      google_user_ratings_total: 120,
      photo_urls: [],
      photos: [],
    },
    {
      candidate_id: 'candidate-2',
      discovery_venue_id: '22222222-2222-4222-8222-222222222222',
      name: 'Stable Cafe',
      address: '2128 Folsom St',
      neighborhood: 'Mission',
      city: 'San Francisco',
      state: 'CA',
      website: 'https://stable.example',
      contact_phone: '(415) 555-0111',
      contact_email: null,
      contact_email_source: null,
      contact_email_confidence: null,
      contact_form_url: 'https://stable.example/private-events',
      contact_form_label: 'Private events form',
      contact_form_source_path: '/private-events',
      contact_status: 'contact_form_available',
      extraction_status: 'never_attempted',
      fit_score: 79,
      status: 'candidate',
      google_rating: 4.5,
      google_user_ratings_total: 88,
      photo_urls: [],
      photos: [],
    },
  ],
}

const connectedGmailAccount = {
  id: 'gmail-account-1',
  provider: 'gmail',
  email_address: 'organizer@example.com',
}

describe('PlacesOutreachSearchWorkspace', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows a planner-first state instead of asking for a raw plan ID', () => {
    render(<PlacesOutreachSearchWorkspace />)

    expect(screen.getByText('Choose an event before searching Places')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Plan ID/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open planner chat/i })).toHaveAttribute('href', '/planner?tab=chat')
    expect(screen.getByRole('link', { name: /Choose an event record/i })).toHaveAttribute('href', '/planner/experiences')
  })

  it('follows the current route plan context when the selected event changes', async () => {
    const user = userEvent.setup()
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(discoveryResponse))
    global.fetch = fetchMock

    const { rerender } = render(<PlacesOutreachSearchWorkspace />)

    expect(screen.getByText('Choose an event before searching Places')).toBeInTheDocument()

    rerender(<PlacesOutreachSearchWorkspace initialPlanId="plan-2" />)

    await user.type(screen.getByLabelText(/Search places/i), 'Oakland bars')
    await user.click(screen.getByRole('button', { name: /Search Places/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/planner/plans/plan-2/discover-venues',
        expect.objectContaining({ method: 'POST' })
      )
    })
    const searchCall = fetchMock.mock.calls.find(([url]) => url === '/api/planner/plans/plan-2/discover-venues')
    expect(searchCall).toBeDefined()
    expect(JSON.parse(String(searchCall?.[1]?.body))).toEqual({
      query: 'Oakland bars',
      maxResultCount: 8,
    })
  })

  it('searches venues, saves organizer-provided email, and creates approval payloads', async () => {
    const user = userEvent.setup()
    const readyResponse = makeReadyDiscoveryResponse()
    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/integrations/gmail/account') return Promise.resolve(jsonResponse({ account: connectedGmailAccount }))
      if (url === '/api/planner/plans/plan-1/discover-venues' && init?.method === 'POST') return Promise.resolve(jsonResponse(discoveryResponse))
      if (url === '/api/planner/discovery-venues/22222222-2222-4222-8222-222222222222/contact-email' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ venue: { id: '22222222-2222-4222-8222-222222222222' } }))
      }
      if (url === '/api/planner/plans/plan-1/discover-venues' && !init?.method) return Promise.resolve(jsonResponse(readyResponse))
      if (url === '/api/planner/plans/plan-1/outreach/approve-batch' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ approvals: [{ approval_id: 'approval-1', target_count: 2, discovery_venue_ids: [], venue_names: [] }], created_count: 1, target_count: 2 }))
      }
      return Promise.resolve(jsonResponse({ error: `Unexpected request: ${url}` }, 500))
    })

    global.fetch = fetchMock

    render(<PlacesOutreachSearchWorkspace initialPlanId="plan-1" />)

    await user.type(screen.getByLabelText(/Search places/i), 'happy hour bars in Mission')
    await user.click(screen.getByRole('button', { name: /Search Places/i }))

    expect(await screen.findByText('Moongate Lounge')).toBeInTheDocument()
    expect(screen.getByText('Stable Cafe')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Forms found')).toBeInTheDocument()
    expect(screen.getByText('Checking')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Private events form/i })).toHaveAttribute('href', 'https://stable.example/private-events')

    await user.type(screen.getByLabelText(/Contact email for Stable Cafe/i), 'events@stable.example')
    await user.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/planner/discovery-venues/22222222-2222-4222-8222-222222222222/contact-email',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'events@stable.example' }),
        })
      )
    })

    await user.click(await screen.findByRole('button', { name: /Create bulk approval for 2/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/planner/plans/plan-1/outreach/approve-batch',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            discovery_venue_ids: [
              '11111111-1111-4111-8111-111111111111',
              '22222222-2222-4222-8222-222222222222',
            ],
          }),
        })
      )
    })
  })

  it('requires Gmail before creating desktop outreach approvals from Places results', async () => {
    const user = userEvent.setup()
    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/integrations/gmail/account') return Promise.resolve(jsonResponse({ account: null }))
      if (url === '/api/planner/plans/plan-1/discover-venues' && init?.method === 'POST') return Promise.resolve(jsonResponse(discoveryResponse))
      return Promise.resolve(jsonResponse({ error: `Unexpected request: ${url}` }, 500))
    })
    global.fetch = fetchMock

    render(<PlacesOutreachSearchWorkspace initialPlanId="plan-1" />)

    await user.type(screen.getByLabelText(/Search places/i), 'happy hour bars in Mission')
    await user.click(screen.getByRole('button', { name: /Search Places/i }))

    const connectLink = await screen.findByRole('link', { name: /Connect Gmail to approve/i })
    expect(connectLink).toHaveAttribute(
      'href',
      '/api/integrations/gmail/connect?returnTo=%2Fplanner%2Foutreach-search%3Fplan%3Dplan-1'
    )
    expect(screen.queryByRole('button', { name: /Create bulk approval/i })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/planner/plans/plan-1/outreach/approve-batch',
      expect.anything()
    )
  })
})

function makeReadyDiscoveryResponse() {
  return {
    ...discoveryResponse,
    summary: { total: 2, ready_to_reach_out: 2, contact_form_available: 0, contact_pending: 0, no_contact_available: 0 },
    candidates: discoveryResponse.candidates.map((candidate) => ({
      ...candidate,
      contact_email: candidate.contact_email ?? 'events@stable.example',
      contact_email_source: candidate.contact_email_source ?? 'organizer_provided',
      contact_email_confidence: candidate.contact_email_confidence ?? 'high',
      contact_form_url: null,
      contact_form_label: null,
      contact_form_source_path: null,
      contact_status: 'ready_to_reach_out',
    })),
  }
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
