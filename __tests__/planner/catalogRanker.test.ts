import { rankCatalogPartners } from '@/lib/planner/catalogRanker'

describe('rankCatalogPartners', () => {
  const plan = {
    headcount: 50,
    area: 'Hayes Valley or Mission',
    budget_cents: 1_000_000,
    event_type: 'mixer',
    must_haves: ['AV', 'rooftop'],
    food_responsibility: 'Organizer prepays food/beverage',
    venue_terms: 'flat rental',
    date_window: 'June 12',
  }

  const baseVenue = {
    allows_event_type: ['networking mixer'],
    terms_supported: ['flat_rental'],
    is_published: true,
    is_claimed: true,
    response_rate: 0.9,
  }

  it('filters under-capacity venues instead of penalizing them', () => {
    const result = rankCatalogPartners({
      plan,
      venues: [
        {
          ...baseVenue,
          id: 'venue-under-capacity',
          venue_name: 'Tiny Hayes Room',
          city: 'Hayes Valley',
          standing_capacity: 25,
          hourly_rate: 50_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop'],
        },
      ],
      vendors: [],
    })

    expect(result.recommendations.map((recommendation) => recommendation.partner_id)).not.toContain(
      'venue-under-capacity'
    )
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          partner_id: 'venue-under-capacity',
          blocking_issues: expect.arrayContaining(['Capacity 25 is below 50 guests']),
        }),
      ])
    )
  })

  it('labels over-budget venue matches as Stretch, not Best fit', () => {
    const result = rankCatalogPartners({
      plan,
      venues: [
        {
          ...baseVenue,
          id: 'venue-over-budget',
          venue_name: 'Mission Premium Hall',
          city: 'Mission',
          standing_capacity: 90,
          hourly_rate: 200_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop', 'bar'],
        },
      ],
      vendors: [],
    })

    expect(result.recommendations[0]).toEqual(
      expect.objectContaining({
        partner_id: 'venue-over-budget',
        fit_label: 'Stretch',
      })
    )
  })

  it('labels exact venue matches as Best fit', () => {
    const result = rankCatalogPartners({
      plan,
      venues: [
        {
          ...baseVenue,
          id: 'venue-exact-match',
          venue_name: 'Hayes Rooftop Studio',
          city: 'Hayes Valley',
          standing_capacity: 80,
          hourly_rate: 100_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop', 'bar', 'kitchen'],
        },
      ],
      vendors: [],
    })

    expect(result.recommendations[0]).toEqual(
      expect.objectContaining({
        partner_id: 'venue-exact-match',
        fit_label: 'Best fit',
        blocking_issues: [],
      })
    )
  })

  it('matches multi-area input against both Hayes Valley and Mission venues', () => {
    const result = rankCatalogPartners({
      plan,
      venues: [
        {
          ...baseVenue,
          id: 'venue-hayes',
          venue_name: 'Hayes Rooftop Studio',
          city: 'Hayes Valley',
          standing_capacity: 80,
          hourly_rate: 100_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop'],
        },
        {
          ...baseVenue,
          id: 'venue-mission',
          venue_name: 'Mission Social Loft',
          city: 'Mission',
          standing_capacity: 90,
          hourly_rate: 110_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop'],
        },
      ],
      vendors: [],
    })

    expect(result.recommendations.map((recommendation) => recommendation.partner_id)).toEqual(
      expect.arrayContaining(['venue-hayes', 'venue-mission'])
    )
  })

  it('does not hard-filter venues when the organizer asks the agent to recommend the model', () => {
    const result = rankCatalogPartners({
      plan: {
        ...plan,
        venue_terms: 'Recommend best model',
      },
      venues: [
        {
          ...baseVenue,
          id: 'venue-model-compare',
          venue_name: 'Mission Flexible Hall',
          city: 'Mission',
          standing_capacity: 90,
          hourly_rate: 100_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop'],
        },
      ],
      vendors: [],
    })

    expect(result.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          partner_id: 'venue-model-compare',
          blocking_issues: [],
        }),
      ])
    )
  })

  it('compares venue commercial models and exposes the recommended model', () => {
    const result = rankCatalogPartners({
      plan: {
        ...plan,
        headcount: 150,
        guest_count: 150,
        budget_cents: 1_000_000,
        ticketing_model: 'Paid tickets',
        food_responsibility: 'Cash bar',
        venue_terms: 'Flexible',
        revenue_share: 'Recommend best model',
      },
      venues: [
        {
          ...baseVenue,
          id: 'venue-per-head',
          venue_name: 'Hayes Volume Bar',
          city: 'Hayes Valley',
          description: 'Bar-forward mixer venue with AV and rooftop access',
          standing_capacity: 180,
          hourly_rate: 200_000,
          minimum_hours: 4,
          per_head_kickback_cents: 800,
          unique_features_tags: ['AV', 'rooftop', 'bar'],
        },
      ],
      vendors: [],
    })

    expect(result.recommendations[0]).toEqual(
      expect.objectContaining({
        partner_id: 'venue-per-head',
        estimate_cents: 40_000,
        metadata: expect.objectContaining({
          category: 'per_head_kickback',
          commercial_model: 'per_head_kickback',
          commercial_model_label: 'Per-head kickback',
          category_rank: 1,
          compared_models: expect.arrayContaining([
            expect.objectContaining({ model: 'flat_rental' }),
            expect.objectContaining({ model: 'per_head_kickback' }),
          ]),
        }),
      })
    )
  })

  it('returns top vendors per needed service category before duplicate-category vendors', () => {
    const result = rankCatalogPartners({
      plan: {
        ...plan,
        must_haves: ['catering', 'AV'],
      },
      venues: [],
      vendors: [
        {
          id: 'vendor-catering-1',
          name: 'Saffron Catering',
          service_type: 'catering',
          bio: 'Preferred catering partner for mixers with excellent food stations',
          base_rate: 90_000,
          is_claimed: true,
          response_rate: 0.95,
        },
        {
          id: 'vendor-catering-2',
          name: 'Premium Catering Co',
          service_type: 'catering',
          bio: 'Premium catering and bar service',
          base_rate: 95_000,
          is_claimed: true,
          response_rate: 0.92,
        },
        {
          id: 'vendor-av-1',
          name: 'Signal AV',
          service_type: 'av_tech',
          bio: 'AV, projector, mic, speaker, and check-in support',
          base_rate: 80_000,
          is_claimed: true,
          response_rate: 0.7,
        },
      ],
      venueLimit: 0,
      vendorLimit: 2,
    })

    expect(result.recommendations.map((recommendation) => recommendation.partner_id)).toEqual([
      'vendor-catering-1',
      'vendor-av-1',
    ])
    expect(result.recommendations.map((recommendation) => recommendation.metadata)).toEqual([
      expect.objectContaining({ category: 'catering', category_rank: 1 }),
      expect.objectContaining({ category: 'av_tech', category_rank: 1 }),
    ])
  })

  it('prioritizes restaurant and private dining signals for dinner plans', () => {
    const result = rankCatalogPartners({
      plan: {
        ...plan,
        event_type: 'dinner',
        must_haves: ['private room'],
        food_responsibility: 'Guests pay venue directly',
      },
      venues: [
        {
          ...baseVenue,
          allows_event_type: ['dinner'],
          id: 'venue-generic-loft',
          venue_name: 'Generic Event Loft',
          city: 'Mission',
          description: 'Flexible event loft with AV and open floor plan',
          standing_capacity: 80,
          hourly_rate: 100_000,
          minimum_hours: 4,
          unique_features_tags: ['AV'],
        },
        {
          ...baseVenue,
          allows_event_type: ['private dinner'],
          id: 'venue-private-dining',
          venue_name: 'Mission Private Dining Room',
          city: 'Mission',
          description: 'Restaurant private dining room with menu, kitchen, wine, bar, and semi-private seating',
          standing_capacity: 70,
          hourly_rate: 100_000,
          minimum_hours: 4,
          unique_features_tags: ['private room', 'menu', 'bar'],
        },
      ],
      vendors: [],
      venueLimit: 2,
    })

    expect(result.recommendations[0]).toEqual(
      expect.objectContaining({
        partner_id: 'venue-private-dining',
        metadata: expect.objectContaining({
          dinner_score: expect.any(Number),
        }),
      })
    )
  })
})
