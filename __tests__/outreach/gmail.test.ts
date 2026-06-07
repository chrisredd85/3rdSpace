import {
  buildGmailOAuthUrl,
  encryptGmailTokenSet,
  getUsableGmailAccessToken,
  listGmailThreadMessages,
  parseGmailOAuthState,
  sendGmailMessage,
} from '@/lib/outreach/gmail'
import { decryptEmailToken } from '@/lib/outreach/crypto'

describe('Gmail outreach helpers', () => {
  const originalEnv = process.env
  const originalFetch = global.fetch

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

  afterEach(() => {
    global.fetch = originalFetch
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('builds a signed Google OAuth URL with send and read scopes', () => {
    const url = new URL(buildGmailOAuthUrl({
      userId: 'builder-user-id',
      returnTo: '/planner/settings/integrations',
    }))

    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.searchParams.get('client_id')).toBe('google-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe('https://www.3rdplace.io/api/integrations/gmail/callback')
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/gmail.send')
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/gmail.readonly')
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/gmail.modify')

    const state = parseGmailOAuthState(url.searchParams.get('state')!)
    expect(state).toEqual({
      userId: 'builder-user-id',
      returnTo: '/planner/settings/integrations',
    })
  })

  it('encrypts Gmail OAuth tokens before storage', () => {
    const encrypted = encryptGmailTokenSet({
      accessToken: 'plain-access-token',
      refreshToken: 'plain-refresh-token',
      expiresInSeconds: 3600,
    })

    expect(encrypted.oauth_access_token).not.toContain('plain-access-token')
    expect(encrypted.oauth_refresh_token).not.toContain('plain-refresh-token')
    expect(decryptEmailToken(encrypted.oauth_access_token)).toBe('plain-access-token')
    expect(decryptEmailToken(encrypted.oauth_refresh_token)).toBe('plain-refresh-token')
    expect(encrypted.token_expires_at).toEqual(expect.any(String))
  })

  it('refreshes expired Gmail access tokens and persists the encrypted replacement', async () => {
    const encrypted = encryptGmailTokenSet({
      accessToken: 'expired-access-token',
      refreshToken: 'stored-refresh-token',
      expiresInSeconds: -60,
    })
    const update = jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    })
    const db = {
      from: jest.fn(() => ({ update })),
    }

    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'fresh-access-token',
      expires_in: 3600,
    }), { status: 200 })) as jest.Mock

    const token = await getUsableGmailAccessToken({
      db,
      account: {
        id: 'gmail-account-id',
        user_id: 'builder-user-id',
        provider: 'gmail',
        email_address: 'creator@example.com',
        oauth_access_token: encrypted.oauth_access_token,
        oauth_refresh_token: encrypted.oauth_refresh_token,
        token_expires_at: encrypted.token_expires_at,
        history_id: null,
        label_id: null,
        revoked_at: null,
        created_at: '2026-06-07T00:00:00.000Z',
      },
    })

    expect(token).toBe('fresh-access-token')
    expect(global.fetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' })
    )
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      oauth_access_token: expect.any(String),
      token_expires_at: expect.any(String),
    }))
  })

  it('sends an approved outreach message through Gmail', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'gmail-message-id',
      threadId: 'gmail-thread-id',
      labelIds: ['SENT'],
    }), { status: 200 })) as jest.Mock

    const result = await sendGmailMessage({
      accessToken: 'access-token',
      from: 'creator@example.com',
      to: 'venue@example.com',
      replyTo: 'creator@example.com',
      subject: 'Event partnership',
      bodyText: 'Approved outreach body',
      bodyHtml: '<p>Approved outreach body</p>',
    })

    expect(result).toEqual({
      gmailMessageId: 'gmail-message-id',
      gmailThreadId: 'gmail-thread-id',
      labelIds: ['SENT'],
    })
    expect(global.fetch).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      })
    )
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.raw).toEqual(expect.any(String))
  })

  it('reads and parses replies from a Gmail thread', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'gmail-thread-id',
      messages: [
        {
          id: 'message-1',
          threadId: 'gmail-thread-id',
          internalDate: '1780843200000',
          payload: {
            headers: [
              { name: 'From', value: 'Venue <venue@example.com>' },
              { name: 'Subject', value: 'Re: Event partnership' },
            ],
            parts: [
              {
                mimeType: 'text/plain',
                body: { data: Buffer.from('Yes, we can host that date.', 'utf8').toString('base64url') },
              },
            ],
          },
        },
      ],
    }), { status: 200 })) as jest.Mock

    const messages = await listGmailThreadMessages({
      accessToken: 'access-token',
      gmailThreadId: 'gmail-thread-id',
    })

    expect(messages).toEqual([
      expect.objectContaining({
        gmailMessageId: 'message-1',
        gmailThreadId: 'gmail-thread-id',
        from: 'Venue <venue@example.com>',
        subject: 'Re: Event partnership',
        bodyText: 'Yes, we can host that date.',
      }),
    ])
  })
})
