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
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/server/job-queue', () => ({
  enqueueJob: jest.fn(),
}))

import { createHmac } from 'crypto'
import { POST } from '@/app/api/webhooks/eventbrite/route'
import { EventbriteClient, verifyEventbriteWebhookSignature } from '@/lib/integrations/eventbrite/client'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { enqueueJob } from '@/lib/server/job-queue'
import { encryptSecret } from '@/lib/server/token-crypto'

const BUILDER_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222'
const WEBHOOK_SECRET = 'eventbrite-webhook-secret'

describe('Eventbrite OAuth and webhooks', () => {
  const originalClientId = process.env.EVENTBRITE_CLIENT_ID
  const originalClientSecret = process.env.EVENTBRITE_CLIENT_SECRET
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  beforeEach(() => {
    process.env.EVENTBRITE_CLIENT_ID = 'eventbrite-client-id'
    process.env.EVENTBRITE_CLIENT_SECRET = 'eventbrite-client-secret'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-tests'
  })

  afterEach(() => {
    restoreEnv('EVENTBRITE_CLIENT_ID', originalClientId)
    restoreEnv('EVENTBRITE_CLIENT_SECRET', originalClientSecret)
    restoreEnv('NEXT_PUBLIC_SUPABASE_URL', originalSupabaseUrl)
    restoreEnv('SUPABASE_SERVICE_ROLE_KEY', originalServiceRoleKey)
    jest.clearAllMocks()
  })

  it('refreshes the Eventbrite token on a 401 and retries the original request', async () => {
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://www.eventbrite.com/oauth/token') {
        return jsonResponse({
          access_token: 'fresh-access-token',
          refresh_token: 'fresh-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
        })
      }

      const authHeader = new Headers(init?.headers).get('Authorization')
      if (authHeader === 'Bearer expired-access-token') {
        return jsonResponse({ error: 'expired' }, 401)
      }

      if (url === 'https://www.eventbriteapi.com/v3/users/me/organizations/') {
        return jsonResponse({
          organizations: [{ id: 'eventbrite-org-1', name: 'Backfill Org' }],
          pagination: { has_more_items: false },
        })
      }

      return jsonResponse({
        events: [{ id: 'eventbrite-event-1', name: { text: 'Backfill Night' } }],
        pagination: { has_more_items: false },
      })
    }) as jest.MockedFunction<typeof fetch>
    const onRefresh = jest.fn()
    const client = new EventbriteClient({
      accessToken: 'expired-access-token',
      refreshToken: 'refresh-token',
      fetchImpl,
      onRefresh,
    })

    const result = await client.listOwnedEvents()

    expect(result.events?.[0]?.id).toBe('eventbrite-event-1')
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(onRefresh).toHaveBeenCalledWith(expect.objectContaining({
      access_token: 'fresh-access-token',
      refresh_token: 'fresh-refresh-token',
    }))
    expect(new Headers(fetchImpl.mock.calls[2][1]?.headers).get('Authorization')).toBe('Bearer fresh-access-token')
    expect(fetchImpl.mock.calls[3][0]).toContain('/v3/organizations/eventbrite-org-1/events/')
    expect(new Headers(fetchImpl.mock.calls[3][1]?.headers).get('Authorization')).toBe('Bearer fresh-access-token')
  })

  it('lists owned Eventbrite events through organizations before using the legacy endpoint', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url === 'https://www.eventbriteapi.com/v3/users/me/organizations/') {
        return jsonResponse({
          organizations: [{ id: 'eventbrite-org-1', name: 'Backfill Org' }],
          pagination: { has_more_items: false },
        })
      }

      if (url.startsWith('https://www.eventbriteapi.com/v3/organizations/eventbrite-org-1/events/')) {
        return jsonResponse({
          events: [{ id: 'eventbrite-event-1', name: { text: 'Backfill Night' } }],
          pagination: { has_more_items: false },
        })
      }

      return jsonResponse({ error: 'unexpected endpoint' }, 500)
    }) as jest.MockedFunction<typeof fetch>
    const client = new EventbriteClient({
      accessToken: 'access-token',
      fetchImpl,
    })

    const result = await client.listOwnedEvents()

    expect(result.events).toEqual([
      expect.objectContaining({ id: 'eventbrite-event-1' }),
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1][0]).toContain('/v3/organizations/eventbrite-org-1/events/')
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/v3/users/me/owned_events/'))).toBe(false)
  })

  it('retries organization event listing without page_size when Eventbrite rejects it', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url === 'https://www.eventbriteapi.com/v3/users/me/organizations/') {
        return jsonResponse({
          organizations: [{ id: 'eventbrite-org-1', name: 'Backfill Org' }],
          pagination: { has_more_items: false },
        })
      }

      if (url.startsWith('https://www.eventbriteapi.com/v3/organizations/eventbrite-org-1/events/')) {
        const requestUrl = new URL(url)
        if (requestUrl.searchParams.has('page_size')) {
          return jsonResponse({
            status_code: 400,
            error_description: 'There are errors with your arguments: page_size - Unknown parameter',
            error: 'ARGUMENTS_ERROR',
          }, 400)
        }

        return jsonResponse({
          events: [{ id: 'eventbrite-event-1', name: { text: 'Backfill Night' } }],
          pagination: { has_more_items: false },
        })
      }

      return jsonResponse({ error: 'unexpected endpoint' }, 500)
    }) as jest.MockedFunction<typeof fetch>
    const client = new EventbriteClient({
      accessToken: 'access-token',
      fetchImpl,
    })

    const result = await client.listOwnedEvents()

    expect(result.events).toEqual([
      expect.objectContaining({ id: 'eventbrite-event-1' }),
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(String(fetchImpl.mock.calls[1][0])).toContain('page_size=50')
    expect(String(fetchImpl.mock.calls[2][0])).not.toContain('page_size=')
    expect(String(fetchImpl.mock.calls[2][0])).toContain('order_by=start_desc')
  })

  it('paginates Eventbrite organization event lists instead of returning only the first page', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url === 'https://www.eventbriteapi.com/v3/users/me/organizations/') {
        return jsonResponse({
          organizations: [{ id: 'eventbrite-org-1', name: 'Backfill Org' }],
          pagination: { has_more_items: false },
        })
      }

      if (url.startsWith('https://www.eventbriteapi.com/v3/organizations/eventbrite-org-1/events/')) {
        const requestUrl = new URL(url)
        if (!requestUrl.searchParams.has('continuation')) {
          return jsonResponse({
            events: Array.from({ length: 50 }, (_, index) => ({
              id: `eventbrite-event-${index + 1}`,
              name: { text: `Event ${index + 1}` },
            })),
            pagination: { has_more_items: true, continuation: 'page-2' },
          })
        }

        return jsonResponse({
          events: [
            { id: 'eventbrite-event-51', name: { text: 'Event 51' } },
            { id: 'eventbrite-event-52', name: { text: 'Event 52' } },
          ],
          pagination: { has_more_items: false },
        })
      }

      return jsonResponse({ error: 'unexpected endpoint' }, 500)
    }) as jest.MockedFunction<typeof fetch>
    const client = new EventbriteClient({
      accessToken: 'access-token',
      fetchImpl,
    })

    const result = await client.listOwnedEvents()

    expect(result.events).toHaveLength(52)
    expect(result.events?.at(-1)).toEqual(expect.objectContaining({ id: 'eventbrite-event-52' }))
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(String(fetchImpl.mock.calls[2][0])).toContain('continuation=page-2')
  })

  it('falls back to the legacy owned events endpoint when organizations are unavailable', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url === 'https://www.eventbriteapi.com/v3/users/me/organizations/') {
        return jsonResponse({ error: 'NOT_AUTHORIZED' }, 403)
      }

      if (url.startsWith('https://www.eventbriteapi.com/v3/users/me/owned_events/')) {
        return jsonResponse({
          events: [{ id: 'legacy-event-1', name: { text: 'Legacy Event' } }],
          pagination: { has_more_items: false },
        })
      }

      return jsonResponse({ error: 'unexpected endpoint' }, 500)
    }) as jest.MockedFunction<typeof fetch>
    const client = new EventbriteClient({
      accessToken: 'access-token',
      fetchImpl,
    })

    const result = await client.listOwnedEvents()

    expect(result.events).toEqual([
      expect.objectContaining({ id: 'legacy-event-1' }),
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1][0]).toContain('/v3/users/me/owned_events/')
  })

  it('accepts only a valid HMAC signature for Eventbrite webhook payloads', () => {
    const rawBody = JSON.stringify({ api_url: 'https://www.eventbriteapi.com/v3/orders/123/' })
    const signature = createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')

    expect(verifyEventbriteWebhookSignature(WEBHOOK_SECRET, rawBody, `sha256=${signature}`)).toBe(true)
    expect(verifyEventbriteWebhookSignature(WEBHOOK_SECRET, rawBody, 'sha256=forged')).toBe(false)
  })

  it('rejects a forged Eventbrite webhook before writing or enqueueing', async () => {
    const db = new MemoryDb()
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)

    const response = await POST(makeWebhookRequest('sha256=forged'))

    expect(response.status).toBe(401)
    expect(db.rows.event_webhook_events).toHaveLength(0)
    expect(enqueueJob).not.toHaveBeenCalled()
  })
})

function makeWebhookRequest(signature: string) {
  const payload = {
    action: 'order.placed',
    api_url: 'https://www.eventbriteapi.com/v3/orders/123/',
  }

  return {
    text: jest.fn().mockResolvedValue(JSON.stringify(payload)),
    headers: new Headers({
      'x-eventbrite-signature': signature,
      'x-eventbrite-webhook-id': 'webhook-delivery-1',
      'x-forwarded-for': '127.0.0.1',
    }),
    nextUrl: new URL(`http://localhost:3000/api/webhooks/eventbrite?connection=${CONNECTION_ID}`),
  } as never
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

type Row = Record<string, any>

class MemoryDb {
  rows: Record<string, Row[]>

  constructor() {
    this.rows = {
      builder_ticketing_connections: [{
        id: CONNECTION_ID,
        builder_id: BUILDER_ID,
        platform: 'eventbrite',
        status: 'connected',
        access_token_encrypted: encryptSecret('access-token'),
        refresh_token_encrypted: encryptSecret('refresh-token'),
        webhook_secret_encrypted: encryptSecret(WEBHOOK_SECRET),
        webhook_url: `https://www.3rdplace.io/api/webhooks/eventbrite?connection=${CONNECTION_ID}`,
        config: {},
        last_connected_at: '2026-06-02T17:00:00.000Z',
        last_error: null,
        last_webhook_received_at: null,
        last_webhook_event_type: null,
      }],
      event_webhook_events: [],
    }
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery {
  private filters: Array<(row: Row) => boolean> = []

  constructor(private db: MemoryDb, private table: string) {}

  select() {
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value)
    return this
  }

  async maybeSingle() {
    return { data: this.db.rows[this.table].find((row) => this.filters.every((filter) => filter(row))) ?? null, error: null }
  }
}
