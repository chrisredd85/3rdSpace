jest.mock('server-only', () => ({}))

import { archetypeFor } from '@/lib/planner/archetypes'
import {
  rankVenuesForArchetype,
  scoreVenueAgainstArchetype,
  type VenueRankerVenueInput,
} from '@/lib/venues/venueRanker'

function venue(overrides: Partial<VenueRankerVenueInput> & { id: string }): VenueRankerVenueInput {
  return {
    id: overrides.id,
    venue_name: overrides.id,
    venue_type: 'event_space',
    standing_capacity: 200,
    seated_capacity: 120,
    city: 'San Francisco',
    state: 'CA',
    hourly_rate: 100000,
    pricing_model: 'flat',
    unique_features_tags: [],
    ...overrides,
  }
}

describe('venue operational signal scoring', () => {
  it('scores a hands-on workshop studio above a theater-style gallery', () => {
    const archetype = archetypeFor('workshop')
    const plan = {
      guest_count: 40,
      event_type: 'workshop',
      metadata: { matching_signals: { setup_format: 'hands_on' } },
    }
    const galleryScore = scoreVenueAgainstArchetype({
      archetype,
      plan,
      venue: venue({
        id: 'gallery',
        venue_type: 'gallery',
        unique_features_tags: ['rows_of_chairs', 'projector'],
      }),
    })
    const studioScore = scoreVenueAgainstArchetype({
      archetype,
      plan,
      venue: venue({
        id: 'studio',
        venue_type: 'studio',
        unique_features_tags: ['work surfaces', 'tables', 'power outlets', 'wifi'],
      }),
    })

    expect(galleryScore.hard_gate_failures.join(' ')).toMatch(/work surfaces/i)
    expect(studioScore.hard_gate_failures).toEqual([])
    expect(studioScore.score).toBeGreaterThan(galleryScore.score)
  })

  it('hard-gates demo day venues without power, tables, and internet for demo stations', () => {
    const archetype = archetypeFor('demo day')
    const ranked = rankVenuesForArchetype({
      archetype,
      plan: {
        guest_count: 150,
        event_type: 'demo day',
        metadata: { matching_signals: { demo_stations_needed: true } },
      },
      venues: [
        venue({
          id: 'auditorium-only',
          venue_type: 'auditorium',
          unique_features_tags: ['stage', 'seating'],
        }),
        venue({
          id: 'expo-ready',
          venue_type: 'expo_space',
          unique_features_tags: ['stage', 'tables', 'power outlets', 'wifi', 'demo stations'],
        }),
      ],
    })

    expect(ranked.map((item) => item.venue.id)).toEqual(['expo-ready'])
  })

  it('hard-gates live nightlife plans when a club has no live-band stage', () => {
    const archetype = archetypeFor('club night')
    const ranked = rankVenuesForArchetype({
      archetype,
      plan: {
        guest_count: 180,
        event_type: 'nightlife',
        metadata: { matching_signals: { music_format: 'live' } },
      },
      venues: [
        venue({
          id: 'dance-only-club',
          venue_type: 'club',
          unique_features_tags: ['dj booth', 'full bar', 'late hours'],
        }),
        venue({
          id: 'live-ready-club',
          venue_type: 'club',
          unique_features_tags: ['live band stage', 'full bar', 'late hours', 'green room'],
        }),
      ],
    })

    expect(ranked.map((item) => item.venue.id)).toEqual(['live-ready-club'])
  })
})
