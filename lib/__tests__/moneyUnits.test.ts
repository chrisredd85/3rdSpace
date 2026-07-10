import {
  formatCentsToDollars,
  marginRatioToPercent,
  parseDollarsToCents,
} from '@/lib/money'

describe('canonical money and percentage units', () => {
  it('round-trips a cent-precision dollar input exactly', () => {
    const persistedCents = parseDollarsToCents('95.50')

    expect(persistedCents).toBe(9550)
    expect(formatCentsToDollars(persistedCents)).toBe(95.5)
    expect(parseDollarsToCents(formatCentsToDollars(persistedCents))).toBe(9550)
  })

  it('keeps absent optional form values absent', () => {
    expect(parseDollarsToCents('')).toBeNull()
    expect(parseDollarsToCents(null)).toBeNull()
    expect(formatCentsToDollars(undefined)).toBeNull()
  })

  it('converts ratios to percentage points before threshold comparisons', () => {
    expect(marginRatioToPercent(0.2)).toBe(20)
    expect(marginRatioToPercent(0.195)).toBe(19.5)
    expect(marginRatioToPercent(-0.0204)).toBe(-2.04)
  })
})
