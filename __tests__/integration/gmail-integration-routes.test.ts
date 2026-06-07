import type { NextRequest } from 'next/server'
import { GET as connectGet } from '@/app/api/integrations/gmail/connect/route'
import { DELETE as accountDelete, GET as accountGet } from '@/app/api/integrations/gmail/account/route'
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
    redirect: (url: string | URL, init?: ResponseInit | number) => {
      const status = typeof init === 'number' ? init : init?.status ?? 307
      const headers = new Headers(typeof init === 'number' ? undefined : init?.headers)
      headers.set('location', String(url))
      return new Response(null, { status, headers })
    },
  },
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

const mockCreateClient = createClient as jest.Mock

function request(url = 'https://www.3rdplace.io/api/integrations/gmail/connect') {
  const value = new Request(url) as NextRequest
  Object.defineProperty(value, 'nextUrl', { value: new URL(url) })
  return value
}

function authClient(user: unknown, error: unknown = null) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user },
        error,
      }),
    },
  }
}

function makeSelectChain(result: unknown) {
  const chain: Record<string, jest.Mock> = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    is: jest.fn(() => chain),
    order: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    maybeSingle: jest.fn().mockResolvedValue(result),
  }

  return chain
}

function makeUpdateChain(result: unknown) {
  const chain: Record<string, jest.Mock> = {
    update: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    is: jest.fn().mockResolvedValue(result),
  }

  return chain
}

describe('Gmail integration routes', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      GMAIL_OAUTH_REDIRECT_URI: 'https://www.3rdplace.io/api/integrations/gmail/callback',
      GMAIL_OAUTH_STATE_SECRET: 'test-state-secret',
      EMAIL_TOKEN_ENCRYPTION_KEY: 'test-token-key',
    }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('starts Google OAuth for authenticated community builders', async () => {
    mockCreateClient.mockReturnValue(authClient({
      id: 'builder-user-id',
      user_metadata: { user_type: 'community_builder' },
    }))

    const response = await connectGet(request(
      'https://www.3rdplace.io/api/integrations/gmail/connect?returnTo=/planner/settings/integrations'
    ))

    expect(response.status).toBe(307)
    const location = response.headers.get('location')
    expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth?')
    expect(location).toContain('client_id=google-client-id')
    expect(location).toContain('gmail.send')
    expect(location).toContain('gmail.readonly')
    expect(location).toContain('gmail.modify')
  })

  it('rejects unauthenticated OAuth starts', async () => {
    mockCreateClient.mockReturnValue(authClient(null))

    const response = await connectGet(request())
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Not authenticated' })
  })

  it('returns the current active Gmail account without encrypted tokens', async () => {
    const selectChain = makeSelectChain({
      data: {
        id: 'gmail-account-id',
        provider: 'gmail',
        email_address: 'creator@example.com',
        token_expires_at: '2026-06-07T12:00:00.000Z',
        created_at: '2026-06-07T11:00:00.000Z',
        revoked_at: null,
      },
      error: null,
    })

    mockCreateClient.mockReturnValue({
      ...authClient({
        id: 'builder-user-id',
        user_metadata: { user_type: 'community_builder' },
      }),
      from: jest.fn(() => selectChain),
    })

    const response = await accountGet()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.account).toMatchObject({
      id: 'gmail-account-id',
      email_address: 'creator@example.com',
    })
    expect(body.account.oauth_access_token).toBeUndefined()
    expect(body.account.oauth_refresh_token).toBeUndefined()
  })

  it('disconnects the active Gmail account for the signed-in builder', async () => {
    const updateChain = makeUpdateChain({ error: null })
    const from = jest.fn(() => updateChain)
    mockCreateClient.mockReturnValue({
      ...authClient({
        id: 'builder-user-id',
        user_metadata: { user_type: 'community_builder' },
      }),
      from,
    })

    const response = await accountDelete()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ account: null })
    expect(from).toHaveBeenCalledWith('creator_email_accounts')
    expect(updateChain.update).toHaveBeenCalledWith({
      revoked_at: expect.any(String),
    })
    expect(updateChain.eq).toHaveBeenCalledWith('user_id', 'builder-user-id')
  })
})
