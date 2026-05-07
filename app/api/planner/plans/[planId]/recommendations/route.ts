/**
 * API route for Agent Planner recommendations on a single plan.
 *
 * Purpose:
 * - POST generates deterministic venue recommendations from existing platform venues.
 * - GET returns existing recommendations for the plan.
 *
 * Route inputs:
 * - Path param: `planId`.
 *
 * Key behaviors:
 * - Filters venues by capacity, budget fit, published status, and optional neighborhood.
 * - Scores top matches by capacity fit, price-to-budget ratio, and AV-style feature tags.
 * - Inserts ranked recommendation rows and logs generation to `audit_logs`.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PLAN_SELECT_COLUMNS, RECOMMENDATION_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { createClient } from '@/lib/supabase/server'
import type {
  Json,
  Plan,
  PlannerApiErrorResponse,
  PlannerRecommendationWithVenue,
  PlannerRecommendationsResponse,
  PlannerVenueRecommendationDetails,
  Recommendation,
} from '@/lib/types'
import { normalizeVenue, VENUE_SELECT_COLUMNS, type VenueRow } from '@/lib/venues/venue-adapter'

type PlannerDb = { from: (table: string) => any }
type AuthResult =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const recommendationInsertSchema = z.object({
  kind: z.enum(['venue', 'vendor']),
  partnerId: z.string().uuid().nullable().optional(),
  fitLabel: z.string().trim().min(1).max(160),
  estimateCents: z.number().int().nonnegative().nullable().optional(),
  capacity: z.number().int().nonnegative().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  reasoning: z.string().trim().max(1000).nullable().optional(),
})

const generateRecommendationsSchema = z.object({
  recommendations: z.array(recommendationInsertSchema).min(1).max(3).optional(),
}).strict()

interface RouteContext {
  params: {
    planId: string
  }
}

interface ScoredVenue {
  venue: PlannerVenueRecommendationDetails
  estimatedPriceCents: number
  rankScore: number
  notes: string
  metadata: Json
}

/**
 * Returns existing recommendations for a plan, enriched with venue details where possible.
 *
 * @param request - Next.js request with auth cookies.
 * @param context - Route params containing `planId`.
 * @returns JSON response containing recommendation rows.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<PlannerRecommendationsResponse | PlannerApiErrorResponse>> {
  try {
    const auth = await getAuthenticatedPlannerDb()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const recommendations = await loadRecommendationsWithVenues(auth.db, context.params.planId)
    return NextResponse.json({ recommendations })
  } catch (error) {
    console.error('Planner recommendations GET error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

/**
 * Generates and persists the top three deterministic venue recommendations for a plan.
 *
 * Venue scoring:
 * - Capacity fit favors the smallest venue that can still hold the expected guest count.
 * - Budget fit favors estimated rental cost near, but under, 60% of the plan budget cap.
 * - AV fit gives a small boost when feature tags mention AV, stage, sound, projector, or wifi.
 *
 * @param request - Next.js request with auth cookies.
 * @param context - Route params containing `planId`.
 * @returns JSON response containing newly inserted recommendation rows with venue details.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<PlannerRecommendationsResponse | PlannerApiErrorResponse>> {
  try {
    const auth = await getAuthenticatedPlannerDb()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const body = generateRecommendationsSchema.safeParse(await readOptionalJsonBody(request))
    if (!body.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: body.error.flatten() as Json },
        { status: 400 }
      )
    }

    if (body.data.recommendations) {
      const inserts = body.data.recommendations.map((recommendation, index) => ({
        plan_id: plan.id,
        type: recommendation.kind,
        reference_id: recommendation.partnerId ?? null,
        external_name: null,
        price_cents: recommendation.estimateCents ?? null,
        notes: recommendation.reasoning ?? null,
        rank: Math.min(index + 1, 3),
        is_best_fit: index === 0,
        status: 'pending',
        metadata: toJson({
          fit_label: recommendation.fitLabel,
          capacity: recommendation.capacity ?? null,
          tags: recommendation.tags,
        }),
      }))

      const { data, error } = await auth.db
        .from('recommendations')
        .insert(inserts)
        .select(RECOMMENDATION_SELECT_COLUMNS)

      if (error) {
        console.error('Planner bulk recommendation insert error:', error)
        return NextResponse.json({ error: 'Failed to create recommendations' }, { status: 500 })
      }

      return NextResponse.json({
        recommendations: ((data ?? []) as Recommendation[]).map((recommendation) => ({
          ...recommendation,
          venue: null,
        })),
      })
    }

    if (!plan.guest_count || !plan.budget_cap_cents) {
      return NextResponse.json(
        { error: 'Plan needs guest_count and budget_cap_cents before recommendations' },
        { status: 400 }
      )
    }

    const scoredVenues = await scoreVenueRecommendations(auth.db, plan)
    const topThree = scoredVenues.slice(0, 3)

    if (topThree.length === 0) {
      return NextResponse.json({ recommendations: [] })
    }

    const inserts = topThree.map((scoredVenue, index) => ({
      plan_id: plan.id,
      type: 'venue',
      reference_id: scoredVenue.venue.id,
      external_name: null,
      price_cents: scoredVenue.estimatedPriceCents,
      notes: scoredVenue.notes,
      rank: index + 1,
      is_best_fit: index === 0,
      status: 'pending',
      metadata: scoredVenue.metadata,
    }))

    const { data, error } = await auth.db
      .from('recommendations')
      .insert(inserts)
      .select(RECOMMENDATION_SELECT_COLUMNS)

    if (error) {
      console.error('Planner recommendation insert error:', error)
      return NextResponse.json({ error: 'Failed to create recommendations' }, { status: 500 })
    }

    const venueById = new Map(topThree.map((scoredVenue) => [scoredVenue.venue.id, scoredVenue.venue]))
    const recommendations = ((data ?? []) as Recommendation[]).map((recommendation) => ({
      ...recommendation,
      venue: recommendation.reference_id ? venueById.get(recommendation.reference_id) ?? null : null,
    }))

    await insertAuditLog(auth.db, {
      user_id: auth.userId,
      plan_id: plan.id,
      action: 'planner.recommendations.generated',
      entity_type: 'recommendation',
      entity_id: null,
      before_state: null,
      after_state: toJson({ recommendation_ids: recommendations.map((item) => item.id) }),
      ip_address: getIpAddress(request),
    })

    return NextResponse.json({ recommendations })
  } catch (error) {
    console.error('Planner recommendations POST error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

async function getAuthenticatedPlannerDb(): Promise<AuthResult> {
  const supabase = createClient()
  const db = supabase as unknown as PlannerDb
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    }
  }

  const userType = user.user_metadata?.user_type
  if (userType !== 'community_builder') {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    }
  }

  return { db, userId: user.id }
}

async function loadOwnedPlan(db: PlannerDb, planId: string, userId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('Planner load plan error:', error)
    return null
  }

  return (data as Plan | null) ?? null
}

async function scoreVenueRecommendations(db: PlannerDb, plan: Plan): Promise<ScoredVenue[]> {
  const budgetCapCents = plan.budget_cap_cents ?? 0
  const budgetVenueCapCents = budgetCapCents * 0.6

  let query = db
    .from('venues')
    .select(VENUE_SELECT_COLUMNS)
    .eq('is_published', true)
    .gte('standing_capacity', plan.guest_count ?? 0)
    .limit(50)

  if (plan.neighborhood) {
    const escapedNeighborhood = escapeSupabaseOrValue(plan.neighborhood)
    query = query.or(`city.ilike.%${escapedNeighborhood}%,address.ilike.%${escapedNeighborhood}%`)
  }

  const { data, error } = await query
  if (error) {
    console.error('Planner venue recommendation query error:', error)
    return []
  }

  return ((data ?? []) as VenueRow[])
    .map((row) => scoreVenue(row, plan, budgetVenueCapCents))
    .filter((venue): venue is ScoredVenue => Boolean(venue))
    .sort((a, b) => a.rankScore - b.rankScore)
}

function scoreVenue(
  row: VenueRow,
  plan: Plan,
  budgetVenueCapCents: number
): ScoredVenue | null {
  const normalized = normalizeVenue(row)
  const capacity = normalized.capacity
  // cents from DB — do not convert here
  const hourlyRateCents = readNumber(row.hourly_rate)
  const minimumHours = readNumber(row.minimum_hours) ?? 4

  if (!capacity || capacity < (plan.guest_count ?? 0)) return null
  if (!hourlyRateCents) return null

  const estimatedPriceCents = Math.round(hourlyRateCents * minimumHours)
  if (budgetVenueCapCents > 0 && estimatedPriceCents > budgetVenueCapCents) return null

  const featureTags = Array.isArray(row.unique_features_tags)
    ? row.unique_features_tags.map(String)
    : []
  const hasAv = featureTags.some((tag) => /\b(av|stage|sound|projector|screen|wifi|gbps)\b/i.test(tag))
  const capacityScore = Math.abs(capacity - (plan.guest_count ?? capacity)) / Math.max(plan.guest_count ?? 1, 1)
  const priceRatio = budgetVenueCapCents > 0 ? estimatedPriceCents / budgetVenueCapCents : 1
  const priceScore = Math.abs(0.75 - priceRatio)
  const avScore = hasAv ? 0 : 0.2
  const rankScore = capacityScore + priceScore + avScore

  const venue: PlannerVenueRecommendationDetails = {
    id: normalized.id,
    name: normalized.name,
    neighborhood: normalized.city || normalized.address || null,
    capacity,
    hourly_rate: Math.round(hourlyRateCents),
    minimum_hours: minimumHours,
    feature_tags: featureTags,
  }

  return {
    venue,
    estimatedPriceCents,
    rankScore,
    notes: hasAv
      ? 'Capacity and budget fit with AV-adjacent features available.'
      : 'Capacity and budget fit; confirm AV package before booking.',
    metadata: toJson({
      scoring: {
        capacity_score: capacityScore,
        price_score: priceScore,
        av_score: avScore,
        rank_score: rankScore,
      },
      estimated_price_cents: estimatedPriceCents,
      minimum_hours: minimumHours,
      has_av_signal: hasAv,
    }),
  }
}

async function loadRecommendationsWithVenues(
  db: PlannerDb,
  planId: string
): Promise<PlannerRecommendationWithVenue[]> {
  const { data, error } = await db
    .from('recommendations')
    .select(RECOMMENDATION_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .order('rank', { ascending: true })

  if (error) {
    console.error('Planner recommendation list error:', error)
    return []
  }

  const recommendations = (data ?? []) as Recommendation[]
  const venueIds = recommendations
    .filter((recommendation) => recommendation.type === 'venue' && recommendation.reference_id)
    .map((recommendation) => recommendation.reference_id as string)

  if (venueIds.length === 0) {
    return recommendations.map((recommendation) => ({ ...recommendation, venue: null }))
  }

  const { data: venueRows, error: venueError } = await db
    .from('venues')
    .select(VENUE_SELECT_COLUMNS)
    .in('id', venueIds)

  if (venueError) {
    console.error('Planner recommendation venue join error:', venueError)
    return recommendations.map((recommendation) => ({ ...recommendation, venue: null }))
  }

  const venues = new Map(
    ((venueRows ?? []) as VenueRow[]).map((row) => {
      const normalized = normalizeVenue(row)
      return [
        normalized.id,
        {
          id: normalized.id,
          name: normalized.name,
          neighborhood: normalized.city || normalized.address || null,
          capacity: normalized.capacity,
          // cents from DB — do not convert here
          hourly_rate: normalized.hourly_rate ? Math.round(normalized.hourly_rate) : null,
          minimum_hours: readNumber(row.minimum_hours),
          feature_tags: Array.isArray(row.unique_features_tags)
            ? row.unique_features_tags.map(String)
            : [],
        } satisfies PlannerVenueRecommendationDetails,
      ]
    })
  )

  return recommendations.map((recommendation) => ({
    ...recommendation,
    venue: recommendation.reference_id ? venues.get(recommendation.reference_id) ?? null : null,
  }))
}

async function insertAuditLog(
  db: PlannerDb,
  payload: {
    user_id: string
    plan_id: string | null
    action: string
    entity_type: string
    entity_id: string | null
    before_state: Json | null
    after_state: Json | null
    ip_address: string | null
  }
) {
  const { error } = await db.from('audit_logs').insert(payload)
  if (error) console.error('Planner audit log insert error:', error)
}

function readNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function escapeSupabaseOrValue(value: string): string {
  return value.replace(/[%(),]/g, '')
}

async function readOptionalJsonBody(request: NextRequest): Promise<Record<string, never>> {
  const hasBody = Number(request.headers.get('content-length') ?? 0) > 0
  if (!hasBody) return {}

  return (await request.json()) as Record<string, never>
}

function getIpAddress(request: NextRequest): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
}

function toJson(value: Record<string, unknown>): Json {
  return value as Json
}
