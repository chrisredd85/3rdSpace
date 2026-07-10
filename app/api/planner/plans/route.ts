/**
 * API route for Agent Planner plan collection operations.
 *
 * Purpose:
 * - POST creates a plan from the user's first chat message.
 * - GET lists plans owned by the authenticated community builder.
 *
 * Route inputs:
 * - POST body: `{ message: string }`.
 * - GET query: optional `limit` and `offset` pagination params.
 *
 * Key behaviors:
 * - Uses deterministic keyword extraction from `parseEventIntent`; no external LLM calls.
 * - Inserts the plan, first user message, first agent confirmation message, and audit log.
 * - Uses the repo Supabase server wrapper from `@/lib/supabase/server`.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { IntakeAgentOutput } from '@/lib/ai/agents/intakeAgent'
import { checkPlanCreationAccess } from '@/lib/billing/builder-billing'
import { determineNextResponse } from '@/lib/planner/agentResponder'
import { buildEventPlanFromPlannerPlan } from '@/lib/planner/agentPlanAdapter'
import {
  ARCHETYPE_LOCK_METADATA_KEY,
  buildMutationContract,
  buildArchetypeAnswerText,
  createEventArchetypeLock,
  decideEventTypeMutation,
  getNextArchetypeIntakeQuestion,
  mergeEventRequirementSignals,
  resolveArchetypeContext,
  resolveArchetypeIntakeContext,
  sanitizeIntakeQuestionCandidate,
} from '@/lib/planner/archetypes'
import { PLAN_MESSAGE_SELECT_COLUMNS, PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { hasUnknownBudgetSignal, parseEventIntent } from '@/lib/planner/intentParser'
import { mergeUserPreferenceSignalsIntoMetadata } from '@/lib/planner/userPreferenceSignals'
import { BYO_VENDORS_METADATA_KEY, mergeByoVendors, readByoVendors } from '@/lib/planner/byoVendors'
import {
  mergeVendorNeedStatusMetadata,
  readPlanVendorNeedStatus,
  resolveVendorNeedStatusUpdate,
} from '@/lib/planner/vendorNeedStatus'
import {
  buildSpecialSupplyTransitionPhrase,
  mergeSpecialSupplyMetadata,
  pickSpecialSupplyIntakeQuestion,
} from '@/lib/planner/specialSupply'
import {
  mergeSupplyIntentMetadata,
  pickSupplyIntentClarificationQuestion,
  syncPlanSupplyIntentRows,
} from '@/lib/planner/supplyIntent/activityCatalog'
import {
  isIntakeReadyForRecommendations,
  isPlanReadyForRequestedRecommendations,
} from '@/lib/planner/intakeReadiness'
import {
  BuilderBillingRequiredError,
} from '@/lib/billing/builder-billing'
import { getBuilderConnectedTicketingPlatforms } from '@/lib/server/account-setup'
import { buildOrganizerPreferencePayload, loadBuilderOrganizerPreferences } from '@/lib/server/builderPreferences'
import {
  getBuilderProfileIdForUser,
  summarizeBuilderAttendance,
  type BuilderAttendanceSummary,
} from '@/lib/server/builderAttendanceHistory'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { TicketPlatform } from '@/lib/constants/account-setup'
import type {
  Json,
  AgentResponseDraft,
  Plan,
  PlanIntent,
  PlanMessage,
  PlannerApiErrorResponse,
  PlannerCreatePlanResponse,
  PlannerListPlansResponse,
} from '@/lib/types'

type PlannerDb = { from: (table: string) => any }
type AgentMode = 'openai' | 'deterministic'
type InitialMessageResult = { plan: Plan; messages: PlanMessage[] | null; agentMode: AgentMode }
type AuthResult =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const planStatusSchema = z.enum(['drafting', 'ready', 'approved', 'executing', 'complete', 'archived'])
const planMessageRoleSchema = z.enum(['user', 'agent', 'system'])
const planMessageTypeSchema = z.enum(['text', 'confirmation_card', 'recommendation', 'approval_request', 'status_update'])
const draftMessageSchema = z.object({
  role: planMessageRoleSchema,
  content: z.string().trim().min(1).max(8000),
  message_type: planMessageTypeSchema,
  metadata: z.unknown().optional(),
  created_at: z.string().trim().optional(),
})
const createPlanSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  draft: z.object({
    plan: z.unknown().optional(),
    messages: z.array(draftMessageSchema).min(1).max(100).optional(),
  }).optional(),
})

const listPlansSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

/**
 * Lists Agent Planner plans owned by the authenticated community builder.
 *
 * @param request - Next.js request carrying auth cookies and optional pagination query params.
 * @returns JSON response containing the user's plans or an auth/error payload.
 */
export async function GET(
  request: NextRequest
): Promise<NextResponse<PlannerListPlansResponse | PlannerApiErrorResponse>> {
  try {
    const auth = await getAuthenticatedPlannerDb()
    if ('response' in auth) return auth.response

    const params = listPlansSchema.safeParse({
      limit: request.nextUrl.searchParams.get('limit') ?? undefined,
      offset: request.nextUrl.searchParams.get('offset') ?? undefined,
    })

    if (!params.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: params.error.flatten() as Json },
        { status: 400 }
      )
    }

    const { limit, offset } = params.data
    const { data, error } = await auth.db
      .from('plans')
      .select(PLAN_SELECT_COLUMNS)
      .eq('user_id', auth.userId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Planner plans list error:', error)
      return NextResponse.json({ error: 'Failed to fetch plans' }, { status: 500 })
    }

    const plans = (data ?? []) as Plan[]
    return NextResponse.json({ plans, count: plans.length })
  } catch (error) {
    console.error('Planner plans GET error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

/**
 * Creates an Agent Planner plan from the user's first natural-language message.
 *
 * Extraction logic:
 * - `parseEventIntent` uses supported keyword/regex matches for event type, headcount,
 *   budget, neighborhood, dates, ticketing, and profit target.
 * - Only fields extracted with deterministic matches are written to the plan.
 * - The first agent response is a confirmation card that asks for the first missing field.
 *
 * @param request - Next.js request with `{ message }` JSON body and auth cookies.
 * @returns JSON response containing the created plan and initial two-message exchange.
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<PlannerCreatePlanResponse | PlannerApiErrorResponse>> {
  try {
    const auth = await getAuthenticatedPlannerDb()
    if ('response' in auth) return auth.response

    const body = createPlanSchema.safeParse(await request.json())
    if (!body.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: body.error.flatten() as Json },
        { status: 400 }
      )
    }

    const planCreationAccess = await checkPlanCreationAccess({
      db: auth.db,
      userId: auth.userId,
    })

    if (!planCreationAccess.allowed) {
      return NextResponse.json(
        {
          error: planCreationAccess.error,
          billingRequired: true,
          billing: planCreationAccess.billing,
        },
        { status: 402 }
      )
    }

    const intent = parseEventIntent(body.data.message)
    const draftPlan = readRecord(body.data.draft?.plan)
    const draftMessages = body.data.draft?.messages ?? []
    const planInsert = buildPlanInsert(auth.userId, body.data.message, intent, draftPlan)

    const { data: planData, error: planError } = await auth.db
      .from('plans')
      .insert(planInsert)
      .select(PLAN_SELECT_COLUMNS)
      .single()

    if (planError || !planData) {
      console.error('Planner plan create error:', planError)
      return NextResponse.json({ error: 'Failed to create plan' }, { status: 500 })
    }

    const plan = planData as Plan
    const writeDb = createServiceRoleClient() as unknown as PlannerDb
    await syncPlanSupplyIntentRows(auth.db, plan.id, plan.metadata)
    const initialExchange: InitialMessageResult = draftMessages.length > 0
      ? {
        plan,
        messages: await insertDraftMessages(writeDb, plan.id, draftMessages),
        agentMode: 'deterministic',
      }
      : await insertInitialMessages(auth.db, writeDb, plan, body.data.message, intent, auth.userId)

    if (!initialExchange.messages) {
      return NextResponse.json({ error: 'Failed to create initial messages' }, { status: 500 })
    }

    const finalPlan = initialExchange.plan
    const messages = initialExchange.messages
    // Whether the initial intake already has all required fields and should fetch recommendations.
    // The client calls /trigger-recommendations after plan creation to avoid timing out this route.
    const hasRecommendationTransition = messages.some(
      (message) => message.role === 'agent' && message.message_type === 'recommendation'
    )
    const hasDraftSignupGate = messages.some((message) =>
      readRecord(message.metadata)?.state === 'draft_match_signup_gate'
    )
    const needsRecommendations =
      hasRecommendationTransition ||
      (finalPlan.status === 'ready' && hasDraftSignupGate && !messages.some(isRecommendationMessage))

    await recordEventTypeCandidate(auth.db, {
      userId: auth.userId,
      planId: finalPlan.id,
      intent,
    })
    await insertAuditLog(writeDb, {
      user_id: auth.userId,
      plan_id: finalPlan.id,
      action: 'planner.plan.created',
      entity_type: 'plan',
      entity_id: finalPlan.id,
      before_state: null,
      after_state: toJson({
        plan: finalPlan,
        intent,
        agent_mode: initialExchange.agentMode,
        message_ids: messages.map((message) => message.id),
      }),
      ip_address: getIpAddress(request),
    })

    return NextResponse.json({
      plan: finalPlan,
      messages,
      intent,
      needs_recommendations: needsRecommendations || undefined,
    })
  } catch (error) {
    if (error instanceof BuilderBillingRequiredError) {
      return NextResponse.json(
        { error: 'Upgrade to create more events.', billingRequired: true },
        { status: 402 }
      )
    }
    console.error('Planner plans POST error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

function isRecommendationMessage(message: PlanMessage) {
  if (message.message_type !== 'recommendation') return false
  const metadata = readRecord(message.metadata)
  const recommendations = metadata?.recommendations
  return Array.isArray(recommendations) && recommendations.length > 0
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

function buildPlanInsert(
  userId: string,
  message: string,
  intent: Partial<PlanIntent>,
  draftPlan: Record<string, unknown> | null = null
) {
  const shouldIgnoreBudget = hasUnknownBudgetSignal(message)
  const draftStatus = planStatusSchema.safeParse(readString(draftPlan?.status))
  const status = draftStatus.success && !isTerminalStatus(draftStatus.data) ? draftStatus.data : 'drafting'
  const resolvedEventType = resolveEventTypeLabel(
    readString(draftPlan?.event_type) ?? intent.event_type ?? intent.raw_event_type ?? null,
    message
  )
  const baseMetadata = readRecord(draftPlan?.metadata) ?? {}
  const lockedArchetype = readRecord(baseMetadata[ARCHETYPE_LOCK_METADATA_KEY])
    ? null
    : createEventArchetypeLock(`${resolvedEventType ?? ''} ${message}`, 'initial_intake')
  const metadataWithRequirements = mergeEventRequirementSignals(
    lockedArchetype
      ? { ...baseMetadata, [ARCHETYPE_LOCK_METADATA_KEY]: lockedArchetype }
      : baseMetadata,
    message
  )
  const metadataBeforeVendorNeed =
    mergeUserPreferenceSignalsIntoMetadata(metadataWithRequirements, message) ?? metadataWithRequirements
  const metadataWithSpecialSupply =
    mergeSpecialSupplyMetadata(metadataBeforeVendorNeed, message) ?? metadataBeforeVendorNeed
  const metadataWithSupplyIntent =
    mergeSupplyIntentMetadata(metadataWithSpecialSupply, { userMessage: message, source: 'intake' }) ??
    metadataWithSpecialSupply
  const vendorNeedStatus = resolveVendorNeedStatusUpdate({
    metadata: metadataWithSupplyIntent,
    userMessage: message,
    agentStatus: null,
  })
  const metadata = vendorNeedStatus
    ? mergeVendorNeedStatusMetadata(metadataWithSupplyIntent, vendorNeedStatus) ?? metadataWithSupplyIntent
    : metadataWithSupplyIntent

  return {
    user_id: userId,
    title: readString(draftPlan?.title) ?? (resolvedEventType ? `${toTitleCase(resolvedEventType)} plan` : buildPlanTitle(message, intent)),
    event_type: resolvedEventType,
    status,
    guest_count: readNumber(draftPlan?.guest_count) ?? intent.guest_count ?? null,
    budget_cap_cents: shouldIgnoreBudget ? null : readNumber(draftPlan?.budget_cap_cents) ?? intent.budget_cap ?? null,
    neighborhood: readString(draftPlan?.neighborhood) ?? intent.neighborhood ?? null,
    date_window_start: readString(draftPlan?.date_window_start) ?? intent.date_window_start ?? null,
    date_window_end: readString(draftPlan?.date_window_end) ?? intent.date_window_end ?? null,
    ticketed: readBoolean(draftPlan?.ticketed) ?? intent.ticketed ?? false,
    ticketing_model: readString(draftPlan?.ticketing_model) ?? (intent.ticketed === true ? 'ticketed' : intent.ticketed === false ? 'rsvp' : null),
    food_responsibility: readString(draftPlan?.food_responsibility) ?? intent.food_responsibility ?? null,
    profit_goal_cents: intent.profit_goal ?? null,
    notes: readString(draftPlan?.notes) ?? (intent.date_hint ? `Initial date hint: ${intent.date_hint}` : null),
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  }
}

async function insertInitialMessages(
  db: PlannerDb,
  writeDb: PlannerDb,
  plan: Plan,
  message: string,
  intent: Partial<PlanIntent>,
  userId: string
): Promise<InitialMessageResult> {
  const { data: userMessageData, error: userMessageError } = await writeDb
    .from('plan_messages')
    .insert({
      plan_id: plan.id,
      role: 'user',
      content: message,
      message_type: 'text',
      metadata: toJson({ intent }),
    })
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .single()

  if (userMessageError || !userMessageData) {
    console.error('Planner initial message create error:', userMessageError)
    return { plan, messages: null, agentMode: 'deterministic' }
  }

  const userMessage = userMessageData as PlanMessage
  const agentResponse = await buildInitialAgentResponse({
    db,
    writeDb,
    plan,
    userId,
    userMessage: message,
    messages: [userMessage],
  })
  const finalPlan = await maybeMarkPlanReady(db, agentResponse.plan, agentResponse.agentDraft.message_type)
  const { data: agentMessageData, error: agentMessageError } = await writeDb
    .from('plan_messages')
    .insert({
      plan_id: plan.id,
      role: 'agent',
      content: agentResponse.agentDraft.content,
      message_type: agentResponse.agentDraft.message_type,
      metadata: agentResponse.agentDraft.metadata,
    })
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .single()

  if (agentMessageError || !agentMessageData) {
    console.error('Planner initial agent response error:', agentMessageError)
    return { plan: finalPlan, messages: null, agentMode: agentResponse.agentMode }
  }

  return {
    plan: finalPlan,
    messages: [userMessage, agentMessageData as PlanMessage],
    agentMode: agentResponse.agentMode,
  }
}

async function buildInitialAgentResponse(input: {
  db: PlannerDb
  writeDb: PlannerDb
  plan: Plan
  userId: string
  userMessage: string
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
    const organizerPreferences = await loadBuilderOrganizerPreferences(input.db, input.userId)
    const builderHistory = await loadBuilderHistoryForIntake(input.db, input.userId, resolvedArchetype?.key ?? null)
    const agentResult = await runAgent({
      agent_name: 'intake',
      event_id: null,
      user_id: input.userId,
      payload: {
        messages: [{ role: 'user', content: input.userMessage }],
        user_message: input.userMessage,
        current_plan: input.plan,
        existing_event_plan: buildEventPlanFromPlannerPlan(input.plan),
        connected_platforms: connectedPlatforms,
        organizer_profile: buildOrganizerPreferencePayload(organizerPreferences),
        resolved_archetype: resolvedArchetype,
        archetype_resolution: resolvedArchetype,
        builder_history: builderHistory ? toIntakeBuilderHistory(builderHistory) : null,
        mutation_contract: buildMutationContract(input.plan.metadata, input.plan.event_type),
      },
    })

    if ((agentResult.status as string) !== 'succeeded') {
      console.warn('[planner.intake] Falling back to deterministic response: intake agent did not succeed')
      return deterministicDraft()
    }

    const intakeOutput = agentResult.output as IntakeAgentOutput
    const planWithAgentUpdates = await updatePlanIfNeeded(
      input.db,
      input.writeDb,
      input.plan,
      buildPlanUpdatesFromIntakeOutput(intakeOutput, input.plan, input.userMessage)
    )

    return {
      agentDraft: buildIntakeAgentDraft(intakeOutput, planWithAgentUpdates, input.messages),
      plan: planWithAgentUpdates,
      agentMode: 'openai',
    }
  } catch (error) {
    console.warn('[planner.intake] Falling back to deterministic response:', error)
    return deterministicDraft()
  }
}

async function updatePlanIfNeeded(
  db: PlannerDb,
  writeDb: PlannerDb,
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
    .eq('id', currentPlan.id)
    .select(PLAN_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    console.error('Planner initial plan field update error:', error)
    return currentPlan
  }

  await insertPlanUpdateRows(writeDb, currentPlan, changedUpdates)
  await syncPlanSupplyIntentRows(db, (data as Plan).id, (data as Plan).metadata)

  return data as Plan
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

async function maybeMarkPlanReady(
  db: PlannerDb,
  currentPlan: Plan,
  messageType: PlanMessage['message_type']
): Promise<Plan> {
  if (messageType !== 'recommendation' || currentPlan.status !== 'drafting') return currentPlan

  const { data, error } = await db
    .from('plans')
    .update({ status: 'ready' })
    .eq('id', currentPlan.id)
    .select(PLAN_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    console.error('Planner initial ready status update error:', error)
    return currentPlan
  }

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
  const missingCoreQuestion = buildMissingCoreQuestion(output, plan)
  const specialSupplyQuestion = pickSpecialSupplyIntakeQuestion(plan, conversationText)
  const supplyIntentQuestion = pickSupplyIntentClarificationQuestion(plan)
  const agentQuestion = [nextBestQuestion, ...missingQuestions]
    .map((candidate) => sanitizeIntakeQuestionCandidate(candidate))
    .find((question): question is string => Boolean(question))
  const question = specialSupplyQuestion ?? supplyIntentQuestion ?? archetypeQuestion?.prompt ?? agentQuestion ?? missingCoreQuestion
  const canMatchNow = isPlanReadyForRequestedRecommendations(plan, { conversationText })
  const shouldTransitionToMatch = !specialSupplyQuestion && !supplyIntentQuestion && (isReady || (!archetypeQuestion && !missingCoreQuestion && canMatchNow))
  const content = shouldTransitionToMatch
    ? `${reflection} ${buildTransitionPhrase(plan)}`
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
      transition_to_match: shouldTransitionToMatch,
      requires_response: !shouldTransitionToMatch && Boolean(question),
    }),
  }
}

function buildTransitionPhrase(plan: Plan): string {
  const specialSupplyPhrase = buildSpecialSupplyTransitionPhrase(plan)
  if (specialSupplyPhrase) return specialSupplyPhrase

  const area = plan.neighborhood?.trim() || 'your target area'
  const eventType = plan.event_type?.trim().toLowerCase() || 'event'
  const guestText = typeof plan.guest_count === 'number' && plan.guest_count > 0
    ? ` for ${plan.guest_count.toLocaleString()} guests`
    : ''
  const recommendationScope = readPlanVendorNeedStatus(plan) === 'none'
    ? 'venue and operating recommendations'
    : 'venue and vendor recommendations'
  return `I have enough to start matching ${area} options${guestText} for this ${eventType}. Pulling ${recommendationScope} now.`
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
    eventTypeDecision.lock
  )
  if (metadata) updates.metadata = metadata

  const supplyIntentMetadata = mergeSupplyIntentMetadata(updates.metadata ?? currentPlan.metadata, {
    userMessage,
    agentIntents: output.supply_intents,
    agentClarification: output.supply_clarification_needed,
    source: 'intake',
  })
  if (supplyIntentMetadata) updates.metadata = supplyIntentMetadata

  const vendorNeedStatus = resolveVendorNeedStatusUpdate({
    metadata: updates.metadata ?? currentPlan.metadata,
    userMessage,
    agentStatus: output.vendor_need_status,
  })
  if (vendorNeedStatus) {
    const baseMetadata = (updates.metadata && typeof updates.metadata === 'object' && !Array.isArray(updates.metadata))
      ? updates.metadata as Record<string, unknown>
      : (readRecord(currentPlan.metadata) ?? {})
    const nextMetadata = mergeVendorNeedStatusMetadata(baseMetadata, vendorNeedStatus)
    if (nextMetadata) updates.metadata = nextMetadata
  }

  // Merge any BYO (bring-your-own) vendors the intake agent surfaced this
  // turn into plan.metadata.byo_vendors so the economics pipeline can fold
  // them into the cost total. See lib/planner/byoVendors.ts for the merge
  // rationale (existing entries preserved when intake omits them).
  const incomingByo = Array.isArray(output.byo_vendors) ? output.byo_vendors : []
  if (incomingByo.length > 0) {
    const baseMetadata = (updates.metadata && typeof updates.metadata === 'object' && !Array.isArray(updates.metadata))
      ? updates.metadata as Record<string, unknown>
      : (readRecord(currentPlan.metadata) ?? {})
    const existingByo = readByoVendors(baseMetadata)
    const mergedByo = mergeByoVendors(existingByo, incomingByo)
    updates.metadata = {
      ...baseMetadata,
      [BYO_VENDORS_METADATA_KEY]: mergedByo,
    }
  }

  return updates
}

function normalizePlanningMoneyToCents(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value < 10000 ? value * 100 : value)
}

async function insertDraftMessages(
  db: PlannerDb,
  planId: string,
  draftMessages: z.infer<typeof draftMessageSchema>[]
): Promise<PlanMessage[] | null> {
  const now = Date.now()
  const inserts = draftMessages.map((message, index) => ({
    plan_id: planId,
    role: message.role,
    content: message.content,
    message_type: message.message_type,
    metadata: toJsonValue(readRecord(message.metadata) ?? {}),
    created_at: normalizeCreatedAt(message.created_at, now + index),
  }))

  const { data, error } = await db
    .from('plan_messages')
    .insert(inserts)
    .select(PLAN_MESSAGE_SELECT_COLUMNS)

  if (error || !data) {
    console.error('Planner draft message migration error:', error)
    return null
  }

  return data as PlanMessage[]
}

function buildPlanTitle(message: string, intent: Partial<PlanIntent>): string {
  const eventType = intent.event_type ?? intent.raw_event_type
  if (eventType) {
    return `${toTitleCase(eventType)} plan`
  }

  const compact = message.replace(/\s+/g, ' ').trim()
  return compact.length > 64 ? `${compact.slice(0, 61)}...` : compact
}

function resolveEventTypeLabel(candidate: string | null, message: string): string | null {
  const resolvedArchetype = resolveArchetypeContext(message)
  if (resolvedArchetype) return resolvedArchetype.display_name
  return candidate
}

function isGenericEventType(value: string) {
  return /^(event|party|gathering|meetup|social|experience)$/i.test(value.trim())
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
  if (error) console.error('Planner initial update audit insert error:', error)
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

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
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

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function buildMetadataUpdates(
  currentPlan: Plan,
  intendedPlatform: TicketPlatform | null,
  ticketPriceTargetCents: number | null,
  ticketed: boolean,
  userMessage: string,
  eventArchetypeLock: unknown
): Record<string, unknown> | null {
  const metadata = readRecord(currentPlan.metadata) ?? {}
  const withRequirements = mergeEventRequirementSignals(metadata, userMessage)
  const nextMetadata =
    mergeUserPreferenceSignalsIntoMetadata(withRequirements, userMessage) ?? withRequirements
  const withSpecialSupply = mergeSpecialSupplyMetadata(nextMetadata, userMessage) ?? nextMetadata
  const withSupplyIntent =
    mergeSupplyIntentMetadata(withSpecialSupply, { userMessage, source: 'intake' }) ?? withSpecialSupply
  if (eventArchetypeLock) withSupplyIntent[ARCHETYPE_LOCK_METADATA_KEY] = eventArchetypeLock
  if (intendedPlatform) withSupplyIntent.intended_platform = intendedPlatform
  if (ticketed === false) {
    delete withSupplyIntent.ticket_price_target_cents
    delete withSupplyIntent.ticket_price_target
  } else if (typeof ticketPriceTargetCents === 'number' && ticketPriceTargetCents > 0) {
    withSupplyIntent.ticket_price_target_cents = ticketPriceTargetCents
  }
  return Object.keys(withSupplyIntent).some((key) => withSupplyIntent[key] !== metadata[key]) ? withSupplyIntent : null
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

function readTicketingPlatform(message: string): TicketPlatform | null {
  const normalized = message.toLowerCase()
  if (/\bevent\s*brite\b|\beventbrite\b/.test(normalized)) return 'eventbrite'
  if (/\bluma\b|\blu\.ma\b/.test(normalized)) return 'luma'
  if (/\bposh\b/.test(normalized)) return 'posh'
  if (/\bpartiful\b/.test(normalized)) return 'partiful'
  return null
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
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
  return typeof value === 'boolean' ? value : null
}

function isTerminalStatus(status: Plan['status']) {
  return status === 'complete' || status === 'archived'
}

function normalizeCreatedAt(value: string | undefined, fallbackMs: number) {
  if (value) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }

  return new Date(fallbackMs).toISOString()
}

function toJson(value: Record<string, unknown>): Json {
  return value as Json
}

function toJsonValue(value: unknown): Json {
  return value as Json
}
