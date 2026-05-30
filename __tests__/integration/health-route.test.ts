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

import { GET } from '@/app/api/health/route'
import { createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))

const createServiceRoleClientMock = createServiceRoleClient as jest.Mock

const ORIGINAL_ENV = process.env

function mockSupabasePing(error: unknown = null) {
  const limit = jest.fn().mockResolvedValue({ error })
  const select = jest.fn(() => ({ limit }))
  const from = jest.fn(() => ({ select }))

  createServiceRoleClientMock.mockReturnValue({ from })

  return { from, select, limit }
}

describe('health route', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
      STRIPE_SECRET_KEY: 'sk_test_health',
      RESEND_API_KEY: 're_health',
    }
    jest.clearAllMocks()
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('returns status, timestamp, version, and ok dependency checks', async () => {
    const supabase = mockSupabasePing()

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      status: 'ok',
      timestamp: expect.any(String),
      version: expect.any(String),
      checks: {
        database: 'ok',
        stripe: 'ok',
        resend: 'ok',
      },
    })
    expect(supabase.from).toHaveBeenCalledWith('plans')
    expect(supabase.select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(supabase.limit).toHaveBeenCalledWith(1)
  })

  it('keeps the endpoint healthy while reporting dependency errors', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.RESEND_API_KEY

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.checks).toEqual({
      database: 'error',
      stripe: 'error',
      resend: 'error',
    })
    expect(createServiceRoleClientMock).not.toHaveBeenCalled()
  })

  it('reports a database error when the ping fails', async () => {
    mockSupabasePing({ message: 'database unavailable' })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.checks).toEqual({
      database: 'error',
      stripe: 'ok',
      resend: 'ok',
    })
  })
})
