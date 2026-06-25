jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(() => ({ from: jest.fn() })),
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

jest.mock('@/lib/finance/chi-rate-trueup', () => ({
  logChiTrueupDailySummary: jest.fn(),
}))

import { GET } from '@/app/api/cron/chi-trueup/summary/route'
import { logChiTrueupDailySummary } from '@/lib/finance/chi-rate-trueup'

const mockLogSummary = logChiTrueupDailySummary as jest.Mock

describe('GET /api/cron/chi-trueup/summary', () => {
  const originalSecret = process.env.CRON_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
  })

  afterAll(() => {
    process.env.CRON_SECRET = originalSecret
  })

  it('rejects requests without the cron authorization header', async () => {
    const response = await GET(makeRequest(null))

    expect(response.status).toBe(401)
    expect(mockLogSummary).not.toHaveBeenCalled()
  })

  it('logs the daily summary for authorized cron requests', async () => {
    mockLogSummary.mockResolvedValue({
      trueup_runs_last_24h: 3,
      applied_last_24h: 2,
      queued_for_review_last_24h: 1,
      mean_movement_pct: 0.04,
      max_movement_pct: 0.22,
    })

    const response = await GET(makeRequest('cron-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      summary: {
        trueup_runs_last_24h: 3,
        applied_last_24h: 2,
        queued_for_review_last_24h: 1,
        mean_movement_pct: 0.04,
        max_movement_pct: 0.22,
      },
    })
    expect(mockLogSummary).toHaveBeenCalledTimes(1)
  })
})

function makeRequest(secret: string | null) {
  return {
    headers: new Headers(secret ? { authorization: `Bearer ${secret}` } : {}),
  } as never
}
