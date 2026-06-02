import 'server-only'

import type { Json } from '@/lib/types'

type DiscoveryDb = { from(table: string): any }

type DiscoveryVenueEnrichmentRow = {
  id: string
  name: string
  address: string | null
  source: string
  source_external_id: string | null
  metadata: Json | null
}

type GooglePlaceDetails = {
  id?: string
  displayName?: { text?: string | null } | null
  formattedAddress?: string | null
  location?: { latitude?: number | null; longitude?: number | null } | null
  internationalPhoneNumber?: string | null
  nationalPhoneNumber?: string | null
  websiteUri?: string | null
  rating?: number | null
  userRatingCount?: number | null
  regularOpeningHours?: unknown
  photos?: Array<{ name?: string | null }> | null
  businessStatus?: string | null
}

type FetchLike = typeof fetch

export type DiscoveryEnrichmentResult = {
  requested: number
  enriched: number
  skipped: number
  failed: number
  errors: Array<{ discoveryVenueId: string; message: string }>
}

const DISCOVERY_ENRICH_SELECT = `
  id,
  name,
  address,
  source,
  source_external_id,
  metadata
`

const GOOGLE_PLACE_DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'internationalPhoneNumber',
  'nationalPhoneNumber',
  'websiteUri',
  'rating',
  'userRatingCount',
  'regularOpeningHours',
  'photos',
  'businessStatus',
].join(',')

/**
 * Refreshes at most 50 discovery venue rows from Google Places Details.
 *
 * Rows without a Google Place id are marked as attempted so the cron does not
 * get stuck on manually verified venues that cannot be enriched automatically.
 */
export async function enrichDiscoveryVenues(input: {
  db: DiscoveryDb
  limit?: number
  fetchImpl?: FetchLike
  now?: Date
}): Promise<DiscoveryEnrichmentResult> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 50)
  const now = input.now ?? new Date()
  const nowIso = now.toISOString()
  const fetchImpl = input.fetchImpl ?? fetch
  const apiKey = process.env.GOOGLE_PLACES_API_KEY

  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is required for discovery enrichment')
  }

  const { data, error } = await input.db
    .from('discovery_venues')
    .select(DISCOVERY_ENRICH_SELECT)
    .order('last_enriched_at', { ascending: true, nullsFirst: true })
    .order('updated_at', { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(`Failed to load discovery venues for enrichment: ${error.message}`)
  }

  const rows = (data ?? []) as DiscoveryVenueEnrichmentRow[]
  const result: DiscoveryEnrichmentResult = {
    requested: rows.length,
    enriched: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  }

  for (const venue of rows) {
    const placeId = getGooglePlaceId(venue)
    if (!placeId) {
      await markEnrichmentSkipped(input.db, venue, nowIso, 'missing_google_place_id')
      result.skipped += 1
      continue
    }

    try {
      const place = await fetchGooglePlaceDetails({
        apiKey,
        placeId,
        fetchImpl,
      })
      await updateDiscoveryVenueFromGoogle(input.db, {
        venue,
        place,
        placeId,
        nowIso,
      })
      result.enriched += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google Places enrichment failed'
      await logDiscoveryVenueEvent(input.db, venue.id, 'google_places_error', {
        place_id: placeId,
        message,
      })
      result.failed += 1
      result.errors.push({ discoveryVenueId: venue.id, message })
    }
  }

  return result
}

async function fetchGooglePlaceDetails(input: {
  apiKey: string
  placeId: string
  fetchImpl: FetchLike
}): Promise<GooglePlaceDetails> {
  const response = await input.fetchImpl(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(input.placeId)}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': input.apiKey,
        'X-Goog-FieldMask': GOOGLE_PLACE_DETAILS_FIELD_MASK,
      },
      cache: 'no-store',
    }
  )

  const text = await response.text()
  const payload = text ? safeJsonParse(text) : {}
  if (!response.ok) {
    const message = readGoogleErrorMessage(payload) ?? text ?? `Google Places returned ${response.status}`
    throw new Error(message)
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Google Places returned an invalid details payload')
  }

  return payload as GooglePlaceDetails
}

async function updateDiscoveryVenueFromGoogle(db: DiscoveryDb, input: {
  venue: DiscoveryVenueEnrichmentRow
  place: GooglePlaceDetails
  placeId: string
  nowIso: string
}) {
  const metadata = {
    ...(readRecord(input.venue.metadata) ?? {}),
    google_places: {
      place_id: input.place.id ?? input.placeId,
      business_status: input.place.businessStatus ?? null,
      display_name: input.place.displayName?.text ?? null,
      enriched_at: input.nowIso,
    },
  } as Json

  const { error } = await db
    .from('discovery_venues')
    .update({
      name: input.place.displayName?.text || input.venue.name,
      address: input.place.formattedAddress ?? input.venue.address,
      lat: readFiniteNumber(input.place.location?.latitude),
      lng: readFiniteNumber(input.place.location?.longitude),
      contact_phone: input.place.internationalPhoneNumber ?? input.place.nationalPhoneNumber ?? null,
      website: input.place.websiteUri ?? null,
      google_rating: readFiniteNumber(input.place.rating),
      google_user_ratings_total: readNonNegativeInteger(input.place.userRatingCount),
      google_photo_names: (input.place.photos ?? [])
        .map((photo) => photo.name)
        .filter((name): name is string => Boolean(name)),
      opening_hours_json: (input.place.regularOpeningHours ?? {}) as Json,
      metadata,
      last_enriched_at: input.nowIso,
    })
    .eq('id', input.venue.id)

  if (error) {
    throw new Error(`Failed to update discovery venue ${input.venue.id}: ${error.message}`)
  }

  await logDiscoveryVenueEvent(db, input.venue.id, 'google_places_enriched', {
    place_id: input.place.id ?? input.placeId,
    field_mask: GOOGLE_PLACE_DETAILS_FIELD_MASK,
  })
}

async function markEnrichmentSkipped(
  db: DiscoveryDb,
  venue: DiscoveryVenueEnrichmentRow,
  nowIso: string,
  reason: string
) {
  const metadata = {
    ...(readRecord(venue.metadata) ?? {}),
    google_places: {
      ...(readRecord(readRecord(venue.metadata)?.google_places) ?? {}),
      skipped_at: nowIso,
      skipped_reason: reason,
    },
  } as Json

  const { error } = await db
    .from('discovery_venues')
    .update({
      metadata,
      last_enriched_at: nowIso,
    })
    .eq('id', venue.id)

  if (error) {
    throw new Error(`Failed to mark discovery venue enrichment skipped: ${error.message}`)
  }

  await logDiscoveryVenueEvent(db, venue.id, 'google_places_skipped', { reason })
}

async function logDiscoveryVenueEvent(
  db: DiscoveryDb,
  discoveryVenueId: string,
  eventType: string,
  metadata: Record<string, unknown>
) {
  const { error } = await db
    .from('discovery_venue_events')
    .insert({
      discovery_venue_id: discoveryVenueId,
      event_type: eventType,
      metadata: metadata as Json,
    })

  if (error) {
    console.error('[discovery.enrichment] Failed to log discovery event', error)
  }
}

function getGooglePlaceId(venue: DiscoveryVenueEnrichmentRow) {
  const metadata = readRecord(venue.metadata)
  const metadataPlaceId = readString(metadata?.google_place_id)
    ?? readString(readRecord(metadata?.google_places)?.place_id)
  if (metadataPlaceId) return metadataPlaceId
  if (venue.source === 'google_places') return venue.source_external_id
  return null
}

function readGoogleErrorMessage(payload: unknown) {
  const record = readRecord(payload)
  const error = readRecord(record?.error)
  return readString(error?.message)
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readNonNegativeInteger(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.round(value)
}
