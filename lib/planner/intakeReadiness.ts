import type { IntakeAgentOutput } from '@/lib/ai/agents/intakeAgent'
import type { Plan } from '@/lib/types'

export function isIntakeReadyForRecommendations(output: IntakeAgentOutput, plan: Plan): boolean {
  if (output.missing_questions.length === 0) return true

  const eventPlan = output.updated_event_plan
  const extracted = output.extracted_fields
  const eventType = plan.event_type ?? extracted.event_type ?? eventPlan.venue_type ?? eventPlan.event_name
  const headcount =
    plan.guest_count ??
    extracted.guest_count ??
    eventPlan.expected_attendance ??
    eventPlan.headcount_max ??
    eventPlan.headcount_min
  const budget = plan.budget_cap_cents ?? extracted.budget_cap_cents ?? eventPlan.budget
  const area = plan.neighborhood ?? extracted.neighborhood ?? output.neighborhood ?? eventPlan.city
  const date =
    plan.date_window_start ??
    plan.date_window_end ??
    extracted.date_window_start ??
    extracted.date_window_end ??
    eventPlan.event_date

  return Boolean(eventType && headcount && budget && area && date)
}
