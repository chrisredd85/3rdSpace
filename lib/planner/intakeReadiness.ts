import type { IntakeAgentOutput } from '@/lib/ai/agents/intakeAgent'
import {
  getNextArchetypeIntakeQuestion,
  hasAnsweredRequiredArchetypeQuestions,
} from '@/lib/planner/archetypes'
import type { Plan } from '@/lib/types'

export function isIntakeReadyForRecommendations(
  output: IntakeAgentOutput,
  plan: Plan,
  options: { conversationText?: string } = {}
): boolean {
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
  const hasCoreFields = Boolean(eventType && headcount && area && date)
  if (!hasCoreFields) return false

  const conversationText = options.conversationText?.trim()
  if (!conversationText) return output.missing_questions.length === 0

  return hasAnsweredRequiredArchetypeQuestions({
    eventType,
    plan,
    conversationText,
  })
}

export function isRecommendationRequest(message: string): boolean {
  return /\b(where should i book|where can i book|where should we book|where can we book|where should i host|where can i host|book it|booking options|show me (the )?(options|venues|places|spots)|venue options|recommend(?:ed|ations?)?|find (me )?(a )?(venue|place|spot)|pull (venues|options|recommendations)|start matching|try again|retry|run (the )?search( again)?|search again|re.?run)\b/i.test(message)
}

export function isPlanReadyForRequestedRecommendations(
  plan: Partial<Plan>,
  options: { conversationText?: string } = {}
): boolean {
  const eventType = readString(plan.event_type)
  const headcount = readNumber(plan.guest_count)
  const area = readString(plan.neighborhood)
  const date = readString(plan.date_window_start) ?? readString(plan.date_window_end)

  if (!eventType || !headcount || !area || !date) return false

  const conversationText = options.conversationText?.trim()
  if (!conversationText) return true

  const nextArchetypeQuestion = getNextArchetypeIntakeQuestion({
    eventType,
    plan,
    conversationText,
  })

  return nextArchetypeQuestion === null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}
