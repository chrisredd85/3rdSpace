export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonWithDeprecatedKeys } from '@/lib/api/legacy-key-compat'
import {
  economicsAgentDefinition,
  runEconomicsAgent,
  type EconomicsAgentInput,
  type EconomicsAgentOutput,
  type EconomicsAgentResult,
} from '@/lib/ai/agents/economicsAgent'
import type { WorkspaceAgentInput, WorkspaceAgentOutput } from '@/lib/ai/agents/workspaceAgent'
import type { TimelineAgentInput, TimelineAgentOutput } from '@/lib/ai/agents/timelineAgent'
import {
  runVenueMatchingAgent,
  venueMatchingAgentDefinition,
  type VenueMatchingAgentOutput,
  type VenueMatchingAgentResult,
} from '@/lib/ai/agents/venueMatchingAgent'
import { getAgentRunErrorMetadata, type AgentName } from '@/lib/ai/types'
import { calculateEventPlanningEconomics } from '@/lib/finance/eventPlanningEconomics'
import { generateMilestoneTemplate } from '@/lib/events/milestoneTemplates'
import { archetypeFor, buildArchetypeAnswerText, buildMutationContract, readEventArchetypeLock } from '@/lib/planner/archetypes'
import type { EventArchetypeConfig, VendorStackItem, VendorTrigger } from '@/lib/planner/archetypes'
import {
  rankCatalogPartners,
  type CatalogVendorRankingInput,
  type CatalogVenueRankingInput,
  type CatalogPlanRankingInput,
  type RankedCatalogRecommendation,
} from '@/lib/planner/catalogRanker'
import { PLAN_MESSAGE_SELECT_COLUMNS, PLAN_SELECT_COLUMNS, RECOMMENDATION_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import {
  buildApprovalSnapshotHash,
  buildLegacyPlanApprovalSnapshotHash,
} from '@/lib/planner/execution/reapproval'
import { getVenueComplianceStatus } from '@/lib/planner/venueComplianceGate'
import {
  applyArchetypeDefaultFills,
  readPlanMatchingBoolean,
  readPlanMatchingSignal,
  withPlanVendorStack,
} from '@/lib/planner/recommendVendorStack'
import { loadVendorEconomicsCostSummary, type VendorEconomicsCostSummary } from '@/lib/planner/vendorEconomicsCosts'
import { hasActiveVenueHold } from '@/lib/planner/venueHold'
import { byoVendorServiceTypes, readByoVendors, sumByoVendorCostsCents } from '@/lib/planner/byoVendors'
import { logAgentRun, type AgentRunDb } from '@/lib/server/agent-runs'
import {
  getBuilderProfileIdForUser,
  summarizeBuilderAttendance,
  type BuilderAttendanceSummary,
} from '@/lib/server/builderAttendanceHistory'
import {
  buildOrganizerPreferencePayload,
  firstKnownBuilderArchetype,
  loadBuilderOrganizerPreferences,
  type BuilderOrganizerPreferences,
} from '@/lib/server/builderPreferences'
import {
  summarizeBuilderTierElasticity,
  type ElasticitySignal,
} from '@/lib/server/builderTierElasticity'
import { getBuilderConnectedTicketingPlatforms } from '@/lib/server/account-setup'
import { readCents } from '@/lib/money'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { Json, Plan, PlanMessage, PlannerApiErrorResponse, Recommendation } from '@/lib/types'
import {
  venueMatchingCandidateSchema,
  type VenueMatchingCandidate,
} from '@/lib/venues/venuePreFilter'
import { rankVendorsForPlan, type RankedVendor } from '@/lib/vendors/vendorRanker'

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
  resolved_archetype: ResolvedArchetypeSummary
  ranked_venues: VenueMatchingAgentOutput['ranked_venues']
  recommendations: VenueMatchingAgentOutput['ranked_venues']
  venue_match_notice: VenueMatchNotice | null
  vendor_recommendations: SuggestedVendorRecommendation[]
  vendor_recommendation_groups: VendorRecommendationGroup[]
  vendor_match_notice: VendorMatchNotice | null
  capacity_calibration: CapacityCalibrationSummary
  elasticity: ElasticitySignal | null
  economics: EconomicsAgentOutput | null
  economics_placeholder: string | null
  profit_projection: ProfitProjectionSummary | null
  workspace_summary: WorkspaceAgentOutput | null
  timeline: TimelineAgentOutput | null
  persisted_recommendation_ids: string[]
  outreach_approval_message_id?: string | null
  ticketing_platform_prompt: string | null
}

type VenueMatchNotice =
  | {
      type: 'no_exact_match'
      searched_neighborhood: string | null
      fallback_venues: VenueMatchingAgentOutput['ranked_venues']
      message: string
    }
  | {
      type: 'catalog_gap'
      searched_neighborhood: string | null
      fallback_venues: []
      message: string
      admin_task_created: boolean
    }

type VendorMatchNotice = {
  type: 'vendor_gap'
  missing_service_types: string[]
  message: string
} | null

type VenueCostEstimate = {
  venueId: string
  estimatedCostCents: number | null
}

type SuggestedVendorRecommendation = {
  vendor_id: string
  name: string
  service_type: string | null
  necessity: VendorStackItem['necessity']
  service_note: string | null
  base_rate_cents: number | null
  fit_score: number
  pros: string[]
  cons: string[]
}

type VendorRecommendationGroup = {
  service_type: string
  necessity: VendorStackItem['necessity']
  note: string | null
  vendors: SuggestedVendorRecommendation[]
}

type ResolvedArchetypeSummary = {
  key: string
  display_name: string
}

type ProfitTicketProjection = {
  ticket_price_cents: number
  gross_revenue_cents: number
  total_costs_cents: number
  net_profit_cents: number
  break_even_tickets: number | null
}

type ProfitProjectionSummary = {
  projections: ProfitTicketProjection[]
  recommended_price_cents: number | null
  recommended_projection: ProfitTicketProjection | null
  // When the user stated a ticket price target, `recommended_projection` IS that price
  // (even if it's loss-making). `break_even_projection` is surfaced separately so the
  // narrative can say "you said $35, break-even is $117" without silently swapping prices.
  break_even_projection: ProfitTicketProjection | null
  user_stated_price_cents: number | null
  source: 'deterministic_estimate'
  accuracy: 'estimate_until_partner_quotes_confirmed'
  requires_quote_confirmation: true
  assumption_notes: string[]
}

type VenueCandidateSearchMode = 'strict' | 'broader'

type CapacityCalibrationSummary = {
  calibration_signal: 'no_history' | 'stated' | 'historical_higher' | 'historical_aligned'
  stated_guest_count: number | null
  projected_attendance: number | null
  history_p75: number | null
  sample_size: number
  confidence: BuilderAttendanceSummary['confidence'] | null
}

type CreatedOutreachApproval = {
  approvalMessageId: string
  approvalId: string
}

const RECOMMEND_DEPRECATED_KEYS = [
  'per_head_kickback',
  'per_head_kickback_cents',
  'offers_kickbacks',
  'bar_revenue_share_enabled',
  'bar_revenue_share_percent',
  'bar_rev_share_pct',
  'venue_kickback_rate',
  'revenue_share',
]

type RecommendedVenueContext = {
  venue_id: string
  venue_name: string | null
  quoted_price_cents: number | null
}

type OperationalAgentArtifacts = {
  workspace_summary: WorkspaceAgentOutput | null
  timeline: TimelineAgentOutput | null
  errors: {
    workspace?: string
    timeline?: string
  }
}

type PlannerAgentConversationMessage = {
  role: PlanMessage['role']
  content: string
  message_type: PlanMessage['message_type']
}

type ArchetypeIntakeOutcomeContext = {
  archetype_key: string
  archetype_display_name: string
  answer_text: string
  question_ids_asked: string[]
  questions_asked: string[]
  required_amenities: string[]
  vendor_stack: VendorStackItem[]
  preferred_commercial_models: EventArchetypeConfig['preferred_commercial_models']
}

const recommendRequestSchema = z.object({
  limit: z.number().int().min(1).max(6).default(6),
  venueLimit: z.number().int().min(0).max(3).default(3),
  vendorLimit: z.number().int().min(0).max(3).default(3),
  // 'auto' (default) inspects active venue holds: no hold → 'venues', hold → 'vendors'.
  // 'venues' = Phase 1 (skip vendor + economics). 'vendors' = Phase 2 (full pipeline).
  phase: z.enum(['auto', 'venues', 'vendors']).default('auto'),
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
  hourly_rate_cents,
  daily_rate_cents,
  price_per_night_cents,
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
  description,
  venue_type,
  address,
  standing_capacity,
  seated_capacity,
  city,
  state,
  hourly_rate,
  hourly_rate_cents,
  daily_rate_cents,
  price_per_night_cents,
  minimum_hours,
  is_published,
  per_head_kickback,
  per_head_kickback_cents,
  offers_kickbacks,
  deposit_percentage,
  cancellation_terms,
  available_days,
  bar_revenue_share_enabled,
  bar_rev_share_pct,
  bar_revenue_share_percent,
  ticket_sales_share_enabled,
  ticket_sales_share_pct,
  ticket_sales_share_percent,
  unique_features,
  unique_features_tags,
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

    const messages = await loadPlanContextMessages(auth.db, plan.id)
    const organizerPreferences = await loadBuilderOrganizerPreferences(auth.db, auth.userId)
    const baseRankingInput = buildRankingInput(plan, messages, organizerPreferences)
    const lockedArchetype = readEventArchetypeLock(plan.metadata)
    const preferredArchetypeKey = firstKnownBuilderArchetype(organizerPreferences)
    const baseArchetype = archetypeFor(lockedArchetype?.key ?? baseRankingInput.event_type ?? plan.event_type ?? preferredArchetypeKey ?? null)
    const recommendationPlan = applyArchetypeDefaultFills(plan, baseArchetype)
    const rankingInput = buildRankingInput(recommendationPlan, messages, organizerPreferences)
    const archetype = withPlanVendorStack(baseArchetype, recommendationPlan)
    const conversationHistory = buildAgentConversationHistory(messages)
    const archetypeIntake = buildArchetypeIntakeOutcomeContext(messages, archetype)
    const mutationContract = buildMutationContract(plan.metadata, plan.event_type)
    const builderAttendance = await loadBuilderAttendanceForPlan(auth.db, auth.userId, archetype.key)
    const connectedTicketingPlatforms = await getBuilderConnectedTicketingPlatforms(auth.db, auth.userId)
    const elasticity = await loadBuilderElasticityForPlan(auth.db, auth.userId, archetype.key)
    const capacityCalibration = buildCapacityCalibrationSummary(recommendationPlan, builderAttendance)

    if (!hasOpenAIKey()) {
      return runCatalogFallback({
        auth,
        plan: recommendationPlan,
        archetype,
        builderAttendance,
        elasticity,
        capacityCalibration,
        rankingInput,
        conversationHistory,
        archetypeIntake,
        connectedTicketingPlatforms,
        messages,
        request,
        limit: body.data.limit,
        venueLimit: body.data.venueLimit,
        vendorLimit: body.data.vendorLimit,
        fallbackReason: 'OPENAI_API_KEY is not configured',
      })
    }

    try {
    const eventPlan = buildAgentEventPlan(recommendationPlan, rankingInput)
    const candidateVenues = await loadVenueAgentCandidates(auth.db, recommendationPlan, rankingInput, {
      neighborhoodMode: 'strict',
    })
    const compliantCandidateVenues = await filterCompliantVenueCandidates(
      createServiceRoleClient() as any,
      candidateVenues
    )
    const venuePayload = {
      event_plan: eventPlan,
      candidate_venues: compliantCandidateVenues,
      builder_attendance: builderAttendance,
      organizer_preferences: {
        ...(buildOrganizerPreferencePayload(organizerPreferences) ?? {}),
        budget_cap_cents: recommendationPlan.budget_cap_cents,
        guest_count: recommendationPlan.guest_count,
        neighborhood: recommendationPlan.neighborhood,
      },
      plan: recommendationPlan,
      archetype,
      archetype_intake: archetypeIntake,
      mutation_contract: mutationContract,
      ranked_venues: [],
      conversation_history: conversationHistory,
    }
    const venueResult = await runLoggedVenueMatchingAgent(auth.userId, plan.id, venuePayload)
    const venueMatch = await resolveVenueMatches({
      auth,
      plan: recommendationPlan,
      rankingInput,
      archetype,
      eventPlan,
      baseVenueResult: venueResult,
      baseCandidateVenues: compliantCandidateVenues,
      basePayload: venuePayload,
    })
    // TODO(ticket-data): plug ticket sales/history lookup here once the surfaced data contract is defined.
    const venueCostCents = chooseVenueCostCents(
      venueMatch.candidateVenues,
      venueMatch.venueResult.output.ranked_venues
    )

    // Phase resolution. 'auto' (default) inspects active venue holds: no hold →
    // Phase 1 (venues only), hold present → Phase 2 (vendors + economics).
    // 'venues' / 'vendors' override the inspection.
    const effectivePhase: 'venues' | 'vendors' = body.data.phase === 'auto'
      ? (await hasActiveVenueHold(auth.db, plan.id) ? 'vendors' : 'venues')
      : body.data.phase
    const shouldRunVendors = effectivePhase === 'vendors'

    // BYO vendors the organizer is providing themselves. Their costs are
    // folded into the economics total and their service types are excluded
    // from the catalog recommendation set so the system doesn't suggest a
    // photographer when the organizer is bringing their own.
    const byoVendors = readByoVendors(recommendationPlan.metadata)
    const byoServiceTypes = byoVendorServiceTypes(byoVendors)
    const byoVendorCostCents = sumByoVendorCostsCents(byoVendors)

    const rawSuggestedVendors = shouldRunVendors
      ? await loadSuggestedVendors(auth.db, recommendationPlan, archetype, venueCostCents)
      : []
    const suggestedVendors = rawSuggestedVendors.filter((vendor) => !byoServiceTypes.has(String(vendor.service_type)))
    const vendorRecommendationGroups = shouldRunVendors
      ? groupVendorRecommendations(suggestedVendors, archetype)
      : []
    const vendorMatchNotice = shouldRunVendors
      ? buildVendorMatchNotice(archetype, suggestedVendors)
      : null
    const vendorCostSummary: VendorEconomicsCostSummary | null = shouldRunVendors
      ? await loadVendorEconomicsCostSummary(auth.db, {
          plan: recommendationPlan,
          organizerUserId: auth.userId,
          expectedAttendance: recommendationPlan.guest_count ?? eventPlan.expected_attendance ?? 0,
          vendorRecommendations: suggestedVendors,
        })
      : null
    // Add the BYO vendor total to the catalog/quoted vendor cost so the
    // profit projection reflects what the organizer is actually spending.
    const vendorCostCents = (vendorCostSummary?.vendor_cost_cents ?? 0) + byoVendorCostCents
    const ticketPriceSweepCents = buildTicketPriceSweepCents(archetype, elasticity)
    const profitProjection = shouldRunVendors
      ? buildProfitProjectionSummary(recommendationPlan, venueCostCents, vendorCostCents, ticketPriceSweepCents)
      : null
    const knownTicketPriceCents = readPlanTicketPriceTargetCents(recommendationPlan)
    const economicsPlaceholder = shouldRunVendors
      ? buildEconomicsPlaceholder(recommendationPlan, archetype, knownTicketPriceCents)
      : null
    const economicsResult: EconomicsAgentResult | null = shouldRunVendors && !economicsPlaceholder && vendorCostSummary && profitProjection
      ? await runLoggedEconomicsAgent(
          auth.userId,
          plan.id,
          buildEconomicsPayload(
            recommendationPlan,
            eventPlan,
            venueCostCents,
            vendorCostCents,
            {
              archetype,
              elasticity,
              historicalAttendance: builderAttendance,
              ticketPriceSweepCents,
              profitProjection,
              venue: pickTopVenueCandidate(venueMatch.candidateVenues, venueMatch.venueResult.output.ranked_venues),
              archetypeIntake,
              mutationContract,
              conversationHistory,
              vendorCostSummary,
            }
          )
        )
      : null
    const ticketingPlatformPrompt = buildTicketingPlatformPrompt(recommendationPlan, archetype, connectedTicketingPlatforms, messages)
    const topVenueContext = toRecommendedVenueContext(
      pickTopVenueCandidate(venueMatch.candidateVenues, venueMatch.venueResult.output.ranked_venues),
      venueMatch.venueResult.output.ranked_venues[0] ?? null,
      venueCostCents
    )

    const persisted = await persistAgentRecommendations(
      auth.db,
      plan.id,
      venueMatch.venueResult,
      economicsResult,
      buildVenueCostMap(venueMatch.candidateVenues),
      suggestedVendors,
      vendorRecommendationGroups,
      archetype,
      profitProjection,
      elasticity,
      venueMatch.notice,
      vendorMatchNotice,
      capacityCalibration
    )
    // Outreach approval + operational artifacts (timeline + workspace summary)
    // are Phase 2 work. In Phase 1 we only have venues to surface; outreach
    // and operational planning happen once a venue is held.
    const outreachApproval = shouldRunVendors
      ? await ensureOutreachApprovalRequest({
          db: auth.db,
          plan: recommendationPlan,
          userId: auth.userId,
          venueIds: venueMatch.venueResult.output.ranked_venues.slice(0, 3).map((venue) => venue.venue_id),
          vendorIds: suggestedVendors.slice(0, 3).map((vendor) => vendor.vendor_id),
          projectedCostsCents: venueCostCents + vendorCostCents,
          summary: buildOutreachApprovalSummary(recommendationPlan, venueMatch.venueResult.output.ranked_venues.length, suggestedVendors.length),
          requirements: buildOutreachRequirements(recommendationPlan, archetype, archetypeIntake),
        })
      : null
    const operationalArtifacts = shouldRunVendors
      ? await generateAndPersistOperationalArtifacts({
          db: auth.db,
          userId: auth.userId,
          plan: recommendationPlan,
          eventPlan,
          topVenue: topVenueContext,
          vendorRecommendations: suggestedVendors,
          profitProjection,
          archetypeIntake,
          conversationHistory,
          mutationContract,
        })
      : { timeline: null, workspace_summary: null, errors: {} as OperationalAgentArtifacts['errors'] }
    // Shopping list persistence depends on Phase 2 outputs (vendor list + projection).
    if (shouldRunVendors && profitProjection) {
      await persistRecommendationShoppingList({
        db: auth.db,
        plan: {
          ...recommendationPlan,
          metadata: {
            ...(readRecord(recommendationPlan.metadata) ?? {}),
            agent_cache: buildOperationalAgentCacheMetadata(operationalArtifacts),
          } as Json,
        },
        topVenue: topVenueContext,
        topRankedVenue: venueMatch.venueResult.output.ranked_venues[0] ?? null,
        vendorRecommendations: suggestedVendors,
        profitProjection,
      })
    }

    await insertAuditLog(auth.db, {
      user_id: auth.userId,
      plan_id: plan.id,
      action: 'planner.agent_recommendations.generated',
      entity_type: 'recommendation',
      entity_id: null,
      before_state: null,
      after_state: toJson({
        recommendation_ids: persisted.map((recommendation) => recommendation.id),
        venue_ids: venueMatch.venueResult.output.ranked_venues.map((venue) => venue.venue_id),
        vendor_ids: suggestedVendors.map((vendor) => vendor.vendor_id),
        archetype: toResolvedArchetypeSummary(archetype),
        economics_agent: economicsResult?.agent_name ?? null,
        venue_match_notice: venueMatch.notice,
        vendor_match_notice: vendorMatchNotice,
        capacity_calibration: capacityCalibration,
        elasticity,
        archetype_intake: archetypeIntake,
        outreach_approval_id: outreachApproval?.approvalId ?? null,
        operational_artifacts: {
          timeline_generated: Boolean(operationalArtifacts.timeline),
          workspace_generated: Boolean(operationalArtifacts.workspace_summary),
          errors: operationalArtifacts.errors,
        },
      }),
      ip_address: getIpAddress(request),
    })

    const rankedVenueResponses = venueMatch.venueResult.output.ranked_venues.map(withVenueRecommendationCompat)
    return jsonWithDeprecatedKeys({
      resolved_archetype: toResolvedArchetypeSummary(archetype),
      ranked_venues: rankedVenueResponses,
      recommendations: rankedVenueResponses,
      venue_match_notice: venueMatch.notice,
      vendor_recommendations: suggestedVendors,
      vendor_recommendation_groups: vendorRecommendationGroups,
      vendor_match_notice: vendorMatchNotice,
      capacity_calibration: capacityCalibration,
      elasticity,
      economics: economicsPlaceholder ? null : withEconomicsCompat(economicsResult?.output ?? null),
      economics_placeholder: economicsPlaceholder,
      profit_projection: economicsPlaceholder ? null : profitProjection,
      workspace_summary: operationalArtifacts.workspace_summary,
      timeline: operationalArtifacts.timeline,
      plan_ticketed: plan.ticketed,
      persisted_recommendation_ids: persisted.map((recommendation) => recommendation.id),
      outreach_approval_message_id: outreachApproval?.approvalMessageId ?? null,
      ticketing_platform_prompt: ticketingPlatformPrompt,
      phase: effectivePhase,
      byo_vendors: byoVendors,
    }, RECOMMEND_DEPRECATED_KEYS)
    } catch (error) {
      console.warn('[planner.recommend] Agent-backed recommendation pipeline failed; falling back to catalog ranker', error)
      return runCatalogFallback({
        auth,
        plan: recommendationPlan,
        archetype,
        builderAttendance,
        elasticity,
        capacityCalibration,
        rankingInput,
        conversationHistory,
        archetypeIntake,
        connectedTicketingPlatforms,
        messages,
        request,
        limit: body.data.limit,
        venueLimit: body.data.venueLimit,
        vendorLimit: body.data.vendorLimit,
        fallbackReason: error instanceof Error ? error.message : 'Agent-backed recommendation pipeline failed',
      })
    }
  } catch (error) {
    console.error('[agent.run] Planner recommend POST error', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

async function runCatalogFallback(input: {
  auth: { db: PlannerDb; userId: string }
  plan: Plan
  archetype: EventArchetypeConfig
  builderAttendance: BuilderAttendanceSummary | null
  elasticity: ElasticitySignal | null
  capacityCalibration: CapacityCalibrationSummary
  rankingInput: CatalogPlanRankingInput
  conversationHistory: PlannerAgentConversationMessage[]
  archetypeIntake: ArchetypeIntakeOutcomeContext
  connectedTicketingPlatforms: string[]
  messages: PlanMessage[]
  request: NextRequest
  limit: number
  venueLimit: number
  vendorLimit: number
  fallbackReason: string
}): Promise<NextResponse<PlannerRecommendResponse>> {
  const [venues, vendors] = await Promise.all([
    loadCatalogVenues(input.auth.db),
    loadCatalogVendors(input.auth.db),
  ])
  const ranking = rankCatalogPartners({
    plan: input.rankingInput,
    venues,
    vendors,
    archetype: input.archetype,
    builderAttendance: input.builderAttendance,
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

  const eventPlan = buildAgentEventPlan(input.plan, input.rankingInput)
  const catalogVenueMatch = await resolveCatalogVenueMatches({
    db: input.auth.db,
    plan: input.plan,
    rankingInput: input.rankingInput,
    archetype: input.archetype,
    builderAttendance: input.builderAttendance,
    venues,
    vendors,
    ranking,
    limit: input.limit,
    venueLimit: input.venueLimit,
    vendorLimit: input.vendorLimit,
    eventPlan,
  })
  // BYO filtering — same as main path. The catalog fallback runs whenever the
  // agent pipeline throws, so it MUST apply the same BYO suppression or the
  // organizer will see catalog recommendations for vendor types they already
  // own.
  const byoVendorsFallback = readByoVendors(input.plan.metadata)
  const byoServiceTypesFallback = byoVendorServiceTypes(byoVendorsFallback)
  const byoVendorCostCentsFallback = sumByoVendorCostsCents(byoVendorsFallback)

  const recommendationsForPersistence = catalogVenueMatch.recommendations
  const ticketPriceSweepCents = buildTicketPriceSweepCents(input.archetype, input.elasticity)
  const rankedVenues = recommendationsForPersistence
    .filter((recommendation) => recommendation.kind === 'venue')
    .map(toRankedVenueFromCatalog)
  const vendorRecommendations = recommendationsForPersistence
    .filter((recommendation) => recommendation.kind === 'vendor')
    .map((recommendation) => toSuggestedVendorFromCatalog(recommendation, input.archetype))
    .filter((vendor) => !byoServiceTypesFallback.has(String(vendor.service_type)))
  const vendorRecommendationGroups = groupVendorRecommendations(vendorRecommendations, input.archetype)
  const vendorMatchNotice = buildVendorMatchNotice(input.archetype, vendorRecommendations)
  const venueCostCents = recommendationsForPersistence.find((recommendation) => recommendation.kind === 'venue')?.estimate_cents ?? 0
  const vendorCostSummary = await loadVendorEconomicsCostSummary(input.auth.db, {
    plan: input.plan,
    organizerUserId: input.auth.userId,
    expectedAttendance: input.plan.guest_count ?? eventPlan.expected_attendance ?? 0,
    vendorRecommendations,
  })
  // Add BYO total to the fallback path's vendor cost so the projection reflects
  // what the organizer is actually spending. Mirrors the main path.
  const vendorCostCents = vendorCostSummary.vendor_cost_cents + byoVendorCostCentsFallback
  const knownTicketPriceCents = readPlanTicketPriceTargetCents(input.plan)
  const fallbackEconomicsPlaceholder = buildEconomicsPlaceholder(input.plan, input.archetype, knownTicketPriceCents)
  const fallbackEconomics = fallbackEconomicsPlaceholder
    ? null
    : buildFallbackEconomicsOutput(
        input.plan,
        eventPlan,
        recommendationsForPersistence,
        ticketPriceSweepCents,
        vendorCostSummary
      )
  const profitProjection = buildProfitProjectionSummary(
    input.plan,
    venueCostCents,
    vendorCostCents,
    ticketPriceSweepCents
  )
  const persistedCatalogRecommendations = await persistRecommendations(
    input.auth.db,
    input.plan.id,
    recommendationsForPersistence
  )
  const persistedEconomicsRecommendation = fallbackEconomics
    ? await persistEconomicsRecommendation(
        input.auth.db,
        input.plan.id,
        fallbackEconomics,
        'catalog_fallback',
        profitProjection,
        input.elasticity
      )
    : []
  const persisted = [...persistedCatalogRecommendations, ...persistedEconomicsRecommendation]
  const topVenueContext = toRecommendedVenueContextFromCatalog(
    recommendationsForPersistence.find((recommendation) => recommendation.kind === 'venue') ?? null,
    rankedVenues[0] ?? null
  )
  const outreachApproval = await ensureOutreachApprovalRequest({
    db: input.auth.db,
    plan: input.plan,
    userId: input.auth.userId,
    venueIds: rankedVenues.slice(0, 3).map((venue) => venue.venue_id),
    vendorIds: vendorRecommendations.slice(0, 3).map((vendor) => vendor.vendor_id),
    projectedCostsCents: venueCostCents + vendorCostCents,
    summary: buildOutreachApprovalSummary(input.plan, rankedVenues.length, vendorRecommendations.length),
    requirements: buildOutreachRequirements(input.plan, input.archetype, input.archetypeIntake),
  })
  const operationalArtifacts = await generateAndPersistOperationalArtifacts({
    db: input.auth.db,
    userId: input.auth.userId,
    plan: input.plan,
    eventPlan,
    topVenue: topVenueContext,
    vendorRecommendations,
    profitProjection,
    archetypeIntake: input.archetypeIntake,
    conversationHistory: input.conversationHistory,
    mutationContract: buildMutationContract(input.plan.metadata, input.plan.event_type),
  })
  await persistRecommendationShoppingList({
    db: input.auth.db,
    plan: {
      ...input.plan,
      metadata: {
        ...(readRecord(input.plan.metadata) ?? {}),
        agent_cache: buildOperationalAgentCacheMetadata(operationalArtifacts),
      } as Json,
    },
    topVenue: topVenueContext,
    topRankedVenue: rankedVenues[0] ?? null,
    vendorRecommendations,
    profitProjection,
  })

  await insertAuditLog(input.auth.db, {
    user_id: input.auth.userId,
    plan_id: input.plan.id,
    action: 'planner.catalog_recommendations.generated',
    entity_type: 'recommendation',
    entity_id: null,
    before_state: null,
    after_state: toJson({
        recommendation_ids: persisted.map((recommendation) => recommendation.id),
        partner_ids: recommendationsForPersistence.map((recommendation) => recommendation.partner_id),
        archetype: toResolvedArchetypeSummary(input.archetype),
        fallback_reason: input.fallbackReason,
        venue_match_notice: catalogVenueMatch.notice,
        vendor_match_notice: vendorMatchNotice,
        capacity_calibration: input.capacityCalibration,
        elasticity: input.elasticity,
        archetype_intake: input.archetypeIntake,
        outreach_approval_id: outreachApproval?.approvalId ?? null,
        operational_artifacts: {
          timeline_generated: Boolean(operationalArtifacts.timeline),
          workspace_generated: Boolean(operationalArtifacts.workspace_summary),
          errors: operationalArtifacts.errors,
        },
      }),
    ip_address: getIpAddress(input.request),
  })

  const catalogTicketingPlatformPrompt = buildTicketingPlatformPrompt(input.plan, input.archetype, input.connectedTicketingPlatforms, input.messages)

  const rankedVenueResponses = rankedVenues.map(withVenueRecommendationCompat)
  return jsonWithDeprecatedKeys({
    resolved_archetype: toResolvedArchetypeSummary(input.archetype),
    ranked_venues: rankedVenueResponses,
    recommendations: rankedVenueResponses,
    venue_match_notice: catalogVenueMatch.notice,
    vendor_recommendations: vendorRecommendations,
    vendor_recommendation_groups: vendorRecommendationGroups,
    vendor_match_notice: vendorMatchNotice,
    capacity_calibration: input.capacityCalibration,
    elasticity: input.elasticity,
    economics: withEconomicsCompat(fallbackEconomics),
    economics_placeholder: fallbackEconomicsPlaceholder,
    profit_projection: fallbackEconomicsPlaceholder ? null : profitProjection,
    workspace_summary: operationalArtifacts.workspace_summary,
    timeline: operationalArtifacts.timeline,
    plan_ticketed: input.plan.ticketed,
    persisted_recommendation_ids: persisted.map((recommendation) => recommendation.id),
    outreach_approval_message_id: outreachApproval?.approvalMessageId ?? null,
    ticketing_platform_prompt: catalogTicketingPlatformPrompt,
    byo_vendors: byoVendorsFallback,
  }, RECOMMEND_DEPRECATED_KEYS)
}

function withVenueRecommendationCompat<T extends Record<string, unknown>>(venue: T): T {
  const perHeadChiCents =
    venue.per_head_chi_cents ??
    venue.per_head_kickback_cents ??
    venue.per_head_kickback ??
    null
  const barConsumptionSharePercent =
    venue.bar_consumption_share_percent ??
    venue.bar_revenue_share_percent ??
    venue.bar_rev_share_pct ??
    null
  const barConsumptionShareEnabled =
    venue.bar_consumption_share_enabled ??
    venue.bar_revenue_share_enabled ??
    null

  return {
    ...venue,
    per_head_chi_cents: perHeadChiCents,
    per_head_kickback: venue.per_head_kickback ?? perHeadChiCents,
    per_head_kickback_cents: venue.per_head_kickback_cents ?? perHeadChiCents,
    offers_chis: venue.offers_chis ?? venue.offers_kickbacks ?? null,
    offers_kickbacks: venue.offers_kickbacks ?? venue.offers_chis ?? null,
    bar_consumption_share_enabled: barConsumptionShareEnabled,
    bar_revenue_share_enabled: venue.bar_revenue_share_enabled ?? barConsumptionShareEnabled,
    bar_consumption_share_percent: barConsumptionSharePercent,
    bar_revenue_share_percent: venue.bar_revenue_share_percent ?? barConsumptionSharePercent,
    venue_chi_rate: venue.venue_chi_rate ?? venue.venue_kickback_rate ?? null,
    venue_kickback_rate: venue.venue_kickback_rate ?? venue.venue_chi_rate ?? null,
  }
}

function withEconomicsCompat<T extends Record<string, unknown> | null>(economics: T): T {
  if (!economics) return economics

  return {
    ...economics,
    venue_chi_rate: economics.venue_chi_rate ?? economics.venue_kickback_rate ?? null,
    venue_kickback_rate: economics.venue_kickback_rate ?? economics.venue_chi_rate ?? null,
  } as T
}

async function ensureOutreachApprovalRequest(input: {
  db: PlannerDb
  plan: Plan
  userId: string
  venueIds: string[]
  vendorIds: string[]
  projectedCostsCents: number
  summary: string
  requirements: Record<string, unknown>
}): Promise<CreatedOutreachApproval | null> {
  const venueIds = uniqueUuidList(input.venueIds).slice(0, 3)
  const vendorIds = uniqueUuidList(input.vendorIds).slice(0, 3)
  if (venueIds.length === 0 && vendorIds.length === 0) return null

  const existing = await loadExistingOutreachApprovalMessage(input.db, input.plan.id)
  if (existing) return existing

  const responseDeadline = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()
  const projectedCostsCents = Math.max(Math.round(input.projectedCostsCents), 0)
  const planSnapshotHash = buildLegacyPlanApprovalSnapshotHash({ plan: input.plan })
  const actionPayload = {
    kind: 'venue_outreach',
    venue_ids: venueIds,
    vendor_ids: vendorIds,
    projected_costs_cents: projectedCostsCents,
    requires_user_action: true,
    summary: input.summary,
    requirements: input.requirements,
    response_deadline: responseDeadline,
    plan_snapshot_hash: planSnapshotHash,
    source: 'planner_recommendations',
  }
  const snapshotHash = buildApprovalSnapshotHash({
    plan: input.plan,
    approval: {
      event_date: input.plan.date_window_start,
      price_cents: projectedCostsCents,
      fees_cents: 0,
      requested_amount_cents: projectedCostsCents,
      provider: '3rdPlace partners',
      refund_terms: 'No charge is made now. This only approves outreach and quote requests.',
      cancellation_terms: 'You can cancel before outreach drafts are sent; changed plan details require fresh approval.',
      package_details: buildOutreachApprovalPackageDetails(venueIds.length, vendorIds.length),
    },
    action: {
      action_type: 'email',
      target_type: 'outreach',
      target_id: null,
      amount_cents: projectedCostsCents,
      payload_json: actionPayload as Json,
    },
    payload: actionPayload,
  })
  let { data: actionRows, error: actionError } = await input.db
    .from('agent_actions')
    .insert({
      plan_id: input.plan.id,
      action_type: 'email',
      description: buildOutreachApprovalLabel(venueIds.length, vendorIds.length),
      provider: '3rdPlace partners',
      target_type: 'outreach',
      target_id: null,
      payload_json: actionPayload as Json,
      amount_cents: projectedCostsCents,
      currency: 'usd',
      status: 'pending',
      result_metadata: {
        source: 'planner_recommendations',
        requires_user_action: true,
        action_type_fallback: 'opportunity_send_venues',
      } as Json,
    })
    .select('*')

  if (actionError?.code === '23514') {
    console.warn('[planner.recommend] Falling back to email agent action type for outreach approval', actionError)
    const fallbackInsert = await input.db
      .from('agent_actions')
      .insert({
        plan_id: input.plan.id,
        action_type: 'email',
        description: buildOutreachApprovalLabel(venueIds.length, vendorIds.length),
        provider: '3rdPlace partners',
        target_type: 'outreach',
        target_id: null,
        payload_json: actionPayload as Json,
        amount_cents: projectedCostsCents,
        currency: 'usd',
        status: 'pending',
        result_metadata: {
          source: 'planner_recommendations',
          requires_user_action: true,
          action_type_fallback: 'opportunity_send_venues',
        } as Json,
      })
      .select('*')
    actionRows = fallbackInsert.data
    actionError = fallbackInsert.error
  }

  const agentAction = firstRow(actionRows)
  if (actionError || !agentAction) {
    console.error('[planner.recommend] Outreach agent action insert error', actionError)
    return null
  }

  // Look up contact emails from catalog so the approval card can show "Contact info on file"
  const contactEmail = await resolveOutreachContactEmail(input.db, venueIds, vendorIds)

  const { data: approvalRows, error: approvalError } = await input.db
    .from('approvals')
    .insert({
      plan_id: input.plan.id,
      agent_action_id: String(agentAction.id),
      action_label: buildOutreachApprovalLabel(venueIds.length, vendorIds.length),
      provider: '3rdPlace partners',
      event_date: input.plan.date_window_start,
      price_cents: projectedCostsCents,
      fees_cents: 0,
      package_details: buildOutreachApprovalPackageDetails(venueIds.length, vendorIds.length),
      refund_terms: 'No charge is made now. This only approves outreach and quote requests.',
      cancellation_terms: 'You can cancel before outreach drafts are sent; changed plan details require fresh approval.',
      delivery_email: contactEmail,
      payment_method_id: null,
      requested_amount_cents: projectedCostsCents,
      status: 'pending',
      snapshot_hash: snapshotHash,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('*')

  const approval = firstRow(approvalRows)
  if (approvalError || !approval) {
    console.error('[planner.recommend] Outreach approval insert error', approvalError)
    return null
  }

  const metadata = {
    kind: 'venue_outreach',
    venue_ids: venueIds,
    vendor_ids: vendorIds,
    projected_costs_cents: projectedCostsCents,
    requires_user_action: true,
    status: 'pending',
    summary: input.summary,
    response_deadline: responseDeadline,
    approval,
  }
  const { data: messageRows, error: messageError } = await input.db
    .from('plan_messages')
    .insert({
      plan_id: input.plan.id,
      role: 'agent',
      content: `I found the best-fit partners. Approve outreach and I will prepare drafts for ${formatOutreachTargetCounts(venueIds.length, vendorIds.length)}.`,
      message_type: 'approval_request',
      metadata: metadata as Json,
    })
    .select(PLAN_MESSAGE_SELECT_COLUMNS)

  const message = firstRow(messageRows)
  if (messageError || !message) {
    console.error('[planner.recommend] Outreach approval message insert error', messageError)
    return null
  }

  return {
    approvalMessageId: String(message.id),
    approvalId: String(approval.id),
  }
}

async function loadExistingOutreachApprovalMessage(
  db: PlannerDb,
  planId: string
): Promise<CreatedOutreachApproval | null> {
  const { data, error } = await db
    .from('plan_messages')
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .eq('message_type', 'approval_request')
    .limit(20)

  if (error) {
    console.error('[planner.recommend] Existing outreach approval lookup error', error)
    return null
  }

  const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : []
  for (const row of rows) {
    const metadata = readRecord(row.metadata)
    if (readString(metadata?.kind) !== 'venue_outreach') continue
    const status = readString(metadata?.status)
    if (status && ['cancelled', 'rejected', 'expired', 're_approval_required'].includes(status)) continue
    const approval = readRecord(metadata?.approval)
    const approvalStatus = readString(approval?.status)
    if (approvalStatus && ['cancelled', 'rejected', 'expired', 're_approval_required'].includes(approvalStatus)) continue
    const approvalId = readString(approval?.id)
    const messageId = readString(row.id)
    if (approvalId && messageId) {
      return {
        approvalMessageId: messageId,
        approvalId,
      }
    }
  }

  return null
}

/**
 * Resolves a single contact email for the outreach approval card.
 * Prefers venue contact emails, then falls back to vendor contact emails.
 * Returns the email string when found, or null if no catalog record has one.
 */
async function resolveOutreachContactEmail(
  db: PlannerDb,
  venueIds: string[],
  vendorIds: string[]
): Promise<string | null> {
  try {
    if (venueIds.length > 0) {
      const { data } = await db
        .from('catalog_venues')
        .select('contact_email')
        .in('id', venueIds)
        .limit(venueIds.length)
      const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : []
      const email = rows.map((row) => readString(row.contact_email)).find((value): value is string => Boolean(value))
      if (email) return email
    }
    if (vendorIds.length > 0) {
      const { data } = await db
        .from('catalog_vendors')
        .select('contact_email')
        .in('id', vendorIds)
        .limit(vendorIds.length)
      const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : []
      const email = rows.map((row) => readString(row.contact_email)).find((value): value is string => Boolean(value))
      if (email) return email
    }
  } catch (err) {
    console.warn('[planner.recommend] resolveOutreachContactEmail lookup failed', err)
  }
  return null
}

async function resolveVenueMatches(input: {
  auth: { db: PlannerDb; userId: string }
  plan: Plan
  rankingInput: CatalogPlanRankingInput
  archetype: EventArchetypeConfig
  eventPlan: ReturnType<typeof buildAgentEventPlan>
  baseVenueResult: VenueMatchingAgentResult
  baseCandidateVenues: VenueMatchingCandidate[]
  basePayload: Record<string, unknown>
}): Promise<{
  venueResult: VenueMatchingAgentResult
  candidateVenues: VenueMatchingCandidate[]
  notice: VenueMatchNotice | null
}> {
  if (input.baseVenueResult.output.ranked_venues.length > 0) {
    return {
      venueResult: input.baseVenueResult,
      candidateVenues: input.baseCandidateVenues,
      notice: null,
    }
  }

  const broaderCandidateVenues = await loadVenueAgentCandidates(input.auth.db, input.plan, input.rankingInput, {
    neighborhoodMode: 'broader',
  })
  const broaderPayload: Record<string, unknown> = {
    ...input.basePayload,
    candidate_venues: broaderCandidateVenues,
    organizer_preferences: {
      ...(readRecord(input.basePayload.organizer_preferences) ?? {}),
      neighborhood: null,
      searched_neighborhood: input.plan.neighborhood,
      fallback_without_neighborhood: true,
    },
    fallback_search: {
      removed_neighborhood_filter: true,
      searched_neighborhood: input.plan.neighborhood,
    },
  }
  const broaderVenueResult = await runLoggedVenueMatchingAgent(input.auth.userId, input.plan.id, broaderPayload)
  const fallbackVenues = sortRankedVenuesByEstimatedProfit(
    broaderVenueResult.output.ranked_venues,
    broaderCandidateVenues,
    input.plan,
    input.eventPlan
  ).slice(0, 3)

  if (fallbackVenues.length > 0) {
    const notice = buildNoExactMatchNotice(input.plan, fallbackVenues)
    return {
      venueResult: replaceVenueMatchingOutput(
        broaderVenueResult,
        fallbackVenues,
        notice.message,
        false
      ),
      candidateVenues: broaderCandidateVenues,
      notice,
    }
  }

  const adminTaskCreated = await insertCatalogGapAdminTask({
    db: input.auth.db,
    plan: input.plan,
    archetypeKey: input.archetype.key,
    sampleSearchCount: broaderCandidateVenues.length,
  })
  const notice = buildCatalogGapNotice(input.plan, adminTaskCreated)
  return {
    venueResult: replaceVenueMatchingOutput(input.baseVenueResult, [], notice.message, true),
    candidateVenues: broaderCandidateVenues.length > 0 ? broaderCandidateVenues : input.baseCandidateVenues,
    notice,
  }
}

async function resolveCatalogVenueMatches(input: {
  db: PlannerDb
  plan: Plan
  rankingInput: CatalogPlanRankingInput
  archetype: EventArchetypeConfig
  builderAttendance: BuilderAttendanceSummary | null
  venues: CatalogVenueRankingInput[]
  vendors: CatalogVendorRankingInput[]
  ranking: ReturnType<typeof rankCatalogPartners>
  limit: number
  venueLimit: number
  vendorLimit: number
  eventPlan: ReturnType<typeof buildAgentEventPlan>
}): Promise<{
  recommendations: RankedCatalogRecommendation[]
  notice: VenueMatchNotice | null
}> {
  const exactVenueRecommendations = input.ranking.recommendations.filter(
    (recommendation) => recommendation.kind === 'venue'
  )
  if (exactVenueRecommendations.length > 0) {
    return { recommendations: input.ranking.recommendations, notice: null }
  }

  const broaderRankingInput = removeNeighborhoodPreference(input.rankingInput)
  const broaderRanking = rankCatalogPartners({
    plan: broaderRankingInput,
    venues: input.venues,
    vendors: input.vendors,
    archetype: input.archetype,
    builderAttendance: input.builderAttendance,
    limit: input.limit,
    venueLimit: input.venueLimit,
    vendorLimit: input.vendorLimit,
  })
  const fallbackVenueRecommendations = sortCatalogVenueRecommendationsByEstimatedProfit(
    broaderRanking.recommendations.filter((recommendation) => recommendation.kind === 'venue'),
    input.plan,
    input.eventPlan
  ).slice(0, 3)
  const vendorRecommendations = input.ranking.recommendations.filter(
    (recommendation) => recommendation.kind === 'vendor'
  )

  if (fallbackVenueRecommendations.length > 0) {
    return {
      recommendations: [...fallbackVenueRecommendations, ...vendorRecommendations],
      notice: buildNoExactMatchNotice(input.plan, fallbackVenueRecommendations.map(toRankedVenueFromCatalog)),
    }
  }

  const adminTaskCreated = await insertCatalogGapAdminTask({
    db: input.db,
    plan: input.plan,
    archetypeKey: input.archetype.key,
    sampleSearchCount: broaderRanking.recommendations.filter((recommendation) => recommendation.kind === 'venue').length,
  })
  return {
    recommendations: vendorRecommendations,
    notice: buildCatalogGapNotice(input.plan, adminTaskCreated),
  }
}

function replaceVenueMatchingOutput(
  result: VenueMatchingAgentResult,
  rankedVenues: VenueMatchingAgentOutput['ranked_venues'],
  reasonSummary: string,
  noMatch: boolean
): VenueMatchingAgentResult {
  return {
    ...result,
    output: {
      ...result.output,
      ranked_venues: rankedVenues,
      best_recommendation: rankedVenues[0]?.venue_name ?? null,
      reason_summary: reasonSummary,
      no_match: noMatch,
    },
  }
}

function buildNoExactMatchNotice(
  plan: Plan,
  fallbackVenues: VenueMatchingAgentOutput['ranked_venues']
): VenueMatchNotice {
  const searchedNeighborhood = plan.neighborhood ?? null
  const neighborhoodPhrase = formatNeighborhoodPhrase(searchedNeighborhood)

  return {
    type: 'no_exact_match',
    searched_neighborhood: searchedNeighborhood,
    fallback_venues: fallbackVenues.slice(0, 3),
    message: `I couldn't find a venue in ${neighborhoodPhrase} that fits. Here are 3 nearby options that match your size and budget - want me to look at any of these?`,
  }
}

function buildCatalogGapNotice(plan: Plan, adminTaskCreated: boolean): VenueMatchNotice {
  return {
    type: 'catalog_gap',
    searched_neighborhood: plan.neighborhood ?? null,
    fallback_venues: [],
    message:
      "Our Bay Area catalog doesn't have a strong match yet. I can flag this for the 3rdPlace team to source manually - want me to do that?",
    admin_task_created: adminTaskCreated,
  }
}

async function insertCatalogGapAdminTask(input: {
  db: PlannerDb
  plan: Plan
  archetypeKey: string | null | undefined
  sampleSearchCount: number
}): Promise<boolean> {
  const requestedAt = new Date().toISOString()
  const metadata = {
    type: 'catalog_gap',
    plan_id: input.plan.id,
    neighborhood: input.plan.neighborhood,
    guest_count: input.plan.guest_count,
    archetype_key: input.archetypeKey ?? input.plan.event_type ?? null,
    requested_at: requestedAt,
    sample_search_count: input.sampleSearchCount,
  }
  const { error } = await input.db.from('admin_tasks').insert({
    plan_id: input.plan.id,
    task_type: 'catalog_gap',
    description: `Source venue options for ${input.plan.title || 'planner event'} because the catalog has no strong match.`,
    status: 'pending',
    priority: 'low',
    metadata: toJson(metadata),
    notes: JSON.stringify(metadata),
  })

  if (error) {
    console.error('[planner.recommend] Catalog gap admin task insert error', error)
    return false
  }

  return true
}

function sortRankedVenuesByEstimatedProfit(
  rankedVenues: VenueMatchingAgentOutput['ranked_venues'],
  candidateVenues: VenueMatchingCandidate[],
  plan: Plan,
  eventPlan: ReturnType<typeof buildAgentEventPlan>
): VenueMatchingAgentOutput['ranked_venues'] {
  const venueCostById = buildVenueCostMap(candidateVenues)

  return [...rankedVenues].sort((first, second) =>
    estimateVenueProfitCents(second.venue_id, venueCostById, plan, eventPlan) -
    estimateVenueProfitCents(first.venue_id, venueCostById, plan, eventPlan)
  )
}

function sortCatalogVenueRecommendationsByEstimatedProfit(
  recommendations: RankedCatalogRecommendation[],
  plan: Plan,
  eventPlan: ReturnType<typeof buildAgentEventPlan>
): RankedCatalogRecommendation[] {
  return [...recommendations].sort((first, second) =>
    estimateCatalogVenueProfitCents(second, plan, eventPlan) -
    estimateCatalogVenueProfitCents(first, plan, eventPlan)
  )
}

function estimateVenueProfitCents(
  venueId: string,
  venueCostById: Map<string, number | null>,
  plan: Plan,
  eventPlan: ReturnType<typeof buildAgentEventPlan>
): number {
  const guestCount = plan.guest_count ?? eventPlan.expected_attendance ?? 0
  const ticketPriceCents = plan.ticketed ? eventPlan.ticket_price_target ?? 0 : 0
  const estimatedCostCents = venueCostById.get(venueId) ?? Number.MAX_SAFE_INTEGER / 4
  return guestCount * ticketPriceCents - estimatedCostCents
}

function estimateCatalogVenueProfitCents(
  recommendation: RankedCatalogRecommendation,
  plan: Plan,
  eventPlan: ReturnType<typeof buildAgentEventPlan>
): number {
  const guestCount = plan.guest_count ?? eventPlan.expected_attendance ?? 0
  const ticketPriceCents = plan.ticketed ? eventPlan.ticket_price_target ?? 0 : 0
  return guestCount * ticketPriceCents - (recommendation.estimate_cents ?? Number.MAX_SAFE_INTEGER / 4)
}

function removeNeighborhoodPreference(input: CatalogPlanRankingInput): CatalogPlanRankingInput {
  return {
    ...input,
    area: inferCity(input.neighborhood ?? input.area) ?? input.area,
    neighborhood: inferCity(input.neighborhood ?? input.area) ?? input.neighborhood,
  }
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

async function generateAndPersistOperationalArtifacts(input: {
  db: PlannerDb
  userId: string
  plan: Plan
  eventPlan: ReturnType<typeof buildAgentEventPlan>
  topVenue: RecommendedVenueContext | null
  vendorRecommendations: SuggestedVendorRecommendation[]
  profitProjection: ProfitProjectionSummary | null
  archetypeIntake: ArchetypeIntakeOutcomeContext
  conversationHistory: PlannerAgentConversationMessage[]
  mutationContract: Record<string, unknown>
}): Promise<OperationalAgentArtifacts> {
  const artifacts: OperationalAgentArtifacts = {
    workspace_summary: null,
    timeline: null,
    errors: {},
  }

  if (!input.topVenue) {
    artifacts.errors.timeline = 'No venue recommendation was available.'
    artifacts.errors.workspace = 'No venue recommendation was available.'
    await persistPlanOperationalMetadata(input.db, input.plan, input.userId, artifacts)
    return artifacts
  }

  const eventDate = input.plan.date_window_start ?? input.plan.date_window_end ?? input.eventPlan.event_date
  const venueBooking = buildRecommendedVenueBooking(input.plan, input.topVenue)
  const vendorBookings = input.vendorRecommendations.slice(0, 3).map((vendor) => buildRecommendedVendorBooking(input.plan, vendor))

  if (eventDate) {
    const timelinePayload: TimelineAgentInput = {
      event_plan: input.eventPlan,
      event_date: eventDate,
      confirmed_venue_bookings: [venueBooking],
      confirmed_vendor_bookings: vendorBookings,
      venue_requirements: [],
      archetype_intake: input.archetypeIntake,
      mutation_contract: input.mutationContract,
      conversation_history: input.conversationHistory,
    }

    try {
      artifacts.timeline = hasOpenAIKey()
        ? await runLoggedOperationalAgent<TimelineAgentOutput>({
            userId: input.userId,
            planId: input.plan.id,
            agentName: 'timeline',
            payload: timelinePayload,
          })
        : generateMilestoneTemplate(timelinePayload)
    } catch (error) {
      artifacts.errors.timeline = getOperationalArtifactError(error)
      console.warn('[planner.recommend] Timeline generation failed:', error)
    }
  } else {
    artifacts.errors.timeline = 'Plan is missing an event date.'
  }

  const workspacePayload: WorkspaceAgentInput = {
    event_plan: input.eventPlan,
    tasks: [],
    venue_bookings: [venueBooking],
    vendor_bookings: vendorBookings,
    budget_summary: buildWorkspaceBudgetSummary(input.plan, input.profitProjection),
    timeline: artifacts.timeline?.planning_milestones ?? [],
    archetype_intake: input.archetypeIntake,
    mutation_contract: input.mutationContract,
    conversation_history: input.conversationHistory,
  }

  try {
    artifacts.workspace_summary = hasOpenAIKey()
      ? await runLoggedOperationalAgent<WorkspaceAgentOutput>({
          userId: input.userId,
          planId: input.plan.id,
          agentName: 'workspace',
          payload: workspacePayload,
        })
      : buildFallbackWorkspaceSummary(input.topVenue, input.vendorRecommendations, input.profitProjection)
  } catch (error) {
    artifacts.errors.workspace = getOperationalArtifactError(error)
    console.warn('[planner.recommend] Workspace summary generation failed:', error)
  }

  await persistPlanOperationalMetadata(input.db, input.plan, input.userId, artifacts)
  return artifacts
}

async function runLoggedOperationalAgent<TOutput>(input: {
  userId: string
  planId: string
  agentName: 'timeline' | 'workspace'
  payload: Record<string, unknown>
}): Promise<TOutput> {
  const startedAt = Date.now()

  try {
    const { runAgent } = await import('@/lib/ai/agents')
    const result = await runAgent({
      agent_name: input.agentName,
      user_id: input.userId,
      event_id: null,
      payload: input.payload,
    })

    if ((result.status as string) !== 'succeeded') {
      throw new Error(`${input.agentName} returned ${result.status}`)
    }

    await safeLogAgentRun({
      userId: input.userId,
      planId: input.planId,
      agentName: input.agentName,
      status: 'succeeded',
      inputPayload: input.payload,
      outputPayload: result.output,
      durationMs: result.duration_ms,
      model: result.model,
      promptTokens: result.prompt_tokens,
      completionTokens: result.completion_tokens,
      messagesPayload: result.messages_payload,
      rawModelOutput: result.raw_model_output,
    })

    return result.output as TOutput
  } catch (error) {
    const metadata = getAgentRunErrorMetadata(error)
    await safeLogAgentRun({
      userId: input.userId,
      planId: input.planId,
      agentName: input.agentName,
      status: 'failed',
      inputPayload: input.payload,
      outputPayload: null,
      error: error instanceof Error ? error.message : `Unknown ${input.agentName} agent error`,
      durationMs: Date.now() - startedAt,
      model: metadata.model ?? 'gpt-4o-mini',
      promptTokens: metadata.prompt_tokens ?? null,
      completionTokens: metadata.completion_tokens ?? null,
      messagesPayload: metadata.messages_payload ?? null,
      rawModelOutput: metadata.raw_model_output ?? null,
    })
    throw error
  }
}

async function persistPlanOperationalMetadata(
  db: PlannerDb,
  plan: Plan,
  userId: string,
  artifacts: OperationalAgentArtifacts
) {
  const metadata = readRecord(plan.metadata) ?? {}
  const agentCache = readRecord(metadata.agent_cache) ?? {}
  const nextAgentCache = buildOperationalAgentCacheMetadata(artifacts, agentCache)
  const nextMetadata = {
    ...metadata,
    agent_cache: nextAgentCache,
  }

  const { error } = await db
    .from('plans')
    .update({ metadata: nextMetadata as Json })
    .eq('id', plan.id)
    .eq('user_id', userId)

  if (error) {
    console.error('[planner.recommend] Plan operational metadata update error', error)
    return
  }

  await insertOperationalPlanVersion(db, plan, userId, nextMetadata, artifacts)
}

function buildOperationalAgentCacheMetadata(
  artifacts: OperationalAgentArtifacts,
  existingAgentCache: Record<string, unknown> = {}
): Record<string, unknown> {
  const generatedAt = new Date().toISOString()

  return {
    ...existingAgentCache,
    timeline: artifacts.timeline
      ? {
          generated_at: generatedAt,
          source: 'planner_recommendation_ready',
          output: artifacts.timeline,
        }
      : {
          generated_at: generatedAt,
          source: 'planner_recommendation_ready',
          error: artifacts.errors.timeline ?? 'Timeline was not generated.',
        },
    workspace_summary: artifacts.workspace_summary
      ? {
          generated_at: generatedAt,
          source: 'planner_recommendation_ready',
          output: artifacts.workspace_summary,
        }
      : {
          generated_at: generatedAt,
          source: 'planner_recommendation_ready',
          error: artifacts.errors.workspace ?? 'Workspace summary was not generated.',
        },
  }
}

async function insertOperationalPlanVersion(
  db: PlannerDb,
  plan: Plan,
  userId: string,
  metadata: Record<string, unknown>,
  artifacts: OperationalAgentArtifacts
) {
  const { data, error } = await db
    .from('plan_versions')
    .select('version_number')
    .eq('plan_id', plan.id)
    .order('version_number', { ascending: false })
    .limit(1)

  if (error) {
    console.error('[planner.recommend] Plan version lookup for operational artifacts failed', error)
    return
  }

  const latestVersion = readNumber(firstRow(data)?.version_number) ?? 0
  const { error: insertError } = await db.from('plan_versions').insert({
    plan_id: plan.id,
    version_number: latestVersion + 1,
    snapshot: {
      ...plan,
      metadata,
      run_of_show: artifacts.timeline,
      workspace_summary: artifacts.workspace_summary,
      operational_artifact_errors: artifacts.errors,
    } as Json,
    changed_by: userId,
    change_reason: 'agent_operational_artifacts_generated',
  })

  if (insertError) {
    console.error('[planner.recommend] Plan version insert for operational artifacts failed', insertError)
  }
}

function buildRecommendedVenueBooking(plan: Plan, venue: RecommendedVenueContext) {
  return {
    id: `recommended-venue-${venue.venue_id}`,
    event_id: plan.id,
    venue_id: venue.venue_id,
    status: 'recommended',
    quoted_price: venue.quoted_price_cents,
    booking_date: plan.date_window_start ?? plan.date_window_end ?? undefined,
  }
}

function buildRecommendedVendorBooking(plan: Plan, vendor: SuggestedVendorRecommendation) {
  return {
    id: `recommended-vendor-${vendor.vendor_id}`,
    event_id: plan.id,
    vendor_id: vendor.vendor_id,
    status: 'recommended',
    quoted_price: vendor.base_rate_cents,
    booking_date: plan.date_window_start ?? plan.date_window_end ?? undefined,
  }
}

function buildWorkspaceBudgetSummary(
  plan: Plan,
  profitProjection: ProfitProjectionSummary | null
): WorkspaceAgentInput['budget_summary'] {
  const projection = profitProjection?.recommended_projection
  if (!projection) return null

  return {
    event_id: plan.id,
    expected_profit: projection.net_profit_cents,
    profit_margin:
      projection.gross_revenue_cents > 0
        ? projection.net_profit_cents / projection.gross_revenue_cents
        : null,
    break_even_tickets: projection.break_even_tickets,
    net_revenue: projection.gross_revenue_cents,
    total_costs: projection.total_costs_cents,
  }
}

function buildFallbackWorkspaceSummary(
  venue: RecommendedVenueContext,
  vendors: SuggestedVendorRecommendation[],
  profitProjection: ProfitProjectionSummary | null
): WorkspaceAgentOutput {
  const vendorCount = vendors.length
  const blockers = ['User approval is required before any outreach is sent.']
  const profit = profitProjection?.recommended_projection?.net_profit_cents

  return {
    workspace_summary: [
      `Top venue recommendation is ${venue.venue_name ?? 'ready for review'}.`,
      vendorCount > 0 ? `${vendorCount} vendor option${vendorCount === 1 ? '' : 's'} queued for review.` : null,
      typeof profit === 'number' ? `Projected profit is ${formatCurrency(profit)} at the recommended price.` : null,
    ].filter((part): part is string => Boolean(part)).join(' '),
    current_status: 'at_risk',
    blockers,
    overdue_items: [],
    recommended_next_actions: ['Review the recommendations and approve outreach before contacting partners.'],
    approvals_needed: ['Approve venue/vendor outreach.'],
  }
}

function toRecommendedVenueContext(
  candidate: VenueMatchingCandidate | null,
  rankedVenue: VenueMatchingAgentOutput['ranked_venues'][number] | null,
  venueCostCents: number
): RecommendedVenueContext | null {
  const venueId = rankedVenue?.venue_id ?? candidate?.id
  if (!venueId) return null

  return {
    venue_id: venueId,
    venue_name: rankedVenue?.venue_name ?? candidate?.venue_name ?? null,
    quoted_price_cents: Number.isFinite(venueCostCents) ? venueCostCents : candidate ? estimateMinimumVenueCostCents(candidate) : null,
  }
}

function toRecommendedVenueContextFromCatalog(
  recommendation: RankedCatalogRecommendation | null,
  rankedVenue: VenueMatchingAgentOutput['ranked_venues'][number] | null
): RecommendedVenueContext | null {
  const venueId = rankedVenue?.venue_id ?? recommendation?.partner_id
  if (!venueId) return null

  return {
    venue_id: venueId,
    venue_name: rankedVenue?.venue_name ?? recommendation?.name ?? null,
    quoted_price_cents: recommendation?.estimate_cents ?? null,
  }
}

function getOperationalArtifactError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown operational artifact generation error'
}

async function safeLogAgentRun(input: {
  userId: string
  planId: string
  agentName: AgentName
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

async function loadPlanContextMessages(db: PlannerDb, planId: string): Promise<PlanMessage[]> {
  const { data, error } = await db
    .from('plan_messages')
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .order('created_at', { ascending: true })
    .limit(40)

  if (error) {
    console.error('Planner catalog recommend message lookup error:', error)
    return []
  }

  return (data ?? []) as PlanMessage[]
}

async function loadBuilderAttendanceForPlan(
  db: PlannerDb,
  userId: string,
  archetypeKey: string | null
): Promise<BuilderAttendanceSummary | null> {
  const builderId = await getBuilderProfileIdForUser(db, userId)
  if (!builderId) return null

  return summarizeBuilderAttendance(db, builderId, {
    archetype_key: archetypeKey ?? undefined,
    window_days: 365,
  })
}

async function loadBuilderElasticityForPlan(
  db: PlannerDb,
  userId: string,
  archetypeKey: string | null
): Promise<ElasticitySignal | null> {
  const builderId = await getBuilderProfileIdForUser(db, userId)
  if (!builderId) return null

  const signal = await summarizeBuilderTierElasticity(db, builderId, {
    archetype_key: archetypeKey ?? undefined,
    window_days: 365,
  })

  return signal.sample_size > 0 ? signal : null
}

function buildCapacityCalibrationSummary(
  plan: Plan,
  builderAttendance: BuilderAttendanceSummary | null
): CapacityCalibrationSummary {
  const statedGuestCount = readNumber(plan.guest_count)
  if (statedGuestCount === null || !builderAttendance || builderAttendance.sample_size === 0) {
    return {
      calibration_signal: builderAttendance && builderAttendance.sample_size > 0 ? 'stated' : 'no_history',
      stated_guest_count: statedGuestCount,
      projected_attendance: statedGuestCount,
      history_p75: builderAttendance?.p75_tickets_sold ?? null,
      sample_size: builderAttendance?.sample_size ?? 0,
      confidence: builderAttendance?.confidence ?? null,
    }
  }

  const p75 = builderAttendance.p75_tickets_sold
  if (builderAttendance.confidence === 'high' && p75 > statedGuestCount * 1.4) {
    return {
      calibration_signal: 'historical_higher',
      stated_guest_count: statedGuestCount,
      projected_attendance: Math.round(p75),
      history_p75: p75,
      sample_size: builderAttendance.sample_size,
      confidence: builderAttendance.confidence,
    }
  }

  if (builderAttendance.confidence === 'medium' && p75 > statedGuestCount * 1.6) {
    return {
      calibration_signal: 'historical_higher',
      stated_guest_count: statedGuestCount,
      projected_attendance: Math.round((statedGuestCount + p75) / 2),
      history_p75: p75,
      sample_size: builderAttendance.sample_size,
      confidence: builderAttendance.confidence,
    }
  }

  return {
    calibration_signal: builderAttendance.confidence === 'medium' || builderAttendance.confidence === 'high'
      ? 'historical_aligned'
      : 'stated',
    stated_guest_count: statedGuestCount,
    projected_attendance: statedGuestCount,
    history_p75: p75,
    sample_size: builderAttendance.sample_size,
    confidence: builderAttendance.confidence,
  }
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

async function loadSuggestedVendors(
  db: PlannerDb,
  plan: Plan,
  archetype: EventArchetypeConfig,
  venueCostCents: number
): Promise<SuggestedVendorRecommendation[]> {
  try {
    const ranked = await rankVendorsForPlan(plan, null, archetype, db, { perStackItem: 2 })
    const rankedSuggestions = Object.values(ranked.by_service_type)
      .flat()
      .map(toSuggestedVendorFromRanked)
    if (rankedSuggestions.length > 0) return rankedSuggestions
  } catch (error) {
    console.warn('[planner.recommend] Vendor ranker failed; falling back to base-rate vendor lookup', error)
  }

  const resolvedStack = resolveConditionalVendors(archetype.vendor_stack, plan)
  const requiredAndRecommended = resolvedStack.filter((item) =>
    item.necessity === 'required' || item.necessity === 'recommended'
  )
  const optionalItems = shouldIncludeOptionalVendors(plan, venueCostCents, requiredAndRecommended)
    ? resolvedStack.filter((item) => item.necessity === 'optional')
    : []
  const stackItems = [...requiredAndRecommended, ...optionalItems]
  const serviceTypes = Array.from(new Set(stackItems.map((item) => item.service_type)))
  const dbServiceTypes = Array.from(new Set(serviceTypes.map(toDbVendorServiceType)))
  if (serviceTypes.length === 0) return []

  let query = db
    .from('vendor_profiles')
    .select(VENDOR_RANKER_SELECT_COLUMNS)
    .eq('is_published', true)

  if (typeof query.in === 'function') {
    query = query.in('service_type', dbServiceTypes)
  }

  const { data, error } = await query
    .order('base_rate', { ascending: true, nullsFirst: false })
    .limit(Math.max(10, serviceTypes.length * 4))

  if (error) {
    console.error('[planner.recommend] Suggested vendor lookup error', error)
    return []
  }

  return ((data ?? []) as Record<string, unknown>[])
    .filter((row) => {
      const serviceType = readString(row.service_type)
      return serviceType ? dbServiceTypes.some((type) => type === serviceType) : false
    })
    .filter((row) => vendorMatchesPlanArea(row, plan))
    .sort((first, second) =>
      (readNumber(first.base_rate ?? first.hourly_rate) ?? Number.POSITIVE_INFINITY) -
      (readNumber(second.base_rate ?? second.hourly_rate) ?? Number.POSITIVE_INFINITY)
    )
    .map((row) => {
      const serviceType = readString(row.service_type ?? row.vendor_type)
      const stackItem = stackItems.find((item) => serviceType && toDbVendorServiceType(item.service_type) === serviceType)
      return stackItem ? toSuggestedVendorRecommendation(row, stackItem) : null
    })
    .filter((vendor): vendor is SuggestedVendorRecommendation => vendor !== null)
    .filter(limitTwoPerServiceType)
}

function toSuggestedVendorFromRanked(vendor: RankedVendor): SuggestedVendorRecommendation {
  const baseRateCents = sanitizeSuggestedVendorRateCents(vendor.base_rate_cents, vendor.service_type)

  return {
    vendor_id: vendor.vendor_id,
    name: vendor.name,
    service_type: vendor.service_type,
    necessity: vendor.necessity,
    service_note: vendor.service_note,
    base_rate_cents: baseRateCents,
    fit_score: vendor.total_score,
    pros: [
      vendor.user_facing_intro,
      `${vendor.total_score}/100 vendor fit score.`,
      baseRateCents === null ? 'Est. TBD — confirm with vendor.' : null,
      vendor.response_p50_minutes !== null
        ? `Median response time ${formatResponseTime(vendor.response_p50_minutes)}.`
        : 'Response time needs confirmation.',
      vendor.prior_events_with_builder > 0
        ? `${vendor.prior_events_with_builder} prior events with this builder.`
        : null,
    ].filter((item): item is string => Boolean(item)),
    cons: [
      ...vendor.gate_warnings.map((warning) => warning.reason),
      ...vendor.score_breakdown.warnings,
    ],
  }
}

function formatResponseTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

function sanitizeSuggestedVendorRateCents(value: unknown, serviceType: string | null | undefined): number | null {
  const rateCents = readNumber(value)
  if (rateCents === null || rateCents <= 0) return null
  if (isNonTrivialVendorServiceType(serviceType) && rateCents < 5_000) return null
  return Math.round(rateCents)
}

function isNonTrivialVendorServiceType(serviceType: string | null | undefined): boolean {
  const normalized = normalizeText(serviceType)
  return [
    'av tech',
    'av_tech',
    'av production',
    'av_production',
    'audio visual tech',
    'catering',
    'bartending',
    'photography',
    'photographer',
    'videography',
    'videographer',
    'florist',
    'decor',
    'lighting',
    'staffing',
    'security',
    'event planning',
    'event_planning',
    'dj',
  ].includes(normalized)
}

function toDbVendorServiceType(serviceType: string): string {
  if (serviceType === 'photographer') return 'photography'
  if (serviceType === 'videographer') return 'videography'
  if (serviceType === 'av_production') return 'av_tech'
  if (serviceType === 'check_in' || serviceType === 'staffing' || serviceType === 'security') return 'event_planning'
  if (serviceType === 'decor' || serviceType === 'florist' || serviceType === 'lighting') return 'florist'
  if (
    serviceType === 'instructor' ||
    serviceType === 'transport' ||
    serviceType === 'cake_pastry' ||
    serviceType === 'photo_booth' ||
    serviceType === 'music_coordinator' ||
    serviceType === 'permits' ||
    serviceType === 'pos_systems'
  ) {
    return 'other'
  }
  return serviceType
}

function shouldIncludeOptionalVendors(
  plan: Plan,
  venueCostCents: number,
  requiredAndRecommended: VendorStackItem[]
): boolean {
  const budget = plan.budget_cap_cents ?? 0
  if (budget <= 0) return false
  const estimatedRequiredVendorCost = requiredAndRecommended.length * 75000
  return budget - venueCostCents - estimatedRequiredVendorCost >= Math.max(100000, Math.round(budget * 0.15))
}

/**
 * Evaluates a VendorTrigger against the plan.
 * Returns true if the trigger condition is met (vendor should be activated).
 */
function evaluateVendorTrigger(trigger: VendorTrigger, plan: Plan): boolean {
  let planValue: string | number | boolean | null = null
  const p = plan as unknown as Record<string, unknown>

  switch (trigger.field) {
    case 'guest_count':
      planValue = plan.guest_count ?? null
      break
    case 'indoor_outdoor':
      planValue = readString(readPlanMatchingSignal(plan, 'indoor_outdoor'))
      break
    case 'catering_style':
      planValue = readString(readPlanMatchingSignal(plan, 'catering_style'))
      break
    case 'is_ticketed':
      planValue = plan.ticketed ?? null
      break
    case 'has_bar':
      planValue = readPlanMatchingBoolean(plan, 'bar_required')
      break
    case 'duration_hours': {
      const mins = readNumber(readPlanMatchingSignal(plan, 'duration_minutes') ?? p.duration_minutes)
      planValue = mins !== null ? mins / 60 : null
      break
    }
    case 'venue_type':
      planValue = typeof p.venue_type === 'string' ? p.venue_type : null
      break
    case 'setup_format':
      planValue = readString(readPlanMatchingSignal(plan, 'setup_format'))
      break
    case 'music_format':
      planValue = readString(readPlanMatchingSignal(plan, 'music_format'))
      break
    default:
      return false
  }

  if (planValue === null) return false

  const { op, value } = trigger

  switch (op) {
    case 'gt':  return typeof planValue === 'number' && typeof value === 'number' && planValue > value
    case 'gte': return typeof planValue === 'number' && typeof value === 'number' && planValue >= value
    case 'lt':  return typeof planValue === 'number' && typeof value === 'number' && planValue < value
    case 'lte': return typeof planValue === 'number' && typeof value === 'number' && planValue <= value
    case 'eq':  return planValue === value
    case 'neq': return planValue !== value
    case 'in':  return Array.isArray(value) && value.includes(planValue as string)
    default: return false
  }
}

/**
 * Resolves conditional vendor stack items against the plan.
 * Items whose trigger evaluates to true are promoted to 'recommended'.
 * Items whose trigger evaluates to false are dropped.
 */
function resolveConditionalVendors(
  stack: VendorStackItem[],
  plan: Plan
): VendorStackItem[] {
  return stack.flatMap((item) => {
    if (item.necessity !== 'conditional') return [item]
    if (!item.trigger) return []
    if (!evaluateVendorTrigger(item.trigger, plan)) return []
    return [{ ...item, necessity: 'recommended' as const }]
  })
}

function limitTwoPerServiceType(
  vendor: SuggestedVendorRecommendation,
  index: number,
  vendors: SuggestedVendorRecommendation[]
): boolean {
  return vendors
    .slice(0, index + 1)
    .filter((candidate) => candidate.service_type === vendor.service_type)
    .length <= 2
}

function vendorMatchesPlanArea(row: Record<string, unknown>, plan: Plan): boolean {
  const area = normalizeText(plan.neighborhood)
  if (!area) return true

  const serviceText = normalizeText([
    row.service_area,
    row.regions_served,
    row.availability_notes,
  ].map((value) => (typeof value === 'string' ? value : '')).join(' '))

  if (!serviceText) return true
  return serviceText.includes(area) || serviceText.includes('san francisco') || serviceText.includes('bay area')
}

function groupVendorRecommendations(
  vendors: SuggestedVendorRecommendation[],
  archetype: EventArchetypeConfig
): VendorRecommendationGroup[] {
  return archetype.vendor_stack
    .map((item) => ({
      service_type: item.service_type,
      necessity: item.necessity,
      note: item.notes ?? null,
      vendors: vendors.filter((vendor) => vendor.service_type === item.service_type),
    }))
    .filter((group) => group.vendors.length > 0)
}

function buildVendorMatchNotice(
  archetype: EventArchetypeConfig,
  vendors: SuggestedVendorRecommendation[]
): VendorMatchNotice {
  const expectedServiceTypes = Array.from(new Set(
    archetype.vendor_stack
      .filter((item) => item.necessity === 'required' || item.necessity === 'recommended')
      .map((item) => item.service_type)
  ))
  if (expectedServiceTypes.length === 0) return null

  const matchedServiceTypes = new Set(vendors.map((vendor) => vendor.service_type).filter(Boolean))
  const missingServiceTypes = expectedServiceTypes.filter((serviceType) => !matchedServiceTypes.has(serviceType))
  if (missingServiceTypes.length === 0) return null

  return {
    type: 'vendor_gap',
    missing_service_types: missingServiceTypes,
    message:
      vendors.length === 0
        ? `I did not find available vendors for the suggested ${formatList(missingServiceTypes)} services yet.`
        : `I found some vendors, but still need matches for ${formatList(missingServiceTypes)}.`,
  }
}

function toResolvedArchetypeSummary(archetype: EventArchetypeConfig): ResolvedArchetypeSummary {
  return {
    key: archetype.key,
    display_name: archetype.display_name,
  }
}

async function loadVenueAgentCandidates(
  db: PlannerDb,
  plan: Plan,
  rankingInput: CatalogPlanRankingInput,
  options: { neighborhoodMode?: VenueCandidateSearchMode } = {}
): Promise<VenueMatchingCandidate[]> {
  let query = db
    .from('venues')
    .select(VENUE_AGENT_SELECT_COLUMNS)
    .eq('is_published', true)
    .limit(50)
  const neighborhood = readString(rankingInput.neighborhood ?? rankingInput.area ?? plan.neighborhood)
  const city = inferCity(neighborhood)
  const budgetCents = readNumber(plan.budget_cap_cents ?? rankingInput.budget_cap_cents ?? rankingInput.budget_cents)

  // Note: capacity is intentionally NOT filtered in SQL here. Supabase .gte() excludes NULL
  // rows, which would silently eliminate venues that have no capacity data set (e.g. seeded
  // catalog entries). The OpenAI agent and downstream ranker handle capacity eligibility; we
  // just need a broad city-scoped candidate set.
  if (city) {
    query = query.ilike('city', `%${escapeSupabaseOrValue(city)}%`)
  }

  const { data, error } = await query
  if (error) {
    console.error('[planner.recommend] Venue agent candidate lookup error', error)
    return []
  }

  const rows = ((data ?? []) as Record<string, unknown>[])
    .filter((row) =>
      options.neighborhoodMode === 'strict'
        ? venueMatchesNeighborhood(row, neighborhood)
        : true
    )

  return rows
    .map(toVenueMatchingCandidate)
    .filter((candidate): candidate is VenueMatchingCandidate => candidate !== null)
    .filter((candidate) => venueFitsBudget(candidate, budgetCents))
}

async function filterCompliantVenueCandidates(
  admin: PlannerDb,
  venues: VenueMatchingCandidate[]
): Promise<VenueMatchingCandidate[]> {
  if (venues.length === 0) return venues

  const checked = await Promise.all(venues.map(async (venue) => {
    try {
      const status = await getVenueComplianceStatus(admin as any, venue.id)
      return status.is_compliant ? venue : null
    } catch (error) {
      console.error('[planner.recommend] Venue compliance check failed', {
        venue_id: venue.id,
        error,
      })
      return venue
    }
  }))
  const compliantVenues = checked.filter((venue): venue is VenueMatchingCandidate => venue !== null)

  if (compliantVenues.length < venues.length && compliantVenues.length < 3) {
    console.warn('[planner.recommend] Venue compliance filtering left fewer than 3 candidates', {
      before: venues.length,
      after: compliantVenues.length,
    })
  }

  return compliantVenues
}

function buildRankingInput(
  plan: Plan,
  messages: PlanMessage[],
  organizerPreferences: BuilderOrganizerPreferences | null = null
): CatalogPlanRankingInput {
  const summary = readLatestSummary(messages)
  const planMeta = readRecord(plan.metadata)
  const rebookPrefs = readRecord(planMeta?.template_rebook_preferences)
  const preferredVenueIds = readStringArray(rebookPrefs?.preferred_venue_ids)
  const preferredVendorIds = readStringArray(rebookPrefs?.preferred_vendor_ids)

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
    consumption_share: readString(summary.consumption_share ?? summary.revenue_share),
    room_type: readString(summary.room_type),
    date_window:
      readString(summary.date) ??
      readString(summary.date_window) ??
      formatDateWindow(plan.date_window_start, plan.date_window_end),
    date_window_start: plan.date_window_start ?? readString(summary.date_window_start),
    date_window_end: plan.date_window_end ?? readString(summary.date_window_end),
    metadata: plan.metadata,
    preferred_venue_ids: preferredVenueIds.length > 0 ? preferredVenueIds : null,
    preferred_vendor_ids: preferredVendorIds.length > 0 ? preferredVendorIds : null,
    organizer_preferred_amenities: organizerPreferences?.preferred_amenities.length
      ? organizerPreferences.preferred_amenities
      : null,
  }
}

function buildAgentEventPlan(plan: Plan, rankingInput: CatalogPlanRankingInput) {
  const expectedAttendance = readNumber(plan.guest_count ?? rankingInput.guest_count ?? rankingInput.headcount)
  const budgetCents = readNumber(plan.budget_cap_cents ?? rankingInput.budget_cap_cents ?? rankingInput.budget_cents)
  const profitGoalCents = readNumber(plan.profit_goal_cents)
  const ticketPriceTargetCents = readPlanTicketPriceTargetCents(plan) ??
    estimateTicketPriceTargetCents({
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
  venueCostCents: number,
  vendorCostCents: number,
  context: {
    archetype: EventArchetypeConfig
    elasticity: ElasticitySignal | null
    historicalAttendance: BuilderAttendanceSummary | null
    ticketPriceSweepCents: number[]
    profitProjection: ProfitProjectionSummary
    venue: VenueMatchingCandidate | null
    archetypeIntake: ArchetypeIntakeOutcomeContext
    mutationContract: Record<string, unknown>
    conversationHistory: PlannerAgentConversationMessage[]
    vendorCostSummary: VendorEconomicsCostSummary
  }
): EconomicsAgentInput {
  const venueChi = deriveVenueChiEconomics(context.venue)

  return {
    event_plan: eventPlan,
    budget_line_items: [],
    expected_attendance: plan.guest_count ?? eventPlan.expected_attendance ?? 0,
    venue_cost_cents: venueCostCents,
    vendor_cost_cents: vendorCostCents,
    ticket_price_cents: plan.ticketed ? eventPlan.ticket_price_target ?? 0 : 0,
    sponsorship_revenue_cents: 0,
    venue_commercial_model: venueChi.venue_commercial_model,
    venue_chi_rate: venueChi.venue_chi_rate ?? 0,
    estimated_spend_per_head_cents: 4000,
    cost_confidence: context.vendorCostSummary.cost_confidence,
    negotiated_savings_cents: context.vendorCostSummary.negotiated_savings_cents,
    plan: plan as unknown as Record<string, unknown>,
    venue: context.venue,
    archetype: context.archetype as unknown as Record<string, unknown>,
    archetype_intake: context.archetypeIntake,
    mutation_contract: context.mutationContract,
    conversation_history: context.conversationHistory,
    elasticity: context.elasticity,
    historical_attendance: context.historicalAttendance as unknown as Record<string, unknown> | null,
    ticket_price_sweep_cents: normalizeTicketPriceSweep([
      ...context.ticketPriceSweepCents,
      ...(eventPlan.ticket_price_target ? [eventPlan.ticket_price_target] : []),
    ]),
    score_breakdown: {
      financial: {
        details: {
          ticket_price_sweep: context.profitProjection,
          projections: context.profitProjection.projections,
          vendor_cost_confidence: context.vendorCostSummary.cost_confidence,
          negotiated_savings_cents: context.vendorCostSummary.negotiated_savings_cents,
          vendor_cost_lines: context.vendorCostSummary.lines,
        },
      },
    },
  }
}

function deriveVenueChiEconomics(venue: VenueMatchingCandidate | null): Partial<Pick<
  EconomicsAgentInput,
  'venue_commercial_model' | 'venue_chi_rate'
>> {
  if (!venue) return {}

  const barConsumptionSharePercent = readNumber(venue.bar_consumption_share_percent)
  if (venue.bar_consumption_share_enabled && barConsumptionSharePercent && barConsumptionSharePercent > 0) {
    return {
      venue_commercial_model: 'bar_consumption_share',
      venue_chi_rate: barConsumptionSharePercent,
    }
  }

  const ticketSharePercent = readNumber(venue.ticket_sales_share_percent)
  if (venue.ticket_sales_share_enabled && ticketSharePercent && ticketSharePercent > 0) {
    return {
      venue_commercial_model: 'ticket_consumption_share',
      venue_chi_rate: ticketSharePercent,
    }
  }

  const perHeadChiCents = readCents(venue.per_head_chi_cents)
  if (perHeadChiCents && perHeadChiCents > 0) {
    return {
      venue_commercial_model: 'per_head_chi_cents',
      venue_chi_rate: perHeadChiCents,
    }
  }

  return {}
}

function buildFallbackEconomicsOutput(
  plan: Plan,
  eventPlan: ReturnType<typeof buildAgentEventPlan>,
  recommendations: RankedCatalogRecommendation[],
  ticketPriceSweepCents: number[] = [25, 50, 75, 100].map((amount) => amount * 100),
  vendorCostSummary: VendorEconomicsCostSummary | null = null
): EconomicsAgentOutput {
  const topVenueEstimate = recommendations.find((recommendation) => recommendation.kind === 'venue')?.estimate_cents ?? 0
  const vendorCostCents = vendorCostSummary?.vendor_cost_cents ?? 0
  const calculations = calculateEventPlanningEconomics({
    event_plan: eventPlan,
    budget_line_items: [],
    expected_attendance: plan.guest_count ?? eventPlan.expected_attendance ?? 0,
    venue_cost_cents: topVenueEstimate,
    vendor_cost_cents: vendorCostCents,
    ticket_price_cents: plan.ticketed ? eventPlan.ticket_price_target ?? 0 : 0,
    sponsorship_revenue_cents: 0,
  })

  const sweep = buildProfitProjectionSummary(
    plan,
    topVenueEstimate,
    vendorCostCents,
    ticketPriceSweepCents
  )
  const pricePoints = sweep.projections.map((projection) => ({
    price_cents: projection.ticket_price_cents,
    projected_net_cents: projection.net_profit_cents,
    break_even_tickets: projection.break_even_tickets ?? 0,
    recommendation: projection.ticket_price_cents === sweep.recommended_price_cents
      ? 'recommended' as const
      : projection.ticket_price_cents > (sweep.recommended_price_cents ?? 0)
        ? 'aggressive' as const
        : 'conservative' as const,
    reasoning: `At ${formatCurrency(projection.ticket_price_cents)}, projected net is ${formatCurrency(projection.net_profit_cents)}.`,
  }))
  const recommendationSummary =
    'Fallback economics projection generated without OpenAI. Confirm venue quote, vendor costs, and ticket price before approval.'

  return {
    ...calculations,
    recommendation_summary: recommendationSummary,
    narrative: recommendationSummary,
    price_points: pricePoints,
    recommended_price_cents: sweep.recommended_price_cents ?? pricePoints[0]?.price_cents ?? 0,
    historical_anchor: null,
  }
}

function readLatestSummary(messages: PlanMessage[]): Record<string, unknown> {
  for (const message of [...messages].reverse()) {
    const metadata = readRecord(message.metadata)
    const summary = readRecord(metadata?.summary)
    if (summary) return summary
  }

  return {}
}

function buildAgentConversationHistory(messages: PlanMessage[]): PlannerAgentConversationMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    message_type: message.message_type,
  }))
}

function buildArchetypeIntakeOutcomeContext(
  messages: PlanMessage[],
  archetype: EventArchetypeConfig
): ArchetypeIntakeOutcomeContext {
  const questions = messages
    .map((message) => readRecord(readRecord(message.metadata)?.archetype_question))
    .filter((question): question is Record<string, unknown> => question !== null)
  const questionIds = uniqueStrings(questions.map((question) => readString(question.id)).filter((id): id is string => Boolean(id)))
  const questionPrompts = uniqueStrings(
    questions.map((question) => readString(question.prompt)).filter((prompt): prompt is string => Boolean(prompt))
  )

  return {
    archetype_key: archetype.key,
    archetype_display_name: archetype.display_name,
    answer_text: buildArchetypeAnswerText(messages),
    question_ids_asked: questionIds,
    questions_asked: questionPrompts,
    required_amenities: archetype.required_amenities,
    vendor_stack: archetype.vendor_stack.filter((item) =>
      item.necessity === 'required' || item.necessity === 'recommended'
    ),
    preferred_commercial_models: archetype.preferred_commercial_models,
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
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
  economicsResult: EconomicsAgentResult | null,
  venueCostById: Map<string, number | null>,
  vendorRecommendations: SuggestedVendorRecommendation[],
  vendorRecommendationGroups: VendorRecommendationGroup[],
  archetype: EventArchetypeConfig,
  profitProjection: ProfitProjectionSummary | null,
  elasticity: ElasticitySignal | null = null,
  venueMatchNotice: VenueMatchNotice | null = null,
  vendorMatchNotice: VendorMatchNotice = null,
  capacityCalibration: CapacityCalibrationSummary | null = null
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
      archetype: toResolvedArchetypeSummary(archetype),
      user_facing_intro: venue.user_facing_intro,
      no_match: venueResult.output.no_match,
      reason_summary: venueResult.output.reason_summary,
      venue_match_notice: venueMatchNotice,
      capacity_calibration: venue.capacity_calibration ?? capacityCalibration,
      elasticity,
    }),
  }))
  const vendorInserts = vendorRecommendations.slice(0, 3).map((vendor, index) => ({
    plan_id: planId,
    type: 'vendor',
    reference_id: vendor.vendor_id,
    external_name: null,
    price_cents: vendor.base_rate_cents,
    notes: vendor.pros.join('. '),
    rank: index + 1,
    is_best_fit: index === 0,
    status: 'pending',
    metadata: toJson({
      recommendation_type: 'vendor',
      entity_id: vendor.vendor_id,
      fit_score: vendor.fit_score,
      service_type: vendor.service_type,
      necessity: vendor.necessity,
      service_note: vendor.service_note,
      pros: vendor.pros,
      cons: vendor.cons,
      source: 'archetype_vendor_stack',
      archetype: toResolvedArchetypeSummary(archetype),
      vendor_match_notice: vendorMatchNotice,
    }),
  }))
  const economicsInsert = economicsResult
    ? buildEconomicsRecommendationInsert(
        planId,
        economicsResult.output,
        'economics_agent',
        economicsResult.model,
        profitProjection,
        elasticity
      )
    : null
  const inserts = [...venueInserts, ...vendorInserts, ...(economicsInsert ? [economicsInsert] : [])]

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
  source: string,
  profitProjection: ProfitProjectionSummary | null = null,
  elasticity: ElasticitySignal | null = null
): Promise<Recommendation[]> {
  const { data, error } = await db
    .from('recommendations')
    .insert([buildEconomicsRecommendationInsert(planId, economics, source, 'deterministic', profitProjection, elasticity)])
    .select(RECOMMENDATION_SELECT_COLUMNS)

  if (error) {
    console.error('[planner.recommend] Economics recommendation insert error', error)
    throw new Error('Failed to persist economics recommendation')
  }

  return (data ?? []) as Recommendation[]
}

async function persistRecommendationShoppingList(input: {
  db: PlannerDb
  plan: Plan
  topVenue: RecommendedVenueContext | null
  topRankedVenue: VenueMatchingAgentOutput['ranked_venues'][number] | null
  vendorRecommendations: SuggestedVendorRecommendation[]
  profitProjection: ProfitProjectionSummary | null
}) {
  const currentMetadata = readRecord(input.plan.metadata) ?? {}
  const currentShoppingList = readRecord(currentMetadata.shopping_list) ?? {}
  const selectedVenue = input.topVenue
    ? {
        id: input.topVenue.venue_id,
        reference_id: input.topVenue.venue_id,
        type: 'venue',
        external_name: input.topVenue.venue_name,
        price_cents: input.topVenue.quoted_price_cents,
        fit_score: input.topRankedVenue?.fit_score ?? null,
        reason: input.topRankedVenue?.user_facing_intro ?? null,
        is_best_fit: true,
      }
    : null
  const selectedVendors = input.vendorRecommendations.slice(0, 3).map((vendor, index) => ({
    id: vendor.vendor_id,
    reference_id: vendor.vendor_id,
    type: 'vendor',
    external_name: vendor.name,
    service_type: vendor.service_type,
    price_cents: vendor.base_rate_cents,
    fit_score: vendor.fit_score,
    necessity: vendor.necessity,
    rank: index + 1,
  }))
  const shoppingList = {
    ...currentShoppingList,
    selected_venue: selectedVenue,
    selected_vendors: selectedVendors,
    profit_projection: input.profitProjection,
    updated_at: new Date().toISOString(),
  }
  const nextMetadata = {
    ...currentMetadata,
    shopping_list: shoppingList,
  }

  const { error } = await input.db
    .from('plans')
    .update({ metadata: nextMetadata as Json })
    .eq('id', input.plan.id)

  if (error) {
    console.error('[planner.recommend] Plan shopping list update error', error)
  }
}

function buildEconomicsRecommendationInsert(
  planId: string,
  economics: EconomicsAgentOutput,
  source: string,
  model: string,
  profitProjection: ProfitProjectionSummary | null = null,
  elasticity: ElasticitySignal | null = null
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
      ticket_price_sweep: profitProjection,
      price_points: economics.price_points,
      recommended_price_cents: economics.recommended_price_cents,
      historical_anchor: economics.historical_anchor,
      narrative: economics.narrative,
      elasticity,
      risk_flags: economics.risk_flags,
      recommendation_summary: economics.recommendation_summary,
    }),
  }
}

function toRankedVenueFromCatalog(
  recommendation: RankedCatalogRecommendation
): VenueMatchingAgentOutput['ranked_venues'][number] {
  const archetypeReasons = readStringArray(recommendation.metadata.archetype_reasons)
  const capacityCalibration = readCapacityCalibration(recommendation.metadata.capacity_calibration)

  return {
    venue_id: recommendation.partner_id,
    venue_name: recommendation.name,
    fit_score: recommendation.score,
    user_facing_intro:
      archetypeReasons[0] ??
      recommendation.reasoning.find((reason) => /capacity|commercial|matches/i.test(reason)) ??
      `${recommendation.name} is a ${recommendation.fit_label.toLowerCase()} for this archetype.`,
    archetype_reasons: archetypeReasons,
    commercial_model_match: readString(recommendation.metadata.commercial_model_match) ?? undefined,
    capacity_calibration: capacityCalibration ?? undefined,
    pros: recommendation.reasoning.length > 0
      ? recommendation.reasoning
      : [`${recommendation.name} ranked as a ${recommendation.fit_label.toLowerCase()}.`],
    cons: recommendation.blocking_issues,
    questions_to_ask_venue: [
      'Can you confirm availability, minimum spend, deposit, and included services for this event?',
    ],
  }
}

function readCapacityCalibration(value: unknown): VenueMatchingAgentOutput['ranked_venues'][number]['capacity_calibration'] | null {
  const record = readRecord(value)
  if (!record) return null

  const calibrationSignal = readString(record.calibration_signal)
  const scoreSignal = readString(record.score_calibration_signal)
  if (
    !isCapacityCalibrationSignal(calibrationSignal) ||
    !isCapacityScoreCalibrationSignal(scoreSignal)
  ) {
    return null
  }

  return {
    projected_attendance: readNumber(record.projected_attendance),
    calibration_signal: calibrationSignal,
    score_calibration_signal: scoreSignal,
    history_p75: readNumber(record.history_p75),
    sample_size: readNumber(record.sample_size) ?? 0,
    confidence: isAttendanceConfidence(record.confidence) ? record.confidence : null,
  }
}

function toSuggestedVendorFromCatalog(
  recommendation: RankedCatalogRecommendation,
  archetype: EventArchetypeConfig
): SuggestedVendorRecommendation {
  const serviceType = readString(recommendation.metadata.service_type)
  const stackItem = archetype.vendor_stack.find((item) => item.service_type === serviceType)
  const baseRateCents = sanitizeSuggestedVendorRateCents(recommendation.estimate_cents, serviceType)

  return {
    vendor_id: recommendation.partner_id,
    name: recommendation.name,
    service_type: serviceType,
    necessity: stackItem?.necessity ?? 'recommended',
    service_note: stackItem?.notes ?? null,
    base_rate_cents: baseRateCents,
    fit_score: recommendation.score,
    pros: recommendation.reasoning.length > 0
      ? recommendation.reasoning
      : [`${recommendation.name} is a practical vendor fit for this event.`],
    cons: recommendation.blocking_issues,
  }
}

function toSuggestedVendorRecommendation(
  row: Record<string, unknown>,
  stackItem: VendorStackItem
): SuggestedVendorRecommendation | null {
  const id = readString(row.id)
  const name = readString(row.name)
  if (!id || !name) return null

  const serviceType = stackItem.service_type
  const displayServiceType = readString(row.service_type ?? row.vendor_type) ?? serviceType
  const baseRateCents = sanitizeSuggestedVendorRateCents(row.base_rate ?? row.hourly_rate, displayServiceType)
  const rating = readNumber(row.average_rating ?? row.rating)
  const totalBookings = readNumber(row.total_bookings ?? row.total_gigs)
  const pros = [
    displayServiceType ? `${toTitleCase(displayServiceType.replace(/_/g, ' '))} fit for this event type.` : null,
    baseRateCents !== null ? `${formatCurrency(baseRateCents)} estimated starting rate.` : 'Est. TBD — confirm with vendor.',
    rating !== null && rating > 0 ? `${rating.toFixed(1)} average rating.` : null,
    totalBookings !== null && totalBookings > 0 ? `${totalBookings} prior bookings recorded.` : null,
  ].filter((item): item is string => item !== null)

  return {
    vendor_id: id,
    name,
    service_type: serviceType,
    necessity: stackItem.necessity,
    service_note: stackItem.notes ?? null,
    base_rate_cents: baseRateCents,
    fit_score: Math.min(100, 78 + Math.min(totalBookings ?? 0, 10) + (rating ? Math.round(rating) : 0)),
    pros,
    cons: baseRateCents === null ? ['Confirm quote before approval.'] : [],
  }
}

function buildVenueRecommendationNotes(venue: VenueMatchingAgentOutput['ranked_venues'][number]): string {
  const intro = venue.user_facing_intro ?? null
  const pros = venue.pros.length > 0 ? `Pros: ${venue.pros.join('; ')}` : null
  const cons = venue.cons.length > 0 ? `Cons: ${venue.cons.join('; ')}` : null
  return [intro, pros, cons].filter((part): part is string => part !== null).join(' ')
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
    hourly_rate: readCents(
      row.hourly_rate_cents as number | string | null | undefined,
      row.hourly_rate as number | string | null | undefined
    ),
    minimum_hours: readNumber(row.minimum_hours),
    is_published: readBoolean(row.is_published),
    per_head_chi_cents: readCents(
      row.per_head_chi_cents as number | string | null | undefined,
      (row.per_head_kickback_cents ?? row.per_head_kickback) as number | string | null | undefined
    ),
    offers_chis: readBoolean(row.offers_chis ?? row.offers_kickbacks),
    deposit_percentage: readNumber(row.deposit_percentage),
    cancellation_terms: readString(row.cancellation_terms),
    available_days: readStringArray(row.available_days),
    bar_consumption_share_enabled: readBoolean(row.bar_consumption_share_enabled ?? row.bar_revenue_share_enabled),
    bar_consumption_share_percent: readNumber(
      row.bar_consumption_share_percent ??
      row.bar_consumption_share_pct ??
      row.bar_revenue_share_percent ??
      row.bar_rev_share_pct ??
      row.bar_revenue_percentage
    ),
    ticket_sales_share_enabled: readBoolean(row.ticket_sales_share_enabled),
    ticket_sales_share_percent: readNumber(row.ticket_sales_share_percent ?? row.ticket_sales_share_pct),
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

function sumVendorCostCents(vendors: SuggestedVendorRecommendation[]): number {
  return vendors.reduce((sum, vendor) => sum + (vendor.base_rate_cents ?? 0), 0)
}

function estimateVendorCostCents(
  plan: Plan,
  venueCostCents: number,
  vendors: SuggestedVendorRecommendation[]
): number {
  if (vendors.length > 0) return sumVendorCostCents(vendors)
  return Math.max((plan.budget_cap_cents ?? 0) - venueCostCents, 0)
}

function buildProfitProjectionSummary(
  plan: Plan,
  venueCostCents: number,
  vendorCostCents: number,
  ticketPriceSweepCents: number[] = [25, 50, 75, 100].map((amount) => amount * 100)
): ProfitProjectionSummary {
  const guestCount = plan.guest_count ?? 0
  const knownCostsCents = venueCostCents + vendorCostCents
  const totalCostsCents = Math.max(knownCostsCents, plan.budget_cap_cents ?? 0)
  const explicitTicketPriceCents = readPlanTicketPriceTargetCents(plan)
  const ticketPriceOptions = normalizeTicketPriceSweep([
    ...ticketPriceSweepCents,
    ...(explicitTicketPriceCents ? [explicitTicketPriceCents] : []),
  ])
  const projections = ticketPriceOptions.map((ticketPriceCents) => {
    const grossRevenueCents = guestCount * ticketPriceCents
    const rawBreakEvenTickets = ticketPriceCents > 0 ? Math.ceil(totalCostsCents / ticketPriceCents) : null

    return {
      ticket_price_cents: ticketPriceCents,
      gross_revenue_cents: grossRevenueCents,
      total_costs_cents: totalCostsCents,
      net_profit_cents: grossRevenueCents - totalCostsCents,
      break_even_tickets: rawBreakEvenTickets === null ? null : clampBreakEvenTickets(rawBreakEvenTickets, guestCount),
    }
  })
  const breakEvenProjection = projections.find((projection) => projection.net_profit_cents >= 0) ?? null
  // Honor the user's stated ticket price. If they said $35, that's the recommended
  // projection — even if it loses money. The break-even price is surfaced separately
  // in narrative so the user sees the gap explicitly instead of having their price
  // silently swapped for a higher one.
  const userStatedProjection = explicitTicketPriceCents !== null
    ? projections.find((projection) => projection.ticket_price_cents === explicitTicketPriceCents) ?? null
    : null
  const recommendedProjection =
    userStatedProjection ?? breakEvenProjection ?? projections[projections.length - 1] ?? null

  return {
    projections,
    recommended_price_cents: recommendedProjection?.ticket_price_cents ?? null,
    recommended_projection: recommendedProjection,
    break_even_projection: breakEvenProjection,
    user_stated_price_cents: explicitTicketPriceCents,
    source: 'deterministic_estimate',
    accuracy: 'estimate_until_partner_quotes_confirmed',
    requires_quote_confirmation: true,
    assumption_notes: buildProfitProjectionAssumptionNotes(
      plan,
      venueCostCents,
      vendorCostCents,
      totalCostsCents,
      ticketPriceOptions
    ),
  }
}

function buildProfitProjectionAssumptionNotes(
  plan: Plan,
  venueCostCents: number,
  vendorCostCents: number,
  totalCostsCents: number,
  ticketPriceOptions: number[]
): string[] {
  const notes = [
    'Projection is an estimate until venue/vendor quotes confirm minimums, deposits, service fees, tax, gratuity, and included services.',
  ]
  const knownCostsCents = venueCostCents + vendorCostCents

  if (!plan.budget_cap_cents) {
    notes.push('No budget cap is set, so partner affordability is based on market estimates rather than a hard ceiling.')
  } else if (plan.budget_cap_cents > knownCostsCents) {
    notes.push(`Using the ${formatCurrency(plan.budget_cap_cents)} budget cap as projected spend until partner quotes are confirmed.`)
  }
  if (venueCostCents === 0) {
    notes.push('Venue cost is unknown and must be confirmed before deposit authorization.')
  }
  if (vendorCostCents === 0) {
    notes.push('Vendor cost is unknown or no vendors were selected yet.')
  }
  if (plan.ticketed === false) {
    notes.push('RSVP/free events show cost exposure rather than ticket-profit upside unless sponsorship or bar terms are added.')
  }
  const profitGoalCents = plan.profit_goal_cents
  const ticketPriceForCeiling = readPlanTicketPriceTargetCents(plan) ?? ticketPriceOptions[ticketPriceOptions.length - 1] ?? 0
  if (profitGoalCents !== null && profitGoalCents > 0 && ticketPriceForCeiling > 0 && (plan.guest_count ?? 0) > 0) {
    const revenueCeilingCents = (plan.guest_count ?? 0) * ticketPriceForCeiling
    const maxPossibleProfitCents = revenueCeilingCents - totalCostsCents
    if (profitGoalCents > maxPossibleProfitCents) {
      notes.push(
        `Profit goal ${formatCurrency(profitGoalCents)} exceeds the maximum possible ${formatCurrency(maxPossibleProfitCents)} at ${plan.guest_count} guests and ${formatCurrency(ticketPriceForCeiling)} tickets with current projected costs.`
      )
    }
  }

  return notes
}

function buildTicketPriceSweepCents(
  archetype: EventArchetypeConfig,
  elasticity: ElasticitySignal | null
): number[] {
  const archetypeRange = archetype.typical_ticket_price_range_cents
  const archetypeSweep = archetypeRange
    ? normalizeTicketPriceSweep([
        archetypeRange[0],
        Math.round((archetypeRange[0] + archetypeRange[1]) / 2),
        archetypeRange[1],
      ])
    : [25, 50, 75, 100].map((amount) => amount * 100)

  if (!elasticity || elasticity.confidence === 'low') return archetypeSweep

  const floor = elasticity.recommended_price_floor_cents
  const ceiling = elasticity.recommended_price_ceiling_cents
  if (floor === null || ceiling === null || ceiling < floor) return archetypeSweep

  if (elasticity.confidence === 'high') {
    const span = ceiling - floor
    return normalizeTicketPriceSweep([
      floor,
      floor + Math.round(span * 0.25),
      ceiling - Math.round(span * 0.1),
      ceiling,
    ])
  }

  if (elasticity.confidence === 'medium') {
    return normalizeTicketPriceSweep([
      archetypeRange?.[0] ?? 2500,
      floor,
      ceiling,
      archetypeRange?.[1] ?? 10000,
    ])
  }

  return archetypeSweep
}

function normalizeTicketPriceSweep(values: number[]): number[] {
  return Array.from(new Set(
    values
      .map((value) => Math.max(0, Math.round(value / 100) * 100))
      .filter((value) => value > 0)
  )).sort((first, second) => first - second)
}

function pickTopVenueCandidate(
  candidates: VenueMatchingCandidate[],
  rankedVenues: VenueMatchingAgentOutput['ranked_venues']
): VenueMatchingCandidate | null {
  const topVenueId = rankedVenues[0]?.venue_id
  if (!topVenueId) return null
  return candidates.find((candidate) => candidate.id === topVenueId) ?? null
}

function buildOutreachApprovalSummary(plan: Plan, venueCount: number, vendorCount: number): string {
  const eventName = plan.title || plan.event_type || 'this event'
  return `Reach out to ${formatOutreachTargetCounts(Math.min(venueCount, 3), Math.min(vendorCount, 3))} for ${eventName}.`
}

function buildOutreachApprovalLabel(venueCount: number, vendorCount: number): string {
  return `Approve outreach to ${formatOutreachTargetCounts(venueCount, vendorCount)}`
}

function buildOutreachApprovalPackageDetails(venueCount: number, vendorCount: number): string {
  return [
    `Reach out to ${formatOutreachTargetCounts(venueCount, vendorCount)}.`,
    'No partner is contacted and no date is held until you approve.',
    'If plan details change before execution, approval must be refreshed.',
  ].join(' ')
}

function buildOutreachRequirements(
  plan: Plan,
  archetype: EventArchetypeConfig,
  archetypeIntake: ArchetypeIntakeOutcomeContext
): Record<string, unknown> {
  return {
    archetype_key: archetype.key,
    archetype_display_name: archetype.display_name,
    archetype_intake: archetypeIntake,
    guest_count: plan.guest_count,
    budget_cap_cents: plan.budget_cap_cents,
    neighborhood: plan.neighborhood,
    date_window_start: plan.date_window_start,
    date_window_end: plan.date_window_end,
    ticketed: plan.ticketed,
    ticketing_model: plan.ticketing_model,
    food_responsibility: plan.food_responsibility,
  }
}

function formatOutreachTargetCounts(venueCount: number, vendorCount: number): string {
  const parts = []
  if (venueCount > 0) parts.push(`${venueCount} venue${venueCount === 1 ? '' : 's'}`)
  if (vendorCount > 0) parts.push(`${vendorCount} vendor${vendorCount === 1 ? '' : 's'}`)
  if (parts.length === 0) return 'selected partners'
  if (parts.length === 1) return parts[0] ?? 'selected partners'
  return `${parts[0]}, ${parts[1]}`
}

function uniqueUuidList(values: string[]): string[] {
  return Array.from(new Set(values.filter(isUuid)))
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function firstRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const [first] = value
    return readRecord(first)
  }

  return readRecord(value)
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

function readPlanTicketPriceTargetCents(plan: Plan): number | null {
  const metadata = readRecord(plan.metadata)
  const cents = readNumber(metadata?.ticket_price_target_cents)
  if (cents !== null && cents > 0) return Math.round(cents)

  const value = readNumber(metadata?.ticket_price_target)
  if (value !== null && value > 0) return Math.round(value < 1000 ? value * 100 : value)

  return null
}

/**
 * Archetypes that typically charge admission and therefore need a ticket price
 * before economics can run meaningfully.
 */
const ADMISSION_CHARGING_ARCHETYPES = new Set<string>([
  'networking_mixer',
  'founder_operator_dinner',
  'brand_product_launch',
  'panel_fireside',
  'demo_day_pitch_night',
  'day_party_brunch_party',
  'nightlife_club_night',
  'listening_party_showcase',
  'fundraiser_gala',
  'watch_party_screening',
  'hackathon',
])

/**
 * Returns a placeholder message when economics should be skipped because
 * ticketing intent or ticket price is not confirmed.
 * Returns null when economics should run normally.
 */
function buildEconomicsPlaceholder(
  plan: Plan,
  archetype: EventArchetypeConfig,
  knownTicketPriceCents: number | null
): string | null {
  // If ticket price is already known, economics can run.
  if (knownTicketPriceCents !== null && knownTicketPriceCents > 0) return null
  // Explicit free/sponsored/invite-only model: economics can run (no ticket revenue to model).
  if (hasExplicitNoTicketRevenueModel(plan)) return null

  const ticketingModel = normalizeText(plan.ticketing_model)

  // ticketed === false with no ticketing model: need to confirm the monetisation model first.
  if (!ticketingModel && plan.ticketed === false) {
    return 'Confirm whether this event is free, ticketed, sponsored, invite-only, or tied to a ticketing platform before I model unit economics.'
  }

  // Ticket price is unknown (null/zero). Gate economics until a price is provided.
  // This covers: ticketed = true, paid ticketing models, admission-charging archetypes,
  // AND the ambiguous case where ticketing_model is blank and ticketed is not explicitly false.
  if (
    plan.ticketed === true ||
    hasPaidTicketingModel(plan) ||
    ADMISSION_CHARGING_ARCHETYPES.has(archetype.key) ||
    (!ticketingModel && plan.ticketed !== false)
  ) {
    return 'Unit economics pending — add a ticket price to model your profit window.'
  }

  return null
}

/**
 * Returns a one-time prompt to connect a ticketing platform if the builder
 * has no platform connected and ticketing data would improve the projection.
 *
 * Only surfaces once per plan — detected by checking existing messages for
 * a prior `ticketing_platform_prompt` message.
 */
function buildTicketingPlatformPrompt(
  plan: Plan,
  archetype: EventArchetypeConfig,
  connectedPlatforms: string[],
  messages: PlanMessage[]
): string | null {
  // No prompt needed if already connected.
  if (connectedPlatforms.length > 0) return null
  // Only surface once — check if the prompt has already been shown.
  const alreadyShown = messages.some((message) => {
    const metadata = readRecord(message.metadata)
    const response = readRecord(metadata?.recommendation_response)
    return metadata?.kind === 'ticketing_platform_prompt' ||
      Boolean(readString(metadata?.ticketing_platform_prompt)) ||
      Boolean(readString(response?.ticketing_platform_prompt))
  })
  if (alreadyShown) return null

  const shouldPrompt =
    plan.ticketed === true ||
    hasPaidTicketingModel(plan) ||
    hasRsvpTicketingModel(plan) ||
    (!normalizeText(plan.ticketing_model) && plan.ticketed === false) ||
    ADMISSION_CHARGING_ARCHETYPES.has(archetype.key)
  if (!shouldPrompt || hasExplicitNoTicketRevenueModel(plan)) return null

  return (
    'If you use Luma, Partiful, Posh, or Eventbrite, connect it in Settings → Ticketing so I can use real RSVP, sales, fee, and check-in history. ' +
    'If this one is free, sponsored, or invite-only, tell me that and I will model costs without ticket revenue.'
  )
}

function hasPaidTicketingModel(plan: Plan): boolean {
  const normalized = normalizeText(plan.ticketing_model)
  return normalized.includes('ticket') ||
    normalized.includes('paid') ||
    normalized.includes('cover') ||
    normalized.includes('admission') ||
    normalized.includes('posh') ||
    normalized.includes('eventbrite')
}

function hasRsvpTicketingModel(plan: Plan): boolean {
  const normalized = normalizeText(plan.ticketing_model)
  return normalized.includes('rsvp') ||
    normalized.includes('luma') ||
    normalized.includes('partiful')
}

function hasExplicitNoTicketRevenueModel(plan: Plan): boolean {
  const normalized = normalizeText(plan.ticketing_model)
  return normalized.includes('sponsor') ||
    normalized.includes('invite') ||
    normalized.includes('comp') ||
    normalized.includes('free') ||
    normalized.includes('no ticket') ||
    normalized.includes('not ticket')
}

function clampBreakEvenTickets(rawBreakEvenTickets: number, guestCount: number): number {
  if (guestCount <= 0) return 0
  return Math.min(Math.max(rawBreakEvenTickets, 1), guestCount)
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

function venueMatchesNeighborhood(row: Record<string, unknown>, neighborhood: string | null): boolean {
  const normalizedNeighborhood = normalizeText(neighborhood)
  if (!normalizedNeighborhood || isCityLevelArea(normalizedNeighborhood)) return true

  const searchText = normalizeText([
    row.venue_name,
    row.address,
    row.description,
    row.city,
    row.unique_features,
    Array.isArray(row.unique_features_tags) ? row.unique_features_tags.join(' ') : row.unique_features_tags,
  ].map((value) => (typeof value === 'string' ? value : '')).join(' '))

  if (!searchText) return false
  return getNeighborhoodAliases(normalizedNeighborhood).some((alias) => searchText.includes(alias))
}

function venueFitsBudget(candidate: VenueMatchingCandidate, budgetCents: number | null): boolean {
  if (budgetCents === null || budgetCents <= 0) return true
  const estimatedCost = estimateMinimumVenueCostCents(candidate)
  if (estimatedCost === null) return true
  return estimatedCost <= budgetCents
}

function isCityLevelArea(normalizedValue: string): boolean {
  return normalizedValue === 'sf' || normalizedValue === 'san francisco'
}

function getNeighborhoodAliases(normalizedNeighborhood: string): string[] {
  if (normalizedNeighborhood === 'mission district') return ['mission', 'mission district']
  if (normalizedNeighborhood === 'south of market') return ['soma', 'south of market']
  if (normalizedNeighborhood === 'fidi') return ['fidi', 'financial district']
  if (normalizedNeighborhood === 'pac heights') return ['pac heights', 'pacific heights']
  return [normalizedNeighborhood]
}

function formatNeighborhoodPhrase(value: string | null): string {
  const normalized = normalizeText(value)
  if (!normalized) return 'that exact neighborhood'
  if (normalized === 'mission' || normalized === 'mission district') return 'the Mission'
  return value ?? 'that exact neighborhood'
}

function formatList(items: string[]): string {
  const labels = items.map((item) => item.replace(/_/g, ' '))
  if (labels.length <= 1) return labels[0] ?? ''
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
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

function isCapacityCalibrationSignal(
  value: string | null
): value is CapacityCalibrationSummary['calibration_signal'] {
  return value === 'no_history' ||
    value === 'stated' ||
    value === 'historical_higher' ||
    value === 'historical_aligned'
}

function isCapacityScoreCalibrationSignal(
  value: string | null
): value is 'stated' | 'historical_higher' | 'historical_aligned' {
  return value === 'stated' || value === 'historical_higher' || value === 'historical_aligned'
}

function isAttendanceConfidence(value: unknown): value is BuilderAttendanceSummary['confidence'] {
  return value === 'low' || value === 'medium' || value === 'high'
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

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
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
