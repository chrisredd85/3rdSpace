jest.mock('server-only', () => ({}))

import { canonicalGooglePlaceId, clearGooglePlacesRateLimit, GOOGLE_VENUE_TEXT_SEARCH_FIELD_MASK, GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK, parseVenuePlace, searchGoogleVenuePlacesText } from '../google-places-client'
import { areGooglePhotosEnabled, isGoogleVenueEnabled } from '../google-places-flags'
import { createVenueDetailsContext, getVenueDetails, GOOGLE_VENUE_DETAILS_ENTERPRISE_FIELD_MASK, GOOGLE_VENUE_DETAILS_PRO_FIELD_MASK } from '../venue-places-details'
import { hydrateVenueShortlist, selectVenuePlaces, venueResultLimit } from '../venue-places-orchestrator'

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers })
const place = (id: string) => ({ id, displayName: { text: `Google ${id}` }, businessStatus: 'OPERATIONAL' })

describe('venue-only staged Places retrieval', () => {
  const before = { venue: process.env.GOOGLE_PLACES_VENUES_ENABLED, photo: process.env.GOOGLE_PLACES_PHOTOS_ENABLED }
  beforeEach(() => { process.env.GOOGLE_PLACES_VENUES_ENABLED = 'true'; process.env.GOOGLE_PLACES_PHOTOS_ENABLED = 'true'; clearGooglePlacesRateLimit() })
  afterEach(() => {
    for (const [key, value] of [['GOOGLE_PLACES_VENUES_ENABLED', before.venue], ['GOOGLE_PLACES_PHOTOS_ENABLED', before.photo]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value
    }
  })

  it('requires both exact opt-ins for venue photos and keeps vendor photos off', async () => {
    const fetchImpl = jest.fn()
    for (const value of [undefined, 'false', 'TRUE', '1']) {
      if (value === undefined) delete process.env.GOOGLE_PLACES_VENUES_ENABLED; else process.env.GOOGLE_PLACES_VENUES_ENABLED = value
      expect(isGoogleVenueEnabled()).toBe(false)
      expect(areGooglePhotosEnabled('venue')).toBe(false)
      expect((await getVenueDetails({ placeId: 'one', apiKey: 'test', context: createVenueDetailsContext({ fetchImpl }) })).status).toBe('disabled')
      expect((await searchGoogleVenuePlacesText({ apiKey: 'test', textQuery: 'venues', fetchImpl })).places).toEqual([])
    }
    expect(fetchImpl).not.toHaveBeenCalled()
    process.env.GOOGLE_PLACES_VENUES_ENABLED = 'true'
    expect(areGooglePhotosEnabled('venue')).toBe(true)
    expect(areGooglePhotosEnabled('vendor')).toBe(false)
    process.env.GOOGLE_PLACES_PHOTOS_ENABLED = 'false'
    expect(areGooglePhotosEnabled('venue')).toBe(false)
  })

  it('keeps the vendor mask unchanged while using only Pro venue fields', async () => {
    expect(GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK).toContain('places.websiteUri')
    expect(GOOGLE_VENUE_TEXT_SEARCH_FIELD_MASK).toBe('places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types,places.businessStatus,places.googleMapsUri,places.attributions')
    const fetchImpl = jest.fn().mockResolvedValue(json({ places: [{ id: 'places/one', rating: 5, websiteUri: 'https://secret.example', photos: [{ name: 'token' }], location: { latitude: 37, longitude: -122 } }, { id: '../unsafe' }] }))
    const result = await searchGoogleVenuePlacesText({ apiKey: 'test', textQuery: 'venues', fetchImpl })
    expect(fetchImpl.mock.calls[0][1].headers['X-Goog-FieldMask']).toBe(GOOGLE_VENUE_TEXT_SEARCH_FIELD_MASK)
    expect(result.request.includePureServiceAreaBusinesses).toBe(false)
    expect(result.places).toEqual([{ id: 'one', location: { latitude: 37, longitude: -122 } }])
    expect(JSON.stringify(result)).not.toMatch(/secret|rating|token/)
  })

  it('normalizes only exact IDs and does not require an absent displayName', () => {
    expect(canonicalGooglePlaceId('places/one')).toBe('one')
    expect(canonicalGooglePlaceId('other/places/one')).toBeNull()
    expect(canonicalGooglePlaceId('one?key=secret')).toBeNull()
    expect(parseVenuePlace({ id: 'one', websiteUri: 'javascript:alert(1)', rating: 8, userRatingCount: -1, location: { latitude: 200, longitude: 0 } }, 'enterprise')).toEqual({ id: 'one' })
    expect(parseVenuePlace({ displayName: { text: 'No identity' } })).toBeNull()
  })

  it('scores the full unique pool before capping and removes unsolicited rating influence', () => {
    const score = jest.fn((rows: Array<{ id: string }>) => new Map<string, number>(rows.map((row: { id: string }) => [row.id, row.id === 'late' ? 100 : 1])))
    const selected = selectVenuePlaces([...Array.from({ length: 10 }, (_, i) => ({ place: { ...place(`p${i}`), rating: 5 } })), { place: place('late') }, { place: place('p0') }], score)
    expect(score.mock.calls[0][0]).toHaveLength(11)
    expect(score.mock.calls[0][0].every((row: object) => !('rating' in row))).toBe(true)
    expect(selected).toHaveLength(8)
    expect(selected[0].place.id).toBe('late')
    expect(venueResultLimit(20)).toBe(20)
    expect(venueResultLimit(200)).toBe(20)
  })

  it('hydrates selected IDs only, with at most three simultaneous requests and no replacements', async () => {
    let active = 0; let peak = 0
    const seen: string[] = []
    const fetchImpl = jest.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      active++; peak = Math.max(peak, active); seen.push(String(url))
      await Promise.resolve(); await Promise.resolve()
      active--
      const id = String(url).split('/').pop()!
      return id === 'p0' ? json({}, 404) : json(place(id))
    })
    const selected = selectVenuePlaces(Array.from({ length: 12 }, (_, i) => ({ place: place(`p${i}`) })), () => new Map(), 8)
    const result = await hydrateVenueShortlist(selected.map(row => row.place), { apiKey: 'test', context: createVenueDetailsContext({ fetchImpl }) })
    expect(peak).toBe(3)
    expect(seen).toHaveLength(8)
    expect(seen.some(url => /\/p(?:8|9|10|11)$/.test(url))).toBe(false)
    expect(result[0].status).toBe('unavailable')
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({ 'X-Goog-Api-Key': 'test', 'X-Goog-FieldMask': GOOGLE_VENUE_DETAILS_ENTERPRISE_FIELD_MASK })
  })

  it('bounds the maximum 240-slot pool to 20 selected Details with no discarded-ID calls', async () => {
    const pool = Array.from({ length: 240 }, (_, i) => ({ place: place(`slot${i}`) }))
    const selected = selectVenuePlaces(pool, rows => new Map(rows.map((row, i) => [row.id, i])), 20)
    const fetchImpl = jest.fn(async (url: string | URL | Request) => json(place(String(url).split('/').pop()!)))
    const results = await hydrateVenueShortlist(selected.map(row => row.place), { apiKey: 'test', context: createVenueDetailsContext({ fetchImpl }) })
    expect(results).toHaveLength(20)
    expect(fetchImpl).toHaveBeenCalledTimes(20)
    expect(results.map(result => result.place_id)).toEqual(Array.from({ length: 20 }, (_, i) => `slot${239-i}`))
  })

  it('coalesces exact ID/profile in one request and keeps Pro versus Enterprise separate', async () => {
    const fetchImpl = jest.fn().mockImplementation(async () => json({ ...place('one'), rating: 4.5 }))
    const context = createVenueDetailsContext({ fetchImpl })
    const [first, second, pro] = await Promise.all([
      getVenueDetails({ placeId: 'places/one', apiKey: 'test', context }),
      getVenueDetails({ placeId: 'one', apiKey: 'test', context }),
      getVenueDetails({ placeId: 'one', apiKey: 'test', profile: 'pro', context }),
    ])
    expect(first).toBe(second)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(pro.place).not.toHaveProperty('rating')
    expect(fetchImpl.mock.calls[1][1].headers['X-Goog-FieldMask']).toBe(GOOGLE_VENUE_DETAILS_PRO_FIELD_MASK)
  })

  it('retries once for transient status and honors Retry-After within the shared deadline', async () => {
    let now = 0
    const sleep = jest.fn(async (ms: number) => { now += ms })
    const fetchImpl = jest.fn().mockResolvedValueOnce(json({}, 429, { 'Retry-After': '2' })).mockResolvedValueOnce(json(place('one')))
    const result = await getVenueDetails({ placeId: 'one', apiKey: 'test', context: createVenueDetailsContext({ fetchImpl, sleep, now: () => now }) })
    expect(result.status).toBe('available'); expect(result.attempts).toBe(2); expect(sleep).toHaveBeenCalledWith(2000)
    const blocked = jest.fn().mockResolvedValue(json({}, 429, { 'Retry-After': '21' }))
    expect((await getVenueDetails({ placeId: 'two', apiKey: 'test', context: createVenueDetailsContext({ fetchImpl: blocked }) })).status).toBe('deadline')
    expect(blocked).toHaveBeenCalledTimes(1)
  })

  it('does not retry permanent failures, wrong identities, closed businesses, or malformed payloads', async () => {
    for (const [payload, status, expected] of [[{}, 400, 'failed'], [place('another'), 200, 'identity_mismatch'], [{ ...place('one'), businessStatus: 'CLOSED_PERMANENTLY' }, 200, 'closed'], [{ displayName: { text: 'Only name' } }, 200, 'identity_mismatch']] as const) {
      const fetchImpl = jest.fn().mockResolvedValue(json(payload, status))
      const result = await getVenueDetails({ placeId: 'one', apiKey: 'test', context: createVenueDetailsContext({ fetchImpl }) })
      expect(result.status).toBe(expected); expect(result).not.toHaveProperty('place'); expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })

  it('stops all queued hydration when one shared deadline expires', async () => {
    let now = 0
    const fetchImpl = jest.fn().mockImplementation(async (url) => { now = 21_000; return json(place(String(url).split('/').pop()!)) })
    const results = await hydrateVenueShortlist(Array.from({ length: 8 }, (_, i) => place(`p${i}`)), { apiKey: 'test', context: createVenueDetailsContext({ fetchImpl, now: () => now }) })
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(3)
    expect(results.some(result => result.status === 'deadline')).toBe(true)
  })

  it('never copies provider failure bodies to errors or results', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('private Google name and token', { status: 400 }))
    const result = await getVenueDetails({ placeId: 'one', apiKey: 'test', context: createVenueDetailsContext({ fetchImpl }) })
    expect(JSON.stringify(result)).not.toMatch(/private|token/)
    await expect(searchGoogleVenuePlacesText({ apiKey: 'test', textQuery: 'venues', fetchImpl })).rejects.not.toThrow('private Google name')
  })
})
