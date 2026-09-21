import type { PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { useEvents } from '@/lib/hooks/useEvents'

describe('useEvents planner-materialized analytics visibility', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns canonical planner events from the shared builder events feed', async () => {
    const event = {
      id: 'event-1',
      plan_id: 'plan-1',
      builder_id: 'builder-1',
      title: 'Oakland community dinner',
      description: null,
      event_type: 'community_meetup',
      event_date: '2026-08-20',
      start_time: '18:30:00',
      end_time: '21:30:00',
      starts_at: '2026-08-21T01:30:00.000Z',
      ends_at: '2026-08-21T04:30:00.000Z',
      time_zone: 'America/Los_Angeles',
      expected_attendees: 60,
      status: 'confirmed',
      venue_id: null,
      budget: 5000,
      notes: null,
      created_at: '2026-07-09T12:00:00.000Z',
      updated_at: '2026-07-09T12:00:00.000Z',
    }
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ events: [event] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useEvents('organizer-1'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([expect.objectContaining({
      id: 'event-1',
      plan_id: 'plan-1',
      starts_at: '2026-08-21T01:30:00.000Z',
      time_zone: 'America/Los_Angeles',
    })])
    expect(global.fetch).toHaveBeenCalledWith('/api/builder/events?', { credentials: 'include' })
  })
})
