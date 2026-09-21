import {
  buildVendorDiscoveryResult,
  normalizeOfferingRows,
  normalizePackageRows,
} from '@/lib/vendors/discovery'

describe('vendor discovery legacy-major-unit adapters', () => {
  const vendorRow = {
    id: 'vendor-1',
    name: 'Cents Catering',
    service_type: 'catering',
    base_rate: 9_550,
    hourly_rate: null,
  }

  it('keeps reviewed package and offering columns in dollars for discovery cards', () => {
    expect(normalizeOfferingRows([{
      id: 'offering-1',
      vendor_id: 'vendor-1',
      offering_name: 'Dinner service',
      base_price: 125.5,
    }])[0].base_price).toBe(125.5)

    expect(normalizePackageRows([{
      id: 'package-1',
      vendor_id: 'vendor-1',
      package_name: 'Starter package',
      price: 150.25,
    }])[0].base_price).toBe(150.25)
  })

  it('converts canonical profile cents before comparing with legacy dollar prices', () => {
    const result = buildVendorDiscoveryResult(vendorRow, [{
      id: 'offering-1',
      vendor_id: 'vendor-1',
      name: 'Dinner service',
      description: null,
      base_price: 125.5,
      duration_hours: null,
      service_category: 'catering',
      max_capacity: null,
      portfolio_images: [],
      equipment_included: [],
      type: 'offering',
    }])

    expect(result.starting_price).toBe(95.5)
  })
})
