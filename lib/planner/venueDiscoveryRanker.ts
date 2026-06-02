export type VenueDiscoverySource = 'onboarded' | 'discovery'

export type VenueDiscoveryPlanInput = {
  headcount?: number | null
  guest_count?: number | null
  neighborhood?: string | null
  area?: string | null
  budget_cap_cents?: number | null
  budget_cents?: number | null
  event_type?: string | null
  vibe_tags?: string[] | null
  must_haves?: string[] | null
}

export type VenueSignalAggregate = {
  emailsSent30d: number
  replies30d: number
  bookings30d: number
  declines30d: number
  stale30d: number
  avgReplyLatencySeconds: number | null
}

export type VenueDiscoveryCandidate = {
  id: string
  source: VenueDiscoverySource
  name: string
  neighborhood: string | null
  city: string | null
  capacity_seated?: number | null
  capacity_standing?: number | null
  capacity_cocktail?: number | null
  capacity?: number | null
  price_hint_cents_low?: number | null
  price_hint_cents_high?: number | null
  estimate_cents?: number | null
  vibe_tags?: string[] | null
  last_successful_booking_at?: string | null
  claimed_venue_id?: string | null
  contact_email?: string | null
  website?: string | null
  signals?: VenueSignalAggregate | null
  metadata?: Record<string, unknown>
}

export type RankedVenueDiscoveryCandidate = {
  candidate_id: string
  source: VenueDiscoverySource
  target_source: VenueDiscoverySource
  target_id: string
  discovery_venue_id: string | null
  claimed_venue_id: string | null
  name: string
  neighborhood: string | null
  city: string | null
  score: number
  confidence: number
  reasoning: string[]
  capacity: number | null
  response_rate_30d: number | null
  booking_rate_30d: number | null
  avg_reply_latency_seconds: number | null
  contact_email: string | null
  website: string | null
  metadata: Record<string, unknown>
}

export type RankVenueDiscoveryInput = {
  plan: VenueDiscoveryPlanInput
  candidates: VenueDiscoveryCandidate[]
  limit?: number
}

/**
 * Deterministically ranks DB-backed venue candidates. It only returns rows from
 * the supplied candidate set, so an LLM layer cannot invent a venue.
 */
export function rankVenueDiscoveryCandidates(input: RankVenueDiscoveryInput): RankedVenueDiscoveryCandidate[] {
  const limit = input.limit ?? 12
  const seen = new Set<string>()
  return input.candidates
    .filter((candidate) => {
      const key = `${candidate.source}:${candidate.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return Boolean(candidate.id && candidate.name)
    })
    .map((candidate) => scoreCandidate(input.plan, candidate))
    .sort((first, second) => {
      if (second.score !== first.score) return second.score - first.score
      return first.name.localeCompare(second.name)
    })
    .slice(0, Math.max(limit, 0))
}

function scoreCandidate(
  plan: VenueDiscoveryPlanInput,
  candidate: VenueDiscoveryCandidate
): RankedVenueDiscoveryCandidate {
  let score = 0.25
  let confidence = 0.55
  const reasoning: string[] = []
  const headcount = readPositiveNumber(plan.headcount ?? plan.guest_count)
  const budgetCents = readPositiveNumber(plan.budget_cap_cents ?? plan.budget_cents)
  const preferredArea = normalize(plan.neighborhood ?? plan.area)
  const capacity = readCapacity(candidate)
  const signals = normalizeSignals(candidate.signals)

  if (candidate.source === 'onboarded') {
    score += 0.1
    confidence += 0.05
    reasoning.push('Onboarded venue; easier to route next steps after approval.')
  } else {
    reasoning.push('Discovery venue; outreach is creator-approved before any contact.')
  }

  if (headcount && capacity) {
    if (capacity >= headcount && capacity <= Math.max(headcount * 2.5, headcount + 35)) {
      score += 0.24
      confidence += 0.12
      reasoning.push(`Capacity fits ${headcount.toLocaleString()} guests.`)
    } else if (capacity >= headcount) {
      score += 0.16
      confidence += 0.08
      reasoning.push(`Capacity clears ${headcount.toLocaleString()} guests with extra room.`)
    } else {
      score -= 0.22
      confidence -= 0.12
      reasoning.push(`Capacity may be tight for ${headcount.toLocaleString()} guests.`)
    }
  } else if (headcount) {
    score += 0.03
    confidence -= 0.08
    reasoning.push('Capacity needs verification.')
  }

  const candidateArea = normalize(candidate.neighborhood ?? candidate.city)
  if (preferredArea && candidateArea) {
    if (candidateArea === preferredArea || candidateArea.includes(preferredArea) || preferredArea.includes(candidateArea)) {
      score += 0.18
      confidence += 0.08
      reasoning.push(`Matches ${plan.neighborhood ?? plan.area}.`)
    } else {
      score -= 0.04
      reasoning.push(`Outside requested area; still viable if the organizer is flexible.`)
    }
  }

  const desiredVibes = buildDesiredVibes(plan)
  const candidateTags = normalizeStringArray(candidate.vibe_tags)
  const overlap = candidateTags.filter((tag) => desiredVibes.has(tag))
  if (overlap.length > 0) {
    score += Math.min(0.2, overlap.length * 0.07)
    confidence += Math.min(0.1, overlap.length * 0.03)
    reasoning.push(`Matches vibe: ${overlap.slice(0, 3).join(', ')}.`)
  } else if (desiredVibes.size > 0 && candidateTags.length > 0) {
    score += 0.02
    reasoning.push('Vibe tags are adjacent but not exact.')
  }

  const estimateHigh = readPositiveNumber(candidate.price_hint_cents_high ?? candidate.estimate_cents)
  const estimateLow = readPositiveNumber(candidate.price_hint_cents_low ?? candidate.estimate_cents)
  if (budgetCents && (estimateHigh || estimateLow)) {
    const venueBudget = Math.round(budgetCents * 0.55)
    const estimate = estimateHigh ?? estimateLow ?? 0
    if (estimate <= venueBudget) {
      score += 0.15
      confidence += 0.07
      reasoning.push('Likely within the venue budget window.')
    } else if ((estimateLow ?? estimate) <= budgetCents) {
      score += 0.06
      reasoning.push('Could fit budget depending on quote and minimums.')
    } else {
      score -= 0.08
      reasoning.push('Price hint may stretch the current budget.')
    }
  }

  if (signals.emailsSent30d > 0) {
    const responseRate = signals.replies30d / signals.emailsSent30d
    const bookingRate = signals.bookings30d / signals.emailsSent30d
    score += Math.min(0.12, responseRate * 0.12)
    score += Math.min(0.1, bookingRate * 0.1)
    score -= Math.min(0.06, (signals.declines30d + signals.stale30d) * 0.015)
    confidence += 0.08
    if (responseRate > 0) reasoning.push(`${Math.round(responseRate * 100)}% recent response rate.`)
    if (bookingRate > 0) reasoning.push(`${Math.round(bookingRate * 100)}% recent booking conversion.`)
    if (signals.avgReplyLatencySeconds && signals.avgReplyLatencySeconds <= 48 * 60 * 60) {
      score += 0.04
      reasoning.push('Historically replies within two days.')
    }
  }

  if (candidate.last_successful_booking_at) {
    const ageDays = (Date.now() - Date.parse(candidate.last_successful_booking_at)) / (24 * 60 * 60 * 1000)
    if (Number.isFinite(ageDays) && ageDays <= 90) {
      score += 0.08
      confidence += 0.04
      reasoning.push('Recent successful booking signal.')
    }
  }

  const boundedScore = round(Math.max(0, Math.min(score, 1)))
  const boundedConfidence = round(Math.max(0.25, Math.min(confidence, 0.98)))

  return {
    candidate_id: candidate.id,
    source: candidate.source,
    target_source: candidate.source,
    target_id: candidate.source === 'discovery' ? candidate.id : candidate.claimed_venue_id ?? candidate.id,
    discovery_venue_id: candidate.source === 'discovery' ? candidate.id : null,
    claimed_venue_id: candidate.claimed_venue_id ?? null,
    name: candidate.name,
    neighborhood: candidate.neighborhood,
    city: candidate.city,
    score: boundedScore,
    confidence: boundedConfidence,
    reasoning: reasoning.slice(0, 5),
    capacity,
    response_rate_30d: signals.emailsSent30d > 0 ? round(signals.replies30d / signals.emailsSent30d) : null,
    booking_rate_30d: signals.emailsSent30d > 0 ? round(signals.bookings30d / signals.emailsSent30d) : null,
    avg_reply_latency_seconds: signals.avgReplyLatencySeconds,
    contact_email: candidate.contact_email ?? null,
    website: candidate.website ?? null,
    metadata: candidate.metadata ?? {},
  }
}

function readCapacity(candidate: VenueDiscoveryCandidate) {
  return readPositiveNumber(
    candidate.capacity_standing
      ?? candidate.capacity_cocktail
      ?? candidate.capacity_seated
      ?? candidate.capacity
  )
}

function normalizeSignals(value: VenueSignalAggregate | null | undefined): VenueSignalAggregate {
  return {
    emailsSent30d: Math.max(0, Math.round(readPositiveNumber(value?.emailsSent30d) ?? 0)),
    replies30d: Math.max(0, Math.round(readPositiveNumber(value?.replies30d) ?? 0)),
    bookings30d: Math.max(0, Math.round(readPositiveNumber(value?.bookings30d) ?? 0)),
    declines30d: Math.max(0, Math.round(readPositiveNumber(value?.declines30d) ?? 0)),
    stale30d: Math.max(0, Math.round(readPositiveNumber(value?.stale30d) ?? 0)),
    avgReplyLatencySeconds: readPositiveNumber(value?.avgReplyLatencySeconds),
  }
}

function buildDesiredVibes(plan: VenueDiscoveryPlanInput) {
  return new Set([
    ...normalizeStringArray(plan.vibe_tags),
    ...normalizeStringArray(plan.must_haves),
    ...tokenize(plan.event_type),
  ])
}

function normalizeStringArray(values: string[] | null | undefined) {
  return (values ?? [])
    .map(normalize)
    .filter((value): value is string => Boolean(value))
}

function tokenize(value: string | null | undefined) {
  return (normalize(value)?.split(/\s+/).filter(Boolean) ?? [])
}

function normalize(value: string | null | undefined) {
  if (!value) return null
  const normalized = value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized || null
}

function readPositiveNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  return null
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
