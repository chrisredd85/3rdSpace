import 'server-only'

import { createHmac, timingSafeEqual } from 'crypto'

export type EventbriteTokenSet = {
  access_token: string
  refresh_token?: string | null
  token_type?: string | null
  expires_in?: number | null
  scope?: string | null
}

export type EventbriteMoney = {
  display?: string | null
  currency?: string | null
  value?: number | null
  major_value?: string | number | null
  minor_value?: number | string | null
}

export type EventbriteEvent = {
  id: string
  name?: { text?: string | null; html?: string | null } | null
  description?: { text?: string | null; html?: string | null } | null
  url?: string | null
  status?: string | null
  start?: { utc?: string | null; local?: string | null; timezone?: string | null } | null
  end?: { utc?: string | null; local?: string | null; timezone?: string | null } | null
  capacity?: number | null
  online_event?: boolean | null
  venue_id?: string | null
  organizer_id?: string | null
  ticket_classes?: Array<{ id?: string | null; name?: string | null; cost?: EventbriteMoney | null }> | null
  venue?: {
    id?: string | null
    name?: string | null
    address?: Record<string, unknown> | null
  } | null
}

export type EventbriteOrganization = {
  id: string
  name?: string | null
}

export type EventbriteAttendee = {
  id: string
  event_id?: string | null
  order_id?: string | null
  ticket_class_id?: string | null
  ticket_class_name?: string | null
  checked_in?: boolean | null
  checked_in_at?: string | null
  created?: string | null
  changed?: string | null
  status?: string | null
  cancelled?: boolean | null
  canceled?: boolean | null
  refunded?: boolean | null
  voided?: boolean | null
  cancelled_at?: string | null
  canceled_at?: string | null
  refunded_at?: string | null
  check_in_method?: string | null
  profile?: {
    first_name?: string | null
    last_name?: string | null
    email?: string | null
    name?: string | null
  } | null
  costs?: {
    base_price?: EventbriteMoney | null
    gross?: EventbriteMoney | null
    eventbrite_fee?: EventbriteMoney | null
    payment_fee?: EventbriteMoney | null
    tax?: EventbriteMoney | null
  } | null
}

export type EventbriteOrder = {
  id: string
  event_id?: string | null
  name?: string | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  status?: string | null
  created?: string | null
  changed?: string | null
  costs?: {
    base_price?: EventbriteMoney | null
    gross?: EventbriteMoney | null
    eventbrite_fee?: EventbriteMoney | null
    payment_fee?: EventbriteMoney | null
    tax?: EventbriteMoney | null
  } | null
  attendees?: EventbriteAttendee[] | null
}

type EventbriteApiError = Error & {
  status?: number
  body?: unknown
}

type ClientOptions = {
  accessToken: string
  refreshToken?: string | null
  onRefresh?: (tokens: EventbriteTokenSet) => Promise<void>
  fetchImpl?: typeof fetch
}

const EVENTBRITE_API_ORIGIN = 'https://www.eventbriteapi.com'
const EVENTBRITE_OAUTH_TOKEN_URL = 'https://www.eventbrite.com/oauth/token'

export const EVENTBRITE_DEFAULT_SCOPES = 'event_read order_read attendee_read'

export function buildEventbriteAuthorizeUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  scope?: string
}) {
  const url = new URL('https://www.eventbrite.com/oauth/authorize')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', input.state)
  url.searchParams.set('scope', input.scope ?? EVENTBRITE_DEFAULT_SCOPES)
  return url.toString()
}

export async function exchangeEventbriteCode(input: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
  fetchImpl?: typeof fetch
}) {
  return postEventbriteToken({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    fetchImpl: input.fetchImpl,
    params: {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
    },
  })
}

export async function refreshEventbriteToken(input: {
  refreshToken: string
  clientId: string
  clientSecret: string
  fetchImpl?: typeof fetch
}) {
  return postEventbriteToken({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    fetchImpl: input.fetchImpl,
    params: {
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
    },
  })
}

export class EventbriteClient {
  private accessToken: string
  private refreshToken: string | null
  private readonly onRefresh?: (tokens: EventbriteTokenSet) => Promise<void>
  private readonly fetchImpl: typeof fetch

  constructor(options: ClientOptions) {
    this.accessToken = options.accessToken
    this.refreshToken = options.refreshToken ?? null
    this.onRefresh = options.onRefresh
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async listOwnedEvents() {
    const query = {
      page_size: '10',
      order_by: 'start_desc',
      status: 'live,started,ended,draft',
      expand: 'ticket_classes,venue',
    }

    try {
      // Eventbrite's organizations endpoint rejects page_size in production.
      const organizations = await this.request<{
        organizations?: EventbriteOrganization[]
        pagination?: EventbritePagination | null
      }>('/v3/users/me/organizations/')
      const organizationIds = (organizations.organizations ?? [])
        .map((organization) => organization.id)
        .filter(Boolean)
        .slice(0, 5)

      if (organizationIds.length > 0) {
        const eventPages = await Promise.all(
          organizationIds.map((organizationId) =>
            this.requestWithQueryParamRetry<{
              events?: EventbriteEvent[]
              pagination?: EventbritePagination | null
            }>(`/v3/organizations/${encodeURIComponent(organizationId)}/events/`, query, 'page_size')
          )
        )

        return {
          events: eventPages.flatMap((page) => page.events ?? []).slice(0, 10),
          pagination: {
            has_more_items: eventPages.some((page) => Boolean(page.pagination?.has_more_items)),
          },
        }
      }
    } catch (error) {
      if (!shouldFallbackToOwnedEvents(error)) throw error
    }

    return this.requestWithQueryParamRetry<{
      events?: EventbriteEvent[]
      pagination?: EventbritePagination | null
    }>('/v3/users/me/owned_events/', query, 'page_size')
  }

  getEvent(eventId: string) {
    return this.request<EventbriteEvent>(`/v3/events/${encodeURIComponent(eventId)}/`, {
      expand: 'ticket_classes,venue',
    })
  }

  listEventOrders(eventId: string, continuation?: string | null) {
    return this.request<{
      orders?: EventbriteOrder[]
      pagination?: EventbritePagination | null
    }>(`/v3/events/${encodeURIComponent(eventId)}/orders/`, {
      expand: 'attendees',
      page_size: '200',
      status: 'all_not_deleted',
      ...(continuation ? { continuation } : {}),
    })
  }

  getOrderByApiUrl(apiUrl: string) {
    return this.requestUrl<EventbriteOrder>(apiUrl, { expand: 'attendees' })
  }

  getAttendeeByApiUrl(apiUrl: string) {
    return this.requestUrl<EventbriteAttendee>(apiUrl)
  }

  private async request<T>(path: string, query?: Record<string, string | undefined>, retry = true): Promise<T> {
    const url = new URL(path, EVENTBRITE_API_ORIGIN)
    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value)
    })
    return this.fetchJson<T>(url, retry)
  }

  private async requestWithQueryParamRetry<T>(
    path: string,
    query: Record<string, string | undefined>,
    rejectedParam: string
  ): Promise<T> {
    try {
      return await this.request<T>(path, query)
    } catch (error) {
      if (!isRejectedQueryParameter(error, rejectedParam)) throw error
      const fallbackQuery = { ...query }
      delete fallbackQuery[rejectedParam]
      return this.request<T>(path, fallbackQuery)
    }
  }

  private async requestUrl<T>(apiUrl: string, query?: Record<string, string | undefined>, retry = true): Promise<T> {
    const url = new URL(apiUrl)
    if (url.origin !== EVENTBRITE_API_ORIGIN) {
      throw new Error('Unsupported Eventbrite API URL')
    }
    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (value && !url.searchParams.has(key)) url.searchParams.set(key, value)
    })
    return this.fetchJson<T>(url, retry)
  }

  private async fetchJson<T>(url: URL, retry: boolean): Promise<T> {
    const response = await this.fetchImpl(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
      cache: 'no-store',
    })
    const data = await response.json().catch(() => null)

    if (response.status === 401 && retry && this.refreshToken) {
      const refreshed = await refreshEventbriteToken({
        refreshToken: this.refreshToken,
        clientId: requiredEventbriteEnv('EVENTBRITE_CLIENT_ID'),
        clientSecret: requiredEventbriteEnv('EVENTBRITE_CLIENT_SECRET'),
        fetchImpl: this.fetchImpl,
      })
      this.accessToken = refreshed.access_token
      this.refreshToken = refreshed.refresh_token ?? this.refreshToken
      await this.onRefresh?.(refreshed)
      return this.fetchJson<T>(url, false)
    }

    if (!response.ok) {
      const error = new Error(
        readErrorMessage(data) ?? `Eventbrite request failed with status ${response.status}`
      ) as EventbriteApiError
      error.status = response.status
      error.body = data
      throw error
    }

    return data as T
  }
}

export type EventbritePagination = {
  has_more_items?: boolean | null
  continuation?: string | null
}

export function verifyEventbriteWebhookSignature(secret: string, rawBody: string, signatureHeader: string | null) {
  if (!signatureHeader) return false

  const digest = createHmac('sha256', secret).update(rawBody).digest()
  const expectedHex = digest.toString('hex')
  const expectedBase64 = digest.toString('base64')
  const candidates = [
    expectedHex,
    `sha256=${expectedHex}`,
    expectedBase64,
    `sha256=${expectedBase64}`,
  ]

  return candidates.some((candidate) => safeCompare(candidate, signatureHeader.trim()))
}

export function tokenExpiresAt(tokens: EventbriteTokenSet) {
  const expiresInSeconds = typeof tokens.expires_in === 'number' && Number.isFinite(tokens.expires_in)
    ? tokens.expires_in
    : 365 * 24 * 60 * 60
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString()
}

export function requiredEventbriteEnv(name: 'EVENTBRITE_CLIENT_ID' | 'EVENTBRITE_CLIENT_SECRET') {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

async function postEventbriteToken(input: {
  clientId: string
  clientSecret: string
  params: Record<string, string>
  fetchImpl?: typeof fetch
}) {
  const response = await (input.fetchImpl ?? fetch)(EVENTBRITE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      ...input.params,
    }).toString(),
    cache: 'no-store',
  })
  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const error = new Error(readErrorMessage(data) ?? 'Eventbrite token request failed') as EventbriteApiError
    error.status = response.status
    error.body = data
    throw error
  }

  return data as EventbriteTokenSet
}

function readErrorMessage(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  for (const key of ['error_description', 'description', 'error', 'message']) {
    const message = record[key]
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return null
}

function shouldFallbackToOwnedEvents(error: unknown) {
  const status = typeof error === 'object' && error && 'status' in error ? (error as EventbriteApiError).status : undefined
  return status === 403 || status === 404
}

function isRejectedQueryParameter(error: unknown, parameterName: string) {
  const eventbriteError = typeof error === 'object' && error ? error as EventbriteApiError : null
  if (eventbriteError?.status !== 400) return false
  const message = [
    readErrorMessage(eventbriteError.body),
    eventbriteError.message,
  ].filter(Boolean).join(' ').toLowerCase()

  return message.includes(parameterName.toLowerCase()) && (
    message.includes('unknown parameter') || message.includes('errors with your arguments')
  )
}

function safeCompare(expected: string, actual: string) {
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
}
