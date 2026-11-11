jest.mock('server-only', () => ({}))

import { canonicalGooglePlaceId, clearGooglePlacesRateLimit, GOOGLE_VENUE_TEXT_SEARCH_FIELD_MASK, GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK, parseVenuePlace, searchGoogleVendorPlacesText } from '../google-places-client'
import { isGoogleVendorEnabled } from '../google-places-flags'
import { createVendorDetailsContext, getVendorDetails, GOOGLE_VENDOR_DETAILS_ENTERPRISE_FIELD_MASK, GOOGLE_VENDOR_DETAILS_PRO_FIELD_MASK } from '../vendor-places-details'
import { hydrateVendorShortlist, selectVendorPlaces, vendorResultLimit } from '../vendor-places-orchestrator'

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers })
const place = (id: string) => ({ id, displayName: { text: `Google ${id}` }, businessStatus: 'OPERATIONAL' })

describe('vendor staged Places retrieval', () => {
  const before = { venue: process.env.GOOGLE_PLACES_VENDORS_ENABLED, photo: process.env.GOOGLE_PLACES_PHOTOS_ENABLED }
  beforeEach(() => { process.env.GOOGLE_PLACES_VENDORS_ENABLED = 'true'; process.env.GOOGLE_PLACES_PHOTOS_ENABLED = 'true'; clearGooglePlacesRateLimit() })
  afterEach(() => {
    for (const [key, value] of [['GOOGLE_PLACES_VENDORS_ENABLED', before.venue], ['GOOGLE_PLACES_PHOTOS_ENABLED', before.photo]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value
    }
  })

  it('requires the exact vendor opt-in independent of venue acquisition', async () => {
    const fetchImpl = jest.fn()
    for (const value of [undefined, 'false', 'TRUE', '1']) {
      if (value === undefined) delete process.env.GOOGLE_PLACES_VENDORS_ENABLED; else process.env.GOOGLE_PLACES_VENDORS_ENABLED = value
      expect(isGoogleVendorEnabled()).toBe(false)
      expect((await getVendorDetails({ placeId: 'one', apiKey: 'test', context: createVendorDetailsContext({ fetchImpl }) })).status).toBe('disabled')
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses Pro vendor search with parser-by-mask', async () => {
    expect(GOOGLE_PLACES_TEXT_SEARCH_FIELD_MASK).toBe('places.id,places.displayName,places.formattedAddress,places.primaryType,places.types,places.location,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.priceLevel,places.businessStatus')
    expect(GOOGLE_VENUE_TEXT_SEARCH_FIELD_MASK).toBe('places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types,places.businessStatus,places.googleMapsUri,places.attributions')
    const fetchImpl = jest.fn().mockResolvedValue(json({ places: [{ id: 'places/one', rating: 5, websiteUri: 'https://secret.example', photos: [{ name: 'token' }], location: { latitude: 37, longitude: -122 } }, { id: '../unsafe' }] }))
    const result = await searchGoogleVendorPlacesText({ apiKey: 'test', textQuery: 'venues', fetchImpl })
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
    const selected = selectVendorPlaces([...Array.from({ length: 10 }, (_, i) => ({ place: { ...place(`p${i}`), rating: 5 } })), { place: place('late') }, { place: place('p0') }], score)
    expect(score.mock.calls[0][0]).toHaveLength(11)
    expect(score.mock.calls[0][0].every((row: object) => !('rating' in row))).toBe(true)
    expect(selected).toHaveLength(4)
    expect(selected[0].place.id).toBe('late')
    expect(vendorResultLimit(20)).toBe(4)
    expect(vendorResultLimit(200)).toBe(4)
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
    const selected = selectVendorPlaces(Array.from({ length: 12 }, (_, i) => ({ place: place(`p${i}`) })), () => new Map(), 8)
    const result = await hydrateVendorShortlist(selected.map(row => row.place), { apiKey: 'test', context: createVendorDetailsContext({ fetchImpl }) })
    expect(peak).toBe(3)
    expect(seen).toHaveLength(4)
    expect(seen.some(url => /\/p(?:8|9|10|11)$/.test(url))).toBe(false)
    expect(result[0].status).toBe('unavailable')
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({ 'X-Goog-Api-Key': 'test', 'X-Goog-FieldMask': GOOGLE_VENDOR_DETAILS_ENTERPRISE_FIELD_MASK })
  })

  it('bounds the maximum 240-slot pool to four selected Details with no discarded-ID calls', async () => {
    const pool = Array.from({ length: 240 }, (_, i) => ({ place: place(`slot${i}`) }))
    const selected = selectVendorPlaces(pool, rows => new Map(rows.map((row, i) => [row.id, i])), 20)
    const fetchImpl = jest.fn(async (url: string | URL | Request) => json(place(String(url).split('/').pop()!)))
    const results = await hydrateVendorShortlist(selected.map(row => row.place), { apiKey: 'test', context: createVendorDetailsContext({ fetchImpl }) })
    expect(results).toHaveLength(4)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(results.map(result => result.place_id)).toEqual(Array.from({ length: 4 }, (_, i) => `slot${239-i}`))
  })

  it('coalesces exact ID/profile in one request and keeps Pro versus Enterprise separate', async () => {
    const fetchImpl = jest.fn().mockImplementation(async () => json({ ...place('one'), rating: 4.5 }))
    const context = createVendorDetailsContext({ fetchImpl })
    const [first, second, pro] = await Promise.all([
      getVendorDetails({ placeId: 'places/one', apiKey: 'test', context }),
      getVendorDetails({ placeId: 'one', apiKey: 'test', context }),
      getVendorDetails({ placeId: 'one', apiKey: 'test', profile: 'pro', context }),
    ])
    expect(first).toBe(second)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(pro.place).not.toHaveProperty('rating')
    expect(fetchImpl.mock.calls[1][1].headers['X-Goog-FieldMask']).toBe(GOOGLE_VENDOR_DETAILS_PRO_FIELD_MASK)
  })

  it('retries once for transient status and honors Retry-After within the shared deadline', async () => {
    let now = 0
    const sleep = jest.fn(async (ms: number) => { now += ms })
    const fetchImpl = jest.fn().mockResolvedValueOnce(json({}, 429, { 'Retry-After': '2' })).mockResolvedValueOnce(json(place('one')))
    const result = await getVendorDetails({ placeId: 'one', apiKey: 'test', context: createVendorDetailsContext({ fetchImpl, sleep, now: () => now }) })
    expect(result.status).toBe('available'); expect(result.attempts).toBe(2); expect(sleep).toHaveBeenCalledWith(2000)
    const blocked = jest.fn().mockResolvedValue(json({}, 429, { 'Retry-After': '21' }))
    expect((await getVendorDetails({ placeId: 'two', apiKey: 'test', context: createVendorDetailsContext({ fetchImpl: blocked }) })).status).toBe('deadline')
    expect(blocked).toHaveBeenCalledTimes(1)
  })

  it('does not retry permanent failures, wrong identities, closed businesses, or malformed payloads', async () => {
    for (const [payload, status, expected] of [[{}, 400, 'failed'], [place('another'), 200, 'identity_mismatch'], [{ ...place('one'), businessStatus: 'CLOSED_PERMANENTLY' }, 200, 'closed'], [{ displayName: { text: 'Only name' } }, 200, 'identity_mismatch']] as const) {
      const fetchImpl = jest.fn().mockResolvedValue(json(payload, status))
      const result = await getVendorDetails({ placeId: 'one', apiKey: 'test', context: createVendorDetailsContext({ fetchImpl }) })
      expect(result.status).toBe(expected); expect(result).not.toHaveProperty('place'); expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })

  it('keeps a moved permanently closed business unavailable without following its replacement identity', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({
      ...place('original'), businessStatus: 'CLOSED_PERMANENTLY',
      movedPlaceId: 'replacement', movedPlace: 'places/replacement',
    }))
    const result = await getVendorDetails({ placeId: 'original', apiKey: 'test', context: createVendorDetailsContext({ fetchImpl }) })
    expect(result).toMatchObject({ status: 'closed', place_id: 'original', attempts: 1 })
    expect(result).not.toHaveProperty('place')
    expect(JSON.stringify(result)).not.toContain('replacement')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://places.googleapis.com/v1/places/original')
  })

  it('stops all queued hydration when one shared deadline expires', async () => {
    let now = 0
    const fetchImpl = jest.fn().mockImplementation(async (url) => { now = 21_000; return json(place(String(url).split('/').pop()!)) })
    const results = await hydrateVendorShortlist(Array.from({ length: 8 }, (_, i) => place(`p${i}`)), { apiKey: 'test', context: createVendorDetailsContext({ fetchImpl, now: () => now }) })
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(3)
    expect(results.some(result => result.status === 'deadline')).toBe(true)
  })

  it('never copies provider failure bodies to errors or results', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('private Google name and token', { status: 400 }))
    const result = await getVendorDetails({ placeId: 'one', apiKey: 'test', context: createVendorDetailsContext({ fetchImpl }) })
    expect(JSON.stringify(result)).not.toMatch(/private|token/)
    await expect(searchGoogleVendorPlacesText({ apiKey: 'test', textQuery: 'venues', fetchImpl })).rejects.not.toThrow('private Google name')
  })
})
