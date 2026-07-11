/**
 * @jest-environment node
 */

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

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { TextDecoder, TextEncoder } from 'node:util'
import Stripe from 'stripe'
import { POST as stripePlatformWebhookPost } from '@/app/api/webhooks/stripe/route'
import { POST as stripeConnectWebhookPost } from '@/app/api/webhooks/stripe/connect/route'
import { applyCheckoutSessionCompleted, applyInvoicePayment, applyInvoicePaymentFailed } from '@/lib/billing/builder-billing'
import { applyPlannerStripePaymentIntentWebhook, applyPlannerStripeRefundWebhook } from '@/lib/planner/depositPayments'
import { sendBuilderPaidEmail, sendRefundCompletedEmail, sendVenuePaymentFailedEmail } from '@/lib/email'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  getStripeClient,
  saveBuilderStripeAccount,
  saveVendorStripeAccount,
  saveVenueStripeAccount,
} from '@/lib/stripe/connect'

Object.assign(global, { TextDecoder, TextEncoder })

jest.mock('@/lib/email', () => ({
  sendEmailNotification: jest.fn().mockResolvedValue({ sent: true }),
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
  getStripeAccountStatus: jest.fn((account: { charges_enabled?: boolean; payouts_enabled?: boolean; requirements?: { disabled_reason?: string | null; past_due?: unknown[]; currently_due?: unknown[] }; details_submitted?: boolean }) => {
    if (account.charges_enabled && account.payouts_enabled) return 'active'
    if (account.requirements?.disabled_reason) return 'disabled'
    if ((account.requirements?.past_due?.length ?? 0) > 0) return 'restricted'
    if ((account.requirements?.currently_due?.length ?? 0) > 0) return 'capabilities_pending'
    return account.details_submitted ? 'onboarding_started' : 'pending_onboarding'
  }),
  getStripeClient: jest.fn(),
  isConnectedStripeAccountBlocked: jest.fn((status: string | null | undefined) => status === 'restricted' || status === 'disabled'),
  saveBuilderStripeAccount: jest.fn().mockResolvedValue({}),
  saveVendorStripeAccount: jest.fn().mockResolvedValue({}),
  saveVenueStripeAccount: jest.fn().mockResolvedValue({}),
}))

type Row = Record<string, unknown>

type Fixture = {
  timestamp: number
  signature: string
  body: string
}

const TEST_WEBHOOK_SECRET = 'whsec_codex_fixture_secret'

class MemoryDb {
  rows: Record<string, Row[]> = {
    builder_stripe_accounts: [
      {
        user_id: 'builder-user-1',
        builder_id: 'builder-profile-1',
        stripe_account_id: 'acct_builder',
        account_status: 'active',
      },
    ],
    vendor_stripe_accounts: [],
    venue_stripe_accounts: [],
    kickback_payments: [
      {
        id: 'payment-1',
        agreement_id: 'agreement-1',
        status: 'invoice_sent',
        stripe_transfer_id: null,
        amount_cents: 51360,
        builder_payout_cents: null,
      },
    ],
    event_kickback_agreements: [
      {
        id: 'agreement-1',
        status: 'payment_pending',
        stripe_transfer_id: null,
      },
    ],
    venue_payment_transactions: [
      {
        id: 'venue-payment-1',
        plan_id: 'plan-1',
        venue_booking_id: 'booking-1',
        builder_id: 'builder-1',
        venue_id: 'venue-1',
        venue_owner_id: 'venue-owner-1',
        amount_cents: 120000,
        status: 'checkout_created',
        paid_at: null,
        stripe_payment_intent_id: null,
        stripe_charge_id: null,
        stripe_transfer_id: null,
        stripe_refund_id: null,
        stripe_transfer_reversal_id: null,
        refund_amount_cents: null,
      },
    ],
    stripe_webhook_events: [],
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }

  async rpc(fn: string, args: Record<string, unknown>) {
    if (fn === 'reserve_stripe_webhook_event') {
      const existing = this.rows.stripe_webhook_events.find((event) => (
        event.stripe_event_id === args.p_stripe_event_id &&
        event.endpoint_path === args.p_endpoint_path
      ))

      if (!existing) {
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
          data: [{
            existed: true,
            in_flight: true,
            completed: false,
            reserved_now: false,
            processed_at: null,
          }],
          error: null,
        }
      }

      Object.assign(existing, {
        event_type: args.p_event_type,
        payload: args.p_payload,
        source: args.p_source,
        endpoint_path: args.p_endpoint_path,
        livemode: args.p_livemode,
        processing_outcome: 'received',
        in_flight: true,
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
        }],
        error: null,
      }
    }

    if (fn === 'increment_stripe_webhook_duplicate_count') {
      const row = this.rows.stripe_webhook_events.find((event) => (
        event.stripe_event_id === args.p_stripe_event_id &&
        (!args.p_endpoint_path || event.endpoint_path === args.p_endpoint_path)
      ))
      if (row) row.duplicate_count = Number(row.duplicate_count ?? 0) + 1
      return { data: null, error: null }
    }

    if (fn === 'record_stripe_webhook_event_result') {
      const existing = this.rows.stripe_webhook_events.find((event) => (
        event.stripe_event_id === args.p_stripe_event_id &&
        event.endpoint_path === args.p_endpoint_path
      ))
      const row = {
        id: existing?.id ?? `stripe_webhook_events-${this.rows.stripe_webhook_events.length + 1}`,
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
        processing_outcome: args.p_processing_outcome,
        duplicate_count: existing?.duplicate_count ?? 0,
        last_error: args.p_error ?? null,
        error: args.p_error ?? null,
        received_at: existing?.received_at ?? new Date().toISOString(),
      }

      if (existing) Object.assign(existing, row)
      else this.rows.stripe_webhook_events.push(row)

      return { data: row, error: null }
    }

    return { data: null, error: null }
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
    return (this.db.rows[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)))
  }

  private projectRows(rows: Row[]) {
    if (!this.selectedColumns || this.selectedColumns === '*') return rows
    const columns = this.selectedColumns.split(',').map((column) => column.trim()).filter(Boolean)
    return rows.map((row) => {
      const projected: Row = {}
      for (const column of columns) {
        projected[column] = row[column]
      }
      return projected
    })
  }
}

function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(path.join(process.cwd(), '__tests__/fixtures/stripe', `${name}.json`), 'utf8'))
}

function makeWebhookRequest(pathname: string, fixture: Fixture) {
  return new Request(`http://localhost${pathname}`, {
    method: 'POST',
    headers: { 'stripe-signature': fixture.signature },
    body: fixture.body,
  }) as never
}

describe('Stripe signed webhook fixtures', () => {
  const originalPlatformSecret = process.env.STRIPE_WEBHOOK_SECRET
  const originalConnectSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  const verifier = new Stripe('sk_test_codex_fixture', {
    apiVersion: '2025-09-30.clover' as Stripe.LatestApiVersion,
  })
  let db: MemoryDb
  let stripe: {
    webhooks: Stripe['webhooks']
    transfers: { create: jest.Mock }
    paymentIntents: { retrieve: jest.Mock }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET
    db = new MemoryDb()
    stripe = {
      webhooks: {
        constructEvent: jest.fn((body: string, signature: string, secret: string) =>
          verifier.webhooks.constructEvent(body, signature, secret)
        ),
      } as unknown as Stripe['webhooks'],
      transfers: {
        create: jest.fn().mockResolvedValue({ id: 'tr_builder' }),
      },
      paymentIntents: {
        retrieve: jest.fn(),
      },
    }
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
    ;(allowWebhookRequest as jest.Mock).mockResolvedValue(true)
    ;(getWebhookRateLimitKey as jest.Mock).mockImplementation((platform: string) => `${platform}:test`)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  afterAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = originalPlatformSecret
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = originalConnectSecret
  })

  it('processes a signed kickback invoice once and skips duplicate delivery', async () => {
    const fixture = loadFixture('invoice_paid_kickback')
    jest.useFakeTimers().setSystemTime(new Date((fixture.timestamp + 10) * 1000))

    const first = await stripePlatformWebhookPost(makeWebhookRequest('/api/webhooks/stripe', fixture))
    expect(first.status).toBe(200)
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1)
    expect(sendBuilderPaidEmail).toHaveBeenCalledWith({ paymentId: 'payment-1' })
    expect(db.rows.kickback_payments[0]).toMatchObject({
      status: 'paid',
      stripe_transfer_id: 'tr_builder',
      builder_payout_cents: 51360,
    })
    expect(db.rows.stripe_webhook_events).toHaveLength(1)
    expect(db.rows.stripe_webhook_events[0]).toMatchObject({
      stripe_event_id: 'evt_fixture_invoice_paid_kickback',
      processed: true,
      processing_outcome: 'processed',
    })

    const second = await stripePlatformWebhookPost(makeWebhookRequest('/api/webhooks/stripe', fixture))
    const secondBody = await second.json()

    expect(second.status).toBe(200)
    expect(secondBody).toMatchObject({ received: true, duplicate: true })
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1)
    expect(db.rows.stripe_webhook_events).toHaveLength(1)
    expect(db.rows.stripe_webhook_events[0]).toMatchObject({ duplicate_count: 1 })
    expect(applyInvoicePayment).not.toHaveBeenCalled()
    expect(applyInvoicePaymentFailed).not.toHaveBeenCalled()
    expect(applyCheckoutSessionCompleted).not.toHaveBeenCalled()
  })

  it('processes a signed Connect account fixture once and skips duplicate delivery', async () => {
    const fixture = loadFixture('account_updated_charges_enabled')
    jest.useFakeTimers().setSystemTime(new Date((fixture.timestamp + 10) * 1000))

    const first = await stripeConnectWebhookPost(makeWebhookRequest('/api/webhooks/stripe/connect', fixture))
    expect(first.status).toBe(200)
    expect(saveBuilderStripeAccount).toHaveBeenCalledTimes(1)
    expect(saveVendorStripeAccount).not.toHaveBeenCalled()
    expect(saveVenueStripeAccount).not.toHaveBeenCalled()
    expect(db.rows.stripe_webhook_events).toHaveLength(1)
    expect(db.rows.stripe_webhook_events[0]).toMatchObject({
      stripe_event_id: 'evt_fixture_account_active',
      source: 'connect',
      processed: true,
      processing_outcome: 'processed',
    })

    const second = await stripeConnectWebhookPost(makeWebhookRequest('/api/webhooks/stripe/connect', fixture))
    const secondBody = await second.json()

    expect(second.status).toBe(200)
    expect(secondBody).toMatchObject({ received: true, duplicate: true })
    expect(saveBuilderStripeAccount).toHaveBeenCalledTimes(1)
    expect(db.rows.stripe_webhook_events).toHaveLength(1)
    expect(db.rows.stripe_webhook_events[0]).toMatchObject({ duplicate_count: 1 })
    expect(applyPlannerStripePaymentIntentWebhook).not.toHaveBeenCalled()
    expect(applyPlannerStripeRefundWebhook).not.toHaveBeenCalled()
    expect(sendRefundCompletedEmail).not.toHaveBeenCalled()
    expect(sendVenuePaymentFailedEmail).not.toHaveBeenCalled()
  })

  it('leaves a failed planner refund update retriable and completes its redelivery', async () => {
    const timestamp = 1_800_000_300
    const body = JSON.stringify({
      id: 'evt_planner_refund_db_retry',
      object: 'event',
      api_version: '2025-09-30.clover',
      created: timestamp,
      livemode: false,
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_planner_refund_db_retry',
          object: 'charge',
          payment_intent: 'pi_planner_refund_db_retry',
          amount_captured: 12_500,
          amount_refunded: 2_500,
          currency: 'usd',
          refunded: false,
          metadata: { payment_kind: 'planner_deposit' },
          refunds: { data: [] },
        },
      },
    })
    const fixture = {
      timestamp,
      body,
      signature: verifier.webhooks.generateTestHeaderString({
        payload: body,
        secret: TEST_WEBHOOK_SECRET,
        timestamp,
      }),
    }
    jest.useFakeTimers().setSystemTime(new Date((timestamp + 10) * 1000))
    ;(applyPlannerStripeRefundWebhook as jest.Mock)
      .mockRejectedValueOnce(new Error('planner refund update unavailable'))
      .mockResolvedValueOnce(true)

    const first = await stripePlatformWebhookPost(
      makeWebhookRequest('/api/webhooks/stripe', fixture)
    )

    expect(first.status).toBe(500)
    expect(await first.json()).toEqual({ received: true, processed: false })
    expect(db.rows.stripe_webhook_events[0]).toMatchObject({
      stripe_event_id: 'evt_planner_refund_db_retry',
      processed: false,
      in_flight: false,
      processing_outcome: 'failed',
      last_error: 'planner refund update unavailable',
    })

    const second = await stripePlatformWebhookPost(
      makeWebhookRequest('/api/webhooks/stripe', fixture)
    )

    expect(second.status).toBe(200)
    expect(applyPlannerStripeRefundWebhook).toHaveBeenCalledTimes(2)
    expect(applyPlannerStripeRefundWebhook).toHaveBeenCalledWith(
      expect.anything(),
      'pi_planner_refund_db_retry',
      {
        chargeAmountCapturedCents: 12_500,
        refundedAmountCents: 2_500,
        currency: 'usd',
        eventId: 'evt_planner_refund_db_retry',
        fullyRefunded: false,
      },
      true
    )
    expect(db.rows.stripe_webhook_events).toHaveLength(1)
    expect(db.rows.stripe_webhook_events[0]).toMatchObject({
      processed: true,
      in_flight: false,
      processing_outcome: 'processed',
      last_error: null,
    })
  })

  it('keeps a planner-tagged missing-local PaymentIntent event retriable', async () => {
    const timestamp = 1_800_000_400
    const body = JSON.stringify({
      id: 'evt_planner_missing_local_retry',
      object: 'event',
      api_version: '2025-09-30.clover',
      created: timestamp,
      livemode: false,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_planner_missing_local_retry',
          object: 'payment_intent',
          status: 'succeeded',
          metadata: {
            payment_kind: 'planner_deposit',
            planner_payment_intent_id: 'payment-intent-missing-local',
          },
        },
      },
    })
    const fixture = {
      timestamp,
      body,
      signature: verifier.webhooks.generateTestHeaderString({
        payload: body,
        secret: TEST_WEBHOOK_SECRET,
        timestamp,
      }),
    }
    jest.useFakeTimers().setSystemTime(new Date((timestamp + 10) * 1000))
    ;(applyPlannerStripePaymentIntentWebhook as jest.Mock)
      .mockRejectedValueOnce(new Error('Planner deposit webhook has no matching local payment'))
      .mockResolvedValueOnce(true)

    const first = await stripePlatformWebhookPost(
      makeWebhookRequest('/api/webhooks/stripe', fixture)
    )
    expect(first.status).toBe(500)
    expect(db.rows.stripe_webhook_events[0]).toMatchObject({
      processed: false,
      processing_outcome: 'failed',
      last_error: 'Planner deposit webhook has no matching local payment',
    })

    const second = await stripePlatformWebhookPost(
      makeWebhookRequest('/api/webhooks/stripe', fixture)
    )
    expect(second.status).toBe(200)
    expect(applyPlannerStripePaymentIntentWebhook).toHaveBeenCalledTimes(2)
    expect(db.rows.stripe_webhook_events).toHaveLength(1)
    expect(db.rows.stripe_webhook_events[0]).toMatchObject({
      processed: true,
      processing_outcome: 'processed',
    })
  })

  it('routes a signed amount-capturable update to planner authorization reconciliation', async () => {
    const timestamp = 1_800_000_500
    const paymentIntent = {
      id: 'pi_planner_amount_capturable',
      object: 'payment_intent',
      status: 'requires_capture',
      amount: 12_500,
      currency: 'usd',
      capture_method: 'manual',
      metadata: {
        payment_kind: 'planner_deposit',
        planner_payment_intent_id: 'payment-intent-amount-capturable',
        plan_id: 'plan-amount-capturable',
        approval_id: 'approval-amount-capturable',
        partner_kind: 'venue',
        partner_id: 'venue-amount-capturable',
        platform_fee_cents: '500',
      },
    }
    const body = JSON.stringify({
      id: 'evt_planner_amount_capturable',
      object: 'event',
      api_version: '2025-09-30.clover',
      created: timestamp,
      livemode: false,
      type: 'payment_intent.amount_capturable_updated',
      data: { object: paymentIntent },
    })
    const fixture = {
      timestamp,
      body,
      signature: verifier.webhooks.generateTestHeaderString({
        payload: body,
        secret: TEST_WEBHOOK_SECRET,
        timestamp,
      }),
    }
    jest.useFakeTimers().setSystemTime(new Date((timestamp + 10) * 1000))
    ;(applyPlannerStripePaymentIntentWebhook as jest.Mock).mockResolvedValueOnce(true)

    const response = await stripePlatformWebhookPost(
      makeWebhookRequest('/api/webhooks/stripe', fixture)
    )

    expect(response.status).toBe(200)
    expect(applyPlannerStripePaymentIntentWebhook).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining(paymentIntent)
    )
    expect(db.rows.stripe_webhook_events[0]).toMatchObject({
      stripe_event_id: 'evt_planner_amount_capturable',
      processed: true,
      processing_outcome: 'processed',
    })
  })
})
