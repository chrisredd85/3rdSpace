import { independentVenueEvidence, readSafeDiscoveryVenue } from '@/lib/discovery/venueRepository'
jest.mock('server-only', () => ({}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => {
      const headers = new Headers(init?.headers)
      headers.set('content-type', 'application/json')
      return new Response(JSON.stringify(data), {
        ...init,
        status: init?.status ?? 200,
        headers,
      })
    },
  },
}))

jest.mock('@/lib/server/google-places-client', () => {
  const actual = jest.requireActual('@/lib/server/google-places-client')
  return {
    ...actual,
    searchGoogleVenuePlacesText: jest.fn(),
  }
})

jest.mock('@/lib/server/venue-places-details', () => ({
  ...jest.requireActual('@/lib/server/venue-places-details'),
  getVenueDetails: jest.fn(async ({ placeId }) => ({ status: 'available', place_id: placeId, profile: 'enterprise', attempts: 1, place: { id: placeId, displayName: { text: 'Live Google label' } } })),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

import type { NextRequest } from 'next/server'
import { searchPlacesForPlan } from '@/lib/server/places-outreach'
import { getVenueDetails } from '@/lib/server/venue-places-details'
import type { Plan } from '@/lib/types'
import { POST } from '@/app/api/planner/plans/[planId]/discover-venues/route'
import { searchGoogleVenuePlacesText } from '@/lib/server/google-places-client'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const mockSearchGooglePlacesText = searchGoogleVenuePlacesText as jest.Mock
const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock

type Row = Record<string, any>

class MemoryDb {
  rows: Record<string, Row[]>
  mutations: Array<{ table: string; payload: Row }> = []

  constructor(rows: Record<string, Row[]>) {
    this.rows = rows
  }

  auth = {
    getUser: jest.fn().mockResolvedValue({
      data: { user: { id: 'user-1', user_metadata: { user_type: 'community_builder' } } },
      error: null,
    }),
  }

  async rpc(name: string, args: Row) {
    expect(name).toBe('upsert_discovery_venue_identity')
    this.mutations.push({table:'venue_identity_rpc',payload:args})
    let row=this.rows.discovery_venues.find(row => row.source_external_id?.replace(/^places\//, '')===args.p_place_id)
    if (!row) { row={id:`venue-${this.rows.discovery_venues.length}`,source:'google_places',source_external_id:args.p_place_id};this.rows.discovery_venues.push(row) }
    return {data:readSafeDiscoveryVenue(row),error:null}
  }
  from(table: string) {
    if (table==='discovery_venues_safe') this.rows[table]=this.rows.discovery_venues.map(readSafeDiscoveryVenue)
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'select' | 'upsert' = 'select'
  private payload: Row | Row[] | null = null
  private singleResult = false

  constructor(private db: MemoryDb, private table: string) {}

  select(_columns = '*') {
    return this
  }

  upsert(payload: Row | Row[], _options?: unknown) {
    this.operation = 'upsert'
    this.payload = payload
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value)
    return this
  }

  in(field: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[field]))
    return this
  }

  is(field: string, value: unknown) {
    if (value === null) this.filters.push((row) => row[field] == null)
    return this
  }

  order(_field: string, _options?: unknown) {
    return this
  }

  async maybeSingle() {
    const result = await this.execute()
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: null }
  }

  async single() {
    this.singleResult = true
    const result = await this.execute()
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: null }
  }

  async returns<T>() {
    const result = await this.execute()
    return { data: result.data as T, error: null }
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected)
  }

  private async execute() {
    if (!this.db.rows[this.table]) this.db.rows[this.table] = []

    if (this.operation === 'upsert') {
      const payloadRows = Array.isArray(this.payload) ? this.payload : [this.payload]
      const upserted = payloadRows.filter(Boolean).map((payload) => this.upsertRow(payload as Row))
      return { data: this.singleResult ? upserted[0] : upserted, error: null }
    }

    return {
      data: this.db.rows[this.table].filter((row) => this.filters.every((filter) => filter(row))),
      error: null,
    }
  }

  private upsertRow(payload: Row) {
    this.db.mutations.push({ table: this.table, payload: JSON.parse(JSON.stringify(payload)) })
    const rows = this.db.rows[this.table]
    let existing: Row | undefined

    if (this.table === 'discovery_venues') {
      existing = rows.find((row) => row.source === payload.source && row.source_external_id === payload.source_external_id)
    } else if (this.table === 'plan_discovery_venue_candidates') {
      existing = rows.find((row) => row.plan_id === payload.plan_id && row.discovery_venue_id === payload.discovery_venue_id)
    }

    if (existing) {
      Object.assign(existing, payload, { updated_at: '2026-06-18T00:00:00.000Z' })
      return existing
    }

    const row = {
      id: `${this.table}-${rows.length + 1}`,
      ...payload,
      created_at: '2026-06-18T00:00:00.000Z',
      updated_at: '2026-06-18T00:00:00.000Z',
    }
    rows.push(row)
    return row
  }
}

function makeRequest(body: Row) {
  return new Request('http://localhost/api/planner/plans/plan-1/discover-venues', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

function makeDb() {
  return new MemoryDb({
    plans: [{
      id: 'plan-1',
      user_id: 'user-1',
      title: 'Conference plan',
      event_type: 'conference',
      status: 'ready',
      guest_count: 140,
      budget_cap_cents: 2_000_000,
      neighborhood: 'San Francisco',
      date_window_start: null,
      date_window_end: null,
      ticketed: false,
      ticketing_model: 'rsvp',
      food_responsibility: 'venue',
      venue_terms: null,
      agent_action: null,
      profit_goal_cents: null,
      notes: null,
      metadata: {},
      created_at: '2026-06-18T00:00:00.000Z',
      updated_at: '2026-06-18T00:00:00.000Z',
    }],
    discovery_venues: [],
    plan_discovery_venue_candidates: [],
  })
}

describe('POST /api/planner/plans/[planId]/discover-venues', () => {
  const oldApiKey = process.env.GOOGLE_PLACES_API_KEY
  const previousPhotoFlag = process.env.GOOGLE_PLACES_PHOTOS_ENABLED

  beforeEach(() => {
    jest.clearAllMocks()
    ;(getVenueDetails as jest.Mock).mockImplementation(async ({ placeId }) => ({ status: 'available', place_id: placeId, profile: 'enterprise', attempts: 1, place: { id: placeId, displayName: { text: 'Live Google label' } } }))
    process.env.GOOGLE_PLACES_API_KEY = 'google-key'
    process.env.GOOGLE_PLACES_VENUES_ENABLED='true'
    process.env.GOOGLE_PLACES_PHOTOS_ENABLED = 'true'
    const db = makeDb()
    mockCreateClient.mockReturnValue(db)
    mockCreateServiceRoleClient.mockReturnValue(db)
  })

  afterEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = oldApiKey
    delete process.env.GOOGLE_PLACES_VENUES_ENABLED
    if (previousPhotoFlag === undefined) delete process.env.GOOGLE_PLACES_PHOTOS_ENABLED
    else process.env.GOOGLE_PLACES_PHOTOS_ENABLED = previousPhotoFlag
  })

  it('never writes unsolicited photos and does not purge old stored photo values', async () => {
    const db = makeDb()
    db.rows.discovery_venues.push({ id: 'old-venue', source: 'google_places', source_external_id: 'places/marriott',
      photos: [{ name: 'places/marriott/photos/legacy-token' }], google_photo_names: ['opaque-legacy-token'] })
    mockCreateClient.mockReturnValue(db)
    mockCreateServiceRoleClient.mockReturnValue(db)
    mockSearchGooglePlacesText.mockImplementation(async (input: Row) => ({ request: { textQuery: input.textQuery },
      places: [{ id: 'places/marriott', displayName: { text: 'Marriott Ballroom' }, photos: [{ name: 'places/marriott/photos/new-token' }] }],
    }))
    const response = await POST(makeRequest({ maxResultCount: 8 }), { params: Promise.resolve({ planId: 'plan-1' }) })
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(db.mutations.filter(write => write.table === 'discovery_venues')).toHaveLength(0)
    expect(db.mutations.filter(write => write.table === 'venue_identity_rpc')).toHaveLength(1)
    for (const write of db.mutations) {
      expect(write.payload).not.toHaveProperty('photos')
      expect(write.payload).not.toHaveProperty('google_photo_names')
      expect(JSON.stringify(write.payload)).not.toMatch(/new-token|legacy-token/)
    }
    expect(db.rows.discovery_venues[0].photos).toEqual([{ name: 'places/marriott/photos/legacy-token' }])
    expect(db.rows.discovery_venues[0].google_photo_names).toEqual(['opaque-legacy-token'])
    expect(JSON.stringify(json)).not.toMatch(/new-token|legacy-token/)
    expect(json.candidates[0].photo_urls).toHaveLength(3)
  })

  it('scores the complete 3-area by 4-query by 20-result pool before selecting at most 20 IDs', async () => {
    const db = makeDb()
    const evidence = independentVenueEvidence('host_input', 'test:host-capacity')
    db.rows.discovery_venues.push({ id: 'late-known', source: 'google_places', source_external_id: 'slot239',
      capacity_standing: 400, metadata: { field_provenance: { capacity_standing: evidence } } })
    let queryIndex = 0
    mockSearchGooglePlacesText.mockImplementation(async (input: Row) => {
      const start = queryIndex++ * 20
      return { request: { textQuery: input.textQuery, includedType: input.includedType },
        places: Array.from({ length: 20 }, (_, index) => ({ id: `slot${start + index}`,
          displayName: { text: `Provider ${start + index}` }, primaryType: 'event_venue',
          formattedAddress: 'Mission, San Francisco, CA' })) }
    })
    const result = await searchPlacesForPlan(db.rows.plans[0] as Plan, { admin: db as any,
      apiKey: 'test', areas: ['San Francisco', 'Oakland', 'Berkeley', 'ignored-fourth-area'], maxResultCount: 20, searchedByUserId: 'user-1' })
    expect(mockSearchGooglePlacesText).toHaveBeenCalledTimes(12)
    expect(mockSearchGooglePlacesText.mock.calls.every(([input]) => input.maxResultCount === 20)).toBe(true)
    expect(result.places_result_counts.total).toBe(240)
    expect(result.venues).toHaveLength(20)
    const hydrated = (getVenueDetails as jest.Mock).mock.calls.map(([input]) => input.placeId)
    expect(hydrated).toHaveLength(20)
    expect(hydrated).toContain('slot239')
    expect(new Set(hydrated).size).toBe(20)
    expect(db.mutations.filter(write => write.table === 'venue_identity_rpc')).toHaveLength(20)
    expect(JSON.stringify(db.mutations)).not.toMatch(/Provider|fit_score":(?:[0-9])|latitude|google_rating/)
  })

  it('uses fresh ratings to reorder only the selected shortlist and never hydrates discarded IDs', async () => {
    const db = makeDb()
    mockSearchGooglePlacesText.mockImplementation(async (input: Row) => ({ request: { textQuery: input.textQuery, includedType: input.includedType },
      places: ['first', 'second', 'discarded'].map(id => ({ id, displayName: { text: 'Same event venue' }, primaryType: 'event_venue',
        formattedAddress: 'San Francisco, CA', rating: id === 'discarded' ? 5 : 1, userRatingCount: 999 })) }))
    ;(getVenueDetails as jest.Mock).mockImplementation(async ({ placeId }) => ({ status: 'available', place_id: placeId, profile: 'enterprise', attempts: 1,
      place: { id: placeId, displayName: { text: 'Same event venue' }, primaryType: 'event_venue', formattedAddress: 'San Francisco, CA',
        rating: placeId === 'second' ? 5 : 1, userRatingCount: placeId === 'second' ? 40 : 0 } }))
    const result = await searchPlacesForPlan(db.rows.plans[0] as Plan, { admin: db as any, apiKey: 'test', areas: ['San Francisco'], maxResultCount: 2 })
    expect((getVenueDetails as jest.Mock).mock.calls.map(([input]) => input.placeId)).toEqual(['first', 'second'])
    expect(result.venues.map(row => row.source_external_id)).toEqual(['second', 'first'])
    const byPlace = Object.fromEntries(Object.values(result.google_live_overlays).map(overlay => [overlay.place_id, overlay.fit_score]))
    // Existing weights: 5 stars/40 reviews = 12, 1 star/0 reviews = 1.6; whole fit rounds once.
    expect(byPlace.second! - byPlace.first!).toBe(10)
    expect(db.mutations.every(write => write.table === 'venue_identity_rpc')).toBe(true)
  })

  it('runs conference Pro queries, dedupes exact identity and persists no Google facts or derived clusters', async () => {
    mockSearchGooglePlacesText.mockImplementation(async (input: Row) => ({
      request: {
        textQuery: input.textQuery,
        includedType: input.includedType,
        maxResultCount: input.maxResultCount,
        languageCode: 'en',
        regionCode: 'US',
        includePureServiceAreaBusinesses: false,
      },
      places: placesForType(input.includedType),
    }))

    const response = await POST(makeRequest({ maxResultCount: 8 }), { params: { planId: 'plan-1' } })
    const json = await response.json()
    const db = mockCreateServiceRoleClient.mock.results[0].value as MemoryDb

    expect(response.status).toBe(200)
    expect(mockSearchGooglePlacesText.mock.calls.map((call) => call[0].includedType)).toEqual([
      'convention_center',
      'hotel',
      'event_venue',
      'banquet_hall',
    ])
    expect(db.rows.discovery_venues).toHaveLength(3)
    expect(db.rows.discovery_venues.every(row=>!row.name && !row.metadata)).toBe(true)
    expect(db.mutations.filter(write=>write.table==='plan_discovery_venue_candidates').every(write=>write.payload.fit_score===null)).toBe(true)
    expect(json.places_result_counts).toEqual({
      total: 4,
      by_type: {
        convention_center: 1,
        hotel: 1,
        event_venue: 1,
        banquet_hall: 1,
      },
    })
    expect(Object.keys(json.google_live_overlays)).toHaveLength(3)

  })
})

function placesForType(type: string) {
  if (type === 'convention_center') {
    return [{
      id: 'places/moscone',
      displayName: { text: 'Moscone Center' },
      formattedAddress: '747 Howard St, San Francisco, CA',
      primaryType: 'convention_center',
      types: ['convention_center', 'event_venue'],
      businessStatus: 'OPERATIONAL',
    }]
  }
  if (type === 'hotel') {
    return [{
      id: 'places/marriott',
      displayName: { text: 'Marriott Union Square Ballroom' },
      formattedAddress: '480 Sutter St, San Francisco, CA',
      primaryType: 'hotel',
      types: ['hotel', 'lodging', 'banquet_hall'],
      businessStatus: 'OPERATIONAL',
      websiteUri: 'https://marriott.example',
    }]
  }
  if (type === 'event_venue') {
    return [{
      id: 'places/marriott',
      displayName: { text: 'Marriott Union Square Ballroom' },
      formattedAddress: '480 Sutter St, San Francisco, CA',
      primaryType: 'hotel',
      types: ['hotel', 'lodging', 'banquet_hall'],
      businessStatus: 'OPERATIONAL',
      websiteUri: 'https://marriott.example',
    }]
  }
  if (type === 'banquet_hall') {
    return [{
      id: 'places/palace-banquet',
      displayName: { text: 'Palace Banquet Hall' },
      formattedAddress: '2 New Montgomery St, San Francisco, CA',
      primaryType: 'banquet_hall',
      types: ['banquet_hall', 'event_venue'],
      businessStatus: 'OPERATIONAL',
    }]
  }
  return []
}
