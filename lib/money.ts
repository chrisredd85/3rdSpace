declare const centsBrand: unique symbol
declare const marginPercentBrand: unique symbol

/** Integer minor currency units persisted by 3rdPlace. */
export type Cents = number & { readonly [centsBrand]: 'Cents' }

/** Canonical persisted vendor base rate. */
export type VendorBaseRateCents = Cents

/** Canonical venue booking estimate used at the deposit UI boundary. */
export type VenueBookingCostCents = Cents

/** Canonical venue nightly rate persisted by signup. */
export type VenueNightlyRateCents = Cents

/** A percentage expressed in percentage points, not a 0-1 ratio. */
export type MarginPercent = number & { readonly [marginPercentBrand]: 'MarginPercent' }

export function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Parses a UI-facing dollar value into canonical integer cents.
 * Invalid or absent optional values remain null instead of silently becoming $0.
 */
export function parseDollarsToCents(
  value: number | string | null | undefined
): Cents | null {
  if (typeof value === 'string' && value.trim() === '') return null
  const dollars = toFiniteNumber(value)
  if (dollars === null) return null
  return Math.round(dollars * 100) as Cents
}

/**
 * Converts canonical cents to the numeric dollar value expected by form controls.
 * Currency copy should still use Intl.NumberFormat for display formatting.
 */
export function formatCentsToDollars(
  value: number | string | null | undefined
): number | null {
  const cents = toFiniteNumber(value)
  if (cents === null) return null
  return Math.round(cents) / 100
}

/** Converts a 0-1 financial ratio into canonical percentage points. */
export function marginRatioToPercent(
  value: number | string | null | undefined
): MarginPercent | null {
  const ratio = toFiniteNumber(value)
  if (ratio === null) return null
  return Number((ratio * 100).toFixed(4)) as MarginPercent
}

export function dollarsToCents(value: number | string | null | undefined): number {
  return parseDollarsToCents(value) ?? 0
}

export function centsToDollars(value: number | string | null | undefined): number {
  return formatCentsToDollars(value) ?? 0
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
