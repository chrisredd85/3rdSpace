import { render, screen, waitFor } from '@testing-library/react'
import PlannerAnalyticsPage from '@/app/(planner)/planner/analytics/page'
import { useEvent, useEvents } from '@/lib/hooks/useEvents'

const requestedEventId = '22222222-2222-4222-8222-222222222222'
let mockSearchParams = `eventId=${requestedEventId}`

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearchParams),
}))

jest.mock('@/lib/hooks/useUser', () => ({
  useUser: () => ({
    user: { id: '11111111-1111-4111-8111-111111111111' },
    isLoading: false,
    error: null,
  }),
}))

jest.mock('@/lib/hooks/useEvents', () => ({
  useEvents: jest.fn(),
  useEvent: jest.fn(),
}))

jest.mock('@/components/planner/PlannerOutcomeCard', () => ({
  PlannerOutcomeCard: () => null,
}))

const mockUseEvents = useEvents as jest.Mock
const mockUseEvent = useEvent as jest.Mock

describe('planner analytics event deep link', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = `eventId=${requestedEventId}`
    mockUseEvents.mockReturnValue({
      data: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          title: 'Newest owned event',
          event_date: '2026-08-20',
        },
        {
          id: requestedEventId,
          title: 'Requested owned event',
          event_date: '2026-07-20',
        },
      ],
      isLoading: false,
    })
    mockUseEvent.mockImplementation((eventId: string | null) => ({
      data: eventId ? { id: eventId, title: 'Requested owned event' } : null,
      isLoading: false,
    }))
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/financials')) return jsonResponse({})
      if (url.includes('/post-event/report')) {
        return jsonResponse({
          summary: {
            events_count: 1,
            rsvps_or_imported_attendees: 0,
            checked_in: 0,
            no_show_rate: null,
            tickets_sold: 0,
            tickets_refunded: 0,
            gross_revenue_cents: 0,
            refund_amount_cents: 0,
            net_revenue_cents: 0,
            average_ticket_price_cents: 0,
            peak_arrival_hour: null,
            venue_foot_traffic_proxy: 0,
            source_confidence: 'no_data',
          },
          arrival_buckets: [],
          tier_velocity: [],
          events: [],
          post_event_questions: [],
        })
      }
      if (url.includes('/ticketing/analytics')) {
        return jsonResponse({
          summary: {
            tickets_sold: 0,
            tickets_refunded: 0,
            gross_revenue_cents: 0,
            fees_cents: 0,
            net_revenue_cents: 0,
            average_ticket_price_cents: 0,
          },
          rollups: [],
          events: [],
        })
      }
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    }) as jest.Mock
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('selects the exact owned event from eventId instead of the newest event', async () => {
    render(<PlannerAnalyticsPage />)

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Select event' })).toHaveValue(requestedEventId)
    })
    expect(mockUseEvent).toHaveBeenLastCalledWith(requestedEventId)
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/events/${requestedEventId}/financials`,
        expect.objectContaining({ credentials: 'include' })
      )
    })
  })

  it('does not select an eventId outside the owned event feed', async () => {
    const unownedEventId = '99999999-9999-4999-8999-999999999999'
    mockSearchParams = `eventId=${unownedEventId}`
    mockUseEvent.mockImplementation((eventId: string | null) => ({
      data: eventId && eventId !== unownedEventId
        ? { id: eventId, title: 'Newest owned event' }
        : null,
      isLoading: false,
    }))

    render(<PlannerAnalyticsPage />)

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Select event' })).toHaveValue(
        '33333333-3333-4333-8333-333333333333'
      )
    })
    expect(mockUseEvent).toHaveBeenCalledWith(unownedEventId)
  })

  it('loads an older owned deep link even when it is outside the paginated event feed', async () => {
    mockUseEvents.mockReturnValue({
      data: [{
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Newest owned event',
        event_date: '2026-08-20',
      }],
      isLoading: false,
    })
    mockUseEvent.mockImplementation((eventId: string | null) => ({
      data: eventId === requestedEventId
        ? {
            id: requestedEventId,
            title: 'Older requested owned event',
            event_date: '2025-01-20',
          }
        : eventId
          ? { id: eventId, title: 'Newest owned event', event_date: '2026-08-20' }
          : null,
      isLoading: false,
    }))

    render(<PlannerAnalyticsPage />)

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Select event' })).toHaveValue(requestedEventId)
    })
    expect(screen.getByRole('option', { name: /Older requested owned event/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/events/${requestedEventId}/financials`,
        expect.objectContaining({ credentials: 'include' }),
      )
    })
  })
})

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }))
}
