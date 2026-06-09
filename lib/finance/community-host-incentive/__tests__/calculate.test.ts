import { calculateCHI, CHIValidationError } from '../calculate'
import type { CHIAgreementInput } from '../types'

const approvedBase = {
  venueApproved: true,
  approvedAt: '2026-06-09T18:00:00.000Z',
  approvedByVenueUserId: 'user_venue_owner',
} satisfies Pick<CHIAgreementInput, 'venueApproved' | 'approvedAt' | 'approvedByVenueUserId'>

function calculate(agreement: CHIAgreementInput, verifiedAttendees = 100) {
  return calculateCHI({
    agreement,
    verifiedAttendees,
    verificationSource: 'ticketing_api',
  })
}

describe('calculateCHI', () => {
  it('calculates per verified attendee compensation in integer cents', () => {
    const result = calculate({
      ...approvedBase,
      agreementType: 'per_verified_attendee',
      perHeadRateCents: 750,
    }, 120)

    expect(result).toMatchObject({
      organizerPayoutCents: 90000,
      calculationBasis: 'verified_attendance',
      appliedFloor: false,
      appliedCap: false,
    })
  })

  it('pays fixed threshold compensation only when threshold is met', () => {
    const agreement: CHIAgreementInput = {
      ...approvedBase,
      agreementType: 'fixed_threshold',
      fixedAmountCents: 100000,
      thresholdAttendees: 150,
    }

    expect(calculate(agreement, 149).organizerPayoutCents).toBe(0)
    expect(calculate(agreement, 150).organizerPayoutCents).toBe(100000)
    expect(calculate(agreement, 180).organizerPayoutCents).toBe(100000)
  })

  it('does not apply a payout floor when fixed threshold attendance is missed', () => {
    const result = calculate({
      ...approvedBase,
      agreementType: 'fixed_threshold',
      fixedAmountCents: 100000,
      thresholdAttendees: 150,
      payoutFloorCents: 25000,
    }, 149)

    expect(result).toMatchObject({
      organizerPayoutCents: 0,
      appliedFloor: false,
      appliedCap: false,
    })
  })

  it('calculates fixed flat compensation independent of attendance', () => {
    const agreement: CHIAgreementInput = {
      ...approvedBase,
      agreementType: 'fixed_flat',
      fixedAmountCents: 45000,
    }

    expect(calculate(agreement, 0)).toMatchObject({
      organizerPayoutCents: 45000,
      calculationBasis: 'fixed_flat',
    })
    expect(calculate(agreement, 500).organizerPayoutCents).toBe(45000)
  })

  it('calculates base plus verified attendee compensation', () => {
    const result = calculate({
      ...approvedBase,
      agreementType: 'base_plus_per_attendee',
      baseAmountCents: 50000,
      perHeadRateCents: 500,
    }, 180)

    expect(result).toMatchObject({
      organizerPayoutCents: 140000,
      calculationBasis: 'base_plus_verified_attendance',
    })
  })

  it('uses manual venue-approved exact compensation', () => {
    const result = calculate({
      ...approvedBase,
      agreementType: 'manual_venue_approved',
      fixedAmountCents: 87500,
    }, 12)

    expect(result).toMatchObject({
      organizerPayoutCents: 87500,
      calculationBasis: 'manual_venue_approved',
    })
  })

  it('applies floor before cap', () => {
    const floored = calculate({
      ...approvedBase,
      agreementType: 'per_verified_attendee',
      perHeadRateCents: 100,
      payoutFloorCents: 10000,
      payoutCapCents: 15000,
    }, 50)

    expect(floored).toMatchObject({
      organizerPayoutCents: 10000,
      appliedFloor: true,
      appliedCap: false,
    })

    const capped = calculate({
      ...approvedBase,
      agreementType: 'per_verified_attendee',
      perHeadRateCents: 1000,
      payoutFloorCents: 10000,
      payoutCapCents: 15000,
    }, 50)

    expect(capped).toMatchObject({
      organizerPayoutCents: 15000,
      appliedFloor: false,
      appliedCap: true,
    })
  })

  it('rejects a floor greater than the cap', () => {
    expect(() => calculate({
      ...approvedBase,
      agreementType: 'fixed_flat',
      fixedAmountCents: 10000,
      payoutFloorCents: 20000,
      payoutCapCents: 10000,
    })).toThrow(CHIValidationError)
  })

  it('requires approved terms before settlement calculation', () => {
    expect(() => calculate({
      agreementType: 'fixed_flat',
      fixedAmountCents: 10000,
      venueApproved: false,
      approvedAt: '',
      approvedByVenueUserId: '',
    })).toThrow('CHI settlement requires venue-approved terms')
  })

  it('rejects unsafe money and attendance values', () => {
    expect(() => calculate({
      ...approvedBase,
      agreementType: 'fixed_flat',
      fixedAmountCents: 10.5,
    })).toThrow('fixedAmountCents must be a non-negative integer number of cents')

    expect(() => calculate({
      ...approvedBase,
      agreementType: 'per_verified_attendee',
      perHeadRateCents: 100,
    }, -1)).toThrow('verifiedAttendees must be a non-negative integer')
  })
})
