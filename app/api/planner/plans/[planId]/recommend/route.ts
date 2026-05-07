export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  economicsAgentDefinition,
  runEconomicsAgent,
  type EconomicsAgentInput,
  type EconomicsAgentOutput,
  type EconomicsAgentResult,
} from '@/lib/ai/agents/economicsAgent'
import {
  runVenueMatchingAgent,
  venueMatchingAgentDefinition,
  type VenueMatchingAgentOutput,
  type VenueMatchingAgentResult,
} from '@/lib/ai/agents/venueMatchingAgent'
import { getAgentRunErrorMetadata } from '@/lib/ai/types'
import { calculateEventPlanningEconomics } from '@/lib/finance/eventPlanningEconomics'
import {
  rankCatalogPartners,
  type CatalogVendorRankingInput,
  type CatalogVenueRankingInput,
  type CatalogPlanRankingInput,
  type RankedCatalogRecommendation,
} from '@/lib/planner/catalogRanker'
import { PLAN_MESSAGE_SELECT_COLUMNS, PLAN_SELECT_COLUMNS, RECOMMENDATION_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { logAgentRun, type AgentRunDb } from '@/lib/server/agent-runs'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { Json, Plan, PlanMessage, PlannerApiErrorResponse, Recommendation } from '@/lib/types'
import {
  venueMatchingCandidateSchema,
  type VenueMatchingCandidate,
} from '@/lib/venues/venuePreFilter'

type PlannerDb = { from: (table: string) => any }
type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

interface RouteContext {
  params: {
    planId: string
  }
}

interface PlannerRecommendResponse {
  ranked_venues: VenueMatchingAgentOutput['ranked_venues']
  recommendations: VenueMatchingAgentOutput['ranked_venues']
  economics: EconomicsAgentOutput | null
  persisted_recommendation_ids: string[]
}

type VenueCostEstimate = {
  venueId: string
  estimatedCostCents: number | null
}

const recommendRequestSchema = z.object({
  limit: z.number().int().min(1).max(6).default(6),
  venueLimit: z.number().int().min(0).max(3).default(3),
  vendorLimit: z.number().int().min(0).max(3).default(3),
}).strict()

const VENUE_RANKER_SELECT_COLUMNS = `
  id,
  venue_name,
  description,
  venue_type,
  address,
  city,
  state,
  standing_capacity,
  seated_capacity,
  pricing_model,
  hourly_rate,
  minimum_hours,
  average_rating,
  total_bookings,
  unique_features,
  unique_features_tags,
  auto_approve_conditions,
  ticket_sales_share_enabled,
  ticket_sales_share_pct,
  bar_rev_share_enabled,
  bar_rev_share_pct,
  bar_revenue_percentage,
  per_head_kickback,
  per_head_kickback_cents,
  is_claimed,
  is_admin_seeded,
  is_published
`

const VENDOR_RANKER_SELECT_COLUMNS = `
  id,
  name,
  vendor_type,
  service_type,
  bio,
  regions_served,
  service_area,
  pricing_model,
  hourly_rate,
  base_rate,
  per_person_rate,
  minimum_hours,
  average_rating,
  rating,
  review_count,
  total_bookings,
  total_gigs,
  compatible_features,
  services_offered,
  availability_notes,
  is_claimed,
  is_admin_seeded,
  is_published
`

const VENUE_AGENT_SELECT_COLUMNS = `
  id,
  venue_name,
  venue_type,
  standing_capacity,
  seated_capacity,
  city,
  state,
  hourly_rate,
  minimum_hours,
  is_published,
  per_head_kickback,
  offers_kickbacks,
  deposit_percentage,
  cancellation_terms,
  available_days,
  bar_revenue_share_enabled,
  venue_amenities (
    venue_id,
    amenity_name
  )
`

/**
 * Runs agent-backed recommendations for a persisted planner plan.
 * Falls back to the deterministic catalog ranker when OpenAI is not configured.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<PlannerRecommendResponse | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const body = recommendRequestSchema.safeParse(await readOptionalJsonBody(request))
    if (!body.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: body.error.flatten() as Json },
        { status: 400 }
      )
    }

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    if (plan.status !== 'ready') {
      return NextResponse.json(
        { error: 'Plan must be ready before recommendations can be generated' },
        { status: 400 }
      )
    }

    const messages = await loadConfirmationMessages(auth.db, plan.id)
    const rankingInput = buildRankingInput(plan, messages)

    if (!hasOpenAIKey()) {
      return runCatalogFallback({
        auth,
        plan,
        rankingInput,
        request,
        limit: body.data.limit,
        venueLimit: body.data.venueLimit,
        vendorLimit: body.data.vendorLimit,
      })
    }

    const eventPlan = buildAgentEventPlan(plan, rankingInput)
    const candidateVenues = await loadVenueAgentCandidates(auth.db, plan, rankingInput)
    const venuePayload = {
      event_plan: eventPlan,
      candidate_venues: candidateVenues,
      organizer_preferences: {
        budget_cap_cents: plan.budget_cap_cents,
        guest_count: plan.guest_count,
        neighborhood: plan.neighborhood,
      },
    }
    const venueResult = await runLoggedVenueMatchingAgent(auth.userId, plan.id, venuePayload)
    const economicsPayload = buildEconomicsPayload(
      plan,
      eventPlan,
      candidateVenues,
      venueResult.output.ranked_venues
    )
    const economicsResult = await runLoggedEconomicsAgent(auth.userId, plan.id, economicsPayload)

    const persisted = await persistAgentRecommendations(
      auth.db,
      plan.id,
      venueResult,
      economicsResult,
      buildVenueCostMap(candidateVenues)
    )

    await insertAuditLog(auth.db, {
      user_id: auth.userId,
      plan_id: plan.id,
      action: 'planner.agent_recommendations.generated',
      entity_type: 'recommendation',
      entity_id: null,
      before_state: null,
      after_state: toJson({
        recommendation_ids: persisted.map((recommendation) => recommendation.id),
        venue_ids: venueResult.output.ranked_venues.map((venue) => venue.venue_id),
        economics_agent: economicsResult.agent_name,
      }),
      ip_address: getIpAddress(request),
    })

    return NextResponse.json({
      ranked_venues: venueResult.output.ranked_venues,
      recommendations: venueResult.output.ranked_venues,
      economics: economicsResult.output,
      persisted_recommendation_ids: persisted.map((recommendation) => recommendation.id),
    })
  } catch (error) {
    console.error('[agent.run] Planner recommend POST error', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

async function runCatalogFallback(input: {
  auth: { db: PlannerDb; userId: string }
  plan: Plan
  rankingInput: CatalogPlanRankingInput
  request: NextRequest
  limit: number
  venueLimit: number
  vendorLimit: number
}): Promise<NextResponse<PlannerRecommendResponse>> {
  const [venues, vendors] = await Promise.all([
    loadCatalogVenues(input.auth.db),
    loadCatalogVendors(input.auth.db),
  ])
  const ranking = rankCatalogPartners({
    plan: input.rankingInput,
    venues,
    vendors,
    limit: input.limit,
    venueLimit: input.venueLimit,
    vendorLimit: input.vendorLimit,
  })

  if (ranking.rejected.length > 0) {
    console.info(
      '[planner.recommend] Rejected catalog candidates',
      ranking.rejected.map((recommendation) => ({
        partner_id: recommendation.partner_id,
        kind: recommendation.kind,
        name: recommendation.name,
        blocking_issues: recommendation.blocking_issues,
      }))
    )
  }

  const fallbackEconomics = buildFallbackEconomicsOutput(
    input.plan,
    buildAgentEventPlan(input.plan, input.rankingInput),
    ranking.recommendations
  )
  const rankedVenues = ranking.recommendations
    .filter((recommendation) => recommendation.kind === 'venue')
    .map(toRankedVenueFromCatalog)
  const persistedCatalogRecommendations = await persistRecommendations(
    input.auth.db,
    input.plan.id,
    ranking.recommendations
  )
  const persistedEconomicsRecommendation = await persistEconomicsRecommendation(
    input.auth.db,
    input.plan.id,
    fallbackEconomics,
    'catalog_fallback'
  )
  const persisted = [...persistedCatalogRecommendations, ...persistedEconomicsRecommendation]

  await insertAuditLog(input.auth.db, {
    user_id: input.auth.userId,
    plan_id: input.plan.id,
    action: 'planner.catalog_recommendations.generated',
    entity_type: 'recommendation',
    entity_id: null,
    before_state: null,
    after_state: toJson({
      recommendation_ids: persisted.map((recommendation) => recommendation.id),
      partner_ids: ranking.recommendations.map((recommendation) => recommendation.partner_id),
      fallback_reason: 'OPENAI_API_KEY is not configured',
    }),
    ip_address: getIpAddress(input.request),
  })

  return NextResponse.json({
    ranked_venues: rankedVenues,
    recommendations: rankedVenues,
    economics: fallbackEconomics,
    persisted_recommendation_ids: persisted.map((recommendation) => recommendation.id),
  })
}

async function runLoggedVenueMatchingAgent(
  userId: string,
  planId: string,
  payload: Record<string, unknown>
): Promise<VenueMatchingAgentResult> {
  const startedAt = Date.now()

  try {
    const result = await runVenueMatchingAgent(payload)
    await safeLogAgentRun({
      userId,
      planId,
      agentName: venueMatchingAgentDefinition.agentName,
      status: result.status,
      inputPayload: payload,
      outputPayload: result.output,
      durationMs: result.duration_ms,
      model: result.model,
      promptTokens: result.prompt_tokens,
      completionTokens: result.completion_tokens,
      messagesPayload: result.messages_payload,
      rawModelOutput: result.raw_model_output,
    })
    return result
  } catch (error) {
    const metadata = getAgentRunErrorMetadata(error)
    await safeLogAgentRun({
      userId,
      planId,
      agentName: venueMatchingAgentDefinition.agentName,
      status: 'failed',
      inputPayload: payload,
      outputPayload: null,
      error: error instanceof Error ? error.message : 'Unknown venue matching agent error',
      durationMs: Date.now() - startedAt,
      model: metadata.model ?? venueMatchingAgentDefinition.model,
      promptTokens: metadata.prompt_tokens ?? null,
      completionTokens: metadata.completion_tokens ?? null,
      messagesPayload: metadata.messages_payload ?? null,
      rawModelOutput: metadata.raw_model_output ?? null,
    })
    throw error
  }
}

async function runLoggedEconomicsAgent(
  userId: string,
  planId: string,
  payload: EconomicsAgentInput
): Promise<EconomicsAgentResult> {
  const startedAt = Date.now()

  try {
    const result = await runEconomicsAgent(payload)
    await safeLogAgentRun({
      userId,
      planId,
      agentName: economicsAgentDefinition.agentName,
      status: result.status,
      inputPayload: payload,
      outputPayload: result.output,
      durationMs: result.duration_ms,
      model: result.model,
      promptTokens: result.prompt_tokens,
      completionTokens: result.completion_tokens,
      messagesPayload: result.messages_payload,
      rawModelOutput: result.raw_model_output,
    })
    return result
  } catch (error) {
    const metadata = getAgentRunErrorMetadata(error)
    await safeLogAgentRun({
      userId,
      planId,
      agentName: economicsAgentDefinition.agentName,
      status: 'failed',
      inputPayload: payload,
      outputPayload: null,
      error: error instanceof Error ? error.message : 'Unknown economics agent error',
      durationMs: Date.now() - startedAt,
      model: metadata.model ?? economicsAgentDefinition.model,
      promptTokens: metadata.prompt_tokens ?? null,
      completionTokens: metadata.completion_tokens ?? null,
      messagesPayload: metadata.messages_payload ?? null,
      rawModelOutput: metadata.raw_model_output ?? null,
    })
    throw error
  }
}

async function safeLogAgentRun(input: {
  userId: string
  planId: string
  agentName: typeof venueMatchingAgentDefinition.agentName | typeof economicsAgentDefinition.agentName
  status: 'succeeded' | 'failed'
  inputPayload: Record<string, unknown>
  outputPayload?: unknown
  error?: string | null
  durationMs: number
  model: string
  promptTokens?: number | null
  completionTokens?: number | null
  messagesPayload?: unknown
  rawModelOutput?: string | null
}) {
  try {
    const admin = createServiceRoleClient() as unknown as AgentRunDb
    await logAgentRun(admin, {
      userId: input.userId,
      planId: input.planId,
      agentName: input.agentName,
      status: input.status,
      inputPayload: input.inputPayload,
      outputPayload: input.outputPayload ?? null,
      error: input.error ?? null,
      durationMs: input.durationMs,
      model: input.model,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      messagesPayload: input.messagesPayload ?? null,
      rawModelOutput: input.rawModelOutput ?? null,
    })
  } catch (error) {
    console.error('[planner.recommend] Failed to log agent run', error)
  }
}

async function getPlannerAuth(): Promise<PlannerAuth> {
  const supabase = createClient()
  const db = supabase as unknown as PlannerDb
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
    console.error('Planner catalog recommend plan lookup error:', error)
    return null
  }

  return (data as Plan | null) ?? null
}

async function loadConfirmationMessages(db: PlannerDb, planId: string): Promise<PlanMessage[]> {
  const { data, error } = await db
    .from('plan_messages')
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .eq('message_type', 'confirmation_card')
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error('Planner catalog recommend message lookup error:', error)
    return []
  }

  return (data ?? []) as PlanMessage[]
}

async function loadCatalogVenues(db: PlannerDb): Promise<CatalogVenueRankingInput[]> {
  const { data, error } = await db
    .from('venues')
    .select(VENUE_RANKER_SELECT_COLUMNS)
    .eq('is_published', true)
    .limit(200)

  if (error) {
    console.error('Planner catalog recommend venues lookup error:', error)
    return []
  }

  return ((data ?? []) as Record<string, unknown>[]).filter(hasStringId)
}

async function loadCatalogVendors(db: PlannerDb): Promise<CatalogVendorRankingInput[]> {
  const { data, error } = await db
    .from('vendor_profiles')
    .select(VENDOR_RANKER_SELECT_COLUMNS)
    .eq('is_published', true)
    .limit(200)

  if (error) {
    console.error('Planner catalog recommend vendors lookup error:', error)
    return []
  }

  return ((data ?? []) as Record<string, unknown>[]).filter(hasStringId)
}

async function loadVenueAgentCandidates(
  db: PlannerDb,
  plan: Plan,
  rankingInput: CatalogPlanRankingInput
): Promise<VenueMatchingCandidate[]> {
  let query = db
    .from('venues')
    .select(VENUE_AGENT_SELECT_COLUMNS)
    .eq('is_published', true)
    .limit(50)
  const headcount = readNumber(plan.guest_count ?? rankingInput.guest_count ?? rankingInput.headcount)
  const city = inferCity(rankingInput.neighborhood ?? rankingInput.area ?? plan.neighborhood)

  if (headcount !== null && headcount > 0) {
    query = query.or(`standing_capacity.gte.${headcount},seated_capacity.gte.${headcount}`)
  }

  if (city) {
    query = query.ilike('city', `%${escapeSupabaseOrValue(city)}%`)
  }

  const { data, error } = await query
  if (error) {
    console.error('[planner.recommend] Venue agent candidate lookup error', error)
    return []
  }

  return ((data ?? []) as Record<string, unknown>[])
    .map(toVenueMatchingCandidate)
    .filter((candidate): candidate is VenueMatchingCandidate => candidate !== null)
}

function buildRankingInput(plan: Plan, messages: PlanMessage[]): CatalogPlanRankingInput {
  const summary = readLatestSummary(messages)

  return {
    id: plan.id,
    headcount: plan.guest_count ?? readNumber(summary.guest_count),
    guest_count: plan.guest_count ?? readNumber(summary.guest_count),
    area: plan.neighborhood ?? readString(summary.area) ?? readString(summary.neighborhood),
    neighborhood: plan.neighborhood ?? readString(summary.neighborhood) ?? readString(summary.area),
    budget_cents: plan.budget_cap_cents ?? readNumber(summary.budget_cents),
    budget_cap_cents: plan.budget_cap_cents ?? readNumber(summary.budget_cap_cents ?? summary.budget_cents),
    event_type: plan.event_type ?? readString(summary.event_type),
    must_haves: readStringArray(summary.must_haves ?? summary.amenities ?? summary.requirements),
    ticketing_model: plan.ticketing_model ?? readString(summary.ticketing_model),
    food_responsibility: plan.food_responsibility ?? readString(summary.food_responsibility),
    venue_terms: plan.venue_terms ?? readString(summary.venue_terms),
    revenue_share: readString(summary.revenue_share),
    room_type: readString(summary.room_type),
    date_window:
      readString(summary.date) ??
      readString(summary.date_window) ??
      formatDateWindow(plan.date_window_start, plan.date_window_end),
    date_window_start: plan.date_window_start ?? readString(summary.date_window_start),
    date_window_end: plan.date_window_end ?? readString(summary.date_window_end),
  }
}

function buildAgentEventPlan(plan: Plan, rankingInput: CatalogPlanRankingInput) {
  const expectedAttendance = readNumber(plan.guest_count ?? rankingInput.guest_count ?? rankingInput.headcount)
  const budgetCents = readNumber(plan.budget_cap_cents ?? rankingInput.budget_cap_cents ?? rankingInput.budget_cents)
  const profitGoalCents = readNumber(plan.profit_goal_cents)
  const ticketPriceTargetCents = estimateTicketPriceTargetCents({
    ticketed: plan.ticketed,
    budgetCents,
    profitGoalCents,
    expectedAttendance,
  })

  return {
    event_name: plan.title || 'Untitled event plan',
    expected_attendance: expectedAttendance,
    city: inferCity(rankingInput.neighborhood ?? rankingInput.area ?? plan.neighborhood),
    venue_type: rankingInput.room_type ?? rankingInput.event_type ?? null,
    budget: budgetCents,
    event_date: rankingInput.date_window_start ?? rankingInput.date_window ?? null,
    monetization_model: plan.ticketed ? 'ticketed' : normalizeMonetizationModel(rankingInput.ticketing_model),
    headcount_min: expectedAttendance,
    headcount_max: expectedAttendance,
    ticket_price_target: ticketPriceTargetCents,
    profit_goal: profitGoalCents,
  }
}

function buildEconomicsPayload(
  plan: Plan,
  eventPlan: ReturnType<typeof buildAgentEventPlan>,
  candidateVenues: VenueMatchingCandidate[],
  rankedVenues: VenueMatchingAgentOutput['ranked_venues']
): EconomicsAgentInput {
  const venueCostCents = chooseVenueCostCents(candidateVenues, rankedVenues)
  const budgetCents = plan.budget_cap_cents ?? 0
  const vendorCostCents = Math.max(budgetCents - venueCostCents, 0)

  return {
    event_plan: eventPlan,
    budget_line_items: [],
    expected_attendance: plan.guest_count ?? eventPlan.expected_attendance ?? 0,
    venue_cost_cents: venueCostCents,
    vendor_cost_cents: vendorCostCents,
    ticket_price_cents: plan.ticketed ? eventPlan.ticket_price_target ?? 0 : 0,
    sponsorship_revenue_cents: 0,
  }
}

function buildFallbackEconomicsOutput(
  plan: Plan,
  eventPlan: ReturnType<typeof buildAgentEventPlan>,
  recommendations: RankedCatalogRecommendation[]
): EconomicsAgentOutput {
  const topVenueEstimate = recommendations.find((recommendation) => recommendation.kind === 'venue')?.estimate_cents ?? 0
  const budgetCents = plan.budget_cap_cents ?? 0
  const calculations = calculateEventPlanningEconomics({
    event_plan: eventPlan,
    budget_line_items: [],
    expected_attendance: plan.guest_count ?? eventPlan.expected_attendance ?? 0,
    venue_cost_cents: topVenueEstimate,
    vendor_cost_cents: Math.max(budgetCents - topVenueEstimate, 0),
    ticket_price_cents: plan.ticketed ? eventPlan.ticket_price_target ?? 0 : 0,
    sponsorship_revenue_cents: 0,
  })

  return {
    ...calculations,
    recommendation_summary:
      'Fallback economics projection generated without OpenAI. Confirm venue quote, vendor costs, and ticket price before approval.',
  }
}

function readLatestSummary(messages: PlanMessage[]): Record<string, unknown> {
  for (const message of messages) {
    const metadata = readRecord(message.metadata)
    const summary = readRecord(metadata?.summary)
    if (summary) return summary
  }

  return {}
}

async function persistRecommendations(
  db: PlannerDb,
  planId: string,
  recommendations: RankedCatalogRecommendation[]
): Promise<Recommendation[]> {
  if (recommendations.length === 0) return []

  const rankByKind: Record<string, number> = {}
  const inserts = recommendations.map((recommendation) => {
    rankByKind[recommendation.kind] = (rankByKind[recommendation.kind] ?? 0) + 1

    return {
      plan_id: planId,
      type: recommendation.kind,
      reference_id: recommendation.partner_id,
      external_name: null,
      price_cents: recommendation.estimate_cents,
      notes: recommendation.reasoning.join('. '),
      rank: rankByKind[recommendation.kind],
      is_best_fit: recommendation.fit_label === 'Best fit',
      status: 'pending',
      metadata: toJson({
        fit_label: recommendation.fit_label,
        score: recommendation.score,
        reasoning: recommendation.reasoning,
        blocking_issues: recommendation.blocking_issues,
        capacity: recommendation.capacity,
        tags: recommendation.tags,
        ranker: recommendation.metadata,
      }),
    }
  })

  const { data, error } = await db
    .from('recommendations')
    .insert(inserts)
    .select(RECOMMENDATION_SELECT_COLUMNS)

  if (error) {
    console.error('Planner catalog recommendation insert error:', error)
    throw new Error('Failed to persist catalog recommendations')
  }

  return (data ?? []) as Recommendation[]
}

async function persistAgentRecommendations(
  db: PlannerDb,
  planId: string,
  venueResult: VenueMatchingAgentResult,
  economicsResult: EconomicsAgentResult,
  venueCostById: Map<string, number | null>
): Promise<Recommendation[]> {
  const venueInserts = venueResult.output.ranked_venues.slice(0, 3).map((venue, index) => ({
    plan_id: planId,
    type: 'venue',
    reference_id: venue.venue_id,
    external_name: null,
    price_cents: venueCostById.get(venue.venue_id) ?? null,
    notes: buildVenueRecommendationNotes(venue),
    rank: index + 1,
    is_best_fit: index === 0,
    status: 'pending',
    metadata: toJson({
      recommendation_type: 'venue',
      entity_id: venue.venue_id,
      fit_score: venue.fit_score,
      pros: venue.pros,
      cons: venue.cons,
      questions_to_ask_venue: venue.questions_to_ask_venue,
      source: 'venue_matching_agent',
      model: venueResult.model,
      no_match: venueResult.output.no_match,
      reason_summary: venueResult.output.reason_summary,
    }),
  }))
  const economicsInsert = buildEconomicsRecommendationInsert(
    planId,
    economicsResult.output,
    'economics_agent',
    economicsResult.model
  )
  const inserts = [...venueInserts, economicsInsert]

  if (inserts.length === 0) return []

  const { data, error } = await db
    .from('recommendations')
    .insert(inserts)
    .select(RECOMMENDATION_SELECT_COLUMNS)

  if (error) {
    console.error('[planner.recommend] Agent recommendation insert error', error)
    throw new Error('Failed to persist agent recommendations')
  }

  return (data ?? []) as Recommendation[]
}

async function persistEconomicsRecommendation(
  db: PlannerDb,
  planId: string,
  economics: EconomicsAgentOutput,
  source: string
): Promise<Recommendation[]> {
  const { data, error } = await db
    .from('recommendations')
    .insert([buildEconomicsRecommendationInsert(planId, economics, source, 'deterministic')])
    .select(RECOMMENDATION_SELECT_COLUMNS)

  if (error) {
    console.error('[planner.recommend] Economics recommendation insert error', error)
    throw new Error('Failed to persist economics recommendation')
  }

  return (data ?? []) as Recommendation[]
}

function buildEconomicsRecommendationInsert(
  planId: string,
  economics: EconomicsAgentOutput,
  source: string,
  model: string
) {
  return {
    plan_id: planId,
    type: 'external',
    reference_id: null,
    external_name: 'Event economics projection',
    price_cents: null,
    notes: economics.recommendation_summary,
    rank: 1,
    is_best_fit: false,
    status: 'pending',
    metadata: toJson({
      recommendation_type: 'economics',
      source,
      model,
      break_even_attendance: economics.break_even_attendance,
      recommended_ticket_price_range: economics.recommended_ticket_price_range,
      revenue_scenarios: economics.revenue_scenarios,
      cost_summary_cents: economics.cost_summary_cents,
      profit_projection_cents: economics.profit_projection_cents,
      risk_flags: economics.risk_flags,
      recommendation_summary: economics.recommendation_summary,
    }),
  }
}

function toRankedVenueFromCatalog(
  recommendation: RankedCatalogRecommendation
): VenueMatchingAgentOutput['ranked_venues'][number] {
  return {
    venue_id: recommendation.partner_id,
    venue_name: recommendation.name,
    fit_score: recommendation.score,
    pros: recommendation.reasoning.length > 0
      ? recommendation.reasoning
      : [`${recommendation.name} ranked as a ${recommendation.fit_label.toLowerCase()}.`],
    cons: recommendation.blocking_issues,
    questions_to_ask_venue: [
      'Can you confirm availability, minimum spend, deposit, and included services for this event?',
    ],
  }
}

function buildVenueRecommendationNotes(venue: VenueMatchingAgentOutput['ranked_venues'][number]): string {
  const pros = venue.pros.length > 0 ? `Pros: ${venue.pros.join('; ')}` : null
  const cons = venue.cons.length > 0 ? `Cons: ${venue.cons.join('; ')}` : null
  return [pros, cons].filter((part): part is string => part !== null).join(' ')
}

function toVenueMatchingCandidate(row: Record<string, unknown>): VenueMatchingCandidate | null {
  const parsed = venueMatchingCandidateSchema.safeParse({
    id: readString(row.id) ?? '',
    venue_name: readString(row.venue_name) ?? '',
    venue_type: readString(row.venue_type),
    standing_capacity: readNumber(row.standing_capacity),
    seated_capacity: readNumber(row.seated_capacity),
    city: readString(row.city),
    state: readString(row.state),
    hourly_rate: readNumber(row.hourly_rate),
    minimum_hours: readNumber(row.minimum_hours),
    is_published: readBoolean(row.is_published),
    per_head_kickback: readNumber(row.per_head_kickback),
    offers_kickbacks: readBoolean(row.offers_kickbacks),
    deposit_percentage: readNumber(row.deposit_percentage),
    cancellation_terms: readString(row.cancellation_terms),
    available_days: readStringArray(row.available_days),
    bar_revenue_share_enabled: readBoolean(row.bar_revenue_share_enabled),
    venue_amenities: readVenueAmenities(row.venue_amenities),
  })

  if (!parsed.success) {
    console.error('[planner.recommend] Invalid venue agent candidate row', parsed.error.flatten())
    return null
  }

  return parsed.data
}

function readVenueAmenities(value: unknown): Array<{ venue_id?: string; amenity_name: string | null }> {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      const row = readRecord(item)
      if (!row) return null
      const venueId = readString(row.venue_id)
      return {
        ...(venueId ? { venue_id: venueId } : {}),
        amenity_name: readString(row.amenity_name),
      }
    })
    .filter((item): item is { venue_id?: string; amenity_name: string | null } => item !== null)
}

function buildVenueCostMap(candidateVenues: VenueMatchingCandidate[]): Map<string, number | null> {
  return new Map(
    candidateVenues.map((venue): [string, number | null] => [
      venue.id,
      estimateMinimumVenueCostCents(venue),
    ])
  )
}

function chooseVenueCostCents(
  candidateVenues: VenueMatchingCandidate[],
  rankedVenues: VenueMatchingAgentOutput['ranked_venues']
): number {
  const venueCostById = buildVenueCostMap(candidateVenues)
  const topVenueId = rankedVenues[0]?.venue_id
  const topVenueCost = topVenueId ? venueCostById.get(topVenueId) ?? null : null
  if (topVenueCost !== null) return topVenueCost

  return candidateVenues
    .map(estimateMinimumVenueCostCents)
    .find((estimate): estimate is number => estimate !== null) ?? 0
}

function estimateMinimumVenueCostCents(venue: VenueMatchingCandidate): number | null {
  if (venue.hourly_rate === null) return null
  const minimumHours = venue.minimum_hours && venue.minimum_hours > 0 ? venue.minimum_hours : 4
  return Math.round(venue.hourly_rate * minimumHours)
}

function estimateTicketPriceTargetCents(input: {
  ticketed: boolean
  budgetCents: number | null
  profitGoalCents: number | null
  expectedAttendance: number | null
}): number | null {
  if (!input.ticketed || !input.expectedAttendance || input.expectedAttendance <= 0) return null
  const targetRevenueCents = (input.budgetCents ?? 0) + (input.profitGoalCents ?? 0)
  if (targetRevenueCents <= 0) return null
  return Math.ceil(Math.ceil(targetRevenueCents / input.expectedAttendance) / 100) * 100
}

function normalizeMonetizationModel(ticketingModel: string | null | undefined): string {
  const normalized = normalizeText(ticketingModel)
  if (normalized.includes('sponsor')) return 'sponsored'
  if (normalized.includes('ticket') || normalized.includes('paid')) return 'ticketed'
  return 'free'
}

function inferCity(value: string | null | undefined): string | null {
  const normalized = normalizeText(value)
  if (!normalized) return null

  if (SAN_FRANCISCO_AREAS.has(normalized)) return 'San Francisco'
  if (normalized.includes('san francisco') || normalized === 'sf') return 'San Francisco'
  if (normalized.includes('oakland')) return 'Oakland'
  if (normalized.includes('berkeley')) return 'Berkeley'
  if (normalized.includes('alameda')) return 'Alameda'
  if (normalized.includes('palo alto')) return 'Palo Alto'
  if (normalized.includes('san jose')) return 'San Jose'
  if (normalized.includes('mountain view')) return 'Mountain View'
  if (normalized.includes('redwood city')) return 'Redwood City'
  if (normalized.includes('san mateo')) return 'San Mateo'
  if (normalized.includes('sausalito')) return 'Sausalito'

  return toTitleCase(value ?? normalized)
}

function hasOpenAIKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim())
}

const SAN_FRANCISCO_AREAS = new Set([
  'sf',
  'san francisco',
  'mission',
  'mission district',
  'soma',
  'south of market',
  'hayes valley',
  'castro',
  'marina',
  'nob hill',
  'north beach',
  'chinatown',
  'financial district',
  'fidi',
  'downtown',
  'dogpatch',
  'potrero hill',
  'richmond',
  'sunset',
  'haight',
  'fillmore',
  'pacific heights',
  'pac heights',
  'embarcadero',
])

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
  if (error) console.error('Planner catalog recommend audit insert error:', error)
}

async function readOptionalJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  if (request.headers.get('content-length') === '0') return {}

  try {
    return (await request.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function hasStringId(row: Record<string, unknown>): row is Record<string, unknown> & { id: string } {
  return typeof row.id === 'string' && row.id.length > 0
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => readString(item))
      .filter((item): item is string => Boolean(item))
  }
  if (typeof value === 'string') {
    return value
      .split(/[,;|]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,]/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = normalizeText(value)
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return null
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? ''
}

function toTitleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : part)
    .join(' ')
}

function escapeSupabaseOrValue(value: string): string {
  return value.replace(/[%(),]/g, '')
}

function formatDateWindow(start: string | null, end: string | null): string | null {
  if (!start && !end) return null
  if (start && end && start !== end) return `${start} to ${end}`
  return start ?? end
}

function getIpAddress(request: NextRequest): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
}

function toJson(value: Record<string, unknown>): Json {
  return value as Json
}
