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
          hourly_rate_cents: 50_000,
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

  it('keeps venues with missing capacity with a confirmation penalty', () => {
    const result = rankCatalogPartners({
      plan,
      venues: [
        {
          ...baseVenue,
          id: 'venue-unknown-capacity',
          venue_name: 'Mission Discovery Bar',
          city: 'Mission',
          standing_capacity: null,
          seated_capacity: null,
          hourly_rate_cents: 50_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop'],
        },
      ],
      vendors: [],
    })

    expect(result.recommendations[0]).toEqual(expect.objectContaining({
      partner_id: 'venue-unknown-capacity',
      capacity: null,
      capacity_known: false,
      blocking_issues: [],
      metadata: expect.objectContaining({
        capacity_known: false,
        capacity_score_penalty: 15,
      }),
    }))
  })

  it('uses high-confidence inferred capacity when direct capacity is missing', () => {
    const result = rankCatalogPartners({
      plan,
      venues: [
        {
          ...baseVenue,
          id: 'venue-inferred-capacity',
          venue_name: 'Downtown Discovery Lounge',
          city: 'Mission',
          standing_capacity: null,
          seated_capacity: null,
          inferred_capacity_standing: 90,
          inferred_capacity_seated: 42,
          capacity_inference_confidence: 0.82,
          capacity_inference_admin_status: 'pending',
          hourly_rate_cents: 50_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop'],
        },
      ],
      vendors: [],
    })

    expect(result.recommendations[0]).toEqual(expect.objectContaining({
      partner_id: 'venue-inferred-capacity',
      capacity: 90,
      capacity_known: true,
      blocking_issues: [],
      metadata: expect.objectContaining({
        capacity_known: true,
        capacity_source: 'inferred',
        capacity_inference_confidence: 0.82,
        capacity_inference_admin_status: 'pending',
        capacity_score_penalty: 0,
      }),
    }))
  })

  it('does not trust low-confidence inferred capacity until reviewed', () => {
    const result = rankCatalogPartners({
      plan,
      venues: [
        {
          ...baseVenue,
          id: 'venue-low-confidence-capacity',
          venue_name: 'Downtown Thin Lead',
          city: 'Mission',
          standing_capacity: null,
          seated_capacity: null,
          inferred_capacity_standing: 90,
          inferred_capacity_seated: 42,
          capacity_inference_confidence: 0.45,
          capacity_inference_admin_status: 'pending',
          hourly_rate_cents: 50_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop'],
        },
      ],
      vendors: [],
    })

    expect(result.recommendations[0]).toEqual(expect.objectContaining({
      partner_id: 'venue-low-confidence-capacity',
      capacity: null,
      capacity_known: false,
      blocking_issues: [],
      metadata: expect.objectContaining({
        capacity_known: false,
        capacity_source: null,
        capacity_inference_confidence: 0.45,
        capacity_inference_admin_status: 'pending',
        capacity_score_penalty: 15,
      }),
    }))
  })

  it('uses admin-approved inferred capacity even when model confidence is low', () => {
    const result = rankCatalogPartners({
      plan,
      venues: [
        {
          ...baseVenue,
          id: 'venue-approved-inferred-capacity',
          venue_name: 'Downtown Reviewed Lead',
          city: 'Mission',
          standing_capacity: null,
          seated_capacity: null,
          inferred_capacity_standing: 78,
          inferred_capacity_seated: 36,
          capacity_inference_confidence: 0.48,
          capacity_inference_admin_status: 'approved',
          hourly_rate_cents: 50_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop'],
        },
      ],
      vendors: [],
    })

    expect(result.recommendations[0]).toEqual(expect.objectContaining({
      partner_id: 'venue-approved-inferred-capacity',
      capacity: 78,
      capacity_known: true,
      blocking_issues: [],
      metadata: expect.objectContaining({
        capacity_known: true,
        capacity_source: 'inferred',
        capacity_inference_admin_status: 'approved',
        capacity_score_penalty: 0,
      }),
    }))
  })

  it('scores known-capacity venues above otherwise similar unknown-capacity venues', () => {
    const result = rankCatalogPartners({
      plan,
      venues: [
        {
          ...baseVenue,
          id: 'venue-known-capacity',
          venue_name: 'Mission Known Bar',
          city: 'Mission',
          standing_capacity: 80,
          hourly_rate_cents: 50_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop'],
        },
        {
          ...baseVenue,
          id: 'venue-unknown-capacity',
          venue_name: 'Mission Unknown Bar',
          city: 'Mission',
          standing_capacity: null,
          seated_capacity: null,
          hourly_rate_cents: 50_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop'],
        },
      ],
      vendors: [],
      venueLimit: 2,
    })

    expect(result.recommendations.map((recommendation) => recommendation.partner_id)).toEqual([
      'venue-known-capacity',
      'venue-unknown-capacity',
    ])
    expect(result.recommendations[0].score).toBeGreaterThan(result.recommendations[1].score)
  })

  it('keeps venues with no amenity data with a confirmation penalty', () => {
    const result = rankCatalogPartners({
      plan,
      venues: [
        {
          ...baseVenue,
          id: 'venue-thin-places-lead',
          venue_name: 'Downtown Places Bar',
          city: 'Mission',
          standing_capacity: 80,
          hourly_rate_cents: 50_000,
          minimum_hours: 4,
        },
      ],
      vendors: [],
    })

    expect(result.recommendations[0]).toEqual(expect.objectContaining({
      partner_id: 'venue-thin-places-lead',
      blocking_issues: [],
      metadata: expect.objectContaining({
        amenity_known: false,
        amenity_score_penalty: 10,
      }),
    }))
  })

  it('rejects venues with known amenity data missing required amenities', () => {
    const result = rankCatalogPartners({
      plan,
      venues: [
        {
          ...baseVenue,
          id: 'venue-known-missing-rooftop',
          venue_name: 'Mission Known Room',
          city: 'Mission',
          description: 'Private event room with AV, projector, and bar service.',
          standing_capacity: 80,
          hourly_rate_cents: 50_000,
          minimum_hours: 4,
        },
      ],
      vendors: [],
    })

    expect(result.recommendations.map((recommendation) => recommendation.partner_id)).not.toContain(
      'venue-known-missing-rooftop'
    )
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          partner_id: 'venue-known-missing-rooftop',
          blocking_issues: expect.arrayContaining(['Missing required amenities: rooftop']),
          metadata: expect.objectContaining({
            amenity_known: true,
            amenity_score_penalty: 0,
          }),
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
          hourly_rate_cents: 200_000,
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
          hourly_rate_cents: 100_000,
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

  it('collapses multiple venue candidates from the same Places cluster to one top entry by default', () => {
    const result = rankCatalogPartners({
      plan,
      venues: [
        {
          ...baseVenue,
          id: 'marriott-ballroom',
          venue_name: 'Marriott Ballroom',
          city: 'Mission',
          standing_capacity: 120,
          hourly_rate_cents: 100_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop', 'ballroom'],
          venue_cluster_id: 'hotel_marriott_union_square_san_francisco',
        },
        {
          ...baseVenue,
          id: 'marriott-rooftop',
          venue_name: 'Marriott Rooftop',
          city: 'Mission',
          standing_capacity: 110,
          hourly_rate_cents: 100_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop'],
          venue_cluster_id: 'hotel_marriott_union_square_san_francisco',
        },
        {
          ...baseVenue,
          id: 'marriott-lounge',
          venue_name: 'Marriott Lounge',
          city: 'Mission',
          standing_capacity: 95,
          hourly_rate_cents: 100_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop', 'lounge'],
          venue_cluster_id: 'hotel_marriott_union_square_san_francisco',
        },
      ],
      vendors: [],
      venueLimit: 3,
    })

    expect(result.recommendations).toHaveLength(1)
    expect(['marriott-ballroom', 'marriott-rooftop', 'marriott-lounge']).toContain(result.recommendations[0]?.partner_id)
    expect(result.recommendations[0]).toEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        venue_cluster_id: 'hotel_marriott_union_square_san_francisco',
        venue_cluster_primary: true,
        venue_cluster_size: 3,
        venue_cluster_sibling_ids: expect.any(Array),
      }),
    }))
    expect((result.recommendations[0]?.metadata.venue_cluster_sibling_ids as string[])).toHaveLength(2)
  })

  it('keeps different venue clusters individually ranked', () => {
    const result = rankCatalogPartners({
      plan,
      venues: [
        {
          ...baseVenue,
          id: 'hotel-one',
          venue_name: 'Hotel One Ballroom',
          city: 'Mission',
          standing_capacity: 120,
          hourly_rate_cents: 100_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop', 'ballroom'],
          venue_cluster_id: 'hotel_one',
        },
        {
          ...baseVenue,
          id: 'hotel-two',
          venue_name: 'Hotel Two Rooftop',
          city: 'Mission',
          standing_capacity: 110,
          hourly_rate_cents: 100_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop'],
          venue_cluster_id: 'hotel_two',
        },
        {
          ...baseVenue,
          id: 'hotel-three',
          venue_name: 'Hotel Three Lounge',
          city: 'Mission',
          standing_capacity: 95,
          hourly_rate_cents: 100_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop', 'lounge'],
          venue_cluster_id: 'hotel_three',
        },
      ],
      vendors: [],
      venueLimit: 3,
    })

    expect(result.recommendations.map((recommendation) => recommendation.partner_id)).toEqual(
      expect.arrayContaining(['hotel-one', 'hotel-two', 'hotel-three'])
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
          hourly_rate_cents: 100_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop'],
        },
        {
          ...baseVenue,
          id: 'venue-mission',
          venue_name: 'Mission Social Loft',
          city: 'Mission',
          standing_capacity: 90,
          hourly_rate_cents: 110_000,
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
          hourly_rate_cents: 100_000,
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
        consumption_share: 'Recommend best model',
      },
      venues: [
        {
          ...baseVenue,
          id: 'venue-per-head',
          venue_name: 'Hayes Volume Bar',
          city: 'Hayes Valley',
          description: 'Bar-forward mixer venue with AV and rooftop access',
          standing_capacity: 180,
          hourly_rate_cents: 200_000,
          minimum_hours: 4,
          per_head_chi_cents: 800,
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
          category: 'per_head_chi_cents',
          commercial_model: 'per_head_chi_cents',
          commercial_model_label: 'Per-head CHI',
          category_rank: 1,
          compared_models: expect.arrayContaining([
            expect.objectContaining({ model: 'flat_rental' }),
            expect.objectContaining({ model: 'per_head_chi_cents' }),
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

  it('shows outside-neighborhood labels for nearby venue fallbacks', () => {
    const result = rankCatalogPartners({
      plan: {
        ...plan,
        area: 'Hayes Valley',
        neighborhood: 'Hayes Valley',
      },
      venues: [
        {
          ...baseVenue,
          id: 'venue-north-beach',
          venue_name: 'North Beach Private Dining Room',
          neighborhood: 'North Beach',
          city: 'San Francisco',
          standing_capacity: 90,
          hourly_rate_cents: 100_000,
          minimum_hours: 4,
          unique_features_tags: ['AV', 'rooftop', 'bar'],
        },
      ],
      vendors: [],
    })

    expect(result.recommendations[0]?.reasoning).toContain('Nearby — outside Hayes Valley')
  })

  it('uses creator signup amenities as soft venue ranking preferences', () => {
    const result = rankCatalogPartners({
      plan: {
        ...plan,
        must_haves: [],
        organizer_preferred_amenities: ['full bar'],
      },
      venues: [
        {
          ...baseVenue,
          id: 'venue-with-bar',
          venue_name: 'Mission Bar Loft',
          city: 'Mission',
          standing_capacity: 90,
          hourly_rate_cents: 100_000,
          minimum_hours: 4,
          unique_features_tags: ['full bar'],
        },
        {
          ...baseVenue,
          id: 'venue-without-bar',
          venue_name: 'Mission Studio',
          city: 'Mission',
          standing_capacity: 90,
          hourly_rate_cents: 100_000,
          minimum_hours: 4,
          unique_features_tags: ['white walls'],
        },
      ],
      vendors: [],
      venueLimit: 2,
    })

    expect(result.recommendations[0]).toEqual(
      expect.objectContaining({
        partner_id: 'venue-with-bar',
        reasoning: expect.arrayContaining(['Matches your saved preferences: full bar']),
        metadata: expect.objectContaining({
          organizer_amenity_preference_score: 8,
          organizer_amenity_preference_matches: ['full bar'],
        }),
      })
    )
  })

  it('treats implausibly low vendor estimates as quote-required', () => {
    const result = rankCatalogPartners({
      plan: {
        ...plan,
        must_haves: ['AV'],
      },
      venues: [],
      vendors: [
        {
          id: 'vendor-nine-dollar-av',
          name: 'Suspicious AV',
          service_type: 'av_tech',
          bio: 'AV, projector, mic, speaker, and stage support',
          base_rate: 900,
          is_claimed: true,
        },
      ],
      venueLimit: 0,
      vendorLimit: 1,
    })

    expect(result.recommendations[0]).toEqual(
      expect.objectContaining({
        partner_id: 'vendor-nine-dollar-av',
        estimate_cents: 0,
        reasoning: expect.arrayContaining(['Est. TBD — confirm with vendor']),
        metadata: expect.objectContaining({ estimate_status: 'quote_required' }),
      })
    )
    expect(result.recommendations[0]?.reasoning.join(' ')).not.toContain('$9')
  })

  describe('rebook preference boosting', () => {
    it('boosts a preferred eligible venue above an otherwise higher-scored non-preferred venue', () => {
      const result = rankCatalogPartners({
        plan: {
          ...plan,
          preferred_venue_ids: ['venue-preferred'],
        },
        venues: [
          {
            ...baseVenue,
            id: 'venue-preferred',
            venue_name: 'Hayes Preferred Venue',
            city: 'Hayes Valley',
            standing_capacity: 80,
            hourly_rate_cents: 100_000,
            minimum_hours: 4,
            unique_features_tags: ['AV', 'rooftop'],
          },
          {
            ...baseVenue,
            id: 'venue-non-preferred',
            venue_name: 'Mission Strong Venue',
            city: 'Mission',
            standing_capacity: 90,
            hourly_rate_cents: 95_000,
            minimum_hours: 4,
            unique_features_tags: ['AV', 'rooftop', 'bar', 'kitchen'],
          },
        ],
        vendors: [],
        venueLimit: 2,
      })

      const preferredIndex = result.recommendations.findIndex((r) => r.partner_id === 'venue-preferred')
      const nonPreferredIndex = result.recommendations.findIndex((r) => r.partner_id === 'venue-non-preferred')
      expect(preferredIndex).toBeGreaterThanOrEqual(0)
      expect(nonPreferredIndex).toBeGreaterThanOrEqual(0)
      expect(preferredIndex).toBeLessThan(nonPreferredIndex)
    })

    it('includes "Previously used in this template" in venue reasoning when preferred', () => {
      const result = rankCatalogPartners({
        plan: {
          ...plan,
          preferred_venue_ids: ['venue-rebook-reasoning'],
        },
        venues: [
          {
            ...baseVenue,
            id: 'venue-rebook-reasoning',
            venue_name: 'Hayes Rebook Studio',
            city: 'Hayes Valley',
            standing_capacity: 80,
            hourly_rate_cents: 100_000,
            minimum_hours: 4,
            unique_features_tags: ['AV', 'rooftop'],
          },
        ],
        vendors: [],
      })

      const venue = result.recommendations.find((r) => r.partner_id === 'venue-rebook-reasoning')
      expect(venue).toBeDefined()
      expect(venue?.reasoning).toContain('Previously used in this template')
      expect(venue?.metadata).toMatchObject({ is_rebook_preferred: true, rebook_score: 12 })
    })

    it('does not boost preferred venue when it fails a hard gate (capacity)', () => {
      const result = rankCatalogPartners({
        plan: {
          ...plan,
          preferred_venue_ids: ['venue-preferred-too-small'],
        },
        venues: [
          {
            ...baseVenue,
            id: 'venue-preferred-too-small',
            venue_name: 'Tiny Preferred Room',
            city: 'Hayes Valley',
            standing_capacity: 20,
            hourly_rate_cents: 100_000,
            minimum_hours: 4,
            unique_features_tags: ['AV', 'rooftop'],
          },
        ],
        vendors: [],
      })

      expect(result.recommendations.map((r) => r.partner_id)).not.toContain('venue-preferred-too-small')
      expect(result.rejected.find((r) => r.partner_id === 'venue-preferred-too-small')).toBeDefined()
      const rejected = result.rejected.find((r) => r.partner_id === 'venue-preferred-too-small')
      // Rejected preferred venues should not get the rebook reasoning or boost
      expect(rejected?.reasoning).not.toContain('Previously used in this template')
      expect(rejected?.metadata.is_rebook_preferred).toBe(false)
    })

    it('boosts a preferred eligible vendor above a non-preferred vendor', () => {
      const result = rankCatalogPartners({
        plan: {
          ...plan,
          must_haves: ['catering'],
          preferred_vendor_ids: ['vendor-preferred-catering'],
        },
        venues: [],
        vendors: [
          {
            id: 'vendor-preferred-catering',
            name: 'Preferred Catering Co',
            service_type: 'catering',
            bio: 'Full-service catering with kitchen and bar',
            base_rate: 90_000,
            is_claimed: true,
            response_rate: 0.85,
          },
          {
            id: 'vendor-other-catering',
            name: 'Other Catering Co',
            service_type: 'catering',
            bio: 'Full-service catering with kitchen and bar',
            base_rate: 88_000,
            is_claimed: true,
            response_rate: 0.9,
          },
        ],
        venueLimit: 0,
        vendorLimit: 2,
      })

      const preferredIndex = result.recommendations.findIndex((r) => r.partner_id === 'vendor-preferred-catering')
      const otherIndex = result.recommendations.findIndex((r) => r.partner_id === 'vendor-other-catering')
      expect(preferredIndex).toBeGreaterThanOrEqual(0)
      expect(preferredIndex).toBeLessThan(otherIndex)
    })

    it('includes "Previously used in this template" in vendor reasoning when preferred', () => {
      const result = rankCatalogPartners({
        plan: {
          ...plan,
          must_haves: ['catering'],
          preferred_vendor_ids: ['vendor-rebook-reasoning'],
        },
        venues: [],
        vendors: [
          {
            id: 'vendor-rebook-reasoning',
            name: 'Rebook Catering',
            service_type: 'catering',
            bio: 'Full-service catering for events',
            base_rate: 90_000,
            is_claimed: true,
          },
        ],
        venueLimit: 0,
        vendorLimit: 1,
      })

      const vendor = result.recommendations.find((r) => r.partner_id === 'vendor-rebook-reasoning')
      expect(vendor).toBeDefined()
      expect(vendor?.reasoning).toContain('Previously used in this template')
      expect(vendor?.metadata).toMatchObject({ is_rebook_preferred: true, rebook_score: 12 })
    })

    it('does not apply rebook boost when preferred_venue_ids is null', () => {
      const result = rankCatalogPartners({
        plan: {
          ...plan,
          preferred_venue_ids: null,
        },
        venues: [
          {
            ...baseVenue,
            id: 'venue-no-boost',
            venue_name: 'Hayes Studio',
            city: 'Hayes Valley',
            standing_capacity: 80,
            hourly_rate_cents: 100_000,
            minimum_hours: 4,
            unique_features_tags: ['AV', 'rooftop'],
          },
        ],
        vendors: [],
      })

      const venue = result.recommendations.find((r) => r.partner_id === 'venue-no-boost')
      expect(venue?.metadata.is_rebook_preferred).toBe(false)
      expect(venue?.metadata.rebook_score).toBe(0)
      expect(venue?.reasoning).not.toContain('Previously used in this template')
    })
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
          hourly_rate_cents: 100_000,
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
          hourly_rate_cents: 100_000,
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
