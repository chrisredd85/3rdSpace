/**
 * Deterministic state machine for the Agent Planner MVP.
 *
 * Purpose:
 * - Convert the current plan and conversation into the next agent message draft.
 * - Keep the MVP useful without any external LLM calls.
 * - Centralize the field-completion order used by API routes and future UI tests.
 *
 * Key behaviors:
 * - Drafting plans begin in intake, then clarify missing fields in a fixed order.
 * - Once date, headcount, budget, neighborhood, and ticketing intent are known, the
 *   response switches to recommendation mode.
 * - Approved, executing, and complete plans map directly to their execution states.
 */
import { parseEventIntent } from '@/lib/planner/intentParser'
import type {
  AgentPlannerState,
  AgentResponseDraft,
  Json,
  Plan,
  PlanIntent,
  PlanMessage,
} from '@/lib/types'

type PlanReadModel = Pick<
  Plan,
  'status' | 'event_type' | 'guest_count' | 'budget_cap_cents' | 'neighborhood' | 'date_window_start' | 'date_window_end' | 'ticketed'
>

/**
 * Determines the next deterministic Agent Planner reply for a plan conversation.
 *
 * State transitions:
 * - `drafting` + no prior agent reply => `intake`.
 * - `drafting` + missing required planning fields => `clarifying`.
 * - `drafting` or `ready` + complete required fields => `recommending`.
 * - `approved` => `awaiting_approval`.
 * - `executing` => `executing`.
 * - `complete` or `archived` => `complete`.
 *
 * @param plan - Current persisted plan row.
 * @param messages - Existing plan messages, ordered or unordered.
 * @returns Agent message draft ready to insert into `plan_messages`.
 */
export function determineNextResponse(plan: Plan, messages: PlanMessage[]): AgentResponseDraft {
  const sortedMessages = [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const latestUserMessage = [...sortedMessages].reverse().find((message) => message.role === 'user')
  const latestIntent = latestUserMessage ? parseEventIntent(latestUserMessage.content) : {}
  const readModel = mergePlanWithIntent(plan, latestIntent)
  const missingFields = getMissingFields(readModel, sortedMessages, latestIntent)
  const hasPriorAgentReply = sortedMessages.some((message) => message.role === 'agent')
  const state = determineState(plan, missingFields.length, hasPriorAgentReply)

  if (state === 'executing') {
    return {
      message_type: 'status_update',
      content: 'I am executing the approved actions and will keep the audit trail updated as each step completes.',
      metadata: toJson({
        state,
        plan_updates: latestIntent,
        missing_fields: missingFields,
      }),
    }
  }

  if (state === 'awaiting_approval') {
    return {
      message_type: 'approval_request',
      content: 'I found actions that need your confirmation before I can book or pay. Review the approval card before anything is charged.',
      metadata: toJson({
        state,
        plan_updates: latestIntent,
        missing_fields: missingFields,
      }),
    }
  }

  if (state === 'complete') {
    return {
      message_type: 'status_update',
      content: 'This plan is complete. I can still summarize the plan, export details, or turn it into a reusable template.',
      metadata: toJson({
        state,
        plan_updates: latestIntent,
        missing_fields: missingFields,
      }),
    }
  }

  if (missingFields.length > 0) {
    const nextField = missingFields[0]
    const confirmationItems = buildConfirmationItems(readModel, latestIntent)

    return {
      message_type: hasPriorAgentReply ? 'text' : 'confirmation_card',
      content: getClarifyingQuestion(nextField),
      metadata: toJson({
        state,
        plan_updates: latestIntent,
        missing_fields: missingFields,
        confirmation_items: confirmationItems,
      }),
    }
  }

  return {
    message_type: 'recommendation',
    content: 'I have enough to generate venue and vendor recommendations. I will start with the top three venue fits using capacity, budget fit, neighborhood, and AV signals.',
    metadata: toJson({
      state,
      plan_updates: latestIntent,
      missing_fields: [],
      recommendation_type: 'venue',
      next_action: 'generate_recommendations',
    }),
  }
}

function determineState(plan: Plan, missingFieldCount: number, hasPriorAgentReply: boolean): AgentPlannerState {
  if (plan.status === 'approved') return 'awaiting_approval'
  if (plan.status === 'executing') return 'executing'
  if (plan.status === 'complete' || plan.status === 'archived') return 'complete'
  if (missingFieldCount === 0) return 'recommending'
  return hasPriorAgentReply ? 'clarifying' : 'intake'
}

function mergePlanWithIntent(plan: Plan, intent: Partial<PlanIntent>): PlanReadModel {
  return {
    status: plan.status,
    event_type: intent.event_type ?? intent.raw_event_type ?? plan.event_type,
    guest_count: intent.guest_count ?? plan.guest_count,
    budget_cap_cents: intent.budget_cap ?? plan.budget_cap_cents,
    neighborhood: intent.neighborhood ?? plan.neighborhood,
    date_window_start: intent.date_window_start ?? plan.date_window_start,
    date_window_end: intent.date_window_end ?? plan.date_window_end,
    ticketed: intent.ticketed ?? plan.ticketed,
  }
}

function getMissingFields(
  plan: PlanReadModel,
  messages: PlanMessage[],
  latestIntent: Partial<PlanIntent>
): string[] {
  const missing: string[] = []

  if (!plan.date_window_start || !plan.date_window_end) missing.push('date_window')
  if (!plan.guest_count) missing.push('guest_count')
  if (!plan.budget_cap_cents) missing.push('budget_cap')
  if (!plan.neighborhood) missing.push('neighborhood')
  if (!hasTicketingSignal(messages, latestIntent)) missing.push('ticketed')

  return missing
}

function hasTicketingSignal(messages: PlanMessage[], latestIntent: Partial<PlanIntent>): boolean {
  if (typeof latestIntent.ticketed === 'boolean') return true

  return messages.some((message) => {
    const metadata = message.metadata
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
    const intent = metadata.intent
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return false
    return typeof intent.ticketed === 'boolean'
  })
}

function getClarifyingQuestion(field: string): string {
  switch (field) {
    case 'date_window':
      return 'What date or date window should I plan around? A phrase like "late October" or "Oct 17" works.'
    case 'guest_count':
      return 'How many people should I plan for?'
    case 'budget_cap':
      return 'What is the all-in budget cap before ticket revenue or sponsor offsets?'
    case 'neighborhood':
      return 'Which Bay Area neighborhood or district should I prioritize?'
    case 'ticketed':
      return 'Should this be ticketed, RSVP-only, invite-only, or free?'
    default:
      return 'What else should I know before I build the plan?'
  }
}

function buildConfirmationItems(plan: PlanReadModel, intent: Partial<PlanIntent>) {
  return [
    {
      label: 'Experience',
      value: plan.event_type ?? 'Need event type',
      confirmed: Boolean(plan.event_type),
    },
    {
      label: 'Headcount',
      value: plan.guest_count ? `${plan.guest_count} people` : 'Need headcount',
      confirmed: Boolean(plan.guest_count),
    },
    {
      label: 'Budget cap',
      value: plan.budget_cap_cents ? formatCents(plan.budget_cap_cents) : 'Need budget',
      confirmed: Boolean(plan.budget_cap_cents),
    },
    {
      label: 'Date window',
      value:
        plan.date_window_start && plan.date_window_end
          ? `${plan.date_window_start} to ${plan.date_window_end}`
          : intent.date_hint ?? 'Need date',
      confirmed: Boolean(plan.date_window_start && plan.date_window_end),
    },
  ]
}

function formatCents(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}

function toJson(value: Record<string, unknown>): Json {
  return value as Json
}
