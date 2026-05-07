import { z } from 'zod'
import { eventPlanSchema, type EventPlan } from '@/lib/ai/types'

const MAX_VENUE_CANDIDATES = 10
const DEFAULT_EVENT_HOURS = 4

const nullableStringSchema = z.string().trim().min(1).nullable()
const nullableNonnegativeNumberSchema = z.number().nonnegative().nullable()

export const venueAmenitySchema = z.object({
  venue_id: z.string().trim().min(1).optional(),
  amenity_name: nullableStringSchema,
})

export const venueMatchingCandidateSchema = z.object({
  id: z.string().trim().min(1),
  venue_name: z.string().trim().min(1),
  venue_type: nullableStringSchema,
  standing_capacity: z.number().int().nonnegative().nullable(),
  seated_capacity: z.number().int().nonnegative().nullable(),
  city: nullableStringSchema,
  state: nullableStringSchema,
  hourly_rate: nullableNonnegativeNumberSchema,
  minimum_hours: z.number().int().nonnegative().nullable(),
  is_published: z.boolean().nullable(),
  per_head_kickback: nullableNonnegativeNumberSchema,
  offers_kickbacks: z.boolean().nullable(),
  deposit_percentage: nullableNonnegativeNumberSchema,
  cancellation_terms: nullableStringSchema,
  available_days: z.array(z.string().trim().min(1)).nullable(),
  bar_revenue_share_enabled: z.boolean().nullable(),
  venue_amenities: z.array(venueAmenitySchema).default([]),
})

export const venuePreFilterInputSchema = z.object({
  event_plan: eventPlanSchema,
  candidate_venues: z.array(venueMatchingCandidateSchema),
  max_candidates: z.number().int().min(1).max(MAX_VENUE_CANDIDATES).default(MAX_VENUE_CANDIDATES),
})

export const preFilteredVenueSchema = venueMatchingCandidateSchema.extend({
  deterministic_score: z.number().int().min(0).max(100),
  estimated_minimum_cost_cents: z.number().int().nonnegative().nullable(),
  score_reasons: z.array(z.string().trim().min(1)),
})

export type VenueMatchingCandidate = z.infer<typeof venueMatchingCandidateSchema>
export type VenuePreFilterInput = z.input<typeof venuePreFilterInputSchema>
export type PreFilteredVenue = z.infer<typeof preFilteredVenueSchema>

export function preFilterVenues(input: VenuePreFilterInput): PreFilteredVenue[] {
  const parsed = venuePreFilterInputSchema.parse(input)
  const headcount = getTargetHeadcount(parsed.event_plan)
  const targetCity = normalizeCity(parsed.event_plan.city)

  return parsed.candidate_venues
    .filter((venue) => venue.is_published === true)
    .filter((venue) => passesCityFilter(venue, targetCity))
    .filter((venue) => passesCapacityFilter(venue, headcount))
    .map((venue) => scoreVenue(venue, parsed.event_plan, headcount, targetCity))
    .sort(compareScoredVenues)
    .slice(0, parsed.max_candidates)
}

function scoreVenue(
  venue: VenueMatchingCandidate,
  eventPlan: EventPlan,
  headcount: number | null,
  targetCity: string | null
): PreFilteredVenue {
  const estimatedCost = estimateMinimumVenueCostCents(venue)
  const scoreParts = [
    scoreCapacityFit(venue, headcount),
    scoreCityFit(venue, targetCity),
    scoreBudgetFit(estimatedCost, eventPlan.budget),
    scoreVenueTypeFit(venue, eventPlan.venue_type),
    scoreAvailableDayFit(venue, eventPlan.event_date),
    scoreCommercialFit(venue),
  ]
  const deterministicScore = clampScore(scoreParts.reduce((sum, part) => sum + part.score, 0))
  const scoreReasons = scoreParts.flatMap((part) => part.reason ? [part.reason] : [])

  return preFilteredVenueSchema.parse({
    ...venue,
    deterministic_score: deterministicScore,
    estimated_minimum_cost_cents: estimatedCost,
    score_reasons: scoreReasons,
  })
}

function getTargetHeadcount(eventPlan: EventPlan): number | null {
  return eventPlan.expected_attendance ?? eventPlan.headcount_max ?? eventPlan.headcount_min
}

function getVenueCapacity(venue: VenueMatchingCandidate): number | null {
  const capacities = [venue.standing_capacity, venue.seated_capacity].filter(
    (capacity): capacity is number => capacity !== null
  )

  if (capacities.length === 0) return null
  return Math.max(...capacities)
}

function passesCapacityFilter(venue: VenueMatchingCandidate, headcount: number | null): boolean {
  if (headcount === null) return true
  const capacity = getVenueCapacity(venue)
  if (capacity === null) return false
  return capacity >= headcount
}

function passesCityFilter(venue: VenueMatchingCandidate, targetCity: string | null): boolean {
  if (targetCity === null) return true
  return normalizeCity(venue.city) === targetCity
}

function estimateMinimumVenueCostCents(venue: VenueMatchingCandidate): number | null {
  if (venue.hourly_rate === null) return null
  const minimumHours = venue.minimum_hours && venue.minimum_hours > 0
    ? venue.minimum_hours
    : DEFAULT_EVENT_HOURS

  return Math.round(venue.hourly_rate * minimumHours)
}

function scoreCapacityFit(
  venue: VenueMatchingCandidate,
  headcount: number | null
): { score: number; reason: string | null } {
  const capacity = getVenueCapacity(venue)
  if (headcount === null) {
    return { score: 22, reason: 'Capacity could not be fully evaluated because headcount is unknown.' }
  }

  if (capacity === null) {
    return { score: 0, reason: 'Capacity is missing.' }
  }

  const ratio = capacity / headcount
  if (ratio >= 1 && ratio <= 1.5) {
    return { score: 35, reason: 'Capacity is tightly aligned with the expected headcount.' }
  }
  if (ratio <= 2.25) {
    return { score: 29, reason: 'Capacity gives the event moderate room to grow.' }
  }
  return { score: 20, reason: 'Capacity is workable but may feel oversized.' }
}

function scoreCityFit(
  venue: VenueMatchingCandidate,
  targetCity: string | null
): { score: number; reason: string | null } {
  if (targetCity === null) {
    return { score: 18, reason: 'City preference is unknown.' }
  }

  if (normalizeCity(venue.city) === targetCity) {
    return { score: 20, reason: 'Venue city matches the event plan.' }
  }

  return { score: 0, reason: 'Venue city does not match the event plan.' }
}

function scoreBudgetFit(
  estimatedCostCents: number | null,
  budgetCents: number | null
): { score: number; reason: string | null } {
  if (budgetCents === null || budgetCents <= 0) {
    return { score: 12, reason: 'Budget is unknown, so price fit needs confirmation.' }
  }

  if (estimatedCostCents === null || estimatedCostCents <= 0) {
    return { score: 10, reason: 'Venue pricing is missing and needs confirmation.' }
  }

  const ratio = estimatedCostCents / budgetCents
  if (ratio <= 0.65) {
    return { score: 15, reason: 'Estimated venue minimum is comfortably under budget.' }
  }
  if (ratio <= 1) {
    return { score: 20, reason: 'Estimated venue minimum is within the event budget.' }
  }

  return { score: Math.max(0, Math.round(20 - (ratio - 1) * 30)), reason: 'Estimated venue minimum may exceed budget.' }
}

function scoreVenueTypeFit(
  venue: VenueMatchingCandidate,
  targetVenueType: string | null
): { score: number; reason: string | null } {
  if (!targetVenueType) {
    return { score: 5, reason: 'Venue type preference is unknown.' }
  }

  const target = normalizeText(targetVenueType)
  const candidate = normalizeText(venue.venue_type)
  if (target && candidate && (candidate.includes(target) || target.includes(candidate))) {
    return { score: 10, reason: 'Venue type matches the requested format.' }
  }

  return { score: 3, reason: 'Venue type is not an exact match.' }
}

function scoreAvailableDayFit(
  venue: VenueMatchingCandidate,
  eventDate: string | null
): { score: number; reason: string | null } {
  const dayName = getDayName(eventDate)
  if (!dayName) {
    return { score: 5, reason: 'Event date is unknown, so availability day fit needs confirmation.' }
  }

  if (!venue.available_days || venue.available_days.length === 0) {
    return { score: 4, reason: 'Venue available days are missing.' }
  }

  const normalizedDays = venue.available_days.map(normalizeText)
  if (normalizedDays.includes(dayName)) {
    return { score: 7, reason: 'Venue accepts bookings on the requested day.' }
  }

  return { score: 0, reason: 'Venue may not accept bookings on the requested day.' }
}

function scoreCommercialFit(venue: VenueMatchingCandidate): { score: number; reason: string | null } {
  if (venue.offers_kickbacks || venue.bar_revenue_share_enabled || (venue.per_head_kickback ?? 0) > 0) {
    return { score: 8, reason: 'Venue has revenue-share or per-head economics available.' }
  }

  return { score: 3, reason: 'Venue economics appear to be standard rental terms.' }
}

function normalizeCity(value: string | null): string | null {
  const normalized = normalizeText(value)
  if (!normalized) return null

  if (['sf', 'sfo', 'san fran', 'san francisco'].includes(normalized)) {
    return 'san francisco'
  }

  return normalized
}

function normalizeText(value: string | null): string {
  return value
    ?.trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ') ?? ''
}

function getDayName(eventDate: string | null): string | null {
  if (!eventDate) return null

  const timestamp = Date.parse(eventDate)
  if (Number.isNaN(timestamp)) return null

  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
    new Date(timestamp).getUTCDay()
  ]
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function compareScoredVenues(first: PreFilteredVenue, second: PreFilteredVenue): number {
  if (second.deterministic_score !== first.deterministic_score) {
    return second.deterministic_score - first.deterministic_score
  }

  const firstCost = first.estimated_minimum_cost_cents ?? Number.POSITIVE_INFINITY
  const secondCost = second.estimated_minimum_cost_cents ?? Number.POSITIVE_INFINITY
  if (firstCost !== secondCost) return firstCost - secondCost

  return first.venue_name.localeCompare(second.venue_name)
}
