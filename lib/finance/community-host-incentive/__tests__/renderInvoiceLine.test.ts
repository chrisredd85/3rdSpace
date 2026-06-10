import type { CHIAgreementInput, CHISettlementResult } from '../types'
import { renderCHIInvoiceLine } from '../renderInvoiceLine'

const approval = {
  venueApproved: true,
  approvedAt: '2026-06-09T00:00:00.000Z',
  approvedByVenueUserId: 'venue-owner',
}

function settlement(overrides: Partial<CHISettlementResult> = {}): CHISettlementResult {
  return {
    organizerPayoutCents: 200000,
    calculationBasis: 'verified_attendance',
    appliedFloor: false,
    appliedCap: false,
    complianceFlags: [],
    ...overrides,
  }
}

describe('renderCHIInvoiceLine', () => {
  it('renders per-attendee terms without forbidden settlement language', () => {
    const agreement: CHIAgreementInput = {
      ...approval,
      agreementType: 'per_verified_attendee',
      perHeadRateCents: 1000,
    }

    expect(renderCHIInvoiceLine({ agreement, settlement: settlement(), verifiedAttendees: 200 }))
      .toMatchInlineSnapshot(`"Community Host Incentive - 200 verified attendees x $10.00 = $2,000.00"`)
  })

  it('renders fixed threshold terms', () => {
    const agreement: CHIAgreementInput = {
      ...approval,
      agreementType: 'fixed_threshold',
      thresholdAttendees: 150,
      fixedAmountCents: 100000,
    }

    expect(renderCHIInvoiceLine({
      agreement,
      settlement: settlement({
        organizerPayoutCents: 100000,
        calculationBasis: 'fixed_threshold_met',
      }),
      verifiedAttendees: 175,
    })).toMatchInlineSnapshot(`"Community Host Incentive - Fixed incentive after 150-attendee threshold met = $1,000.00"`)
  })

  it('renders base plus attendee terms', () => {
    const agreement: CHIAgreementInput = {
      ...approval,
      agreementType: 'base_plus_per_attendee',
      baseAmountCents: 50000,
      perHeadRateCents: 500,
    }

    expect(renderCHIInvoiceLine({
      agreement,
      settlement: settlement({
        organizerPayoutCents: 140000,
        calculationBasis: 'base_plus_verified_attendance',
      }),
      verifiedAttendees: 180,
    })).toMatchInlineSnapshot(`"Community Host Incentive - Base $500.00 + (180 verified attendees x $5.00) = $1,400.00"`)
  })

  it('renders manual fixed venue-approved terms', () => {
    const agreement: CHIAgreementInput = {
      ...approval,
      agreementType: 'manual_venue_approved',
      fixedAmountCents: 75000,
    }

    expect(renderCHIInvoiceLine({
      agreement,
      settlement: settlement({
        organizerPayoutCents: 75000,
        calculationBasis: 'manual_venue_approved',
      }),
      verifiedAttendees: 0,
    })).toMatchInlineSnapshot(`"Community Host Incentive - Venue-approved fixed incentive = $750.00"`)
  })
})
