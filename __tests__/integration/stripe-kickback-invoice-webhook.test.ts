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

jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import { POST } from '@/app/api/webhooks/stripe/route'
import { applyCheckoutSessionCompleted, applyInvoicePayment, applyInvoicePaymentFailed } from '@/lib/billing/builder-billing'
import { applyPlannerStripePaymentIntentWebhook, applyPlannerStripeRefundWebhook } from '@/lib/planner/depositPayments'
import { sendBuilderPaidEmail, sendRefundCompletedEmail, sendVenuePaymentFailedEmail } from '@/lib/email'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe/connect'

jest.mock('@/lib/email', () => ({
  sendBuilderPaidEmail: jest.fn().mockResolvedValue({ sent: true, reason: null }),
  sendRefundCompletedEmail: jest.fn().mockResolvedValue({ sent: true, reason: null }),
  sendVenuePaymentFailedEmail: jest.fn().mockResolvedValue({ sent: true, reason: null }),
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
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/stripe/connect', () => ({
  getStripeClient: jest.fn(),
  saveBuilderStripeAccount: jest.fn(),
  saveVendorStripeAccount: jest.fn(),
  saveVenueStripeAccount: jest.fn(),
}))

type Row = Record<string, unknown>

const PAYMENT_ID = 'payment-1'
const AGREEMENT_ID = 'agreement-1'
const CHI_AGREEMENT_ID = 'chi-agreement-1'
const CHI_SETTLEMENT_ID = 'chi-settlement-1'
const VENUE_PAYMENT_ID = 'venue-payment-1'
const SETTLEMENT_RUN_ID = 'settlement-run-1'
const SETTLEMENT_CHARGE_ID = 'settlement-charge-1'
const mockCaptureMessage = Sentry.captureMessage as jest.Mock

class MemoryDb {
  private reservationSequence = 0

  rows: Record<string, Row[]> = {
    kickback_payments: [
      {
        id: PAYMENT_ID,
        agreement_id: AGREEMENT_ID,
        status: 'invoice_sent',
        stripe_transfer_id: null,
        amount_cents: 51360,
        builder_payout_cents: null,
        refund_amount_cents: null,
      },
    ],
    event_kickback_agreements: [
      {
        id: AGREEMENT_ID,
        status: 'payment_pending',
        stripe_transfer_id: null,
      },
    ],
    community_host_incentive_agreements: [
      {
        id: CHI_AGREEMENT_ID,
        status: 'active',
      },
    ],
    community_host_incentive_settlements: [
      {
        id: CHI_SETTLEMENT_ID,
        agreement_id: CHI_AGREEMENT_ID,
        status: 'invoice_sent',
        stripe_invoice_id: null,
        stripe_transfer_id: null,
        organizer_payout_cents: 200000,
      },
    ],
    venue_payment_transactions: [],
    settlement_runs: [],
    settlement_charges: [],
    settlement_audit_log: [],
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
      const existing = this.rows.stripe_webhook_events.find((event) => (
        event.stripe_event_id === args.p_stripe_event_id &&
        event.endpoint_path === args.p_endpoint_path
      ))

      if (!existing) {
        const reservationToken = `kickback-reservation-${++this.reservationSequence}`
        this.rows.stripe_webhook_events.push({
          id: `stripe_webhook_events-${this.rows.stripe_webhook_events.length + 1}`,
          stripe_event_id: args.p_stripe_event_id,
          event_type: args.p_event_type,
          payload: args.p_payload,
          source: args.p_source,
          endpoint_path: args.p_endpoint_path,
          livemode: args.p_livemode,
          processed: false,
          processed_at: null,
          completed_at: null,
          in_flight: true,
          reservation_token: reservationToken,
          reserved_at: new Date().toISOString(),
          processing_outcome: 'received',
          duplicate_count: 0,
          received_at: new Date().toISOString(),
        })
        return {
          data: [{
            existed: false,
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

      if (existing.completed_at || existing.processed) {
        existing.duplicate_count = Number(existing.duplicate_count ?? 0) + 1
        return {
          data: [{
            existed: true,
            in_flight: false,
            completed: true,
            reserved_now: false,
            processed_at: existing.completed_at ?? existing.processed_at ?? null,
          }],
          error: null,
        }
      }

      if (existing.in_flight) {
        return {
          data: [{ existed: true, in_flight: true, completed: false, reserved_now: false, processed_at: null }],
          error: null,
        }
      }

      const reservationToken = `kickback-reservation-${++this.reservationSequence}`
      Object.assign(existing, {
        event_type: args.p_event_type,
        payload: args.p_payload,
        source: args.p_source,
        endpoint_path: args.p_endpoint_path,
        livemode: args.p_livemode,
        processing_outcome: 'received',
        in_flight: true,
        reservation_token: reservationToken,
        reserved_at: new Date().toISOString(),
        last_error: null,
        error: null,
      })
      return {
        data: [{
          existed: true,
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
      const existing = this.rows.stripe_webhook_events.find((event) => (
        event.stripe_event_id === args.p_stripe_event_id &&
        event.endpoint_path === args.p_endpoint_path &&
        event.reservation_token === args.p_reservation_token
      ))
      if (!existing) {
        return { data: null, error: { message: 'Stripe webhook reservation ownership was lost' } }
      }
      const row = {
        id: existing.id,
        stripe_event_id: args.p_stripe_event_id,
        event_type: args.p_event_type,
        payload: args.p_payload,
        source: args.p_source,
        endpoint_path: args.p_endpoint_path,
        livemode: args.p_livemode,
        processed: args.p_processed,
        processed_at: args.p_processed ? new Date().toISOString() : null,
        completed_at: args.p_processed ? new Date().toISOString() : null,
        in_flight: false,
        reservation_token: null,
        processing_outcome: args.p_processing_outcome,
        duplicate_count: existing.duplicate_count ?? 0,
        last_error: args.p_error ?? null,
        error: args.p_error ?? null,
        received_at: existing.received_at ?? new Date().toISOString(),
      }

      Object.assign(existing, row)

      return { data: row, error: null }
    }

    if (fn === 'increment_stripe_webhook_duplicate_count') {
      const row = this.rows.stripe_webhook_events.find((event) => (
        event.stripe_event_id === args.p_stripe_event_id &&
        (!args.p_endpoint_path || event.endpoint_path === args.p_endpoint_path)
      ))
      if (row) row.duplicate_count = Number(row.duplicate_count ?? 0) + 1
      return { data: null, error: null }
    }

    if (
      fn === 'transition_settlement_charge_status' ||
      fn === 'transition_settlement_run_status'
    ) {
      const isCharge = fn === 'transition_settlement_charge_status'
      const table = isCharge ? 'settlement_charges' : 'settlement_runs'
      const idArg = isCharge ? 'p_charge_id' : 'p_run_id'
      const entityKey = isCharge ? 'charge' : 'run'
      const row = this.rows[table].find((candidate) => candidate.id === args[idArg])
      if (!row) {
        return {
          data: [{ success: false, failure_reason: 'not_found', [entityKey]: null }],
          error: null,
        }
      }
      if (row.status !== args.p_from_status) {
        return {
          data: [{
            success: false,
            failure_reason: 'concurrent_update',
            [entityKey]: { ...row },
          }],
          error: null,
        }
      }

      const before = { ...row }
      Object.assign(row, args.p_patch ?? {}, {
        status: args.p_to_status,
        updated_at: new Date().toISOString(),
      })
      this.rows.settlement_audit_log.push({
        id: `settlement_audit_log-${this.rows.settlement_audit_log.length + 1}`,
        entity_type: isCharge ? 'settlement_charge' : 'settlement_run',
        entity_id: row.id,
        action: args.p_action,
        before_state: before,
        after_state: { ...row },
        actor_id: args.p_actor_id,
        actor_type: args.p_actor_type,
        reason: args.p_reason,
        metadata: args.p_metadata,
      })
      return {
        data: [{ success: true, failure_reason: null, [entityKey]: { ...row } }],
        error: null,
      }
    }

    return { data: null, error: null }
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'select' | 'insert' | 'update' = 'select'
  private payload: Row | null = null
  private selectedColumns: string | null = null
  private rowLimit: number | null = null
  private sortColumn: string | null = null
  private sortAscending = true

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

  in(field: string, values: readonly unknown[]) {
    this.filters.push((row) => values.includes(row[field]))
    return this
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.sortColumn = field
    this.sortAscending = options?.ascending ?? true
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

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private execute() {
    if (this.operation === 'insert') {
      const row = { id: `${this.table}-${this.db.rows[this.table].length + 1}`, ...this.payload }
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
    if (this.sortColumn) {
      rows = [...rows].sort((left, right) => {
        const leftValue = String(left[this.sortColumn!] ?? '')
        const rightValue = String(right[this.sortColumn!] ?? '')
        return this.sortAscending
          ? leftValue.localeCompare(rightValue)
          : rightValue.localeCompare(leftValue)
      })
    }
    if (this.rowLimit != null) rows = rows.slice(0, this.rowLimit)
    return rows
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

function makeWebhookRequest() {
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig_test' },
    body: '{}',
  }) as never
}

function makeVenuePaymentRow(overrides: Row = {}): Row {
  return {
    id: VENUE_PAYMENT_ID,
    plan_id: 'plan-1',
    venue_booking_id: 'booking-1',
    builder_id: 'builder-1',
    venue_id: 'venue-1',
    venue_owner_id: 'venue-owner-1',
    amount_cents: 120000,
    processing_fee_cents: 3510,
    application_fee_cents: 0,
    venue_payout_cents: 120000,
    currency: 'usd',
    status: 'checkout_created',
    payment_method_type: 'card',
    stripe_checkout_session_id: 'cs_venue',
    stripe_payment_intent_id: null,
    stripe_charge_id: null,
    stripe_transfer_id: null,
    stripe_refund_id: null,
    stripe_transfer_reversal_id: null,
    refund_amount_cents: null,
    paid_at: null,
    transfer_completed_at: null,
    failed_at: null,
    failure_reason: null,
    ...overrides,
  }
}

describe('Stripe kickback invoice webhook routing', () => {
  let db: MemoryDb
  let stripe: any
  let event: any
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    db = new MemoryDb()
    db.rpc = db.rpc.bind(db)
    stripe = {
      webhooks: {
        constructEvent: jest.fn(() => ({ id: 'evt_test', livemode: false, ...event })),
      },
      transfers: {
        create: jest.fn().mockResolvedValue({ id: 'tr_builder' }),
      },
      paymentIntents: {
        retrieve: jest.fn().mockResolvedValue({
          id: 'pi_venue',
          latest_charge: {
            id: 'ch_venue',
            transfer: 'tr_venue',
            receipt_url: 'https://stripe.test/receipt',
          },
        }),
      },
    }
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
    ;(allowWebhookRequest as jest.Mock).mockResolvedValue(true)
    ;(getWebhookRateLimitKey as jest.Mock).mockReturnValue('stripe:test')
  })

  afterAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = originalSecret
  })

  it('transfers 100% of invoice principal to the builder for kickback invoices', async () => {
    event = {
      id: 'evt_legacy_invoice_paid',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_kickback',
          metadata: {
            kickback_payment_id: PAYMENT_ID,
            settlement_method: 'invoice',
            principal_cents: '51360',
            builder_stripe_account_id: 'acct_builder',
          },
        },
      },
    }

    const response = await POST(makeWebhookRequest())

    expect(response.status).toBe(200)
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      {
        amount: 51360,
        currency: 'usd',
        destination: 'acct_builder',
        transfer_group: `kickback_${PAYMENT_ID}`,
        metadata: {
          payment_kind_namespace: 'venue_builder_kickback',
          kickback_payment_id: PAYMENT_ID,
          settlement_method: 'invoice',
        },
      },
      { idempotencyKey: `kickback_invoice_transfer_${PAYMENT_ID}_in_kickback_51360` }
    )
    expect(applyInvoicePayment).not.toHaveBeenCalled()
    expect(sendBuilderPaidEmail).toHaveBeenCalledWith({ paymentId: PAYMENT_ID })
    expect(mockCaptureMessage).toHaveBeenCalledWith('legacy_chi_webhook_received', {
      level: 'warning',
      tags: {
        action: 'legacy_chi_webhook_received',
        stripe_event_id: 'evt_legacy_invoice_paid',
        stripe_event_type: 'invoice.paid',
      },
      extra: { stripeObjectId: 'in_kickback' },
    })
    expect(db.rows.kickback_payments[0]).toMatchObject({
      status: 'paid',
      stripe_transfer_id: 'tr_builder',
      builder_payout_cents: 51360,
    })
    expect(db.rows.event_kickback_agreements[0]).toMatchObject({
      status: 'payment_completed',
      stripe_transfer_id: 'tr_builder',
    })
  })

  it('transfers CHI invoice principal once and records duplicate signed deliveries in the ledger', async () => {
    event = {
      id: 'evt_chi_invoice_paid',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_chi',
          currency: 'usd',
          metadata: {
            payment_type: 'community_host_incentive',
            chi_settlement_id: CHI_SETTLEMENT_ID,
            chi_agreement_id: CHI_AGREEMENT_ID,
            builder_stripe_account_id: 'acct_builder',
            principal_cents: '200000',
            event_id: 'event-1',
            venue_id: 'venue-1',
            organizer_id: 'builder-1',
            legacy_payment_id: PAYMENT_ID,
          },
        },
      },
    }

    const firstResponse = await POST(makeWebhookRequest())
    const secondResponse = await POST(makeWebhookRequest())
    const secondJson = await secondResponse.json()

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(secondJson).toMatchObject({ received: true, duplicate: true })
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1)
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      {
        amount: 200000,
        currency: 'usd',
        destination: 'acct_builder',
        transfer_group: `community_host_incentive_${CHI_SETTLEMENT_ID}`,
        metadata: {
          payment_type: 'community_host_incentive',
          chi_settlement_id: CHI_SETTLEMENT_ID,
          chi_agreement_id: CHI_AGREEMENT_ID,
          event_id: 'event-1',
          venue_id: 'venue-1',
          organizer_id: 'builder-1',
          legacy_payment_id: PAYMENT_ID,
          principal_cents: '200000',
        },
      },
      {
        idempotencyKey: `community_host_incentive_invoice_transfer_${CHI_SETTLEMENT_ID}_in_chi_200000`,
      }
    )
    expect(applyInvoicePayment).not.toHaveBeenCalled()
    expect(sendBuilderPaidEmail).not.toHaveBeenCalled()
    expect(db.rows.community_host_incentive_settlements[0]).toMatchObject({
      status: 'paid',
      stripe_invoice_id: 'in_chi',
      stripe_transfer_id: 'tr_builder',
      organizer_payout_cents: 200000,
    })
    expect(db.rows.community_host_incentive_agreements[0]).toMatchObject({
      status: 'completed',
    })
    expect(db.rows.kickback_payments[0]).toMatchObject({
      status: 'paid',
      stripe_transfer_id: 'tr_builder',
      builder_payout_cents: 200000,
    })
    expect(db.rows.stripe_webhook_events).toHaveLength(1)
    expect(db.rows.stripe_webhook_events[0]).toMatchObject({
      stripe_event_id: 'evt_chi_invoice_paid',
      event_type: 'invoice.paid',
      source: 'platform',
      endpoint_path: '/api/webhooks/stripe',
      processed: true,
      processing_outcome: 'processed',
      duplicate_count: 1,
    })
  })

  it('rejects non-USD CHI invoices without creating a transfer', async () => {
    event = {
      id: 'evt_chi_invoice_paid_eur',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_chi_eur',
          currency: 'eur',
          amount_paid: 200000,
          metadata: {
            payment_type: 'community_host_incentive',
            chi_settlement_id: CHI_SETTLEMENT_ID,
            chi_agreement_id: CHI_AGREEMENT_ID,
            builder_stripe_account_id: 'acct_builder',
            principal_cents: '200000',
          },
        },
      },
    }

    const response = await POST(makeWebhookRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({ received: true, ignored: true, reason: 'non_usd_currency' })
    expect(stripe.transfers.create).not.toHaveBeenCalled()
    expect(db.rows.community_host_incentive_settlements[0]).toMatchObject({
      status: 'invoice_sent',
      stripe_transfer_id: null,
    })
    expect(mockCaptureMessage).toHaveBeenCalledWith('CHI invoice non-USD', {
      level: 'error',
      extra: {
        invoice_id: 'in_chi_eur',
        currency: 'eur',
        amount: 200000,
      },
    })
    expect(db.rows.stripe_webhook_events[0]).toMatchObject({
      stripe_event_id: 'evt_chi_invoice_paid_eur',
      event_type: 'invoice.paid',
      processing_outcome: 'ignored',
      processed: true,
    })
  })

  it('does not create a second CHI transfer when Stripe redelivers the same invoice under a new event id', async () => {
    const invoice = {
      id: 'in_chi',
      currency: 'usd',
      metadata: {
        payment_type: 'community_host_incentive',
        chi_settlement_id: CHI_SETTLEMENT_ID,
        chi_agreement_id: CHI_AGREEMENT_ID,
        builder_stripe_account_id: 'acct_builder',
        principal_cents: '200000',
        event_id: 'event-1',
        venue_id: 'venue-1',
        organizer_id: 'builder-1',
        legacy_payment_id: PAYMENT_ID,
      },
    }
    event = {
      id: 'evt_chi_invoice_paid_first',
      type: 'invoice.paid',
      data: { object: invoice },
    }

    const firstResponse = await POST(makeWebhookRequest())
    event = {
      id: 'evt_chi_invoice_paid_second',
      type: 'invoice.paid',
      data: { object: invoice },
    }
    const secondResponse = await POST(makeWebhookRequest())

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1)
    expect(db.rows.community_host_incentive_settlements[0]).toMatchObject({
      status: 'paid',
      stripe_transfer_id: 'tr_builder',
    })
    expect(db.rows.stripe_webhook_events).toHaveLength(2)
    expect(db.rows.stripe_webhook_events.map((row) => row.stripe_event_id)).toEqual([
      'evt_chi_invoice_paid_first',
      'evt_chi_invoice_paid_second',
    ])
  })

  it('marks CHI invoices failed without calling builder billing failure handling', async () => {
    event = {
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_chi_failed',
          metadata: {
            payment_type: 'community_host_incentive',
            chi_settlement_id: CHI_SETTLEMENT_ID,
            legacy_payment_id: PAYMENT_ID,
          },
        },
      },
    }

    const response = await POST(makeWebhookRequest())

    expect(response.status).toBe(200)
    expect(applyInvoicePaymentFailed).not.toHaveBeenCalled()
    expect(sendVenuePaymentFailedEmail).not.toHaveBeenCalled()
    expect(db.rows.community_host_incentive_settlements[0]).toMatchObject({
      status: 'failed',
    })
    expect(db.rows.kickback_payments[0]).toMatchObject({
      status: 'invoice_failed',
      failure_reason: 'Stripe Community Host Incentive invoice payment failed',
    })
  })

  it('routes non-kickback invoice.paid events to builder billing unchanged', async () => {
    const invoice = {
      id: 'in_builder_subscription',
      subscription: 'sub_builder',
      metadata: {},
      lines: { data: [] },
    }
    event = {
      type: 'invoice.paid',
      data: { object: invoice },
    }

    const response = await POST(makeWebhookRequest())

    expect(response.status).toBe(200)
    expect(applyInvoicePayment).toHaveBeenCalledWith(db, invoice)
    expect(stripe.transfers.create).not.toHaveBeenCalled()
    expect(sendBuilderPaidEmail).not.toHaveBeenCalled()
    expect(db.rows.venue_payment_transactions).toEqual([])
  })

  it('routes kickback checkout sessions without touching venue rental payments', async () => {
    event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_kickback',
          payment_intent: 'pi_kickback',
          metadata: {
            payment_kind: 'venue_builder_kickback',
            payment_kind_namespace: 'venue_builder_kickback',
            kickback_payment_id: PAYMENT_ID,
            agreement_id: AGREEMENT_ID,
          },
        },
      },
    }

    const response = await POST(makeWebhookRequest())

    expect(response.status).toBe(200)
    expect(applyCheckoutSessionCompleted).not.toHaveBeenCalled()
    expect(db.rows.venue_payment_transactions).toEqual([])
    expect(db.rows.kickback_payments[0]).toMatchObject({
      status: 'completed',
      stripe_payment_intent_id: 'pi_kickback',
      stripe_charge_id: 'ch_venue',
      stripe_transfer_id: 'tr_venue',
    })
  })

  it('marks kickback invoices failed without calling builder billing failure handling', async () => {
    event = {
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_failed',
          metadata: {
            kickback_payment_id: PAYMENT_ID,
            settlement_method: 'invoice',
          },
        },
      },
    }

    const response = await POST(makeWebhookRequest())

    expect(response.status).toBe(200)
    expect(applyInvoicePaymentFailed).not.toHaveBeenCalled()
    expect(sendVenuePaymentFailedEmail).toHaveBeenCalledWith({ paymentId: PAYMENT_ID })
    expect(db.rows.kickback_payments[0]).toMatchObject({
      status: 'invoice_failed',
      failure_reason: 'Stripe invoice payment failed',
    })
  })

  it('marks kickback refunds complete from charge.refunded without touching planner deposit refunds', async () => {
    Object.assign(db.rows.kickback_payments[0], {
      status: 'refund_processing',
      builder_payout_cents: 51360,
      refund_amount_cents: 18000,
    })
    event = {
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_kickback',
          metadata: {},
          refunds: {
            data: [
              {
                id: 're_kickback',
                metadata: {
                  kickback_payment_id: PAYMENT_ID,
                  settlement_method: 'invoice',
                },
              },
            ],
          },
        },
      },
    }

    const response = await POST(makeWebhookRequest())

    expect(response.status).toBe(200)
    expect(applyPlannerStripeRefundWebhook).not.toHaveBeenCalled()
    expect(sendRefundCompletedEmail).toHaveBeenCalledWith({
      paymentId: PAYMENT_ID,
      isFullRefund: false,
    })
    expect(db.rows.kickback_payments[0]).toMatchObject({
      status: 'refunded_partial',
    })
  })

  describe('venue rental webhook routing', () => {
    it('marks venue rental checkout sessions paid without calling subscription billing', async () => {
      db.rows.venue_payment_transactions.push(makeVenuePaymentRow())
      event = {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_venue',
            status: 'complete',
            payment_status: 'paid',
            payment_intent: 'pi_venue',
            metadata: {
              payment_kind_namespace: 'venue_rental',
              venue_payment_transaction_id: VENUE_PAYMENT_ID,
            },
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_venue', { expand: ['latest_charge'] })
      expect(applyCheckoutSessionCompleted).not.toHaveBeenCalled()
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'paid',
        stripe_payment_intent_id: 'pi_venue',
        stripe_charge_id: 'ch_venue',
        stripe_transfer_id: 'tr_venue',
      })
      expect(db.rows.venue_payment_transactions[0].paid_at).toEqual(expect.any(String))
    })

    it('does not mark a complete but unpaid venue Checkout Session paid', async () => {
      db.rows.venue_payment_transactions.push(makeVenuePaymentRow({
        status: 'blocked_by_account_state',
      }))
      event = {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_venue',
            status: 'complete',
            payment_status: 'unpaid',
            payment_intent: 'pi_venue',
            metadata: {
              payment_kind_namespace: 'venue_rental',
              venue_payment_transaction_id: VENUE_PAYMENT_ID,
            },
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        received: true,
        observed: 'checkout_payment_pending',
      })
      expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled()
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'blocked_by_account_state',
        paid_at: null,
      })
    })

    it('finalizes a paid venue rental from checkout.session.async_payment_succeeded', async () => {
      db.rows.venue_payment_transactions.push(makeVenuePaymentRow({
        status: 'blocked_by_account_state',
      }))
      event = {
        type: 'checkout.session.async_payment_succeeded',
        data: {
          object: {
            id: 'cs_venue',
            status: 'complete',
            payment_status: 'paid',
            payment_intent: 'pi_venue',
            metadata: {
              payment_kind_namespace: 'venue_rental',
              venue_payment_transaction_id: VENUE_PAYMENT_ID,
            },
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'paid',
        stripe_payment_intent_id: 'pi_venue',
        stripe_charge_id: 'ch_venue',
        stripe_transfer_id: 'tr_venue',
      })
    })

    it('records checkout.session.async_payment_failed without marking the venue paid', async () => {
      db.rows.venue_payment_transactions.push(makeVenuePaymentRow({
        status: 'blocked_by_account_state',
        stripe_payment_intent_id: 'pi_venue',
      }))
      stripe.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_venue',
        status: 'requires_payment_method',
        latest_charge: null,
        metadata: {
          payment_kind_namespace: 'venue_rental',
          venue_payment_transaction_id: VENUE_PAYMENT_ID,
        },
        last_payment_error: { message: 'ACH payment failed' },
      })
      event = {
        type: 'checkout.session.async_payment_failed',
        data: {
          object: {
            id: 'cs_venue',
            status: 'complete',
            payment_status: 'unpaid',
            payment_intent: 'pi_venue',
            metadata: {
              payment_kind_namespace: 'venue_rental',
              venue_payment_transaction_id: VENUE_PAYMENT_ID,
            },
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_venue', {
        expand: ['latest_charge'],
      })
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'failed',
        failure_reason: 'ACH payment failed',
        paid_at: null,
      })
    })

    it('ignores a delayed venue async-failure event when fresh Stripe truth is processing', async () => {
      db.rows.venue_payment_transactions.push(makeVenuePaymentRow({
        status: 'blocked_by_account_state',
        stripe_payment_intent_id: 'pi_venue',
      }))
      stripe.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_venue',
        status: 'processing',
        latest_charge: null,
        metadata: {
          payment_kind_namespace: 'venue_rental',
          venue_payment_transaction_id: VENUE_PAYMENT_ID,
        },
      })
      event = {
        id: 'evt_venue_async_failure_stale_processing',
        type: 'checkout.session.async_payment_failed',
        data: {
          object: {
            id: 'cs_venue',
            status: 'complete',
            payment_status: 'unpaid',
            payment_intent: 'pi_venue',
            metadata: {
              payment_kind_namespace: 'venue_rental',
              venue_payment_transaction_id: VENUE_PAYMENT_ID,
            },
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        received: true,
        observed: 'checkout_async_payment_failed',
      })
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'blocked_by_account_state',
        failure_reason: null,
        paid_at: null,
      })
    })

    it('reconciles checkout.session.async_payment_failed for a restriction-blocked settlement', async () => {
      db.rows.settlement_runs.push({
        id: SETTLEMENT_RUN_ID,
        event_id: 'event-1',
        organizer_id: 'organizer-1',
        venue_id: 'venue-1',
        archetype: 'happy_hour',
        venue_type: 'bar',
        neighborhood: 'mission',
        total_cents: 12000,
        status: 'blocked',
        blocked_at: '2026-07-11T00:00:00.000Z',
        blocked_previous_status: 'awaiting_venue_payment',
        blocked_stripe_account_id: 'acct_builder',
        account_state_blocked_at: '2026-07-11T00:00:00.000Z',
        account_state_block_reason: 'account_restricted',
        account_state_blocked_event_id: 'evt_account_restricted',
      })
      db.rows.settlement_charges.push({
        id: SETTLEMENT_CHARGE_ID,
        settlement_run_id: SETTLEMENT_RUN_ID,
        approval_id: 'approval-1',
        organizer_id: 'organizer-1',
        venue_id: 'venue-1',
        amount_cents: 12000,
        platform_fee_cents: 0,
        organizer_payout_cents: 12000,
        currency: 'usd',
        status: 'blocked',
        blocked_at: '2026-07-11T00:00:00.000Z',
        blocked_previous_status: 'checkout_created',
        blocked_stripe_account_id: 'acct_builder',
        account_state_blocked_at: '2026-07-11T00:00:00.000Z',
        account_state_block_reason: 'account_restricted',
        account_state_blocked_event_id: 'evt_account_restricted',
        stripe_checkout_session_id: 'cs_settlement_async_failed',
        stripe_payment_intent_id: 'pi_settlement_async_failed',
        stripe_transfer_id: null,
        stripe_connected_account_id: 'acct_builder',
        checkout_url: 'https://checkout.stripe.test/settlement-async-failed',
        paid_at: null,
        failed_at: null,
        trueup_processed_at: null,
        failure_reason: null,
        created_at: '2026-07-11T00:00:00.000Z',
      })
      stripe.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_settlement_async_failed',
        status: 'requires_payment_method',
        latest_charge: null,
        metadata: {
          kind: 'chi_settlement',
          settlement_charge_id: SETTLEMENT_CHARGE_ID,
          settlement_run_id: SETTLEMENT_RUN_ID,
        },
        last_payment_error: { message: 'ACH debit failed' },
      })
      event = {
        id: 'evt_settlement_async_failed',
        type: 'checkout.session.async_payment_failed',
        data: {
          object: {
            id: 'cs_settlement_async_failed',
            status: 'complete',
            payment_status: 'unpaid',
            payment_intent: 'pi_settlement_async_failed',
            metadata: {
              kind: 'chi_settlement',
              settlement_charge_id: SETTLEMENT_CHARGE_ID,
              settlement_run_id: SETTLEMENT_RUN_ID,
            },
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith('{}', 'sig_test', 'whsec_test')
      expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith(
        'pi_settlement_async_failed',
        { expand: ['latest_charge'] },
      )
      expect(db.rows.settlement_charges[0]).toMatchObject({
        status: 'failed',
        stripe_payment_intent_id: 'pi_settlement_async_failed',
        failure_reason: 'ACH debit failed',
        checkout_url: null,
        blocked_at: null,
        blocked_previous_status: null,
        blocked_stripe_account_id: null,
        account_state_blocked_at: null,
        account_state_block_reason: null,
        account_state_blocked_event_id: null,
      })
      expect(db.rows.settlement_runs[0]).toMatchObject({
        status: 'awaiting_venue_payment',
        blocked_at: null,
        blocked_previous_status: null,
        blocked_stripe_account_id: null,
        account_state_blocked_at: null,
        account_state_block_reason: null,
        account_state_blocked_event_id: null,
      })
      expect(db.rows.settlement_audit_log).toEqual(expect.arrayContaining([
        expect.objectContaining({
          entity_type: 'settlement_charge',
          action: 'payment_intent.payment_failed',
        }),
        expect.objectContaining({
          entity_type: 'settlement_run',
          action: 'payment_intent.payment_failed',
        }),
        expect.objectContaining({
          entity_type: 'settlement_charge',
          action: 'account_restriction_cleared_after_payment_failure',
        }),
        expect.objectContaining({
          entity_type: 'settlement_run',
          action: 'account_restriction_cleared_after_payment_failure',
        }),
      ]))
      expect(db.rows.stripe_webhook_events[0]).toMatchObject({
        stripe_event_id: 'evt_settlement_async_failed',
        processed: true,
        processing_outcome: 'processed',
      })
    })

    it('ignores a delayed settlement async-failure event when fresh Stripe truth succeeded', async () => {
      db.rows.settlement_charges.push({
        id: SETTLEMENT_CHARGE_ID,
        settlement_run_id: SETTLEMENT_RUN_ID,
        status: 'blocked',
        blocked_previous_status: 'checkout_created',
        stripe_checkout_session_id: 'cs_settlement_stale_failure',
        stripe_payment_intent_id: 'pi_settlement_stale_failure',
        failure_reason: null,
      })
      stripe.paymentIntents.retrieve.mockResolvedValueOnce({
        id: 'pi_settlement_stale_failure',
        status: 'succeeded',
        latest_charge: 'ch_settlement_paid',
        metadata: {
          kind: 'chi_settlement',
          settlement_charge_id: SETTLEMENT_CHARGE_ID,
          settlement_run_id: SETTLEMENT_RUN_ID,
        },
      })
      event = {
        id: 'evt_settlement_async_failure_stale_succeeded',
        type: 'checkout.session.async_payment_failed',
        data: {
          object: {
            id: 'cs_settlement_stale_failure',
            status: 'complete',
            payment_status: 'unpaid',
            payment_intent: 'pi_settlement_stale_failure',
            metadata: {
              kind: 'chi_settlement',
              settlement_charge_id: SETTLEMENT_CHARGE_ID,
              settlement_run_id: SETTLEMENT_RUN_ID,
            },
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        received: true,
        observed: 'checkout_async_payment_failed',
      })
      expect(db.rows.settlement_charges[0]).toMatchObject({
        status: 'blocked',
        blocked_previous_status: 'checkout_created',
        failure_reason: null,
      })
      expect(db.rows.settlement_audit_log).toHaveLength(0)
    })

    it('reconciles a completed venue Checkout Session from account-blocked local state', async () => {
      db.rows.venue_payment_transactions.push(makeVenuePaymentRow({
        status: 'blocked_by_account_state',
        account_state_blocked_at: '2026-07-11T00:00:00.000Z',
        account_state_block_reason: 'account_restricted',
      }))
      event = {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_venue',
            status: 'complete',
            payment_status: 'paid',
            payment_intent: 'pi_venue',
            metadata: {
              payment_kind_namespace: 'venue_rental',
              venue_payment_transaction_id: VENUE_PAYMENT_ID,
            },
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'paid',
        stripe_payment_intent_id: 'pi_venue',
        stripe_charge_id: 'ch_venue',
        stripe_transfer_id: 'tr_venue',
        failed_at: null,
        failure_reason: null,
      })
    })

    it('treats payment_intent.succeeded after checkout completion as idempotent', async () => {
      db.rows.venue_payment_transactions.push(makeVenuePaymentRow({
        status: 'paid',
        paid_at: '2026-05-30T00:00:00.000Z',
        stripe_payment_intent_id: 'pi_venue',
        stripe_charge_id: 'ch_venue',
      }))
      event = {
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_venue',
            status: 'succeeded',
            latest_charge: 'ch_venue',
            metadata: {
              payment_kind_namespace: 'venue_rental',
              venue_payment_transaction_id: VENUE_PAYMENT_ID,
            },
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(applyPlannerStripePaymentIntentWebhook).not.toHaveBeenCalled()
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'paid',
        paid_at: '2026-05-30T00:00:00.000Z',
        stripe_payment_intent_id: 'pi_venue',
        stripe_charge_id: 'ch_venue',
      })
    })

    it('marks venue rental payment intents failed', async () => {
      db.rows.venue_payment_transactions.push(makeVenuePaymentRow({
        stripe_payment_intent_id: 'pi_venue',
      }))
      event = {
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_venue',
            latest_charge: null,
            metadata: {
              payment_kind_namespace: 'venue_rental',
              venue_payment_transaction_id: VENUE_PAYMENT_ID,
            },
            last_payment_error: {
              message: 'Card was declined',
            },
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(applyPlannerStripePaymentIntentWebhook).not.toHaveBeenCalled()
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'failed',
        failure_reason: 'Card was declined',
      })
      expect(db.rows.venue_payment_transactions[0].failed_at).toEqual(expect.any(String))
    })

    it('marks full venue rental refunds from charge.refunded', async () => {
      db.rows.venue_payment_transactions.push(makeVenuePaymentRow({
        status: 'paid',
        stripe_charge_id: 'ch_venue',
      }))
      event = {
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_venue',
            amount_refunded: 120000,
            metadata: {
              payment_kind_namespace: 'venue_rental',
              venue_payment_transaction_id: VENUE_PAYMENT_ID,
            },
            refunds: {
              data: [{ id: 're_full' }],
            },
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(applyPlannerStripeRefundWebhook).not.toHaveBeenCalled()
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'refunded_full',
        refund_amount_cents: 120000,
        stripe_refund_id: 're_full',
      })
    })

    it('marks partial venue rental refunds from charge.refunded', async () => {
      db.rows.venue_payment_transactions.push(makeVenuePaymentRow({
        status: 'paid',
        stripe_charge_id: 'ch_venue',
      }))
      event = {
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_venue',
            amount_refunded: 50000,
            metadata: {
              payment_kind_namespace: 'venue_rental',
              venue_payment_transaction_id: VENUE_PAYMENT_ID,
            },
            refunds: {
              data: [{ id: 're_partial' }],
            },
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'refunded_partial',
        refund_amount_cents: 50000,
        stripe_refund_id: 're_partial',
      })
    })

    it('routes venue_rental transfer.created without mutating kickback payments', async () => {
      db.rows.venue_payment_transactions.push(makeVenuePaymentRow({
        status: 'paid',
        stripe_transfer_id: 'tr_venue',
      }))
      event = {
        type: 'transfer.created',
        data: {
          object: {
            id: 'tr_venue',
            metadata: {
              payment_kind_namespace: 'venue_rental',
              venue_payment_transaction_id: VENUE_PAYMENT_ID,
            },
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        stripe_transfer_id: 'tr_venue',
      })
      expect(db.rows.venue_payment_transactions[0].transfer_completed_at).toEqual(expect.any(String))
      expect(db.rows.kickback_payments[0]).toMatchObject({
        status: 'invoice_sent',
        stripe_transfer_id: null,
      })
    })

    it('routes venue rental transfer.updated by stripe_transfer_id when metadata is absent', async () => {
      db.rows.venue_payment_transactions.push(makeVenuePaymentRow({
        status: 'paid',
        stripe_transfer_id: 'tr_venue_existing',
      }))
      event = {
        type: 'transfer.updated',
        data: {
          object: {
            id: 'tr_venue_existing',
            metadata: {},
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        stripe_transfer_id: 'tr_venue_existing',
      })
      expect(db.rows.venue_payment_transactions[0].transfer_completed_at).toEqual(expect.any(String))
      expect(db.rows.kickback_payments[0]).toMatchObject({
        status: 'invoice_sent',
        stripe_transfer_id: null,
      })
    })

    it('records venue_rental transfer.reversed without changing refund status', async () => {
      db.rows.venue_payment_transactions.push(makeVenuePaymentRow({
        status: 'paid',
        stripe_transfer_id: 'tr_venue',
      }))
      event = {
        type: 'transfer.reversed',
        data: {
          object: {
            id: 'tr_venue',
            metadata: {
              payment_kind_namespace: 'venue_rental',
              venue_payment_transaction_id: VENUE_PAYMENT_ID,
            },
            reversals: {
              data: [{ id: 'trr_venue' }],
            },
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(db.rows.venue_payment_transactions[0]).toMatchObject({
        status: 'paid',
        stripe_transfer_reversal_id: 'trr_venue',
      })
    })

    it('logs malformed venue rental events without falling through to other handlers', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
      event = {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_missing_row',
            status: 'complete',
            payment_status: 'paid',
            payment_intent: null,
            metadata: {
              payment_kind_namespace: 'venue_rental',
            },
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(applyCheckoutSessionCompleted).not.toHaveBeenCalled()
      expect(db.rows.venue_payment_transactions).toEqual([])
      expect(errorSpy).toHaveBeenCalledWith(
        '[stripe.webhook] venue rental event could not load transaction',
        {
          source: 'checkout.session.completed',
          stripeObjectId: 'cs_missing_row',
          metadata: {
            payment_kind_namespace: 'venue_rental',
          },
        }
      )
      errorSpy.mockRestore()
    })
  })

  describe('transfer.created / transfer.updated namespace isolation', () => {
    it('routes transfer.created with kickback_payment_id metadata to the kickback handler', async () => {
      event = {
        type: 'transfer.created',
        data: {
          object: {
            id: 'tr_kickback',
            metadata: {
              kickback_payment_id: PAYMENT_ID,
            },
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(db.rows.kickback_payments[0]).toMatchObject({
        status: 'completed',
        stripe_transfer_id: 'tr_kickback',
      })
      expect(db.rows.kickback_payments[0].completed_at).toEqual(expect.any(String))
    })

    it('routes transfer.updated with venue_builder_kickback namespace to the kickback handler', async () => {
      Object.assign(db.rows.kickback_payments[0], {
        status: 'processing',
        stripe_transfer_id: 'tr_namespace',
      })
      event = {
        type: 'transfer.updated',
        data: {
          object: {
            id: 'tr_namespace',
            metadata: {
              payment_kind_namespace: 'venue_builder_kickback',
            },
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(db.rows.kickback_payments[0]).toMatchObject({
        status: 'completed',
        stripe_transfer_id: 'tr_namespace',
      })
      expect(db.rows.kickback_payments[0].completed_at).toEqual(expect.any(String))
    })

    it('drops transfer events with no recognized namespace without mutating by stripe_transfer_id', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
      Object.assign(db.rows.kickback_payments[0], {
        status: 'processing',
        stripe_transfer_id: 'tr_unrecognized',
        completed_at: null,
      })
      event = {
        type: 'transfer.updated',
        data: {
          object: {
            id: 'tr_unrecognized',
            metadata: {},
          },
        },
      }

      const response = await POST(makeWebhookRequest())

      expect(response.status).toBe(200)
      expect(db.rows.kickback_payments[0]).toMatchObject({
        status: 'processing',
        stripe_transfer_id: 'tr_unrecognized',
        completed_at: null,
      })
      expect(db.rows.venue_payment_transactions).toEqual([])
      expect(logSpy).toHaveBeenCalledWith(
        '[stripe.webhook] transfer event with no recognized namespace',
        {
          transferId: 'tr_unrecognized',
          metadata: {},
        }
      )
      logSpy.mockRestore()
    })
  })

  it('marks full kickback refunds complete from transfer.reversed invoice metadata', async () => {
    Object.assign(db.rows.kickback_payments[0], {
      status: 'refund_processing',
      builder_payout_cents: 51360,
      refund_amount_cents: 51360,
    })
    event = {
      type: 'transfer.reversed',
      data: {
        object: {
          id: 'tr_builder',
          metadata: {
            kickback_payment_id: PAYMENT_ID,
            settlement_method: 'invoice',
          },
        },
      },
    }

    const response = await POST(makeWebhookRequest())

    expect(response.status).toBe(200)
    expect(sendRefundCompletedEmail).toHaveBeenCalledWith({
      paymentId: PAYMENT_ID,
      isFullRefund: true,
    })
    expect(db.rows.kickback_payments[0]).toMatchObject({
      status: 'refunded_full',
    })
  })
})
