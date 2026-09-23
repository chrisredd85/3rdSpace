/** @jest-environment node */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(), createServiceRoleClient: jest.fn() }))

import { NextRequest } from 'next/server'
import { GET as venuePhoto, fetchCache as venueCache } from '@/app/api/planner/discovery-venues/[venueId]/photo/[index]/route'
import { GET as vendorPhoto, fetchCache as vendorCache } from '@/app/api/planner/discovery-vendors/[vendorId]/photo/[index]/route'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const fetchMock = jest.fn()
const originalFetch = global.fetch
const originalFlag = process.env.GOOGLE_PLACES_PHOTOS_ENABLED
const originalKey = process.env.GOOGLE_PLACES_API_KEY
let owns = true
let loggedIn = true
let placeId: string | null = 'place-1'
let steps: string[]
let selects: string[]
let filters: Array<[string, unknown]>

function query(kind: 'owner' | 'entity') {
  const chain = {
    select: jest.fn((columns: string) => { selects.push(columns); return chain }),
    eq: jest.fn((column: string, value: unknown) => { filters.push([column, value]); return chain }),
    limit: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => {
      steps.push(kind)
      return { data: kind === 'owner'
        ? (owns ? { id: 'candidate' } : null)
        : { source: 'google_places', source_external_id: placeId, google_place_id: placeId, photos: [{ name: 'places/place-1/photos/LEGACY-DO-NOT-USE' }] }, error: null }
    }),
  }
  return chain
}

function photo(token = 'fresh-one', author = 'Alice') {
  return {
    name: `places/place-1/photos/${token}`,
    googleMapsUri: `https://www.google.com/maps/photo/${token}`,
    authorAttributions: [{ displayName: author, uri: '//maps.google.com/maps/contrib/author-1' }],
  }
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

function image(bytes = 'photo bytes') {
  return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg' } })
}

function mockSuccess(photos = [photo()], bytes = 'photo bytes') {
  fetchMock
    .mockImplementationOnce(async () => { steps.push('details'); return json({ id: 'place-1', photos }) })
    .mockImplementationOnce(async () => { steps.push('media'); return json({ photoUri: 'https://lh3.googleusercontent.com/fresh-image' }) })
    .mockImplementationOnce(async () => { steps.push('bytes'); return image(bytes) })
}

function request(kind: 'venue' | 'vendor' = 'venue', index = '0') {
  const req = new NextRequest('http://localhost/api/photo')
  return kind === 'venue'
    ? venuePhoto(req, { params: Promise.resolve({ venueId: 'venue-1', index }) })
    : vendorPhoto(req, { params: Promise.resolve({ vendorId: 'vendor-1', index }) })
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0')
  expect(response.headers.get('CDN-Cache-Control')).toBe('no-store')
  expect(response.headers.get('Vercel-CDN-Cache-Control')).toBe('no-store')
}

beforeEach(() => {
  jest.clearAllMocks()
  fetchMock.mockReset()
  // Unqueued fetches fail locally, never contact a provider.
  fetchMock.mockRejectedValue(new Error('Unexpected mocked fetch'))
  global.fetch = fetchMock
  process.env.GOOGLE_PLACES_PHOTOS_ENABLED = 'true'
  process.env.GOOGLE_PLACES_API_KEY = 'fake-test-key'
  owns = true; loggedIn = true; placeId = 'place-1'; steps = []; selects = []; filters = []
  ;(createClient as jest.Mock).mockImplementation(() => ({
    auth: { getUser: async () => ({ data: { user: loggedIn ? { id: 'host-1' } : null }, error: null }) },
    from: jest.fn(() => query('owner')),
  }))
  ;(createServiceRoleClient as jest.Mock).mockImplementation(() => ({ from: jest.fn(() => query('entity')) }))
})

afterAll(() => {
  global.fetch = originalFetch
  if (originalFlag === undefined) delete process.env.GOOGLE_PLACES_PHOTOS_ENABLED
  else process.env.GOOGLE_PLACES_PHOTOS_ENABLED = originalFlag
  if (originalKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY
  else process.env.GOOGLE_PLACES_API_KEY = originalKey
})

describe.each(['venue', 'vendor'] as const)('%s fresh photo route', (kind) => {
  it('proves ownership before fresh IDs-only details and media, pairing bytes with the selected photo credits', async () => {
    mockSuccess()
    const response = await request(kind)
    expect(response.status).toBe(200)
    expect(steps).toEqual(['owner', 'entity', 'details', 'media', 'bytes'])
    expect(filters).toContainEqual(['plans.user_id', 'host-1'])
    expect(selects).toEqual(['id,plans!inner(id,user_id)', kind === 'venue' ? 'source,source_external_id' : 'source,source_external_id,google_place_id'])
    const result = await response.json()
    expect(result).toEqual({
      entityType: `discovery_${kind}`, entityId: `${kind}-1`, index: 0,
      dataUrl: `data:image/jpeg;base64,${Buffer.from('photo bytes').toString('base64')}`,
      attribution: {
        googleMapsUri: 'https://www.google.com/maps/photo/fresh-one',
        authorAttributions: [{ displayName: 'Alice', uri: 'https://maps.google.com/maps/contrib/author-1' }],
      },
    })
    expect(JSON.stringify(result)).not.toContain('places/place-1/photos/')
    expect(fetchMock.mock.calls[0][1].headers['X-Goog-FieldMask']).toBe('id,photos')
    expect(String(fetchMock.mock.calls[1][0])).toContain('/photos/fresh-one/media?')
    expect(String(fetchMock.mock.calls)).not.toContain('LEGACY')
    for (const [, init] of fetchMock.mock.calls) expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' })
    expectNoStore(response)
  })

  it('never calls Google for an unowned record', async () => {
    owns = false
    const response = await request(kind)
    expect(response.status).toBe(404)
    expect(createServiceRoleClient).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expectNoStore(response)
  })
})

it('fetches a fresh reference for every interaction and keeps reordered photos paired', async () => {
  mockSuccess([photo('a', 'Alice'), photo('b', 'Bob')], 'Alice bytes')
  mockSuccess([photo('b-new', 'Bob'), photo('a-new', 'Alice')], 'Bob bytes')
  const first = await (await request()).json()
  const second = await (await request()).json()
  expect(first.attribution.authorAttributions[0].displayName).toBe('Alice')
  expect(second.attribution.authorAttributions[0].displayName).toBe('Bob')
  expect(second.attribution.googleMapsUri).toContain('b-new')
  expect(second.dataUrl).toBe(`data:image/jpeg;base64,${Buffer.from('Bob bytes').toString('base64')}`)
  expect(String(fetchMock.mock.calls[4][0])).toContain('/photos/b-new/media?')
  expect(fetchMock).toHaveBeenCalledTimes(6)
})

it.each(['false', '', undefined])('rollback flag %s hides photos without reading legacy values', async (flag) => {
  if (flag === undefined) delete process.env.GOOGLE_PLACES_PHOTOS_ENABLED
  else process.env.GOOGLE_PLACES_PHOTOS_ENABLED = flag
  const response = await request()
  expect(response.status).toBe(204)
  expect(createClient).not.toHaveBeenCalled()
  expect(fetchMock).not.toHaveBeenCalled()
  expectNoStore(response)
})

it('rejects unauthenticated requests and invalid indexes without a provider call', async () => {
  loggedIn = false
  expect((await request()).status).toBe(401)
  for (const index of ['1junk', '-1', '10', '0.5', '']) expect((await request('venue', index)).status).toBe(400)
  expect(fetchMock).not.toHaveBeenCalled()
})

it.each([
  { id: 'place-1', photos: [] },
  { id: 'different-place', photos: [photo()] },
  { id: 'place-1', photos: [{ ...photo(), name: 'places/other/photos/token' }] },
  { id: 'place-1', photos: [{ ...photo(), name: 'places/place-1/photos/../bad' }] },
  { id: 'place-1', photos: [{ ...photo(), googleMapsUri: null }] },
  { id: 'place-1', photos: [{ ...photo(), authorAttributions: [{ displayName: 'Alice', uri: 'javascript:bad' }] }] },
])('hides missing/mismatched/uncitable photo metadata without media or old-name fallback', async (details) => {
  fetchMock.mockResolvedValueOnce(json(details))
  const response = await request()
  expect(response.status).toBe(204)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expectNoStore(response)
})

it.each([403, 404, 429, 500])('hides expired/failed media (%s) without fallback or retries', async (status) => {
  fetchMock.mockResolvedValueOnce(json({ id: 'place-1', photos: [photo()] })).mockResolvedValueOnce(json({}, status))
  const response = await request()
  expect(response.status).toBe(204)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expectNoStore(response)
})

it('hides upstream exceptions without logging token-bearing errors', async () => {
  fetchMock.mockRejectedValueOnce(new Error('secret-key and places/place-1/photos/private-token'))
  expect((await request()).status).toBe(204)
  expect(console.error).not.toHaveBeenCalled()
})

it('hides absent place IDs and missing configuration without using stored photo names', async () => {
  placeId = null
  expect((await request()).status).toBe(204)
  placeId = 'place-1'
  delete process.env.GOOGLE_PLACES_API_KEY
  expect((await request()).status).toBe(204)
  expect(fetchMock).not.toHaveBeenCalled()
})

it.each(['http://lh3.googleusercontent.com/x', 'https://evil.example/photo', 'https://googleusercontent.com.evil.example/photo'])('does not follow unexpected media URL %s', async (photoUri) => {
  fetchMock.mockResolvedValueOnce(json({ id: 'place-1', photos: [photo()] })).mockResolvedValueOnce(json({ photoUri }))
  expect((await request()).status).toBe(204)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it.each(['text/html', 'image/svg+xml'])('hides non-raster media %s', async (type) => {
  fetchMock.mockResolvedValueOnce(json({ id: 'place-1', photos: [photo()] }))
    .mockResolvedValueOnce(new Response('not an image', { headers: { 'Content-Type': type } }))
  expect((await request()).status).toBe(204)
})

it('bounds in-memory photo payload size', async () => {
  fetchMock.mockResolvedValueOnce(json({ id: 'place-1', photos: [photo()] }))
    .mockResolvedValueOnce(new Response(new Uint8Array(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/jpeg' } }))
  expect((await request()).status).toBe(204)
})

it('disables framework caching on both routes', () => {
  expect(venueCache).toBe('force-no-store')
  expect(vendorCache).toBe('force-no-store')
})
