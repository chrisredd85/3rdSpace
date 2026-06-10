import {
  assertCalculationBasisAllowed,
  CHISettlementForbiddenBasisError,
  FORBIDDEN_CALCULATION_BASES,
  isCalculationBasisAllowed,
} from '../compliance'

describe('CHI compliance guard', () => {
  it('rejects every forbidden settlement basis', () => {
    for (const basis of FORBIDDEN_CALCULATION_BASES) {
      expect(isCalculationBasisAllowed(basis)).toBe(false)
      expect(() => assertCalculationBasisAllowed(basis)).toThrow(CHISettlementForbiddenBasisError)
    }
  })

  it('allows CHI calculation bases', () => {
    for (const basis of [
      'verified_attendance',
      'fixed_threshold_met',
      'fixed_flat',
      'base_plus_verified_attendance',
      'manual_venue_approved',
    ]) {
      expect(isCalculationBasisAllowed(basis)).toBe(true)
      expect(() => assertCalculationBasisAllowed(basis)).not.toThrow()
    }
  })
})
