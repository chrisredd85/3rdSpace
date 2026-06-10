import { classifyCHIVenueType, isCHIVenueTypeEligible } from '../venueEligibility'

describe('CHI venue eligibility', () => {
  it('allows clear hospitality partner venue types', () => {
    expect(isCHIVenueTypeEligible('bar')).toBe(true)
    expect(isCHIVenueTypeEligible('lounge')).toBe(true)
    expect(isCHIVenueTypeEligible('sports_bar')).toBe(true)
  })

  it('keeps rental-only venues out of the CHI path', () => {
    expect(classifyCHIVenueType('event_space')).toBe('venue_rental')
    expect(classifyCHIVenueType('gallery')).toBe('venue_rental')
    expect(classifyCHIVenueType('coworking_event_space')).toBe('venue_rental')
  })

  it('routes hybrid or unknown venues to manual review', () => {
    expect(classifyCHIVenueType('restaurant')).toBe('manual_admin_review')
    expect(classifyCHIVenueType('rooftop')).toBe('manual_admin_review')
    expect(classifyCHIVenueType(null)).toBe('manual_admin_review')
    expect(classifyCHIVenueType('unknown')).toBe('manual_admin_review')
  })
})
