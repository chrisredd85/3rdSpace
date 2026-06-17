export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runAgent } from '@/lib/ai/agents'
import type { IntakeAgentOutput } from '@/lib/ai/agents/intakeAgent'
import type { EventPlan } from '@/lib/ai/types'
import {
  ARCHETYPE_LOCK_METADATA_KEY,
  buildMutationContract,
  buildArchetypeAnswerText,
  buildArchetypeQuestionPriority,
  decideEventTypeMutation,
  findAnsweredArchetypeQuestionForPrompt,
  getArchetypeByKey,
  getNextArchetypeIntakeQuestion,
  hasEventRequirementSignals,
  mergeAnsweredArchetypeQuestionMetadata,
  mergeEventRequirementSignals,
  PENDING_ARCHETYPE_QUESTION_METADATA_KEY,
  resolveArchetypeContext,
  resolveArchetypeIntakeContext,
  sanitizeIntakeQuestionCandidate,
} from '@/lib/planner/archetypes'
import type { EventArchetypeConfig } from '@/lib/planner/archetypes'
import { hasUnknownBudgetSignal, parseEventIntent, parseStandaloneGuestCountReply } from '@/lib/planner/intentParser'
import {
  isPlanReadyForRequestedRecommendations,
  isRecommendationRequest,
} from '@/lib/planner/intakeReadiness'
import { checkRateLimit, rateLimitHeaders } from '@/lib/server/rate-limit'
import type { Plan, PlanIntent, PlanMessage } from '@/lib/types'

const publicIntakeRequestSchema = z.object({
  user_message: z.string().trim().min(1).max(4000),
  current_plan: z.record(z.unknown()).nullable().optional(),
})

type PublicIntakeAgentDraft = {
  content: string
  message_type: PlanMessage['message_type']
  metadata: Record<string, unknown>
}

export async function POST(request: NextRequest) {
  try {
    const rateLimit = await checkRateLimit(`planner-public-intake:${getIpAddress(request)}`, {
      limit: 10,
      windowMs: 60_000,
    })
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many planner requests. Try again in a minute.' },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      )
    }

    const body = publicIntakeRequestSchema.safeParse(await request.json())
    if (!body.success) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      )
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI intake is not configured' },
        { status: 503 }
      )
    }

    const deterministicIntent = parseEventIntent(body.data.user_message)
    const deterministicPatch = buildPlanPatchFromIntent(
      deterministicIntent,
      body.data.user_message,
      body.data.current_plan ?? null
    )
    const currentPlan = mergePublicPlanPatch(body.data.current_plan ?? null, deterministicPatch)
    const messageArchetype = resolveArchetypeContext(body.data.user_message)
    const resolvedArchetype =
      resolveArchetypeIntakeContext(body.data.user_message) ??
      resolveArchetypeIntakeContext(`${body.data.user_message} ${readString(currentPlan.event_type) ?? ''}`)
    const resolvedArchetypeConfig = resolvedArchetype ? getArchetypeByKey(resolvedArchetype.key) : null
    const conversationText = buildArchetypeAnswerText(
      [{ role: 'user', content: body.data.user_message }],
      buildPublicPlanAnswerHints(currentPlan)
    )
    const canMatchNow = computePublicCanMatchNow(currentPlan, conversationText, resolvedArchetypeConfig)

    let agentResult
    try {
      agentResult = await runAgent({
        agent_name: 'intake',
        event_id: null,
        user_id: 'public-planner-draft',
        payload: {
          user_message: body.data.user_message,
          current_plan: currentPlan,
          existing_event_plan: buildEventPlanFromPublicDraft(currentPlan),
          connected_platforms: [],
          can_match_now: canMatchNow,
          resolved_archetype: resolvedArchetype,
          archetype_resolution: resolvedArchetype,
          archetype_question_priority: resolvedArchetypeConfig
            ? buildArchetypeQuestionPriority({
                archetype: resolvedArchetypeConfig,
                plan: currentPlan as Partial<Plan>,
                conversationText,
              })
            : null,
          mutation_contract: buildMutationContract(currentPlan.metadata, readString(currentPlan.event_type)),
        },
      })
    } catch (error) {
      console.warn('[planner.public-intake] using deterministic fallback after intake exception', error)
      return buildPublicFallbackResponse(currentPlan, body.data.user_message, 'agent_exception')
    }

    if ((agentResult.status as string) !== 'succeeded') {
      console.warn('[planner.public-intake] using deterministic fallback after intake failure', {
        status: agentResult.status,
      })
      return buildPublicFallbackResponse(currentPlan, body.data.user_message, 'agent_failed')
    }

    const output = agentResult.output as IntakeAgentOutput
    const agentPatch = buildPlanPatchFromIntakeOutput(output, currentPlan, body.data.user_message)
    const planPatch = mergePublicPlanPatch(
      mergePublicPlanPatch(
        mergePublicPlanPatch(currentPlan, agentPatch),
        deterministicPatch
      ),
      buildMessageArchetypePatch(messageArchetype)
    )
    const planPatchWithAnswers = mergeArchetypeAnswerMetadata(planPatch, body.data.user_message)
    const agentDraft = buildPublicIntakeAgentDraft(output, planPatchWithAnswers, body.data.user_message)
    const planPatchWithPendingQuestion = attachPendingArchetypeQuestion(planPatchWithAnswers, agentDraft)

    return NextResponse.json({
      data: {
        agent_draft: agentDraft,
        plan_patch: planPatchWithPendingQuestion,
      },
    })
  } catch (error) {
    console.error('[planner.public-intake] failed', error)
    return NextResponse.json(
      { error: 'Unable to run planner intake' },
      { status: 503 }
    )
  }
}

function buildMessageArchetypePatch(archetype: ReturnType<typeof resolveArchetypeContext>): Partial<Plan> {
  if (!archetype) return {}
  const lock = {
    key: archetype.key,
    display_name: archetype.display_name,
    locked_at: new Date().toISOString(),
    source: 'initial_intake',
  }

  return {
    title: `${archetype.display_name} plan`,
    event_type: archetype.display_name,
    metadata: toPlanMetadata(mergeArchetypeDefaultFillMetadata({
      [ARCHETYPE_LOCK_METADATA_KEY]: lock,
    }, lock)),
  }
}

function buildPublicFallbackResponse(
  planPatch: Record<string, unknown>,
  userMessage: string,
  reason: string
) {
  return NextResponse.json({
    data: {
      agent_draft: buildPublicFallbackAgentDraft(planPatch, userMessage, reason),
      plan_patch: planPatch,
    },
  })
}

function buildPublicFallbackAgentDraft(
  planPatch: Record<string, unknown>,
  userMessage: string,
  reason: string
): PublicIntakeAgentDraft {
  const question = getNextPublicFallbackQuestion(planPatch)
  const eventType = readString(planPatch.event_type)
  const guestCount = readNumber(planPatch.guest_count)
  const area = readString(planPatch.neighborhood)
  const reflection = normalizeAcknowledgementTone(
    eventType
      ? `Got it — ${eventType}${guestCount ? ` for ${guestCount} guests` : ''}${area ? ` in ${area}` : ''}.`
      : 'Got it — I can help shape that into a bookable event plan.',
    eventType ?? userMessage
  )

  return {
    content: question
      ? `${reflection} ${question}`
      : `${reflection} I have enough to start pulling venue options and market-estimated costs.`,
    message_type: question ? 'text' : 'recommendation',
    metadata: {
      agent_name: 'intake',
      agent_mode: 'deterministic_fallback',
      fallback_reason: reason,
    },
  }
}

function buildPublicIntakeAgentDraft(
  output: IntakeAgentOutput,
  planPatch: Record<string, unknown>,
  userMessage: string
): PublicIntakeAgentDraft {
  const missingQuestions = output.missing_questions
    .map((question) => question.trim())
    .filter((question) => !isQuestionAnsweredByPatch(question, planPatch))
    .filter((question) => !isOptionalBudgetQuestion(question))
    .filter((question) => question.length > 0)
  const rawNextBestQuestion = output.next_best_question?.trim() || null
  const nextBestQuestion =
    rawNextBestQuestion &&
    !isQuestionAnsweredByPatch(rawNextBestQuestion, planPatch) &&
    !isOptionalBudgetQuestion(rawNextBestQuestion)
      ? rawNextBestQuestion
      : missingQuestions[0] ?? null
  const reflection = normalizeAcknowledgementTone(output.reflection.trim(), readString(planPatch.event_type) ?? output.extracted_fields.event_type ?? output.updated_event_plan.event_name)
  const conversationText = buildArchetypeAnswerText(
    [{ role: 'user', content: userMessage }],
    buildPublicPlanAnswerHints(planPatch)
  )
  const coreFieldsReady = hasPublicCoreFields(planPatch, output)
  const archetypeQuestion = coreFieldsReady
    ? getNextArchetypeIntakeQuestion({
        eventType: buildPublicArchetypeSearchText(output, planPatch),
        plan: planPatch as Partial<Plan>,
        conversationText,
        includeRecommended: true,
      })
    : null
  const missingCoreQuestion = buildPublicMissingCoreQuestion(output, planPatch)
  const agentQuestion = pickPublicUnansweredAgentQuestion(output, planPatch, conversationText, [
    nextBestQuestion,
    ...missingQuestions,
  ])
  const question = archetypeQuestion?.prompt ?? agentQuestion ?? missingCoreQuestion
  const isRequestedRecommendation =
    isRecommendationRequest(userMessage) &&
    isPlanReadyForRequestedRecommendations(planPatch as Partial<Plan>, { conversationText })
  const canMatchNow = isPlanReadyForRequestedRecommendations(planPatch as Partial<Plan>, { conversationText })
  const shouldTransitionToMatch =
    isRequestedRecommendation ||
    (coreFieldsReady && !question) ||
    (!archetypeQuestion && !missingCoreQuestion && canMatchNow)
  const finalQuestion = shouldTransitionToMatch ? null : question
  const isReady = shouldTransitionToMatch
  const transitionPhrase = buildPublicTransitionPhrase(planPatch)

  return {
    content: finalQuestion
      ? `${reflection} ${finalQuestion}`
      : isReady
        ? `${reflection} ${transitionPhrase}`
        : reflection,
    message_type: isReady ? 'recommendation' : 'text',
    metadata: {
      agent_name: 'intake',
      agent_mode: 'openai',
      agent_output: output,
      archetype_question: finalQuestion ? archetypeQuestion : null,
      recommendation_request: isRequestedRecommendation,
      transition_to_match: isReady,
    },
  }
}

function buildPublicTransitionPhrase(planPatch: Record<string, unknown>): string {
  const area = readString(planPatch.neighborhood) ?? 'your target area'
  const eventType = readString(planPatch.event_type)?.toLowerCase() ?? 'event'
  const guestCount = readNumber(planPatch.guest_count)
  const guestText = typeof guestCount === 'number' && guestCount > 0
    ? ` for ${guestCount.toLocaleString()} guests`
    : ''
  return `I have enough to start pulling ${area} options${guestText} for this ${eventType}. Venue and vendor recommendations coming up.`
}

function computePublicCanMatchNow(
  planPatch: Record<string, unknown>,
  conversationText: string,
  archetype: EventArchetypeConfig | null
): boolean {
  if (!isPlanReadyForRequestedRecommendations(planPatch as Partial<Plan>, { conversationText })) return false
  if (!archetype) return true

  const priority = buildArchetypeQuestionPriority({
    archetype,
    plan: planPatch as Partial<Plan>,
    conversationText,
  })
  if (priority.critical_missing.length > 0) return false
  if (archetype.matching_fields.high_signal.length === 0) return true

  return priority.high_signal_missing.length < archetype.matching_fields.high_signal.length
}

function mergeArchetypeAnswerMetadata(
  planPatch: Record<string, unknown>,
  userMessage: string
): Record<string, unknown> {
  const metadata = mergeAnsweredArchetypeQuestionMetadata(planPatch.metadata, {
    eventType: readString(planPatch.event_type),
    plan: planPatch as Partial<Plan>,
    conversationText: userMessage,
    userMessage,
  })

  if (metadata === planPatch.metadata) return planPatch

  return mergePublicPlanPatch(planPatch, {
    metadata: toPlanMetadata(metadata),
  })
}

function attachPendingArchetypeQuestion(
  planPatch: Record<string, unknown>,
  agentDraft: PublicIntakeAgentDraft
): Record<string, unknown> {
  const metadata = { ...(readRecord(planPatch.metadata) ?? {}) }
  const archetypeQuestion = readRecord(agentDraft.metadata.archetype_question)

  if (archetypeQuestion) {
    metadata[PENDING_ARCHETYPE_QUESTION_METADATA_KEY] = {
      id: readString(archetypeQuestion.id),
      label: readString(archetypeQuestion.label),
      prompt: readString(archetypeQuestion.prompt),
    }
  } else {
    delete metadata[PENDING_ARCHETYPE_QUESTION_METADATA_KEY]
  }

  return mergePublicPlanPatch(planPatch, {
    metadata: toPlanMetadata(metadata),
  })
}

function pickPublicUnansweredAgentQuestion(
  output: IntakeAgentOutput,
  planPatch: Record<string, unknown>,
  conversationText: string,
  candidateQuestions: Array<string | null | undefined>
): string | null {
  const eventType = buildPublicArchetypeSearchText(output, planPatch)
  const seen = new Set<string>()

  for (const candidate of candidateQuestions) {
    const question = sanitizeIntakeQuestionCandidate(candidate)
    if (!question) continue
    const normalizedQuestion = question.toLowerCase()
    if (seen.has(normalizedQuestion)) continue
    seen.add(normalizedQuestion)

    const answeredQuestion = findAnsweredArchetypeQuestionForPrompt({
      eventType,
      plan: planPatch as Partial<Plan>,
      conversationText,
      prompt: question,
    })

    if (!answeredQuestion) return question
  }

  return null
}

function buildPublicMissingCoreQuestion(output: IntakeAgentOutput, planPatch: Record<string, unknown>): string | null {
  const eventPlan = output.updated_event_plan
  const extracted = output.extracted_fields
  const eventType = readString(planPatch.event_type) ?? extracted.event_type ?? eventPlan.venue_type ?? eventPlan.event_name
  const headcount =
    readNumber(planPatch.guest_count) ??
    extracted.guest_count ??
    eventPlan.expected_attendance ??
    eventPlan.headcount_max ??
    eventPlan.headcount_min
  const area = readString(planPatch.neighborhood) ?? extracted.neighborhood ?? output.neighborhood ?? eventPlan.city
  const date =
    readString(planPatch.date_window_start) ??
    readString(planPatch.date_window_end) ??
    extracted.date_window_start ??
    extracted.date_window_end ??
    eventPlan.event_date
  if (!eventType) return 'What kind of event is this closest to: dinner, mixer, workshop, party, or something else?'
  if (!headcount) return 'How many people are you planning for?'
  if (!area) return 'What neighborhood or city should I search in?'
  if (!date) return 'What date or date window are you aiming for?'

  return null
}

function buildPublicPlanAnswerHints(planPatch: Record<string, unknown>): Array<string | null> {
  return [
    readString(planPatch.event_type),
    readString(planPatch.ticketing_model),
    readString(planPatch.food_responsibility),
    readString(planPatch.venue_terms),
    readString(planPatch.agent_action),
  ]
}

function buildPublicArchetypeSearchText(output: IntakeAgentOutput, planPatch: Record<string, unknown>): string | null {
  const value = [
    readString(planPatch.event_type),
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

function buildPlanPatchFromIntakeOutput(
  output: IntakeAgentOutput,
  currentPlan: Record<string, unknown>,
  userMessage: string
): Partial<Plan> {
  const eventPlan = output.updated_event_plan
  const extracted = output.extracted_fields
  const patch: Partial<Plan> = {}
  const shouldIgnoreBudget = hasUnknownBudgetSignal(userMessage)

  if (eventPlan.event_name) patch.title = eventPlan.event_name
  const eventTypeDecision = decideEventTypeMutation({
    currentEventType: readString(currentPlan.event_type),
    currentMetadata: currentPlan.metadata,
    proposedEventType: resolveEventTypeLabel(extracted.event_type ?? eventPlan.venue_type ?? null, userMessage),
    userMessage,
    source: 'explicit_user_reclassification',
  })
  if (eventTypeDecision.shouldApply && eventTypeDecision.eventType) {
    patch.event_type = eventTypeDecision.eventType
    patch.metadata = toPlanMetadata(mergeArchetypeDefaultFillMetadata({
      ...(readRecord(patch.metadata) ?? {}),
      ...(eventTypeDecision.lock ? { [ARCHETYPE_LOCK_METADATA_KEY]: eventTypeDecision.lock } : {}),
    }, eventTypeDecision.lock))
  }

  const guestCount = extracted.guest_count ?? eventPlan.expected_attendance ?? eventPlan.headcount_max ?? eventPlan.headcount_min
  if (typeof guestCount === 'number') patch.guest_count = guestCount

  if (!shouldIgnoreBudget && typeof extracted.budget_cap_cents === 'number') {
    patch.budget_cap_cents = extracted.budget_cap_cents
  } else if (!shouldIgnoreBudget && typeof eventPlan.budget === 'number') {
    patch.budget_cap_cents = normalizePlanningMoneyToCents(eventPlan.budget)
  }

  if (typeof extracted.profit_goal_cents === 'number') {
    patch.profit_goal_cents = extracted.profit_goal_cents
  } else if (typeof eventPlan.profit_goal === 'number') {
    patch.profit_goal_cents = normalizePlanningMoneyToCents(eventPlan.profit_goal)
  }

  const neighborhood = extracted.neighborhood ?? output.neighborhood ?? eventPlan.city
  if (neighborhood) patch.neighborhood = neighborhood

  if (extracted.date_window_start || extracted.date_window_end) {
    patch.date_window_start = extracted.date_window_start
    patch.date_window_end = extracted.date_window_end ?? extracted.date_window_start
  } else if (eventPlan.event_date) {
    patch.date_window_start = eventPlan.event_date
    patch.date_window_end = eventPlan.event_date
  }

  if (typeof extracted.ticketed === 'boolean') {
    patch.ticketed = extracted.ticketed
    patch.ticketing_model = extracted.ticketed ? 'ticketed' : 'rsvp'
  }
  if (eventPlan.monetization_model) {
    patch.ticketing_model = eventPlan.monetization_model
    const monetizationModel = eventPlan.monetization_model.trim().toLowerCase()
    if (monetizationModel.includes('ticket') || monetizationModel.includes('paid')) patch.ticketed = true
    if (
      monetizationModel.includes('free') ||
      monetizationModel.includes('rsvp') ||
      monetizationModel.includes('invite') ||
      monetizationModel.includes('sponsor')
    ) {
      patch.ticketed = false
    }
  }

  if (typeof eventPlan.ticket_price_target === 'number') {
    patch.ticketing_model = patch.ticketing_model ?? 'ticketed'
    patch.ticketed = true
    patch.metadata = toPlanMetadata({
      ...(readRecord(patch.metadata) ?? {}),
      ticket_price_target_cents: normalizeTicketPriceTargetCents(eventPlan.ticket_price_target),
    })
  }
  if (typeof extracted.ticket_price_target === 'number' && extracted.ticket_price_target > 0) {
    patch.ticketing_model = patch.ticketing_model ?? 'ticketed'
    patch.ticketed = true
    patch.metadata = toPlanMetadata({
      ...(readRecord(patch.metadata) ?? {}),
      ticket_price_target_cents: normalizeTicketPriceTargetCents(extracted.ticket_price_target),
    })
  } else if (patch.ticketed === false) {
    patch.metadata = toPlanMetadata({
      ...(readRecord(patch.metadata) ?? {}),
      ticket_price_target_cents: null,
      ticket_price_target: null,
    })
  }

  if (extracted.food_responsibility) patch.food_responsibility = extracted.food_responsibility
  else if (output.food_drink_needs) patch.food_responsibility = output.food_drink_needs
  if (hasEventRequirementSignals(userMessage)) {
    patch.metadata = toPlanMetadata({
      ...mergeEventRequirementSignals(currentPlan.metadata, userMessage),
      ...(readRecord(patch.metadata) ?? {}),
    })
  }
  patch.updated_at = new Date().toISOString()

  return patch
}

function buildEventPlanFromPublicDraft(plan: Record<string, unknown> | null): EventPlan | null {
  if (!plan) return null

  const guestCount = readNumber(plan.guest_count)
  const budgetCapCents = readNumber(plan.budget_cap_cents)
  const profitGoalCents = readNumber(plan.profit_goal_cents)
  const ticketed = readBoolean(plan.ticketed)

  return {
    event_name: readString(plan.title),
    expected_attendance: guestCount,
    city: readString(plan.city) ?? inferCityFromArea(readString(plan.neighborhood)),
    venue_type: readString(plan.event_type),
    budget: budgetCapCents,
    event_date: readString(plan.date_window_start) ?? readString(plan.date_window_end),
    monetization_model: ticketed ? 'ticketed' : readString(plan.ticketing_model),
    headcount_min: guestCount,
    headcount_max: guestCount,
    ticket_price_target: null,
    profit_goal: profitGoalCents,
  }
}

function buildPlanPatchFromIntent(
  intent: Partial<PlanIntent>,
  message: string,
  currentPlan: Record<string, unknown> | null = null
): Partial<Plan> {
  const patch: Partial<Plan> = {}
  if (intent.event_type || intent.raw_event_type) {
    const eventTypeDecision = decideEventTypeMutation({
      currentEventType: readString(currentPlan?.event_type),
      currentMetadata: currentPlan?.metadata,
      proposedEventType: resolveEventTypeLabel(intent.event_type ?? intent.raw_event_type ?? null, message),
      userMessage: message,
      source: 'initial_intake',
    })
    if (eventTypeDecision.shouldApply && eventTypeDecision.eventType) {
      patch.event_type = eventTypeDecision.eventType
      patch.metadata = toPlanMetadata(mergeArchetypeDefaultFillMetadata({
        ...(eventTypeDecision.lock ? { [ARCHETYPE_LOCK_METADATA_KEY]: eventTypeDecision.lock } : {}),
      }, eventTypeDecision.lock))
    }
  }
  const contextualGuestCount = readNumber(currentPlan?.guest_count) === null
    ? parseStandaloneGuestCountReply(message)
    : null
  if (typeof intent.guest_count === 'number') patch.guest_count = intent.guest_count
  else if (typeof contextualGuestCount === 'number') patch.guest_count = contextualGuestCount
  if (!hasUnknownBudgetSignal(message) && typeof intent.budget_cap === 'number') patch.budget_cap_cents = intent.budget_cap
  if (intent.neighborhood) patch.neighborhood = intent.neighborhood
  if (intent.date_window_start) patch.date_window_start = intent.date_window_start
  if (intent.date_window_end) patch.date_window_end = intent.date_window_end
  if (typeof intent.ticketed === 'boolean') {
    patch.ticketed = intent.ticketed
    patch.ticketing_model = intent.ticketed ? 'ticketed' : 'rsvp'
    if (!intent.ticketed) {
      patch.metadata = toPlanMetadata({
        ticket_price_target_cents: null,
        ticket_price_target: null,
      })
    }
  }
  if (typeof intent.profit_goal === 'number') patch.profit_goal_cents = intent.profit_goal
  if (intent.food_responsibility) patch.food_responsibility = intent.food_responsibility
  if (hasEventRequirementSignals(message)) {
    patch.metadata = toPlanMetadata({
      ...mergeEventRequirementSignals(currentPlan?.metadata, message),
      ...(readRecord(patch.metadata) ?? {}),
    })
  }
  patch.updated_at = new Date().toISOString()
  return patch
}

function resolveEventTypeLabel(candidate: string | null, message: string): string | null {
  const resolvedArchetype = resolveArchetypeContext(message)
  if (resolvedArchetype) return resolvedArchetype.display_name
  return candidate
}

function toPlanMetadata(value: Record<string, unknown>): Plan['metadata'] {
  return value as Plan['metadata']
}

function mergeArchetypeDefaultFillMetadata(
  metadata: Record<string, unknown>,
  eventArchetypeLock: unknown
): Record<string, unknown> {
  const lock = readRecord(eventArchetypeLock)
  const archetype = getArchetypeByKey(readString(lock?.key))
  if (!archetype) return metadata

  const currentDefaultFills = readRecord(metadata.archetype_default_fills) ?? {}
  const nextDefaultFills = { ...currentDefaultFills }
  let changed = false

  for (const [field, value] of Object.entries(archetype.default_fills)) {
    if (value === undefined || value === null) continue
    if (nextDefaultFills[field] !== undefined && nextDefaultFills[field] !== null) continue
    nextDefaultFills[field] = value
    changed = true
  }

  return changed
    ? { ...metadata, archetype_default_fills: nextDefaultFills }
    : metadata
}

function isGenericEventType(value: string) {
  return /^(event|party|gathering|meetup|social|experience)$/i.test(value.trim())
}

function mergePublicPlanPatch(
  currentPlan: Record<string, unknown> | null,
  patch: Partial<Plan>
): Record<string, unknown> {
  const currentMetadata = readRecord(currentPlan?.metadata) ?? {}
  const patchMetadata = readRecord(patch.metadata)
  return {
    ...(currentPlan ?? {}),
    ...patch,
    metadata: patchMetadata
      ? {
          ...currentMetadata,
          ...patchMetadata,
        }
      : currentPlan?.metadata,
  }
}

function normalizePlanningMoneyToCents(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value < 10000 ? value * 100 : value)
}

function normalizeTicketPriceTargetCents(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value < 1000 ? value * 100 : value)
}

function isQuestionAnsweredByPatch(question: string, planPatch: Record<string, unknown>): boolean {
  const normalized = question.toLowerCase()
  if (/\b(date|when|day|week|month|window)\b/.test(normalized)) {
    return Boolean(planPatch.date_window_start || planPatch.date_window_end)
  }
  if (/\b(city|where|neighborhood|area|district)\b/.test(normalized)) {
    return Boolean(planPatch.neighborhood)
  }
  if (/\b(people|headcount|guest|attendance|capacity)\b/.test(normalized)) {
    return Boolean(planPatch.guest_count)
  }
  if (/\b(ticket|rsvp|invite|free|paid|platform)\b/.test(normalized)) {
    return typeof planPatch.ticketed === 'boolean' || Boolean(planPatch.ticketing_model)
  }
  if (/\b(food|drink|bar|catering|snack)\b/.test(normalized)) {
    return Boolean(planPatch.food_responsibility)
  }
  return false
}

function isOptionalBudgetQuestion(question: string): boolean {
  const normalized = question.replace(/[_-]+/g, ' ')
  return /\b(budget|cap|spend|price range|cost range)\b/i.test(normalized)
}

function getNextPublicFallbackQuestion(planPatch: Record<string, unknown>): string | null {
  if (!readString(planPatch.event_type)) return 'What kind of event are you hosting?'
  if (!readNumber(planPatch.guest_count)) return 'How many people are you planning for?'
  if (!readString(planPatch.neighborhood)) return 'Which Bay Area neighborhood or city should I search around?'
  if (!readString(planPatch.date_window_start) && !readString(planPatch.date_window_end)) return 'What date or date window should I plan around?'
  if (typeof planPatch.ticketed !== 'boolean' && !readString(planPatch.ticketing_model)) return 'Is this RSVP/free, ticketed, or invite-only?'
  if (!readString(planPatch.food_responsibility)) return "Who's handling food and drinks?"
  return null
}

function hasPublicCoreFields(planPatch: Record<string, unknown>, output: IntakeAgentOutput): boolean {
  const eventPlan = output.updated_event_plan
  return Boolean(
    (planPatch.event_type || output.extracted_fields.event_type || eventPlan.event_name || eventPlan.venue_type) &&
      (planPatch.guest_count || output.extracted_fields.guest_count || eventPlan.expected_attendance) &&
      (planPatch.neighborhood || output.extracted_fields.neighborhood || output.neighborhood || eventPlan.city) &&
      (planPatch.date_window_start || planPatch.date_window_end || output.extracted_fields.date_window_start || eventPlan.event_date)
  )
}

function inferCityFromArea(area: string | null): string | null {
  if (!area) return null
  const normalized = area.trim().toLowerCase()
  const sfAreas = new Set([
    'soma',
    'mission',
    'hayes valley',
    'castro',
    'marina',
    'fidi',
    'financial district',
    'nopa',
    'tenderloin',
    'dogpatch',
    'potrero',
    'nob hill',
    'north beach',
    'downtown sf',
    'san francisco',
    'sf',
  ])
  if (sfAreas.has(normalized)) return 'San Francisco'
  if (normalized.includes('oakland')) return 'Oakland'
  if (normalized.includes('berkeley')) return 'Berkeley'
  if (normalized.includes('napa')) return 'Napa'
  return area
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

function readBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}

function getIpAddress(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}
