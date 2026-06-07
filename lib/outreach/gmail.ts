import 'server-only'

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { decryptEmailToken, encryptEmailToken } from '@/lib/outreach/crypto'
import type { Database } from '@/lib/types/database-generated'

type CreatorEmailAccount = Database['public']['Tables']['creator_email_accounts']['Row']

type OAuthTokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

type GmailProfileResponse = {
  emailAddress?: string
  historyId?: string
}

type GmailSendResponse = {
  id?: string
  threadId?: string
  labelIds?: string[]
}

export type GmailHeader = {
  name?: string
  value?: string
}

export type GmailMessage = {
  id?: string
  threadId?: string
  internalDate?: string
  payload?: {
    mimeType?: string
    headers?: GmailHeader[]
    body?: {
      data?: string
    }
    parts?: Array<GmailMessage['payload']>
  }
}

type GmailThreadResponse = {
  id?: string
  messages?: GmailMessage[]
}

export type ParsedGmailMessage = {
  gmailMessageId: string
  gmailThreadId: string
  subject: string
  bodyText: string
  bodyHtml: string | null
  headers: Record<string, string>
  receivedAt: string
  from: string | null
}

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
] as const

export function buildGmailOAuthUrl(input: {
  userId: string
  returnTo?: string | null
}) {
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    redirect_uri: getGmailRedirectUri(),
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: signGmailOAuthState({
      userId: input.userId,
      returnTo: input.returnTo ?? '/planner/settings/integrations',
      nonce: randomBytes(16).toString('hex'),
      issuedAt: Date.now(),
    }),
  })

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeGmailCode(code: string) {
  const response = await postGoogleToken({
    code,
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    redirect_uri: getGmailRedirectUri(),
    grant_type: 'authorization_code',
  })

  if (!response.access_token || !response.refresh_token) {
    throw new Error('Google OAuth did not return both access and refresh tokens')
  }

  return response
}

export async function refreshGmailAccessToken(refreshToken: string) {
  const response = await postGoogleToken({
    refresh_token: refreshToken,
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    grant_type: 'refresh_token',
  })

  if (!response.access_token) {
    throw new Error('Google OAuth did not return a refreshed access token')
  }

  return response
}

export async function loadGmailProfile(accessToken: string) {
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  })

  const payload = await readJson<GmailProfileResponse>(response)
  if (!response.ok) throw new Error(readGoogleError(payload, 'Failed to load Gmail profile'))
  if (!payload.emailAddress) throw new Error('Gmail profile did not include an email address')

  return {
    emailAddress: payload.emailAddress,
    historyId: payload.historyId ?? null,
  }
}

export function encryptGmailTokenSet(tokenSet: {
  accessToken: string
  refreshToken: string
  expiresInSeconds?: number | null
}) {
  return {
    oauth_access_token: encryptEmailToken(tokenSet.accessToken),
    oauth_refresh_token: encryptEmailToken(tokenSet.refreshToken),
    token_expires_at: tokenSet.expiresInSeconds
      ? new Date(Date.now() + tokenSet.expiresInSeconds * 1000).toISOString()
      : null,
  }
}

export async function getUsableGmailAccessToken(input: {
  db: { from(table: string): any }
  account: CreatorEmailAccount
}) {
  const expiresAt = input.account.token_expires_at ? Date.parse(input.account.token_expires_at) : 0
  const shouldRefresh = !expiresAt || expiresAt - Date.now() < 60_000

  if (!shouldRefresh) return decryptEmailToken(input.account.oauth_access_token)

  const refreshToken = decryptEmailToken(input.account.oauth_refresh_token)
  const refreshed = await refreshGmailAccessToken(refreshToken)
  const encrypted = encryptGmailTokenSet({
    accessToken: refreshed.access_token!,
    refreshToken,
    expiresInSeconds: refreshed.expires_in,
  })

  const { error } = await input.db
    .from('creator_email_accounts')
    .update({
      oauth_access_token: encrypted.oauth_access_token,
      token_expires_at: encrypted.token_expires_at,
    })
    .eq('id', input.account.id)

  if (error) throw new Error(`Failed to update refreshed Gmail token: ${error.message}`)

  return refreshed.access_token!
}

export async function sendGmailMessage(input: {
  accessToken: string
  from: string
  to: string
  replyTo: string
  subject: string
  bodyText: string
  bodyHtml?: string | null
  gmailThreadId?: string | null
}) {
  const raw = encodeBase64Url(buildMimeMessage(input))
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw,
      ...(input.gmailThreadId ? { threadId: input.gmailThreadId } : {}),
    }),
  })

  const payload = await readJson<GmailSendResponse>(response)
  if (!response.ok) throw new Error(readGoogleError(payload, 'Gmail rejected the outbound message'))
  if (!payload.id || !payload.threadId) throw new Error('Gmail send response was missing message or thread id')

  return {
    gmailMessageId: payload.id,
    gmailThreadId: payload.threadId,
    labelIds: payload.labelIds ?? [],
  }
}

export async function listGmailThreadMessages(input: {
  accessToken: string
  gmailThreadId: string
}) {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(input.gmailThreadId)}?format=full`,
    {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
      cache: 'no-store',
    }
  )

  const payload = await readJson<GmailThreadResponse>(response)
  if (!response.ok) throw new Error(readGoogleError(payload, 'Failed to load Gmail thread'))

  return (payload.messages ?? [])
    .map(parseGmailMessage)
    .filter((message): message is ParsedGmailMessage => Boolean(message))
}

export function parseGmailOAuthState(value: string) {
  const [encoded, signature] = value.split('.')
  if (!encoded || !signature) throw new Error('Invalid Gmail OAuth state')

  const expected = signStatePayload(encoded)
  if (!timingSafeEqualString(signature, expected)) throw new Error('Invalid Gmail OAuth state signature')

  const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
    userId?: unknown
    returnTo?: unknown
    issuedAt?: unknown
  }

  if (typeof parsed.userId !== 'string') throw new Error('Invalid Gmail OAuth state user')
  if (typeof parsed.issuedAt !== 'number' || Date.now() - parsed.issuedAt > 15 * 60 * 1000) {
    throw new Error('Expired Gmail OAuth state')
  }

  return {
    userId: parsed.userId,
    returnTo: typeof parsed.returnTo === 'string' ? parsed.returnTo : '/planner/settings/integrations',
  }
}

function signGmailOAuthState(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encoded}.${signStatePayload(encoded)}`
}

function signStatePayload(encoded: string) {
  return createHmac('sha256', getOAuthStateSecret()).update(encoded).digest('base64url')
}

function getOAuthStateSecret() {
  const secret = process.env.GMAIL_OAUTH_STATE_SECRET || process.env.EMAIL_TOKEN_ENCRYPTION_KEY
  if (!secret) throw new Error('GMAIL_OAUTH_STATE_SECRET or EMAIL_TOKEN_ENCRYPTION_KEY is required')
  return secret
}

function timingSafeEqualString(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

async function postGoogleToken(body: Record<string, string>) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  })

  const payload = await readJson<OAuthTokenResponse>(response)
  if (!response.ok) throw new Error(readGoogleError(payload, 'Google OAuth token request failed'))
  return payload
}

function buildMimeMessage(input: {
  from: string
  to: string
  replyTo: string
  subject: string
  bodyText: string
  bodyHtml?: string | null
}) {
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Reply-To: ${input.replyTo}`,
    `Subject: ${encodeMimeHeader(input.subject)}`,
    'MIME-Version: 1.0',
  ]

  if (!input.bodyHtml) {
    return [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      input.bodyText,
    ].join('\r\n')
  }

  const boundary = `3rdplace-${randomBytes(12).toString('hex')}`
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.bodyText,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.bodyHtml,
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

function encodeMimeHeader(value: string) {
  if (/^[\x00-\x7F]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function parseGmailMessage(message: GmailMessage): ParsedGmailMessage | null {
  if (!message.id || !message.threadId) return null
  const headers = Object.fromEntries(
    (message.payload?.headers ?? [])
      .filter((header) => header.name && header.value)
      .map((header) => [String(header.name).toLowerCase(), String(header.value)])
  )
  const bodyText = extractPart(message.payload, 'text/plain') ?? ''
  const bodyHtml = extractPart(message.payload, 'text/html')
  const internalDateMs = Number(message.internalDate)
  const receivedAt = Number.isFinite(internalDateMs)
    ? new Date(internalDateMs).toISOString()
    : new Date().toISOString()

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    subject: headers.subject ?? '(no subject)',
    bodyText: bodyText || stripHtml(bodyHtml ?? ''),
    bodyHtml,
    headers,
    receivedAt,
    from: headers.from ?? null,
  }
}

function extractPart(part: GmailMessage['payload'], mimeType: string): string | null {
  if (!part) return null
  if (part.mimeType === mimeType && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8')
  }

  for (const child of part.parts ?? []) {
    const value = extractPart(child, mimeType)
    if (value) return value
  }

  return null
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    return { error_description: text } as T
  }
}

function readGoogleError(payload: Record<string, unknown>, fallback: string) {
  return typeof payload.error_description === 'string'
    ? payload.error_description
    : typeof payload.error === 'string'
      ? payload.error
      : fallback
}

function getGoogleClientId() {
  const value = process.env.GOOGLE_CLIENT_ID
  if (!value) throw new Error('GOOGLE_CLIENT_ID is required')
  return value
}

function getGoogleClientSecret() {
  const value = process.env.GOOGLE_CLIENT_SECRET
  if (!value) throw new Error('GOOGLE_CLIENT_SECRET is required')
  return value
}

function getGmailRedirectUri() {
  if (process.env.GMAIL_OAUTH_REDIRECT_URI) return process.env.GMAIL_OAUTH_REDIRECT_URI
  return `${getAppUrl()}/api/integrations/gmail/callback`
}

function getAppUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  ).replace(/\/$/, '')
}
