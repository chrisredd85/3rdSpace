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
import { enqueueVenueCapacityInferenceJob } from '@/lib/discovery/venueCapacityJobs'
import { extractVenueContacts } from '@/lib/server/venue-website-extractor'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getVenueContactDetails } from '@/lib/server/venue-places-details'
import { independentVenueEvidence } from '@/lib/discovery/venueRepository'
import { createOrReuseGmailOutreachApproval, GmailConnectionRequiredError } from '@/lib/outreach/gmailApprovalFlow'

jest.mock('@/lib/server/venue-places-details', () => ({ getVenueContactDetails: jest.fn() }))
jest.mock('@/lib/outreach/gmailApprovalFlow', () => ({
  createOrReuseGmailOutreachApproval: jest.fn(),
  GmailConnectionRequiredError: class GmailConnectionRequiredError extends Error {},
}))

jest.mock('@/lib/server/venue-website-extractor', () => ({
  extractVenueContacts: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/discovery/venueCapacityJobs', () => ({
  enqueueVenueCapacityInferenceJob: jest.fn(),
  hasKnownCapacity: (venue: Record<string, unknown>) =>
    [venue.capacity_cocktail, venue.capacity_standing, venue.capacity_seated]
      .some((value) => typeof value === 'number' && Number.isFinite(value) && value > 0),
}))

type Row = Record<string, unknown>

class MemoryDb {
  rows: Record<string, Row[]> = {
    discovery_venues: [],
  }
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  failTable: string | null = null

  from(table: string) {
    return new MemoryQuery(this, table === 'discovery_venues_safe' ? 'discovery_venues' : table)
  }

  async rpc(name: string, args: Record<string, any>) {
    this.rpcCalls.push({ name, args })
    if (name !== 'write_discovery_venue_independent_facts') return { data: null, error: { message: 'Unknown RPC' } }
    const row = this.rows.discovery_venues.find((entry) => entry.id === args.p_venue_id)
    if (!row) return { data: null, error: { message: 'Missing venue' } }
    const metadata = (row.metadata ?? {}) as Record<string, any>
    Object.assign(row, args.p_values, args.p_operational, { metadata: {
      venue_boundary_version: 1,
      field_provenance: { ...(metadata.field_provenance ?? {}), ...args.p_field_provenance },
    } })
    return { data: row, error: null }
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

  is(field: string, value: unknown) { this.filters.push((row) => (row[field] ?? null) === value); return this }
  async maybeSingle() {
    const result = this.execute()
    return { ...result, data: Array.isArray(result.data) ? result.data[0] ?? null : result.data }
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
    if (this.db.failTable === this.table) return { data: null, error: { message: 'pending candidate SELECT failed' } as any }
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
  const row: Row = {
    id: `venue-${id}`,
    name: `Venue ${id}`,
    website: `https://venue-${id}.example.com`,
    contact_email: null,
    extracted_emails: [],
    website_extraction_status: null,
    website_extraction_attempts: 0,
    website_extraction_attempted_at: null,
    ...overrides,
  }
  if (!('metadata' in overrides)) row.metadata = { venue_boundary_version: 1, field_provenance: Object.fromEntries(
    ['name', 'website', 'contact_email', 'extracted_emails', 'extracted_contact_forms', 'organizer_provided_emails']
      .filter((field) => row[field] != null)
      .map((field) => [field, independentVenueEvidence('venue_site', `https://venue-${id}.example.com/events`)]),
  ) }
  return row
}

function pendingCandidate() {
  return { id: 'candidate-1', discovery_venue_id: 'venue-1', plan_id: 'plan-1', status: 'candidate', dismissed_at: null,
    places_request_json: { google_name: 'FORBIDDEN_OLD_NAME', outreach_draft_request: {
      status: 'extraction_pending', requested_by_user_id: 'host-1', requested_at: '2026-09-22T00:00:00Z', updated_at: '2026-09-22T00:00:00Z',
    } } }
}

describe('GET /api/internal/jobs/venue-website-extraction', () => {
  const originalSecret = process.env.CRON_SECRET
  const originalOpenAIKey = process.env.OPENAI_API_KEY
  const originalVenueFlag = process.env.GOOGLE_PLACES_VENUES_ENABLED
  let db: MemoryDb

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
    delete process.env.OPENAI_API_KEY
    delete process.env.GOOGLE_PLACES_VENUES_ENABLED
    db = new MemoryDb()
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
    ;(enqueueVenueCapacityInferenceJob as jest.Mock).mockResolvedValue({ id: 'job-1' })
    ;(getVenueContactDetails as jest.Mock).mockResolvedValue(null)
    ;(createOrReuseGmailOutreachApproval as jest.Mock).mockResolvedValue({ approval: { id: 'approval-1' }, approvalMessageId: 'message-1' })
    ;(extractVenueContacts as jest.Mock).mockResolvedValue({
      status: 'successful',
      emails: [{
        email: 'events@venue.test',
        confidence: 0.9,
        source_path: '/events',
        extracted_at: '2026-06-24T00:00:00.000Z',
        is_likely_booking_contact: true,
        source: 'business_website',
        source_url: 'https://venue.test/events',
      }],
      contact_forms: [],
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
    if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAIKey
    if (originalVenueFlag === undefined) delete process.env.GOOGLE_PLACES_VENUES_ENABLED
    else process.env.GOOGLE_PLACES_VENUES_ENABLED = originalVenueFlag
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
    expect(db.rows.discovery_venues.slice(0, 5)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        website_extraction_status: 'successful',
        extracted_emails: expect.arrayContaining([
          expect.objectContaining({ email: 'events@venue.test' }),
        ]),
      }),
    ]))
    expect(db.rows.discovery_venues[5]).toEqual(expect.objectContaining({
      id: 'venue-6',
      website_extraction_status: null,
    }))
  })

  it('queues venue capacity inference after website extraction when capacity is unknown', async () => {
    process.env.OPENAI_API_KEY = 'openai-key'
    db.rows.discovery_venues = [discoveryVenue(1)]

    const response = await GET(makeRequest('cron-secret'))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(enqueueVenueCapacityInferenceJob).toHaveBeenCalledWith(expect.anything(), 'venue-1')
    expect(json.results[0]).toMatchObject({
      id: 'venue-1',
      capacity_job_queued: true,
    })
  })

  it('skips venues that already have contact data or exhausted extraction attempts', async () => {
    db.rows.discovery_venues = [
      discoveryVenue(1, { contact_email: 'bookings@example.com' }),
      discoveryVenue(2, {
        extracted_emails: [{ email: 'events@venue.test', confidence: 0.8, source_path: '/', extracted_at: 'now', is_likely_booking_contact: true }],
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
      skipped: 5,
    })
    expect(extractVenueContacts).not.toHaveBeenCalled()
  })

  it('hydrates an ID-only venue without persisting the Google locator or name', async () => {
    db.rows.plan_discovery_venue_candidates = [pendingCandidate()]
    process.env.GOOGLE_PLACES_VENUES_ENABLED = 'true'
    db.rows.discovery_venues = [discoveryVenue(1, { source: 'google_places', source_external_id: 'place-1', website: 'https://LEGACY_GOOGLE_LOCATOR.test', name: 'LEGACY_GOOGLE_NAME', metadata: {} })]
    ;(getVenueContactDetails as jest.Mock).mockResolvedValue({ websiteUri: 'https://FRESH_GOOGLE_LOCATOR.test' })
    const response = await GET(makeRequest('cron-secret'))
    expect((await response.json()).successful).toBe(1)
    expect(getVenueContactDetails).toHaveBeenCalledWith('place-1')
    expect(extractVenueContacts).toHaveBeenCalledWith('https://FRESH_GOOGLE_LOCATOR.test', expect.objectContaining({ venueName: undefined }))
    expect(JSON.stringify(db.rpcCalls)).not.toMatch(/GOOGLE_LOCATOR|GOOGLE_NAME/)
    expect(db.rows.discovery_venues[0].extracted_emails).toEqual(expect.arrayContaining([expect.objectContaining({ source_url: 'https://venue.test/events' })]))
  })

  it('does not spend a contact Details request on a venue absent from saved candidates', async () => {
    process.env.GOOGLE_PLACES_VENUES_ENABLED = 'true'
    db.rows.discovery_venues = [discoveryVenue(1, { source: 'google_places', source_external_id: 'unselected', website: null, metadata: {} })]
    const response = await GET(makeRequest('cron-secret'))
    expect((await response.json()).skipped).toBe(1)
    expect(getVenueContactDetails).not.toHaveBeenCalled()
    expect(extractVenueContacts).not.toHaveBeenCalled()
  })

  it('makes no Google call with the flag off while independent website discovery still works', async () => {
    db.rows.discovery_venues = [discoveryVenue(1, { source: 'google_places', source_external_id: 'place-1', website: null, metadata: {} }), discoveryVenue(2)]
    const response = await GET(makeRequest('cron-secret'))
    expect((await response.json()).processed).toBe(1)
    expect(getVenueContactDetails).not.toHaveBeenCalled()
    expect(extractVenueContacts).toHaveBeenCalledTimes(1)
  })

  it('does not clear saved contact evidence when the pending-candidate SELECT fails', async () => {
    db.rows.discovery_venues = [discoveryVenue(1)]
    db.failTable = 'plan_discovery_venue_candidates'
    const response = await GET(makeRequest('cron-secret'))
    expect((await response.json()).results[0]).toMatchObject({ status: 'successful', draft_resume_failed: true })
    expect(db.rows.discovery_venues[0].extracted_emails).toEqual(expect.arrayContaining([expect.objectContaining({ email: 'events@venue.test' })]))
    expect(db.rpcCalls).toHaveLength(1)
    expect(createOrReuseGmailOutreachApproval).not.toHaveBeenCalled()
  })

  it('keeps saved contacts and creates one pending approval across repeated worker runs', async () => {
    db.rows.discovery_venues = [discoveryVenue(1)]
    db.rows.plan_discovery_venue_candidates = [pendingCandidate()]
    db.rows.plans = [{ id: 'plan-1', user_id: 'host-1' }]
    const first = await GET(makeRequest('cron-secret'))
    expect((await first.json()).successful).toBe(1)
    const savedVenue = JSON.stringify(db.rows.discovery_venues[0])
    const savedCandidate = JSON.stringify(db.rows.plan_discovery_venue_candidates[0])
    expect((db.rows.plan_discovery_venue_candidates[0].places_request_json as any).outreach_draft_request).toMatchObject({ status: 'draft_created', approval_id: 'approval-1' })

    const second = await GET(makeRequest('cron-secret'))
    expect((await second.json()).processed).toBe(0)
    expect(JSON.stringify(db.rows.discovery_venues[0])).toBe(savedVenue)
    expect(JSON.stringify(db.rows.plan_discovery_venue_candidates[0])).toBe(savedCandidate)
    expect(extractVenueContacts).toHaveBeenCalledTimes(1)
    expect(db.rpcCalls).toHaveLength(1)
    expect(createOrReuseGmailOutreachApproval).toHaveBeenCalledTimes(1)
    expect(getVenueContactDetails).not.toHaveBeenCalled()
  })

  it.each(['blocked_by_robots', 'no_emails_found', 'form_only'])('clears a pending draft request after %s without sending', async (outcome) => {
    db.rows.discovery_venues = [discoveryVenue(1)]
    db.rows.plan_discovery_venue_candidates = [pendingCandidate()]
    db.rows.plans = [{ id: 'plan-1', user_id: 'host-1' }]
    ;(extractVenueContacts as jest.Mock).mockResolvedValue({
      status: outcome === 'form_only' ? 'no_emails_found' : outcome, emails: [],
      contact_forms: outcome === 'form_only' ? [{ url: 'https://venue.test/events', label: 'Event inquiry', confidence: 0.9, source_path: '/events', source_url: 'https://venue.test/events', source: 'business_website', evidence_kind: 'observed_form', extracted_at: '2026-09-22T00:00:00Z', is_likely_booking_contact: true }] : [],
      metadata: { paths_attempted: ['/'], paths_successful: [], total_fetch_time_ms: 0, robots_txt_consulted: true },
    })
    await GET(makeRequest('cron-secret'))
    expect((db.rows.plan_discovery_venue_candidates[0].places_request_json as any).outreach_draft_request.status).toBe('email_required')
    expect(JSON.stringify(db.rows.plan_discovery_venue_candidates)).not.toContain('FORBIDDEN_OLD_NAME')
    expect(createOrReuseGmailOutreachApproval).not.toHaveBeenCalled()
  })

  it('reconciles an already exhausted pending request without another crawl', async () => {
    db.rows.discovery_venues = [discoveryVenue(1, { website_extraction_status: 'timeout', website_extraction_attempts: 3 })]
    db.rows.plan_discovery_venue_candidates = [pendingCandidate()]
    db.rows.plans = [{ id: 'plan-1', user_id: 'host-1' }]
    await GET(makeRequest('cron-secret'))
    expect((db.rows.plan_discovery_venue_candidates[0].places_request_json as any).outreach_draft_request.status).toBe('email_required')
    expect(extractVenueContacts).not.toHaveBeenCalled()
  })

  it('keeps saved contacts when an individual Gmail-required draft failure is caught', async () => {
    db.rows.discovery_venues = [discoveryVenue(1)]
    db.rows.plan_discovery_venue_candidates = [pendingCandidate()]
    db.rows.plans = [{ id: 'plan-1', user_id: 'host-1' }]
    ;(createOrReuseGmailOutreachApproval as jest.Mock).mockRejectedValue(new GmailConnectionRequiredError())
    const response = await GET(makeRequest('cron-secret'))
    expect((await response.json()).results[0].draft_resume_failed).toBe(false)
    expect((db.rows.plan_discovery_venue_candidates[0].places_request_json as any).outreach_draft_request.status).toBe('gmail_required')
    expect(db.rows.discovery_venues[0].extracted_emails).toEqual(expect.arrayContaining([expect.objectContaining({ email: 'events@venue.test' })]))
    expect(db.rpcCalls).toHaveLength(1)
  })
})
