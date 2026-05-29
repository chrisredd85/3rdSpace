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

import { POST as refundDecisionPost } from '@/app/api/planner/plans/[planId]/refund-decision/route'
import { POST as refundRequestPost } from '@/app/api/venue/kickbacks/[id]/refund-request/route'
import {
  sendBuilderRefundRequestEmail,
  sendVenueRefundDeniedEmail,
} from '@/lib/email'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedVenueOwner, getStripeClient } from '@/lib/stripe/connect'

jest.mock('@/lib/email', () => ({
  sendBuilderRefundRequestEmail: jest.fn().mockResolvedValue({ sent: true, reason: null }),
  sendVenueRefundDeniedEmail: jest.fn().mockResolvedValue({ sent: true, reason: null }),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/stripe/connect', () => ({
  getAuthenticatedVenueOwner: jest.fn(),
  getStripeClient: jest.fn(),
}))

type Row = Record<string, unknown>

const PAYMENT_ID = '11111111-1111-4111-8111-111111111111'
const PLAN_ID = '22222222-2222-4222-8222-222222222222'
const AGREEMENT_ID = '33333333-3333-4333-8333-333333333333'
const VENUE_ID = '44444444-4444-4444-8444-444444444444'
const VENUE_OWNER_ID = '55555555-5555-4555-8555-555555555555'
const BUILDER_ID = '66666666-6666-4666-8666-666666666666'

class MemoryDb {
  rows: Record<string, Row[]> = {
    plans: [{ id: PLAN_ID, user_id: BUILDER_ID }],
    kickback_payments: [
      {
        id: PAYMENT_ID,
        agreement_id: AGREEMENT_ID,
        recipient_id: BUILDER_ID,
        status: 'paid',
        amount_cents: 51360,
        builder_payout_cents: 51360,
        stripe_transfer_id: 'tr_builder',
        stripe_invoice_id: 'in_kickback',
        refund_amount_cents: null,
        refund_reason: null,
      },
    ],
    event_kickback_agreements: [
      {
        id: AGREEMENT_ID,
        plan_id: PLAN_ID,
        venue_id: VENUE_ID,
        venue_owner_id: VENUE_OWNER_ID,
      },
    ],
    venues: [{ id: VENUE_ID, owner_id: VENUE_OWNER_ID }],
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'select' | 'update' = 'select'
  private payload: Row | null = null
  private selectedColumns: string | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select(columns = '*') {
    this.selectedColumns = columns
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

  maybeSingle() {
    return Promise.resolve(this.execute()).then(({ data, error }) => ({
      data: Array.isArray(data) ? data[0] ?? null : data,
      error,
    }))
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
      return { data: this.projectRows(rows), error: null }
    }

    return { data: this.projectRows(this.applyFilters()), error: null }
  }

  private applyFilters() {
    return (this.db.rows[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)))
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

function makeJsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

describe('kickback refund routes', () => {
  let db: MemoryDb
  let stripe: any

  beforeEach(() => {
    jest.clearAllMocks()
    db = new MemoryDb()
    stripe = {
      invoices: {
        retrieve: jest.fn().mockResolvedValue({ id: 'in_kickback', charge: 'ch_kickback' }),
      },
      transfers: {
        createReversal: jest.fn().mockResolvedValue({ id: 'trr_refund' }),
      },
      refunds: {
        create: jest.fn().mockResolvedValue({ id: 're_refund' }),
      },
    }
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
      from: (table: string) => db.from(table),
    })
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
    ;(getAuthenticatedVenueOwner as jest.Mock).mockResolvedValue({
      user: { id: VENUE_OWNER_ID },
      owner: { id: VENUE_OWNER_ID },
      error: null,
      status: 200,
    })
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
  })

  it('lets a venue request a refund on a paid kickback', async () => {
    const response = await refundRequestPost(
      makeJsonRequest(`http://localhost/api/venue/kickbacks/${PAYMENT_ID}/refund-request`, {
        refund_amount_cents: 18000,
        reason: 'POS sales report was corrected after closeout.',
      }),
      { params: { id: PAYMENT_ID } }
    )

    expect(response.status).toBe(200)
    expect(db.rows.kickback_payments[0]).toMatchObject({
      status: 'refund_requested',
      refund_amount_cents: 18000,
      refund_reason: 'POS sales report was corrected after closeout.',
      refund_requested_by: VENUE_OWNER_ID,
    })
    expect(sendBuilderRefundRequestEmail).toHaveBeenCalledWith({ paymentId: PAYMENT_ID })
  })

  it('blocks refund requests above the builder payout', async () => {
    const response = await refundRequestPost(
      makeJsonRequest(`http://localhost/api/venue/kickbacks/${PAYMENT_ID}/refund-request`, {
        refund_amount_cents: 999999,
        reason: 'Too much.',
      }),
      { params: { id: PAYMENT_ID } }
    )
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.error).toContain('cannot exceed')
    expect(db.rows.kickback_payments[0]).toMatchObject({ status: 'paid' })
  })

  it('lets a builder reject a pending refund request', async () => {
    Object.assign(db.rows.kickback_payments[0], {
      status: 'refund_requested',
      refund_amount_cents: 18000,
      refund_reason: 'Venue request',
      refund_requested_at: '2026-05-20T00:00:00.000Z',
      refund_requested_by: VENUE_OWNER_ID,
    })

    const response = await refundDecisionPost(
      makeJsonRequest(`http://localhost/api/planner/plans/${PLAN_ID}/refund-decision`, {
        payment_id: PAYMENT_ID,
        decision: 'reject',
        builder_note: 'Sales report matches the invoice.',
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(200)
    expect(db.rows.kickback_payments[0]).toMatchObject({
      status: 'paid',
      refund_amount_cents: null,
      refund_reason: null,
      refund_requested_at: null,
      refund_requested_by: null,
    })
    expect(sendVenueRefundDeniedEmail).toHaveBeenCalledWith({
      paymentId: PAYMENT_ID,
      builderNote: 'Sales report matches the invoice.',
    })
  })

  it('lets a builder approve a refund and reverses only the principal amount', async () => {
    Object.assign(db.rows.kickback_payments[0], {
      status: 'refund_requested',
      refund_amount_cents: 18000,
      refund_reason: 'Venue request',
      refund_requested_at: '2026-05-20T00:00:00.000Z',
      refund_requested_by: VENUE_OWNER_ID,
    })

    const response = await refundDecisionPost(
      makeJsonRequest(`http://localhost/api/planner/plans/${PLAN_ID}/refund-decision`, {
        payment_id: PAYMENT_ID,
        decision: 'approve',
      }),
      { params: { planId: PLAN_ID } }
    )

    expect(response.status).toBe(200)
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith('tr_builder', {
      amount: 18000,
      metadata: {
        kickback_payment_id: PAYMENT_ID,
        settlement_method: 'invoice',
        refund_reason: 'Venue request',
      },
    })
    expect(stripe.refunds.create).toHaveBeenCalledWith({
      charge: 'ch_kickback',
      amount: 18000,
      reason: 'requested_by_customer',
      metadata: {
        kickback_payment_id: PAYMENT_ID,
        settlement_method: 'invoice',
      },
    })
    expect(db.rows.kickback_payments[0]).toMatchObject({
      status: 'refund_processing',
      refund_amount_cents: 18000,
      stripe_transfer_reversal_id: 'trr_refund',
      stripe_refund_id: 're_refund',
    })
  })

  it('preserves finalized refund status when the Stripe reversal webhook wins the approval race', async () => {
    Object.assign(db.rows.kickback_payments[0], {
      status: 'refund_requested',
      refund_amount_cents: 18000,
      refund_reason: 'Venue request',
      refund_requested_at: '2026-05-20T00:00:00.000Z',
      refund_requested_by: VENUE_OWNER_ID,
    })
    stripe.transfers.createReversal.mockImplementation(async () => {
      Object.assign(db.rows.kickback_payments[0], {
        status: 'refunded_partial',
        completed_at: '2026-05-20T00:00:01.000Z',
      })
      return { id: 'trr_refund' }
    })

    const response = await refundDecisionPost(
      makeJsonRequest(`http://localhost/api/planner/plans/${PLAN_ID}/refund-decision`, {
        payment_id: PAYMENT_ID,
        decision: 'approve',
      }),
      { params: { planId: PLAN_ID } }
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.payment).toMatchObject({ status: 'refunded_partial' })
    expect(db.rows.kickback_payments[0]).toMatchObject({
      status: 'refunded_partial',
      refund_amount_cents: 18000,
      stripe_transfer_reversal_id: 'trr_refund',
      stripe_refund_id: 're_refund',
    })
  })
})
