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

import { GET } from '@/app/api/internal/jobs/venue-website-extraction/route'
import { inferVenueCapacity } from '@/lib/discovery/inferVenueCapacity'
import { extractVenueContacts } from '@/lib/server/venue-website-extractor'
import { createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/discovery/inferVenueCapacity', () => ({
  buildVenueCapacityInferenceUpdate: jest.fn((inference, inferredAt) => ({
    inferred_capacity_standing: inference?.standing ?? null,
    inferred_capacity_seated: inference?.seated ?? null,
    capacity_inference_confidence: inference?.confidence ?? 0,
    capacity_inference_source_quote: inference?.source_quote ?? null,
    capacity_inference_model: inference?.model ?? 'gpt-4o-mini',
    capacity_inference_admin_status: 'pending',
    capacity_inference_extracted_at: inferredAt,
    updated_at: inferredAt,
  })),
  inferVenueCapacity: jest.fn(),
  readVenuePlaceTypes: jest.fn(() => ['bar']),
  shouldSkipVenueCapacityInference: jest.fn((venue) => Boolean(venue.capacity_inference_extracted_at)),
}))

jest.mock('@/lib/server/venue-website-extractor', () => ({
  extractVenueContacts: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))

type Row = Record<string, unknown>

class MemoryDb {
  rows: Record<string, Row[]> = {
    discovery_venues: [],
  }

  from(table: string) {
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'select' | 'update' = 'select'
  private payload: Row | null = null
  private limitCount: number | null = null
  private orderField: string | null = null
  private ascending = true

  constructor(private db: MemoryDb, private table: string) {}

  select(_columns = '*') {
    return this
  }

  update(payload: Row) {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value)
    return this
  }

  not(field: string, operator: string, value: unknown) {
    if (operator === 'is' && value === null) {
      this.filters.push((row) => row[field] !== null && row[field] !== undefined)
    }
    return this
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderField = field
    this.ascending = options?.ascending ?? true
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  returns<T>() {
    return this as unknown as PromiseLike<{ data: T; error: null }>
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private execute() {
    if (this.operation === 'update') {
      const rows = this.applyFilters()
      rows.forEach((row) => Object.assign(row, this.payload))
      return { data: rows, error: null }
    }

    return { data: this.applyFilters(), error: null }
  }

  private applyFilters() {
    let rows = (this.db.rows[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)))
    if (this.orderField) {
      rows = [...rows].sort((first, second) => {
        const firstValue = String(first[this.orderField!] ?? '')
        const secondValue = String(second[this.orderField!] ?? '')
        return this.ascending ? firstValue.localeCompare(secondValue) : secondValue.localeCompare(firstValue)
      })
    }
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount)
    return rows
  }
}

function makeRequest(secret: string | null) {
  return {
    headers: new Headers(secret ? { authorization: `Bearer ${secret}` } : {}),
  } as never
}

function discoveryVenue(id: number, overrides: Row = {}): Row {
  return {
    id: `venue-${id}`,
    name: `Venue ${id}`,
    address: null,
    website: `https://venue-${id}.example.com`,
    contact_email: null,
    extracted_emails: [],
    website_extraction_status: null,
    website_extraction_attempts: 0,
    website_extraction_attempted_at: null,
    capacity_inference_extracted_at: null,
    metadata: { venue_type: 'bar' },
    ...overrides,
  }
}

describe('GET /api/internal/jobs/venue-website-extraction', () => {
  const originalSecret = process.env.CRON_SECRET
  const originalOpenAiKey = process.env.OPENAI_API_KEY
  let db: MemoryDb

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
    delete process.env.OPENAI_API_KEY
    db = new MemoryDb()
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
    ;(extractVenueContacts as jest.Mock).mockResolvedValue({
      status: 'successful',
      emails: [{
        email: 'events@example.com',
        confidence: 0.9,
        source_path: '/events',
        extracted_at: '2026-06-24T00:00:00.000Z',
        is_likely_booking_contact: true,
      }],
      metadata: {
        paths_attempted: ['/'],
        paths_successful: ['/events'],
        total_fetch_time_ms: 120,
        robots_txt_consulted: true,
      },
    })
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret
    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey
    }
  })

  it('rejects requests without the cron bearer secret', async () => {
    const response = await GET(makeRequest(null))

    expect(response.status).toBe(401)
    expect(extractVenueContacts).not.toHaveBeenCalled()
  })

  it('returns an empty summary when no venues are queued', async () => {
    const response = await GET(makeRequest('cron-secret'))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      processed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      results: [],
    })
    expect(extractVenueContacts).not.toHaveBeenCalled()
  })

  it('processes at most five queued venues per cron invocation', async () => {
    db.rows.discovery_venues = Array.from({ length: 6 }, (_, index) => discoveryVenue(index + 1))

    const response = await GET(makeRequest('cron-secret'))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      processed: 5,
      successful: 5,
      failed: 0,
    })
    expect(extractVenueContacts).toHaveBeenCalledTimes(5)
    expect(inferVenueCapacity).not.toHaveBeenCalled()
    expect(db.rows.discovery_venues.slice(0, 5)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        website_extraction_status: 'successful',
        extracted_emails: expect.arrayContaining([
          expect.objectContaining({ email: 'events@example.com' }),
        ]),
      }),
    ]))
    expect(db.rows.discovery_venues[5]).toEqual(expect.objectContaining({
      id: 'venue-6',
      website_extraction_status: null,
    }))
  })

  it('skips venues that already have contact data or exhausted extraction attempts', async () => {
    db.rows.discovery_venues = [
      discoveryVenue(1, { contact_email: 'bookings@example.com' }),
      discoveryVenue(2, {
        extracted_emails: [{ email: 'events@example.com', confidence: 0.8, source_path: '/', extracted_at: 'now', is_likely_booking_contact: true }],
      }),
      discoveryVenue(3, { website_extraction_status: 'successful' }),
      discoveryVenue(4, { website_extraction_attempts: 3 }),
      discoveryVenue(5, { website: null }),
    ]

    const response = await GET(makeRequest('cron-secret'))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      processed: 0,
      successful: 0,
      failed: 0,
      skipped: 4,
    })
    expect(extractVenueContacts).not.toHaveBeenCalled()
  })

  it('persists capacity inference fields when OpenAI is configured for queued venues', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    ;(inferVenueCapacity as jest.Mock).mockResolvedValue({
      standing: 80,
      seated: 36,
      confidence: 0.76,
      source_quote: 'Private events up to 80 guests.',
      model: 'gpt-4o-mini',
    })
    db.rows.discovery_venues = [discoveryVenue(1, { name: 'Moongate Lounge' })]

    const response = await GET(makeRequest('cron-secret'))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.results).toEqual([
      expect.objectContaining({
        id: 'venue-1',
        status: 'successful',
        capacity_inferred: true,
      }),
    ])
    expect(inferVenueCapacity).toHaveBeenCalledWith({
      name: 'Moongate Lounge',
      place_types: ['bar'],
      website_url: 'https://venue-1.example.com',
      formatted_address: null,
    }, null)
    expect(db.rows.discovery_venues[0]).toEqual(expect.objectContaining({
      inferred_capacity_standing: 80,
      inferred_capacity_seated: 36,
      capacity_inference_confidence: 0.76,
      capacity_inference_source_quote: 'Private events up to 80 guests.',
      capacity_inference_model: 'gpt-4o-mini',
      capacity_inference_admin_status: 'pending',
      website_extraction_status: 'successful',
    }))
  })
})
