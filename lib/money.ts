export function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function dollarsToCents(value: number | string | null | undefined): number {
  const dollars = toFiniteNumber(value) ?? 0
  return Math.round(dollars * 100)
}

export function centsToDollars(value: number | string | null | undefined): number {
  const cents = toFiniteNumber(value) ?? 0
  return Math.round(cents) / 100
}

export function readCents(
  centsValue: number | string | null | undefined,
  legacyDollarValue?: number | string | null
): number | null {
  const cents = toFiniteNumber(centsValue)
  if (cents !== null) return Math.round(cents)

  const dollars = toFiniteNumber(legacyDollarValue)
  if (dollars === null) return null
  return dollarsToCents(dollars)
}

export function readDollarsFromCents(
  centsValue: number | string | null | undefined,
  legacyDollarValue?: number | string | null
): number {
  const cents = readCents(centsValue, legacyDollarValue)
  return cents === null ? 0 : centsToDollars(cents)
}
