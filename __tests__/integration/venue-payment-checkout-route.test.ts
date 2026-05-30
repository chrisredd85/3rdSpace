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

import { POST } from '@/app/api/planner/plans/[planId]/venue-payment/checkout/route'
import { validateStripeConnectAccount } from '@/lib/billing/stripeConnectGuard'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAppBaseUrl, getStripeClient } from '@/lib/stripe/connect'

jest.mock('@/lib/billing/stripeConnectGuard', () => ({
  validateStripeConnectAccount: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/stripe/connect', () => ({
  getAppBaseUrl: jest.fn(),
  getStripeClient: jest.fn(),
}))

type Row = Record<string, unknown>

const PLAN_ID = '11111111-1111-4111-8111-111111111111'
const BOOKING_ID = '22222222-2222-4222-8222-222222222222'
const VENUE_ID = '33333333-3333-4333-8333-333333333333'
const BUILDER_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_BUILDER_ID = '55555555-5555-4555-8555-555555555555'
const VENUE_OWNER_ID = '66666666-6666-4666-8666-666666666666'
const TRANSACTION_ID = '77777777-7777-4777-8777-777777777777'

class MemoryDb {
  rows: Record<string, Row[]> = {
    plans: [{ id: PLAN_ID, user_id: BUILDER_ID }],
    venue_bookings: [
      {
        id: BOOKING_ID,
        venue_id: VENUE_ID,
        organizer_id: BUILDER_ID,
        status: 'confirmed',
        final_price: 1200,
        quoted_price: 1100,
        total_amount: 1000,
      },
    ],
    venues: [{ id: VENUE_ID, venue_name: 'The Roof', owner_id: VENUE_OWNER_ID }],
    venue_stripe_accounts: [
      {
        owner_id: VENUE_OWNER_ID,
        stripe_account_id: 'acct_venue',
        account_status: 'active',
        payouts_enabled: true,
      },
    ],
    venue_payment_transactions: [],
  }

  conflictOnVenuePaymentInsert = false

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null | { code?: string; message: string } }> {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'select' | 'insert' | 'update' = 'select'
  private payload: Row | null = null
  private selectedColumns: string | null = null
  private rowLimit: number | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select(columns = '*') {
    this.selectedColumns = columns
    return this
  }

  insert(payload: Row) {
    this.operation = 'insert'
    this.payload = payload
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

  in(field: string, values: readonly unknown[]) {
    this.filters.push((row) => values.includes(row[field]))
    return this
  }

  order() {
    return this
  }

  limit(count: number) {
    this.rowLimit = count
    return this
  }

  maybeSingle() {
    return Promise.resolve(this.execute()).then(({ data, error }) => ({
      data: Array.isArray(data) ? data[0] ?? null : data,
      error,
    }))
  }

  single() {
    return Promise.resolve(this.execute()).then(({ data, error }) => ({
      data: Array.isArray(data) ? data[0] ?? null : data,
      error,
    }))
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null | { code?: string; message: string } }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private execute() {
    if (this.operation === 'insert') {
      if (this.table === 'venue_payment_transactions' && this.db.conflictOnVenuePaymentInsert) {
        this.db.conflictOnVenuePaymentInsert = false
        this.db.rows.venue_payment_transactions.push({
          id: TRANSACTION_ID,
          ...this.payload,
          status: 'checkout_created',
          stripe_checkout_session_id: 'cs_recovered',
        })
        return {
          data: null,
          error: {
            code: '23505',
            message: 'duplicate key value violates unique constraint "idx_venue_payment_transactions_plan_booking_unique"',
          },
        }
      }

      const row = {
        id: this.payload?.id ?? TRANSACTION_ID,
        stripe_checkout_session_id: null,
        ...this.payload,
      }
      this.db.rows[this.table].push(row)
      return { data: this.projectRows([row]), error: null }
    }

    if (this.operation === 'update') {
      const rows = this.applyFilters()
      rows.forEach((row) => Object.assign(row, this.payload))
      return { data: this.projectRows(rows), error: null }
    }

    return { data: this.projectRows(this.applyFilters()), error: null }
  }

  private applyFilters() {
    let rows = (this.db.rows[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)))
    if (this.rowLimit !== null) rows = rows.slice(0, this.rowLimit)
    return rows
  }

  private projectRows(rows: Row[]) {
    if (!this.selectedColumns || this.selectedColumns === '*') return rows
    const columns = this.selectedColumns.split(',').map((column) => column.trim()).filter(Boolean)
    return rows.map((row) => {
      const projected: Row = {}
      columns.forEach((column) => {
        if (!column.includes('(')) projected[column] = row[column]
      })
      return projected
    })
  }
}

function makeRequest(body: unknown = { venue_booking_id: BOOKING_ID }) {
  return new Request(`http://localhost/api/planner/plans/${PLAN_ID}/venue-payment/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

function makeStripeMock() {
  const futureExpiry = Math.floor(Date.now() / 1000) + 1800
  return {
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({
          id: 'cs_venue',
          url: 'https://checkout.test/cs_venue',
          status: 'open',
          expires_at: futureExpiry,
        }),
        retrieve: jest.fn().mockResolvedValue({
          id: 'cs_existing',
          url: 'https://checkout.test/cs_existing',
          status: 'open',
          expires_at: futureExpiry,
        }),
      },
    },
  }
}

describe('venue rental checkout route', () => {
  let db: MemoryDb
  let stripe: ReturnType<typeof makeStripeMock>

  beforeEach(() => {
    jest.clearAllMocks()
    db = new MemoryDb()
    stripe = makeStripeMock()
    ;(createClient as jest.Mock).mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: {
            user: {
              id: BUILDER_ID,
              user_metadata: { user_type: 'community_builder' },
            },
          },
          error: null,
        }),
      },
    })
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
    ;(getAppBaseUrl as jest.Mock).mockReturnValue('http://localhost:3000')
    ;(validateStripeConnectAccount as jest.Mock).mockResolvedValue({
      accountId: 'acct_venue',
      account: { id: 'acct_venue', payouts_enabled: true },
      mismatchCleared: false,
    })
  })

  it('lets the plan owner create Checkout for a confirmed venue booking', async () => {
    const response = await POST(makeRequest(), { params: { planId: PLAN_ID } })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      hosted_checkout_url: 'https://checkout.test/cs_venue',
      transaction_id: TRANSACTION_ID,
      amount_cents: 120000,
      processing_fee_cents: 3510,
      total_cents: 123510,
    })
    expect(db.rows.venue_payment_transactions[0]).toMatchObject({
      plan_id: PLAN_ID,
      venue_booking_id: BOOKING_ID,
      builder_id: BUILDER_ID,
      venue_id: VENUE_ID,
      venue_owner_id: VENUE_OWNER_ID,
      amount_cents: 120000,
      processing_fee_cents: 3510,
      application_fee_cents: 0,
      venue_payout_cents: 120000,
      status: 'checkout_created',
      stripe_checkout_session_id: 'cs_venue',
    })
  })

  it('writes venue_rental metadata on the Checkout Session and PaymentIntent', async () => {
    await POST(makeRequest(), { params: { planId: PLAN_ID } })

    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        payment_method_types: ['card', 'us_bank_account'],
        metadata: expect.objectContaining({
          payment_kind_namespace: 'venue_rental',
          venue_payment_transaction_id: TRANSACTION_ID,
          plan_id: PLAN_ID,
          venue_booking_id: BOOKING_ID,
          venue_id: VENUE_ID,
          venue_owner_id: VENUE_OWNER_ID,
          builder_id: BUILDER_ID,
        }),
        payment_intent_data: expect.objectContaining({
          application_fee_amount: 0,
          transfer_data: {
            destination: 'acct_venue',
            amount: 120000,
          },
          metadata: expect.objectContaining({
            payment_kind_namespace: 'venue_rental',
            venue_payment_transaction_id: TRANSACTION_ID,
          }),
        }),
      }),
      expect.objectContaining({
        idempotencyKey: `venue_rental_checkout_${TRANSACTION_ID}_120000_3510`,
      })
    )
  })

  it('returns 403 for a non-owner plan', async () => {
    db.rows.plans[0].user_id = OTHER_BUILDER_ID

    const response = await POST(makeRequest(), { params: { planId: PLAN_ID } })
    const json = await response.json()

    expect(response.status).toBe(403)
    expect(json.error).toBe('Not authorized for this plan')
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing venue booking', async () => {
    db.rows.venue_bookings = []

    const response = await POST(makeRequest(), { params: { planId: PLAN_ID } })
    const json = await response.json()

    expect(response.status).toBe(404)
    expect(json.error).toBe('Venue booking not found')
  })

  it('returns 409 for an unconfirmed venue booking', async () => {
    db.rows.venue_bookings[0].status = 'pending'

    const response = await POST(makeRequest(), { params: { planId: PLAN_ID } })
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.error).toBe('venue_booking_not_confirmed')
  })

  it('returns 409 with concierge review for amounts above the maximum', async () => {
    db.rows.venue_bookings[0].final_price = 60000

    const response = await POST(makeRequest(), { params: { planId: PLAN_ID } })
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json).toMatchObject({
      error: 'amount_exceeds_max',
      concierge_review_required: true,
      max_amount_cents: 5000000,
    })
  })

  it('returns 422 for amounts below Stripe minimum', async () => {
    db.rows.venue_bookings[0].final_price = 0.2

    const response = await POST(makeRequest(), { params: { planId: PLAN_ID } })
    const json = await response.json()

    expect(response.status).toBe(422)
    expect(json.error).toBe('amount_below_minimum')
  })

  it('returns 409 with concierge_required when venue Connect is missing', async () => {
    db.rows.venue_stripe_accounts = []

    const response = await POST(makeRequest(), { params: { planId: PLAN_ID } })
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json).toMatchObject({
      error: 'venue_concierge_required',
      concierge_required: true,
    })
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('returns the same hosted Checkout URL on double-click while the session is valid', async () => {
    db.rows.venue_payment_transactions.push({
      id: TRANSACTION_ID,
      plan_id: PLAN_ID,
      venue_booking_id: BOOKING_ID,
      builder_id: BUILDER_ID,
      venue_id: VENUE_ID,
      venue_owner_id: VENUE_OWNER_ID,
      amount_cents: 120000,
      processing_fee_cents: 3510,
      application_fee_cents: 0,
      venue_payout_cents: 120000,
      currency: 'usd',
      status: 'checkout_created',
      stripe_checkout_session_id: 'cs_existing',
    })

    const response = await POST(makeRequest(), { params: { planId: PLAN_ID } })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.hosted_checkout_url).toBe('https://checkout.test/cs_existing')
    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith('cs_existing')
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('recovers a unique constraint race by returning the recovered Checkout URL', async () => {
    db.conflictOnVenuePaymentInsert = true
    stripe.checkout.sessions.retrieve.mockResolvedValue({
      id: 'cs_recovered',
      url: 'https://checkout.test/cs_recovered',
      status: 'open',
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    })

    const response = await POST(makeRequest(), { params: { planId: PLAN_ID } })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.hosted_checkout_url).toBe('https://checkout.test/cs_recovered')
    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith('cs_recovered')
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })
})
