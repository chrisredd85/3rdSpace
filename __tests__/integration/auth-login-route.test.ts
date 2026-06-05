import type { NextRequest } from 'next/server'
import { POST as postLogin } from '@/app/api/auth/login/route'
import { createClient } from '@/lib/supabase/server'

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

jest.mock('@/lib/server/account-setup', () => ({
  getOnboardingStatus: jest.fn(),
}))

const mockCreateClient = createClient as jest.Mock
const mockSignInWithPassword = jest.fn()

describe('POST /api/auth/login', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockCreateClient.mockReturnValue({
      auth: {
        signInWithPassword: mockSignInWithPassword,
      },
    })
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns the account-not-found copy for invalid credentials', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    })

    const response = await postLogin(makeRequest({
      email: 'missing@example.com',
      password: 'not-the-password',
      expectedUserType: 'community_builder',
    }))
    const json = await response.json()

    expect(response.status).toBe(401)
    expect(json).toEqual({ error: 'No account with that information has been found' })
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}
