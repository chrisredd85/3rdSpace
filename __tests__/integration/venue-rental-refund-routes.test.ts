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

import { POST as refundRequestPost } from '@/app/api/planner/plans/[planId]/venue-payment/[transactionId]/refund-request/route'
import { POST as refundDecisionPost } from '@/app/api/venue/rentals/[transactionId]/refund-decision/route'
import { POST as stripeWebhookPost } from '@/app/api/webhooks/stripe/route'
import {
  sendBuilderRefundApprovedEmail,
  sendBuilderRefundCounteredEmail,
  sendBuilderRefundRejectedEmail,
  sendVenueRefundRequestedEmail,
} from '@/lib/email'
import { applyCheckoutSessionCompleted, applyInvoicePayment, applyInvoicePaymentFailed } from '@/lib/billing/builder-billing'
import { applyPlannerStripePaymentIntentWebhook, applyPlannerStripeRefundWebhook } from '@/lib/planner/depositPayments'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedVenueOwner, getStripeClient } from '@/lib/stripe/connect'

jest.mock('@/lib/email', () => ({
  sendBuilderPaidEmail: jest.fn().mockResolvedValue({ sent: true, reason: null }),
  sendRefundCompletedEmail: jest.fn().mockResolvedValue({ sent: true, reason: null }),
  sendVenuePaymentFailedEmail: jest.fn().mockResolvedValue({ sent: true, reason: null }),
  sendBuilderRefundApprovedEmail: jest.fn().mockResolvedValue({ sent: true, reason: null }),
  sendBuilderRefundCounteredEmail: jest.fn().mockResolvedValue({ sent: true, reason: null }),
  sendBuilderRefundRejectedEmail: jest.fn().mockResolvedValue({ sent: true, reason: null }),
  sendVenueRefundRequestedEmail: jest.fn().mockResolvedValue({ sent: true, reason: null }),
}))

jest.mock('@/lib/billing/builder-billing', () => ({
  applyCheckoutSessionCompleted: jest.fn(),
  applyInvoicePayment: jest.fn(),
  applyInvoicePaymentFailed: jest.fn(),
  syncBuilderSubscription: jest.fn(),
}))

jest.mock('@/lib/planner/depositPayments', () => ({
  applyPlannerStripePaymentIntentWebhook: jest.fn().mockResolvedValue(false),
  applyPlannerStripeRefundWebhook: jest.fn(),
}))

jest.mock('@/lib/server/webhook-rate-limit', () => ({
  allowWebhookRequest: jest.fn(),
  getWebhookRateLimitKey: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/stripe/connect', () => ({
  getAuthenticatedVenueOwner: jest.fn(),
  getStripeClient: jest.fn(),
  saveBuilderStripeAccount: jest.fn(),
  saveVendorStripeAccount: jest.fn(),
  saveVenueStripeAccount: jest.fn(),
}))

type Row = Record<string, unknown>

const PLAN_ID = '11111111-1111-4111-8111-111111111111'
const TRANSACTION_ID = '22222222-2222-4222-8222-222222222222'
const BUILDER_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_BUILDER_ID = '44444444-4444-4444-8444-444444444444'
const VENUE_OWNER_ID = '55555555-5555-4555-8555-555555555555'
const OTHER_VENUE_OWNER_ID = '66666666-6666-4666-8666-666666666666'
const VENUE_ID = '77777777-7777-4777-8777-777777777777'
const BOOKING_ID = '88888888-8888-4888-8888-888888888888'

class MemoryDb {
  private reservationSequence = 0

  rows: Record<string, Row[]> = {
    plans: [{ id: PLAN_ID, user_id: BUILDER_ID, title: 'NSBE mixer', date_window_start: null }],
    venue_payment_transactions: [makeVenuePaymentTransaction()],
    stripe_webhook_events: [],
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }

  async rpc(fn: string, args: Record<string, unknown>) {
    if (fn === 'release_stale_stripe_webhook_reservations') {
      return { data: [{ released_count: 0 }], error: null }
    }

    if (fn === 'reserve_stripe_webhook_event') {
      const existing = this.rows.stripe_webhook_events.find((row) =>
        row.stripe_event_id === args.p_stripe_event_id
        && row.endpoint_path === args.p_endpoint_path
      )
      if (existing?.processed === true) {
        return {
          data: [{
            existed: true,
            in_flight: false,
            completed: true,
            reserved_now: false,
            processed_at: existing.processed_at,
            reservation_token: null,
            deferred: false,
            control_state: 'open',
            queued_at: null,
          }],
          error: null,
        }
      }

      const reservationToken = `venue-refund-reservation-${++this.reservationSequence}`
      const row = existing ?? {
        id: `stripe_webhook_events_${this.rows.stripe_webhook_events.length + 1}`,
        stripe_event_id: args.p_stripe_event_id,
        endpoint_path: args.p_endpoint_path,
      }
      Object.assign(row, {
        event_type: args.p_event_type,
        payload: args.p_payload,
        source: args.p_source,
        livemode: args.p_livemode,
        processed: false,
        in_flight: true,
        reservation_token: reservationToken,
        processing_outcome: 'received',
      })
      if (!existing) this.rows.stripe_webhook_events.push(row)

      return {
        data: [{
          existed: Boolean(existing),
          in_flight: true,
          completed: false,
          reserved_now: true,
          processed_at: null,
          reservation_token: reservationToken,
          deferred: false,
          control_state: 'open',
          queued_at: null,
        }],
        error: null,
      }
    }

    if (fn === 'record_stripe_webhook_event_result') {
      const row = this.rows.stripe_webhook_events.find((candidate) =>
        candidate.stripe_event_id === args.p_stripe_event_id
        && candidate.endpoint_path === args.p_endpoint_path
        && candidate.reservation_token === args.p_reservation_token
      )
      if (!row) {
        return { data: null, error: { message: 'Stripe webhook reservation ownership was lost' } }
      }

      Object.assign(row, {
        processed: args.p_processed,
        processed_at: args.p_processed ? new Date().toISOString() : null,
        completed_at: args.p_processed ? new Date().toISOString() : null,
        in_flight: false,
        reservation_token: null,
        processing_outcome: args.p_processing_outcome,
        last_error: args.p_error,
      })
      return { data: row, error: null }
    }

    return { data: null, error: { message: `Unexpected RPC: ${fn}` } }
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'select' | 'insert' | 'update' = 'select'
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

  insert(payload: Row) {
    this.operation = 'insert'
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
    if (this.operation === 'insert') {
      const row = {
        id: `${this.table}_${this.db.rows[this.table].length + 1}`,
        created_at: new Date().toISOString(),
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

function makeVenuePaymentTransaction(overrides: Row = {}): Row {
  return {
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
    status: 'paid',
    payment_method_type: 'card',
    stripe_checkout_session_id: 'cs_venue',
    stripe_payment_intent_id: 'pi_venue',
    stripe_charge_id: 'ch_venue',
    stripe_transfer_id: 'tr_venue',
    stripe_refund_id: null,
    stripe_transfer_reversal_id: null,
    refund_amount_cents: null,
    refund_reason: null,
    refund_requested_by: null,
    refund_requested_at: null,
    refund_approved_by: null,
    refund_approved_at: null,
    paid_at: '2026-05-30T00:00:00.000Z',
    transfer_completed_at: '2026-05-30T00:00:01.000Z',
    failed_at: null,
    failure_reason: null,
    ...overrides,
  }
}

function makeJsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

function makeWebhookRequest() {
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig_test' },
    body: '{}',
  }) as never
}

describe('venue rental refund routes', () => {
  let db: MemoryDb
  let stripe: any
  let webhookEvent: any

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    db = new MemoryDb()
    stripe = {
      webhooks: {
        constructEvent: jest.fn(() => webhookEvent),
      },
      transfers: {
        createReversal: jest.fn().mockResolvedValue({ id: 'trr_venue' }),
        create: jest.fn(),
      },
      refunds: {
        create: jest.fn().mockResolvedValue({ id: 're_venue' }),
      },
      paymentIntents: {
        retrieve: jest.fn(),
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
    ;(allowWebhookRequest as jest.Mock).mockResolvedValue(true)
    ;(getWebhookRateLimitKey as jest.Mock).mockReturnValue('stripe:test')
  })

  describe('refund request route', () => {
    it('lets the plan owner request a refund on a paid transaction', async () => {
      const response = await refundRequestPost(
        makeJsonRequest(`http://localhost/api/planner/plans/${PLAN_ID}/venue-payment/${TRANSACTION_ID}/refund-request`, {
          refund_amount_cents: 50000,
          reason: 'Venue changed the agreed minimum spend after payment.',
        }),
        { params: { planId: PLAN_ID, transactionId: TRANSACTION_ID } }
      )

      expect(response.status).toBe(200)
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'refund_requested',
        refund_amount_cents: 50000,
        refund_reason: 'Venue changed the agreed minimum spend after payment.',
        refund_requested_by: BUILDER_ID,
      })
      expect(db.rows.venue_payment_transactions[0].refund_requested_at).toEqual(expect.any(String))
      expect(sendVenueRefundRequestedEmail).toHaveBeenCalledWith({ transactionId: TRANSACTION_ID })
    })

    it('returns 403 for a non-owner builder', async () => {
      ;(createClient as jest.Mock).mockReturnValue({
        auth: {
          getUser: jest.fn().mockResolvedValue({
            data: { user: { id: OTHER_BUILDER_ID, user_metadata: { user_type: 'community_builder' } } },
            error: null,
          }),
        },
      })

      const response = await refundRequestPost(
        makeJsonRequest(`http://localhost/api/planner/plans/${PLAN_ID}/venue-payment/${TRANSACTION_ID}/refund-request`, {
          refund_amount_cents: 50000,
          reason: 'Venue changed the agreed minimum spend after payment.',
        }),
        { params: { planId: PLAN_ID, transactionId: TRANSACTION_ID } }
      )

      expect(response.status).toBe(403)
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({ status: 'paid' })
    })

    it('rejects refund requests on unpaid transactions', async () => {
      Object.assign(db.rows.venue_payment_transactions[0], { status: 'checkout_created' })

      const response = await refundRequestPost(
        makeJsonRequest(`http://localhost/api/planner/plans/${PLAN_ID}/venue-payment/${TRANSACTION_ID}/refund-request`, {
          refund_amount_cents: 50000,
          reason: 'Venue changed the agreed minimum spend after payment.',
        }),
        { params: { planId: PLAN_ID, transactionId: TRANSACTION_ID } }
      )

      expect(response.status).toBe(409)
    })

    it('rejects refund requests on already-refunded transactions', async () => {
      Object.assign(db.rows.venue_payment_transactions[0], { status: 'refunded_full' })

      const response = await refundRequestPost(
        makeJsonRequest(`http://localhost/api/planner/plans/${PLAN_ID}/venue-payment/${TRANSACTION_ID}/refund-request`, {
          refund_amount_cents: 50000,
          reason: 'Venue changed the agreed minimum spend after payment.',
        }),
        { params: { planId: PLAN_ID, transactionId: TRANSACTION_ID } }
      )

      expect(response.status).toBe(409)
    })

    it('returns 422 when refund_amount_cents exceeds amount_cents', async () => {
      const response = await refundRequestPost(
        makeJsonRequest(`http://localhost/api/planner/plans/${PLAN_ID}/venue-payment/${TRANSACTION_ID}/refund-request`, {
          refund_amount_cents: 120001,
          reason: 'Venue changed the agreed minimum spend after payment.',
        }),
        { params: { planId: PLAN_ID, transactionId: TRANSACTION_ID } }
      )

      expect(response.status).toBe(422)
    })

    it('returns 422 when refund_amount_cents is not positive', async () => {
      const response = await refundRequestPost(
        makeJsonRequest(`http://localhost/api/planner/plans/${PLAN_ID}/venue-payment/${TRANSACTION_ID}/refund-request`, {
          refund_amount_cents: 0,
          reason: 'Venue changed the agreed minimum spend after payment.',
        }),
        { params: { planId: PLAN_ID, transactionId: TRANSACTION_ID } }
      )

      expect(response.status).toBe(422)
    })

    it('returns 422 for an empty reason', async () => {
      const response = await refundRequestPost(
        makeJsonRequest(`http://localhost/api/planner/plans/${PLAN_ID}/venue-payment/${TRANSACTION_ID}/refund-request`, {
          refund_amount_cents: 50000,
          reason: '',
        }),
        { params: { planId: PLAN_ID, transactionId: TRANSACTION_ID } }
      )

      expect(response.status).toBe(422)
    })

    it('returns 422 for a reason shorter than 10 characters', async () => {
      const response = await refundRequestPost(
        makeJsonRequest(`http://localhost/api/planner/plans/${PLAN_ID}/venue-payment/${TRANSACTION_ID}/refund-request`, {
          refund_amount_cents: 50000,
          reason: 'too short',
        }),
        { params: { planId: PLAN_ID, transactionId: TRANSACTION_ID } }
      )

      expect(response.status).toBe(422)
    })
  })

  describe('refund decision route', () => {
    beforeEach(() => {
      Object.assign(db.rows.venue_payment_transactions[0], {
        status: 'refund_requested',
        refund_amount_cents: 50000,
        refund_reason: 'Venue changed the agreed minimum spend after payment.',
        refund_requested_by: BUILDER_ID,
        refund_requested_at: '2026-05-30T00:00:00.000Z',
      })
    })

    it('lets the venue owner reject a refund and clears the request fields', async () => {
      const response = await refundDecisionPost(
        makeJsonRequest(`http://localhost/api/venue/rentals/${TRANSACTION_ID}/refund-decision`, {
          decision: 'reject',
          note: 'The venue honored the original agreement.',
        }),
        { params: { transactionId: TRANSACTION_ID } }
      )

      expect(response.status).toBe(200)
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'paid',
        refund_amount_cents: null,
        refund_reason: null,
        refund_requested_by: null,
        refund_requested_at: null,
      })
      expect(sendBuilderRefundRejectedEmail).toHaveBeenCalledWith({
        transactionId: TRANSACTION_ID,
        venueNote: 'The venue honored the original agreement.',
      })
    })

    it('returns 403 for a non-owner venue account', async () => {
      ;(getAuthenticatedVenueOwner as jest.Mock).mockResolvedValue({
        user: { id: OTHER_VENUE_OWNER_ID },
        owner: { id: OTHER_VENUE_OWNER_ID },
        error: null,
        status: 200,
      })

      const response = await refundDecisionPost(
        makeJsonRequest(`http://localhost/api/venue/rentals/${TRANSACTION_ID}/refund-decision`, {
          decision: 'reject',
        }),
        { params: { transactionId: TRANSACTION_ID } }
      )

      expect(response.status).toBe(403)
    })

    it('returns 409 when the transaction is not refund_requested', async () => {
      Object.assign(db.rows.venue_payment_transactions[0], { status: 'paid' })

      const response = await refundDecisionPost(
        makeJsonRequest(`http://localhost/api/venue/rentals/${TRANSACTION_ID}/refund-decision`, {
          decision: 'reject',
        }),
        { params: { transactionId: TRANSACTION_ID } }
      )

      expect(response.status).toBe(409)
    })

    it('returns 422 for counter decisions without counter_amount_cents', async () => {
      const response = await refundDecisionPost(
        makeJsonRequest(`http://localhost/api/venue/rentals/${TRANSACTION_ID}/refund-decision`, {
          decision: 'counter',
          note: 'We can refund part of the rental.',
        }),
        { params: { transactionId: TRANSACTION_ID } }
      )

      expect(response.status).toBe(422)
    })

    it('returns 422 for counters above the requested refund', async () => {
      const response = await refundDecisionPost(
        makeJsonRequest(`http://localhost/api/venue/rentals/${TRANSACTION_ID}/refund-decision`, {
          decision: 'counter',
          counter_amount_cents: 60000,
          note: 'We can refund part of the rental.',
        }),
        { params: { transactionId: TRANSACTION_ID } }
      )

      expect(response.status).toBe(422)
    })

    it('keeps the request pending when the venue counters with a lower amount', async () => {
      const response = await refundDecisionPost(
        makeJsonRequest(`http://localhost/api/venue/rentals/${TRANSACTION_ID}/refund-decision`, {
          decision: 'counter',
          counter_amount_cents: 30000,
          note: 'We held the staff minimum.',
        }),
        { params: { transactionId: TRANSACTION_ID } }
      )

      expect(response.status).toBe(200)
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'refund_requested',
        refund_amount_cents: 30000,
      })
      expect(db.rows.venue_payment_transactions[0].refund_reason).toBe(
        '[Venue counter-offer]: We held the staff minimum.\n\nOriginal request: Venue changed the agreed minimum spend after payment.'
      )
      expect(sendBuilderRefundCounteredEmail).toHaveBeenCalledWith({ transactionId: TRANSACTION_ID })
    })

    it('approves a refund, reverses venue principal, and does not refund processing fees', async () => {
      const response = await refundDecisionPost(
        makeJsonRequest(`http://localhost/api/venue/rentals/${TRANSACTION_ID}/refund-decision`, {
          decision: 'approve',
        }),
        { params: { transactionId: TRANSACTION_ID } }
      )

      expect(response.status).toBe(200)
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'refund_approved',
        refund_approved_by: VENUE_OWNER_ID,
      })
      expect(stripe.transfers.createReversal).toHaveBeenCalledWith(
        'tr_venue',
        {
          amount: 50000,
          metadata: {
            payment_kind_namespace: 'venue_rental',
            venue_payment_transaction_id: TRANSACTION_ID,
          },
        },
        { idempotencyKey: `venue_rental_refund_reversal_${TRANSACTION_ID}_50000` }
      )
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        {
          payment_intent: 'pi_venue',
          amount: 50000,
          metadata: {
            payment_kind_namespace: 'venue_rental',
            venue_payment_transaction_id: TRANSACTION_ID,
          },
        },
        { idempotencyKey: `venue_rental_refund_${TRANSACTION_ID}_50000` }
      )
      expect(stripe.refunds.create.mock.calls[0][0].amount).not.toBe(53510)
      expect(stripe.transfers.createReversal.mock.invocationCallOrder[0]).toBeLessThan(
        stripe.refunds.create.mock.invocationCallOrder[0]
      )
      expect(sendBuilderRefundApprovedEmail).toHaveBeenCalledWith({ transactionId: TRANSACTION_ID })
    })

    it('keeps a refund request pending when Stripe reversal fails', async () => {
      stripe.transfers.createReversal.mockRejectedValueOnce(new Error('Stripe reversal unavailable'))

      const response = await refundDecisionPost(
        makeJsonRequest(`http://localhost/api/venue/rentals/${TRANSACTION_ID}/refund-decision`, {
          decision: 'approve',
        }),
        { params: { transactionId: TRANSACTION_ID } }
      )
      const json = await response.json()

      expect(response.status).toBe(500)
      expect(json.error).toBe('Stripe reversal unavailable')
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'refund_requested',
        refund_amount_cents: 50000,
        refund_approved_by: null,
        refund_approved_at: null,
      })
      expect(stripe.refunds.create).not.toHaveBeenCalled()
      expect(sendBuilderRefundApprovedEmail).not.toHaveBeenCalled()
    })

    it('transitions to refunded_partial after the resulting charge.refunded webhook', async () => {
      await refundDecisionPost(
        makeJsonRequest(`http://localhost/api/venue/rentals/${TRANSACTION_ID}/refund-decision`, {
          decision: 'approve',
        }),
        { params: { transactionId: TRANSACTION_ID } }
      )
      webhookEvent = {
        id: 'evt_venue_refund_partial',
        livemode: false,
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_venue',
            amount_refunded: 50000,
            metadata: {
              payment_kind_namespace: 'venue_rental',
              venue_payment_transaction_id: TRANSACTION_ID,
            },
            refunds: {
              data: [{ id: 're_venue' }],
            },
          },
        },
      }

      const response = await stripeWebhookPost(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(applyPlannerStripeRefundWebhook).not.toHaveBeenCalled()
      expect(applyPlannerStripePaymentIntentWebhook).not.toHaveBeenCalled()
      expect(applyCheckoutSessionCompleted).not.toHaveBeenCalled()
      expect(applyInvoicePayment).not.toHaveBeenCalled()
      expect(applyInvoicePaymentFailed).not.toHaveBeenCalled()
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'refunded_partial',
        refund_amount_cents: 50000,
        stripe_refund_id: 're_venue',
      })
    })

    it('transitions to refunded_full after a full resulting charge.refunded webhook', async () => {
      Object.assign(db.rows.venue_payment_transactions[0], {
        refund_amount_cents: 120000,
      })
      await refundDecisionPost(
        makeJsonRequest(`http://localhost/api/venue/rentals/${TRANSACTION_ID}/refund-decision`, {
          decision: 'approve',
        }),
        { params: { transactionId: TRANSACTION_ID } }
      )
      webhookEvent = {
        id: 'evt_venue_refund_full',
        livemode: false,
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_venue',
            amount_refunded: 120000,
            metadata: {
              payment_kind_namespace: 'venue_rental',
              venue_payment_transaction_id: TRANSACTION_ID,
            },
            refunds: {
              data: [{ id: 're_venue_full' }],
            },
          },
        },
      }

      const response = await stripeWebhookPost(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'refunded_full',
        refund_amount_cents: 120000,
        stripe_refund_id: 're_venue_full',
      })
    })
  })
})
