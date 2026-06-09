import { assertCalculationBasisAllowed } from './compliance'
import type {
  CHIAgreementInput,
  CHICalculationBasis,
  CHISettlementInput,
  CHISettlementResult,
} from './types'

export class CHIValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CHIValidationError'
  }
}

function assertSafeCents(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CHIValidationError(`${field} must be a non-negative integer number of cents`)
  }
  return value
}

function assertSafeCount(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CHIValidationError(`${field} must be a non-negative integer`)
  }
  return value
}

function requireCents(value: number | undefined, field: string): number {
  const safeValue = assertSafeCents(value, field)
  if (safeValue === undefined) {
    throw new CHIValidationError(`${field} is required`)
  }
  return safeValue
}

function requireCount(value: number | undefined, field: string): number {
  const safeValue = assertSafeCount(value, field)
  if (safeValue === undefined) {
    throw new CHIValidationError(`${field} is required`)
  }
  return safeValue
}

function assertApprovedAgreement(agreement: CHIAgreementInput): void {
  if (!agreement.venueApproved || !agreement.approvedAt || !agreement.approvedByVenueUserId) {
    throw new CHIValidationError('CHI settlement requires venue-approved terms')
  }
}

function validateCommonInputs(input: CHISettlementInput): void {
  assertApprovedAgreement(input.agreement)
  assertSafeCount(input.verifiedAttendees, 'verifiedAttendees')
  assertSafeCents(input.agreement.perHeadRateCents, 'perHeadRateCents')
  assertSafeCents(input.agreement.fixedAmountCents, 'fixedAmountCents')
  assertSafeCount(input.agreement.thresholdAttendees, 'thresholdAttendees')
  assertSafeCents(input.agreement.baseAmountCents, 'baseAmountCents')
  const floor = assertSafeCents(input.agreement.payoutFloorCents, 'payoutFloorCents')
  const cap = assertSafeCents(input.agreement.payoutCapCents, 'payoutCapCents')

  if (floor !== undefined && cap !== undefined && floor > cap) {
    throw new CHIValidationError('payoutFloorCents cannot exceed payoutCapCents')
  }
}

function applyFloorAndCap(amountCents: number, agreement: CHIAgreementInput) {
  let result = amountCents
  let appliedFloor = false
  let appliedCap = false

  // Business invariant: floor applies before cap, matching the approved terms.
  if (agreement.payoutFloorCents !== undefined && result < agreement.payoutFloorCents) {
    result = agreement.payoutFloorCents
    appliedFloor = true
  }

  if (agreement.payoutCapCents !== undefined && result > agreement.payoutCapCents) {
    result = agreement.payoutCapCents
    appliedCap = true
  }

  return { organizerPayoutCents: result, appliedFloor, appliedCap }
}

function calculatePrincipal(input: CHISettlementInput): {
  amountCents: number
  calculationBasis: CHICalculationBasis
  floorAndCapEligible: boolean
} {
  const { agreement, verifiedAttendees } = input

  switch (agreement.agreementType) {
    case 'per_verified_attendee':
      return {
        amountCents: verifiedAttendees * requireCents(agreement.perHeadRateCents, 'perHeadRateCents'),
        calculationBasis: 'verified_attendance',
        floorAndCapEligible: true,
      }
    case 'fixed_threshold': {
      const threshold = requireCount(agreement.thresholdAttendees, 'thresholdAttendees')
      const thresholdMet = verifiedAttendees >= threshold
      return {
        amountCents: thresholdMet ? requireCents(agreement.fixedAmountCents, 'fixedAmountCents') : 0,
        calculationBasis: 'fixed_threshold_met',
        floorAndCapEligible: thresholdMet,
      }
    }
    case 'fixed_flat':
      return {
        amountCents: requireCents(agreement.fixedAmountCents, 'fixedAmountCents'),
        calculationBasis: 'fixed_flat',
        floorAndCapEligible: true,
      }
    case 'base_plus_per_attendee':
      return {
        amountCents:
          requireCents(agreement.baseAmountCents, 'baseAmountCents') +
          verifiedAttendees * requireCents(agreement.perHeadRateCents, 'perHeadRateCents'),
        calculationBasis: 'base_plus_verified_attendance',
        floorAndCapEligible: true,
      }
    case 'manual_venue_approved':
      return {
        amountCents: requireCents(agreement.fixedAmountCents, 'fixedAmountCents'),
        calculationBasis: 'manual_venue_approved',
        floorAndCapEligible: true,
      }
    default: {
      const exhaustive: never = agreement.agreementType
      throw new CHIValidationError(`Unsupported CHI agreement type: ${exhaustive}`)
    }
  }
}

export function calculateCHI(input: CHISettlementInput): CHISettlementResult {
  validateCommonInputs(input)
  const principal = calculatePrincipal(input)
  assertCalculationBasisAllowed(principal.calculationBasis)
  const payout = principal.floorAndCapEligible
    ? applyFloorAndCap(principal.amountCents, input.agreement)
    : { organizerPayoutCents: principal.amountCents, appliedFloor: false, appliedCap: false }

  return {
    organizerPayoutCents: payout.organizerPayoutCents,
    calculationBasis: principal.calculationBasis,
    appliedFloor: payout.appliedFloor,
    appliedCap: payout.appliedCap,
    complianceFlags: [],
  }
}
