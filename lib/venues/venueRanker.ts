import type {
  CommercialModel,
  EventArchetypeConfig,
  VendorStackItem,
} from '@/lib/planner/archetypes/types'
import type { BuilderAttendanceSummary } from '@/lib/server/builderAttendanceHistory'

export interface VenueRankerPlanInput {
  guest_count?: number | null
  headcount?: number | null
  budget_cap_cents?: number | null
  budget_cents?: number | null
  event_type?: string | null
}

export type VenueRankerVenueInput = Record<string, unknown> & {
  id: string
}

export interface VenueArchetypeScore {
  score: number
  amenity_score: number
  financial_score: number
  venue_type_score: number
  commercial_model_alignment_score: number
  capacity_score: number
  warnings: string[]
  reasons: string[]
  primary_commercial_model: CommercialModel
  commercial_model_match: CommercialModel | null
  vendor_stack: VendorStackItem[]
  projected_attendance: number | null
  calibration_signal: CapacityCalibrationSignal
  score_breakdown: {
    capacity: {
      points: number
      details: {
        stated_guest_count: number | null
        projected_attendance: number | null
        calibration_signal: CapacityScoreCalibrationSignal
        history_p75: number | null
      }
    }
  }
}

export interface RankedVenueForArchetype {
  venue: VenueRankerVenueInput
  score: VenueArchetypeScore
}

export type CapacityCalibrationSignal = 'no_history' | 'stated' | 'historical_higher' | 'historical_aligned'
export type CapacityScoreCalibrationSignal = 'stated' | 'historical_higher' | 'historical_aligned'

export interface VenueRankerContext {
  builder_attendance?: BuilderAttendanceSummary | null
}

export function rankVenuesForArchetype(input: {
  plan: VenueRankerPlanInput
  venues: VenueRankerVenueInput[]
  archetype: EventArchetypeConfig
  context?: VenueRankerContext
}): RankedVenueForArchetype[] {
  return input.venues
    .map((venue) => ({
      venue,
      score: scoreVenueAgainstArchetype({
        plan: input.plan,
        venue,
        archetype: input.archetype,
        context: input.context,
      }),
    }))
    .filter((ranked) => passesProjectedCapacityGate(ranked.venue, ranked.score.projected_attendance))
    .sort((first, second) =>
      second.score.score - first.score.score ||
      estimateVenueCents(first.venue) - estimateVenueCents(second.venue) ||
      readString(first.venue.venue_name)?.localeCompare(readString(second.venue.venue_name) ?? '') ||
      0
    )
}

export function scoreVenueAgainstArchetype(input: {
  plan: VenueRankerPlanInput
  venue: VenueRankerVenueInput
  archetype: EventArchetypeConfig
  context?: VenueRankerContext
}): VenueArchetypeScore {
  const warnings: string[] = []
  const reasons: string[] = []
  const headcount = readNumber(input.plan.guest_count ?? input.plan.headcount)
  const calibration = computeAttendanceCalibration(headcount, input.context?.builder_attendance ?? null)
  const capacity = readCapacity(input.venue)
  const venueType = normalizeText(readString(input.venue.venue_type) ?? '')
  const requiredAmenityMatches = scoreRequiredAmenityFit(input.venue, input.archetype.required_amenities)
  const bonusAmenityMatches = scoreRequiredAmenityFit(input.venue, input.archetype.bonus_amenities)
  const venueTypePreferred = input.archetype.preferred_venue_types.includes(venueType as EventArchetypeConfig['preferred_venue_types'][number])
  const venueTypeScore = !venueType ? 0 : venueTypePreferred ? 5 : -10
  const capacityScore = scoreCapacityFit(input.archetype, {
    statedGuestCount: headcount,
    projectedAttendance: calibration.projectedAttendance,
    capacity,
    warnings,
    reasons,
  })
  const cateringScore = scoreCateringFit(input.venue, input.archetype, warnings, reasons)
  const commercialAlignment = scoreCommercialModelAlignment(input.venue, input.archetype)

  if (venueTypePreferred) {
    reasons.push(`${formatVenueType(venueType)} matches ${input.archetype.display_name}.`)
  } else if (venueType) {
    warnings.push(`${formatVenueType(venueType)} is outside preferred venue types for ${input.archetype.display_name}.`)
  }

  if (headcount !== null) {
    const [minGuests, maxGuests] = input.archetype.capacity_range
    if (headcount < minGuests || headcount > maxGuests) {
      warnings.push(`${headcount} guests is outside the typical ${minGuests}-${maxGuests} range for ${input.archetype.display_name}.`)
    }
  }

  const amenityScore = clamp(
    venueTypeScore +
      Math.round(requiredAmenityMatches.ratio * 7) +
      Math.round(bonusAmenityMatches.ratio * 3) +
      cateringScore,
    -15,
    15
  )
  const financialScore = clamp(20 + commercialAlignment.score, 0, 40)
  const score = clamp(capacityScore + amenityScore + financialScore, 0, 100)

  if (requiredAmenityMatches.matched.length > 0) {
    reasons.push(`Covers ${requiredAmenityMatches.matched.slice(0, 3).join(', ')}.`)
  }
  if (commercialAlignment.match) {
    reasons.push(`${formatCommercialModel(commercialAlignment.match)} aligns with ${input.archetype.display_name} economics.`)
  }

  return {
    score,
    amenity_score: amenityScore,
    financial_score: financialScore,
    venue_type_score: venueTypeScore,
    commercial_model_alignment_score: commercialAlignment.score,
    capacity_score: capacityScore,
    warnings,
    reasons,
    primary_commercial_model: commercialAlignment.primary,
    commercial_model_match: commercialAlignment.match,
    vendor_stack: input.archetype.vendor_stack,
    projected_attendance: calibration.projectedAttendance,
    calibration_signal: calibration.signal,
    score_breakdown: {
      capacity: {
        points: capacityScore,
        details: {
          stated_guest_count: headcount,
          projected_attendance: calibration.projectedAttendance,
          calibration_signal: calibration.scoreSignal,
          history_p75: calibration.historyP75,
        },
      },
    },
  }
}

export function inferSupportedCommercialModels(venue: Record<string, unknown>): CommercialModel[] {
  const models = new Set<CommercialModel>()
  const pricingModel = normalizeText(readString(venue.pricing_model) ?? '')
  const autoApprove = readRecord(venue.auto_approve_conditions)

  if (
    venue.bar_rev_share_enabled === true ||
    venue.bar_revenue_share_enabled === true ||
    (readNumber(venue.bar_rev_share_pct ?? venue.bar_revenue_share_pct ?? venue.bar_revenue_percentage) ?? 0) > 0
  ) {
    models.add('bar_rev_share')
  }
  if ((readNumber(venue.per_head_kickback_cents ?? venue.per_head_kickback_amount ?? venue.per_head_kickback) ?? 0) > 0) {
    models.add('per_head')
  }
  if (
    pricingModel.includes('minimum') ||
    readNumber(venue.minimum_spend_cents ?? venue.minimum_spend ?? autoApprove?.minimum_spend_cents) !== null
  ) {
    models.add('minimum_spend')
  }
  if (
    venue.ticket_sales_share_enabled === true ||
    (readNumber(venue.ticket_sales_share_pct ?? venue.ticket_sales_share_percent) ?? 0) > 0
  ) {
    models.add('ticket_share')
  }
  if (pricingModel.includes('prix')) models.add('prix_fixe')
  if (pricingModel.includes('package')) models.add('package')
  if (pricingModel.includes('free')) models.add('free_space')
  if (pricingModel.includes('external')) models.add('external_checkout')
  if (
    pricingModel.includes('flat') ||
    pricingModel.includes('rental') ||
    pricingModel.includes('hourly') ||
    readNumber(venue.hourly_rate) !== null ||
    readNumber(venue.daily_rate) !== null
  ) {
    models.add('flat_rental')
  }

  if (models.size === 0) models.add('flat_rental')
  return [...models]
}

function scoreCapacityFit(
  archetype: EventArchetypeConfig,
  input: {
    statedGuestCount: number | null
    projectedAttendance: number | null
    capacity: number | null
    warnings: string[]
    reasons: string[]
  }
): number {
  const headcount = input.statedGuestCount
  const projectedAttendance = input.projectedAttendance ?? headcount
  if (headcount === null || input.capacity === null || headcount <= 0) return 25
  if (projectedAttendance !== null && input.capacity < projectedAttendance) {
    input.warnings.push(`Capacity ${input.capacity} is below projected attendance of ${projectedAttendance} guests.`)
    return 5
  }

  const ratio = input.capacity / headcount
  const calibrationPenalty = projectedAttendance !== null && input.capacity < projectedAttendance * 1.05 ? 3 : 0
  if (ratio >= archetype.capacity_ratio_min && ratio <= archetype.capacity_ratio_max) {
    input.reasons.push(`Capacity ratio ${ratio.toFixed(1)}x fits the ${archetype.display_name} sweet spot.`)
    return 45 - calibrationPenalty
  }
  if (ratio < archetype.capacity_ratio_min) {
    input.warnings.push(`Capacity ratio ${ratio.toFixed(1)}x may feel tight for ${archetype.display_name}.`)
    return 34 - calibrationPenalty
  }

  input.warnings.push(`Capacity ratio ${ratio.toFixed(1)}x may feel oversized for ${archetype.display_name}.`)
  if (ratio > archetype.capacity_ratio_max * 2) return 12
  return 26 - calibrationPenalty
}

function scoreCateringFit(
  venue: VenueRankerVenueInput,
  archetype: EventArchetypeConfig,
  warnings: string[],
  reasons: string[]
): number {
  if (archetype.catering_rule === 'na') return 0
  const text = buildVenueText(venue)
  const hasKitchen = /\b(kitchen|restaurant|private dining|menu|in house food|in-house food|catering|food service)\b/.test(text)
  const outsideAllowed = readBoolean(venue.outside_catering_allowed)

  if (archetype.catering_rule === 'kitchen_required') {
    if (hasKitchen) {
      reasons.push('Food program fits the archetype catering rule.')
      return 3
    }
    warnings.push(`${archetype.display_name} usually needs in-house food or a kitchen.`)
    return -8
  }

  if (archetype.catering_rule === 'outside_ok' && outsideAllowed === false && !hasKitchen) {
    warnings.push('Outside catering appears restricted for an archetype that may need outside vendors.')
    return -6
  }

  return 0
}

function scoreRequiredAmenityFit(
  venue: VenueRankerVenueInput,
  requiredAmenities: string[]
): { matched: string[]; ratio: number } {
  if (requiredAmenities.length === 0) return { matched: [], ratio: 1 }

  const text = buildVenueText(venue)
  const matched = requiredAmenities.filter((amenity) => matchesAmenity(text, amenity))
  return {
    matched,
    ratio: matched.length / requiredAmenities.length,
  }
}

function scoreCommercialModelAlignment(
  venue: VenueRankerVenueInput,
  archetype: EventArchetypeConfig
): { score: number; primary: CommercialModel; match: CommercialModel | null } {
  const supported = inferSupportedCommercialModels(venue)
  const primary = supported[0] ?? 'flat_rental'
  const matchIndex = archetype.preferred_commercial_models.findIndex((model) => supported.includes(model))
  if (matchIndex === -1) return { score: 0, primary, match: null }

  return {
    score: Math.max(3, 10 - matchIndex * 2),
    primary,
    match: archetype.preferred_commercial_models[matchIndex] ?? null,
  }
}

function buildVenueText(venue: Record<string, unknown>): string {
  return normalizeText([
    venue.venue_name,
    venue.name,
    venue.description,
    venue.venue_type,
    venue.unique_features,
    venue.unique_features_tags,
    venue.amenities,
    venue.venue_amenities,
    venue.pricing_model,
  ].map(serializeSearchValue).join(' '))
}

function matchesAmenity(text: string, amenity: string): boolean {
  const normalizedAmenity = normalizeText(amenity)
  if (!normalizedAmenity) return false
  if (text.includes(normalizedAmenity)) return true

  const aliasGroups = [
    ['standing room', 'standing capacity', 'standing'],
    ['full bar', 'bar', 'beverage', 'cocktail'],
    ['private room', 'privacy', 'private dining', 'semi private'],
    ['seated dining', 'seating', 'seated'],
    ['menu', 'food', 'kitchen', 'restaurant'],
    ['demo stations', 'demo', 'stations', 'booth'],
    ['photo moments', 'photo', 'lighting', 'press wall'],
    ['av', 'a v', 'audio', 'visual', 'screen', 'projector', 'mic', 'sound'],
    ['load in', 'loading', 'freight'],
    ['storage', 'back of house'],
    ['permits', 'permit'],
    ['tables', 'table'],
    ['wifi', 'wi fi', 'internet'],
    ['mics', 'mic', 'microphone'],
    ['networking area', 'reception', 'lounge'],
    ['stage', 'platform'],
    ['demo tables', 'tables'],
    ['investor flow', 'registration', 'check in'],
    ['power', 'outlets'],
    ['breakout rooms', 'breakout', 'meeting rooms'],
    ['flexible layout', 'flexible'],
    ['sponsor visibility', 'sponsor', 'brandable'],
    ['outdoor vibe', 'outdoor', 'patio', 'rooftop'],
    ['sound allowed', 'sound', 'music'],
    ['late hours', 'late', 'night'],
    ['sound system', 'sound', 'pa'],
    ['screens', 'screen', 'tv'],
    ['sightlines', 'sightline'],
    ['route or space', 'route', 'open space', 'studio'],
    ['rain plan', 'indoor', 'covered'],
    ['group seats or screens', 'group seats', 'screens'],
    ['pre post venue', 'pregame', 'postgame', 'bar'],
    ['seasonal availability', 'holiday', 'seasonal'],
    ['rooms', 'lodging', 'hotel'],
    ['meals', 'catering', 'food'],
  ]

  return aliasGroups.some((aliases) => (
    aliases.some((alias) => normalizedAmenity.includes(alias)) &&
    aliases.some((alias) => text.includes(alias))
  ))
}

function readCapacity(row: Record<string, unknown>): number | null {
  const values = [
    row.capacity,
    row.standing_capacity,
    row.capacity_max,
    row.max_capacity,
    row.seated_capacity,
  ].map(readNumber).filter((value): value is number => value !== null)

  if (values.length === 0) return null
  return Math.max(...values)
}

function passesProjectedCapacityGate(
  venue: VenueRankerVenueInput,
  projectedAttendance: number | null
): boolean {
  if (projectedAttendance === null || projectedAttendance <= 0) return true
  const capacity = readCapacity(venue)
  if (capacity === null) return true
  return capacity >= projectedAttendance
}

function computeAttendanceCalibration(
  statedGuestCount: number | null,
  builderAttendance: BuilderAttendanceSummary | null
): {
  projectedAttendance: number | null
  signal: CapacityCalibrationSignal
  scoreSignal: CapacityScoreCalibrationSignal
  historyP75: number | null
} {
  if (statedGuestCount === null || statedGuestCount <= 0) {
    return {
      projectedAttendance: statedGuestCount,
      signal: builderAttendance && builderAttendance.sample_size > 0 ? 'historical_aligned' : 'no_history',
      scoreSignal: 'stated',
      historyP75: builderAttendance && builderAttendance.sample_size > 0 ? builderAttendance.p75_tickets_sold : null,
    }
  }

  if (!builderAttendance || builderAttendance.sample_size === 0) {
    return {
      projectedAttendance: statedGuestCount,
      signal: 'no_history',
      scoreSignal: 'stated',
      historyP75: null,
    }
  }

  const p75 = builderAttendance.p75_tickets_sold
  if (builderAttendance.confidence === 'high' && p75 > statedGuestCount * 1.4) {
    return {
      projectedAttendance: Math.round(p75),
      signal: 'historical_higher',
      scoreSignal: 'historical_higher',
      historyP75: p75,
    }
  }

  if (builderAttendance.confidence === 'medium' && p75 > statedGuestCount * 1.6) {
    return {
      projectedAttendance: Math.round((statedGuestCount + p75) / 2),
      signal: 'historical_higher',
      scoreSignal: 'historical_higher',
      historyP75: p75,
    }
  }

  return {
    projectedAttendance: statedGuestCount,
    signal: builderAttendance.confidence === 'medium' || builderAttendance.confidence === 'high'
      ? 'historical_aligned'
      : 'stated',
    scoreSignal: builderAttendance.confidence === 'medium' || builderAttendance.confidence === 'high'
      ? 'historical_aligned'
      : 'stated',
    historyP75: p75,
  }
}

function estimateVenueCents(row: Record<string, unknown>): number {
  return readNumber(row.estimate_cents ?? row.hourly_rate ?? row.daily_rate) ?? 0
}

function serializeSearchValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(serializeSearchValue).join(' ')
  if (typeof value === 'object') return Object.values(value).map(serializeSearchValue).join(' ')
  return String(value)
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

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = normalizeText(value)
    if (normalized === 'true') return true
    if (normalized === 'false') return false
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

function formatVenueType(value: string): string {
  return value.replace(/_/g, ' ')
}

function formatCommercialModel(value: string): string {
  return value.replace(/_/g, ' ')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
