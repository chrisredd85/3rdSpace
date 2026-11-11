jest.mock('server-only', () => ({}))

const searchGooglePlacesTextMock = jest.fn()
const captureMessageMock = jest.fn()
const detailsMock = jest.fn()
const vendorDetailsMock = jest.fn()
jest.mock('@/lib/server/vendor-places-details', () => ({ getVendorDetails: (...args: unknown[]) => vendorDetailsMock(...args) }))
jest.mock('@/lib/server/venue-places-details', () => ({getVenueDetails: (...args: unknown[]) => detailsMock(...args)}))

jest.mock('@/lib/server/google-places-client', () => ({
  ...jest.requireActual('@/lib/server/google-places-client'),
  searchGooglePlacesText: (...args: unknown[]) => searchGooglePlacesTextMock(...args),
}))

jest.mock('@/lib/discovery/cascadeInvalidation', () => ({
  cascadeInvalidationForEntityChange: jest.fn(async () => ({invalidated_recommendation_ids:[],flagged_commitment_ids:[],superseded_outreach_thread_ids:[],notifications_to_send:[]})),
}))

jest.mock('@sentry/nextjs', () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}))

import fs from 'node:fs'
import path from 'node:path'

import {
  DISCOVERY_CHANGE_LOG_SOURCES,
  PLACES_REFRESH_CHANGE_SOURCE,
} from '@/lib/discovery/changeLogSources'
import { refreshDiscoveryEntityFromPlaces } from '@/lib/discovery/refreshDiscoveryFromPlaces'

const CONSTRAINT_SOURCES = [
  'places_refresh',
  'outreach_extraction',
  'admin_override',
  'vendor_self_update',
  'stripe_account_event',
  'organizer_report',
] as const

describe('discovery Places refresh change-log contract', () => {
  const previousVendorFlag = process.env.GOOGLE_PLACES_VENDORS_ENABLED
  afterEach(() => {
    if (previousVendorFlag === undefined) delete process.env.GOOGLE_PLACES_VENDORS_ENABLED
    else process.env.GOOGLE_PLACES_VENDORS_ENABLED = previousVendorFlag
  })
  beforeEach(() => {
    jest.clearAllMocks()
    searchGooglePlacesTextMock.mockResolvedValue({
      places: [{
        id: 'places/venue-places-id',
        displayName: { text: 'Mission Room' },
        formattedAddress: '100 Mission St, San Francisco, CA',
        nationalPhoneNumber: '(415) 555-0100',
        websiteUri: 'https://mission-room.example.com',
        businessStatus: 'OPERATIONAL',
        rating: 4.7,
        userRatingCount: 120,
      }],
      request: {},
    })
  })

  it('keeps the TypeScript source allowlist equal to the database CHECK list', () => {
    expect(DISCOVERY_CHANGE_LOG_SOURCES).toEqual(CONSTRAINT_SOURCES)
    expect(PLACES_REFRESH_CHANGE_SOURCE).toBe('places_refresh')

    const migration = fs.readFileSync(path.join(
      process.cwd(),
      'supabase/migrations/20260626001000_add_vendor_city_and_discovery_freshness.sql'
    ), 'utf8')
    const checkBody = migration.match(/CONSTRAINT discovery_change_source_check\s+CHECK \(source IN \(\s*([\s\S]*?)\s*\)\)/)?.[1]
    expect(checkBody).toBeDefined()
    const sqlSources = Array.from(checkBody?.matchAll(/'([^']+)'/g) ?? [], (match) => match[1])
    expect(sqlSources).toEqual(CONSTRAINT_SOURCES)
  })

  it('observes the exact vendor ID without persisting Google fields or history', async () => {
    process.env.GOOGLE_PLACES_VENDORS_ENABLED = 'true'
    const db = createRefreshDb()
    const before = JSON.stringify(db.venue)
    vendorDetailsMock.mockResolvedValue({ status: 'available', place: { id: 'venue-places-id', displayName: { text: 'GOOGLE_CANARY' } } })

    const result = await refreshDiscoveryEntityFromPlaces({
      supabase: db.client as any, entityType: 'discovery_vendor', entityId: 'venue-1', apiKey: 'test-key',
    })

    expect(vendorDetailsMock).toHaveBeenCalledWith(expect.objectContaining({ placeId: 'venue-places-id', profile: 'pro' }))
    expect(db.reads).toEqual(['discovery_vendors_safe'])
    expect(searchGooglePlacesTextMock).not.toHaveBeenCalled()
    expect(db.changeLogInserts).toEqual([])
    expect(JSON.stringify(db.venue)).toBe(before)
    expect(result).toMatchObject({ observation_status: 'available', changes_detected: 0, applied_changes: [] })
  })

  it.each(['disabled', 'identity_mismatch', 'unavailable'])('does not substitute another vendor on %s', async (status) => {
    if (status === 'disabled') delete process.env.GOOGLE_PLACES_VENDORS_ENABLED
    else process.env.GOOGLE_PLACES_VENDORS_ENABLED = 'true'
    const db = createRefreshDb()
    vendorDetailsMock.mockResolvedValue({ status })
    const result = await refreshDiscoveryEntityFromPlaces({
      supabase: db.client as any, entityType: 'discovery_vendor', entityId: 'venue-1', apiKey: 'test-key',
    })
    expect(result.observation_status).toBe(status)
    expect(searchGooglePlacesTextMock).not.toHaveBeenCalled()
    expect(db.changeLogInserts).toEqual([])
    if (status === 'disabled') expect(vendorDetailsMock).not.toHaveBeenCalled()
  })

  it('never looks up a self-service profile identity as a Place ID', async () => {
    process.env.GOOGLE_PLACES_VENDORS_ENABLED = 'true'
    const db = createRefreshDb()
    db.venue.source = 'vendor_self_service'
    await refreshDiscoveryEntityFromPlaces({ supabase: db.client as any, entityType: 'discovery_vendor', entityId: 'venue-1', apiKey: 'test' })
    expect(vendorDetailsMock).not.toHaveBeenCalled()
    expect(db.changeLogInserts).toEqual([])
  })

})

function createRefreshDb(input: {
  changeLogError?: { code: string; message: string }
} = {}) {
  const venue = {
    id: 'venue-1',
    source: 'google_places',
    source_external_id: 'venue-places-id',
    google_place_id: 'venue-places-id',
    name: 'Mission Room',
    address: '100 Mission St, San Francisco, CA',
    city: 'San Francisco',
    formatted_address: '100 Mission St, San Francisco, CA',
    phone: '(415) 555-0100',
    contact_phone: '(415) 555-0100',
    website: 'https://mission-room.example.com',
    business_status: 'OPERATIONAL',
    google_rating: 4.5,
    google_user_rating_count: 120,
    place_types: [],
    google_user_ratings_total: 120,
    last_meaningful_change_at: null,
  }
  const changeLogInserts: Array<Record<string, unknown>> = []

  const reads: string[] = []
  const client = {
    from(table: string) {
      reads.push(table)
      return new RefreshQuery(table, venue, changeLogInserts, input.changeLogError)
    },
  }

  return { client, changeLogInserts, venue, reads }
}

class RefreshQuery {
  private operation: 'select' | 'insert' | 'update' = 'select'
  private insertPayload: Record<string, unknown> | null = null
  private updatePayload: Record<string, unknown> | null = null

  constructor(
    private readonly table: string,
    private readonly venue: Record<string, unknown>,
    private readonly changeLogInserts: Array<Record<string, unknown>>,
    private readonly changeLogError?: { code: string; message: string }
  ) {}

  select() {
    return this
  }

  insert(payload: Record<string, unknown>) {
    this.operation = 'insert'
    this.insertPayload = payload
    this.changeLogInserts.push(payload)
    return this
  }

  update(payload: Record<string, unknown>) {
    this.operation = 'update'
    this.updatePayload = payload
    return this
  }

  eq() {
    if (this.operation === 'update' && this.table === 'discovery_venues' && this.updatePayload) {
      Object.assign(this.venue, this.updatePayload)
    }
    return this
  }

  maybeSingle() {
    if (this.operation === 'insert') {
      return Promise.resolve({
        data: this.changeLogError ? null : { id: 'change-1' },
        error: this.changeLogError ?? null,
      })
    }
    return Promise.resolve({ data: this.venue, error: null })
  }

  then(resolve: (value: { data: null; error: null }) => void) {
    resolve({ data: null, error: null })
  }
}

describe('C1 venue refresh', () => {
  afterEach(() => delete process.env.GOOGLE_PLACES_VENUES_ENABLED)
  it('never searches by name or writes history even with an exact-ID display response', async () => {
    process.env.GOOGLE_PLACES_VENUES_ENABLED='true'
    const db=createRefreshDb(); const before=JSON.stringify(db.venue)
    detailsMock.mockResolvedValue({status:'available',place_id:'venue-places-id',profile:'pro',attempts:1,place:{id:'venue-places-id',displayName:{text:'GOOGLE_CANARY'}}})
    await refreshDiscoveryEntityFromPlaces({supabase:db.client as any,entityType:'discovery_venue',entityId:'venue-1',apiKey:'test'})
    expect(detailsMock).toHaveBeenCalledWith(expect.objectContaining({placeId:'venue-places-id',profile:'pro'}))
    expect(db.changeLogInserts).toEqual([]);expect(JSON.stringify(db.venue)).toBe(before)
  })
  it('flag-off makes no venue Details call', async()=>{
    delete process.env.GOOGLE_PLACES_VENUES_ENABLED;detailsMock.mockClear()
    await refreshDiscoveryEntityFromPlaces({supabase:createRefreshDb().client as any,entityType:'discovery_venue',entityId:'venue-1',apiKey:'test'})
    expect(detailsMock).not.toHaveBeenCalled()
  })
})
