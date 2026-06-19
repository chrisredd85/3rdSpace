import 'server-only'

export const GOOGLE_PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'

export const GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.primaryType',
  'places.types',
  'places.location',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.businessStatus',
  'places.photos',
].join(',')

const REQUEST_INTERVAL_MS = 1000
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_RESULTS = 8
const MAX_RETRIES = 2
const BAY_AREA_CENTER = { latitude: 37.7749, longitude: -122.4194 }
const BAY_AREA_RADIUS_METERS = 32_000

let nextRequestAt = 0

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export type GooglePlacesIncludedType = 'bar' | 'restaurant' | 'cafe' | 'event_venue' | 'night_club'

export type GooglePlacesSearchInput = {
  apiKey: string
  textQuery: string
  eventType?: string | null
  neighborhood?: string | null
  city?: string | null
  maxResultCount?: number
  fetchImpl?: FetchLike
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  timeoutMs?: number
}

export type PlacesRectangle = {
  low: {
    latitude: number
    longitude: number
  }
  high: {
    latitude: number
    longitude: number
  }
}

export type GooglePlacesTextSearchRequest = {
  textQuery: string
  includedType?: GooglePlacesIncludedType
  strictTypeFiltering?: boolean
  maxResultCount: number
  rankPreference?: 'DISTANCE' | 'RELEVANCE'
  languageCode: 'en'
  regionCode: 'US'
  includePureServiceAreaBusinesses: false
  locationRestriction?: {
    rectangle: PlacesRectangle
  }
  locationBias?: {
    circle: {
      center: {
        latitude: number
        longitude: number
      }
      radius: number
    }
  }
}

export type GooglePlacesSearchResult = {
  places: GooglePlaceCandidate[]
  request: GooglePlacesTextSearchRequest
}

export type GooglePlaceCandidate = {
  id: string
  displayName: {
    text: string
    languageCode?: string
  }
  formattedAddress?: string
  primaryType?: string
  types?: string[]
  location?: {
    latitude?: number
    longitude?: number
  }
  websiteUri?: string
  nationalPhoneNumber?: string
  rating?: number
  userRatingCount?: number
  priceLevel?: string
  businessStatus?: string
  photos?: GooglePlacePhoto[]
}

export type GooglePlacePhoto = {
  name: string
  heightPx?: number
  widthPx?: number
  authorAttributions?: Array<{
    displayName?: string
    uri?: string
  }>
}

type SearchGeography = {
  key: string
  label: string
  city: string
  aliases: string[]
  center: {
    latitude: number
    longitude: number
  }
  rectangle: PlacesRectangle
}

const SEARCH_GEOGRAPHIES: SearchGeography[] = [
  {
    key: 'mission',
    label: 'Mission',
    city: 'San Francisco',
    aliases: ['mission', 'mission district'],
    center: { latitude: 37.7599, longitude: -122.4148 },
    rectangle: rectangle(37.748, -122.434, 37.7705, -122.4),
  },
  {
    key: 'hayes_valley',
    label: 'Hayes Valley',
    city: 'San Francisco',
    aliases: ['hayes valley', 'hayes'],
    center: { latitude: 37.7767, longitude: -122.4243 },
    rectangle: rectangle(37.7715, -122.437, 37.7835, -122.414),
  },
  {
    key: 'soma',
    label: 'SOMA',
    city: 'San Francisco',
    aliases: ['soma', 'south of market'],
    center: { latitude: 37.7804, longitude: -122.3986 },
    rectangle: rectangle(37.768, -122.412, 37.792, -122.384),
  },
  {
    key: 'castro',
    label: 'Castro',
    city: 'San Francisco',
    aliases: ['castro'],
    center: { latitude: 37.7609, longitude: -122.435 },
    rectangle: rectangle(37.754, -122.447, 37.7685, -122.425),
  },
  {
    key: 'marina',
    label: 'Marina',
    city: 'San Francisco',
    aliases: ['marina'],
    center: { latitude: 37.8021, longitude: -122.4364 },
    rectangle: rectangle(37.796, -122.45, 37.8075, -122.425),
  },
  {
    key: 'fillmore',
    label: 'Fillmore',
    city: 'San Francisco',
    aliases: ['fillmore', 'lower pacific heights'],
    center: { latitude: 37.7858, longitude: -122.433 },
    rectangle: rectangle(37.778, -122.443, 37.792, -122.426),
  },
  {
    key: 'north_beach',
    label: 'North Beach',
    city: 'San Francisco',
    aliases: ['north beach'],
    center: { latitude: 37.8036, longitude: -122.4103 },
    rectangle: rectangle(37.795, -122.414, 37.8075, -122.398),
  },
  {
    key: 'outer_sunset',
    label: 'Outer Sunset',
    city: 'San Francisco',
    aliases: ['outer sunset', 'sunset'],
    center: { latitude: 37.7581, longitude: -122.4868 },
    rectangle: rectangle(37.75, -122.51, 37.767, -122.475),
  },
  {
    key: 'downtown_berkeley',
    label: 'Downtown Berkeley',
    city: 'Berkeley',
    aliases: ['downtown berkeley', 'berkeley downtown', 'berkeley'],
    center: { latitude: 37.8702, longitude: -122.2681 },
    rectangle: rectangle(37.865, -122.2765, 37.8765, -122.258),
  },
  {
    key: 'uptown_oakland',
    label: 'Uptown Oakland',
    city: 'Oakland',
    aliases: ['uptown oakland', 'uptown'],
    center: { latitude: 37.8122, longitude: -122.2686 },
    rectangle: rectangle(37.805, -122.278, 37.817, -122.258),
  },
  {
    key: 'san_francisco',
    label: 'San Francisco',
    city: 'San Francisco',
    aliases: ['sf', 'san francisco', 'the city'],
    center: { latitude: 37.7749, longitude: -122.4194 },
    rectangle: rectangle(37.708, -122.515, 37.812, -122.356),
  },
  {
    key: 'oakland',
    label: 'Oakland',
    city: 'Oakland',
    aliases: ['oakland'],
    center: { latitude: 37.8044, longitude: -122.2712 },
    rectangle: rectangle(37.739, -122.32, 37.85, -122.214),
  },
  {
    key: 'berkeley',
    label: 'Berkeley',
    city: 'Berkeley',
    aliases: ['berkeley'],
    center: { latitude: 37.8715, longitude: -122.273 },
    rectangle: rectangle(37.846, -122.315, 37.899, -122.235),
  },
]

/**
 * Searches Google Places Text Search (New) for physical venue candidates.
 *
 * The caller must pass the API key at route entry time. This keeps env
 * validation local to the feature and avoids global app boot failures.
 */
export async function searchGooglePlacesText(input: GooglePlacesSearchInput): Promise<GooglePlacesSearchResult> {
  if (!input.apiKey || input.apiKey.trim().length === 0) {
    throw new GooglePlacesConfigurationError('GOOGLE_PLACES_API_KEY is not configured')
  }

  const request = buildGooglePlacesTextSearchRequest(input)
  const fetchImpl = input.fetchImpl ?? fetch
  const sleep = input.sleep ?? defaultSleep
  const now = input.now ?? Date.now
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS

  await waitForRateLimit({ now, sleep })

  let lastError: Error | null = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchImpl, GOOGLE_PLACES_TEXT_SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': input.apiKey,
          'X-Goog-FieldMask': GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK,
        },
        body: JSON.stringify(request),
      }, timeoutMs)

      if (response.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(200 * 2 ** attempt)
        continue
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new GooglePlacesApiError(response.status, body || response.statusText)
      }

      const payload = await response.json()
      const places = readPlaces(payload).filter((place) => !place.businessStatus || place.businessStatus === 'OPERATIONAL')
      return { places, request }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Google Places search failed')
      if (attempt < MAX_RETRIES && isRetryableError(lastError)) {
        await sleep(200 * 2 ** attempt)
        continue
      }
      throw lastError
    }
  }

  throw lastError ?? new Error('Google Places search failed')
}

export function buildGooglePlacesTextSearchRequest(input: {
  textQuery: string
  eventType?: string | null
  neighborhood?: string | null
  city?: string | null
  maxResultCount?: number
}): GooglePlacesTextSearchRequest {
  const textQuery = input.textQuery.trim()
  const maxResultCount = clampResultCount(input.maxResultCount)
  const includedType = mapPlannerIntentToGooglePlaceType(input.eventType, textQuery)
  const geography = resolveSearchGeography(input.neighborhood, input.city)

  const request: GooglePlacesTextSearchRequest = {
    textQuery,
    maxResultCount,
    languageCode: 'en',
    regionCode: 'US',
    includePureServiceAreaBusinesses: false,
  }

  if (includedType) {
    request.includedType = includedType
    request.strictTypeFiltering = true
    request.rankPreference = geography ? 'DISTANCE' : 'RELEVANCE'
  }

  if (geography) {
    request.locationRestriction = { rectangle: geography.rectangle }
    request.rankPreference = 'DISTANCE'
  } else if (textQuery.toLowerCase().includes('bay area')) {
    request.locationBias = {
      circle: {
        center: BAY_AREA_CENTER,
        radius: BAY_AREA_RADIUS_METERS,
      },
    }
  }

  return request
}

export function resolveSearchGeography(neighborhood?: string | null, city?: string | null): SearchGeography | null {
  const candidates = [neighborhood, city].map(normalizeSearchText).filter(Boolean)
  for (const candidate of candidates) {
    const match = SEARCH_GEOGRAPHIES.find((geography) =>
      geography.key === candidate ||
      normalizeSearchText(geography.label) === candidate ||
      geography.aliases.some((alias) => normalizeSearchText(alias) === candidate)
    )
    if (match) return match
  }

  return null
}

export function mapPlannerIntentToGooglePlaceType(
  eventType?: string | null,
  query?: string | null
): GooglePlacesIncludedType | undefined {
  const text = normalizeSearchText(`${eventType ?? ''} ${query ?? ''}`)
  if (!text) return undefined
  if (/\b(bar|bars|pub|pubs|lounge|lounges|wine|cocktail|happy hour)\b/.test(text)) return 'bar'
  if (/\b(cafe|cafes|coffee)\b/.test(text)) return 'cafe'
  if (/\b(nightclub|night club|club)\b/.test(text)) return 'night_club'
  if (/\b(event venue|event space|venue|gallery|hall)\b/.test(text)) return 'event_venue'
  if (/\b(dinner|restaurant|restaurants|dining|private dining|food|brunch|lunch)\b/.test(text)) return 'restaurant'
  if (/\b(mixer|meetup|networking|workshop|panel|speaker|offsite)\b/.test(text)) return 'bar'
  return undefined
}

export function clearGooglePlacesRateLimit() {
  nextRequestAt = 0
}

export class GooglePlacesConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GooglePlacesConfigurationError'
  }
}

export class GooglePlacesApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`Google Places API error ${status}: ${message}`)
    this.name = 'GooglePlacesApiError'
  }
}

async function waitForRateLimit(input: {
  now: () => number
  sleep: (ms: number) => Promise<void>
}) {
  const now = input.now()
  const waitMs = Math.max(0, nextRequestAt - now)
  if (waitMs > 0) await input.sleep(waitMs)
  nextRequestAt = Math.max(nextRequestAt, input.now()) + REQUEST_INTERVAL_MS
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function readPlaces(payload: unknown): GooglePlaceCandidate[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const places = (payload as { places?: unknown }).places
  if (!Array.isArray(places)) return []

  return places
    .map((place): GooglePlaceCandidate | null => {
      if (!place || typeof place !== 'object' || Array.isArray(place)) return null
      const record = place as Record<string, unknown>
      const id = readString(record.id)
      const displayName = readDisplayName(record.displayName)
      if (!id || !displayName) return null
      return {
        id,
        displayName,
        formattedAddress: readString(record.formattedAddress) ?? undefined,
        primaryType: readString(record.primaryType) ?? undefined,
        types: readStringArray(record.types),
        location: readLocation(record.location),
        websiteUri: readString(record.websiteUri) ?? undefined,
        nationalPhoneNumber: readString(record.nationalPhoneNumber) ?? undefined,
        rating: readNumber(record.rating) ?? undefined,
        userRatingCount: readNumber(record.userRatingCount) ?? undefined,
        priceLevel: readString(record.priceLevel) ?? undefined,
        businessStatus: readString(record.businessStatus) ?? undefined,
        photos: readPhotos(record.photos),
      }
    })
    .filter((place): place is GooglePlaceCandidate => Boolean(place))
}

function readPhotos(value: unknown): GooglePlacePhoto[] | undefined {
  if (!Array.isArray(value)) return undefined
  const photos = value.flatMap((photo): GooglePlacePhoto[] => {
    if (!photo || typeof photo !== 'object' || Array.isArray(photo)) return []
    const record = photo as Record<string, unknown>
    const name = readString(record.name)
    if (!name) return []
    return [{
      name,
      heightPx: readNumber(record.heightPx) ?? undefined,
      widthPx: readNumber(record.widthPx) ?? undefined,
      authorAttributions: readAuthorAttributions(record.authorAttributions),
    }]
  })
  return photos.length > 0 ? photos : undefined
}

function readAuthorAttributions(value: unknown): GooglePlacePhoto['authorAttributions'] {
  if (!Array.isArray(value)) return undefined
  const attributions = value.flatMap((attribution): NonNullable<GooglePlacePhoto['authorAttributions']> => {
    if (!attribution || typeof attribution !== 'object' || Array.isArray(attribution)) return []
    const record = attribution as Record<string, unknown>
    const displayName = readString(record.displayName)
    const uri = readString(record.uri)
    if (!displayName && !uri) return []
    return [{ displayName: displayName ?? undefined, uri: uri ?? undefined }]
  })
  return attributions.length > 0 ? attributions : undefined
}

function readDisplayName(value: unknown): GooglePlaceCandidate['displayName'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const text = readString(record.text)
  if (!text) return null
  return {
    text,
    languageCode: readString(record.languageCode) ?? undefined,
  }
}

function readLocation(value: unknown): GooglePlaceCandidate['location'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const latitude = readNumber(record.latitude)
  const longitude = readNumber(record.longitude)
  if (latitude == null || longitude == null) return undefined
  return { latitude, longitude }
}

function isRetryableError(error: Error) {
  if (error.name === 'AbortError') return true
  if (error instanceof GooglePlacesApiError) return error.status >= 500
  return /fetch failed|network|timeout/i.test(error.message)
}

function clampResultCount(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_MAX_RESULTS
  return Math.min(Math.max(Math.trunc(value ?? DEFAULT_MAX_RESULTS), 1), 20)
}

function normalizeSearchText(value?: string | null) {
  return (value ?? '').toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((item) => readString(item)).filter((item): item is string => Boolean(item))
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function rectangle(lowLatitude: number, lowLongitude: number, highLatitude: number, highLongitude: number): PlacesRectangle {
  return {
    low: { latitude: lowLatitude, longitude: lowLongitude },
    high: { latitude: highLatitude, longitude: highLongitude },
  }
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
