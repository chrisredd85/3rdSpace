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

import { POST as stripePlatformWebhookPost } from '@/app/api/webhooks/stripe/route'
import { POST as stripeConnectWebhookPost } from '@/app/api/webhooks/stripe/connect/route'
import { applyCheckoutSessionCompleted, applyInvoicePayment, applyInvoicePaymentFailed } from '@/lib/billing/builder-billing'
import { applyPlannerStripePaymentIntentWebhook, applyPlannerStripeRefundWebhook } from '@/lib/planner/depositPayments'
import { allowWebhookRequest, getWebhookRateLimitKey } from '@/lib/server/webhook-rate-limit'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  getStripeClient,
  saveBuilderStripeAccount,
  saveVendorStripeAccount,
  saveVenueStripeAccount,
} from '@/lib/stripe/connect'

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
  saveBuilderStripeAccount: jest.fn().mockResolvedValue({}),
  saveVendorStripeAccount: jest.fn().mockResolvedValue({}),
  saveVenueStripeAccount: jest.fn().mockResolvedValue({}),
}))

type Row = Record<string, unknown>

class MemoryDb {
  rows: Record<string, Row[]> = {
    vendor_stripe_accounts: [],
    venue_stripe_accounts: [],
    builder_stripe_accounts: [
      {
        user_id: 'builder-user-1',
        builder_id: 'builder-profile-1',
        stripe_account_id: 'acct_builder',
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

function makeWebhookRequest(path: string, withSignature = true) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: withSignature ? { 'stripe-signature': 'sig_test' } : {},
    body: '{}',
  }) as never
}

describe('Stripe platform and Connect webhook routes', () => {
  const originalPlatformSecret = process.env.STRIPE_WEBHOOK_SECRET
  const originalConnectSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  let db: MemoryDb
  let stripe: { webhooks: { constructEvent: jest.Mock } }
  let event: any

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform_test'
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_test'
    db = new MemoryDb()
    stripe = {
      webhooks: {
        constructEvent: jest.fn(() => event),
      },
    }
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
    ;(allowWebhookRequest as jest.Mock).mockResolvedValue(true)
    ;(getWebhookRateLimitKey as jest.Mock).mockImplementation((platform: string) => `${platform}:test`)
  })

  afterAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = originalPlatformSecret
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = originalConnectSecret
  })

  it('verifies platform webhooks with the platform signing secret when both secrets are present', async () => {
    event = {
      type: 'payout.paid',
      data: { object: { id: 'po_platform' } },
    }

    const response = await stripePlatformWebhookPost(makeWebhookRequest('/api/webhooks/stripe'))

    expect(response.status).toBe(200)
    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith('{}', 'sig_test', 'whsec_platform_test')
    expect(getWebhookRateLimitKey).toHaveBeenCalledWith('stripe', expect.any(Headers))
    expect(applyCheckoutSessionCompleted).not.toHaveBeenCalled()
    expect(applyInvoicePayment).not.toHaveBeenCalled()
    expect(applyInvoicePaymentFailed).not.toHaveBeenCalled()
    expect(applyPlannerStripePaymentIntentWebhook).not.toHaveBeenCalled()
    expect(applyPlannerStripeRefundWebhook).not.toHaveBeenCalled()
  })

  it('verifies Connect webhooks with the Connect signing secret and syncs builder accounts', async () => {
    const account = {
      id: 'acct_builder',
      charges_enabled: true,
      payouts_enabled: true,
      requirements: {
        currently_due: [],
        eventually_due: [],
        past_due: [],
        pending_verification: [],
        disabled_reason: null,
      },
    }
    event = {
      type: 'account.updated',
      data: { object: account },
    }

    const response = await stripeConnectWebhookPost(makeWebhookRequest('/api/webhooks/stripe/connect'))

    expect(response.status).toBe(200)
    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith('{}', 'sig_test', 'whsec_connect_test')
    expect(getWebhookRateLimitKey).toHaveBeenCalledWith('stripe-connect', expect.any(Headers))
    expect(saveBuilderStripeAccount).toHaveBeenCalledWith(db, 'builder-user-1', 'builder-profile-1', account)
    expect(saveVendorStripeAccount).not.toHaveBeenCalled()
    expect(saveVenueStripeAccount).not.toHaveBeenCalled()
  })

  it('rejects Connect webhook requests without a Stripe signature', async () => {
    event = {
      type: 'account.updated',
      data: { object: { id: 'acct_builder' } },
    }

    const response = await stripeConnectWebhookPost(makeWebhookRequest('/api/webhooks/stripe/connect', false))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Missing Stripe signature' })
    expect(stripe.webhooks.constructEvent).not.toHaveBeenCalled()
  })
})
