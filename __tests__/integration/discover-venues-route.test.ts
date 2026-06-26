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
    searchGooglePlacesText: jest.fn(),
  }
})

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

import type { NextRequest } from 'next/server'
import { POST } from '@/app/api/planner/plans/[planId]/discover-venues/route'
import { searchGooglePlacesText } from '@/lib/server/google-places-client'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const mockSearchGooglePlacesText = searchGooglePlacesText as jest.Mock
const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock

type Row = Record<string, any>

class MemoryDb {
  rows: Record<string, Row[]>

  constructor(rows: Record<string, Row[]>) {
    this.rows = rows
  }

  auth = {
    getUser: jest.fn().mockResolvedValue({
      data: { user: { id: 'user-1', user_metadata: { user_type: 'community_builder' } } },
      error: null,
    }),
  }

  from(table: string) {
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
    const table = this.table === 'discovery_venues_with_contact'
      ? 'discovery_venues'
      : this.table
    if (!this.db.rows[table]) this.db.rows[table] = []

    if (this.operation === 'upsert') {
      const payloadRows = Array.isArray(this.payload) ? this.payload : [this.payload]
      const upserted = payloadRows.filter(Boolean).map((payload) => this.upsertRow(payload as Row))
      return { data: this.singleResult ? upserted[0] : upserted, error: null }
    }

    return {
      data: this.db.rows[table].filter((row) => this.filters.every((filter) => filter(row))),
      error: null,
    }
  }

  private upsertRow(payload: Row) {
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

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.GOOGLE_PLACES_API_KEY = 'google-key'
    const db = makeDb()
    mockCreateClient.mockReturnValue(db)
    mockCreateServiceRoleClient.mockReturnValue(db)
  })

  afterEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = oldApiKey
  })

  it('runs conference multi-query searches, dedupes places, and stores cluster metadata', async () => {
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
    expect(db.rows.discovery_venues.find((row) => row.source_external_id === 'places/marriott')?.metadata).toMatchObject({
      places_intent_cluster_label: 'event_space',
      places_intent_requested_types: ['convention_center', 'hotel', 'event_venue', 'banquet_hall'],
      venue_cluster_id: 'hotel_marriott_union_square_san_francisco',
      subspace_hint: 'ballroom',
    })
    expect(json.places_result_counts).toEqual({
      total: 4,
      by_type: {
        convention_center: 1,
        hotel: 1,
        event_venue: 1,
        banquet_hall: 1,
      },
    })
    expect(json.places_request.intent.primary_types).toEqual([
      'convention_center',
      'hotel',
      'event_venue',
      'banquet_hall',
    ])
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
