import 'server-only'

import type { Json } from '@/lib/types'
import {
  type GooglePlaceCandidate,
  type GooglePlacesIncludedType,
  type GooglePlacesSearchResult,
  type GooglePlacesTextSearchRequest,
  searchGooglePlacesText,
} from '@/lib/server/google-places-client'
import { deriveEventCity, getAdjacentCities } from '@/lib/planner/geography'

export type VendorServiceType =
  | 'photographer'
  | 'videographer'
  | 'catering'
  | 'bartending'
  | 'florist'
  | 'dj_music'
  | 'security'
  | 'av_production'
  | 'decor'
  | 'yacht_charter'
  | 'mansion_rental'
  | 'private_estate'
  | 'warehouse_buyout'
  | 'rooftop_buyout'

export type DiscoveryVendorRow = {
  id: string
  source: string
  source_external_id: string | null
  name: string
  service_type: string
  formatted_address: string | null
  city: string | null
  state: string | null
  website: string | null
  phone: string | null
  google_place_id: string | null
  google_rating: number | null
  google_user_rating_count: number | null
  google_price_level: string | null
  business_status: string | null
  place_types: Json
  photos: Json
  contact_email: string | null
  organizer_provided_email: string | null
  extracted_emails: Json
  website_extraction_status: string | null
  website_extraction_attempted_at?: string | null
  website_extraction_attempts?: number | null
  website_extraction_metadata?: Json
  inferred_hourly_rate_cents: number | null
  inferred_package_rate_cents: number | null
  inferred_minimum_cents: number | null
  rate_inference_confidence: number | null
  rate_inference_source_quote: string | null
  rate_inference_extracted_at: string | null
  rate_inference_admin_status: string | null
  last_refreshed_at: string | null
  last_places_refresh_at?: string | null
  last_meaningful_change_at?: string | null
  data_freshness_status?: string | null
  created_at: string | null
}

export type SearchPlacesForVendorResult = {
  vendors: DiscoveryVendorRow[]
  search_queries: string[]
  places_requests: GooglePlacesTextSearchRequest[]
  places_result_count: number
}

type PlannerDbLike = {
  from: (table: string) => any
}

type VendorSearchMapping = {
  includedType?: GooglePlacesIncludedType
  query: (area: string) => string
}

export const VENDOR_SERVICE_PLACES_MAPPING: Record<VendorServiceType, VendorSearchMapping> = {
  photographer: {
    includedType: 'photographer',
    query: (area) => `photographer in ${area}`,
  },
  videographer: {
    query: (area) => `videographer in ${area}`,
  },
  catering: {
    includedType: 'caterer',
    query: (area) => `catering in ${area}`,
  },
  bartending: {
    query: (area) => `bartending services in ${area}`,
  },
  florist: {
    includedType: 'florist',
    query: (area) => `florist in ${area}`,
  },
  dj_music: {
    query: (area) => `DJ in ${area}`,
  },
  security: {
    includedType: 'security_service',
    query: (area) => `security service in ${area}`,
  },
  av_production: {
    query: (area) => `AV production services in ${area}`,
  },
  decor: {
    query: (area) => `event decor in ${area}`,
  },
  yacht_charter: {
    query: (area) => `yacht charter event rental in ${area}`,
  },
  mansion_rental: {
    query: (area) => `private mansion event rental in ${area}`,
  },
  private_estate: {
    query: (area) => `private estate event rental in ${area}`,
  },
  warehouse_buyout: {
    query: (area) => `warehouse event venue buyout in ${area}`,
  },
  rooftop_buyout: {
    query: (area) => `rooftop event venue buyout in ${area}`,
  },
}

export const SPECIAL_SUPPLY_SERVICE_TYPES = new Set<VendorServiceType>([
  'yacht_charter',
  'mansion_rental',
  'private_estate',
  'warehouse_buyout',
  'rooftop_buyout',
])

type VendorSearchPlanContext = {
  event_city?: string | null
  neighborhood?: string | null
  vendor_out_of_city_approved?: boolean | null
  vendor_approved_adjacent_cities?: string[] | null
  special_supply_radius_miles?: number | null
}

export async function searchPlacesForVendor(opts: {
  serviceType: VendorServiceType | string
  areas: string[]
  admin: PlannerDbLike
  apiKey: string
  maxResults?: number
  planId?: string | null
  searchedByUserId?: string | null
  plan?: VendorSearchPlanContext | null
  isSpecialSupply?: boolean
}): Promise<SearchPlacesForVendorResult> {
  const serviceType = normalizeVendorServiceType(opts.serviceType)
  if (!serviceType) {
    return { vendors: [], search_queries: [], places_requests: [], places_result_count: 0 }
  }

  const mapping = VENDOR_SERVICE_PLACES_MAPPING[serviceType]
  const specialSupply = opts.isSpecialSupply === true || SPECIAL_SUPPLY_SERVICE_TYPES.has(serviceType)
  const areas = specialSupply
    ? normalizeAreas(opts.areas.length > 0 ? opts.areas : ['Bay Area'])
    : buildNormalVendorSearchAreas(opts.areas, opts.plan)
  const allResults: GooglePlacesSearchResult[] = []
  const searchQueries: string[] = []
  const radiusMeters = specialSupply
    ? Math.round((opts.plan?.special_supply_radius_miles ?? 100) * 1609)
    : null

  for (const area of areas) {
    const textQuery = mapping.query(area)
    searchQueries.push(textQuery)
    allResults.push(await searchGooglePlacesText({
      apiKey: opts.apiKey,
      textQuery,
      eventType: serviceType,
      neighborhood: specialSupply ? null : area,
      city: specialSupply ? null : area,
      includedType: mapping.includedType ?? null,
      maxResultCount: opts.maxResults ?? 6,
      locationBiasRadiusMeters: radiusMeters,
    }))
  }

  const deduped = dedupePlacesById(allResults).slice(0, opts.maxResults ?? 6)
  const vendors: DiscoveryVendorRow[] = []

  for (const { place, request } of deduped) {
    const insert = buildDiscoveryVendorInsert(place, {
      serviceType,
      request,
      searchQuery: searchQueries.join(' | '),
    })

    const { data, error } = await opts.admin
      .from('discovery_vendors')
      .upsert(insert, { onConflict: 'source,source_external_id' })
      .select('*')
      .single()

    if (error || !data) {
      console.error('[places.vendor-search] discovery_vendor_upsert_failed', {
        error: error?.message,
        place_id: place.id,
        service_type: serviceType,
      })
      continue
    }

    vendors.push(data as DiscoveryVendorRow)
  }

  if (opts.planId && vendors.length > 0) {
    const candidateInserts = vendors.map((vendor) => ({
      plan_id: opts.planId,
      discovery_vendor_id: vendor.id,
      searched_by_user_id: opts.searchedByUserId ?? null,
      search_query: searchQueries.join(' | '),
      service_type: serviceType,
      fit_score: null,
      status: 'candidate',
      dismissed_at: null,
      places_request_json: {
        service_type: serviceType,
        queries: searchQueries,
        requests: allResults.map((result) => result.request),
        result_count: allResults.reduce((sum, result) => sum + result.places.length, 0),
      } as unknown as Json,
    }))

    const { error } = await opts.admin
      .from('plan_discovery_vendor_candidates')
      .upsert(candidateInserts, { onConflict: 'plan_id,discovery_vendor_id' })

    if (error) {
      console.error('[places.vendor-search] candidate_upsert_failed', {
        error: error.message,
        plan_id: opts.planId,
        service_type: serviceType,
      })
    }
  }

  return {
    vendors,
    search_queries: searchQueries,
    places_requests: allResults.map((result) => result.request),
    places_result_count: allResults.reduce((sum, result) => sum + result.places.length, 0),
  }
}

export function buildDiscoveryVendorInsert(
  place: GooglePlaceCandidate,
  input: {
    serviceType: VendorServiceType
    request: GooglePlacesTextSearchRequest
    searchQuery: string
  }
) {
  return {
    source: 'google_places',
    source_external_id: place.id,
    name: place.displayName.text,
    service_type: input.serviceType,
    formatted_address: place.formattedAddress ?? null,
    city: inferCity(place.formattedAddress),
    state: 'CA',
    website: place.websiteUri ?? null,
    phone: place.nationalPhoneNumber ?? null,
    google_place_id: place.id,
    google_rating: place.rating ?? null,
    google_user_rating_count: place.userRatingCount ?? null,
    google_price_level: place.priceLevel ?? null,
    business_status: place.businessStatus ?? null,
    place_types: (place.types ?? []) as unknown as Json,
    photos: sanitizePlacesPhotos(place.photos) as unknown as Json,
    website_extraction_status: place.websiteUri ? 'never_attempted' : null,
    last_refreshed_at: new Date().toISOString(),
    last_places_refresh_at: new Date().toISOString(),
    last_meaningful_change_at: null,
    data_freshness_status: 'fresh',
    updated_at: new Date().toISOString(),
    website_extraction_metadata: {
      places_search_query: input.searchQuery,
      places_request: input.request,
      google_primary_type: place.primaryType ?? null,
    } as unknown as Json,
  }
}

export function normalizeVendorServiceType(value: string | null | undefined): VendorServiceType | null {
  const normalized = (value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized === 'photography') return 'photographer'
  if (normalized === 'videography') return 'videographer'
  if (normalized === 'caterer') return 'catering'
  if (normalized === 'bar' || normalized === 'bartender') return 'bartending'
  if (normalized === 'dj' || normalized === 'music' || normalized === 'dj_music') return 'dj_music'
  if (normalized === 'av' || normalized === 'av_tech' || normalized === 'audio_visual') return 'av_production'
  if (normalized === 'floral') return 'florist'
  if (normalized === 'event_decor') return 'decor'
  if (normalized === 'yacht' || normalized === 'boat_charter' || normalized === 'boat') return 'yacht_charter'
  if (normalized === 'mansion' || normalized === 'private_mansion') return 'mansion_rental'
  if (normalized === 'estate') return 'private_estate'
  if (normalized === 'warehouse') return 'warehouse_buyout'
  if (normalized === 'rooftop') return 'rooftop_buyout'
  if (isVendorServiceType(normalized)) return normalized
  return null
}

export function resolveDiscoveryVendorRate(vendor: Pick<
  DiscoveryVendorRow,
  | 'inferred_package_rate_cents'
  | 'inferred_hourly_rate_cents'
  | 'inferred_minimum_cents'
  | 'rate_inference_confidence'
  | 'rate_inference_admin_status'
>): { cents: number | null; confidenceLabel: 'quoted' | 'estimated' | 'rate_tbd'; confidence: number | null } {
  const status = vendor.rate_inference_admin_status
  const confidence = vendor.rate_inference_confidence
  const approved = status === 'approved' || status === 'edited'
  const usable = approved || (typeof confidence === 'number' && confidence >= 0.7)
  if (!usable) return { cents: null, confidenceLabel: 'rate_tbd', confidence: confidence ?? null }

  const cents =
    readPositiveInteger(vendor.inferred_package_rate_cents) ??
    readPositiveInteger(vendor.inferred_minimum_cents) ??
    readPositiveInteger(vendor.inferred_hourly_rate_cents)
  return {
    cents,
    confidenceLabel: cents === null ? 'rate_tbd' : 'estimated',
    confidence: confidence ?? null,
  }
}

function isVendorServiceType(value: string): value is VendorServiceType {
  return Object.prototype.hasOwnProperty.call(VENDOR_SERVICE_PLACES_MAPPING, value)
}

function normalizeAreas(areas: string[]): string[] {
  const normalized = areas
    .map((area) => area.trim())
    .filter(Boolean)
  return Array.from(new Set(normalized.length > 0 ? normalized : ['Bay Area'])).slice(0, 3)
}

function buildNormalVendorSearchAreas(areas: string[], plan?: VendorSearchPlanContext | null): string[] {
  const eventCity = plan?.event_city ?? deriveEventCity([plan?.neighborhood, ...areas])
  const searchAreas = new Set<string>()
  if (eventCity) searchAreas.add(eventCity)
  for (const area of normalizeAreas(areas)) {
    const city = deriveEventCity(area)
    if (city) searchAreas.add(city)
  }
  if (plan?.vendor_out_of_city_approved) {
    for (const city of plan.vendor_approved_adjacent_cities ?? getAdjacentCities(eventCity)) {
      if (city) searchAreas.add(city)
    }
  }
  return Array.from(searchAreas.size > 0 ? searchAreas : new Set(normalizeAreas(areas))).slice(0, 4)
}

function dedupePlacesById(results: GooglePlacesSearchResult[]) {
  const seen = new Set<string>()
  const deduped: Array<{ place: GooglePlaceCandidate; request: GooglePlacesTextSearchRequest }> = []
  for (const result of results) {
    for (const place of result.places) {
      if (seen.has(place.id)) continue
      seen.add(place.id)
      deduped.push({ place, request: result.request })
    }
  }
  return deduped
}

function inferCity(address: string | undefined): string | null {
  if (!address) return null
  if (/\boakland\b/i.test(address)) return 'Oakland'
  if (/\bberkeley\b/i.test(address)) return 'Berkeley'
  if (/\bsan francisco\b/i.test(address)) return 'San Francisco'
  if (/\bsan jose\b/i.test(address)) return 'San Jose'
  return null
}

function sanitizePlacesPhotos(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.flatMap((photo) => {
    if (!photo || typeof photo !== 'object' || Array.isArray(photo)) return []
    const record = photo as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!name) return []
    return [{
      name,
      heightPx: typeof record.heightPx === 'number' ? record.heightPx : undefined,
      widthPx: typeof record.widthPx === 'number' ? record.widthPx : undefined,
      authorAttributions: Array.isArray(record.authorAttributions) ? record.authorAttributions : undefined,
    }]
  })
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null
}
