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

import { POST as postPlatformFee } from '@/app/api/payments/platform-fee/route'
import { POST as postRefund } from '@/app/api/payments/refund/route'
import { POST as postBulkRefund } from '@/app/api/payments/refund/process/route'
import { getAuthenticatedBuilderBillingProfile, ensureStripeCustomerForBuilder, upsertBuilderSubscription } from '@/lib/billing/builder-billing'
import { calculateBookingRefund } from '@/lib/payments/refund-calculator'
import { getAuthenticatedBuilderForBooking, getVendorBookingForPayment } from '@/lib/payments/vendor-payments'
import { sendEmailNotification } from '@/lib/email'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'
import { getStripeClient } from '@/lib/stripe/connect'

jest.mock('@/lib/billing/builder-billing', () => ({
  BUILDER_BILLING_PRICES: {
    payPerEventAmount: 10,
  },
  ensureStripeCustomerForBuilder: jest.fn(),
  getAuthenticatedBuilderBillingProfile: jest.fn(),
  upsertBuilderSubscription: jest.fn(),
}))

jest.mock('@/lib/payments/refund-calculator', () => ({
  calculateBookingRefund: jest.fn(),
}))

jest.mock('@/lib/payments/vendor-payments', () => {
  const actual = jest.requireActual('@/lib/payments/vendor-payments')
  return {
    ...actual,
    getAuthenticatedBuilderForBooking: jest.fn(),
    getVendorBookingForPayment: jest.fn(),
  }
})

jest.mock('@/lib/email', () => ({
  sendEmailNotification: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/supabase/server-helpers', () => ({
  getBuilderProfileId: jest.fn(),
}))

jest.mock('@/lib/stripe/connect', () => ({
  getStripeClient: jest.fn(),
}))

type Row = Record<string, unknown>

const USER_ID = '11111111-1111-4111-8111-111111111111'
const BUILDER_ID = '22222222-2222-4222-8222-222222222222'
const BOOKING_ID = '33333333-3333-4333-8333-333333333333'
const VENDOR_ID = '44444444-4444-4444-8444-444444444444'
const VENDOR_TX_ID = '55555555-5555-4555-8555-555555555555'
const PLATFORM_TX_ID = '66666666-6666-4666-8666-666666666666'
const APPROVAL_ID = '77777777-7777-4777-8777-777777777777'
const PLATFORM_APPROVAL_ID = '88888888-8888-4888-8888-888888888888'

class MemoryDb {
  rows: Record<string, Row[]> = {
    vendor_bookings: [
      {
        id: BOOKING_ID,
        vendor_id: VENDOR_ID,
        event_id: 'event-1',
        organizer_id: USER_ID,
        status: 'confirmed',
        events: { builder_id: BUILDER_ID },
      },
    ],
    builder_subscriptions: [
      {
        builder_id: BUILDER_ID,
        plan_type: 'starter',
        status: 'active',
        stripe_customer_id: 'cus_builder',
      },
    ],
    approvals: [
      makeApproval({
        id: APPROVAL_ID,
        requested_amount_cents: 10000,
        agent_action: {
          id: 'agent-action-1',
          target_type: 'vendor_transaction',
          target_id: VENDOR_TX_ID,
          payload_json: { transaction_id: VENDOR_TX_ID },
        },
      }),
      makeApproval({
        id: PLATFORM_APPROVAL_ID,
        requested_amount_cents: 1000,
        agent_action: {
          id: 'agent-action-2',
          target_type: 'platform_fee_transaction',
          target_id: PLATFORM_TX_ID,
          payload_json: { platform_fee_transaction_id: PLATFORM_TX_ID },
        },
      }),
    ],
    vendor_transactions: [
      {
        id: VENDOR_TX_ID,
        booking_id: BOOKING_ID,
        vendor_id: VENDOR_ID,
        builder_id: BUILDER_ID,
        stripe_payment_intent_id: 'pi_vendor',
        stripe_transfer_id: 'tr_vendor',
        amount: 100,
        amount_cents: 10000,
        vendor_payout: 90,
        vendor_payout_cents: 9000,
        payment_type: 'service_payment',
        status: 'succeeded',
      },
    ],
    platform_fee_transactions: [
      {
        id: PLATFORM_TX_ID,
        booking_id: BOOKING_ID,
        builder_id: BUILDER_ID,
        stripe_payment_intent_id: 'pi_platform',
        amount: 10,
        amount_cents: 1000,
        status: 'succeeded',
      },
    ],
    audit_logs: [],
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }

  async rpc() {
    return { data: null, error: null }
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'select' | 'insert' | 'update' = 'select'
  private payload: Row | null = null
  private rowLimit: number | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select() {
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

  neq(field: string, value: unknown) {
    this.filters.push((row) => row[field] !== value)
    return this
  }

  gt(field: string, value: number) {
    this.filters.push((row) => Number(row[field]) > value)
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
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private execute() {
    if (this.operation === 'insert') {
      const row = { id: `${this.table}-${this.db.rows[this.table].length + 1}`, ...this.payload }
      this.db.rows[this.table].push(row)
      return { data: [row], error: null }
    }

    if (this.operation === 'update') {
      const rows = this.applyFilters()
      rows.forEach((row) => Object.assign(row, this.payload))
      return { data: rows, error: null }
    }

    return { data: this.applyFilters(), error: null }
  }

  private applyFilters() {
    let rows = this.db.rows[this.table].filter((row) => this.filters.every((filter) => filter(row)))
    if (this.rowLimit !== null) rows = rows.slice(0, this.rowLimit)
    return rows
  }
}

function makeApproval(overrides: Row = {}) {
  return {
    id: APPROVAL_ID,
    plan_id: 'plan-1',
    agent_action_id: 'agent-action-1',
    status: 'authorized',
    requested_amount_cents: 10000,
    authorized_amount_cents: null,
    price_cents: null,
    expires_at: null,
    snapshot_hash: null,
    provider: 'stripe',
    ...overrides,
  }
}

function makeRequest(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

describe('legacy money route approval gates', () => {
  let db: MemoryDb
  let stripe: {
    customers: { update: jest.Mock }
    paymentIntents: { create: jest.Mock }
    refunds: { create: jest.Mock }
    transfers: { createReversal: jest.Mock }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    db = new MemoryDb()
    stripe = {
      customers: { update: jest.fn().mockResolvedValue({ id: 'cus_builder' }) },
      paymentIntents: { create: jest.fn().mockResolvedValue({ id: 'pi_platform_new', status: 'succeeded' }) },
      refunds: { create: jest.fn().mockResolvedValue({ id: 're_vendor' }) },
      transfers: { createReversal: jest.fn().mockResolvedValue({ id: 'trr_vendor' }) },
    }
    ;(createClient as jest.Mock).mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
    })
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
    ;(getAuthenticatedBuilderBillingProfile as jest.Mock).mockResolvedValue({
      user: { id: USER_ID, email: 'builder@example.com' },
      builder: { id: BUILDER_ID, stripe_customer_id: 'cus_builder' },
      status: 200,
      error: null,
    })
    ;(ensureStripeCustomerForBuilder as jest.Mock).mockResolvedValue('cus_builder')
    ;(upsertBuilderSubscription as jest.Mock).mockResolvedValue(null)
    ;(getVendorBookingForPayment as jest.Mock).mockResolvedValue(db.rows.vendor_bookings[0])
    ;(getAuthenticatedBuilderForBooking as jest.Mock).mockResolvedValue({
      user: { id: USER_ID },
      builderProfileId: BUILDER_ID,
      authorized: true,
      error: null,
      status: 200,
    })
    ;(getBuilderProfileId as jest.Mock).mockResolvedValue({ builderProfileId: BUILDER_ID, error: null })
    ;(calculateBookingRefund as jest.Mock).mockResolvedValue({
      platform_fee_refund: 10,
      vendor_service_refund: 100,
      total_refund: 110,
    })
    ;(sendEmailNotification as jest.Mock).mockResolvedValue({ sent: true })
  })

  it('rejects platform fee charge when approval_id is missing', async () => {
    const response = await postPlatformFee(makeRequest('http://localhost/api/payments/platform-fee', {
      bookingId: BOOKING_ID,
      paymentMethodId: 'pm_card',
    }))
    const json = await response.json()

    expect(response.status).toBe(422)
    expect(json.code).toBe('APPROVAL_MISSING')
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled()
  })

  it('rejects platform fee charge when approval amount changed', async () => {
    db.rows.approvals[1].requested_amount_cents = 900

    const response = await postPlatformFee(makeRequest('http://localhost/api/payments/platform-fee', {
      bookingId: BOOKING_ID,
      approval_id: PLATFORM_APPROVAL_ID,
      paymentMethodId: 'pm_card',
    }))
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.code).toBe('APPROVAL_AMOUNT_MISMATCH')
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled()
  })

  it('rejects direct refund when approval targets a different transaction', async () => {
    db.rows.approvals[0].agent_action = {
      id: 'agent-action-1',
      target_type: 'vendor_transaction',
      target_id: '99999999-9999-4999-8999-999999999999',
      payload_json: {},
    }

    const response = await postRefund(makeRequest('http://localhost/api/payments/refund', {
      transactionId: VENDOR_TX_ID,
      approval_id: APPROVAL_ID,
      amount: 100,
    }))
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.code).toBe('APPROVAL_COUNTERPARTY_MISMATCH')
    expect(stripe.refunds.create).not.toHaveBeenCalled()
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled()
  })

  it('rejects bulk cancellation refund without per-transaction approvals', async () => {
    const response = await postBulkRefund(makeRequest('http://localhost/api/payments/refund/process', {
      bookingId: BOOKING_ID,
      reason: 'Cancelled by host',
      refund_approvals: [],
    }))
    const json = await response.json()

    expect(response.status).toBe(422)
    expect(json.code).toBe('APPROVAL_MISSING')
    expect(stripe.refunds.create).not.toHaveBeenCalled()
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled()
  })

  it('executes direct refund with a valid transaction approval and writes audit metadata', async () => {
    const response = await postRefund(makeRequest('http://localhost/api/payments/refund', {
      transactionId: VENDOR_TX_ID,
      approval_id: APPROVAL_ID,
      amount: 100,
    }))

    expect(response.status).toBe(200)
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 10000,
        metadata: expect.objectContaining({ approval_id: APPROVAL_ID }),
      }),
      expect.objectContaining({
        idempotencyKey: `vendor_refund_${APPROVAL_ID}_${VENDOR_TX_ID}_10000`,
      })
    )
    expect(db.rows.vendor_transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        payment_type: 'refund',
        approval_id: APPROVAL_ID,
      }),
    ]))
    expect(db.rows.audit_logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'payment.vendor_refund.executed',
        after_state: expect.objectContaining({
          approval_id: APPROVAL_ID,
          amount_cents: 10000,
          stripe_object_id: 're_vendor',
        }),
      }),
    ]))
  })
})
