import type { Json, Plan, Recommendation } from '@/lib/types'

export type TemplateRow = {
  id: string
  name: string
  source_event_id: string | null
  event_type: string | null
  target_audience: string | null
  guest_count_min: number | null
  guest_count_max: number | null
  budget_model: Json
  ticket_price_model: Json
  profit_assumptions: Json
  kickback_model: Json
  run_of_show: Json
  shopping_list: Json
  email_copy: string | null
  export_copy: string | null
  approval_checklist: Json
  historical_performance: Json
  created_at: string
}

export type TemplateSourceEventRow = {
  id: string
  plan_id: string | null
  status: string
  ends_at: string | null
  outcome_summary: Json
  outcome_recorded_at: string | null
}

type PlannerTemplate = {
  id: string
  name: string
  description: string | null
  source_event_id: string | null
  snapshot: Json
  created_at: string
}

type AttendanceSummaryInput = {
  archetype_key: string | null
  sample_size: number
  avg_tickets_sold: number
  p75_tickets_sold: number
  p95_tickets_sold: number
  last_event_at: string | null
  confidence: 'low' | 'medium' | 'high'
} | null

export function isEligibleTemplateSourceEvent(
  event: TemplateSourceEventRow | null,
  plan: Plan,
  nowMs = Date.now()
) {
  if (!event || !plan.materialized_event_id) return false
  if (event.id !== plan.materialized_event_id || event.plan_id !== plan.id) return false
  if (event.status !== 'completed' || !event.outcome_recorded_at) return false

  const endsAtMs = Date.parse(event.ends_at ?? '')
  if (!Number.isFinite(endsAtMs) || endsAtMs > nowMs) return false

  const outcomeSummary = readRecord(event.outcome_summary)
  return Boolean(outcomeSummary && Object.keys(outcomeSummary).length > 0)
}

export function normalizeTemplateRow(row: TemplateRow): PlannerTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.target_audience ?? row.event_type ?? row.export_copy,
    source_event_id: row.source_event_id ?? null,
    snapshot: {
      source_event_id: row.source_event_id ?? null,
      event_type: row.event_type,
      target_audience: row.target_audience,
      guest_count_min: row.guest_count_min,
      guest_count_max: row.guest_count_max,
      budget_model: row.budget_model,
      ticket_price_model: row.ticket_price_model,
      profit_assumptions: row.profit_assumptions,
      chi_model: row.kickback_model,
      kickback_model: row.kickback_model,
      run_of_show: row.run_of_show,
      shopping_list: row.shopping_list,
      email_copy: row.email_copy,
      approval_checklist: row.approval_checklist,
      historical_performance: row.historical_performance,
    } as Json,
    created_at: row.created_at,
  }
}

export function buildTemplateInsert(input: {
  userId: string
  plan: Plan
  recommendations: Recommendation[]
  requestedName?: string
  attendanceSummary: AttendanceSummaryInput
  sourceEvent: TemplateSourceEventRow
}) {
  const metadata = readRecord(input.plan.metadata)
  const ticketPriceTargetCents = readNumber(metadata?.ticket_price_target_cents) ?? readNumber(metadata?.ticket_price_target)
  const guestCount = input.plan.guest_count
  const recommendations = input.recommendations.map((recommendation) => ({
    id: recommendation.id,
    type: recommendation.type,
    reference_id: recommendation.reference_id,
    external_name: recommendation.external_name,
    price_cents: recommendation.price_cents,
    rank: recommendation.rank,
    is_best_fit: recommendation.is_best_fit,
    metadata: recommendation.metadata,
  }))
  const economicsRecommendation = input.recommendations.find((recommendation) => {
    const metadata = readRecord(recommendation.metadata)
    return readString(metadata?.recommendation_type) === 'economics'
  })
  const economicsMetadata = readRecord(economicsRecommendation?.metadata)

  return {
    user_id: input.userId,
    source_plan_id: input.plan.id,
    source_event_id: input.plan.materialized_event_id ?? null,
    name: input.requestedName ?? buildDefaultTemplateName(input.plan),
    event_type: input.plan.event_type,
    target_audience: input.plan.neighborhood,
    guest_count_min: typeof guestCount === 'number' ? Math.max(0, Math.floor(guestCount * 0.8)) : null,
    guest_count_max: typeof guestCount === 'number' ? Math.ceil(guestCount * 1.2) : null,
    budget_model: {
      budget_cap_cents: input.plan.budget_cap_cents,
      venue_terms: input.plan.venue_terms,
      food_responsibility: input.plan.food_responsibility,
      source: 'planner_plan',
      accuracy: 'estimate_until_partner_quotes_confirmed',
    } as Json,
    ticket_price_model: {
      ticketed: input.plan.ticketed,
      ticketing_model: input.plan.ticketing_model,
      ticket_price_target_cents: ticketPriceTargetCents,
      source: 'planner_plan',
    } as Json,
    profit_assumptions: {
      profit_goal_cents: input.plan.profit_goal_cents,
      latest_economics: economicsMetadata,
      accuracy: 'estimate_until_partner_quotes_confirmed',
    } as Json,
    kickback_model: {
      venue_terms: input.plan.venue_terms,
      food_responsibility: input.plan.food_responsibility,
    } as Json,
    run_of_show: (readRecord(metadata?.run_of_show) ?? readRecord(metadata?.timeline) ?? {}) as Json,
    shopping_list: {
      recommendations,
      selected_venue: recommendations.find((recommendation) => recommendation.type === 'venue' && recommendation.is_best_fit) ?? null,
      selected_vendors: recommendations.filter((recommendation) => recommendation.type === 'vendor'),
    } as Json,
    email_copy: null,
    export_copy: buildTemplateExportCopy(input.plan),
    approval_checklist: {
      required_before_execution: [
        'Refresh recommendations for the new date and headcount.',
        'Confirm venue/vendor quotes.',
        'Approve outreach before any partner is contacted.',
        'Authorize deposits only after partner terms are confirmed.',
      ],
    } as Json,
    historical_performance: {
      ...buildHistoricalPerformance(input.attendanceSummary),
      source_event_id: input.sourceEvent.id,
      outcome_recorded_at: input.sourceEvent.outcome_recorded_at,
      outcome_summary: input.sourceEvent.outcome_summary,
      source: input.attendanceSummary && input.attendanceSummary.sample_size > 0
        ? 'canonical_event_outcome_and_builder_history'
        : 'canonical_event_outcome',
    } as Json,
  }
}

function buildDefaultTemplateName(plan: Plan): string {
  const base = plan.title || plan.event_type || 'Event plan'
  return `${base} template`
}

function buildTemplateExportCopy(plan: Plan): string {
  const parts = [
    plan.event_type,
    typeof plan.guest_count === 'number' ? `${plan.guest_count} guests` : null,
    plan.neighborhood,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' · ') : 'Reusable planner template'
}

function buildHistoricalPerformance(summary: AttendanceSummaryInput): Record<string, unknown> {
  if (!summary || summary.sample_size === 0) return {}
  return {
    source: 'builder_history_aggregate',
    archetype_key: summary.archetype_key,
    sample_size: summary.sample_size,
    confidence: summary.confidence,
    avg_tickets_sold: summary.avg_tickets_sold,
    p75_tickets_sold: summary.p75_tickets_sold,
    p95_tickets_sold: summary.p95_tickets_sold,
    last_event_at: summary.last_event_at,
  }
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
