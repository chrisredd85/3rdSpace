import 'server-only'

import { archetypeFor } from '@/lib/planner/archetypes'
import { rankCatalogPartners, type CatalogPlanRankingInput, type CatalogVenueRankingInput } from '@/lib/planner/catalogRanker'
import { buildSpecialSupplySearchQuery, readPlanSpecialSupply } from '@/lib/planner/specialSupply'
import type { Json, Plan, TableRow } from '@/lib/types'
import type { GooglePlaceCandidate, GooglePlacesTextSearchRequest } from '@/lib/server/google-places-client'

export type DiscoveryVenueRow = TableRow<'discovery_venues'>
export type PlanDiscoveryVenueCandidateRow = TableRow<'plan_discovery_venue_candidates'>

export type ContactStatus = 'ready_to_reach_out' | 'contact_pending' | 'no_contact_available'
export type ContactEmailSource = 'direct' | 'organizer_provided' | 'extracted' | null
export type ContactEmailConfidence = 'high' | 'medium' | 'low' | null

export type DiscoveryCandidateResponse = {
  candidate_id: string
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
  contact_status: ContactStatus
  extraction_status: string | null
  fit_score: number
  status: string
  dismissed_at: string | null
  google_rating: number | null
  google_user_ratings_total: number | null
  photo_urls: string[]
  photos: DiscoveryVenuePhoto[]
  metadata: Json
  quote_required: boolean
  verification_status: 'unverified_quote_required' | null
  candidate_label: string | null
}

export type ContactResolution = {
  email: string | null
  source: ContactEmailSource
  confidence: ContactEmailConfidence
  status: ContactStatus
}

export type DiscoveryVenuePhoto = {
  name: string
  heightPx?: number
  widthPx?: number
  authorAttributions?: Array<{
    displayName?: string
    uri?: string
  }>
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
  }
) {
  return {
    name: place.displayName.text,
    address: place.formattedAddress ?? null,
    neighborhood: input.neighborhood,
    city: inferCity(place.formattedAddress) ?? 'San Francisco',
    state: 'CA',
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    contact_phone: place.nationalPhoneNumber ?? null,
    website: place.websiteUri ?? null,
    source: 'google_places',
    source_external_id: place.id,
    google_rating: place.rating ?? null,
    google_user_ratings_total: place.userRatingCount ?? null,
    photos: sanitizePlacesPhotos(place.photos) as Json,
    metadata: {
      google_primary_type: place.primaryType ?? null,
      google_types: place.types ?? [],
      google_price_level: place.priceLevel ?? null,
      google_business_status: place.businessStatus ?? null,
      places_search_query: input.searchQuery,
      places_request: input.request,
    } as Json,
    website_extraction_status: place.websiteUri ? 'never_attempted' : null,
  }
}

export function resolveDiscoveryVenueContact(venue: DiscoveryVenueRow): ContactResolution {
  const directEmail = normalizeEmail(venue.contact_email)
  if (directEmail) {
    return {
      email: directEmail,
      source: 'direct',
      confidence: 'high',
      status: 'ready_to_reach_out',
    }
  }

  const organizerEmail = readLatestOrganizerEmail(venue.organizer_provided_emails)
  if (organizerEmail) {
    return {
      email: organizerEmail,
      source: 'organizer_provided',
      confidence: 'high',
      status: 'ready_to_reach_out',
    }
  }

  const extractedEmail = readBestExtractedEmail(venue.extracted_emails)
  if (extractedEmail) {
    return {
      email: extractedEmail.email,
      source: 'extracted',
      confidence: extractedEmail.confidence >= 0.8 ? 'high' : 'medium',
      status: 'ready_to_reach_out',
    }
  }

  return {
    email: null,
    source: null,
    confidence: null,
    status: venue.website ? 'contact_pending' : 'no_contact_available',
  }
}

export function buildDiscoveryCandidateResponses(
  plan: Plan,
  rows: CandidateWithVenue[]
): DiscoveryCandidateResponse[] {
  const scoreByVenueId = rankDiscoveryVenues(plan, rows.map((row) => row.venue))
  const specialSupply = readPlanSpecialSupply(plan)

  return rows
    .map(({ candidate, venue }) => {
      const contact = resolveDiscoveryVenueContact(venue)
      const fitScore = candidate.fit_score ?? scoreByVenueId.get(venue.id) ?? 0
      return {
        candidate_id: candidate.id,
        discovery_venue_id: venue.id,
        name: venue.name,
        address: venue.address,
        neighborhood: venue.neighborhood,
        city: venue.city,
        state: venue.state,
        website: venue.website,
        contact_phone: venue.contact_phone,
        contact_email: contact.email,
        contact_email_source: contact.source,
        contact_email_confidence: contact.confidence,
        contact_status: contact.status,
        extraction_status: venue.website_extraction_status,
        fit_score: fitScore,
        status: candidate.status,
        dismissed_at: candidate.dismissed_at,
        google_rating: venue.google_rating,
        google_user_ratings_total: venue.google_user_ratings_total,
        photo_urls: buildPhotoUrls(venue.id, venue.photos),
        photos: readPlacesPhotos(venue.photos).slice(0, 3),
        metadata: venue.metadata,
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

export function mapDiscoveryVenueToCatalogVenue(row: DiscoveryVenueRow): CatalogVenueRankingInput {
  const metadata = readRecord(row.metadata)
  return {
    id: row.id,
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
      ...readStringArray(metadata?.google_types),
    ],
    capacity: row.capacity_cocktail ?? row.capacity_standing ?? row.capacity_seated ?? null,
    standing_capacity: row.capacity_standing,
    seated_capacity: row.capacity_seated,
    estimate_cents: row.price_hint_cents_high ?? row.price_hint_cents_low ?? null,
    rating: row.google_rating,
    review_count: row.google_user_ratings_total,
    source: row.source,
    source_external_id: row.source_external_id,
    is_claimed: row.is_claimed,
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
  if (!Array.isArray(value)) return null

  const candidates = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    const email = normalizeEmail(record.email)
    if (!email || shouldSkipEmail(email)) return []
    const confidence = readNumber(record.confidence) ?? 0
    const likely = record.is_likely_booking_contact === true
    if (!likely && confidence < 0.7) return []
    return [{ email, confidence: likely ? Math.max(confidence, 0.8) : confidence }]
  })

  return candidates.sort((first, second) => second.confidence - first.confidence)[0] ?? null
}

export function readPlacesPhotos(value: Json): DiscoveryVenuePhoto[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): DiscoveryVenuePhoto[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    const name = readString(record.name)
    if (!name) return []
    return [{
      name,
      heightPx: readNumber(record.heightPx) ?? undefined,
      widthPx: readNumber(record.widthPx) ?? undefined,
      authorAttributions: readAuthorAttributions(record.authorAttributions),
    }]
  })
}

function sanitizePlacesPhotos(value: unknown): DiscoveryVenuePhoto[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): DiscoveryVenuePhoto[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    const name = readString(record.name)
    if (!name) return []
    return [{
      name,
      heightPx: readNumber(record.heightPx) ?? undefined,
      widthPx: readNumber(record.widthPx) ?? undefined,
      authorAttributions: readAuthorAttributions(record.authorAttributions),
    }]
  }).slice(0, 10)
}

function readAuthorAttributions(value: unknown): DiscoveryVenuePhoto['authorAttributions'] {
  if (!Array.isArray(value)) return undefined
  const attributions = value.flatMap((entry): NonNullable<DiscoveryVenuePhoto['authorAttributions']> => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    const displayName = readString(record.displayName)
    const uri = readString(record.uri)
    if (!displayName && !uri) return []
    return [{ displayName: displayName ?? undefined, uri: uri ?? undefined }]
  })
  return attributions.length > 0 ? attributions : undefined
}

function buildPhotoUrls(venueId: string, photos: Json): string[] {
  return readPlacesPhotos(photos)
    .slice(0, 3)
    .map((_photo, index) => `/api/planner/discovery-venues/${encodeURIComponent(venueId)}/photo/${index}`)
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
  if (status === 'contact_pending') return 1
  return 2
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
