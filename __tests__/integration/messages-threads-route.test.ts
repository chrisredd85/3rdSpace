jest.mock('server-only', () => ({}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('@/lib/messages/vendor-messaging', () => ({
  getCurrentMessagingProfile: jest.fn(),
  signAttachments: jest.fn((attachments) => attachments ?? []),
  truncateMessage: jest.fn((message) => message),
}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => {
      const headers = new Headers(init?.headers)
      headers.set('content-type', 'application/json')
      return new Response(JSON.stringify(data), {
        ...init,
        status: init?.status ?? 200,
        headers,
      })
    },
  },
}))

import { GET } from '@/app/api/messages/threads/route'
import { getCurrentMessagingProfile } from '@/lib/messages/vendor-messaging'
import { createClient } from '@/lib/supabase/server'

const mockCreateClient = createClient as jest.Mock
const mockGetCurrentMessagingProfile = getCurrentMessagingProfile as jest.Mock

function makeRequest(path = '/api/messages/threads') {
  return new Request(`http://localhost${path}`)
}

function makeClient(threadResult: { data: unknown[] | null; error: Record<string, unknown> | null }) {
  const query = {
    select: jest.fn(() => query),
    order: jest.fn(() => query),
    eq: jest.fn(() => query),
    then: (resolve: (value: typeof threadResult) => unknown, reject?: (reason: unknown) => unknown) => {
      return Promise.resolve(threadResult).then(resolve, reject)
    },
  }

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      }),
    },
    from: jest.fn(() => query),
  }
}

describe('GET /api/messages/threads', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCurrentMessagingProfile.mockResolvedValue({ type: 'builder', id: 'builder-1' })
  })

  it('returns an empty inbox when the legacy vendor message store is unavailable', async () => {
    mockCreateClient.mockReturnValue(makeClient({
      data: null,
      error: {
        code: 'PGRST205',
        message: "Could not find the table 'public.vendor_message_threads' in the schema cache",
      },
    }))

    const response = await GET(makeRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({ threads: [] })
  })

  it('returns canonical vendor booking threads with normalized last message data', async () => {
    mockCreateClient.mockReturnValue(makeClient({
      data: [
        {
          id: 'thread-1',
          booking_id: 'booking-1',
          vendor_id: 'vendor-1',
          builder_id: 'builder-1',
          subject: 'Booking discussion',
          status: 'active',
          last_message_at: '2026-07-01T10:00:00.000Z',
          created_at: '2026-07-01T08:00:00.000Z',
          updated_at: '2026-07-01T10:00:00.000Z',
          vendor_profiles: {
            id: 'vendor-1',
            name: 'Moongate Lounge',
            user_id: 'vendor-user-1',
          },
          builder_profiles: {
            id: 'builder-1',
            name: 'NSBE',
            user_id: 'builder-user-1',
          },
          vendor_bookings: {
            id: 'booking-1',
            status: 'confirmed',
          },
          vendor_messages: [
            {
              id: 'msg-older',
              thread_id: 'thread-1',
              sender_id: 'builder-user-1',
              sender_type: 'builder',
              message: 'Older message',
              attachments: [],
              read_at: '2026-07-01T09:01:00.000Z',
              created_at: '2026-07-01T09:00:00.000Z',
            },
            {
              id: 'msg-new',
              thread_id: 'thread-1',
              sender_id: 'vendor-user-1',
              sender_type: 'vendor',
              message: 'Latest reply from the vendor',
              attachments: [],
              read_at: null,
              created_at: '2026-07-01T10:00:00.000Z',
            },
          ],
        },
      ],
      error: null,
    }))

    const response = await GET(makeRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.threads).toHaveLength(1)
    expect(json.threads[0]).toMatchObject({
      id: 'thread-1',
      vendor_booking_id: 'booking-1',
      venue_booking_id: null,
      unread_count: 1,
      other_participant: {
        id: 'vendor-user-1',
        name: 'Moongate Lounge',
      },
      last_message: {
        id: 'msg-new',
        content: 'Latest reply from the vendor',
        is_read: false,
        preview: 'Latest reply from the vendor',
      },
    })
  })

  it('still returns a server error for unexpected message query failures', async () => {
    mockCreateClient.mockReturnValue(makeClient({
      data: null,
      error: {
        code: 'XX000',
        message: 'database went away',
      },
    }))

    const response = await GET(makeRequest())
    const json = await response.json()

    expect(response.status).toBe(500)
    expect(json).toEqual({ error: 'database went away' })
  })
})
