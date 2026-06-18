import {
  canonicalizeEventRevenueTermType,
  isVendorConsumptionShareTerm,
  isVenueChiTerm,
  legacyEventRevenueTermType,
  withConsumptionShareFlag,
} from '@/lib/finance/chi-nomenclature-sync'

describe('CHI nomenclature sync helpers', () => {
  it('canonicalizes legacy event revenue term types to CHI names', () => {
    expect(canonicalizeEventRevenueTermType('venue_kickback')).toBe('venue_chi')
    expect(canonicalizeEventRevenueTermType('vendor_rev_share')).toBe('vendor_consumption_share')
    expect(canonicalizeEventRevenueTermType('service_fee')).toBe('service_fee')
  })

  it('maps canonical event revenue term types back to legacy names for compat layers', () => {
    expect(legacyEventRevenueTermType('venue_chi')).toBe('venue_kickback')
    expect(legacyEventRevenueTermType('vendor_consumption_share')).toBe('vendor_rev_share')
    expect(legacyEventRevenueTermType('service_fee')).toBe('service_fee')
  })

  it('detects legacy and canonical CHI term categories', () => {
    expect(isVenueChiTerm('venue_chi')).toBe(true)
    expect(isVenueChiTerm('venue_kickback')).toBe(true)
    expect(isVendorConsumptionShareTerm('vendor_consumption_share')).toBe(true)
    expect(isVendorConsumptionShareTerm('vendor_rev_share')).toBe(true)
  })

  it('dual-writes the legacy compatibility flag and canonical flag', () => {
    expect(withConsumptionShareFlag({ is_legacy_revenue_share: true })).toMatchObject({
      is_legacy_consumption_share: true,
      is_legacy_revenue_share: true,
    })
    expect(withConsumptionShareFlag({ is_legacy_consumption_share: false })).toMatchObject({
      is_legacy_consumption_share: false,
      is_legacy_revenue_share: false,
    })
  })
})
