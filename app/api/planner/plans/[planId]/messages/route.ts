/**
 * API route for Agent Planner conversation messages on a single plan.
 *
 * Purpose:
 * - POST stores a user reply, updates plan fields from deterministic intent parsing,
 *   and stores the next deterministic agent response.
 * - GET returns the ordered conversation thread for the authenticated builder.
 *
 * Route inputs:
 * - Path param: `planId`.
 * - POST body: `{ message: string }`.
 *
 * Key behaviors:
 * - Clarifies missing fields in this fixed order: date, headcount, budget,
 *   neighborhood, ticketing.
 * - Emits a recommendation message once required fields are present.
 * - Logs every mutating exchange to `audit_logs`.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { IntakeAgentOutput } from '@/lib/ai/agents/intakeAgent'
import { buildEventPlanFromPlannerPlan } from '@/lib/planner/agentPlanAdapter'
import { determineNextResponse } from '@/lib/planner/agentResponder'
import {
  ARCHETYPE_LOCK_METADATA_KEY,
  PENDING_PLAN_CHANGE_METADATA_KEY,
  buildMutationContract,
  buildArchetypeAnswerText,
  buildArchetypeQuestionPriority,
  createEventArchetypeLock,
  decideEventTypeMutation,
  findAnsweredArchetypeQuestionForPrompt,
  getArchetypeByKey,
  getNextArchetypeIntakeQuestion,
  hasEventRequirementSignals,
  isExplicitReclassificationRequest,
  mergeAnsweredArchetypeQuestionMetadata,
  mergeEventRequirementSignals,
  resolveArchetypeContext,
  resolveArchetypeIntakeContext,
} from '@/lib/planner/archetypes'
import type { EventArchetypeConfig } from '@/lib/planner/archetypes'
import { createAutoRecommendationMessage } from '@/lib/planner/autoRecommendations'
import { hasUnknownBudgetSignal, parseEventIntent } from '@/lib/planner/intentParser'
import {
  isIntakeReadyForRecommendations,
  isPlanReadyForRequestedRecommendations,
  isRecommendationRequest,
} from '@/lib/planner/intakeReadiness'
import { createVenueOpportunityBundle } from '@/lib/planner/opportunityBuilder'
import { getBuilderConnectedTicketingPlatforms } from '@/lib/server/account-setup'
import {
  getBuilderProfileIdForUser,
  summarizeBuilderAttendance,
  type BuilderAttendanceSummary,
} from '@/lib/server/builderAttendanceHistory'
import { checkRateLimit, rateLimitHeaders } from '@/lib/server/rate-limit'
import { createClient } from '@/lib/supabase/server'
import type { TicketPlatform } from '@/lib/constants/account-setup'
import type {
  Json,
  AgentResponseDraft,
  Plan,
  PlanIntent,
  PlanMessage,
  PlannerApiErrorResponse,
  PlannerMessagesResponse,
  PlannerPostMessageResponse,
  Recommendation,
} from '@/lib/types'

type PlannerDb = { from: (table: string) => any }
type AgentMode = 'openai' | 'deterministic'
type AuthResult =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const postMessageSchema = z.object({
  message: z.string().trim().min(1).max(4000),
})

const PLAN_SELECT_COLUMNS = `
  id,
  user_id,
  title,
  event_type,
  status,
  guest_count,
  budget_cap_cents,
  neighborhood,
  date_window_start,
  date_window_end,
  ticketed,
  ticketing_model,
  food_responsibility,
  venue_terms,
  agent_action,
  profit_goal_cents,
  notes,
  metadata,
  created_at,
  updated_at
`

const PLAN_MESSAGE_SELECT_COLUMNS = `
  id,
  plan_id,
  role,
  content,
  message_type,
  metadata,
  created_at
`

const RECOMMENDATION_SELECT_COLUMNS = `
  id,
  plan_id,
  type,
  reference_id,
  external_name,
  price_cents,
  notes,
  rank,
  is_best_fit,
  status,
  metadata,
  created_at
`

interface RouteContext {
  params: {
    planId: string
  }
}

/**
 * Returns the ordered message thread for a planner plan owned by the current user.
 *
 * @param request - Next.js request with auth cookies.
 * @param context - Route params containing `planId`.
 * @returns JSON response containing ordered plan messages.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<PlannerMessagesResponse | PlannerApiErrorResponse>> {
  try {
    const auth = await getAuthenticatedPlannerDb()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const { data, error } = await auth.db
      .from('plan_messages')
      .select(PLAN_MESSAGE_SELECT_COLUMNS)
      .eq('plan_id', context.params.planId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Planner messages list error:', error)
      return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
    }

    return NextResponse.json({ messages: (data ?? []) as PlanMessage[] })
  } catch (error) {
    console.error('Planner messages GET error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

/**
 * Adds a user message to a plan and inserts the next deterministic agent reply.
 *
 * The latest user message is parsed for field updates before the state machine runs.
 * When all required fields are present, the response type becomes `recommendation`
 * and the plan status advances to `ready`.
 *
 * @param request - Next.js request with `{ message }` body and auth cookies.
 * @param context - Route params containing `planId`.
 * @returns JSON response containing the updated plan plus the two new messages.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<PlannerPostMessageResponse | PlannerApiErrorResponse>> {
  try {
    const auth = await getAuthenticatedPlannerDb()
    if ('response' in auth) return auth.response

    const rateLimit = checkRateLimit(`planner:messages:${auth.userId}`)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many planner messages. Try again shortly.' },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      )
    }

    const body = postMessageSchema.safeParse(await request.json())
    if (!body.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: body.error.flatten() as Json },
        { status: 400 }
      )
    }

    const existingPlan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!existingPlan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const pendingResolution = buildPendingPlanChangeResolution(existingPlan, body.data.message)
    const intent = pendingResolution ? { confidence: {} } : parseEventIntent(body.data.message)
    const fieldUpdates = pendingResolution ?? guardHighImpactPlanUpdates(
      existingPlan,
      body.data.message,
      buildPlanUpdates(intent, existingPlan, body.data.message)
    )
    const planAfterFieldUpdates = await updatePlanIfNeeded(
      auth.db,
      context.params.planId,
      existingPlan,
      fieldUpdates
    )

    const { data: userMessageData, error: userMessageError } = await auth.db
      .from('plan_messages')
      .insert({
        plan_id: context.params.planId,
        role: 'user',
        content: body.data.message,
        message_type: 'text',
        metadata: toJson({ intent }),
      })
      .select(PLAN_MESSAGE_SELECT_COLUMNS)
      .single()

    if (userMessageError || !userMessageData) {
      console.error('Planner user message insert error:', userMessageError)
      return NextResponse.json({ error: 'Failed to insert user message' }, { status: 500 })
    }

    const userMessage = userMessageData as PlanMessage
    const messages = await loadMessages(auth.db, context.params.planId)
    const pendingChange = readPendingPlanChange(readRecord(planAfterFieldUpdates.metadata))
    const agentResponse = pendingChange
      ? {
          agentDraft: buildPendingChangeConfirmationDraft(pendingChange),
          plan: planAfterFieldUpdates,
          agentMode: 'deterministic' as AgentMode,
        }
      : await buildPlannerAgentResponse({
          db: auth.db,
          planId: context.params.planId,
          userId: auth.userId,
          userMessage: body.data.message,
          plan: planAfterFieldUpdates,
          messages,
        })
    const shouldForceRecommendation = !pendingChange && shouldForceRequestedRecommendations({
      message: body.data.message,
      plan: agentResponse.plan,
      messages,
    })
    const agentDraft = shouldForceRecommendation
      ? buildRequestedRecommendationDraft(agentResponse.agentDraft, agentResponse.plan)
      : agentResponse.agentDraft
    const finalPlan = await maybeMarkPlanReady(
      auth.db,
      context.params.planId,
      agentResponse.plan,
      agentDraft.message_type
    )

    const { data: agentMessageData, error: agentMessageError } = await auth.db
      .from('plan_messages')
      .insert({
        plan_id: context.params.planId,
        role: 'agent',
        content: agentDraft.content,
        message_type: agentDraft.message_type,
        metadata: agentDraft.metadata,
      })
      .select(PLAN_MESSAGE_SELECT_COLUMNS)
      .single()

    if (agentMessageError || !agentMessageData) {
      console.error('Planner agent message insert error:', agentMessageError)
      return NextResponse.json({ error: 'Failed to insert agent response' }, { status: 500 })
    }

    const agentMessage = agentMessageData as PlanMessage
    const followUpMessages: PlanMessage[] = []
    const didMarkPlanReady = agentResponse.plan.status !== finalPlan.status && finalPlan.status === 'ready'
    const recommendationRefreshMessages = didMatchAffectingFieldsChange(existingPlan, finalPlan)
      ? await refreshRecommendationsAfterPlanChange({
          db: auth.db,
          request,
          plan: finalPlan,
          changedFields: findMatchAffectingChangedFields(existingPlan, finalPlan),
        })
      : []

    if (recommendationRefreshMessages.length > 0) {
      followUpMessages.push(...recommendationRefreshMessages)
    } else if (agentMessage.message_type === 'recommendation') {
      const shouldCreateAutoRecommendations =
        (agentResponse.agentMode === 'openai' && didMarkPlanReady) || shouldForceRecommendation

      if (shouldCreateAutoRecommendations) {
        const recommendationMessages = await createAutoRecommendationMessage({
          db: auth.db,
          request,
          planId: context.params.planId,
        })
        followUpMessages.push(...recommendationMessages)
      }

      if (!shouldCreateAutoRecommendations) {
        const opportunityBundle = await createVenueOpportunityBundle({
          db: auth.db,
          plan: finalPlan,
          messages: [...messages, agentMessage, ...followUpMessages],
          userId: auth.userId,
        })

        if (opportunityBundle) {
          followUpMessages.push(opportunityBundle.approvalMessage)
        }
      }
    }

    await recordEventTypeCandidate(auth.db, {
      userId: auth.userId,
      planId: context.params.planId,
      intent,
    })
    await insertAuditLog(auth.db, {
      user_id: auth.userId,
      plan_id: context.params.planId,
      action: 'planner.message.exchange',
      entity_type: 'plan_message',
      entity_id: userMessage.id,
      before_state: toJson({ plan: existingPlan }),
      after_state: toJson({
        plan: finalPlan,
        intent,
        agent_mode: agentResponse.agentMode,
        user_message_id: userMessage.id,
        agent_message_id: agentMessage.id,
        follow_up_message_ids: followUpMessages.map((message) => message.id),
      }),
      ip_address: getIpAddress(request),
    })

    return NextResponse.json({
      plan: finalPlan,
      user_message: userMessage,
      agent_message: agentMessage,
      follow_up_messages: followUpMessages.length > 0 ? followUpMessages : undefined,
    })
  } catch (error) {
    console.error('Planner messages POST error:', error)
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

async function loadMessages(db: PlannerDb, planId: string): Promise<PlanMessage[]> {
  const { data, error } = await db
    .from('plan_messages')
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Planner load messages error:', error)
    return []
  }

  return (data ?? []) as PlanMessage[]
}

async function refreshRecommendationsAfterPlanChange(input: {
  db: PlannerDb
  request: NextRequest
  plan: Plan
  changedFields: string[]
}): Promise<PlanMessage[]> {
  const recommendations = await loadActiveRecommendations(input.db, input.plan.id)
  if (recommendations.length === 0 || input.plan.status !== 'ready') return []

  const supersededAt = new Date().toISOString()
  await Promise.all(recommendations.map((recommendation) => supersedeRecommendation(input.db, recommendation, supersededAt, input.changedFields)))
  await invalidatePendingOutreachApprovals(input.db, input.plan.id, supersededAt, input.changedFields)

  const statusMessage = await insertRecommendationRefreshStatusMessage(input.db, input.plan.id, input.changedFields)
  const recommendationMessages = await createAutoRecommendationMessage({
    db: input.db,
    request: input.request,
    planId: input.plan.id,
  })

  return [statusMessage, ...recommendationMessages].filter((message): message is PlanMessage => message !== null)
}

async function loadActiveRecommendations(db: PlannerDb, planId: string): Promise<Recommendation[]> {
  const { data, error } = await db
    .from('recommendations')
    .select(RECOMMENDATION_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .in('status', ['pending', 'selected'])

  if (error) {
    console.error('Planner active recommendation lookup error:', error)
    return []
  }

  return (data ?? []) as Recommendation[]
}

async function supersedeRecommendation(
  db: PlannerDb,
  recommendation: Recommendation,
  supersededAt: string,
  changedFields: string[]
) {
  const metadata = readRecord(recommendation.metadata) ?? {}
  const { error } = await db
    .from('recommendations')
    .update({
      status: 'rejected',
      metadata: {
        ...metadata,
        superseded_at: supersededAt,
        superseded_reason: 'match_affecting_plan_change',
        superseded_changed_fields: changedFields,
      } as Json,
    })
    .eq('id', recommendation.id)

  if (error) console.error('Planner recommendation supersede error:', error)
}

async function invalidatePendingOutreachApprovals(
  db: PlannerDb,
  planId: string,
  supersededAt: string,
  changedFields: string[]
) {
  const { data, error } = await db
    .from('agent_actions')
    .select('id, action_type, status, payload_json')
    .eq('plan_id', planId)
    .in('action_type', ['opportunity_send_venues', 'opportunity_send_vendors', 'email'])

  if (error) {
    console.error('Planner outreach approval action invalidation lookup error:', error)
    return
  }

  const actionIds = ((data ?? []) as Array<Record<string, unknown>>)
    .filter((action) => action.status !== 'complete')
    .filter((action) => readRecord(action.payload_json)?.kind === 'venue_outreach')
    .map((action) => readString(action.id))
    .filter((id): id is string => Boolean(id))
  if (actionIds.length === 0) return

  const { error: approvalError } = await db
    .from('approvals')
    .update({ status: 're_approval_required' })
    .in('agent_action_id', actionIds)
    .in('status', ['pending', 'approved', 'authorized'])

  if (approvalError) console.error('Planner outreach approval invalidation error:', approvalError)

  await markOutreachApprovalMessagesReapprovalRequired(db, planId, supersededAt, changedFields)
}

async function markOutreachApprovalMessagesReapprovalRequired(
  db: PlannerDb,
  planId: string,
  supersededAt: string,
  changedFields: string[]
) {
  const { data, error } = await db
    .from('plan_messages')
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .eq('message_type', 'approval_request')

  if (error) {
    console.error('Planner outreach approval message invalidation lookup error:', error)
    return
  }

  await Promise.all(((data ?? []) as PlanMessage[]).map(async (message) => {
    const metadata = readRecord(message.metadata)
    if (metadata?.kind !== 'venue_outreach') return
    const approval = readRecord(metadata.approval)
    const nextMetadata = {
      ...metadata,
      status: 're_approval_required',
      superseded_at: supersededAt,
      superseded_changed_fields: changedFields,
      approval: approval
        ? {
            ...approval,
            status: 're_approval_required',
          }
        : approval,
    } as Json

    const { error: updateError } = await db
      .from('plan_messages')
      .update({ metadata: nextMetadata })
      .eq('id', message.id)

    if (updateError) console.error('Planner outreach approval message invalidation error:', updateError)
  }))
}

async function insertRecommendationRefreshStatusMessage(
  db: PlannerDb,
  planId: string,
  changedFields: string[]
): Promise<PlanMessage | null> {
  const { data, error } = await db
    .from('plan_messages')
    .insert({
      plan_id: planId,
      role: 'agent',
      content: 'Updated the plan — re-checking venues against the new numbers.',
      message_type: 'status_update',
      metadata: {
        reason: 'recommendations_superseded',
        changed_fields: changedFields,
      } as Json,
    })
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    console.error('Planner recommendation refresh status message insert error:', error)
    return null
  }

  return data as PlanMessage
}

function didMatchAffectingFieldsChange(before: Plan, after: Plan): boolean {
  const beforeSnapshot = buildMatchAffectingSnapshot(before)
  const afterSnapshot = buildMatchAffectingSnapshot(after)
  return Object.keys(beforeSnapshot).some((key) => beforeSnapshot[key] !== afterSnapshot[key])
}

function findMatchAffectingChangedFields(before: Plan, after: Plan): string[] {
  const beforeSnapshot = buildMatchAffectingSnapshot(before)
  const afterSnapshot = buildMatchAffectingSnapshot(after)
  return Object.keys(beforeSnapshot).filter((key) => beforeSnapshot[key] !== afterSnapshot[key])
}

function buildMatchAffectingSnapshot(plan: Plan): Record<string, unknown> {
  const metadata = readRecord(plan.metadata)
  return {
    neighborhood: plan.neighborhood,
    guest_count: plan.guest_count,
    budget_cap_cents: plan.budget_cap_cents,
    ticketed: plan.ticketed,
    ticket_price_target: readNumber(metadata?.ticket_price_target_cents) ?? readNumber(metadata?.ticket_price_target),
    date_window_start: plan.date_window_start,
    date_window_end: plan.date_window_end,
  }
}

async function buildPlannerAgentResponse(input: {
  db: PlannerDb
  planId: string
  userId: string
  userMessage: string
  plan: Plan
  messages: PlanMessage[]
}): Promise<{ agentDraft: AgentResponseDraft; plan: Plan; agentMode: AgentMode }> {
  const deterministicDraft = () => ({
    agentDraft: determineNextResponse(input.plan, input.messages),
    plan: input.plan,
    agentMode: 'deterministic' as AgentMode,
  })

  if (!process.env.OPENAI_API_KEY) {
    console.warn('[planner.intake] Falling back to deterministic response: OPENAI_API_KEY is not set')
    return deterministicDraft()
  }

  try {
    const { runAgent } = await import('@/lib/ai/agents')
    const connectedPlatforms = await getBuilderConnectedTicketingPlatforms(input.db, input.userId)
    const resolvedArchetype = resolveArchetypeIntakeContext(`${input.userMessage} ${input.plan.event_type ?? ''}`)
    const resolvedArchetypeConfig = resolvedArchetype ? getArchetypeByKey(resolvedArchetype.key) : null
    const conversationText = buildArchetypeAnswerText(input.messages, [input.userMessage])
    const canMatchNow = computeCanMatchNow(input.plan, conversationText, resolvedArchetypeConfig)
    const builderHistory = await loadBuilderHistoryForIntake(input.db, input.userId, resolvedArchetype?.key ?? null)
    const agentResult = await runAgent({
      agent_name: 'intake',
      event_id: null,
      user_id: input.userId,
      payload: {
        messages: input.messages.map((message) => ({ role: message.role, content: message.content })),
        user_message: input.userMessage,
        current_plan: input.plan,
        existing_event_plan: buildEventPlanFromPlannerPlan(input.plan),
        connected_platforms: connectedPlatforms,
        can_match_now: canMatchNow,
        resolved_archetype: resolvedArchetype,
        archetype_resolution: resolvedArchetype,
        archetype_question_priority: resolvedArchetypeConfig
          ? buildArchetypeQuestionPriority({
              archetype: resolvedArchetypeConfig,
              plan: input.plan,
              conversationText,
            })
          : null,
        builder_history: builderHistory ? toIntakeBuilderHistory(builderHistory) : null,
        mutation_contract: buildMutationContract(input.plan.metadata, input.plan.event_type),
      },
    })

    if ((agentResult.status as string) !== 'succeeded') {
      console.warn('[planner.intake] Falling back to deterministic response: intake agent did not succeed')
      return deterministicDraft()
    }

    const intakeOutput = agentResult.output as IntakeAgentOutput
    const agentPlanUpdates = guardHighImpactPlanUpdates(
      input.plan,
      input.userMessage,
      buildPlanUpdatesFromIntakeOutput(intakeOutput, input.plan, input.userMessage)
    )
    const planWithAgentUpdates = await updatePlanIfNeeded(
      input.db,
      input.planId,
      input.plan,
      agentPlanUpdates
    )
    const pendingChange = readPendingPlanChange(readRecord(planWithAgentUpdates.metadata))

    return {
      agentDraft: pendingChange
        ? buildPendingChangeConfirmationDraft(pendingChange)
        : buildIntakeAgentDraft(intakeOutput, planWithAgentUpdates, input.messages),
      plan: planWithAgentUpdates,
      agentMode: 'openai',
    }
  } catch (error) {
    console.warn('[planner.intake] Falling back to deterministic response:', error)
    return deterministicDraft()
  }
}

async function loadBuilderHistoryForIntake(
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

function toIntakeBuilderHistory(summary: BuilderAttendanceSummary) {
  return {
    sample_size: summary.sample_size,
    avg: summary.avg_tickets_sold,
    p75: summary.p75_tickets_sold,
    confidence: summary.confidence,
    last_event_at: summary.last_event_at,
  }
}

async function updatePlanIfNeeded(
  db: PlannerDb,
  planId: string,
  currentPlan: Plan,
  updates: Record<string, unknown>
): Promise<Plan> {
  const changedUpdates = Object.fromEntries(
    Object.entries(updates).filter(([field, value]) => currentPlan[field as keyof Plan] !== value)
  )
  if (Object.keys(changedUpdates).length === 0) return currentPlan

  const { data, error } = await db
    .from('plans')
    .update(changedUpdates)
    .eq('id', planId)
    .select(PLAN_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    console.error('Planner plan field update error:', error)
    return currentPlan
  }

  await insertPlanUpdateRows(db, currentPlan, changedUpdates)

  return data as Plan
}

function buildIntakeAgentDraft(
  output: IntakeAgentOutput,
  plan: Plan,
  messages: PlanMessage[]
): AgentResponseDraft {
  const missingQuestions = output.missing_questions
    .map((question) => question.trim())
    .filter((question) => question.length > 0)
  const nextBestQuestion = output.next_best_question?.trim() || null
  const reflection = normalizeAcknowledgementTone(output.reflection.trim(), plan.event_type ?? output.extracted_fields.event_type ?? output.updated_event_plan.event_name)
  const conversationText = buildArchetypeAnswerText(messages)
  const coreFieldsReady = hasIntakeCoreFields(output, plan)
  const archetypeQuestion = coreFieldsReady
    ? getNextArchetypeIntakeQuestion({
        eventType: buildArchetypeSearchText(output, plan),
        plan,
        conversationText,
        includeRecommended: true,
      })
    : null
  const isReady = isIntakeReadyForRecommendations(output, plan, { conversationText }) && !archetypeQuestion
  const agentQuestion = pickUnansweredAgentQuestion(output, plan, conversationText, [
    nextBestQuestion,
    ...missingQuestions,
  ])
  const question = archetypeQuestion?.prompt ?? agentQuestion ?? buildMissingCoreQuestion(output, plan)
  const agentReturnedNoQuestion = !nextBestQuestion && missingQuestions.length === 0
  const canMatchNow = isPlanReadyForRequestedRecommendations(plan, { conversationText })
  const fallbackToGuard = !isReady && !question && agentReturnedNoQuestion && canMatchNow
  const shouldTransitionToMatch = isReady || fallbackToGuard

  if (fallbackToGuard) {
    console.warn('[planner.intake] Forward-momentum guard promoted no-question intake response to recommendations', {
      plan_id: plan.id,
      event_type: plan.event_type,
      neighborhood: plan.neighborhood,
      guest_count: plan.guest_count,
      date_window_start: plan.date_window_start,
      date_window_end: plan.date_window_end,
    })
  }

  const transitionPhrase = buildTransitionPhrase(plan)
  const content = shouldTransitionToMatch
    ? `${reflection} ${transitionPhrase}`
    : question
      ? `${reflection} ${question}`
      : reflection

  return {
    content,
    message_type: shouldTransitionToMatch ? 'recommendation' : 'text',
    metadata: toJson({
      agent_name: 'intake',
      agent_output: output,
      archetype_question: archetypeQuestion,
      can_match_now: canMatchNow,
      forward_momentum_guard: fallbackToGuard,
      transition_to_match: shouldTransitionToMatch,
    }),
  }
}

function buildTransitionPhrase(plan: Plan): string {
  const area = plan.neighborhood?.trim() || 'your target area'
  const eventType = plan.event_type?.trim().toLowerCase() || 'event'
  const guestText = typeof plan.guest_count === 'number' && plan.guest_count > 0
    ? ` for ${plan.guest_count.toLocaleString()} guests`
    : ''
  return `I have enough to start matching ${area} options${guestText} for this ${eventType}. Pulling venue and vendor recommendations now.`
}

function computeCanMatchNow(
  plan: Plan,
  conversationText: string,
  archetype: EventArchetypeConfig | null
): boolean {
  if (!isPlanReadyForRequestedRecommendations(plan, { conversationText })) return false
  if (!archetype) return true

  const priority = buildArchetypeQuestionPriority({ archetype, plan, conversationText })
  if (priority.critical_missing.length > 0) return false
  if (archetype.matching_fields.high_signal.length === 0) return true

  return priority.high_signal_missing.length < archetype.matching_fields.high_signal.length
}

function shouldForceRequestedRecommendations(input: {
  message: string
  plan: Plan
  messages: PlanMessage[]
}): boolean {
  if (!isRecommendationRequest(input.message)) return false

  return isPlanReadyForRequestedRecommendations(input.plan, {
    conversationText: buildArchetypeAnswerText(input.messages),
  })
}

function buildRequestedRecommendationDraft(draft: AgentResponseDraft, plan: Plan): AgentResponseDraft {
  const eventType = plan.event_type?.toLowerCase() ?? 'event'
  const area = plan.neighborhood ?? 'your target area'
  const guestText = plan.guest_count ? ` for ${plan.guest_count.toLocaleString()} guests` : ''

  return {
    ...draft,
    content: `I have enough to start matching ${area} options${guestText} for this ${eventType}. I’ll pull venue and vendor recommendations now.`,
    message_type: 'recommendation',
    metadata: toJson({
      ...(readRecord(draft.metadata) ?? {}),
      source: 'user_requested_recommendations',
      recommendation_request: true,
    }),
  }
}

function hasIntakeCoreFields(output: IntakeAgentOutput, plan: Plan): boolean {
  const eventPlan = output.updated_event_plan
  const extracted = output.extracted_fields
  const eventType = plan.event_type ?? extracted.event_type ?? eventPlan.venue_type ?? eventPlan.event_name
  const headcount =
    plan.guest_count ??
    extracted.guest_count ??
    eventPlan.expected_attendance ??
    eventPlan.headcount_max ??
    eventPlan.headcount_min
  const area = plan.neighborhood ?? extracted.neighborhood ?? output.neighborhood ?? eventPlan.city
  const date =
    plan.date_window_start ??
    plan.date_window_end ??
    extracted.date_window_start ??
    extracted.date_window_end ??
    eventPlan.event_date

  return Boolean(eventType && headcount && area && date)
}

function pickUnansweredAgentQuestion(
  output: IntakeAgentOutput,
  plan: Plan,
  conversationText: string,
  candidateQuestions: Array<string | null | undefined>
): string | null {
  const eventType = buildArchetypeSearchText(output, plan)
  const seen = new Set<string>()

  for (const candidate of candidateQuestions) {
    const question = candidate?.trim()
    if (!question) continue
    const normalizedQuestion = question.toLowerCase()
    if (seen.has(normalizedQuestion)) continue
    seen.add(normalizedQuestion)

    const answeredQuestion = findAnsweredArchetypeQuestionForPrompt({
      eventType,
      plan,
      conversationText,
      prompt: question,
    })

    if (!answeredQuestion) return question
  }

  return null
}

function buildMissingCoreQuestion(output: IntakeAgentOutput, plan: Plan): string | null {
  const eventPlan = output.updated_event_plan
  const extracted = output.extracted_fields
  const eventType = plan.event_type ?? extracted.event_type ?? eventPlan.venue_type ?? eventPlan.event_name
  const headcount =
    plan.guest_count ??
    extracted.guest_count ??
    eventPlan.expected_attendance ??
    eventPlan.headcount_max ??
    eventPlan.headcount_min
  const area = plan.neighborhood ?? extracted.neighborhood ?? output.neighborhood ?? eventPlan.city
  const date =
    plan.date_window_start ??
    plan.date_window_end ??
    extracted.date_window_start ??
    extracted.date_window_end ??
    eventPlan.event_date
  if (!eventType) return 'What kind of event is this closest to: dinner, mixer, workshop, party, or something else?'
  if (!headcount) return 'How many people are you planning for?'
  if (!area) return 'What neighborhood or city should I search in?'
  if (!date) return 'What date or date window are you aiming for?'

  return null
}

function buildArchetypeSearchText(output: IntakeAgentOutput, plan: Plan): string | null {
  const value = [
    plan.event_type,
    output.extracted_fields.event_type,
    output.updated_event_plan.venue_type,
    output.updated_event_plan.event_name,
  ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join(' ')

  return value || null
}

function normalizeAcknowledgementTone(value: string, seedValue: string | null | undefined): string {
  if (!/^got it\b/i.test(value)) return value

  const leads = ['Perfect', 'Clear', "I'm tracking", 'That works', 'Locked in']
  const seed = Array.from(seedValue ?? value).reduce((total, char) => total + char.charCodeAt(0), 0)
  const lead = leads[seed % leads.length]
  return value.replace(/^got it[,.]?\s*(?:[—-]\s*)?/i, `${lead} — `)
}

function buildPlanUpdatesFromIntakeOutput(
  output: IntakeAgentOutput,
  currentPlan: Plan,
  userMessage: string
): Record<string, unknown> {
  const eventPlan = output.updated_event_plan
  const extracted = output.extracted_fields
  const updates: Record<string, unknown> = {}
  const shouldIgnoreBudget = hasUnknownBudgetSignal(userMessage)

  if (!currentPlan.title && eventPlan.event_name) updates.title = eventPlan.event_name
  const eventTypeDecision = decideEventTypeMutation({
    currentEventType: currentPlan.event_type,
    currentMetadata: currentPlan.metadata,
    proposedEventType: resolveEventTypeLabel(extracted.event_type ?? eventPlan.venue_type ?? null, userMessage),
    userMessage,
    source: 'explicit_user_reclassification',
  })
  if (eventTypeDecision.shouldApply && eventTypeDecision.eventType && currentPlan.event_type !== eventTypeDecision.eventType) {
    updates.event_type = eventTypeDecision.eventType
    updates.title = eventPlan.event_name ?? `${toTitleCase(eventTypeDecision.eventType)} plan`
  }

  const guestCount = extracted.guest_count ?? eventPlan.expected_attendance ?? eventPlan.headcount_max ?? eventPlan.headcount_min
  if (typeof guestCount === 'number' && guestCount > 0 && currentPlan.guest_count !== guestCount) {
    updates.guest_count = guestCount
  }

  if (!shouldIgnoreBudget && typeof extracted.budget_cap_cents === 'number' && currentPlan.budget_cap_cents !== extracted.budget_cap_cents) {
    updates.budget_cap_cents = extracted.budget_cap_cents
  } else if (!shouldIgnoreBudget && typeof eventPlan.budget === 'number') {
    const budgetCents = normalizePlanningMoneyToCents(eventPlan.budget)
    if (budgetCents > 0 && currentPlan.budget_cap_cents !== budgetCents) updates.budget_cap_cents = budgetCents
  }
  if (typeof extracted.profit_goal_cents === 'number' && currentPlan.profit_goal_cents !== extracted.profit_goal_cents) {
    updates.profit_goal_cents = extracted.profit_goal_cents
  } else if (typeof eventPlan.profit_goal === 'number') {
    const profitGoalCents = normalizePlanningMoneyToCents(eventPlan.profit_goal)
    if (profitGoalCents > 0 && currentPlan.profit_goal_cents !== profitGoalCents) updates.profit_goal_cents = profitGoalCents
  }

  const neighborhood = extracted.neighborhood ?? output.neighborhood ?? eventPlan.city
  if (neighborhood && currentPlan.neighborhood !== neighborhood) updates.neighborhood = neighborhood

  if (extracted.date_window_start || extracted.date_window_end) {
    const start = extracted.date_window_start ?? extracted.date_window_end
    const end = extracted.date_window_end ?? extracted.date_window_start
    if (currentPlan.date_window_start !== start) updates.date_window_start = start
    if (currentPlan.date_window_end !== end) updates.date_window_end = end
  } else if (eventPlan.event_date) {
    if (currentPlan.date_window_start !== eventPlan.event_date) updates.date_window_start = eventPlan.event_date
    if (currentPlan.date_window_end !== eventPlan.event_date) updates.date_window_end = eventPlan.event_date
  }

  let nextTicketed = currentPlan.ticketed
  if (typeof extracted.ticketed === 'boolean' && currentPlan.ticketed !== extracted.ticketed) {
    updates.ticketed = extracted.ticketed
    updates.ticketing_model = extracted.ticketed ? 'ticketed' : 'rsvp'
    nextTicketed = extracted.ticketed
  }
  if (eventPlan.monetization_model) {
    updates.ticketing_model = eventPlan.monetization_model
    const monetizationModel = eventPlan.monetization_model.trim().toLowerCase()
    if (monetizationModel.includes('ticket') || monetizationModel.includes('paid')) {
      updates.ticketed = true
      nextTicketed = true
    }
    if (
      monetizationModel.includes('free') ||
      monetizationModel.includes('rsvp') ||
      monetizationModel.includes('invite') ||
      monetizationModel.includes('sponsor')
    ) {
      updates.ticketed = false
      updates.ticketing_model = 'rsvp'
      nextTicketed = false
    }
  }

  if (extracted.food_responsibility) updates.food_responsibility = extracted.food_responsibility
  else if (output.food_drink_needs) updates.food_responsibility = output.food_drink_needs

  const metadata = buildMetadataUpdates(
    currentPlan,
    readTicketingPlatform(userMessage),
    readTicketPriceTargetCents(output),
    nextTicketed,
    userMessage,
    eventTypeDecision.lock,
    eventTypeDecision.requiresConfirmation
      ? {
          field: 'event_type',
          from: currentPlan.event_type,
          to: eventTypeDecision.blockedCandidate,
          prompt: eventTypeDecision.confirmationPrompt,
        }
      : null
  )
  if (metadata) updates.metadata = metadata

  mergeAnsweredArchetypeQuestionsIntoUpdates(currentPlan, updates, userMessage)

  return updates
}

function normalizePlanningMoneyToCents(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value < 10000 ? value * 100 : value)
}

async function maybeMarkPlanReady(
  db: PlannerDb,
  planId: string,
  currentPlan: Plan,
  messageType: PlanMessage['message_type']
): Promise<Plan> {
  if (messageType !== 'recommendation' || currentPlan.status !== 'drafting') return currentPlan

  const { data, error } = await db
    .from('plans')
    .update({ status: 'ready' })
    .eq('id', planId)
    .select(PLAN_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    console.error('Planner ready status update error:', error)
    return currentPlan
  }

  return data as Plan
}

function buildPlanUpdates(intent: Partial<PlanIntent>, currentPlan: Plan, userMessage: string): Record<string, unknown> {
  const updates: Record<string, unknown> = {}

  if (intent.event_type || intent.raw_event_type) {
    const eventTypeDecision = decideEventTypeMutation({
      currentEventType: currentPlan.event_type,
      currentMetadata: currentPlan.metadata,
      proposedEventType: resolveEventTypeLabel(intent.event_type ?? intent.raw_event_type ?? null, userMessage),
      userMessage,
      source: 'explicit_user_reclassification',
    })

    if (eventTypeDecision.shouldApply && eventTypeDecision.eventType) {
      updates.event_type = eventTypeDecision.eventType
      if (currentPlan.event_type && currentPlan.event_type !== eventTypeDecision.eventType) {
        updates.title = `${toTitleCase(eventTypeDecision.eventType)} plan`
      }
      updates.metadata = mergeArchetypeDefaultFillMetadata({
        ...mergeEventRequirementSignals(currentPlan.metadata, userMessage),
        ...(eventTypeDecision.lock ? { [ARCHETYPE_LOCK_METADATA_KEY]: eventTypeDecision.lock } : {}),
      }, eventTypeDecision.lock)
    } else if (eventTypeDecision.requiresConfirmation) {
      updates.metadata = {
        ...mergeEventRequirementSignals(currentPlan.metadata, userMessage),
        [PENDING_PLAN_CHANGE_METADATA_KEY]: {
          field: 'event_type',
          from: currentPlan.event_type,
          to: eventTypeDecision.blockedCandidate,
          raw_value: eventTypeDecision.blockedCandidate,
          prompt: eventTypeDecision.confirmationPrompt,
          created_at: new Date().toISOString(),
          requires_confirmation: true,
        },
      }
    }
  }
  if (typeof intent.guest_count === 'number') updates.guest_count = intent.guest_count
  if (!hasUnknownBudgetSignal(userMessage) && typeof intent.budget_cap === 'number') updates.budget_cap_cents = intent.budget_cap
  if (intent.neighborhood) updates.neighborhood = intent.neighborhood
  if (intent.date_window_start) updates.date_window_start = intent.date_window_start
  if (intent.date_window_end) updates.date_window_end = intent.date_window_end
  if (typeof intent.ticketed === 'boolean') {
    updates.ticketed = intent.ticketed
    updates.ticketing_model = intent.ticketed ? 'ticketed' : 'rsvp'
    if (!intent.ticketed && currentPlan) {
      updates.metadata = clearTicketPriceMetadata(currentPlan.metadata)
    }
  }
  if (typeof intent.profit_goal === 'number') updates.profit_goal_cents = intent.profit_goal
  if (intent.food_responsibility) updates.food_responsibility = intent.food_responsibility
  if (!updates.metadata && hasEventRequirementSignals(userMessage)) {
    updates.metadata = mergeEventRequirementSignals(currentPlan.metadata, userMessage)
  }

  mergeAnsweredArchetypeQuestionsIntoUpdates(currentPlan, updates, userMessage)

  return updates
}

function mergeAnsweredArchetypeQuestionsIntoUpdates(
  currentPlan: Plan,
  updates: Record<string, unknown>,
  userMessage: string
) {
  const nextMetadataBase = {
    ...(readRecord(currentPlan.metadata) ?? {}),
    ...(readRecord(updates.metadata) ?? {}),
  }
  const nextPlan = { ...currentPlan, ...updates, metadata: nextMetadataBase } as Plan
  const nextMetadata = mergeAnsweredArchetypeQuestionMetadata(nextMetadataBase, {
    eventType: readString(updates.event_type) ?? currentPlan.event_type,
    plan: nextPlan,
    conversationText: userMessage,
    userMessage,
  })

  if (JSON.stringify(nextMetadata) !== JSON.stringify(nextMetadataBase)) {
    updates.metadata = nextMetadata
  }
}

function guardHighImpactPlanUpdates(currentPlan: Plan, userMessage: string, updates: Record<string, unknown>): Record<string, unknown> {
  if (isExplicitReclassificationRequest(userMessage)) return updates
  if (readRecord(readRecord(updates.metadata)?.[PENDING_PLAN_CHANGE_METADATA_KEY])) return updates

  const guardedUpdates = { ...updates }
  const pending = findHighImpactPendingChange(currentPlan, guardedUpdates)
  if (!pending) return guardedUpdates

  delete guardedUpdates[pending.field]
  if (pending.field === 'date_window_start') delete guardedUpdates.date_window_end
  if (pending.field === 'ticketed') delete guardedUpdates.ticketing_model

  guardedUpdates.metadata = {
    ...mergeEventRequirementSignals({
      ...(readRecord(currentPlan.metadata) ?? {}),
      ...(readRecord(guardedUpdates.metadata) ?? {}),
    }, userMessage),
    [PENDING_PLAN_CHANGE_METADATA_KEY]: {
      ...pending,
      created_at: new Date().toISOString(),
      requires_confirmation: true,
    },
  }

  return guardedUpdates
}

function findHighImpactPendingChange(currentPlan: Plan, updates: Record<string, unknown>) {
  const checks = [
    {
      field: 'guest_count',
      label: 'guest count',
      current: currentPlan.guest_count,
      next: readNumber(updates.guest_count),
      format: (value: unknown) => typeof value === 'number' ? `${value.toLocaleString()} guests` : String(value),
    },
    {
      field: 'budget_cap_cents',
      label: 'budget',
      current: currentPlan.budget_cap_cents,
      next: readNumber(updates.budget_cap_cents),
      format: (value: unknown) => typeof value === 'number' ? `$${Math.round(value / 100).toLocaleString()}` : String(value),
    },
    {
      field: 'date_window_start',
      label: 'date',
      current: currentPlan.date_window_start,
      next: readString(updates.date_window_start),
      format: (value: unknown) => String(value),
    },
    {
      field: 'ticketed',
      label: 'ticketing model',
      current: currentPlan.ticketing_model ? currentPlan.ticketed : null,
      next: typeof updates.ticketed === 'boolean' ? updates.ticketed : null,
      format: (value: unknown) => value === true ? 'ticketed' : value === false ? 'RSVP/free' : String(value),
    },
  ]

  for (const check of checks) {
    if (check.current === null || check.current === undefined || check.next === null || check.next === undefined) continue
    if (check.current === check.next) continue
    return {
      field: check.field,
      from: check.format(check.current),
      to: check.format(check.next),
      raw_value: check.next,
      prompt: `I noticed the ${check.label} changed from ${check.format(check.current)} to ${check.format(check.next)}. Should I update the plan to use ${check.format(check.next)}?`,
    }
  }

  return null
}

function readPendingPlanChange(metadata: Record<string, unknown> | null) {
  const pending = readRecord(metadata?.[PENDING_PLAN_CHANGE_METADATA_KEY])
  const prompt = readString(pending?.prompt)
  if (!prompt) return null

  return {
    field: readString(pending?.field),
    from: pending?.from,
    to: pending?.to,
    raw_value: pending?.raw_value,
    prompt,
  }
}

function buildPendingPlanChangeResolution(currentPlan: Plan, userMessage: string): Record<string, unknown> | null {
  const pending = readPendingPlanChange(readRecord(currentPlan.metadata))
  if (!pending) return null

  const metadata = { ...(readRecord(currentPlan.metadata) ?? {}) }
  delete metadata[PENDING_PLAN_CHANGE_METADATA_KEY]

  if (isNegativeConfirmation(userMessage)) {
    return { metadata }
  }

  if (!isAffirmativeConfirmation(userMessage)) return null

  const updates: Record<string, unknown> = { metadata }
  if (pending.field === 'event_type') {
    const eventTypeDecision = decideEventTypeMutation({
      currentEventType: currentPlan.event_type,
      currentMetadata: metadata,
      proposedEventType: readString(pending.raw_value) ?? readString(pending.to),
      userMessage: `Actually make this ${readString(pending.raw_value) ?? readString(pending.to) ?? ''}`,
      source: 'agent_suggestion_confirmed',
    })
    if (eventTypeDecision.eventType) {
      updates.event_type = eventTypeDecision.eventType
      updates.title = `${toTitleCase(eventTypeDecision.eventType)} plan`
      if (eventTypeDecision.lock) {
        updates.metadata = {
          ...metadata,
          [ARCHETYPE_LOCK_METADATA_KEY]: eventTypeDecision.lock,
        }
      }
    }
  } else if (pending.field) {
    updates[pending.field] = pending.raw_value
  }

  return updates
}

function isAffirmativeConfirmation(message: string): boolean {
  return /\b(yes|yeah|yep|correct|confirm|approved?|do it|update it|change it|that is right)\b/i.test(message)
}

function isNegativeConfirmation(message: string): boolean {
  return /\b(no|nope|keep|do not|don't|cancel|leave it|stay with)\b/i.test(message)
}

function buildPendingChangeConfirmationDraft(pendingChange: NonNullable<ReturnType<typeof readPendingPlanChange>>): AgentResponseDraft {
  return {
    content: pendingChange.prompt,
    message_type: 'text',
    metadata: toJson({
      kind: 'high_impact_change_confirmation',
      pending_change: pendingChange,
      requires_user_confirmation: true,
    }),
  }
}

async function recordEventTypeCandidate(
  db: PlannerDb,
  payload: {
    userId: string
    planId: string
    intent: Partial<PlanIntent>
  }
) {
  const candidate = payload.intent.taxonomy_candidate
  if (!candidate || payload.intent.is_supported_event_type !== false) return

  const { error } = await db.from('event_type_candidates').insert({
    user_id: payload.userId,
    plan_id: payload.planId,
    raw_phrase: candidate.raw_event_type,
    normalized_phrase: candidate.normalized_phrase,
    inferred_archetype: candidate.planning_archetype,
    suggested_event_type: candidate.suggested_event_type,
    event_components: candidate.event_components,
    suggested_questions: candidate.suggested_questions,
    example_plan_ids: [payload.planId],
    frequency_count: 1,
    status: 'pending',
  })

  if (error) console.error('Planner event type candidate insert error:', error)
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

function getIpAddress(request: NextRequest): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
}

function toJson(value: Record<string, unknown>): Json {
  return value as Json
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function buildMetadataUpdates(
  currentPlan: Plan,
  intendedPlatform: TicketPlatform | null,
  ticketPriceTargetCents: number | null,
  ticketed: boolean,
  userMessage: string,
  eventArchetypeLock: unknown,
  pendingPlanChange: Record<string, unknown> | null
): Record<string, unknown> | null {
  const metadata = readRecord(currentPlan.metadata) ?? {}
  let nextMetadata = mergeEventRequirementSignals(metadata, userMessage)
  if (eventArchetypeLock) {
    nextMetadata[ARCHETYPE_LOCK_METADATA_KEY] = eventArchetypeLock
    nextMetadata = mergeArchetypeDefaultFillMetadata(nextMetadata, eventArchetypeLock)
  }
  if (pendingPlanChange?.prompt) {
    nextMetadata[PENDING_PLAN_CHANGE_METADATA_KEY] = {
      ...pendingPlanChange,
      created_at: new Date().toISOString(),
      requires_confirmation: true,
    }
  }
  if (intendedPlatform) nextMetadata.intended_platform = intendedPlatform
  if (ticketed === false) {
    delete nextMetadata.ticket_price_target_cents
    delete nextMetadata.ticket_price_target
  } else if (typeof ticketPriceTargetCents === 'number' && ticketPriceTargetCents > 0) {
    nextMetadata.ticket_price_target_cents = ticketPriceTargetCents
  }
  return Object.keys(nextMetadata).some((key) => nextMetadata[key] !== metadata[key]) ? nextMetadata : null
}

function mergeArchetypeDefaultFillMetadata(
  metadata: Record<string, unknown>,
  eventArchetypeLock: unknown
): Record<string, unknown> {
  const lock = readRecord(eventArchetypeLock)
  const archetype = getArchetypeByKey(readString(lock?.key))
  if (!archetype) return metadata

  const currentSignals = readRecord(metadata.matching_signals) ?? {}
  const nextSignals = { ...currentSignals }
  let changed = false

  for (const [field, value] of Object.entries(archetype.default_fills)) {
    if (value === undefined || value === null) continue
    if (nextSignals[field] !== undefined && nextSignals[field] !== null) continue
    nextSignals[field] = value
    changed = true
  }

  return changed
    ? { ...metadata, matching_signals: nextSignals }
    : metadata
}

function readTicketPriceTargetCents(output: IntakeAgentOutput): number | null {
  const extracted = output.extracted_fields.ticket_price_target
  if (typeof extracted === 'number' && extracted > 0) return normalizeTicketPriceTargetCents(extracted)

  const eventPlanValue = output.updated_event_plan.ticket_price_target
  if (typeof eventPlanValue === 'number' && eventPlanValue > 0) return normalizeTicketPriceTargetCents(eventPlanValue)

  return null
}

function normalizeTicketPriceTargetCents(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value < 1000 ? value * 100 : value)
}

function clearTicketPriceMetadata(value: unknown): Record<string, unknown> {
  const nextMetadata = { ...(readRecord(value) ?? {}) }
  delete nextMetadata.ticket_price_target_cents
  delete nextMetadata.ticket_price_target
  return nextMetadata
}

function toTitleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function resolveEventTypeLabel(candidate: string | null, message: string): string | null {
  const resolvedArchetype = resolveArchetypeContext(message)
  if (resolvedArchetype) return resolvedArchetype.display_name
  return candidate
}

function isGenericEventType(value: string) {
  return /^(event|party|gathering|meetup|social|experience)$/i.test(value.trim())
}

function readTicketingPlatform(message: string): TicketPlatform | null {
  const normalized = message.toLowerCase()
  if (/\bevent\s*brite\b|\beventbrite\b/.test(normalized)) return 'eventbrite'
  if (/\bluma\b|\blu\.ma\b/.test(normalized)) return 'luma'
  if (/\bposh\b/.test(normalized)) return 'posh'
  if (/\bpartiful\b/.test(normalized)) return 'partiful'
  return null
}

async function insertPlanUpdateRows(db: PlannerDb, plan: Plan, updates: Record<string, unknown>) {
  const rows = Object.entries(updates).map(([field, newValue]) => ({
    plan_id: plan.id,
    field,
    old_value: toJsonValue(plan[field as keyof Plan]),
    new_value: toJsonValue(newValue),
  }))

  if (rows.length === 0) return

  const { error } = await db.from('planner_plan_updates').insert(rows)
  if (error) console.error('Planner message update audit insert error:', error)
}

function toJsonValue(value: unknown): Json {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    Array.isArray(value) ||
    (typeof value === 'object' && value !== null)
  ) {
    return value as Json
  }

  return null
}
