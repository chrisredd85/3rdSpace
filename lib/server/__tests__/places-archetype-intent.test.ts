jest.mock('server-only', () => ({}))

import { resolvePlacesIntent } from '@/lib/server/places-archetype-intent'

describe('places archetype intent', () => {
  it('maps founder dinner style events to private dining and bar-adjacent Places types', () => {
    const intent = resolvePlacesIntent('founder_operator_dinner')

    expect(intent.cluster_label).toBe('food_drink')
    expect(intent.primary_types).toEqual([
      'restaurant',
      'fine_dining_restaurant',
      'hotel',
      'cocktail_bar',
    ])
  })

  it('maps product launches to gallery, museum, and theater venue searches', () => {
    const intent = resolvePlacesIntent('brand_product_launch')

    expect(intent.primary_types).toEqual([
      'event_venue',
      'art_gallery',
      'museum',
      'performing_arts_theater',
    ])
  })

  it('maps conferences to hotels, convention centers, event venues, and banquet halls', () => {
    const intent = resolvePlacesIntent('conference')

    expect(intent.cluster_label).toBe('event_space')
    expect(intent.primary_types).toEqual([
      'convention_center',
      'hotel',
      'event_venue',
      'banquet_hall',
    ])
  })

  it('maps networking mixers to brewery and bar searches without running every type', () => {
    const intent = resolvePlacesIntent('networking_mixer')

    expect(intent.primary_types).toEqual([
      'bar',
      'brewery',
      'cocktail_bar',
      'restaurant',
    ])
  })

  it('maps fundraisers to banquet halls, museums, hotels, and event venues', () => {
    const intent = resolvePlacesIntent('fundraiser_gala')

    expect(intent.primary_types).toEqual([
      'banquet_hall',
      'museum',
      'hotel',
      'event_venue',
    ])
  })

  it('boosts rooftop-relevant types when venue_style is rooftop', () => {
    const intent = resolvePlacesIntent('networking_mixer', { venue_style: 'rooftop' })

    expect(intent.cluster_label).toBe('hospitality')
    expect(intent.primary_types.slice(0, 3)).toEqual(['cocktail_bar', 'restaurant', 'event_venue'])
  })

  it('flags hospitality clustering when subspace keywords include rooftop', () => {
    const intent = resolvePlacesIntent('workshop_class', { subspace_keywords: ['rooftop'] })

    expect(intent.cluster_label).toBe('hospitality')
    expect(intent.subspace_keywords).toContain('rooftop')
  })

  it('boosts gallery searches when venue style is gallery', () => {
    const intent = resolvePlacesIntent('pop_up_activation', { venue_style: 'gallery' })

    expect(intent.cluster_label).toBe('event_space')
    expect(intent.primary_types).toEqual(['art_gallery', 'museum', 'event_venue', 'cultural_center'])
  })
})
