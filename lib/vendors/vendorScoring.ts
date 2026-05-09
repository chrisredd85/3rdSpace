import type { EventArchetypeConfig, VendorStackItem } from '@/lib/planner/archetypes/types'
import type { Plan } from '@/lib/types'
import {
  normalizeServiceType,
  normalizeText,
  readMoneyCents,
  readString,
  readStringArray,
  type Vendor,
  type Venue,
} from '@/lib/vendors/vendorGates'

export interface BuilderVendorHistory {
  bookings_with_vendor: number
  last_booking_at: string | null
}

export interface VenueVendorHistory {
  cobooking_count: number
}

export interface VendorMetrics {
  response_p50_minutes: number | null
  completion_rate: number
  last_minute_cancels_90d: number
  bookings_count: number
}

export interface VendorScoreBreakdown {
  total: number
  archetype_fit: { points: number; max: 25; details: Record<string, unknown> }
  reliability: { points: number; max: 20; details: Record<string, unknown> }
  response_time: { points: number; max: 15; details: Record<string, unknown> }
  price_band: { points: number; max: 15; details: Record<string, unknown> }
  venue_synergy: { points: number; max: 15; details: Record<string, unknown> }
  history: { points: number; max: 10; details: Record<string, unknown> }
  tie_breaker_signals: {
    bookings_count: number
    base_rate_cents: number
    response_p50_minutes: number | null
    same_neighborhood: boolean
  }
  warnings: string[]
}

export function scoreVendor(
  vendor: Vendor,
  plan: Plan,
  archetype: EventArchetypeConfig,
  chosenVenue: Venue | null,
  stackItem: VendorStackItem,
  context: {
    builderHistory: BuilderVendorHistory
    venueVendorHistory: VenueVendorHistory
    vendorMetrics: VendorMetrics
    priceBandMedianCents?: number | null
  }
): VendorScoreBreakdown {
  const archetypeFit = scoreArchetypeFit(vendor, archetype, stackItem)
  const reliability = scoreReliability(vendor, context.vendorMetrics)
  const responseTime = scoreResponseTime(context.vendorMetrics)
  const priceBand = scorePriceBand(vendor, plan, archetype, context.priceBandMedianCents ?? null)
  const venueSynergy = scoreVenueSynergy(vendor, chosenVenue, context.venueVendorHistory)
  const history = scoreBuilderHistory(context.builderHistory)
  const warnings = [
    ...archetypeFit.warnings,
    ...reliability.warnings,
    ...priceBand.warnings,
    ...venueSynergy.warnings,
  ]
  const baseRateCents = readMoneyCents(vendor.base_rate ?? vendor.hourly_rate) ?? 0

  return {
    total: clamp(
      archetypeFit.points +
        reliability.points +
        responseTime.points +
        priceBand.points +
        venueSynergy.points +
        history.points,
      0,
      100
    ),
    archetype_fit: {
      points: archetypeFit.points,
      max: 25,
      details: archetypeFit.details,
    },
    reliability: {
      points: reliability.points,
      max: 20,
      details: reliability.details,
    },
    response_time: {
      points: responseTime.points,
      max: 15,
      details: responseTime.details,
    },
    price_band: {
      points: priceBand.points,
      max: 15,
      details: priceBand.details,
    },
    venue_synergy: {
      points: venueSynergy.points,
      max: 15,
      details: venueSynergy.details,
    },
    history: {
      points: history.points,
      max: 10,
      details: history.details,
    },
    tie_breaker_signals: {
      bookings_count: context.vendorMetrics.bookings_count,
      base_rate_cents: baseRateCents,
      response_p50_minutes: context.vendorMetrics.response_p50_minutes,
      same_neighborhood: isSameNeighborhood(vendor, chosenVenue),
    },
    warnings,
  }
}

function scoreArchetypeFit(
  vendor: Vendor,
  archetype: EventArchetypeConfig,
  stackItem: VendorStackItem
): { points: number; details: Record<string, unknown>; warnings: string[] } {
  const necessityPts = stackItem.necessity === 'required' ? 0 : stackItem.necessity === 'recommended' ? 5 : 10
  const specializationSignals = readStringArray([
    ...readStringArray(vendor.specializations),
    ...readStringArray(vendor.compatible_features),
    ...readStringArray(vendor.services_offered),
    readString(vendor.bio) ?? '',
  ].join(' '))
  const specializationText = normalizeText(specializationSignals.join(' '))
  const archetypeAliases = [archetype.key, archetype.display_name, ...archetype.aliases].map(normalizeText)
  const hasSpecializationMatch = archetypeAliases.some((alias) => alias && specializationText.includes(alias))
  const serviceMatches = normalizeServiceType(readString(vendor.service_type ?? vendor.vendor_type)) === stackItem.service_type
  const specializationPts = hasSpecializationMatch ? 10 : serviceMatches ? 7 : 5
  const styleTags = readStringArray(vendor.style_tags)
  const preferredStyles = readStringArray((archetype as EventArchetypeConfig & { preferred_vendor_styles?: string[] }).preferred_vendor_styles)
  const styleMatch = countStyleMatches(styleTags, preferredStyles)
  const styleMatchPts = preferredStyles.length === 0 ? 2 : styleMatch === preferredStyles.length ? 5 : styleMatch > 0 ? 3 : 2
  const points = clamp(necessityPts + specializationPts + styleMatchPts, 0, 25)

  return {
    points,
    details: {
      necessity: stackItem.necessity,
      necessity_pts: necessityPts,
      specialization_pts: specializationPts,
      style_match_pts: styleMatchPts,
      matched_specialization: hasSpecializationMatch,
      preferred_styles: preferredStyles,
      vendor_style_tags: styleTags,
    },
    warnings: hasSpecializationMatch ? [] : [`No explicit ${archetype.display_name} specialization found.`],
  }
}

function scoreReliability(
  vendor: Vendor,
  metrics: VendorMetrics
): { points: number; details: Record<string, unknown>; warnings: string[] } {
  const averageRating = readNumber(vendor.average_rating ?? vendor.rating) ?? 0
  const completionRatePts = clamp(15 * metrics.completion_rate, 0, 15)
  const cancelPenalty = metrics.last_minute_cancels_90d * -3
  const reviewPts = clamp(5 * (averageRating / 5), 0, 5)
  const points = clamp(Math.round(completionRatePts + cancelPenalty + reviewPts), 0, 20)

  return {
    points,
    details: {
      completion_rate: metrics.completion_rate,
      completion_rate_pts: Math.round(completionRatePts),
      last_minute_cancels_90d: metrics.last_minute_cancels_90d,
      cancel_penalty: cancelPenalty,
      average_rating: averageRating,
      review_pts: Math.round(reviewPts),
    },
    warnings: metrics.last_minute_cancels_90d > 0 ? ['Recent vendor cancellation history needs review.'] : [],
  }
}

function scoreResponseTime(metrics: VendorMetrics): { points: number; details: Record<string, unknown> } {
  const p50 = metrics.response_p50_minutes
  if (p50 === null) return { points: 5, details: { response_p50_minutes: null, label: 'unknown' } }
  if (p50 <= 60) return { points: 15, details: { response_p50_minutes: p50, label: 'under_1h' } }
  if (p50 <= 240) return { points: 12, details: { response_p50_minutes: p50, label: 'under_4h' } }
  if (p50 <= 1440) return { points: 8, details: { response_p50_minutes: p50, label: 'under_24h' } }
  if (p50 <= 4320) return { points: 4, details: { response_p50_minutes: p50, label: 'under_3d' } }
  return { points: 0, details: { response_p50_minutes: p50, label: 'slow' } }
}

function scorePriceBand(
  vendor: Vendor,
  plan: Plan,
  archetype: EventArchetypeConfig,
  medianCents: number | null
): { points: number; details: Record<string, unknown>; warnings: string[] } {
  const baseRate = readMoneyCents(vendor.base_rate ?? vendor.hourly_rate)
  if (baseRate === null || !medianCents || medianCents <= 0) {
    return {
      points: 7,
      details: { base_rate_cents: baseRate, median_cents: medianCents, label: 'unknown' },
      warnings: ['Vendor price band needs confirmation.'],
    }
  }

  const sponsorCovered = archetype.preferred_commercial_models[0] === 'sponsor_covered' || hasSponsorBudget(plan)
  if (sponsorCovered) {
    const points = baseRate <= medianCents * 2 ? 15 : 5
    return {
      points,
      details: { base_rate_cents: baseRate, median_cents: medianCents, label: 'sponsor_tolerant' },
      warnings: points < 15 ? ['Premium sponsor-covered vendor is over 2x median.'] : [],
    }
  }

  const ratio = baseRate / medianCents
  if (ratio <= 0.85) return priceBandResult(15, baseRate, medianCents, 'cheap_fit')
  if (ratio <= 1) return priceBandResult(12, baseRate, medianCents, 'good_value')
  if (ratio <= 1.15) return priceBandResult(9, baseRate, medianCents, 'fair')
  if (ratio <= 1.35) return priceBandResult(5, baseRate, medianCents, 'premium')
  return {
    ...priceBandResult(2, baseRate, medianCents, 'expensive'),
    warnings: ['Vendor is expensive relative to comparable matches.'],
  }
}

function scoreVenueSynergy(
  vendor: Vendor,
  chosenVenue: Venue | null,
  history: VenueVendorHistory
): { points: number; details: Record<string, unknown>; warnings: string[] } {
  const preferredVendorIds = Array.isArray(chosenVenue?.preferred_vendor_ids) ? chosenVenue?.preferred_vendor_ids : []
  const priorCobookingPts = history.cobooking_count >= 3 ? 10 : history.cobooking_count >= 1 ? 6 : 0
  const venueRecommendsPts = vendor.id && preferredVendorIds.includes(vendor.id) ? 5 : 0

  return {
    points: priorCobookingPts + venueRecommendsPts,
    details: {
      cobooking_count: history.cobooking_count,
      preferred_by_venue: vendor.id ? preferredVendorIds.includes(vendor.id) : false,
    },
    warnings: history.cobooking_count === 0 ? ['No prior venue/vendor co-booking signal.'] : [],
  }
}

function scoreBuilderHistory(history: BuilderVendorHistory): { points: number; details: Record<string, unknown> } {
  const builderPriorPts = history.bookings_with_vendor >= 1 ? 7 : 0
  const recencyDays = getDaysSince(history.last_booking_at)
  const recencyPts = recencyDays === null ? 0 : recencyDays < 90 ? 3 : recencyDays < 365 ? 1 : 0

  return {
    points: builderPriorPts + recencyPts,
    details: {
      bookings_with_vendor: history.bookings_with_vendor,
      last_booking_at: history.last_booking_at,
      recency_days: recencyDays,
      builder_prior_pts: builderPriorPts,
      recency_pts: recencyPts,
    },
  }
}

function countStyleMatches(styleTags: string[], preferredStyles: string[]): number {
  const normalizedTags = new Set(styleTags.map(normalizeText))
  return preferredStyles.map(normalizeText).filter((style) => normalizedTags.has(style)).length
}

function isSameNeighborhood(vendor: Vendor, chosenVenue: Venue | null): boolean {
  const venueArea = normalizeText(chosenVenue?.neighborhood ?? chosenVenue?.address)
  if (!venueArea) return false
  const vendorArea = normalizeText([vendor.service_area, vendor.regions_served].filter(Boolean).join(' '))
  return Boolean(vendorArea && venueArea && vendorArea.includes(venueArea))
}

function priceBandResult(points: number, baseRate: number, medianCents: number, label: string) {
  return {
    points,
    details: { base_rate_cents: baseRate, median_cents: medianCents, label },
    warnings: [] as string[],
  }
}

function hasSponsorBudget(plan: Plan): boolean {
  const metadata = plan.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  return Boolean((metadata as Record<string, unknown>).sponsor_budget_cents)
}

function getDaysSince(value: string | null): number | null {
  if (!value) return null
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return null
  return Math.max(0, Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000)))
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}
