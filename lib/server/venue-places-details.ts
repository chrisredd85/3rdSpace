import 'server-only'

import { canonicalGooglePlaceId, GOOGLE_VENUE_PRO_FIELDS, parseVenuePlace, type VenuePlaceCandidate } from './google-places-client'
import { isGoogleVenueEnabled } from './google-places-flags'

export const GOOGLE_VENUE_DETAILS_PRO_FIELD_MASK = GOOGLE_VENUE_PRO_FIELDS.join(',')
export const GOOGLE_VENUE_DETAILS_ENTERPRISE_FIELD_MASK = [
  ...GOOGLE_VENUE_PRO_FIELDS, 'websiteUri', 'nationalPhoneNumber', 'rating', 'userRatingCount', 'priceLevel',
].join(',')
export const VENUE_DETAILS_DEADLINE_MS = 20_000

export type VenueDetailsResult = {
  status: 'available' | 'disabled' | 'invalid_id' | 'unavailable' | 'closed' | 'identity_mismatch' | 'deadline' | 'failed'
  place_id: string | null
  profile: 'pro' | 'enterprise'
  attempts: number
  place?: VenuePlaceCandidate
}

export type VenueDetailsContext = {
  deadline: number
  now: () => number
  sleep: (ms: number) => Promise<void>
  fetchImpl: typeof fetch
  /** Request-local only. Never place this context in a module or durable cache. */
  requests: Map<string, Promise<VenueDetailsResult>>
}

export function createVenueDetailsContext(options: {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  fetchImpl?: typeof fetch
  deadlineMs?: number
} = {}): VenueDetailsContext {
  const now = options.now ?? Date.now
  return {
    now,
    deadline: now() + Math.min(VENUE_DETAILS_DEADLINE_MS, Math.max(0, options.deadlineMs ?? VENUE_DETAILS_DEADLINE_MS)),
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    fetchImpl: options.fetchImpl ?? fetch,
    requests: new Map(),
  }
}

export function getVenueDetails(input: {
  placeId: string
  apiKey?: string
  profile?: 'pro' | 'enterprise'
  context?: VenueDetailsContext
}): Promise<VenueDetailsResult> {
  const profile = input.profile ?? 'enterprise'
  const placeId = canonicalGooglePlaceId(input.placeId)
  const base = { place_id: placeId, profile, attempts: 0 }
  if (!isGoogleVenueEnabled()) return Promise.resolve({ ...base, status: 'disabled' })
  if (!placeId) return Promise.resolve({ ...base, status: 'invalid_id' })
  const apiKey = input.apiKey ?? process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey?.trim()) return Promise.resolve({ ...base, status: 'unavailable' })
  const context = input.context ?? createVenueDetailsContext()
  const key = `${profile}:${placeId}`
  const existing = context.requests.get(key)
  if (existing) return existing
  const pending = retrieve(placeId, apiKey, profile, context)
  context.requests.set(key, pending)
  return pending
}

async function retrieve(placeId: string, apiKey: string, profile: 'pro' | 'enterprise', context: VenueDetailsContext): Promise<VenueDetailsResult> {
  let attempts = 0
  const result = (status: VenueDetailsResult['status'], place?: VenuePlaceCandidate): VenueDetailsResult => ({ status, place_id: placeId, profile, attempts, ...(place ? { place } : {}) })
  while (attempts < 2) {
    const remaining = context.deadline - context.now()
    if (remaining <= 0) return result('deadline')
    attempts += 1
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const response = await Promise.race([
        (async () => {
          const response = await context.fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
            method: 'GET', cache: 'no-store', signal: controller.signal,
            headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': profile === 'enterprise' ? GOOGLE_VENUE_DETAILS_ENTERPRISE_FIELD_MASK : GOOGLE_VENUE_DETAILS_PRO_FIELD_MASK },
          })
          // Never read or propagate a provider error body.
          return { response, payload: response.ok ? await response.json() as unknown : null }
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('venue_details_deadline')) }, remaining)
        }),
      ])
      if (timer) clearTimeout(timer)
      if (context.now() >= context.deadline) return result('deadline')
      if (response.response.ok) {
        const place = parseVenuePlace(response.payload, profile)
        if (!place || place.id !== placeId) return result('identity_mismatch')
        if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') return result('closed')
        return result('available', place)
      }
      const status = response.response.status
      if (status === 404 || status === 410) return result('unavailable')
      const transient = status === 429 || status >= 500
      if (!transient || attempts >= 2) return result('failed')
      const delay = retryDelay(response.response.headers.get('Retry-After'), context.now())
      if (delay >= context.deadline - context.now()) return result('deadline')
      await context.sleep(delay)
    } catch (error) {
      if (timer) clearTimeout(timer)
      if (context.now() >= context.deadline || (error instanceof Error && error.message === 'venue_details_deadline')) return result('deadline')
      const transient = error instanceof TypeError || (error instanceof Error && (error.name === 'AbortError' || /network|fetch failed|timeout/i.test(error.message)))
      if (!transient || attempts >= 2) return result('failed')
      if (200 >= context.deadline - context.now()) return result('deadline')
      await context.sleep(200)
    }
  }
  return result('failed')
}

function retryDelay(header: string | null, now: number): number {
  if (!header) return 200
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - now) : 200
}

/** Caller may use this website as a navigation pointer, never as a saved fact. */
export async function getVenueContactDetails(placeId: string): Promise<{ websiteUri?: string; nationalPhoneNumber?: string } | null> {
  const result = await getVenueDetails({ placeId })
  if (result.status !== 'available' || !result.place) return null
  return { websiteUri: result.place.websiteUri, nationalPhoneNumber: result.place.nationalPhoneNumber }
}
