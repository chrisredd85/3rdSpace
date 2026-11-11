import 'server-only'

import { SAFE_VENDOR_TABLE, readSafeDiscoveryVendor, upsertVendorIdentity, type SafeDiscoveryVendor, type VendorRpcClient } from '@/lib/discovery/vendorRepository'
import { isGoogleVendorEnabled } from './google-places-flags'
import { createVendorDetailsContext, type VendorDetailsContext } from './vendor-places-details'
import { hydrateVendorShortlist, selectVendorPlaces } from './vendor-places-orchestrator'

import { readFieldProvenance, retentionOrigin } from '@/lib/discovery/foundation/provenance'
import type { Json } from '@/lib/types'
import {
  canonicalGooglePlaceId,
  type VenuePlaceCandidate,
  type GooglePlacesIncludedType,
  type VenuePlacesSearchResult,
  type GooglePlacesTextSearchRequest,
  searchGoogleVendorPlacesText,
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

export type DiscoveryVendorRow = SafeDiscoveryVendor

export type SearchPlacesForVendorResult = {
  vendors: DiscoveryVendorRow[]
  /** Request-local only. Never put this overlay in a message, job, log or snapshot. */
  live: Array<{ discovery_vendor_id: string; place: VenuePlaceCandidate; fit: VendorDiscoveryFit }>
  unavailable: boolean
  search_queries: string[]
  places_requests: GooglePlacesTextSearchRequest[]
  places_result_count: number
}

type PlannerDbLike = VendorRpcClient & {
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
  budget_cap_cents?: number | null
  date_window_start?: string | null
  date_window_end?: string | null
  event_type?: string | null
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
  context?: VendorDetailsContext
  remainingBudgetCents?: number | null
}): Promise<SearchPlacesForVendorResult> {
  const serviceType = normalizeVendorServiceType(opts.serviceType)
  const empty: SearchPlacesForVendorResult = { vendors: [], live: [], unavailable: false, search_queries: [], places_requests: [], places_result_count: 0 }
  if (!serviceType || !isGoogleVendorEnabled()) return empty
  const context = opts.context ?? createVendorDetailsContext()
  const mapping = VENDOR_SERVICE_PLACES_MAPPING[serviceType]
  const specialSupply = opts.isSpecialSupply === true || SPECIAL_SUPPLY_SERVICE_TYPES.has(serviceType)
  const areas = specialSupply ? normalizeAreas(opts.areas.length ? opts.areas : ['Bay Area']) : buildNormalVendorSearchAreas(opts.areas, opts.plan)
  const allResults: VenuePlacesSearchResult[] = []
  const searchQueries: string[] = []
  let unavailable = false
  for (const area of areas) {
    if (context.now() >= context.deadline) { unavailable = true; break }
    const textQuery = mapping.query(area)
    searchQueries.push(textQuery)
    try {
      allResults.push(await searchGoogleVendorPlacesText({
        apiKey: opts.apiKey, textQuery, eventType: serviceType,
        neighborhood: specialSupply ? null : area, city: specialSupply ? null : area,
        includedType: mapping.includedType ?? null, maxResultCount: 20,
        includePureServiceAreaBusinesses: !specialSupply,
        locationBiasRadiusMeters: specialSupply ? Math.round((opts.plan?.special_supply_radius_miles ?? 100) * 1609) : null,
        deadline: context.deadline, now: context.now, sleep: context.sleep, fetchImpl: context.fetchImpl,
      }))
    } catch { unavailable = true }
  }
  const pool = dedupePlacesById(allResults)
  const facts = await loadIndependentVendorFitFacts(opts.admin, pool.map(({ place }) => place.id), opts.plan)
  const fits = new Map(pool.map(({ place }) => [place.id, scoreDiscoveryVendorFit({
    vendor: facts.get(place.id)?.vendor, linkedProfile: facts.get(place.id)?.profile,
    serviceType, plan: opts.plan, remainingBudgetCents: opts.remainingBudgetCents ?? opts.plan?.budget_cap_cents,
  })]))
  const selected = selectVendorPlaces(pool, () => new Map([...fits].map(([id, fit]) => [id, fit.eligible ? fit.score : -1])), opts.maxResults)
  const hydrated = await hydrateVendorShortlist(selected.map(({ place }) => place), { apiKey: opts.apiKey, context })
  const vendors: DiscoveryVendorRow[] = []
  const live: SearchPlacesForVendorResult['live'] = []
  for (const { place } of selected) {
    const details = hydrated.find((result) => result.place_id === place.id)
    if (details?.status === 'closed' || details?.status === 'identity_mismatch') { unavailable = true; continue }
    const { data, error } = await upsertVendorIdentity(opts.admin, place.id)
    if (error || !data) { unavailable = true; continue }
    vendors.push(data)
    if (details?.status !== 'available') unavailable = true
    // Pro content may still render when optional Enterprise hydration fails.
    live.push({ discovery_vendor_id: data.id, place: details?.place ?? place, fit: fits.get(place.id)! })
  }
  if (opts.planId && vendors.length) {
    const { error } = await opts.admin.from('plan_discovery_vendor_candidates').upsert(vendors.map((vendor) => ({
      plan_id: opts.planId, discovery_vendor_id: vendor.id, searched_by_user_id: opts.searchedByUserId ?? null,
      search_query: searchQueries.join(' | '), service_type: serviceType, fit_score: null,
      status: 'candidate', dismissed_at: null,
      // Host query/role and IDs only. No response values or Google-derived fit.
      places_request_json: { service_type: serviceType, queries: searchQueries, requests: allResults.map((result) => result.request) } as unknown as Json,
    })), { onConflict: 'plan_id,discovery_vendor_id' })
    if (error) unavailable = true
  }
  return { vendors, live, unavailable, search_queries: searchQueries, places_requests: allResults.map((result) => result.request),
    places_result_count: allResults.reduce((sum, result) => sum + result.places.length, 0) }
}

/** Identity is the only durable output of a Google response. Kept explicit for regression coverage. */
export function buildDiscoveryVendorInsert(place: { id: string }, _input?: unknown) {
  const id = canonicalGooglePlaceId(place.id)
  if (!id) throw new Error('Invalid vendor Place ID')
  return { source: 'google_places', source_external_id: id }
}

export type VendorDiscoveryFit = {
  eligible: boolean; score: number
  unknown: Array<'price' | 'date' | 'format' | 'service'>
  conflicts: Array<'service' | 'budget' | 'date'>
}
type LinkedProfile = { compatible_features?: unknown; blockedDates?: string[]; availableDates?: string[] }
/** No Google rating, inferred storefront coverage or fabricated rate enters fit. */
export function scoreDiscoveryVendorFit(input: {
  vendor?: DiscoveryVendorRow; linkedProfile?: LinkedProfile; serviceType: VendorServiceType
  plan?: VendorSearchPlanContext | null; remainingBudgetCents?: number | null
}): VendorDiscoveryFit {
  const unknown: VendorDiscoveryFit['unknown'] = [], conflicts: VendorDiscoveryFit['conflicts'] = []
  let score = 50
  const knownService = normalizeVendorServiceType(input.vendor?.service_type)
  if (!knownService) unknown.push('service')
  else if (knownService !== input.serviceType) conflicts.push('service')
  else score += 20
  const packageCents = readPositiveInteger(input.vendor?.inferred_package_rate_cents)
  const minimumCents = readPositiveInteger(input.vendor?.inferred_minimum_cents)
  const budget = input.remainingBudgetCents
  // A minimum is a lower bound, never a complete quote. Hourly costs need duration.
  if (packageCents === null) unknown.push('price')
  if (typeof budget === 'number' && Number.isSafeInteger(budget) && budget >= 0) {
    if ((packageCents !== null && packageCents > budget) || (minimumCents !== null && minimumCents > budget)) conflicts.push('budget')
    else if (packageCents !== null) score += 10
  }
  const start = input.plan?.date_window_start, end = input.plan?.date_window_end ?? start
  if (start && end && input.linkedProfile?.blockedDates?.some(date => date >= start && date <= end)) conflicts.push('date')
  else if (start && start === end && input.linkedProfile?.availableDates?.includes(start)) score += 10
  else unknown.push('date')
  const features = Array.isArray(input.linkedProfile?.compatible_features) ? input.linkedProfile.compatible_features : []
  if (input.plan?.event_type && features.some(value => typeof value === 'string' && value.toLowerCase() === input.plan!.event_type!.toLowerCase())) score += 10
  else unknown.push('format')
  return { eligible: conflicts.length === 0, score, unknown, conflicts }
}

export async function loadIndependentVendorFitFacts(db: Pick<PlannerDbLike, 'from'>, ids: string[], plan?: VendorSearchPlanContext | null) {
  const result = new Map<string, { vendor: DiscoveryVendorRow; profile?: LinkedProfile }>()
  const canonicalIds = [...new Set(ids.map(canonicalGooglePlaceId).filter((id): id is string => id !== null))]
  if (!canonicalIds.length) return result
  // Legacy identity rows may retain the resource prefix or a separate Place ID.
  // Only regex-validated IDs enter this PostgREST filter.
  const aliases = canonicalIds.flatMap(id => [id, `places/${id}`])
  const { data, error } = await db.from(SAFE_VENDOR_TABLE).select('*').eq('source', 'google_places')
    .or(`source_external_id.in.(${aliases.join(',')}),google_place_id.in.(${canonicalIds.join(',')})`)
  // Failing to read known conflicts must not silently make those candidates eligible.
  if (error) throw new Error('Independent vendor fit unavailable')
  for (const row of data ?? []) {
    const vendor = readSafeDiscoveryVendor(row)
    if (vendor.source_external_id) result.set(vendor.source_external_id, { vendor })
  }
  const vendorIds = [...result.values()].map(({ vendor }) => vendor.id)
  if (!vendorIds.length) return result
  const profiles = await db.from('vendor_profiles').select('id, discovery_vendor_id, compatible_features').in('discovery_vendor_id', vendorIds)
  if (profiles.error) throw new Error('Linked vendor fit unavailable')
  const profileIds = (profiles.data ?? []).map((row: { id: string }) => row.id)
  const availability = profileIds.length && plan?.date_window_start
    ? await db.from('vendor_availability').select('vendor_id, date, status').in('vendor_id', profileIds)
      .gte('date', plan.date_window_start).lte('date', plan.date_window_end ?? plan.date_window_start)
    : { data: [], error: null }
  if (availability.error) throw new Error('Linked vendor availability unavailable')
  for (const profile of profiles.data ?? []) {
    const entry = [...result.values()].find(({ vendor }) => vendor.id === profile.discovery_vendor_id)
    if (!entry) continue
    const dates = (availability.data ?? []).filter((row: { vendor_id: string }) => row.vendor_id === profile.id)
    entry.profile = { compatible_features: profile.compatible_features,
      blockedDates: dates.filter((row: { status: string }) => ['blocked', 'unavailable', 'booked'].includes(row.status)).map((row: { date: string }) => row.date),
      availableDates: dates.filter((row: { status: string }) => row.status === 'available').map((row: { date: string }) => row.date) }
  }
  return result
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
> & Partial<Pick<DiscoveryVendorRow, 'field_provenance'>>): { cents: number | null; confidenceLabel: 'quoted' | 'estimated' | 'rate_tbd'; confidence: number | null } {
  const status = vendor.rate_inference_admin_status
  const confidence = vendor.rate_inference_confidence
  const approved = status === 'approved' || status === 'edited'
  const independentlyPublished = ['inferred_package_rate_cents', 'inferred_minimum_cents', 'inferred_hourly_rate_cents']
    .some(key => retentionOrigin(readFieldProvenance(vendor.field_provenance?.[key])) === 'independent')
  const usable = independentlyPublished || approved || (typeof confidence === 'number' && confidence >= 0.7)
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

function dedupePlacesById(results: VenuePlacesSearchResult[]) {
  const seen = new Set<string>()
  const deduped: Array<{ place: VenuePlaceCandidate; request: GooglePlacesTextSearchRequest }> = []
  for (const result of results) {
    for (const place of result.places) {
      const id = canonicalGooglePlaceId(place.id)
      if (!id || seen.has(id)) continue
      seen.add(id)
      deduped.push({ place: { ...place, id }, request: result.request })
    }
  }
  return deduped
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}
