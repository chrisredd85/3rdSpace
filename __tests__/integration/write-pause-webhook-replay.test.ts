/**
 * @jest-environment node
 */

jest.mock('server-only', () => ({}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data), {
      ...init,
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json', ...init?.headers },
    }),
  },
}))

jest.mock('@/lib/server/admin-auth', () => ({
  getCronOrAdminContext: jest.fn().mockResolvedValue({
    authorized: true,
    user: { id: 'worker', email: 'worker@internal' },
  }),
}))

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/write-pause', () => {
  const actual = jest.requireActual('@/lib/write-pause')
  return {
    ...actual,
    readWritePauseStatus: jest.fn().mockResolvedValue({
      available: true,
      state: 'draining',
      enabled: true,
      reason: 'Draining deferred webhooks',
      enabledAt: '2026-07-10T20:00:00.000Z',
      updatedAt: '2026-07-10T20:10:00.000Z',
      revision: 2,
    }),
  }
})

import { POST } from '@/app/api/internal/stripe-webhooks/replay-deferred/route'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { STRIPE_WEBHOOK_REPLAY_HEADER } from '@/lib/stripe/webhookReplayAuth'
import { readWritePauseStatus } from '@/lib/write-pause'

describe('deferred Stripe webhook replay', () => {
  const originalSecret = process.env.CRON_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })

  it('replays persisted events only while draining and reports a drained queue', async () => {
    process.env.CRON_SECRET = 'cron-test-secret'
    const rows = [{
      id: 'ledger-1',
      stripe_event_id: 'evt_deferred_1',
      endpoint_path: '/api/webhooks/stripe',
      payload: { id: 'evt_deferred_1', type: 'invoice.paid', data: { object: { id: 'in_1' } } },
    }]
    const loadQuery = {
      eq: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: rows, error: null }),
    }
    const countResult = { count: 0, error: null }
    const countQuery = {
      eq: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      then: (resolve: (value: typeof countResult) => void) => resolve(countResult),
    }
    const from = jest.fn()
      .mockReturnValueOnce({ select: jest.fn().mockReturnValue(loadQuery) })
      .mockReturnValueOnce({ select: jest.fn().mockReturnValue(countQuery) })
    const rpc = jest.fn().mockResolvedValue({
      data: [{ released_count: 0 }],
      error: null,
    })
    ;(createServiceRoleClient as jest.Mock).mockReturnValue({ from, rpc })

    const replayFetch = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ received: true }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))

    const response = await POST(new Request(
      'https://www.3rdplace.io/api/internal/stripe-webhooks/replay-deferred',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer cron-test-secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ limit: 10 }),
      },
    ) as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      attempted: 1,
      replayed: 1,
      released_stale_reservations: 0,
      remaining: 0,
    })
    expect(rpc).toHaveBeenCalledWith('release_stale_stripe_webhook_reservations', {
      p_older_than: '5 minutes',
    })
    expect(replayFetch).toHaveBeenCalledWith(
      new URL('https://www.3rdplace.io/api/webhooks/stripe'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer cron-test-secret',
          [STRIPE_WEBHOOK_REPLAY_HEADER]: '1',
        }),
      }),
    )
    replayFetch.mockRestore()
  })

  it('fails closed before queue selection when stale reservations cannot be reclaimed', async () => {
    process.env.CRON_SECRET = 'cron-test-secret'
    const from = jest.fn()
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'ledger unavailable' },
    })
    ;(createServiceRoleClient as jest.Mock).mockReturnValue({ from, rpc })

    const response = await POST(new Request(
      'https://www.3rdplace.io/api/internal/stripe-webhooks/replay-deferred',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer cron-test-secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ limit: 10 }),
      },
    ) as never)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Failed to reclaim interrupted Stripe webhook replays',
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('refuses replay while paused so only the draining state can execute side effects', async () => {
    process.env.CRON_SECRET = 'cron-test-secret'
    ;(readWritePauseStatus as jest.Mock).mockResolvedValueOnce({
      available: true,
      state: 'paused',
      enabled: true,
      reason: 'Schema migration active',
      enabledAt: '2026-07-10T20:00:00.000Z',
      updatedAt: '2026-07-10T20:01:00.000Z',
      revision: 2,
    })
    const from = jest.fn()
    const rpc = jest.fn()
    ;(createServiceRoleClient as jest.Mock).mockReturnValue({ from, rpc })

    const response = await POST(new Request(
      'https://www.3rdplace.io/api/internal/stripe-webhooks/replay-deferred',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer cron-test-secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ limit: 10 }),
      },
    ) as never)

    expect(response.status).toBe(409)
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})
