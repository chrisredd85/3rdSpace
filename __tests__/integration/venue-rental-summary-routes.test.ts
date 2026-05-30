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

import { GET as getBuilderVenueRentals } from '@/app/api/planner/payments/venue-rentals/summary/route'
import { GET as getVenueRentals } from '@/app/api/venue/rentals/summary/route'
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

const BUILDER_ID = 'builder-1'
const OTHER_BUILDER_ID = 'builder-2'
const VENUE_OWNER_ID = 'venue-owner-1'
const OTHER_VENUE_OWNER_ID = 'venue-owner-2'

class MemoryDb {
  rows: Record<string, Row[]> = {
    plans: [
      { id: 'plan-1', user_id: BUILDER_ID, title: 'NSBE mixer', date_window_start: '2026-06-01T00:00:00.000Z' },
      { id: 'plan-2', user_id: OTHER_BUILDER_ID, title: 'Other event', date_window_start: '2026-06-02T00:00:00.000Z' },
    ],
    venues: [{ id: 'venue-1', venue_name: 'The Roof' }],
    builder_profiles: [
      { user_id: BUILDER_ID, name: 'NSBE Builder' },
      { user_id: OTHER_BUILDER_ID, name: 'Other Builder' },
    ],
    venue_payment_transactions: [
      {
        id: 'tx-1',
        plan_id: 'plan-1',
        venue_booking_id: 'booking-1',
        builder_id: BUILDER_ID,
        venue_id: 'venue-1',
        venue_owner_id: VENUE_OWNER_ID,
        amount_cents: 120000,
        processing_fee_cents: 3510,
        venue_payout_cents: 120000,
        currency: 'usd',
        status: 'paid',
        payment_method_type: 'card',
        stripe_transfer_id: 'tr_1',
        refund_amount_cents: null,
        refund_reason: null,
        paid_at: '2026-06-01T10:00:00.000Z',
        transfer_completed_at: '2026-06-01T10:01:00.000Z',
        created_at: '2026-06-01T09:00:00.000Z',
      },
      {
        id: 'tx-refund',
        plan_id: 'plan-1',
        venue_booking_id: 'booking-2',
        builder_id: BUILDER_ID,
        venue_id: 'venue-1',
        venue_owner_id: VENUE_OWNER_ID,
        amount_cents: 80000,
        processing_fee_cents: 500,
        venue_payout_cents: 80000,
        currency: 'usd',
        status: 'refund_requested',
        payment_method_type: 'us_bank_account',
        stripe_transfer_id: 'tr_2',
        refund_amount_cents: 20000,
        refund_reason: 'Weather changed',
        paid_at: '2026-06-03T10:00:00.000Z',
        transfer_completed_at: '2026-06-03T10:01:00.000Z',
        created_at: '2026-06-03T09:00:00.000Z',
      },
      {
        id: 'tx-other',
        plan_id: 'plan-2',
        venue_booking_id: 'booking-3',
        builder_id: OTHER_BUILDER_ID,
        venue_id: 'venue-1',
        venue_owner_id: OTHER_VENUE_OWNER_ID,
        amount_cents: 50000,
        processing_fee_cents: 1480,
        venue_payout_cents: 50000,
        currency: 'usd',
        status: 'paid',
        payment_method_type: 'card',
        stripe_transfer_id: 'tr_3',
        refund_amount_cents: null,
        refund_reason: null,
        paid_at: '2026-06-04T10:00:00.000Z',
        transfer_completed_at: '2026-06-04T10:01:00.000Z',
        created_at: '2026-06-04T09:00:00.000Z',
      },
    ],
  }

  from(table: string) {
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private orderField: string | null = null
  private ascending = true
  private limitCount: number | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select() {
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

  order(field: string, options?: { ascending?: boolean }) {
    this.orderField = field
    this.ascending = options?.ascending ?? true
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
    return Promise.resolve({ data: this.apply(), error: null }).then(onfulfilled, onrejected)
  }

  private apply() {
    let rows = (this.db.rows[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)))
    if (this.orderField) {
      rows = [...rows].sort((first, second) => {
        const firstValue = String(first[this.orderField!] ?? '')
        const secondValue = String(second[this.orderField!] ?? '')
        return this.ascending ? firstValue.localeCompare(secondValue) : secondValue.localeCompare(firstValue)
      })
    }
    return this.limitCount === null ? rows : rows.slice(0, this.limitCount)
  }
}

describe('venue rental summary routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: BUILDER_ID } },
          error: null,
        }),
      },
    })
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(new MemoryDb())
    ;(getAuthenticatedVenueOwner as jest.Mock).mockResolvedValue({
      user: { id: VENUE_OWNER_ID },
      owner: { id: VENUE_OWNER_ID },
      error: null,
      status: 200,
    })
  })

  it('returns venue rental payments only for the authenticated builder plans', async () => {
    const response = await getBuilderVenueRentals()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.transactions).toHaveLength(2)
    expect(json.transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'tx-1',
        event_name: 'NSBE mixer',
        venue_name: 'The Roof',
      }),
    ]))
    expect(json.transactions.map((tx: Row) => tx.id)).not.toContain('tx-other')
    expect(json.summary).toMatchObject({
      total_paid_cents: 200000,
      total_processing_fee_cents: 4010,
      pending_refund_count: 1,
      count: 2,
    })
  })

  it('returns venue rental payments only for the authenticated venue owner', async () => {
    const response = await getVenueRentals()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.transactions).toHaveLength(2)
    expect(json.transactions.map((tx: Row) => tx.id)).not.toContain('tx-other')
    expect(json.transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'tx-refund',
        builder_name: 'NSBE Builder',
        event_name: 'NSBE mixer',
      }),
    ]))
    expect(json.summary).toMatchObject({
      total_received_cents: 180000,
      pending_refund_requests: 1,
      refunded_cents: 20000,
      count: 2,
    })
  })
})
