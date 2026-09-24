export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import {
  buildDiscoveryCandidateResponses, searchPlacesForPlan, DISCOVERY_VENUE_SELECT,
  type DiscoveryVenueRow, type PlanDiscoveryVenueCandidateRow,
} from '@/lib/server/places-outreach'
import { GooglePlacesApiError, GooglePlacesConfigurationError, type GooglePlacesIncludedType } from '@/lib/server/google-places-client'
import { isGoogleVenueEnabled } from '@/lib/server/google-places-flags'
import { readSafeDiscoveryVenue, SAFE_VENUE_TABLE } from '@/lib/discovery/venueRepository'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { Json, Plan, PlannerApiErrorResponse } from '@/lib/types'

type RouteContext = {
  params: Promise<{
    planId: string
  }>
}

type PlannerAuth =
  | { userId: string; db: ReturnType<typeof createClient> }
  | { response: NextResponse<PlannerApiErrorResponse> }

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

    const plan = await loadOwnedPlan(auth.db, (await context.params).planId, auth.userId)
    if (!plan) return venueJson({ error: 'Plan not found' }, { status: 404 })

    const candidates = await loadPlanCandidates((await context.params).planId)
    const responseCandidates = buildDiscoveryCandidateResponses(plan, candidates)
    return venueJson({
      candidates: responseCandidates,
      summary: summarizeCandidates(responseCandidates),
    })
  } catch (error) {
    console.error('[planner.discover-venues] GET failed', error)
    return venueJson({ error: 'Failed to load discovered venues' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response
    const plan = await loadOwnedPlan(auth.db, (await context.params).planId, auth.userId)
    if (!plan) return venueJson({ error: 'Plan not found' }, { status: 404 })
    const parsed = discoverVenuesSchema.safeParse(await readOptionalJsonBody(request))
    if (!parsed.success) return venueJson({ error: 'Invalid request body', details: parsed.error.flatten() as Json }, { status: 400 })
    if (!isGoogleVenueEnabled()) {
      const candidates = buildDiscoveryCandidateResponses(plan, await loadPlanCandidates(plan.id))
      return venueJson({ candidates, summary: summarizeCandidates(candidates), google_live_overlays: {},
        places_request: null, places_requests: [], places_result_counts: { total: 0, by_type: {} }, discovery_status: 'disabled' }, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    const apiKey = process.env.GOOGLE_PLACES_API_KEY
    if (!apiKey) return venueJson({ error: 'GOOGLE_PLACES_API_KEY is not configured' }, { status: 500 })
    const metadata = plan.metadata && typeof plan.metadata === 'object' && !Array.isArray(plan.metadata) ? plan.metadata : {}
    const city = typeof metadata.city === 'string' ? metadata.city : null
    const result = await searchPlacesForPlan(plan, { admin: createServiceRoleClient(), apiKey,
      areas: [plan.neighborhood || city || 'Bay Area'], maxResultCount: parsed.data.maxResultCount,
      query: parsed.data.query, searchedByUserId: auth.userId })
    const candidates = buildDiscoveryCandidateResponses(plan, await loadPlanCandidates(plan.id))
    return venueJson({ candidates, summary: summarizeCandidates(candidates),
      google_live_overlays: result.google_live_overlays,
      places_request: { text_query: result.search_query }, places_requests: result.places_requests,
      places_result_counts: result.places_result_counts }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof GooglePlacesConfigurationError) return venueJson({ error: 'Venue discovery is unavailable' }, { status: 500 })
    if (error instanceof GooglePlacesApiError) return venueJson({ error: 'Venue discovery is unavailable' }, { status: error.status === 429 ? 429 : 502 })
    console.error('[planner.discover-venues] POST failed', { category: error instanceof Error ? error.name : 'unknown' })
    return venueJson({ error: 'Failed to discover venues' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{ candidates: ReturnType<typeof buildDiscoveryCandidateResponses>; summary: DiscoverySummary } | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, (await context.params).planId, auth.userId)
    if (!plan) return venueJson({ error: 'Plan not found' }, { status: 404 })

    const parsed = updateCandidateSchema.safeParse(await readOptionalJsonBody(request))
    if (!parsed.success) {
      return venueJson(
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
      return venueJson({ error: 'Failed to skip venue' }, { status: 500 })
    }

    if (!data) {
      return venueJson({ error: 'Discovery venue not found' }, { status: 404 })
    }

    const candidates = await loadPlanCandidates((await context.params).planId)
    const responseCandidates = buildDiscoveryCandidateResponses(plan, candidates)
    return venueJson({
      candidates: responseCandidates,
      summary: summarizeCandidates(responseCandidates),
    })
  } catch (error) {
    console.error('[planner.discover-venues] PATCH failed', error)
    return venueJson({ error: 'Failed to skip venue' }, { status: 500 })
  }
}

async function getPlannerAuth(): Promise<PlannerAuth> {
  const supabase = createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { response: venueJson({ error: 'Not authenticated' }, { status: 401 }) }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: venueJson({ error: 'Unauthorized' }, { status: 403 }) }
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
    .from(SAFE_VENUE_TABLE as any)
    .select(DISCOVERY_VENUE_SELECT)
    .in('id', candidateRows.map((candidate) => candidate.discovery_venue_id))
    .returns<DiscoveryVenueRow[]>()

  if (venueError) throw new Error(venueError.message)
  const venueById = new Map((venues ?? []).map((venue) => [venue.id, readSafeDiscoveryVenue(venue)]))
  return candidateRows.flatMap((candidate) => {
    const venue = venueById.get(candidate.discovery_venue_id)
    return venue ? [{ candidate, venue }] : []
  })
}

type DiscoverySummary = {
  total: number
  ready_to_reach_out: number
  contact_form_available: number
  contact_link_available: number
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
    contact_form_available: candidates.filter((candidate) => candidate.contact_status === 'contact_form_available').length,
    contact_link_available: candidates.filter((candidate) => candidate.contact_status === 'contact_link_available').length,
    contact_pending: candidates.filter((candidate) => candidate.contact_status === 'contact_pending').length,
    no_contact_available: candidates.filter((candidate) => candidate.contact_status === 'no_contact_available').length,
  }
}

async function readOptionalJsonBody(request: NextRequest) {
  const text = await request.text()
  if (!text.trim()) return {}
  return JSON.parse(text) as unknown
}


function venueJson<T>(body: T, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('Cache-Control', 'private, no-store, max-age=0')
  headers.set('CDN-Cache-Control', 'no-store')
  headers.set('Vercel-CDN-Cache-Control', 'no-store')
  return NextResponse.json(body, { ...init, headers })
}
