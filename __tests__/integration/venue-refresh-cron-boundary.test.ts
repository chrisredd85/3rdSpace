/** @jest-environment node */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: jest.fn() }))
jest.mock('@/lib/discovery/refreshDiscoveryFromPlaces', () => ({ refreshDiscoveryEntityFromPlaces: jest.fn() }))
jest.mock('@/app/api/internal/jobs/venue-website-extraction/route', () => ({ runVenueWebsiteExtraction: jest.fn() }))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/cron/discovery/refresh-stale/route'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { refreshDiscoveryEntityFromPlaces } from '@/lib/discovery/refreshDiscoveryFromPlaces'
import { runVenueWebsiteExtraction } from '@/app/api/internal/jobs/venue-website-extraction/route'

const prior = { secret: process.env.CRON_SECRET, key: process.env.GOOGLE_PLACES_API_KEY, flag: process.env.GOOGLE_PLACES_VENUES_ENABLED }
afterAll(() => {
  for (const [key, value] of Object.entries({ CRON_SECRET: prior.secret, GOOGLE_PLACES_API_KEY: prior.key, GOOGLE_PLACES_VENUES_ENABLED: prior.flag })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value
  }
})
it.each(['false', 'true'])('never refreshes venue listings through the broad cron with venue flag %s', async flag => {
  process.env.CRON_SECRET = 'local-cron-fixture'
  process.env.GOOGLE_PLACES_API_KEY = 'local-fake-key'
  process.env.GOOGLE_PLACES_VENUES_ENABLED = flag
  jest.clearAllMocks()
  const query = { select: jest.fn(), or: jest.fn(), order: jest.fn(), limit: jest.fn() }
  query.select.mockReturnValue(query); query.or.mockReturnValue(query); query.order.mockReturnValue(query)
  query.limit.mockResolvedValue({ data: [{ id: 'vendor-1' }], error: null })
  const from = jest.fn().mockReturnValue(query)
  ;(createServiceRoleClient as jest.Mock).mockReturnValue({ from })
  ;(refreshDiscoveryEntityFromPlaces as jest.Mock).mockResolvedValue({ changes_detected: 0 })
  ;(runVenueWebsiteExtraction as jest.Mock).mockResolvedValue(new Response(JSON.stringify({ processed: 0 })))
  const result = await GET(new NextRequest('http://localhost/api/cron/discovery/refresh-stale', { headers: { authorization: 'Bearer local-cron-fixture' } }))
  expect(result.status).toBe(200)
  expect(from.mock.calls).toEqual([['discovery_vendors']])
  expect(refreshDiscoveryEntityFromPlaces).toHaveBeenCalledTimes(1)
  expect(refreshDiscoveryEntityFromPlaces).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'discovery_vendor', entityId: 'vendor-1' }))
  expect(runVenueWebsiteExtraction).toHaveBeenCalledTimes(1)
})
