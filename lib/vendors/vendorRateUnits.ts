import {
  formatCentsToDollars,
  parseDollarsToCents,
  type VendorBaseRateCents,
} from '@/lib/money'

/** Converts a persisted vendor rate into the dollar value used by form controls. */
export function vendorRateCentsToFormDollars(
  value: number | string | null | undefined
): number | null {
  return formatCentsToDollars(value)
}

/** Converts a vendor-entered dollar value into canonical integer cents. */
export function vendorRateFormDollarsToCents(
  value: number | string | null | undefined
): VendorBaseRateCents | null {
  return parseDollarsToCents(value) as VendorBaseRateCents | null
}
