jest.mock('server-only', () => ({}))

import { preFilterVenues, type VenueMatchingCandidate } from '@/lib/venues/venuePreFilter'
import type { EventPlan } from '@/lib/ai/types'

const baseEventPlan: EventPlan = {
  event_name: 'Founder dinner',
  expected_attendance: 80,
  city: 'SF',
  venue_type: 'restaurant',
  budget: 400000,
  event_date: '2026-06-19',
  monetization_model: 'ticketed',
  headcount_min: 70,
  headcount_max: 90,
  ticket_price_target: 7500,
  profit_goal: 100000,
}

function makeVenue(overrides: Partial<VenueMatchingCandidate> = {}): VenueMatchingCandidate {
  return {
    id: 'venue-1',
    venue_name: 'Mission Hall',
    venue_type: 'restaurant',
    standing_capacity: 100,
    seated_capacity: 85,
    city: 'San Francisco',
    state: 'CA',
    hourly_rate: 125000,
    minimum_hours: 3,
    is_published: true,
    per_head_chi_cents: null,
    offers_chis: false,
    deposit_percentage: 25,
    cancellation_terms: 'Refundable until 14 days out.',
    available_days: ['friday', 'saturday'],
    bar_consumption_share_enabled: false,
    venue_amenities: [{ amenity_name: 'private dining room' }],
    ...overrides,
  }
}

describe('preFilterVenues', () => {
  it('filters by published status, city, and capacity before scoring', () => {
    const result = preFilterVenues({
      event_plan: baseEventPlan,
      candidate_venues: [
        makeVenue({ id: 'matching' }),
        makeVenue({ id: 'unpublished', is_published: false }),
        makeVenue({ id: 'wrong-city', city: 'Oakland' }),
        makeVenue({ id: 'too-small', standing_capacity: 79, seated_capacity: 60 }),
      ],
    })

    expect(result.map((venue) => venue.id)).toEqual(['matching'])
  })

  it('caps the LLM candidate set at 10 venues after deterministic scoring', () => {
    const candidates = Array.from({ length: 20 }, (_, index) => makeVenue({
      id: `venue-${index}`,
      venue_name: `SF Venue ${index}`,
      standing_capacity: 90 + index,
      seated_capacity: 80 + index,
      hourly_rate: 100000 + index * 5000,
      offers_chis: index % 2 === 0,
      bar_consumption_share_enabled: index % 3 === 0,
    }))

    const result = preFilterVenues({
      event_plan: baseEventPlan,
      candidate_venues: candidates,
    })

    expect(result).toHaveLength(10)
    expect(result.every((venue) => venue.city === 'San Francisco')).toBe(true)
    expect(result.every((venue) => venue.deterministic_score >= 0 && venue.deterministic_score <= 100)).toBe(true)
    expect(result[0].deterministic_score).toBeGreaterThanOrEqual(result[9].deterministic_score)
  })

  it('treats SF and San Francisco as the same city', () => {
    const result = preFilterVenues({
      event_plan: { ...baseEventPlan, city: 'San Francisco' },
      candidate_venues: [makeVenue({ id: 'sf-short', city: 'SF' })],
    })

    expect(result.map((venue) => venue.id)).toEqual(['sf-short'])
  })
})
