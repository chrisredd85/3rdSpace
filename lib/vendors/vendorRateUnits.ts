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

/** Pricing-page load adapter. Persisted profile rates are cents; controls display dollars. */
export function loadVendorPricingFormMoney(input: {
  baseRateCents: number | string | null | undefined
  perPersonRateCents: number | string | null | undefined
}) {
  return {
    baseRateDollars: vendorRateCentsToFormDollars(input.baseRateCents),
    perPersonRateDollars: vendorRateCentsToFormDollars(input.perPersonRateCents),
  }
}

/** Pricing-page save adapter. Dollar controls cross into persisted cents exactly once. */
export function saveVendorPricingFormMoney(input: {
  baseRateDollars: number | string | null | undefined
  perPersonRateDollars: number | string | null | undefined
}) {
  return {
    baseRateCents: vendorRateFormDollarsToCents(input.baseRateDollars),
    perPersonRateCents: vendorRateFormDollarsToCents(input.perPersonRateDollars),
  }
}

/** Services-page load adapter for the profile base-rate control. */
export function loadVendorServicesBaseRateDollars(
  persistedBaseRateCents: number | string | null | undefined
) {
  return vendorRateCentsToFormDollars(persistedBaseRateCents)
}

/** Services-page save adapter for the profile base-rate control. */
export function saveVendorServicesBaseRateCents(
  formBaseRateDollars: number | string | null | undefined
) {
  return vendorRateFormDollarsToCents(formBaseRateDollars)
}
