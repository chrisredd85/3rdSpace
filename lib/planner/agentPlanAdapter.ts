import type { EventPlan } from '@/lib/ai/types'
import type { Plan } from '@/lib/types'

export function buildEventPlanFromPlannerPlan(plan: Plan): EventPlan {
  const expectedAttendance = plan.guest_count
  const ticketPriceTarget = estimateTicketPriceTargetCents({
    ticketed: plan.ticketed,
    budgetCents: plan.budget_cap_cents,
    profitGoalCents: plan.profit_goal_cents,
    expectedAttendance,
  })

  return {
    event_name: plan.title || 'Untitled event plan',
    expected_attendance: expectedAttendance,
    city: inferCity(plan.neighborhood),
    venue_type: plan.event_type ?? null,
    budget: plan.budget_cap_cents,
    event_date: getPlannerPlanEventDate(plan),
    monetization_model: plan.ticketed ? 'ticketed' : normalizeMonetizationModel(plan.ticketing_model),
    headcount_min: expectedAttendance,
    headcount_max: expectedAttendance,
    ticket_price_target: ticketPriceTarget,
    profit_goal: plan.profit_goal_cents,
  }
}

export function getPlannerPlanEventDate(plan: Plan): string | null {
  return plan.date_window_start ?? plan.date_window_end
}

export function inferCity(value: string | null | undefined): string | null {
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
