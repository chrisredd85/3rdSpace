jest.mock('server-only', () => ({}))

import {
  GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK,
  GOOGLE_PLACES_TEXT_SEARCH_URL,
  GOOGLE_PLACES_INCLUDED_TYPES,
  buildGooglePlacesTextSearchRequest,
  clearGooglePlacesRateLimit,
  searchGooglePlacesText,
} from '@/lib/server/google-places-client'

describe('google places client', () => {
  beforeEach(() => {
    clearGooglePlacesRateLimit()
  })

  it('builds a strict neighborhood-bounded Places request without fake email fields', () => {
    const request = buildGooglePlacesTextSearchRequest({
      textQuery: 'happy hour bars in Mission',
      eventType: 'happy_hour',
      neighborhood: 'Mission',
      maxResultCount: 12,
    })

    expect(request.includedType).toBe('bar')
    expect(request.strictTypeFiltering).toBe(true)
    expect(request.rankPreference).toBe('DISTANCE')
    expect(request.includePureServiceAreaBusinesses).toBe(false)
    expect(request.locationRestriction?.rectangle.low.latitude).toBeCloseTo(37.748)
    expect(request.locationRestriction?.rectangle.high.longitude).toBeCloseTo(-122.4)
    expect(request.maxResultCount).toBe(12)
    expect(GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK).toContain('places.photos')
    expect(GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK).not.toContain('places.emailAddress')
  })

  it('supports every event-relevant Places includedType without changing the field mask', () => {
    for (const includedType of GOOGLE_PLACES_INCLUDED_TYPES) {
      const request = buildGooglePlacesTextSearchRequest({
        textQuery: `${includedType} in Mission`,
        includedType,
        neighborhood: 'Mission',
      })

      expect(request.includedType).toBe(includedType)
      expect(request.strictTypeFiltering).toBe(true)
      expect(request.includePureServiceAreaBusinesses).toBe(false)
      expect(GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK).toContain('places.primaryType')
      expect(GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK).toContain('places.types')
      expect(GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK).not.toContain('places.emailAddress')
    }
  })

  it('searches Places, retries 5xx responses, filters non-operational places, and parses photos', async () => {
    let currentTime = 0
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(new Response('temporary', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        places: [
          {
            id: 'places/open-bar',
            displayName: { text: 'Moongate Lounge' },
            formattedAddress: '123 Mission St, San Francisco, CA',
            primaryType: 'bar',
            businessStatus: 'OPERATIONAL',
            websiteUri: 'https://moongate.example',
            nationalPhoneNumber: '(415) 555-0100',
            rating: 4.7,
            userRatingCount: 132,
            photos: [{
              name: 'places/open-bar/photos/photo-1',
              heightPx: 800,
              widthPx: 1200,
              authorAttributions: [{ displayName: 'Moongate Lounge', uri: 'https://maps.example/photo' }],
            }],
          },
          {
            id: 'places/closed-bar',
            displayName: { text: 'Closed Bar' },
            businessStatus: 'CLOSED_PERMANENTLY',
          },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const result = await searchGooglePlacesText({
      apiKey: 'google-key',
      textQuery: 'happy hour bars in Mission',
      neighborhood: 'Mission',
      fetchImpl,
      now: () => currentTime,
      sleep: async (ms) => {
        currentTime += ms
      },
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][0]).toBe(GOOGLE_PLACES_TEXT_SEARCH_URL)
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      'X-Goog-Api-Key': 'google-key',
      'X-Goog-FieldMask': GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK,
    })
    expect(result.places).toHaveLength(1)
    expect(result.places[0].displayName.text).toBe('Moongate Lounge')
    expect(result.places[0].photos?.[0]).toMatchObject({
      name: 'places/open-bar/photos/photo-1',
      heightPx: 800,
      widthPx: 1200,
      authorAttributions: [{ displayName: 'Moongate Lounge', uri: 'https://maps.example/photo' }],
    })
    expect(currentTime).toBe(200)
  })

  it('rate limits consecutive searches with a module singleton token bucket', async () => {
    let currentTime = 0
    const requestTimes: number[] = []
    const fetchImpl = jest.fn(async () => {
      requestTimes.push(currentTime)
      return new Response(JSON.stringify({
        places: [{ id: 'places/one', displayName: { text: 'One Venue' }, businessStatus: 'OPERATIONAL' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const searchInput = {
      apiKey: 'google-key',
      textQuery: 'venues in Mission',
      neighborhood: 'Mission',
      fetchImpl,
      now: () => currentTime,
      sleep: async (ms: number) => {
        currentTime += ms
      },
    }

    await searchGooglePlacesText(searchInput)
    await searchGooglePlacesText(searchInput)

    expect(requestTimes).toEqual([0, 1000])
  })
})
