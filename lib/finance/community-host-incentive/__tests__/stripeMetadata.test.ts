import { buildCHIStripeMetadata } from '../stripeMetadata'

describe('buildCHIStripeMetadata', () => {
  it('sets required CHI metadata and explicit compliance negatives', () => {
    expect(buildCHIStripeMetadata({
      chiAgreementId: 'chi-agreement-1',
      chiSettlementId: 'chi-settlement-1',
      agreement: {
        agreementType: 'per_verified_attendee',
        perHeadRateCents: 1000,
        venueApproved: true,
        approvedAt: '2026-06-09T00:00:00.000Z',
        approvedByVenueUserId: 'venue-owner',
      },
      settlement: {
        organizerPayoutCents: 200000,
        calculationBasis: 'verified_attendance',
        appliedFloor: false,
        appliedCap: true,
        complianceFlags: [],
      },
      verifiedAttendees: 200,
      eventId: 'event-1',
      venueId: 'venue-1',
      organizerId: 'organizer-1',
      legacyPaymentId: 'legacy-payment-1',
      builderStripeAccountId: 'acct_builder',
    })).toMatchObject({
      payment_type: 'community_host_incentive',
      incentive_type: 'per_verified_attendee',
      calculation_basis: 'verified_attendance',
      verified_attendees: '200',
      per_head_rate_cents: '1000',
      applied_floor: 'false',
      applied_cap: 'true',
      is_revenue_share: 'false',
      is_percentage_of_alcohol: 'false',
      is_percentage_of_pos: 'false',
      event_id: 'event-1',
      venue_id: 'venue-1',
      organizer_id: 'organizer-1',
      chi_agreement_id: 'chi-agreement-1',
      chi_settlement_id: 'chi-settlement-1',
      legacy_payment_id: 'legacy-payment-1',
      builder_stripe_account_id: 'acct_builder',
      principal_cents: '200000',
      settlement_method: 'invoice',
    })
  })
})
