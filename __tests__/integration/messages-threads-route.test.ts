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
