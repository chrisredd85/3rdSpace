export const FORBIDDEN_CALCULATION_BASES = new Set([
  'percentage_of_pos',
  'percentage_of_bar_sales',
  'percentage_of_fnb',
  'percentage_of_alcohol',
  'percentage_of_total_revenue',
  'percentage_of_venue_revenue',
  'kickback',
  'revenue_share',
  'rev_share',
  'bar_split',
])

export class CHISettlementForbiddenBasisError extends Error {
  constructor(readonly basis: string) {
    super(`Forbidden CHI settlement basis: ${basis}`)
    this.name = 'CHISettlementForbiddenBasisError'
  }
}

export function isCalculationBasisAllowed(basis: string): boolean {
  return !FORBIDDEN_CALCULATION_BASES.has(basis)
}

export function assertCalculationBasisAllowed(basis: string): void {
  if (!isCalculationBasisAllowed(basis)) {
    throw new CHISettlementForbiddenBasisError(basis)
  }
}
