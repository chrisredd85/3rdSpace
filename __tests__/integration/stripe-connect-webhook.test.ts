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

import { POST as POST_CONNECT } from '@/app/api/webhooks/stripe/connect/route'
import { POST as POST_PLATFORM } from '@/app/api/webhooks/stripe/route'
import { applyInvoicePayment } from '@/lib/billing/builder-billing'
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

jest.mock('@/lib/payments/venue-rental', () => ({
  VENUE_RENTAL_PAYMENT_NAMESPACE: 'venue_rental',
  getVenueRentalTransactionId: jest.fn(),
  isVenueRentalEvent: jest.fn(() => false),
  loadVenueRentalTransaction: jest.fn(),
  markVenueRentalFailed: jest.fn(),
  markVenueRentalPaid: jest.fn(),
  markVenueRentalRefunded: jest.fn(),
  markVenueRentalTransferComplete: jest.fn(),
  markVenueRentalTransferReversed: jest.fn(),
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
  getStripeAccountStatus: jest.fn((account: any) => {
    if (account.charges_enabled && account.payouts_enabled) return 'active'
    if (account.requirements?.disabled_reason || account.requirements?.past_due?.length) return 'restricted'
    return 'pending'
  }),
  getStripeRequirementsDue: jest.fn((account: any) => ({
    currently_due: account.requirements?.currently_due ?? [],
    eventually_due: account.requirements?.eventually_due ?? [],
    past_due: account.requirements?.past_due ?? [],
    pending_verification: account.requirements?.pending_verification ?? [],
    disabled_reason: account.requirements?.disabled_reason ?? null,
  })),
  saveBuilderStripeAccount: jest.fn(),
  saveVendorStripeAccount: jest.fn(),
  saveVenueStripeAccount: jest.fn(),
}))

type Row = Record<string, any>

class MemoryDb {
  rows: Record<string, Row[]> = {
    venue_stripe_accounts: [
      {
        owner_id: 'venue-owner-1',
        stripe_account_id: 'acct_venue',
        account_status: 'pending',
        charges_enabled: false,
        payouts_enabled: false,
        requirements_due: {},
        updated_at: '2026-05-01T00:00:00.000Z',
      },
    ],
    vendor_stripe_accounts: [
      {
        vendor_id: 'vendor-1',
        stripe_account_id: 'acct_vendor',
        account_status: 'pending',
        charges_enabled: false,
        payouts_enabled: false,
        requirements_due: {},
        updated_at: '2026-05-01T00:00:00.000Z',
      },
    ],
    builder_stripe_accounts: [
      {
        user_id: 'builder-user-1',
        builder_id: 'builder-1',
        stripe_account_id: 'acct_builder',
        account_status: 'pending',
        charges_enabled: false,
        payouts_enabled: false,
        requirements_due: {},
        updated_at: '2026-05-01T00:00:00.000Z',
      },
    ],
    owner_profiles: [
      {
        user_id: 'venue-owner-1',
        stripe_account_id: null,
        payout_enabled: false,
      },
    ],
    vendor_profiles: [
      {
        id: 'vendor-1',
        stripe_account_id: null,
        payout_enabled: false,
      },
    ],
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }

  rpc() {
    return Promise.resolve({ data: true, error: null })
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

function makeRequest(path: string, signature = 'sig_valid') {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    body: JSON.stringify({}),
  }) as never
}

function makeAccount(id: string, overrides: Row = {}) {
  return {
    id,
    object: 'account',
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    requirements: {
      currently_due: [],
      eventually_due: [],
      past_due: [],
      pending_verification: [],
      disabled_reason: null,
    },
    capabilities: {
      card_payments: 'active',
      transfers: 'active',
    },
    ...overrides,
  }
}

async function responseJson(response: Response) {
  return response.json() as Promise<Row>
}

describe('Stripe Connect webhook', () => {
  let db: MemoryDb
  let stripe: any
  let event: any
  const originalConnectSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  const originalPlatformSecret = process.env.STRIPE_WEBHOOK_SECRET

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform'

    db = new MemoryDb()
    stripe = {
      webhooks: {
        constructEvent: jest.fn((_body: string, signature: string, secret: string) => {
          if (signature === 'sig_invalid') {
            throw new Error('invalid signature')
          }

          if (secret !== 'whsec_connect' && secret !== 'whsec_platform') {
            throw new Error('wrong webhook secret')
          }

          return event
        }),
      },
    }
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
    ;(allowWebhookRequest as jest.Mock).mockResolvedValue(true)
    ;(getWebhookRateLimitKey as jest.Mock).mockImplementation((platform: string) => `${platform}:test`)
  })

  afterAll(() => {
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = originalConnectSecret
    process.env.STRIPE_WEBHOOK_SECRET = originalPlatformSecret
  })

  it('rejects invalid Connect webhook signatures using the Connect secret', async () => {
    event = {
      id: 'evt_bad_sig',
      type: 'account.updated',
      account: 'acct_vendor',
      data: { object: makeAccount('acct_vendor') },
    }

    const response = await POST_CONNECT(makeRequest('/api/webhooks/stripe/connect', 'sig_invalid'))

    expect(response.status).toBe(400)
    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
      expect.any(String),
      'sig_invalid',
      'whsec_connect'
    )
    expect(await responseJson(response)).toEqual({ error: 'Invalid Stripe signature' })
  })

  it.each([
    {
      kind: 'venue',
      accountId: 'acct_venue',
      table: 'venue_stripe_accounts',
      profileTable: 'owner_profiles',
      profileIdField: 'user_id',
      profileId: 'venue-owner-1',
    },
    {
      kind: 'vendor',
      accountId: 'acct_vendor',
      table: 'vendor_stripe_accounts',
      profileTable: 'vendor_profiles',
      profileIdField: 'id',
      profileId: 'vendor-1',
    },
    {
      kind: 'builder',
      accountId: 'acct_builder',
      table: 'builder_stripe_accounts',
      profileTable: null,
      profileIdField: null,
      profileId: null,
    },
  ])('updates $kind Stripe account rows from account.updated', async (scenario) => {
    event = {
      id: `evt_${scenario.kind}_account_updated`,
      type: 'account.updated',
      account: scenario.accountId,
      data: { object: makeAccount(scenario.accountId) },
    }

    const response = await POST_CONNECT(makeRequest('/api/webhooks/stripe/connect'))

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      received: true,
      handled: true,
      accountId: scenario.accountId,
      accountKind: scenario.kind,
    })

    const row = db.rows[scenario.table][0]
    expect(row).toMatchObject({
      account_status: 'active',
      charges_enabled: true,
      payouts_enabled: true,
    })
    expect(row.requirements_due).toMatchObject({
      details_submitted: true,
      disabled_reason: null,
      capabilities: {
        card_payments: 'active',
        transfers: 'active',
      },
    })
    expect(row.requirements_due.last_synced_at).toEqual(expect.any(String))
    expect(row.updated_at).toEqual(expect.any(String))

    if (scenario.profileTable) {
      const profile = db.rows[scenario.profileTable].find((candidate) => {
        return candidate[scenario.profileIdField as string] === scenario.profileId
      })
      expect(profile).toMatchObject({
        stripe_account_id: scenario.accountId,
        payout_enabled: true,
      })
    }
  })

  it('updates granular capability flags from capability.updated', async () => {
    db.rows.vendor_stripe_accounts[0].requirements_due = {
      capabilities: { transfers: 'pending' },
    }
    event = {
      id: 'evt_capability_updated',
      type: 'capability.updated',
      account: 'acct_vendor',
      data: {
        object: {
          id: 'card_payments',
          object: 'capability',
          account: 'acct_vendor',
          status: 'active',
        },
      },
    }

    const response = await POST_CONNECT(makeRequest('/api/webhooks/stripe/connect'))

    expect(response.status).toBe(200)
    expect(db.rows.vendor_stripe_accounts[0].requirements_due).toMatchObject({
      capabilities: {
        transfers: 'pending',
        card_payments: 'active',
      },
      last_capability_event: {
        id: 'card_payments',
        status: 'active',
        updated_at: expect.any(String),
      },
      last_synced_at: expect.any(String),
    })
  })

  it.each([
    ['payout.created', 'pending'],
    ['payout.paid', 'paid'],
  ])('records %s payout state without inserting duplicate rows', async (eventType, status) => {
    event = {
      id: `evt_${eventType}`,
      type: eventType,
      account: 'acct_vendor',
      data: {
        object: {
          id: 'po_123',
          object: 'payout',
          status,
          amount: 45000,
          currency: 'usd',
          arrival_date: 1780000000,
        },
      },
    }

    await POST_CONNECT(makeRequest('/api/webhooks/stripe/connect'))
    const response = await POST_CONNECT(makeRequest('/api/webhooks/stripe/connect'))

    expect(response.status).toBe(200)
    expect(db.rows.vendor_stripe_accounts).toHaveLength(1)
    expect(db.rows.vendor_stripe_accounts[0].requirements_due).toMatchObject({
      latest_payout: {
        id: 'po_123',
        status,
        amount: 45000,
        currency: 'usd',
        event_type: eventType,
      },
      last_synced_at: expect.any(String),
    })
  })

  it('marks the connected account restricted when payout.failed arrives', async () => {
    event = {
      id: 'evt_payout_failed',
      type: 'payout.failed',
      account: 'acct_venue',
      data: {
        object: {
          id: 'po_failed',
          object: 'payout',
          status: 'failed',
          amount: 80000,
          currency: 'usd',
          failure_code: 'account_closed',
          failure_message: 'Bank account closed',
        },
      },
    }

    const response = await POST_CONNECT(makeRequest('/api/webhooks/stripe/connect'))

    expect(response.status).toBe(200)
    expect(db.rows.venue_stripe_accounts[0]).toMatchObject({
      account_status: 'restricted',
      payouts_enabled: false,
    })
    expect(db.rows.venue_stripe_accounts[0].requirements_due).toMatchObject({
      disabled_reason: 'Bank account closed',
      latest_payout: {
        id: 'po_failed',
        status: 'failed',
        amount: 80000,
        failure_code: 'account_closed',
        failure_message: 'Bank account closed',
        event_type: 'payout.failed',
      },
    })
    expect(db.rows.owner_profiles[0]).toMatchObject({
      stripe_account_id: 'acct_venue',
      payout_enabled: false,
    })
  })

  it('ignores platform-side events delivered to the Connect endpoint', async () => {
    event = {
      id: 'evt_platform_checkout',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_platform', metadata: {} } },
    }

    const response = await POST_CONNECT(makeRequest('/api/webhooks/stripe/connect'))

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      received: true,
      ignored: true,
      reason: 'unsupported_connect_event',
      event_type: 'checkout.session.completed',
    })
    expect(db.rows.vendor_stripe_accounts[0].updated_at).toBe('2026-05-01T00:00:00.000Z')
  })

  it('keeps account-scoped Connect events out of the platform webhook route', async () => {
    event = {
      id: 'evt_connect_on_platform',
      type: 'account.updated',
      account: 'acct_vendor',
      data: { object: makeAccount('acct_vendor') },
    }

    const response = await POST_PLATFORM(makeRequest('/api/webhooks/stripe', 'sig_valid'))

    expect(response.status).toBe(200)
    expect(await responseJson(response)).toMatchObject({
      received: true,
      ignored: true,
      reason: 'connect_event_wrong_endpoint',
    })
    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
      expect.any(String),
      'sig_valid',
      'whsec_platform'
    )
    expect(saveVendorStripeAccount).not.toHaveBeenCalled()
    expect(saveVenueStripeAccount).not.toHaveBeenCalled()
    expect(saveBuilderStripeAccount).not.toHaveBeenCalled()
    expect(applyInvoicePayment).not.toHaveBeenCalled()
  })
})
