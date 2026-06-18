import { isChiEligibleVenueType, listChiEligibleVenueTypes } from '@/lib/finance/chi-eligibility'

describe('chi settlement eligibility', () => {
  it('uses the current CHI compliance-approved eligible venue types', () => {
    expect(listChiEligibleVenueTypes()).toEqual(['bar', 'lounge', 'cafe', 'sports_bar', 'club'])
    expect(isChiEligibleVenueType('bar')).toBe(true)
    expect(isChiEligibleVenueType('LOUNGE')).toBe(true)
    expect(isChiEligibleVenueType('cafe')).toBe(true)
  })

  it('keeps rental-only, hybrid-review, and unknown venue types out of automatic settlement runs', () => {
    expect(isChiEligibleVenueType('event_space')).toBe(false)
    expect(isChiEligibleVenueType('restaurant')).toBe(false)
    expect(isChiEligibleVenueType('gallery')).toBe(false)
    expect(isChiEligibleVenueType('unknown')).toBe(false)
    expect(isChiEligibleVenueType(null)).toBe(false)
    expect(isChiEligibleVenueType(undefined)).toBe(false)
  })
})
