export type CommercialModel =
  | 'flat_rental'
  | 'minimum_spend'
  | 'per_head_kickback'
  | 'bar_revenue_share'
  | 'ticket_revenue_share'

export type CommercialRiskLevel = 'low' | 'medium' | 'high'

export interface CommercialPlanInput {
  headcount?: number | null
  guest_count?: number | null
  budget_cents?: number | null
  budget_cap_cents?: number | null
  event_type?: string | null
  ticketing_model?: string | null
  food_responsibility?: string | null
  venue_terms?: string | null
}

export interface CommercialModelComparison {
  model: CommercialModel
  label: string
  organizer_outlay_cents: number
  expected_profit_cents: number
  venue_upside_cents: number
  score: number
  risk_level: CommercialRiskLevel
  reasoning: string[]
}

export interface CommercialModelRanking {
  recommended: CommercialModelComparison
  compared_models: CommercialModelComparison[]
}

const DEFAULT_PER_HEAD_KICKBACK_CENTS = 800
const DEFAULT_TICKET_REVENUE_SHARE_PCT = 12
const DEFAULT_BAR_REVENUE_SHARE_PCT = 10

/**
 * Ranks the venue commercial models supported by a catalog row.
 */
export function rankVenueCommercialModels(
  plan: CommercialPlanInput,
  venue: Record<string, unknown>,
  fallbackEstimateCents: number
): CommercialModelRanking {
  const models = inferSupportedCommercialModels(venue, fallbackEstimateCents)
  const preferredModels = filterPreferredCommercialModels(models, plan.venue_terms)
  const candidateModels = preferredModels.length > 0 ? preferredModels : models
  const comparisons = candidateModels.map((model) => scoreCommercialModel(plan, venue, model, fallbackEstimateCents))
    .sort((a, b) => b.score - a.score || a.organizer_outlay_cents - b.organizer_outlay_cents)

  return {
    recommended: comparisons[0],
    compared_models: comparisons,
  }
}

export function formatCommercialModelLabel(model: CommercialModel): string {
  if (model === 'flat_rental') return 'Flat rental'
  if (model === 'minimum_spend') return 'Minimum spend'
  if (model === 'per_head_kickback') return 'Per-head kickback'
  if (model === 'bar_revenue_share') return 'Bar revenue share'
  return 'Ticket revenue share'
}

function scoreCommercialModel(
  plan: CommercialPlanInput,
  venue: Record<string, unknown>,
  model: CommercialModel,
  fallbackEstimateCents: number
): CommercialModelComparison {
  const headcount = readNumber(plan.headcount ?? plan.guest_count) ?? 0
  const budgetCents = readNumber(plan.budget_cents ?? plan.budget_cap_cents) ?? 0
  const venueBudgetCents = budgetCents > 0 ? Math.round(budgetCents * 0.55) : 0
  const paidAttendance = headcount > 0 ? Math.max(1, Math.round(headcount * 0.87)) : 0
  const ticketPriceCents = estimateTicketPriceCents(plan)
  const ticketRevenueCents = isTicketed(plan) ? paidAttendance * ticketPriceCents : 0
  const barRevenueCents = hasBarRevenueSignal(plan, venue) ? paidAttendance * 2600 : 0
  const outlayCents = estimateOrganizerOutlayCents(model, venue, fallbackEstimateCents, headcount, ticketRevenueCents, barRevenueCents)
  const venueUpsideCents = estimateVenueUpsideCents(model, outlayCents, venue, fallbackEstimateCents, ticketRevenueCents, barRevenueCents)
  const expectedProfitCents = ticketRevenueCents - outlayCents
  const organizerProfitScore = scoreOrganizerProfit(expectedProfitCents, outlayCents, venueBudgetCents)
  const venueIncentiveScore = scoreVenueIncentive(model, venueUpsideCents, fallbackEstimateCents)
  const eventFitScore = scoreEventFit(model, plan)
  const budgetSafetyScore = scoreBudgetSafety(outlayCents, venueBudgetCents)
  const simplicityScore = scoreSimplicity(model)
  const score = Math.round(organizerProfitScore + venueIncentiveScore + eventFitScore + budgetSafetyScore + simplicityScore)

  return {
    model,
    label: formatCommercialModelLabel(model),
    organizer_outlay_cents: outlayCents,
    expected_profit_cents: expectedProfitCents,
    venue_upside_cents: venueUpsideCents,
    score: clamp(score, 0, 100),
    risk_level: getRiskLevel(model, outlayCents, venueBudgetCents),
    reasoning: buildCommercialReasoning(model, plan, outlayCents, expectedProfitCents, venueUpsideCents, venueBudgetCents),
  }
}

function inferSupportedCommercialModels(venue: Record<string, unknown>, fallbackEstimateCents: number): CommercialModel[] {
  const models = new Set<CommercialModel>()
  const pricingModel = normalizeText(readString(venue.pricing_model) ?? '')
  const autoApprove = readRecord(venue.auto_approve_conditions)

  if (
    fallbackEstimateCents > 0 ||
    pricingModel.includes('flat') ||
    pricingModel.includes('hourly') ||
    readNumber(venue.hourly_rate) !== null ||
    readNumber(venue.daily_rate) !== null
  ) {
    models.add('flat_rental')
  }
  if (
    pricingModel.includes('minimum') ||
    readNumber(venue.minimum_spend_cents ?? venue.minimum_spend ?? autoApprove?.minimum_spend_cents) !== null
  ) {
    models.add('minimum_spend')
  }
  if (
    (readNumber(venue.per_head_kickback_cents ?? venue.per_head_kickback_amount ?? venue.per_head_kickback) ?? 0) > 0
  ) {
    models.add('per_head_kickback')
  }
  if (
    venue.bar_rev_share_enabled === true ||
    venue.bar_revenue_share_enabled === true ||
    (readNumber(venue.bar_rev_share_pct ?? venue.bar_revenue_share_pct ?? venue.bar_revenue_percentage) ?? 0) > 0
  ) {
    models.add('bar_revenue_share')
  }
  if (
    venue.ticket_sales_share_enabled === true ||
    (readNumber(venue.ticket_sales_share_pct ?? venue.ticket_sales_share_percent) ?? 0) > 0
  ) {
    models.add('ticket_revenue_share')
  }

  if (models.size === 0) models.add('flat_rental')
  return [...models]
}

function filterPreferredCommercialModels(models: CommercialModel[], venueTerms: string | null | undefined): CommercialModel[] {
  if (!venueTerms) return []
  const normalized = normalizeText(venueTerms)
  if (/\b(recommend|compare|flexible|open|any|best model)\b/.test(normalized)) return []

  return models.filter((model) => {
    if (model === 'flat_rental') return /\b(flat|rental|hourly|buyout|room fee)\b/.test(normalized)
    if (model === 'minimum_spend') return /\b(min|minimum spend|f b minimum)\b/.test(normalized)
    if (model === 'per_head_kickback') return /\b(per head|kickback|attendee)\b/.test(normalized)
    if (model === 'bar_revenue_share') return /\b(bar|drink|beverage)\b/.test(normalized) && /\b(share|rev|revenue|split)\b/.test(normalized)
    if (model === 'ticket_revenue_share') return /\b(ticket|door)\b/.test(normalized) && /\b(share|rev|revenue|split)\b/.test(normalized)
    return false
  })
}

function estimateOrganizerOutlayCents(
  model: CommercialModel,
  venue: Record<string, unknown>,
  fallbackEstimateCents: number,
  headcount: number,
  ticketRevenueCents: number,
  barRevenueCents: number
) {
  if (model === 'flat_rental') return fallbackEstimateCents
  if (model === 'minimum_spend') return readMinimumSpendCents(venue) ?? fallbackEstimateCents
  if (model === 'per_head_kickback') {
    const threshold = readNumber(venue.per_head_kickback_threshold ?? venue.kickback_threshold) ?? 100
    const amount = readNumber(venue.per_head_kickback_cents ?? venue.per_head_kickback_amount ?? venue.per_head_kickback) ?? DEFAULT_PER_HEAD_KICKBACK_CENTS
    return Math.max(0, headcount - threshold) * amount
  }
  if (model === 'bar_revenue_share') {
    const pct = readPercent(venue.bar_rev_share_pct ?? venue.bar_revenue_share_pct ?? venue.bar_revenue_percentage) ?? DEFAULT_BAR_REVENUE_SHARE_PCT
    return Math.round(barRevenueCents * (pct / 100))
  }

  const pct = readPercent(venue.ticket_sales_share_pct ?? venue.ticket_sales_share_percent) ?? DEFAULT_TICKET_REVENUE_SHARE_PCT
  return Math.round(ticketRevenueCents * (pct / 100))
}

function estimateVenueUpsideCents(
  model: CommercialModel,
  outlayCents: number,
  venue: Record<string, unknown>,
  fallbackEstimateCents: number,
  ticketRevenueCents: number,
  barRevenueCents: number
) {
  if (model === 'flat_rental') return outlayCents
  if (model === 'minimum_spend') return Math.max(outlayCents, readMinimumSpendCents(venue) ?? 0)
  if (model === 'bar_revenue_share') return Math.max(outlayCents, Math.round(barRevenueCents * 0.2))
  if (model === 'ticket_revenue_share') return Math.max(outlayCents, Math.round(ticketRevenueCents * 0.12))
  return Math.max(outlayCents, Math.round(fallbackEstimateCents * 0.15))
}

function readMinimumSpendCents(venue: Record<string, unknown>): number | null {
  const autoApprove = readRecord(venue.auto_approve_conditions)
  return readNumber(venue.minimum_spend_cents ?? venue.minimum_spend ?? autoApprove?.minimum_spend_cents)
}

function scoreOrganizerProfit(expectedProfitCents: number, outlayCents: number, venueBudgetCents: number): number {
  if (venueBudgetCents <= 0) return outlayCents <= 0 ? 32 : 22
  const safetyRatio = outlayCents / venueBudgetCents
  const profitBoost = expectedProfitCents > 0 ? 6 : 0
  if (safetyRatio <= 0.35) return 35
  if (safetyRatio <= 0.7) return 29 + profitBoost
  if (safetyRatio <= 1) return 23 + profitBoost
  return clamp(16 - (safetyRatio - 1) * 10 + profitBoost, 5, 22)
}

function scoreVenueIncentive(model: CommercialModel, venueUpsideCents: number, fallbackEstimateCents: number): number {
  const baseline = Math.max(fallbackEstimateCents, 1)
  const upsideRatio = venueUpsideCents / baseline
  const base = model === 'flat_rental' || model === 'minimum_spend' ? 18 : 14
  return clamp(base + upsideRatio * 8, 8, 25)
}

function scoreEventFit(model: CommercialModel, plan: CommercialPlanInput): number {
  const text = normalizeText([plan.event_type, plan.ticketing_model, plan.food_responsibility].filter(Boolean).join(' '))
  if (model === 'bar_revenue_share' && /\b(bar|drink|cocktail|beer|wine|cash bar|guests pay)\b/.test(text)) return 20
  if (model === 'ticket_revenue_share' && /\b(ticket|paid|door|vip|ga|early bird)\b/.test(text)) return 20
  if (model === 'per_head_kickback' && (readNumber(plan.headcount ?? plan.guest_count) ?? 0) >= 90) return 18
  if ((model === 'flat_rental' || model === 'minimum_spend') && /\b(simple|rsvp|free|dinner|private)\b/.test(text)) return 17
  return 12
}

function scoreBudgetSafety(outlayCents: number, venueBudgetCents: number): number {
  if (venueBudgetCents <= 0) return 7
  if (outlayCents <= venueBudgetCents * 0.5) return 10
  if (outlayCents <= venueBudgetCents) return 8
  return 3
}

function scoreSimplicity(model: CommercialModel): number {
  if (model === 'flat_rental') return 10
  if (model === 'minimum_spend') return 9
  if (model === 'per_head_kickback') return 7
  return 5
}

function getRiskLevel(model: CommercialModel, outlayCents: number, venueBudgetCents: number): CommercialRiskLevel {
  if (venueBudgetCents > 0 && outlayCents > venueBudgetCents) return 'high'
  if (model === 'bar_revenue_share' || model === 'ticket_revenue_share') return 'medium'
  return 'low'
}

function buildCommercialReasoning(
  model: CommercialModel,
  plan: CommercialPlanInput,
  outlayCents: number,
  expectedProfitCents: number,
  venueUpsideCents: number,
  venueBudgetCents: number
): string[] {
  const reasons = [
    `${formatCommercialModelLabel(model)} estimated organizer outlay: ${formatCents(outlayCents)}`,
    `Projected venue upside: ${formatCents(venueUpsideCents)}`,
  ]

  if (venueBudgetCents > 0) {
    reasons.push(outlayCents <= venueBudgetCents
      ? `Fits the ${formatCents(venueBudgetCents)} venue allocation`
      : `Above the ${formatCents(venueBudgetCents)} venue allocation`)
  }
  if (isTicketed(plan)) reasons.push(`Projected organizer margin: ${formatCents(expectedProfitCents)}`)
  if (model === 'per_head_kickback') reasons.push('Protects cash before turnout is confirmed')
  if (model === 'bar_revenue_share') reasons.push('Aligns venue upside with drink sales')
  if (model === 'ticket_revenue_share') reasons.push('Can reduce deposit pressure for paid events')

  return reasons.slice(0, 5)
}

function estimateTicketPriceCents(plan: CommercialPlanInput): number {
  const text = normalizeText([plan.event_type, plan.ticketing_model].filter(Boolean).join(' '))
  if (text.includes('dinner')) return 9500
  if (text.includes('retreat')) return 18000
  if (text.includes('conference') || text.includes('summit')) return 15000
  if (text.includes('day party') || text.includes('club')) return 5500
  if (text.includes('workshop') || text.includes('panel')) return 4500
  if (text.includes('fitness') || text.includes('tennis') || text.includes('run')) return 3500
  return 5500
}

function hasBarRevenueSignal(plan: CommercialPlanInput, venue: Record<string, unknown>): boolean {
  const text = normalizeText([
    plan.event_type,
    plan.ticketing_model,
    plan.food_responsibility,
    venue.description,
    venue.venue_type,
    venue.pricing_model,
  ].filter(Boolean).join(' '))

  return /\b(bar|drink|cocktail|beer|wine|alcohol|cash bar|open bar|beverage)\b/.test(text)
}

function isTicketed(plan: CommercialPlanInput): boolean {
  const text = normalizeText(plan.ticketing_model ?? '')
  if (/\b(paid|ticketed|sell tickets|admission|door|vip|ga|early bird)\b/.test(text)) return true
  if (/\b(free|rsvp|invite only|invite-only|no ticket)\b/.test(text)) return false
  return false
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

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,]/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readPercent(value: unknown): number | null {
  const number = readNumber(value)
  if (number === null) return null
  return number > 1 ? number : number * 100
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatCents(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
