jest.mock('server-only', () => ({}))

import { archetypeFor } from '@/lib/planner/archetypes'
import { rankVenuesForArchetype, type VenueRankerVenueInput } from '@/lib/venues/venueRanker'

function makeVenue(overrides: Partial<VenueRankerVenueInput> & { id: string }): VenueRankerVenueInput {
  return {
    venue_name: overrides.id,
    venue_type: 'event_space',
    standing_capacity: 100,
    seated_capacity: 80,
    city: 'San Francisco',
    state: 'CA',
    hourly_rate: 100000,
    minimum_hours: 4,
    pricing_model: 'flat',
    unique_features_tags: [],
    ...overrides,
  }
}

describe('venue archetype ranker', () => {
  it('Networking mixer ranks bars/lounges higher than galleries', () => {
    const archetype = archetypeFor('happy hour')
    const ranked = rankVenuesForArchetype({
      archetype,
      plan: { guest_count: 90, event_type: 'networking mixer' },
      venues: [
        makeVenue({
          id: 'gallery',
          venue_type: 'gallery',
          standing_capacity: 110,
          unique_features_tags: ['gallery_lighting'],
        }),
        makeVenue({
          id: 'bar',
          venue_type: 'bar',
          standing_capacity: 120,
          bar_revenue_share_enabled: true,
          unique_features_tags: ['standing_room', 'full_bar'],
        }),
      ],
    })

    expect(ranked[0].venue.id).toBe('bar')
  })

  it('Founder dinner: private_dining_room scores higher than open restaurant for 20 guests', () => {
    const archetype = archetypeFor('founders dinner')
    const ranked = rankVenuesForArchetype({
      archetype,
      plan: { guest_count: 20, event_type: 'founder dinner' },
      venues: [
        makeVenue({
          id: 'open-restaurant',
          venue_type: 'restaurant',
          seated_capacity: 90,
          standing_capacity: 140,
          unique_features_tags: ['menu', 'bar'],
          pricing_model: 'flat',
        }),
        makeVenue({
          id: 'private-room',
          venue_type: 'private_dining_room',
          seated_capacity: 24,
          standing_capacity: 30,
          unique_features_tags: ['private_room', 'seated_dining', 'menu'],
          pricing_model: 'prix_fixe',
        }),
      ],
    })

    expect(ranked[0].venue.id).toBe('private-room')
  })

  it('Hackathon: campus venue with breakout rooms beats coworking with no breakouts', () => {
    const archetype = archetypeFor('hackathon')
    const ranked = rankVenuesForArchetype({
      archetype,
      plan: { guest_count: 120, event_type: 'hackathon' },
      venues: [
        makeVenue({
          id: 'plain-coworking',
          venue_type: 'coworking_event_space',
          standing_capacity: 180,
          unique_features_tags: ['wifi'],
        }),
        makeVenue({
          id: 'campus',
          venue_type: 'campus',
          standing_capacity: 240,
          unique_features_tags: ['wifi', 'power', 'breakout_rooms'],
          pricing_model: 'flat',
        }),
      ],
    })

    expect(ranked[0].venue.id).toBe('campus')
  })

  it('Pop-up market: capacity 2-3x guest_count is the sweet spot', () => {
    const archetype = archetypeFor('pop up market')
    const ranked = rankVenuesForArchetype({
      archetype,
      plan: { guest_count: 100, event_type: 'pop up' },
      venues: [
        makeVenue({
          id: 'tight-market',
          venue_type: 'market_hall',
          standing_capacity: 125,
          unique_features_tags: ['foot_traffic', 'load_in', 'storage', 'permits'],
        }),
        makeVenue({
          id: 'sweet-spot-market',
          venue_type: 'market_hall',
          standing_capacity: 250,
          unique_features_tags: ['foot_traffic', 'load_in', 'storage', 'permits'],
        }),
        makeVenue({
          id: 'oversized-market',
          venue_type: 'market_hall',
          standing_capacity: 500,
          unique_features_tags: ['foot_traffic', 'load_in', 'storage', 'permits'],
        }),
      ],
    })

    expect(ranked[0].venue.id).toBe('sweet-spot-market')
  })

  it('Commercial model alignment: bar with rev share scores higher than bar with flat rental for a mixer', () => {
    const archetype = archetypeFor('mixer')
    const ranked = rankVenuesForArchetype({
      archetype,
      plan: { guest_count: 80, event_type: 'mixer' },
      venues: [
        makeVenue({
          id: 'flat-bar',
          venue_type: 'bar',
          standing_capacity: 100,
          pricing_model: 'flat',
          unique_features_tags: ['standing_room', 'full_bar'],
        }),
        makeVenue({
          id: 'rev-share-bar',
          venue_type: 'bar',
          standing_capacity: 100,
          bar_revenue_share_enabled: true,
          unique_features_tags: ['standing_room', 'full_bar'],
        }),
      ],
    })

    expect(ranked[0].venue.id).toBe('rev-share-bar')
    expect(ranked[0].score.commercial_model_alignment_score).toBeGreaterThan(
      ranked[1].score.commercial_model_alignment_score
    )
  })

  it('Builder with p75=180 and stated guest_count=50 filters out venues below projected attendance', () => {
    const archetype = archetypeFor('mixer')
    const ranked = rankVenuesForArchetype({
      archetype,
      plan: { guest_count: 50, event_type: 'mixer' },
      venues: [
        makeVenue({
          id: 'fits-stated-only',
          venue_type: 'bar',
          standing_capacity: 120,
          bar_revenue_share_enabled: true,
          unique_features_tags: ['standing_room', 'full_bar'],
        }),
        makeVenue({
          id: 'fits-history',
          venue_type: 'bar',
          standing_capacity: 220,
          bar_revenue_share_enabled: true,
          unique_features_tags: ['standing_room', 'full_bar'],
        }),
      ],
      context: {
        builder_attendance: {
          builder_id: 'builder-1',
          archetype_key: 'networking_mixer',
          sample_size: 10,
          avg_tickets_sold: 150,
          median_tickets_sold: 160,
          p75_tickets_sold: 180,
          p95_tickets_sold: 220,
          last_event_at: '2026-01-01',
          confidence: 'high',
        },
      },
    })

    expect(ranked).toHaveLength(1)
    expect(ranked[0].venue.id).toBe('fits-history')
    expect(ranked[0].score.calibration_signal).toBe('historical_higher')
    expect(ranked[0].score.score_breakdown.capacity.details.projected_attendance).toBe(180)
  })

  it('Builder with no history behaves like stated-count ranking', () => {
    const archetype = archetypeFor('mixer')
    const venues = [
      makeVenue({
        id: 'smaller-bar',
        venue_type: 'bar',
        standing_capacity: 70,
        bar_revenue_share_enabled: true,
        unique_features_tags: ['standing_room', 'full_bar'],
      }),
      makeVenue({
        id: 'larger-bar',
        venue_type: 'bar',
        standing_capacity: 120,
        bar_revenue_share_enabled: true,
        unique_features_tags: ['standing_room', 'full_bar'],
      }),
    ]
    const withoutHistory = rankVenuesForArchetype({
      archetype,
      plan: { guest_count: 50, event_type: 'mixer' },
      venues,
    })
    const withEmptyHistory = rankVenuesForArchetype({
      archetype,
      plan: { guest_count: 50, event_type: 'mixer' },
      venues,
      context: {
        builder_attendance: {
          builder_id: 'builder-1',
          archetype_key: 'networking_mixer',
          sample_size: 0,
          avg_tickets_sold: 0,
          median_tickets_sold: 0,
          p75_tickets_sold: 0,
          p95_tickets_sold: 0,
          last_event_at: null,
          confidence: 'low',
        },
      },
    })

    expect(withEmptyHistory.map((item) => item.venue.id)).toEqual(
      withoutHistory.map((item) => item.venue.id)
    )
    expect(withEmptyHistory[0].score.calibration_signal).toBe('no_history')
  })
})
