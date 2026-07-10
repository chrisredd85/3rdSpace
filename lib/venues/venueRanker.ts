import type {
  CommercialModel,
  EventArchetypeConfig,
  MatchingField,
  VendorStackItem,
} from '@/lib/planner/archetypes/types'
import { readCents } from '@/lib/money'
import type { BuilderAttendanceSummary } from '@/lib/server/builderAttendanceHistory'

export interface VenueRankerPlanInput {
  guest_count?: number | null
  headcount?: number | null
  budget_cap_cents?: number | null
  budget_cents?: number | null
  event_type?: string | null
  neighborhood?: string | null
  area?: string | null
  date_window?: string | null
  date_window_start?: string | null
  date_window_end?: string | null
  ticketed?: boolean | null
  food_responsibility?: string | null
  metadata?: unknown
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
  signal_score: number
  hard_gate_failures: string[]
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
    .filter((ranked) => ranked.score.hard_gate_failures.length === 0)
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
  const signalFit = scoreMatchingSignalFit(input.plan, input.venue, input.archetype)
  warnings.push(...signalFit.warnings)
  reasons.push(...signalFit.reasons)

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
      signalFit.amenityAdjustment +
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
    signal_score: signalFit.amenityAdjustment,
    hard_gate_failures: signalFit.hardGateFailures,
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
    venue.bar_consumption_share_enabled === true ||
    venue.bar_revenue_share_enabled === true ||
    venue.bar_rev_share_enabled === true ||
    (readNumber(venue.bar_consumption_share_pct ?? venue.bar_revenue_share_percent ?? venue.bar_revenue_percentage) ?? 0) > 0
  ) {
    models.add('bar_consumption_share')
  }
  if ((readVenuePerHeadChiCents(venue) ?? 0) > 0) {
    models.add('per_head')
  }
  if (
    pricingModel.includes('minimum') ||
    readNumber(venue.minimum_spend_cents ?? autoApprove?.minimum_spend_cents) !== null ||
    readCents(null, venue.minimum_spend as number | string | null | undefined) !== null
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
    readCents(venue.hourly_rate_cents as number | string | null | undefined, venue.hourly_rate as number | string | null | undefined) !== null ||
    readCents(venue.daily_rate_cents as number | string | null | undefined, venue.daily_rate as number | string | null | undefined) !== null
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

function scoreMatchingSignalFit(
  plan: VenueRankerPlanInput,
  venue: VenueRankerVenueInput,
  archetype: EventArchetypeConfig
): {
  amenityAdjustment: number
  hardGateFailures: string[]
  warnings: string[]
  reasons: string[]
} {
  const criticalFields = new Set(archetype.matching_fields.critical)
  const highSignalFields = new Set(archetype.matching_fields.high_signal)
  const fields = Array.from(new Set<MatchingField>([
    ...archetype.matching_fields.critical,
    ...archetype.matching_fields.high_signal,
  ]))
  const hardGateFailures: string[] = []
  const warnings: string[] = []
  const reasons: string[] = []
  let amenityAdjustment = 0

  for (const field of fields) {
    const planValue = readPlanSignal(plan, field)
    const value = planValue ?? archetype.default_fills[field]
    const mismatch = evaluateVenueSignalMismatch(venue, field, value)
    if (!mismatch) continue

    // Only apply a hard gate when the value was explicitly provided by the plan.
    // Archetype default fills are reasonable assumptions — a mismatch is a warning,
    // not a veto, to avoid over-filtering venues before the organizer has confirmed.
    const fromPlan = planValue !== null && planValue !== undefined
    if (criticalFields.has(field) && fromPlan) {
      hardGateFailures.push(mismatch)
      warnings.push(mismatch)
      continue
    }

    if (criticalFields.has(field) || highSignalFields.has(field)) {
      amenityAdjustment -= 10
      warnings.push(mismatch)
    }
  }

  if (amenityAdjustment === 0 && hardGateFailures.length === 0) {
    reasons.push('Operational matching signals fit the venue profile.')
  }

  return {
    amenityAdjustment,
    hardGateFailures,
    warnings,
    reasons,
  }
}

function evaluateVenueSignalMismatch(
  venue: VenueRankerVenueInput,
  field: MatchingField,
  value: unknown
): string | null {
  const text = buildVenueText(venue)
  const signal = normalizeText(String(value ?? ''))
  if (!signal) return null

  if (field === 'setup_format') {
    if (signal === 'theater') {
      return hasAny(text, ['rows of chairs', 'theater seating', 'auditorium seating', 'flat floor', 'chairs'])
        ? null
        : 'Theater setup needs rows of chairs or flexible flat-floor seating.'
    }
    if (signal === 'classroom' || signal === 'u shape' || signal === 'u_shape') {
      return hasAny(text, ['banquet table', 'tables', 'classroom', 'u shape', 'u-shape'])
        ? null
        : 'Classroom or U-shape setup needs banquet-style tables.'
    }
    if (signal === 'hands on' || signal === 'hands_on') {
      return hasAny(text, ['work surface', 'workstation', 'tables', 'studio tables']) &&
        hasAny(text, ['power', 'outlets', 'plug'])
        ? null
        : 'Hands-on setup needs work surfaces and power outlets.'
    }
  }

  if (field === 'av_intensity' && signal === 'heavy') {
    return hasAny(text, ['in house av', 'in-house av', 'outside av', 'rigging', 'production', 'av tech'])
      ? null
      : 'Heavy AV needs in-house production support or outside AV allowance.'
  }

  if (field === 'stage_required' && readBooleanLike(value) === true) {
    return hasAny(text, ['stage', 'platform', 'flat floor', 'portable stage', 'raised'])
      ? null
      : 'Stage-required plans need a stage area or portable-stage-ready floor.'
  }

  if (field === 'demo_stations_needed' && readBooleanLike(value) !== false && signal !== '0') {
    return hasAny(text, ['power', 'outlets']) &&
      hasAny(text, ['tables', 'demo station', 'booth']) &&
      hasAny(text, ['wifi', 'wi fi', 'internet'])
      ? null
      : 'Demo stations need power, tables, and reliable internet.'
  }

  if (field === 'screens_count' && readNumber(value) !== null && (readNumber(value) ?? 0) > 0) {
    return hasAny(text, ['screen', 'projector', 'tv', 'display'])
      ? null
      : 'Screen-heavy plans need screens, projectors, or displays.'
  }

  if (field === 'mics_count' && readNumber(value) !== null && (readNumber(value) ?? 0) > 0) {
    return hasAny(text, ['mic', 'microphone', 'pa system', 'audio'])
      ? null
      : 'Microphone needs require in-room audio or PA support.'
  }

  if (field === 'music_format' && signal === 'live') {
    return hasAny(text, ['live band', 'performance stage', 'stage', 'green room', 'backline'])
      ? null
      : 'Live music needs a stage or live-performance-ready setup.'
  }

  if (field === 'bar_required' && readBooleanLike(value) === true) {
    return hasAny(text, ['liquor license', 'full bar', 'bar setup', 'cocktail', 'beverage'])
      ? null
      : 'Bar-required plans need a liquor license, bar setup, or full bar.'
  }

  if (field === 'security_needs' && signal === 'full_staff') {
    return hasAny(text, ['single entry', 'security', 'door staff', 'coat check', 'controlled entry'])
      ? null
      : 'Full security works best with controlled entry and door-staff-capable layout.'
  }

  return null
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
    venue.layout_options,
    venue.production_capabilities,
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
  const directEstimate = readNumber(row.estimate_cents)
  if (directEstimate !== null) return directEstimate
  return (
    readCents(row.hourly_rate_cents as number | string | null | undefined, row.hourly_rate as number | string | null | undefined) ??
    readCents(row.daily_rate_cents as number | string | null | undefined, row.daily_rate as number | string | null | undefined) ??
    readCents(row.price_per_night_cents as number | string | null | undefined, row.price_per_night as number | string | null | undefined) ??
    0
  )
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

function readVenuePerHeadChiCents(venue: Record<string, unknown>): number | null {
  return readCents(
    venue.per_head_chi_cents as number | string | null | undefined,
    (venue.per_head_kickback_amount ?? venue.per_head_kickback) as number | string | null | undefined
  )
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

function readBooleanLike(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0
  if (typeof value === 'string') {
    const normalized = normalizeText(value)
    if (['true', 'yes', 'required', 'needed', 'full', '1'].includes(normalized)) return true
    if (['false', 'no', 'none', 'not needed', '0'].includes(normalized)) return false
  }
  return null
}

function readPlanSignal(plan: VenueRankerPlanInput, field: MatchingField): unknown {
  if (field === 'event_type') return plan.event_type
  if (field === 'neighborhood') return plan.neighborhood ?? plan.area
  if (field === 'guest_count') return plan.guest_count ?? plan.headcount
  if (field === 'date_window') return plan.date_window ?? plan.date_window_start ?? plan.date_window_end
  if (field === 'budget_cap_cents') return plan.budget_cap_cents ?? plan.budget_cents
  if (field === 'ticketed') return plan.ticketed
  if (field === 'food_responsibility') return plan.food_responsibility
  const direct = (plan as Record<string, unknown>)[field]
  if (direct !== undefined && direct !== null) return direct
  const metadata = readRecord(plan.metadata)
  const metadataValue = metadata?.[field]
  if (metadataValue !== undefined && metadataValue !== null) return metadataValue
  const matchingSignals = readRecord(metadata?.matching_signals)
  const matchingValue = matchingSignals?.[field]
  if (matchingValue !== undefined && matchingValue !== null) return matchingValue
  const eventRequirements = readRecord(metadata?.event_requirements)
  const requirementValue = eventRequirements?.[field]
  if (requirementValue !== undefined && requirementValue !== null) return requirementValue
  return null
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(normalizeText(needle)))
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
