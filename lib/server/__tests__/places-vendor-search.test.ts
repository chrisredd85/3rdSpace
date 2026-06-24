jest.mock('server-only', () => ({}))

import {
  normalizeVendorServiceType,
  resolveDiscoveryVendorRate,
  type DiscoveryVendorRow,
} from '@/lib/server/places-vendor-search'

describe('places vendor search helpers', () => {
  it('normalizes planner vendor stack service types into Places vendor services', () => {
    expect(normalizeVendorServiceType('photography')).toBe('photographer')
    expect(normalizeVendorServiceType('av_tech')).toBe('av_production')
    expect(normalizeVendorServiceType('decor')).toBe('decor')
    expect(normalizeVendorServiceType('security')).toBe('security')
    expect(normalizeVendorServiceType('unknown_service')).toBeNull()
  })

  it('uses high-confidence inferred package rates as estimates', () => {
    const vendor = {
      id: 'vendor-1',
      name: 'Moongate Photo',
      service_type: 'photographer',
      inferred_package_rate_cents: 180000,
      inferred_hourly_rate_cents: 50000,
      inferred_minimum_cents: null,
      rate_inference_confidence: 0.76,
      rate_inference_admin_status: 'pending',
    } as DiscoveryVendorRow

    expect(resolveDiscoveryVendorRate(vendor)).toEqual({
      cents: 180000,
      confidenceLabel: 'estimated',
      confidence: 0.76,
    })
  })

  it('marks missing discovery vendor rates as TBD', () => {
    const vendor = {
      id: 'vendor-2',
      name: 'Unknown AV',
      service_type: 'av_production',
    } as DiscoveryVendorRow

    expect(resolveDiscoveryVendorRate(vendor)).toEqual({
      cents: null,
      confidenceLabel: 'rate_tbd',
      confidence: null,
    })
  })
})
