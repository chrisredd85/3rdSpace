import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { independentVenueEvidence, readSafeDiscoveryVenue } from '@/lib/discovery/venueRepository'
import { PlacesOutreachSearchWorkspace } from '../PlacesOutreachSearchWorkspace'

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }))

const originalFetch = global.fetch
const originalObserver = global.IntersectionObserver
const fetchMock = jest.fn()
const response = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload })
const candidate = (id: string, status = 'no_contact_available', score = 0) => ({
  candidate_id: `candidate-${id}`, discovery_venue_id: id, name: 'Venue details unavailable',
  address: null, neighborhood: null, city: null, state: null, website: null, contact_phone: null,
  contact_email: null, contact_email_source: null, contact_email_confidence: null,
  contact_form_url: null, contact_form_label: null, contact_form_source_path: null,
  contact_status: status, extraction_status: null, fit_score: score, status: 'candidate',
  google_rating: null, google_user_ratings_total: null, photo_urls: [],
})
const live = (id: string, score = 0) => ({ status: 'available', place_id: `place-${id}`, profile: 'enterprise', attempts: 1,
  fit_score: score, place: { id: `place-${id}`, displayName: { text: `Live ${id}` }, googleMapsUri: `https://maps.google.com/${id}` } })
const summary = { total: 1, ready_to_reach_out: 0, contact_pending: 0, no_contact_available: 1 }

beforeEach(() => { jest.clearAllMocks(); global.fetch = fetchMock; global.IntersectionObserver = undefined as unknown as typeof IntersectionObserver })
afterEach(() => { global.fetch = originalFetch; global.IntersectionObserver = originalObserver })

it('loads recommendation-created identity candidates on mount and shows fresh attributed cards without storage', async () => {
  const storage = jest.spyOn(Storage.prototype, 'setItem')
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/gmail/account')) return response({ account: null })
    if (url.endsWith('/discover-venues')) return response({ candidates: [candidate('one')], summary })
    if (url.endsWith('/one/card')) return response({ venue_id: 'one', google_live: live('one') })
    throw new Error(`Unexpected test request ${url}`)
  })
  render(<PlacesOutreachSearchWorkspace initialPlanId="plan-one" />)
  expect(await screen.findByText('Live one')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith('/api/planner/plans/plan-one/discover-venues', expect.objectContaining({ cache: 'no-store' }))
  expect(screen.getByAltText('Google Maps')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'View on Google Maps' })).toHaveAttribute('href', 'https://maps.google.com/one')
  expect(storage).not.toHaveBeenCalled()
  storage.mockRestore()
})

it('reorders fresh selected scores only within existing contact groups', async () => {
  const candidates = [candidate('ready-low', 'ready_to_reach_out', 99), candidate('ready-high', 'ready_to_reach_out', 1),
    candidate('none', 'no_contact_available', 100), candidate('pending', 'contact_pending', 95),
    candidate('form-low', 'contact_form_available', 99), candidate('link-high', 'contact_link_available', 1)]
  const overlays = Object.fromEntries([['ready-low', 10], ['ready-high', 20], ['none', 100], ['pending', 95], ['form-low', 5], ['link-high', 10]].map(([id, score]) => [id, live(String(id), Number(score))]))
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/gmail/account')) return response({ account: null })
    if (url.endsWith('/discover-venues')) return response(init?.method === 'POST' ? { candidates, summary, google_live_overlays: overlays } : { candidates: [], summary })
    throw new Error(`Unexpected test request ${url}`)
  })
  const rendered = render(<PlacesOutreachSearchWorkspace initialPlanId="plan-one" />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Search Places' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Search Places' }))
  await screen.findByText('Live ready-high')
  const articles = [...rendered.container.querySelectorAll('article')]
  expect(articles.map(article => [...article.querySelectorAll('p')].find(p => p.textContent?.startsWith('Live '))?.textContent)).toEqual([
    'Live ready-high', 'Live ready-low', 'Live link-high', 'Live form-low', 'Live pending', 'Live none',
  ])
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/card'))).toBe(false)
})

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
      google_rating: null,
      google_user_ratings_total: null,
      photo_urls: [],
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
      google_rating: null,
      google_user_ratings_total: null,
      photo_urls: [],
    },
  ],
}

// These saved values are independently supplied; Google presentation belongs only in overlays.
const independentDiscoveryResponse = {
  ...discoveryResponse,
  candidates: discoveryResponse.candidates.map((candidate) => ({
    ...candidate,
    venue_data: readSafeDiscoveryVenue({
      id: candidate.discovery_venue_id, source: 'manual_seed', ...candidate,
      metadata: { field_provenance: Object.fromEntries(
        ['name', 'address', 'neighborhood', 'city', 'state', 'website', 'contact_phone', 'contact_email']
          .map(field => [field, independentVenueEvidence('host_input', `fixture:host:${field}`)])
      ) },
    }).venue_data,
  })),
  google_live_overlays: Object.fromEntries(discoveryResponse.candidates.map(candidate => [
    candidate.discovery_venue_id,
    { status: 'unavailable', place_id: `place-${candidate.discovery_venue_id}`, profile: 'pro', attempts: 0 },
  ])),
}

const connectedGmailAccount = {
  id: 'gmail-account-1',
  provider: 'gmail',
  email_address: 'organizer@example.com',
}

describe('PlacesOutreachSearchWorkspace', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ account: null }))
  })

  it('shows a planner-first state instead of asking for a raw plan ID', async () => {
    render(<PlacesOutreachSearchWorkspace />)

    expect(screen.getByText('Choose an event before searching Places')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Plan ID/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open planner chat/i })).toHaveAttribute('href', '/planner?tab=chat')
    expect(screen.getByRole('link', { name: /Choose an event record/i })).toHaveAttribute('href', '/planner/experiences')
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/integrations/gmail/account', expect.anything()))
  })

  it('follows the current route plan context when the selected event changes', async () => {
    const user = userEvent.setup()
    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(jsonResponse(
      String(input).includes('/gmail/account') ? { account: null }
        : init?.method === 'POST' ? independentDiscoveryResponse : { candidates: [], summary: null }
    )))
    global.fetch = fetchMock

    const { rerender } = render(<PlacesOutreachSearchWorkspace />)

    expect(screen.getByText('Choose an event before searching Places')).toBeInTheDocument()

    rerender(<PlacesOutreachSearchWorkspace initialPlanId="plan-2" />)

    await waitFor(() => expect(screen.getByRole('button', { name: /Search Places/i })).toBeEnabled())
    await user.type(screen.getByLabelText(/Search places/i), 'Oakland bars')
    await user.click(screen.getByRole('button', { name: /Search Places/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/planner/plans/plan-2/discover-venues',
        expect.objectContaining({ method: 'POST' })
      )
    })
    const searchCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/planner/plans/plan-2/discover-venues' && init?.method === 'POST')
    expect(searchCall).toBeDefined()
    expect(JSON.parse(String(searchCall?.[1]?.body))).toEqual({
      query: 'Oakland bars',
      maxResultCount: 8,
    })
  })

  it('uses the canonical fresh photo response and ignores old response names and arbitrary photo URLs', async () => {
    const user = userEvent.setup()
    const candidate = independentDiscoveryResponse.candidates[0]
    const endpoint = `/api/planner/discovery-venues/${candidate.discovery_venue_id}/photo/0`
    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/gmail/account')) return Promise.resolve(jsonResponse({ account: null }))
      if (url.endsWith('/discover-venues') && !init?.method) return Promise.resolve(jsonResponse({ candidates: [], summary: null }))
      if (url === endpoint) return Promise.resolve(jsonResponse({
        entityType: 'discovery_venue', entityId: candidate.discovery_venue_id, index: 0,
        dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
        attribution: { googleMapsUri: 'https://www.google.com/maps/photo/fresh', authorAttributions: [{ displayName: 'Fresh author', uri: '//www.google.com/maps/contrib/fresh' }] },
      }))
      return Promise.resolve(jsonResponse({ ...independentDiscoveryResponse, candidates: [{
        ...candidate, photo_urls: ['https://legacy.example/not-requested.jpg'],
        photos: [{ name: 'places/legacy/photos/old', authorAttributions: [{ displayName: 'Old author' }] }],
      }] }))
    })
    global.fetch = fetchMock
    render(<PlacesOutreachSearchWorkspace initialPlanId="plan-photos" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Search Places/i })).toBeEnabled())
    await user.type(screen.getByLabelText(/Search places/i), 'venue')
    await user.click(screen.getByRole('button', { name: /Search Places/i }))
    await screen.findByText(candidate.name)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: `View photo of ${candidate.name}` }))
    expect(await screen.findByRole('link', { name: 'Fresh author' })).toBeVisible()
    expect(screen.queryByText('Old author')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain('https://legacy.example/not-requested.jpg')
    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({ cache: 'no-store' }))
  })

  it('searches venues, saves organizer-provided email, and creates approval payloads', async () => {
    const user = userEvent.setup()
    const readyResponse = makeReadyDiscoveryResponse()
    let emailSaved = false
    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/integrations/gmail/account') return Promise.resolve(jsonResponse({ account: connectedGmailAccount }))
      if (url === '/api/planner/plans/plan-1/discover-venues' && init?.method === 'POST') return Promise.resolve(jsonResponse(independentDiscoveryResponse))
      if (url === '/api/planner/discovery-venues/22222222-2222-4222-8222-222222222222/contact-email' && init?.method === 'POST') {
        emailSaved = true
        return Promise.resolve(jsonResponse({ venue: { id: '22222222-2222-4222-8222-222222222222' } }))
      }
      if (url === '/api/planner/plans/plan-1/discover-venues' && !init?.method) return Promise.resolve(jsonResponse(emailSaved ? readyResponse : { candidates: [], summary: null }))
      if (url === '/api/planner/plans/plan-1/outreach/approve-batch' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ approvals: [{ approval_id: 'approval-1', target_count: 2, discovery_venue_ids: [], venue_names: [] }], created_count: 1, target_count: 2 }))
      }
      return Promise.resolve(jsonResponse({ error: `Unexpected request: ${url}` }, 500))
    })

    global.fetch = fetchMock

    render(<PlacesOutreachSearchWorkspace initialPlanId="plan-1" />)

    await waitFor(() => expect(screen.getByRole('button', { name: /Search Places/i })).toBeEnabled())
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
      if (url === '/api/planner/plans/plan-1/discover-venues' && init?.method === 'POST') return Promise.resolve(jsonResponse(independentDiscoveryResponse))
      if (url === '/api/planner/plans/plan-1/discover-venues' && !init?.method) return Promise.resolve(jsonResponse({ candidates: [], summary: null }))
      return Promise.resolve(jsonResponse({ error: `Unexpected request: ${url}` }, 500))
    })
    global.fetch = fetchMock

    render(<PlacesOutreachSearchWorkspace initialPlanId="plan-1" />)

    await waitFor(() => expect(screen.getByRole('button', { name: /Search Places/i })).toBeEnabled())
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
    ...independentDiscoveryResponse,
    summary: { total: 2, ready_to_reach_out: 2, contact_form_available: 0, contact_pending: 0, no_contact_available: 0 },
    candidates: independentDiscoveryResponse.candidates.map((candidate) => ({
      ...candidate,
      venue_data: {
        ...candidate.venue_data,
        values: { ...candidate.venue_data.values, contact_email: candidate.contact_email ?? 'events@stable.example' },
        field_provenance: {
          ...candidate.venue_data.field_provenance,
          contact_email: independentVenueEvidence('host_input', 'fixture:host:contact_email'),
        },
      },
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
