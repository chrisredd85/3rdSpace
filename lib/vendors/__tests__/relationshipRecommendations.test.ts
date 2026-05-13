import { buildTieredVendorRecommendationsForTest } from '@/lib/vendors/relationshipRecommendations'

describe('tiered vendor recommendations', () => {
  it('uses private confirmed rates only for the organizer who owns that relationship', () => {
    const tiersForOrganizerA = buildTieredVendorRecommendationsForTest({
      organizerUserId: 'organizer-a',
      vendors: [
        { id: 'vendor-1', name: 'DJ Maya', base_rate: 90000, pricing_model: 'flat' },
      ],
      relationships: [
        { organizer_user_id: 'organizer-a', vendor_id: 'vendor-1', trust_tier: 'preferred' },
      ],
      confirmedAgreements: [
        { organizer_user_id: 'organizer-a', vendor_id: 'vendor-1', amount: 450, rate_type: 'flat' },
      ],
    })

    expect(tiersForOrganizerA.your_people[0]).toMatchObject({
      tier: 'your_people',
      suggested_rate: 450,
      suggested_rate_unit: 'dollars',
    })

    const tiersForOrganizerB = buildTieredVendorRecommendationsForTest({
      organizerUserId: 'organizer-b',
      vendors: [
        { id: 'vendor-1', name: 'DJ Maya', base_rate: 90000, pricing_model: 'flat' },
      ],
      relationships: [
        { organizer_user_id: 'organizer-a', vendor_id: 'vendor-1', trust_tier: 'preferred' },
      ],
      confirmedAgreements: [
        { organizer_user_id: 'organizer-a', vendor_id: 'vendor-1', amount: 450, rate_type: 'flat' },
      ],
    })

    expect(tiersForOrganizerB.your_people).toHaveLength(0)
    expect(tiersForOrganizerB.catalog[0]).toMatchObject({
      tier: 'catalog',
      suggested_rate: 90000,
      suggested_rate_unit: 'cents',
    })
  })
})
