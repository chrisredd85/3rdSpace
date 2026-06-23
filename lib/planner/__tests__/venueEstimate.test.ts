import { estimateVenueRecommendationPriceCents } from '@/lib/planner/venueEstimate'

describe('venue recommendation estimate', () => {
  it('returns flat rental cents when a venue has a fixed rate', () => {
    expect(
      estimateVenueRecommendationPriceCents({
        commercial_model: 'flat_rental',
        flat_rental_cents: 150_000,
      })
    ).toBe(150_000)
  })

  it('returns negative organizer payout cents for per-head CHI', () => {
    expect(
      estimateVenueRecommendationPriceCents(
        {
          commercial_model: 'per_head_chi_cents',
          per_head_chi_cents: 2_000,
        },
        { guest_count: 50 }
      )
    ).toBe(-100_000)
  })

  it('returns null when the venue has no derivable terms', () => {
    expect(
      estimateVenueRecommendationPriceCents({
        venue_name: 'Terms Pending Hall',
      })
    ).toBeNull()
  })
})
