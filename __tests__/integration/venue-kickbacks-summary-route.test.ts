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

import { GET } from '@/app/api/venue/community-host-incentive/summary/route'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedVenueOwner } from '@/lib/stripe/connect'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/stripe/connect', () => ({
  getAuthenticatedVenueOwner: jest.fn(),
}))

type Row = Record<string, unknown>

const AGREEMENT_ID = '11111111-1111-4111-8111-111111111111'
const PLAN_ID = '22222222-2222-4222-8222-222222222222'
const VENUE_OWNER_ID = '33333333-3333-4333-8333-333333333333'
const BUILDER_ID = '44444444-4444-4444-8444-444444444444'

class MemoryDb {
  rows: Record<string, Row[]> = {
    kickback_payments: [],
    event_kickback_agreements: [
      {
        id: AGREEMENT_ID,
        event_id: null,
        plan_id: PLAN_ID,
        venue_id: 'venue-1',
        venue_owner_id: VENUE_OWNER_ID,
        builder_id: BUILDER_ID,
        actual_attendance: 90,
        per_head_amount: null,
        minimum_attendees: null,
        maximum_payout: null,
        actual_kickback_amount: null,
        reported_revenue_cents: null,
        revenue_proof_url: null,
        revenue_extracted_value_cents: null,
        revenue_extraction_confidence: null,
        revenue_submitted_at: null,
        bar_revenue_share_percent: 12,
        ticket_revenue_share_percent: null,
        lift_share_percentage: null,
        status: 'attendance_locked',
      },
    ],
    plans: [{ id: PLAN_ID, title: 'Founder dinner', date_window_start: '2026-06-19T00:00:00.000Z' }],
    events: [],
    builder_profiles: [{ id: 'builder-profile-1', user_id: BUILDER_ID, name: 'Chris Builder' }],
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private selectedColumns: string | null = null
  private limitCount: number | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select(columns = '*') {
    this.selectedColumns = columns
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

  order() {
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private execute() {
    const rows = this.projectRows((this.db.rows[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row))))
    return { data: this.limitCount === null ? rows : rows.slice(0, this.limitCount), error: null }
  }

  private projectRows(rows: Row[]) {
    if (!this.selectedColumns || this.selectedColumns === '*') return rows
    const columns = this.selectedColumns.split(',').map((column) => column.trim()).filter(Boolean)
    return rows.map((row) => {
      const projected: Row = {}
      columns.forEach((column) => {
        projected[column] = row[column]
      })
      return projected
    })
  }
}

describe('GET /api/venue/community-host-incentive/summary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockReturnValue({})
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(new MemoryDb())
    ;(getAuthenticatedVenueOwner as jest.Mock).mockResolvedValue({
      user: { id: VENUE_OWNER_ID },
      owner: { id: VENUE_OWNER_ID, email: 'owner@example.com' },
      error: null,
      status: 200,
    })
  })

  it('surfaces attendance-locked agreements that still need venue POS proof', async () => {
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.payments).toHaveLength(1)
    expect(json.payments[0]).toMatchObject({
      id: `agreement:${AGREEMENT_ID}`,
      agreement_id: AGREEMENT_ID,
      payment_id: null,
      status: 'revenue_report_needed',
      proof_status: 'needed',
      event_name: 'Founder dinner',
      builder_name: 'Chris Builder',
      actual_attendance: 90,
      reported_revenue_cents: null,
      revenue_share_percent: 12,
    })
  })
})
