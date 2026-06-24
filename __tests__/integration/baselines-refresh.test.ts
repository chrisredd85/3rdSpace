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

import { GET } from '@/app/api/cron/baselines/refresh/route'
import { createServiceRoleClient } from '@/lib/supabase/server'

describe('GET /api/cron/baselines/refresh', () => {
  const originalSecret = process.env.CRON_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret
  })

  it('rejects requests without the cron bearer secret', async () => {
    const response = await GET(makeRequest(null))

    expect(response.status).toBe(401)
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('refreshes projection baselines through the database RPC', async () => {
    const rpc = jest.fn().mockReturnValue({
      maybeSingle: jest.fn().mockResolvedValue({
        data: { organizer_rows: 3, archetype_rows: 7 },
        error: null,
      }),
    })
    ;(createServiceRoleClient as jest.Mock).mockReturnValue({ rpc })

    const response = await GET(makeRequest('cron-secret'))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('refresh_projection_baselines')
    expect(json).toMatchObject({
      ok: true,
      organizer_rows: 3,
      archetype_rows: 7,
    })
    expect(json.duration_ms).toEqual(expect.any(Number))
  })
})

function makeRequest(secret: string | null) {
  return {
    headers: new Headers(secret ? { authorization: `Bearer ${secret}` } : {}),
  } as never
}
