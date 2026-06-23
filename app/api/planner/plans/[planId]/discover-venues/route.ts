export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import {
  buildDiscoveryCandidateResponses,
  buildDefaultDiscoverySearchQuery,
  buildDiscoveryVenueInsert,
  rankDiscoveryVenues,
  type DiscoveryVenueRow,
  type PlanDiscoveryVenueCandidateRow,
} from '@/lib/server/places-outreach'
import {
  GooglePlacesApiError,
  GooglePlacesConfigurationError,
  type GooglePlacesIncludedType,
  type GooglePlacesSearchResult,
  searchGooglePlacesText,
} from '@/lib/server/google-places-client'
import { resolvePlacesIntent } from '@/lib/server/places-archetype-intent'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { Json, Plan, PlannerApiErrorResponse } from '@/lib/types'

type RouteContext = {
  params: {
    planId: string
  }
}

type PlannerAuth =
  | { userId: string; db: ReturnType<typeof createClient> }
  | { response: NextResponse<PlannerApiErrorResponse> }

const DISCOVERY_VENUE_SELECT = `
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
  google_photo_names,
  photos,
  opening_hours_json,
  metadata,
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
  website_extraction_status
`

const discoverVenuesSchema = z.object({
  query: z.string().trim().min(2).max(180).optional(),
  maxResultCount: z.number().int().min(1).max(20).optional(),
}).strict()

const updateCandidateSchema = z.object({
  discovery_venue_id: z.string().uuid(),
  action: z.literal('dismiss'),
}).strict()

export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{ candidates: ReturnType<typeof buildDiscoveryCandidateResponses>; summary: DiscoverySummary } | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const candidates = await loadPlanCandidates(context.params.planId)
    const responseCandidates = buildDiscoveryCandidateResponses(plan, candidates)
    return NextResponse.json({
      candidates: responseCandidates,
      summary: summarizeCandidates(responseCandidates),
    })
  } catch (error) {
    console.error('[planner.discover-venues] GET failed', error)
    return NextResponse.json({ error: 'Failed to load discovered venues' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{
  candidates: ReturnType<typeof buildDiscoveryCandidateResponses>
  summary: DiscoverySummary
  places_request: Json
  places_requests: Json
  places_result_counts: PlacesResultCounts
} | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const parsed = discoverVenuesSchema.safeParse(await readOptionalJsonBody(request))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'GOOGLE_PLACES_API_KEY is not configured' }, { status: 500 })
    }

    const searchQuery = parsed.data.query ?? buildDefaultDiscoverySearchQuery(plan)
    const maxResultCount = parsed.data.maxResultCount ?? 8
    const placesIntent = resolvePlacesIntent(plan.event_type, buildPlacesIntentHints(plan))
    const placesResults = await Promise.all(placesIntent.primary_types.map((includedType) =>
      searchGooglePlacesText({
        apiKey,
        textQuery: searchQuery,
        eventType: plan.event_type,
        neighborhood: plan.neighborhood,
        city: readPlanCity(plan),
        includedType,
        maxResultCount,
      })
    ))
    const placesResultCounts = summarizePlacesResults(placesResults)
    const dedupedPlaces = dedupePlacesByGoogleId(placesResults).slice(0, maxResultCount)
    const placesRequestBundle = {
      text_query: searchQuery,
      intent: {
        primary_types: [...placesIntent.primary_types],
        cluster_label: placesIntent.cluster_label,
        venue_style: placesIntent.venue_style,
        subspace_keywords: [...placesIntent.subspace_keywords],
      },
      result_counts: placesResultCounts,
      requests: placesResults.map((result) => result.request),
    }

    const admin = createServiceRoleClient()
    const upsertedVenues: DiscoveryVenueRow[] = []
    for (const { place, request: placesRequest, matchedIncludedType } of dedupedPlaces) {
      const insert = buildDiscoveryVenueInsert(place, {
        request: placesRequest,
        searchQuery,
        neighborhood: plan.neighborhood,
        intent: placesIntent,
        matchedIncludedType,
      })
      const { data, error } = await admin
        .from('discovery_venues')
        .upsert(insert, { onConflict: 'source,source_external_id' })
        .select(DISCOVERY_VENUE_SELECT)
        .single()

      if (error || !data) {
        console.error('[planner.discover-venues] discovery_venue_upsert_failed', {
          error: error?.message,
          place_id: place.id,
        })
        continue
      }
      upsertedVenues.push(data as DiscoveryVenueRow)
    }

    if (upsertedVenues.length > 0) {
      const scoreByVenueId = rankDiscoveryVenues(plan, upsertedVenues)
      const candidateInserts = upsertedVenues.map((venue) => ({
        plan_id: plan.id,
        discovery_venue_id: venue.id,
        searched_by_user_id: auth.userId,
        search_query: searchQuery,
        archetype_id: plan.event_type,
        neighborhood: plan.neighborhood,
        fit_score: scoreByVenueId.get(venue.id) ?? null,
        status: 'candidate',
        dismissed_at: null,
        places_request_json: placesRequestBundle as unknown as Json,
      }))

      const { error } = await admin
        .from('plan_discovery_venue_candidates')
        .upsert(candidateInserts, { onConflict: 'plan_id,discovery_venue_id' })

      if (error) {
        console.error('[planner.discover-venues] candidate_upsert_failed', { error: error.message })
        return NextResponse.json({ error: 'Failed to attach discovered venues to plan' }, { status: 500 })
      }
    }

    const candidates = await loadPlanCandidates(context.params.planId)
    const responseCandidates = buildDiscoveryCandidateResponses(plan, candidates)
    return NextResponse.json({
      candidates: responseCandidates,
      summary: summarizeCandidates(responseCandidates),
      places_request: placesRequestBundle as unknown as Json,
      places_requests: placesResults.map((result) => result.request) as Json,
      places_result_counts: placesResultCounts,
    })
  } catch (error) {
    if (error instanceof GooglePlacesConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (error instanceof GooglePlacesApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status === 429 ? 429 : 502 })
    }

    console.error('[planner.discover-venues] POST failed', error)
    return NextResponse.json({ error: 'Failed to discover venues' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{ candidates: ReturnType<typeof buildDiscoveryCandidateResponses>; summary: DiscoverySummary } | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const parsed = updateCandidateSchema.safeParse(await readOptionalJsonBody(request))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const admin = createServiceRoleClient()
    const { data, error } = await admin
      .from('plan_discovery_venue_candidates')
      .update({
        status: 'dismissed',
        dismissed_at: new Date().toISOString(),
      })
      .eq('plan_id', plan.id)
      .eq('discovery_venue_id', parsed.data.discovery_venue_id)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('[planner.discover-venues] candidate_dismiss_failed', {
        error: error.message,
        plan_id: plan.id,
        discovery_venue_id: parsed.data.discovery_venue_id,
      })
      return NextResponse.json({ error: 'Failed to skip venue' }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: 'Discovery venue not found' }, { status: 404 })
    }

    const candidates = await loadPlanCandidates(context.params.planId)
    const responseCandidates = buildDiscoveryCandidateResponses(plan, candidates)
    return NextResponse.json({
      candidates: responseCandidates,
      summary: summarizeCandidates(responseCandidates),
    })
  } catch (error) {
    console.error('[planner.discover-venues] PATCH failed', error)
    return NextResponse.json({ error: 'Failed to skip venue' }, { status: 500 })
  }
}

async function getPlannerAuth(): Promise<PlannerAuth> {
  const supabase = createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  return { db: supabase, userId: user.id }
}

async function loadOwnedPlan(db: ReturnType<typeof createClient>, planId: string, userId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[planner.discover-venues] plan_lookup_failed', { error: error.message })
    return null
  }

  return (data as Plan | null) ?? null
}

async function loadPlanCandidates(planId: string) {
  const admin = createServiceRoleClient()
  const { data: candidates, error } = await admin
    .from('plan_discovery_venue_candidates')
    .select('*')
    .eq('plan_id', planId)
    .is('dismissed_at', null)
    .order('fit_score', { ascending: false, nullsFirst: false })
    .returns<PlanDiscoveryVenueCandidateRow[]>()

  if (error) throw new Error(error.message)
  const candidateRows = candidates ?? []
  if (candidateRows.length === 0) return []

  const { data: venues, error: venueError } = await admin
    .from('discovery_venues')
    .select(DISCOVERY_VENUE_SELECT)
    .in('id', candidateRows.map((candidate) => candidate.discovery_venue_id))
    .returns<DiscoveryVenueRow[]>()

  if (venueError) throw new Error(venueError.message)
  const venueById = new Map((venues ?? []).map((venue) => [venue.id, venue]))
  return candidateRows.flatMap((candidate) => {
    const venue = venueById.get(candidate.discovery_venue_id)
    return venue ? [{ candidate, venue }] : []
  })
}

type DiscoverySummary = {
  total: number
  ready_to_reach_out: number
  contact_pending: number
  no_contact_available: number
}

type PlacesResultCounts = {
  total: number
  by_type: Partial<Record<GooglePlacesIncludedType, number>>
}

function summarizeCandidates(candidates: ReturnType<typeof buildDiscoveryCandidateResponses>): DiscoverySummary {
  return {
    total: candidates.length,
    ready_to_reach_out: candidates.filter((candidate) => candidate.contact_status === 'ready_to_reach_out').length,
    contact_pending: candidates.filter((candidate) => candidate.contact_status === 'contact_pending').length,
    no_contact_available: candidates.filter((candidate) => candidate.contact_status === 'no_contact_available').length,
  }
}

async function readOptionalJsonBody(request: NextRequest) {
  const text = await request.text()
  if (!text.trim()) return {}
  return JSON.parse(text) as unknown
}

function readPlanCity(plan: Plan) {
  const metadata = plan.metadata && typeof plan.metadata === 'object' && !Array.isArray(plan.metadata)
    ? plan.metadata as Record<string, unknown>
    : null
  const city = metadata?.city
  return typeof city === 'string' && city.trim() ? city.trim() : null
}

function summarizePlacesResults(results: GooglePlacesSearchResult[]): PlacesResultCounts {
  const byType: PlacesResultCounts['by_type'] = {}
  for (const result of results) {
    const type = result.request.includedType
    if (!type) continue
    byType[type] = result.places.length
  }
  return {
    total: results.reduce((sum, result) => sum + result.places.length, 0),
    by_type: byType,
  }
}

function dedupePlacesByGoogleId(results: GooglePlacesSearchResult[]) {
  const byId = new Map<string, {
    place: GooglePlacesSearchResult['places'][number]
    request: GooglePlacesSearchResult['request']
    matchedIncludedType: GooglePlacesIncludedType | null
  }>()

  for (const result of results) {
    for (const place of result.places) {
      if (byId.has(place.id)) continue
      byId.set(place.id, {
        place,
        request: result.request,
        matchedIncludedType: result.request.includedType ?? null,
      })
    }
  }

  return [...byId.values()]
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

function extractSubspaceKeywords(text: string) {
  const matches = text.match(/\b(rooftop|ballroom|private dining|lounge|hotel|resort|lodging)\b/gi)
  return matches ? [...new Set(matches.map((match) => match.toLowerCase()))] : []
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
