import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlacesOutreachSearchWorkspace } from '@/components/planner/PlacesOutreachSearchWorkspace'

const discoveryResponse = {
  summary: {
    total: 2,
    ready_to_reach_out: 1,
    contact_pending: 1,
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
      contact_status: 'contact_pending',
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

describe('PlacesOutreachSearchWorkspace', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('searches venues, saves organizer-provided email, and creates approval payloads', async () => {
    const user = userEvent.setup()
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(jsonResponse(discoveryResponse))
      .mockResolvedValueOnce(jsonResponse({ venue: { id: '22222222-2222-4222-8222-222222222222' } }))
      .mockResolvedValueOnce(jsonResponse({
        ...discoveryResponse,
        summary: { total: 2, ready_to_reach_out: 2, contact_pending: 0, no_contact_available: 0 },
        candidates: discoveryResponse.candidates.map((candidate) => candidate.name === 'Stable Cafe'
          ? {
              ...candidate,
              contact_email: 'events@stable.example',
              contact_email_source: 'organizer_provided',
              contact_email_confidence: 'high',
              contact_status: 'ready_to_reach_out',
            }
          : candidate),
      }))
      .mockResolvedValueOnce(jsonResponse({ approvals: [], created_count: 2 }))
      .mockResolvedValueOnce(jsonResponse({
        ...discoveryResponse,
        summary: { total: 2, ready_to_reach_out: 2, contact_pending: 0, no_contact_available: 0 },
        candidates: discoveryResponse.candidates.map((candidate) => ({
          ...candidate,
          contact_email: candidate.contact_email ?? 'events@stable.example',
          contact_status: 'ready_to_reach_out',
        })),
      }))

    global.fetch = fetchMock

    render(<PlacesOutreachSearchWorkspace initialPlanId="plan-1" />)

    await user.type(screen.getByLabelText(/Search phrase/i), 'happy hour bars in Mission')
    await user.click(screen.getByRole('button', { name: /Search Places/i }))

    expect(await screen.findByText('Moongate Lounge')).toBeInTheDocument()
    expect(screen.getByText('Stable Cafe')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('Needs contact')).toBeInTheDocument()

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

    await user.click(await screen.findByRole('button', { name: /Create 2 approvals/i }))

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
})

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
