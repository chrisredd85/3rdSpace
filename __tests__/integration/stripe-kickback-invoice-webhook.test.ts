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

import { POST } from '@/app/api/webhooks/stripe/route'
import { applyInvoicePayment, applyInvoicePaymentFailed } from '@/lib/billing/builder-billing'
import { applyPlannerStripeRefundWebhook } from '@/lib/planner/depositPayments'
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

class MemoryDb {
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

describe('Stripe kickback invoice webhook routing', () => {
  let db: MemoryDb
  let stripe: any
  let event: any
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    db = new MemoryDb()
    stripe = {
      webhooks: {
        constructEvent: jest.fn(() => event),
      },
      transfers: {
        create: jest.fn().mockResolvedValue({ id: 'tr_builder' }),
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
    expect(stripe.transfers.create).toHaveBeenCalledWith({
      amount: 51360,
      currency: 'usd',
      destination: 'acct_builder',
      transfer_group: `kickback_${PAYMENT_ID}`,
      metadata: {
        payment_kind_namespace: 'venue_builder_kickback',
        kickback_payment_id: PAYMENT_ID,
        settlement_method: 'invoice',
      },
    })
    expect(applyInvoicePayment).not.toHaveBeenCalled()
    expect(sendBuilderPaidEmail).toHaveBeenCalledWith({ paymentId: PAYMENT_ID })
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
