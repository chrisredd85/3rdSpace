import { DELETE as accountDelete } from '@/app/api/integrations/gmail/account/route'
import { encryptEmailToken } from '@/lib/outreach/crypto'
import { createClient } from '@/lib/supabase/server'
import * as Sentry from '@sentry/nextjs'

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

jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

const mockCreateClient = createClient as jest.Mock
const mockCaptureMessage = Sentry.captureMessage as jest.Mock
const originalEnv = process.env
const originalFetch = global.fetch

function authClient() {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: {
          user: {
            id: 'builder-user-id',
            user_metadata: { user_type: 'community_builder' },
          },
        },
        error: null,
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

function setupDeleteRoute(refreshTokenValue: string) {
  const selectChain = makeSelectChain({
    data: {
      id: 'gmail-account-id',
      oauth_refresh_token: refreshTokenValue,
    },
    error: null,
  })
  const updateChain = makeUpdateChain({ error: null })
  const from = jest.fn()
    .mockReturnValueOnce(selectChain)
    .mockReturnValueOnce(updateChain)

  mockCreateClient.mockReturnValue({
    ...authClient(),
    from,
  })

  return { from, selectChain, updateChain }
}

describe('Gmail account revoke route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      EMAIL_TOKEN_ENCRYPTION_KEY: 'test-token-key',
    }
    global.fetch = originalFetch
  })

  afterAll(() => {
    process.env = originalEnv
    global.fetch = originalFetch
  })

  it('revokes the Google refresh token and marks the local account revoked', async () => {
    const { updateChain } = setupDeleteRoute(encryptEmailToken('refresh-token'))
    global.fetch = jest.fn().mockResolvedValue(new Response('', { status: 200 })) as jest.Mock

    const response = await accountDelete()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ account: null })
    expect(global.fetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      expect.objectContaining({
        method: 'POST',
        body: 'token=refresh-token',
      })
    )
    expect(updateChain.update).toHaveBeenCalledWith({ revoked_at: expect.any(String) })
  })

  it('logs Google revoke failures and still disconnects locally', async () => {
    const { updateChain } = setupDeleteRoute(encryptEmailToken('refresh-token'))
    global.fetch = jest.fn().mockResolvedValue(new Response('bad token', { status: 400 })) as jest.Mock

    const response = await accountDelete()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ account: null })
    expect(mockCaptureMessage).toHaveBeenCalledWith('gmail_revoke_failure', expect.objectContaining({
      level: 'warning',
      extra: expect.objectContaining({
        user_id: 'builder-user-id',
        action: 'gmail_revoke_failure',
        status_code: 400,
      }),
    }))
    expect(updateChain.update).toHaveBeenCalledWith({ revoked_at: expect.any(String) })
  })

  it('fails loudly on token decrypt failure and does not update the local account', async () => {
    const { updateChain } = setupDeleteRoute('not-an-encrypted-token')
    global.fetch = jest.fn().mockResolvedValue(new Response('', { status: 200 })) as jest.Mock

    const response = await accountDelete()
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Failed to decrypt Gmail connection' })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(updateChain.update).not.toHaveBeenCalled()
  })
})
