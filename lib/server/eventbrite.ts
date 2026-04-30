import { decryptSecret } from '@/lib/server/token-crypto'

export type EventbriteIntegrationRow = {
  id: string
  event_id: string
  external_event_id: string | null
  external_event_url?: string | null
  access_token_encrypted: string | null
  refresh_token_encrypted?: string | null
  sync_status?: string | null
  config?: Record<string, any> | null
}

type EventbriteApiError = Error & { status?: number }

/**
 * Returns the decrypted Eventbrite access token for an integration row.
 */
export function getEventbriteAccessToken(integration: EventbriteIntegrationRow) {
  if (!integration.access_token_encrypted) {
    throw new Error('Eventbrite is not connected for this event yet')
  }

  return decryptSecret(integration.access_token_encrypted)
}

/**
 * Performs an authenticated Eventbrite API request and returns parsed JSON.
 */
export async function eventbriteFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
  query?: Record<string, string | undefined>
) {
  const url = new URL(`https://www.eventbriteapi.com${path}`)

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value)
    })
  }

  console.log(`[eventbrite.api] ${init?.method || 'GET'} ${url.toString()}`)

  const response = await fetch(url.toString(), {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  })

  const data = await response.json().catch(() => null)
  console.log('[eventbrite.api] response status', response.status)

  if (!response.ok) {
    const error = new Error(
      data?.error_description || data?.description || data?.error || 'Eventbrite request failed'
    ) as EventbriteApiError
    error.status = response.status
    throw error
  }

  return data as T
}

/**
 * Fetches a single Eventbrite event by id.
 */
export async function fetchEventbriteEvent(accessToken: string, eventbriteEventId: string) {
  return eventbriteFetch<{
    id: string
    url?: string | null
    status?: string | null
    start?: { utc?: string | null; local?: string | null } | null
    end?: { utc?: string | null; local?: string | null } | null
    name?: { text?: string | null } | null
  }>(`/v3/events/${eventbriteEventId}/`, accessToken)
}

/**
 * Fetches the current user's owned Eventbrite events.
 */
export async function fetchOwnedEventbriteEvents(accessToken: string) {
  return eventbriteFetch<{
    events?: Array<{
      id: string
      name?: { text?: string | null } | null
      start?: { utc?: string | null; local?: string | null } | null
      end?: { utc?: string | null; local?: string | null } | null
      status?: string | null
      url?: string | null
    }>
  }>(
    '/v3/users/me/owned_events/',
    accessToken,
    undefined,
    { expand: 'ticket_classes', status: 'live,started,ended,draft' }
  )
}

/**
 * Fetches a single page of Eventbrite attendees for an event.
 */
export async function fetchEventbriteAttendeePage(
  accessToken: string,
  externalEventId: string,
  continuation?: string
) {
  return eventbriteFetch<{
    attendees?: Array<{
      id: string
      checked_in?: boolean | null
      checked_in_at?: string | null
      ticket_class_name?: string | null
      order_id?: string | null
      profile?: {
        first_name?: string | null
        last_name?: string | null
        email?: string | null
      } | null
    }>
    pagination?: {
      has_more_items?: boolean
      continuation?: string | null
    } | null
  }>(
    `/v3/events/${externalEventId}/attendees/`,
    accessToken,
    undefined,
    continuation ? { status: 'attending', continuation } : { status: 'attending' }
  )
}

/**
 * Turns Eventbrite API errors into user-facing messages.
 */
export function getEventbriteErrorMessage(error: unknown) {
  const status = typeof error === 'object' && error && 'status' in error ? (error as EventbriteApiError).status : undefined

  if (status === 401) return 'Token expired, please reconnect Eventbrite'
  if (status === 404) return 'Eventbrite event not found'
  if (status === 429) return 'Rate limited, try again in a few minutes'
  return 'Failed to connect to Eventbrite'
}
