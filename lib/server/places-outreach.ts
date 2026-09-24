import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database-generated'

import { stripGooglePhotoData } from '@/lib/discovery/googlePhotoPersistence'

import { archetypeFor } from '@/lib/planner/archetypes'
import { rankCatalogPartners, type CatalogPlanRankingInput, type CatalogVenueRankingInput } from '@/lib/planner/catalogRanker'
import { buildSpecialSupplySearchQuery, readPlanSpecialSupply } from '@/lib/planner/specialSupply'
import {
  buildSupplyIntentPlacesSearches,
  type SupplyIntentPlacesSearch,
} from '@/lib/planner/supplyIntent/activityCatalog'
import type { Json, Plan, TableRow } from '@/lib/types'
import {
  type GooglePlaceCandidate,
  type GooglePlacesIncludedType,
  type VenuePlacesSearchResult,
  type VenuePlaceCandidate,
  canonicalGooglePlaceId,
  type GooglePlacesTextSearchRequest,
  searchGoogleVenuePlacesText,
} from '@/lib/server/google-places-client'
import type { PlacesIntent } from '@/lib/server/places-archetype-intent'
import { resolvePlacesIntent } from '@/lib/server/places-archetype-intent'
import { readSafeDiscoveryVenue, upsertVenueIdentity, SAFE_VENUE_TABLE, type SafeDiscoveryVenue, type VenueRpcClient } from '@/lib/discovery/venueRepository'
import { areGooglePhotosEnabled } from '@/lib/server/google-places-flags'
import { selectVenuePlaces, hydrateVenueShortlist, venueResultLimit } from '@/lib/server/venue-places-orchestrator'
import type { VenueDetailsResult } from '@/lib/server/venue-places-details'
import { getUsableContactForms, getUsableExtractedEmails, shouldAttemptWebsiteExtraction } from '@/lib/server/discovery-enrichment'
import { isGoogleVenueEnabled } from '@/lib/server/google-places-flags'

type GooglePlacesSearchResultWithSupply = VenuePlacesSearchResult & {
  supplyIntent?: SupplyIntentPlacesSearch | null
}

export type DiscoveryVenueCapacityInferenceFields = {
  inferred_capacity_standing?: number | null
  inferred_capacity_seated?: number | null
  capacity_inference_confidence?: number | null
  capacity_inference_source_quote?: string | null
  capacity_inference_model?: string | null
  capacity_inference_extracted_at?: string | null
  capacity_inference_admin_status?: 'pending' | 'approved' | 'rejected' | 'edited' | string | null
}

export type DiscoveryVenueRow = SafeDiscoveryVenue & DiscoveryVenueCapacityInferenceFields
export type PlanDiscoveryVenueCandidateRow = TableRow<'plan_discovery_venue_candidates'>

export const DISCOVERY_VENUE_SELECT = `
  id,
  name,
  address,
  neighborhood,
  city,
  state,
  lat,
  lng,
  contact_email,
  contact_phone,
  website,
  instagram_handle,
  capacity_seated,
  capacity_standing,
  capacity_cocktail,
  inferred_capacity_standing,
  inferred_capacity_seated,
  capacity_inference_confidence,
  capacity_inference_source_quote,
  capacity_inference_model,
  capacity_inference_extracted_at,
  capacity_inference_admin_status,
  vibe_tags,
  alcohol_policy,
  av_available,
  parking_notes,
  price_hint_cents_low,
  price_hint_cents_high,
  price_hint_note,
  source,
  source_external_id,
  google_rating,
  google_user_ratings_total,
  opening_hours_json,
  metadata,
  business_status,
  last_places_refresh_at,
  last_meaningful_change_at,
  data_freshness_status,
  last_enriched_at,
  last_verified_at,
  last_rescue_at,
  organizer_provided_emails,
  organizer_rescue_count,
  is_claimed,
  claimed_venue_id,
  created_at,
  updated_at,
  extracted_emails,
  website_extraction_attempted_at,
  website_extraction_attempts,
  website_extraction_metadata,
  extracted_contact_forms,
  website_extraction_status
`

export type ContactStatus = 'ready_to_reach_out' | 'contact_form_available' | 'contact_link_available' | 'contact_pending' | 'no_contact_available'
export type ContactEmailSource = 'direct' | 'organizer_provided' | 'extracted' | null
export type ContactEmailConfidence = 'high' | 'medium' | 'low' | null

export type DiscoveryCandidateResponse = {
  candidate_id: string
  venue_data: SafeDiscoveryVenue['venue_data']
  discovery_venue_id: string
  name: string
  address: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  website: string | null
  contact_phone: string | null
  contact_email: string | null
  contact_email_source: ContactEmailSource
  contact_email_confidence: ContactEmailConfidence
  contact_form_url: string | null
  contact_form_label: string | null
  contact_form_source_path: string | null
  contact_status: ContactStatus
  extraction_status: string | null
  fit_score: number
  status: string
  dismissed_at: string | null
  google_rating: number | null
  google_user_ratings_total: number | null
  business_status: string | null
  data_freshness_status: string | null
  last_places_refresh_at: string | null
  last_meaningful_change_at: string | null
  photo_urls: string[]
  metadata: Json
  quote_required: boolean
  verification_status: 'unverified_quote_required' | null
  candidate_label: string | null
}

export type ContactResolution = {
  email: string | null
  source: ContactEmailSource
  confidence: ContactEmailConfidence
  contactFormUrl: string | null
  contactFormLabel: string | null
  contactFormSourcePath: string | null
  status: ContactStatus
}

type CandidateWithVenue = {
  candidate: PlanDiscoveryVenueCandidateRow
  venue: DiscoveryVenueRow
}

export function buildDiscoveryVenueInsert(
  place: GooglePlaceCandidate,
  input: {
    request: GooglePlacesTextSearchRequest
    searchQuery: string
    neighborhood: string | null
    intent?: PlacesIntent
    matchedIncludedType?: string | null
    supplyIntent?: SupplyIntentPlacesSearch | null
  }
) {
  // Compatibility builder is identity-only; live acquisition uses the guarded RPC.
  const id = canonicalGooglePlaceId(place.id)
  if (!id) throw new Error('Invalid venue Place ID')
  return { source: 'google_places' as const, source_external_id: id }
}

export type DiscoveryVenueSubspaceHint = 'ballroom' | 'rooftop' | 'private_dining' | 'lounge' | 'main_floor' | null

export function computeVenueCluster(place: Pick<GooglePlaceCandidate, 'id' | 'displayName' | 'formattedAddress' | 'primaryType' | 'types'>): string {
  const types = new Set([place.primaryType, ...(place.types ?? [])].filter((type): type is string => Boolean(type)))
  if (!types.has('hotel') && !types.has('lodging') && !types.has('resort_hotel')) return place.id

  const parentName = stripSubspaceWords(place.displayName.text)
  const city = inferCity(place.formattedAddress) ?? null
  const clusterText = [parentName, city].filter(Boolean).join(' ')
  const slug = slugifyVenueCluster(clusterText)
  return slug ? `hotel_${slug}` : place.id
}

export function computeSubspaceHint(place: Pick<GooglePlaceCandidate, 'displayName' | 'primaryType' | 'types'>): DiscoveryVenueSubspaceHint {
  const text = `${place.displayName.text} ${place.primaryType ?? ''} ${(place.types ?? []).join(' ')}`
  if (/\brooftop|roof top|terrace|sky\s?deck\b/i.test(text)) return 'rooftop'
  if (/\bballroom|banquet\b/i.test(text)) return 'ballroom'
  if (/\bprivate\s+dining|private\s+room|dining\s+room\b/i.test(text)) return 'private_dining'
  if (/\blounge\b/i.test(text)) return 'lounge'
  if (/\blobby|main\s+floor|ground\s+floor\b/i.test(text)) return 'main_floor'
  return null
}

export function resolveDiscoveryVenueContact(venue: DiscoveryVenueRow): ContactResolution {
  const directEmail = normalizeEmail(venue.contact_email)
  if (directEmail) {
    return {
      email: directEmail,
      source: 'direct',
      confidence: 'high',
      contactFormUrl: null,
      contactFormLabel: null,
      contactFormSourcePath: null,
      status: 'ready_to_reach_out',
    }
  }

  const organizerEmail = readLatestOrganizerEmail(venue.organizer_provided_emails)
  if (organizerEmail) {
    return {
      email: organizerEmail,
      source: 'organizer_provided',
      confidence: 'high',
      contactFormUrl: null,
      contactFormLabel: null,
      contactFormSourcePath: null,
      status: 'ready_to_reach_out',
    }
  }

  const extractedEmail = readBestExtractedEmail(venue.extracted_emails)
  if (extractedEmail) {
    return {
      email: extractedEmail.email,
      source: 'extracted',
      confidence: extractedEmail.confidence >= 0.8 ? 'high' : 'medium',
      contactFormUrl: null,
      contactFormLabel: null,
      contactFormSourcePath: null,
      status: 'ready_to_reach_out',
    }
  }

  const contactForm = readBestContactForm((venue as unknown as Record<string, unknown>).extracted_contact_forms)
  if (contactForm) {
    return {
      email: null,
      source: null,
      confidence: null,
      contactFormUrl: contactForm.url,
      contactFormLabel: contactForm.label,
      contactFormSourcePath: contactForm.source_path,
      status: contactForm.evidence_kind === 'observed_form' ? 'contact_form_available' : 'contact_link_available',
    }
  }

  return {
    email: null,
    source: null,
    confidence: null,
    contactFormUrl: null,
    contactFormLabel: null,
    contactFormSourcePath: null,
    status: shouldAttemptWebsiteExtraction(venue, { googleHydrationEnabled: isGoogleVenueEnabled() })
      ? 'contact_pending' : 'no_contact_available',
  }
}

export function buildDiscoveryCandidateResponses(
  plan: Plan,
  rows: CandidateWithVenue[]
): DiscoveryCandidateResponse[] {
  const scoreByVenueId = rankDiscoveryVenues(plan, rows.map((row) => row.venue))
  const specialSupply = readPlanSpecialSupply(plan)

  return rows
    .map(({ candidate, venue: inputVenue }) => {
      const venue = readSafeDiscoveryVenue(inputVenue)
      const contact = resolveDiscoveryVenueContact(venue)
      const fitScore = scoreByVenueId.get(venue.id) ?? 0
      return {
        candidate_id: candidate.id,
        venue_data: venue.venue_data,
        discovery_venue_id: venue.id,
        name: venue.name ?? 'Venue details unavailable',
        address: venue.address,
        neighborhood: venue.neighborhood,
        city: venue.city,
        state: venue.state,
        website: venue.website,
        contact_phone: venue.contact_phone,
        contact_email: contact.email,
        contact_email_source: contact.source,
        contact_email_confidence: contact.confidence,
        contact_form_url: contact.contactFormUrl,
        contact_form_label: contact.contactFormLabel,
        contact_form_source_path: contact.contactFormSourcePath,
        contact_status: contact.status,
        extraction_status: venue.website_extraction_status,
        fit_score: fitScore,
        status: candidate.status,
        dismissed_at: candidate.dismissed_at,
        google_rating: venue.google_rating,
        google_user_ratings_total: venue.google_user_ratings_total,
        business_status: readString((venue as unknown as Record<string, unknown>).business_status),
        data_freshness_status: readString((venue as unknown as Record<string, unknown>).data_freshness_status),
        last_places_refresh_at: readString((venue as unknown as Record<string, unknown>).last_places_refresh_at),
        last_meaningful_change_at: readString((venue as unknown as Record<string, unknown>).last_meaningful_change_at),
        photo_urls: buildPhotoUrls(venue.id, venue.source === 'google_places' ? venue.source_external_id : null),
        metadata: stripGooglePhotoData(venue.metadata),
        quote_required: Boolean(specialSupply?.quote_required),
        verification_status: specialSupply ? 'unverified_quote_required' : null,
        candidate_label: specialSupply?.candidate_status_label ?? null,
      } satisfies DiscoveryCandidateResponse
    })
    .sort(compareCandidateResponses)
}

export function rankDiscoveryVenues(plan: Plan, venues: DiscoveryVenueRow[]): Map<string, number> {
  if (venues.length === 0) return new Map()

  const ranked = rankCatalogPartners({
    plan: mapPlanToRankingInput(plan),
    venues: venues.map(mapDiscoveryVenueToCatalogVenue),
    vendors: [],
    archetype: archetypeFor(plan.event_type ?? null),
    limit: venues.length,
    venueLimit: venues.length,
    vendorLimit: 0,
  })

  const scores = new Map<string, number>()
  for (const recommendation of [...ranked.recommendations, ...ranked.rejected]) {
    scores.set(recommendation.partner_id, clampFitScore(recommendation.score))
  }

  return scores
}

export function mapDiscoveryVenueToCatalogVenue(inputRow: DiscoveryVenueRow): CatalogVenueRankingInput {
  const row = readSafeDiscoveryVenue(inputRow)
  const metadata = readRecord(row.metadata)
  const venueClusterId = readString(metadata?.venue_cluster_id)
  const subspaceHint = readString(metadata?.subspace_hint)
  const googleTypes = readStringArray(metadata?.google_types)
  const placesTypes = readStringArray(metadata?.places_all_types)
  const typeSignals = [...googleTypes, ...placesTypes]
  const hasBarSignal = typeSignals.some((type) => /\b(bar|cocktail|lounge|brewery|winery|night_club)\b/i.test(type))
  return {
    id: row.id,
    venue_identity_kind: 'discovery',
    name: row.name,
    venue_name: row.name,
    address: row.address,
    city: row.city,
    state: row.state,
    neighborhood: row.neighborhood,
    venue_type: readString(metadata?.primary_type) ?? readString(metadata?.google_primary_type),
    description: readString(metadata?.places_summary),
    unique_features_tags: [
      ...(row.vibe_tags ?? []),
      ...googleTypes,
      ...placesTypes,
      ...(hasBarSignal ? ['full bar', 'beverage program'] : []),
      ...(subspaceHint ? [subspaceHint] : []),
    ],
    alcohol_policy: hasBarSignal ? 'Bar or beverage program likely; confirm terms with venue.' : row.alcohol_policy,
    capacity: row.capacity_cocktail ?? row.capacity_standing ?? row.capacity_seated ?? null,
    standing_capacity: row.capacity_standing,
    seated_capacity: row.capacity_seated,
    inferred_capacity_standing: row.inferred_capacity_standing ?? null,
    inferred_capacity_seated: row.inferred_capacity_seated ?? null,
    capacity_inference_confidence: row.capacity_inference_confidence ?? null,
    capacity_inference_admin_status: row.capacity_inference_admin_status ?? null,
    capacity_inference_source_quote: row.capacity_inference_source_quote ?? null,
    capacity_inference_model: row.capacity_inference_model ?? null,
    capacity_inference_extracted_at: row.capacity_inference_extracted_at ?? null,
    estimate_cents: row.price_hint_cents_high ?? row.price_hint_cents_low ?? null,
    rating: row.google_rating,
    review_count: row.google_user_ratings_total,
    source: row.source,
    source_external_id: row.source_external_id,
    google_place_id: canonicalGooglePlaceId(row.source_external_id),
    claimed_venue_id: row.claimed_venue_id,
    venue_data: row.venue_data,
    metadata: stripGooglePhotoData(row.metadata),
    venue_cluster_id: venueClusterId,
    subspace_hint: subspaceHint,
    is_claimed: row.is_claimed,
    is_published: true,
    website: row.website,
    contact_phone: row.contact_phone,
  }
}

export function buildDefaultOutreachSubject(plan: Pick<Plan, 'title' | 'metadata'>) {
  const specialSupply = readPlanSpecialSupply(plan)
  return specialSupply ? `${plan.title} quote request` : `${plan.title} venue inquiry`
}

export function buildDefaultOutreachBody(plan?: Pick<Plan, 'metadata'>) {
  const specialSupply = plan ? readPlanSpecialSupply(plan) : null
  if (specialSupply) {
    return [
      'Hi {{place_name}},',
      '',
      `I'm planning a ${specialSupply.label.toLowerCase()} and need a verified quote before comparing options.`,
      '',
      `Can you host this event? Please reply with ${formatQuoteFieldsForSentence(specialSupply.outreach_quote_fields)}.`,
      '',
      'No booking or payment happens from this email. The organizer reviews confirmed terms in 3rdPlace before approving any next step.',
      '',
      'Thanks,',
      '{{sender_email}}',
    ].join('\n')
  }

  return [
    'Hi {{place_name}},',
    '',
    "I'm planning a Bay Area community event and wanted to see whether your space is open to hosting.",
    '',
    'If you are interested, please reply with available dates, minimum spend or pricing notes, and the best next step.',
    '',
    'If community host incentives are relevant for your venue, include any terms you would want reviewed before anything is approved.',
    '',
    'Thanks,',
    '{{sender_email}}',
  ].join('\n')
}

export function buildDefaultDiscoverySearchQuery(plan: Plan) {
  const specialSupplySearchQuery = buildSpecialSupplySearchQuery(plan)
  if (specialSupplySearchQuery) return specialSupplySearchQuery

  const eventText = plan.event_type?.trim() || 'venues'
  const locationText = plan.neighborhood?.trim() || readPlanCity(plan) || 'Bay Area'
  return `${eventText} in ${locationText}`
}

type PlannerDbLike = Pick<SupabaseClient<Database>, 'from' | 'rpc'>

export type VenueLiveOverlay = VenueDetailsResult & { fit_score?: number }
export type SearchPlacesForPlanResult = {
  venues: DiscoveryVenueRow[]
  google_live_overlays: Record<string, VenueLiveOverlay>
  search_query: string
  places_requests: GooglePlacesTextSearchRequest[]
  places_result_counts: { total: number; by_type: Partial<Record<GooglePlacesIncludedType, number>> }
}

export async function searchPlacesForPlan(
  plan: Plan,
  options: {
    admin: PlannerDbLike; apiKey: string; areas?: string[]; maxResultCount?: number
    searchedByUserId?: string; query?: string
  }
): Promise<SearchPlacesForPlanResult> {
  const maxResultCount = venueResultLimit(options.maxResultCount)
  const areas = normalizeSearchAreas(options.areas, plan)
  const searchQuery = options.query ?? buildDefaultDiscoverySearchQuery({ ...plan, neighborhood: areas.join(' or ') })
  const empty = { venues: [], google_live_overlays: {}, search_query: searchQuery, places_requests: [], places_result_counts: { total: 0, by_type: {} } }
  if (!isGoogleVenueEnabled()) return empty
  const placesIntent = resolvePlacesIntent(plan.event_type, buildPlacesIntentHints(plan))
  const allResults: GooglePlacesSearchResultWithSupply[] = []
  for (const area of areas) {
    const planForArea = { ...plan, neighborhood: area }
    const query = options.query ?? buildDefaultDiscoverySearchQuery(planForArea)
    const supplySearches = options.query ? [] : buildSupplyIntentPlacesSearches(planForArea)
    const searches = supplySearches.length ? supplySearches : placesIntent.primary_types.slice(0, 4).map((includedType) => ({ textQuery: query, includedType }))
    const results = await Promise.all(searches.slice(0, 4).map(async (search) => ({
      ...(await searchGoogleVenuePlacesText({ apiKey: options.apiKey, textQuery: search.textQuery,
        eventType: plan.event_type, neighborhood: area, city: readPlanCity(plan), includedType: search.includedType, maxResultCount })),
      supplyIntent: supplySearches.length ? search as SupplyIntentPlacesSearch : null,
    })))
    allResults.push(...results)
  }
  const pool = dedupePlacesByGoogleId(allResults)
  const ids = pool.map(({ place }) => place.id)
  const known = ids.length ? await options.admin.from(SAFE_VENUE_TABLE).select(DISCOVERY_VENUE_SELECT).in('source_external_id', ids) : { data: [] }
  const independentByPlaceId = new Map<string, DiscoveryVenueRow>()
  for (const row of known.data ?? []) {
    const safe = readSafeDiscoveryVenue(row)
    const id = canonicalGooglePlaceId(safe.source_external_id)
    if (id) independentByPlaceId.set(id, safe)
  }
  const score = (places: VenuePlaceCandidate[]) => scoreTransientVenuePlaces(plan, places, independentByPlaceId)
  // Ratings are unknown for the entire Pro pool; selection occurs BEFORE cap.
  const selected = selectVenuePlaces(pool, score, maxResultCount)
  const hydrated = await hydrateVenueShortlist(selected.map(({ place }) => place), { apiKey: options.apiKey })
  const detailsById = new Map(hydrated.map((detail) => [detail.place_id, detail]))
  const successfulPlaces = selected.map(({ place }) => detailsById.get(place.id)?.place ?? place)
  const liveScores = score(successfulPlaces)
  const venues: DiscoveryVenueRow[] = []
  const overlays: Record<string, VenueLiveOverlay> = {}
  for (const { place } of selected) {
    const detail = detailsById.get(place.id)
    // Identity mismatch/closed/deleted is never replaced by a different business.
    if (detail && ['identity_mismatch', 'closed', 'unavailable', 'invalid_id'].includes(detail.status)) continue
    const { data, error } = await upsertVenueIdentity(options.admin, place.id)
    if (error || !data) {
      console.error('[places.outreach] identity_write_failed', { place_id: place.id, code: error?.code })
      continue
    }
    venues.push(data)
    overlays[data.id] = { ...(detail ?? { status: 'failed', place_id: place.id, profile: 'pro', attempts: 0 }),
      place: detail?.place ?? place, fit_score: liveScores.get(place.id) ?? 0 }
  }
  const searchedByUserId = options.searchedByUserId
  if (venues.length && searchedByUserId) {
    const inserts = venues.map((venue) => ({
      plan_id: plan.id, discovery_venue_id: venue.id, searched_by_user_id: searchedByUserId,
      search_query: searchQuery, archetype_id: plan.event_type, neighborhood: areas.join(' or '),
      // No Google-derived score, reasons, type, cluster, coordinates, or response.
      fit_score: null, status: 'candidate', dismissed_at: null,
      places_request_json: { contract_version: 1, place_id: venue.source_external_id, discovery_venue_id: venue.id },
    }))
    const { error } = await options.admin.from('plan_discovery_venue_candidates').upsert(inserts, { onConflict: 'plan_id,discovery_venue_id' })
    if (error) throw new Error('Failed to attach venue identities to plan')
  }
  // Reorder only the already selected IDs; discarded IDs never receive Details.
  venues.sort((a, b) => (overlays[b.id]?.fit_score ?? 0) - (overlays[a.id]?.fit_score ?? 0))
  return { venues, google_live_overlays: overlays, search_query: searchQuery,
    places_requests: allResults.map((result) => result.request), places_result_counts: summarizePlacesResults(allResults) }
}

/** Ephemeral projection only. Never feed this object into a model or writer. */
function scoreTransientVenuePlaces(plan: Plan, places: VenuePlaceCandidate[], independent: Map<string, DiscoveryVenueRow>): Map<string, number> {
  const scores = new Map<string, number>()
  for (const place of places) {
    const row = independent.get(place.id)
    const known = row ? mapDiscoveryVenueToCatalogVenue(row) : {}
    const venue: CatalogVenueRankingInput = {
      ...known, id: place.id,
      name: row?.name ?? place.displayName?.text,
      venue_name: row?.name ?? place.displayName?.text,
      address: row?.address ?? place.formattedAddress,
      venue_type: place.primaryType,
      unique_features_tags: [...(row?.vibe_tags ?? [])],
      rating: place.rating ?? null, review_count: place.userRatingCount ?? null,
      // No inferred cluster/room name or copied provider metadata.
      metadata: {},
    }
    const scoringPlan = row?.address || place.formattedAddress ? mapPlanToRankingInput(plan) : { ...mapPlanToRankingInput(plan), area: null, neighborhood: null }
    const ranked = rankCatalogPartners({ plan: scoringPlan, venues: [venue], vendors: [],
      archetype: archetypeFor(plan.event_type ?? null), limit: 1, venueLimit: 1, vendorLimit: 0 })
    const result = [...ranked.recommendations, ...ranked.rejected][0]
    if (result) scores.set(place.id, result.blocking_issues.length ? result.score - 1000 : result.score)
  }
  return scores
}

export function compareCandidateResponses(first: DiscoveryCandidateResponse, second: DiscoveryCandidateResponse) {
  const statusOrder = contactStatusWeight(first.contact_status) - contactStatusWeight(second.contact_status)
  if (statusOrder !== 0) return statusOrder
  return second.fit_score - first.fit_score || first.name.localeCompare(second.name)
}

function mapPlanToRankingInput(plan: Plan): CatalogPlanRankingInput {
  return {
    id: plan.id,
    event_type: plan.event_type,
    guest_count: plan.guest_count,
    neighborhood: plan.neighborhood,
    budget_cap_cents: plan.budget_cap_cents,
    date_window_start: plan.date_window_start,
    date_window_end: plan.date_window_end,
    ticketing_model: plan.ticketing_model,
    food_responsibility: plan.food_responsibility,
    venue_terms: plan.venue_terms,
    metadata: plan.metadata,
  }
}

function readPlanCity(plan: Pick<Plan, 'metadata'>) {
  const metadata = readRecord(plan.metadata)
  const city = metadata?.city
  return typeof city === 'string' && city.trim() ? city.trim() : null
}

function buildPlacesIntentHints(plan: Plan) {
  const metadata = readRecord(plan.metadata)
  return {
    venue_style: readString(metadata?.venue_style) ?? readString(metadata?.room_type) ?? readString(metadata?.preferred_venue_style),
    vibe: [
      ...readStringArray(metadata?.vibe),
      ...readStringArray(metadata?.vibes),
      ...readStringArray(metadata?.vibe_tags),
    ],
    subspace_keywords: [
      ...readStringArray(metadata?.subspace_keywords),
      ...readStringArray(metadata?.venue_keywords),
      ...extractSubspaceKeywords([
        readString(metadata?.venue_style),
        readString(metadata?.room_type),
        readString(plan.notes),
      ].filter(Boolean).join(' ')),
    ],
  }
}

function normalizeSearchAreas(areas: string[] | undefined, plan: Plan): string[] {
  const normalized = (areas && areas.length > 0 ? areas : [plan.neighborhood, readPlanCity(plan), 'Bay Area'])
    .map((area) => readString(area))
    .filter((area): area is string => Boolean(area))
  return [...new Set(normalized)].slice(0, 3)
}

function summarizePlacesResults(results: VenuePlacesSearchResult[]): SearchPlacesForPlanResult['places_result_counts'] {
  const byType: SearchPlacesForPlanResult['places_result_counts']['by_type'] = {}
  for (const result of results) {
    const type = result.request.includedType
    if (!type) continue
    byType[type] = (byType[type] ?? 0) + result.places.length
  }
  return {
    total: results.reduce((sum, result) => sum + result.places.length, 0),
    by_type: byType,
  }
}

function dedupePlacesByGoogleId(results: GooglePlacesSearchResultWithSupply[]) {
  const byId = new Map<string, {
    place: VenuePlacesSearchResult['places'][number]
    request: VenuePlacesSearchResult['request']
    matchedIncludedType: GooglePlacesIncludedType | null
    supplyIntent: SupplyIntentPlacesSearch | null
  }>()

  for (const result of results) {
    for (const place of result.places) {
      if (byId.has(place.id)) continue
      byId.set(place.id, {
        place,
        request: result.request,
        matchedIncludedType: result.request.includedType ?? null,
        supplyIntent: result.supplyIntent ?? null,
      })
    }
  }

  return [...byId.values()]
}

function extractSubspaceKeywords(text: string) {
  const matches = text.match(/\b(rooftop|ballroom|private dining|lounge|hotel|resort|lodging)\b/gi)
  return matches ? [...new Set(matches.map((match) => match.toLowerCase()))] : []
}

function formatQuoteFieldsForSentence(fields: string[]) {
  const visibleFields = fields.slice(0, 10)
  if (visibleFields.length <= 1) return visibleFields[0] ?? 'quote terms'
  if (visibleFields.length === 2) return `${visibleFields[0]} and ${visibleFields[1]}`
  return `${visibleFields.slice(0, -1).join(', ')}, and ${visibleFields[visibleFields.length - 1]}`
}

function readLatestOrganizerEmail(value: Json): string | null {
  if (!Array.isArray(value)) return null
  for (const entry of [...value].reverse()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const email = normalizeEmail((entry as Record<string, unknown>).email)
    if (email) return email
  }
  return null
}

function readBestExtractedEmail(value: Json): { email: string; confidence: number } | null {
  const candidates = getUsableExtractedEmails(value).map((entry) => ({
    email: entry.email.toLowerCase(),
    confidence: entry.is_likely_booking_contact ? Math.max(entry.confidence, 0.8) : entry.confidence,
  }))

  return candidates.sort((first, second) => second.confidence - first.confidence)[0] ?? null
}

function readBestContactForm(value: unknown) {
  const forms = getUsableContactForms(value as Json | null | undefined)
    .sort((first, second) => {
      if (first.evidence_kind !== second.evidence_kind) return first.evidence_kind === 'observed_form' ? -1 : 1
      if (first.is_likely_booking_contact !== second.is_likely_booking_contact) {
        return first.is_likely_booking_contact ? -1 : 1
      }
      return second.confidence - first.confidence || first.url.localeCompare(second.url)
    })
  const form = forms[0]
  return form
    ? {
      url: form.url,
      label: form.label,
      source_path: form.source_path,
      confidence: form.confidence,
      evidence_kind: form.evidence_kind,
    }
    : null
}

function buildPhotoUrls(venueId: string, placeId: string | null): string[] {
  if (!areGooglePhotosEnabled('venue') || !canonicalGooglePlaceId(placeId)) return []
  return Array.from({ length: 3 }, (_, index) => `/api/planner/discovery-venues/${encodeURIComponent(venueId)}/photo/${index}`)
}

function shouldSkipEmail(email: string) {
  const [local, domain] = email.toLowerCase().split('@')
  if (!local || !domain) return true
  if (local === 'user' || domain === 'domain.com' || domain === 'example.com') return true
  if (domain.endsWith('.sentry-next.wixpress.com')) return true
  if (['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'webmaster'].includes(local)) return true
  return false
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function contactStatusWeight(status: ContactStatus) {
  if (status === 'ready_to_reach_out') return 0
  if (status === 'contact_form_available' || status === 'contact_link_available') return 1
  if (status === 'contact_pending') return 2
  return 3
}

function clampFitScore(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)))
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => readString(item)).filter((item): item is string => Boolean(item))
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function inferCity(address?: string | null) {
  if (!address) return null
  if (/berkeley/i.test(address)) return 'Berkeley'
  if (/oakland/i.test(address)) return 'Oakland'
  if (/san francisco|\bsf\b/i.test(address)) return 'San Francisco'
  return null
}

function stripSubspaceWords(name: string) {
  return name
    .replace(/\b(rooftop|roof top|terrace|sky\s?deck|ballroom|banquet hall|private dining|private room|lounge|bar|restaurant|cafe|event space|events?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function slugifyVenueCluster(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
}
