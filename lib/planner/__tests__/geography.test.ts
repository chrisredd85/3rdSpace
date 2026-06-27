import {
  computeVendorLocationScore,
  deriveEventCity,
  formatVendorLocationContext,
  getAdjacentCities,
  isVendorEligibleForDefaultCityPolicy,
} from '@/lib/planner/geography'

describe('planner geography helpers', () => {
  it('derives event city from known neighborhoods and cities', () => {
    expect(deriveEventCity('Downtown Oakland')).toBe('Oakland')
    expect(deriveEventCity(['Mission', 'Bay Area'])).toBe('San Francisco')
    expect(deriveEventCity('Downtown Berkeley')).toBe('Berkeley')
    expect(getAdjacentCities('Oakland')).toContain('Berkeley')
  })

  it('treats same-city vendors as eligible even if neighborhood differs', () => {
    const plan = { neighborhood: 'Downtown Oakland', event_city: 'Oakland' }
    const vendor = { city: 'Oakland', formatted_address: 'Uptown Oakland, CA' }

    expect(computeVendorLocationScore(vendor, plan)).toBe(0)
    expect(isVendorEligibleForDefaultCityPolicy(vendor, plan)).toBe(true)
    expect(formatVendorLocationContext(vendor, plan)).toBe('Oakland')
  })

  it('blocks out-of-city vendors by default unless they explicitly serve the event city', () => {
    const plan = { neighborhood: 'Downtown Oakland', event_city: 'Oakland' }

    expect(computeVendorLocationScore({ city: 'San Francisco' }, plan)).toBe(-50)
    expect(isVendorEligibleForDefaultCityPolicy({ city: 'San Francisco' }, plan)).toBe(false)

    expect(computeVendorLocationScore({ city: 'San Francisco', service_area: 'Bay Area and Oakland' }, plan)).toBe(-10)
    expect(isVendorEligibleForDefaultCityPolicy({ city: 'San Francisco', service_area: 'Bay Area and Oakland' }, plan)).toBe(true)
  })

  it('allows approved adjacent cities with a small score penalty', () => {
    const plan = {
      neighborhood: 'Downtown Oakland',
      event_city: 'Oakland',
      vendor_out_of_city_approved: true,
      vendor_approved_adjacent_cities: ['Berkeley'],
    }

    expect(computeVendorLocationScore({ city: 'Berkeley' }, plan)).toBe(-3)
    expect(formatVendorLocationContext({ city: 'Berkeley' }, plan)).toBe('Berkeley - approved')
  })
})
