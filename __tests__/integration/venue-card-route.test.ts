/** @jest-environment node */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(), createServiceRoleClient: jest.fn() }))
jest.mock('@/lib/server/venue-places-details', () => ({ getVenueDetails: jest.fn() }))

import { GET } from '@/app/api/planner/discovery-venues/[venueId]/card/route'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getVenueDetails } from '@/lib/server/venue-places-details'

const before = process.env.GOOGLE_PLACES_VENUES_ENABLED
const details = getVenueDetails as jest.Mock
const steps: string[] = []
let loggedIn = true
let owned = true
function query(data: unknown, step: string) {
  type Chain = { select: jest.Mock<Chain>; eq: jest.Mock<Chain>; limit: jest.Mock<Chain>; maybeSingle: jest.Mock<Promise<{ data: unknown; error: null }>> }
  const chain: Chain = { select: jest.fn(() => chain), eq: jest.fn(() => chain), limit: jest.fn(() => chain), maybeSingle: jest.fn(async () => { steps.push(step); return { data, error: null } }) }
  return chain
}
const request = () => GET(new Request('http://localhost/card'), { params: Promise.resolve({ venueId: 'venue-one' }) })
beforeEach(() => {
  jest.clearAllMocks(); steps.length = 0; loggedIn = true; owned = true
  process.env.GOOGLE_PLACES_VENUES_ENABLED = 'true'
  ;(createClient as jest.Mock).mockImplementation(() => ({ auth: { getUser: async () => ({ data: { user: loggedIn ? { id: 'host-one' } : null } }) }, from: () => query(owned ? { id: 'candidate' } : null, 'ownership') }))
  ;(createServiceRoleClient as jest.Mock).mockImplementation(() => ({ from: () => query({ source_external_id: 'place-one' }, 'identity') }))
  details.mockImplementation(async () => { steps.push('provider'); return { status: 'available', place_id: 'place-one', profile: 'pro', attempts: 1, place: { id: 'place-one', displayName: { text: 'Request only name' } } } })
})
afterAll(() => { if (before === undefined) delete process.env.GOOGLE_PLACES_VENUES_ENABLED; else process.env.GOOGLE_PLACES_VENUES_ENABLED = before })

it('checks ownership before Pro-only saved hydration and uses no-store on every response', async () => {
  const response = await request()
  expect(steps).toEqual(['ownership', 'identity', 'provider'])
  expect(details).toHaveBeenCalledWith({ placeId: 'place-one', profile: 'pro' })
  expect(await response.json()).toMatchObject({ venue_id: 'venue-one', google_live: { status: 'available' } })
  for (const key of ['Cache-Control', 'CDN-Cache-Control', 'Vercel-CDN-Cache-Control']) expect(response.headers.get(key)).toContain('no-store')
})
it('performs no hydration or legacy read when flag-off, unauthenticated, or unowned', async () => {
  process.env.GOOGLE_PLACES_VENUES_ENABLED = 'false'
  expect((await request()).status).toBe(204)
  expect(createClient).not.toHaveBeenCalled()
  process.env.GOOGLE_PLACES_VENUES_ENABLED = 'true'; loggedIn = false
  expect((await request()).status).toBe(401)
  loggedIn = true; owned = false
  expect((await request()).status).toBe(404)
  expect(createServiceRoleClient).not.toHaveBeenCalled(); expect(details).not.toHaveBeenCalled()
})
it('degrades a provider failure to an unavailable no-store response without exposing the body', async () => {
  details.mockRejectedValue(new Error('PROVIDER_CANARY'))
  const response = await request()
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('PROVIDER_CANARY')
  expect(response.headers.get('Cache-Control')).toContain('no-store')
})
