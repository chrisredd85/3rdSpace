import { rankVenueDiscoveryCandidates } from '@/lib/planner/venueDiscoveryRanker'

describe('rankVenueDiscoveryCandidates', () => {
  it('only returns candidates supplied by the caller', () => {
    const ranked = rankVenueDiscoveryCandidates({
      plan: {
        headcount: 80,
        neighborhood: 'Mission',
        budget_cap_cents: 800_000,
        vibe_tags: ['rooftop', 'cocktails'],
      },
      candidates: [
        {
          id: 'discovery-1',
          source: 'discovery',
          name: 'Mission Roof',
          neighborhood: 'Mission',
          city: 'San Francisco',
          capacity_standing: 120,
          price_hint_cents_high: 300_000,
          vibe_tags: ['rooftop', 'cocktails'],
          contact_email: 'events@example.com',
          signals: {
            emailsSent30d: 4,
            replies30d: 2,
            bookings30d: 1,
            declines30d: 0,
            stale30d: 0,
            avgReplyLatencySeconds: 18_000,
          },
        },
        {
          id: 'onboarded-1',
          source: 'onboarded',
          name: 'Far Away Hall',
          neighborhood: 'Oakland',
          city: 'Oakland',
          capacity_standing: 40,
          estimate_cents: 700_000,
          vibe_tags: ['conference'],
        },
      ],
      limit: 8,
    })

    expect(ranked).toHaveLength(2)
    expect(ranked.map((candidate) => candidate.candidate_id)).toEqual(['discovery-1', 'onboarded-1'])
    expect(ranked[0]).toMatchObject({
      source: 'discovery',
      target_source: 'discovery',
      target_id: 'discovery-1',
      discovery_venue_id: 'discovery-1',
    })
  })

  it('applies a small onboarded boost without excluding discovery venues', () => {
    const ranked = rankVenueDiscoveryCandidates({
      plan: {
        headcount: 50,
        neighborhood: 'SoMa',
      },
      candidates: [
        {
          id: 'onboarded-1',
          source: 'onboarded',
          name: 'Onboarded Loft',
          neighborhood: 'SoMa',
          city: 'San Francisco',
          capacity_standing: 75,
        },
        {
          id: 'discovery-1',
          source: 'discovery',
          name: 'Discovery Loft',
          neighborhood: 'SoMa',
          city: 'San Francisco',
          capacity_standing: 75,
        },
      ],
    })

    expect(ranked.map((candidate) => candidate.candidate_id)).toEqual(['onboarded-1', 'discovery-1'])
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })
})
