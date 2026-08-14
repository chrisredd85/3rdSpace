import { readCents } from '@/lib/money'
import { estimateVenueRentalCents } from '@/lib/venues/venueRateUnits'

export interface VenueEstimatePlanSummary {
  guest_count?: number | null
  headcount?: number | null
  expected_attendance?: number | null
  duration_hours?: number | null
}

type VenueCommercialModel =
  | 'venue_rental'
  | 'minimum_spend'
  | 'per_head_chi'
  | 'bar_chi'
  | 'ticket_chi'
  | 'unknown'

/**
 * Returns the estimate that should occupy recommendation.price_cents.
 *
 * Positive values are organizer outlay. Negative values are projected CHI
 * payout back to the organizer, so downstream profit math can add it back.
 */
export function estimateVenueRecommendationPriceCents(
  venue: Record<string, unknown>,
  plan: VenueEstimatePlanSummary = {}
): number | null {
  const model = inferVenueCommercialModel(venue)

  if (model === 'per_head_chi') {
    const perHeadPayoutCents = readCents(
      readFirst(venue, [
        'per_head_payout_cents',
        'per_head_chi_cents',
        'attendee_payout_cents',
        'attendee_chi_cents',
      ]) as number | string | null | undefined
    )
    const guestCount = readPlanGuestCount(plan) ?? readNumber(readFirst(venue, [
      'guest_count',
      'headcount',
      'expected_attendance',
      'projected_attendance',
    ]))

    if (perHeadPayoutCents !== null && perHeadPayoutCents > 0 && guestCount !== null && guestCount > 0) {
      return -Math.round(perHeadPayoutCents * guestCount)
    }

    return readProjectedOrganizerPayoutCents(venue)
  }

  if (model === 'bar_chi' || model === 'ticket_chi') {
    return readProjectedOrganizerPayoutCents(venue)
  }

  const directEstimate = readDirectVenueEstimateCents(venue)
  if (directEstimate !== null) return directEstimate

  const minimumSpend = readMinimumSpendCents(venue)
  if (minimumSpend !== null) return minimumSpend

  return estimateVenueRentalCents(venue, plan.duration_hours)
}

function inferVenueCommercialModel(venue: Record<string, unknown>): VenueCommercialModel {
  const modelText = normalizeText([
    readFirst(venue, ['commercial_model', 'category', 'deal_model', 'pricing_model']),
    readFirst(venue, ['commercial_model_label', 'category_label', 'deal_model_label']),
    readFirst(venue, ['commercial_model_match', 'venue_terms']),
  ].filter(Boolean).join(' '))

  if (modelText && /\b(per head|per attendee|attendee|per_head|per-head)\b/.test(modelText) && /\b(chi|incentive|payout)\b/.test(modelText)) {
    return 'per_head_chi'
  }
  if (modelText && /\bbar|drink|beverage\b/.test(modelText) && /\b(chi|incentive|share|payout)\b/.test(modelText)) {
    return 'bar_chi'
  }
  if (modelText && /\bticket|door|admission\b/.test(modelText) && /\b(chi|incentive|share|payout)\b/.test(modelText)) {
    return 'ticket_chi'
  }
  if (modelText && /\bminimum|min spend|minimum_spend\b/.test(modelText)) {
    return 'minimum_spend'
  }
  if (modelText && /\b(flat|rental|hourly|buyout|room fee|venue_rental)\b/.test(modelText)) {
    return 'venue_rental'
  }

  if (readCents(readFirst(venue, ['per_head_payout_cents', 'per_head_chi_cents']) as number | string | null | undefined) !== null) {
    return 'per_head_chi'
  }
  if (venue.bar_consumption_share_enabled === true || readNumber(readFirst(venue, ['bar_consumption_share_percent', 'bar_consumption_share_pct'])) !== null) {
    return 'bar_chi'
  }
  if (venue.ticket_sales_share_enabled === true || readNumber(readFirst(venue, ['ticket_sales_share_percent', 'ticket_sales_share_pct'])) !== null) {
    return 'ticket_chi'
  }

  return 'unknown'
}

function readDirectVenueEstimateCents(venue: Record<string, unknown>): number | null {
  const cents = readCents(
    readFirst(venue, [
      'price_cents',
      'estimate_cents',
      'estimated_price_cents',
      'total_price_cents',
      'quoted_price_cents',
      'flat_rental_cents',
      'rental_fee_cents',
      'venue_rental_cents',
      'estimated_minimum_cost_cents',
    ]) as number | string | null | undefined
  )

  return cents !== null && Number.isFinite(cents) ? cents : null
}

function readMinimumSpendCents(venue: Record<string, unknown>): number | null {
  const autoApprove = readRecord(venue.auto_approve_conditions)
  const value = readCents(
    (venue.minimum_spend_cents ?? autoApprove?.minimum_spend_cents) as number | string | null | undefined,
    venue.minimum_spend as number | string | null | undefined
  )
  return value !== null && value > 0 ? value : null
}

function readProjectedOrganizerPayoutCents(venue: Record<string, unknown>): number | null {
  const payout = readCents(
    readFirst(venue, [
      'organizer_payout_cents',
      'projected_organizer_payout_cents',
      'estimated_organizer_payout_cents',
      'projected_payout_cents',
      'projected_chi_payout_cents',
      'projected_chi_cents',
      'organizer_credit_cents',
    ]) as number | string | null | undefined
  )

  if (payout === null || payout === 0) return null
  return payout > 0 ? -payout : payout
}

function readPlanGuestCount(plan: VenueEstimatePlanSummary): number | null {
  return readNumber(plan.guest_count ?? plan.headcount ?? plan.expected_attendance)
}

function readFirst(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key]
    if (value !== null && value !== undefined && value !== '') return value
  }
  return null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,%\s,]/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
