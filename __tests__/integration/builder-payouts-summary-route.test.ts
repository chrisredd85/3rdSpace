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

import { GET } from '@/app/api/builder/payouts/summary/route'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedBuilderPayoutOwner } from '@/lib/stripe/connect'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/stripe/connect', () => ({
  getAuthenticatedBuilderPayoutOwner: jest.fn(),
}))

type Row = Record<string, unknown>

const USER_ID = 'builder-user-1'

class MemoryDb {
  rows: Record<string, Row[]> = {
    builder_stripe_accounts: [
      {
        user_id: USER_ID,
        stripe_account_id: 'acct_builder',
        account_status: 'complete',
        charges_enabled: true,
        payouts_enabled: true,
        requirements_due: [],
      },
    ],
    kickback_payments: [
      {
        id: 'payment-plan-linked',
        agreement_id: 'agreement-plan-linked',
        event_id: null,
        payer_id: 'venue-owner-1',
        recipient_id: USER_ID,
        amount: null,
        amount_cents: 51360,
        currency: 'usd',
        status: 'invoice_sent',
        settlement_method: 'invoice',
        processing_fee_cents: 500,
        builder_payout_cents: null,
        created_at: '2026-05-18T00:00:00.000Z',
      },
      {
        id: 'payment-legacy',
        agreement_id: 'agreement-legacy',
        event_id: 'event-legacy',
        payer_id: 'venue-owner-1',
        recipient_id: USER_ID,
        amount: 252,
        amount_cents: null,
        currency: 'usd',
        status: 'completed',
        settlement_method: 'checkout',
        processing_fee_cents: null,
        builder_payout_cents: null,
        created_at: '2026-05-10T00:00:00.000Z',
      },
    ],
    event_kickback_agreements: [
      {
        id: 'agreement-plan-linked',
        event_id: null,
        plan_id: 'plan-1',
        venue_id: 'venue-1',
        reported_revenue_cents: 428000,
        bar_revenue_share_percent: 12,
      },
      {
        id: 'agreement-legacy',
        event_id: 'event-legacy',
        plan_id: null,
        venue_id: 'venue-1',
        reported_revenue_cents: null,
        bar_revenue_share_percent: null,
      },
    ],
    plans: [{ id: 'plan-1', title: 'Tech Mixer', date_window_start: '2026-05-12T00:00:00.000Z' }],
    events: [{ id: 'event-legacy', event_name: 'Dinner Club', event_date: '2026-05-10T00:00:00.000Z' }],
    venues: [{ id: 'venue-1', venue_name: 'The Roof' }],
  }

  from(table: string) {
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private limitCount: number | null = null
  private orderField: string | null = null
  private ascending = true

  constructor(private db: MemoryDb, private table: string) {}

  select(_columns = '*') {
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

  maybeSingle() {
    const rows = this.apply()
    return Promise.resolve({ data: rows[0] ?? null, error: null })
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

describe('GET /api/builder/payouts/summary', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createClient as jest.Mock).mockReturnValue({})
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(new MemoryDb())
    ;(getAuthenticatedBuilderPayoutOwner as jest.Mock).mockResolvedValue({
      user: { id: USER_ID },
      builder: { id: 'builder-profile-1', user_id: USER_ID, name: 'Builder' },
      error: null,
      status: 200,
    })
  })

  it('returns cents-normalized plan-linked and legacy kickback payouts', async () => {
    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.summary).toMatchObject({
      pending: 51360,
      completed: 25200,
      count: 2,
    })
    expect(json.payments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'payment-plan-linked',
        amount_cents: 51360,
        event_name: 'Tech Mixer',
        event_date: '2026-05-12T00:00:00.000Z',
        venue_name: 'The Roof',
      }),
      expect.objectContaining({
        id: 'payment-legacy',
        amount_cents: 25200,
        event_name: 'Dinner Club',
      }),
    ]))
  })
})
