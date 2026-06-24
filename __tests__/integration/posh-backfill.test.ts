jest.mock('server-only', () => ({}))

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

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('@/lib/supabase/server-helpers', () => ({
  getBuilderProfileId: jest.fn(),
}))

jest.mock('@/lib/integrations/poshLink', () => ({
  loadPoshConnectionState: jest.fn(),
}))

import { GET, POST } from '@/app/api/integrations/posh/backfill/route'
import { loadPoshConnectionState } from '@/lib/integrations/poshLink'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

describe('/api/integrations/posh/backfill', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1', user_metadata: { user_type: 'community_builder' } } },
          error: null,
        }),
      },
      from: jest.fn(),
    })
    ;(getBuilderProfileId as jest.Mock).mockResolvedValue({
      builderProfileId: 'builder-1',
      error: null,
    })
    ;(loadPoshConnectionState as jest.Mock).mockResolvedValue({
      status: 'connected',
      webhookUrl: 'https://www.3rdplace.io/api/webhooks/posh?integration=builder-1',
      lastEventReceivedAt: '2026-06-24T12:00:00.000Z',
      lastWebhookEventType: 'new_order',
      unlinkedEvents: [],
      events: [],
    })
  })

  it('reports that historical Posh pull is unavailable with the current webhook integration', async () => {
    const response = await POST()
    const json = await response.json()

    expect(response.status).toBe(501)
    expect(loadPoshConnectionState).toHaveBeenCalled()
    expect(json).toMatchObject({
      historical_data_available: false,
      status: 'connected',
      connection: {
        status: 'connected',
        last_event_received_at: '2026-06-24T12:00:00.000Z',
      },
    })
    expect(json.message).toMatch(/Historical sales import is not available/i)
  })

  it('uses the same status payload for GET', async () => {
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(501)
    expect(json.historical_data_available).toBe(false)
  })
})
