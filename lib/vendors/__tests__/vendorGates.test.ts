import { normalizeServiceType } from '@/lib/vendors/vendorGates'

describe('vendor gate service type normalization', () => {
  it('keeps canonical underscore service types matchable', () => {
    expect(normalizeServiceType('av_production')).toBe('av_production')
    expect(normalizeServiceType('av production')).toBe('av_production')
    expect(normalizeServiceType('check_in')).toBe('check_in')
    expect(normalizeServiceType('photo_booth')).toBe('photo_booth')
    expect(normalizeServiceType('pos_systems')).toBe('pos_systems')
  })
})
