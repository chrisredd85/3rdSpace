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

import { POST } from '@/app/api/venue/kickbacks/[id]/checkout/route'
import { validateStripeConnectAccount } from '@/lib/billing/stripeConnectGuard'
import { sendVenueInvoiceEmail } from '@/lib/email'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAppBaseUrl, getAuthenticatedVenueOwner, getStripeClient } from '@/lib/stripe/connect'

jest.mock('@/lib/email', () => ({
  sendVenueInvoiceEmail: jest.fn().mockResolvedValue({ sent: true, reason: null }),
}))

jest.mock('@/lib/billing/stripeConnectGuard', () => ({
  validateStripeConnectAccount: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/stripe/connect', () => ({
  getAppBaseUrl: jest.fn(),
  getAuthenticatedVenueOwner: jest.fn(),
  getStripeClient: jest.fn(),
  isConnectedStripeAccountBlocked: jest.fn((status: string | null | undefined) =>
    status === 'restricted' || status === 'disabled'
  ),
}))

type Row = Record<string, unknown>

const PAYMENT_ID = '11111111-1111-4111-8111-111111111111'
const AGREEMENT_ID = '22222222-2222-4222-8222-222222222222'
const PLAN_ID = '33333333-3333-4333-8333-333333333333'
const EVENT_ID = '44444444-4444-4444-8444-444444444444'
const VENUE_ID = '55555555-5555-4555-8555-555555555555'
const VENUE_OWNER_ID = '66666666-6666-4666-8666-666666666666'
const BUILDER_ID = '77777777-7777-4777-8777-777777777777'

class MemoryDb {
  rows: Record<string, Row[]> = {
    kickback_payments: [
      {
        id: PAYMENT_ID,
        agreement_id: AGREEMENT_ID,
        event_id: null,
        payer_id: VENUE_OWNER_ID,
        recipient_id: BUILDER_ID,
        amount: null,
        amount_cents: 51360,
        currency: 'usd',
        status: 'pending_venue_approval',
        settlement_method: 'invoice',
      },
    ],
    event_kickback_agreements: [
      {
        id: AGREEMENT_ID,
        event_id: null,
        plan_id: PLAN_ID,
        venue_id: VENUE_ID,
        builder_id: BUILDER_ID,
        venue_owner_id: VENUE_OWNER_ID,
        actual_attendance: null,
        actual_qualified_attendance: null,
        attendance_extracted_value: null,
        attendance_proof_url: null,
        reported_revenue_cents: 428000,
        bar_revenue_share_percent: 12,
        ticket_revenue_share_percent: null,
        lift_share_percentage: null,
        per_head_amount: null,
        minimum_attendees: null,
        maximum_payout: null,
        venue_approved: null,
        venue_approved_at: null,
        disputed_at: null,
        status: 'sales_submitted',
      },
    ],
    venues: [
      {
        id: VENUE_ID,
        venue_name: 'The Roof',
        venue_type: 'restaurant',
        contact_email: 'venue@example.com',
        owner_id: VENUE_OWNER_ID,
        stripe_customer_id: null,
      },
    ],
    builder_stripe_accounts: [
      {
        user_id: BUILDER_ID,
        stripe_account_id: 'acct_builder',
        account_status: 'complete',
        payouts_enabled: true,
      },
    ],
    community_host_incentive_agreements: [],
    community_host_incentive_settlements: [],
    plans: [{ id: PLAN_ID, title: 'Tech Mixer', date_window_start: '2026-05-12' }],
    events: [{ id: EVENT_ID, event_name: 'Legacy Event', event_date: '2026-05-12' }],
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
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
      columns.forEach((column) => {
        if (!column.includes('(')) projected[column] = row[column]
      })
      return projected
    })
  }
}

function makeRequest() {
  return new Request(`http://localhost/api/venue/kickbacks/${PAYMENT_ID}/checkout`, {
    method: 'POST',
    headers: { host: 'localhost:3000' },
  }) as never
}

describe('venue kickback checkout route', () => {
  let db: MemoryDb
  let stripe: any
  const originalCHIFlag = process.env.CHI_NEW_ENGINE_ENABLED

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.CHI_NEW_ENGINE_ENABLED
    db = new MemoryDb()
    stripe = {
      customers: {
        retrieve: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'cus_venue' }),
      },
      invoiceItems: {
        create: jest.fn().mockResolvedValue({ id: 'ii_1' }),
      },
      invoices: {
        create: jest.fn().mockResolvedValue({ id: 'in_1' }),
        finalizeInvoice: jest.fn().mockResolvedValue({
          id: 'in_1',
          hosted_invoice_url: 'https://invoice.test/in_1',
          due_date: 1780000000,
        }),
        sendInvoice: jest.fn().mockResolvedValue({
          id: 'in_1',
          hosted_invoice_url: 'https://invoice.test/in_1',
          due_date: 1780000000,
        }),
      },
      checkout: {
        sessions: {
          create: jest.fn().mockResolvedValue({ id: 'cs_1', url: 'https://checkout.test/cs_1' }),
        },
      },
    }
    ;(createClient as jest.Mock).mockReturnValue({})
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(db)
    ;(getAuthenticatedVenueOwner as jest.Mock).mockResolvedValue({
      user: { id: VENUE_OWNER_ID },
      owner: { id: VENUE_OWNER_ID, email: 'owner@example.com' },
      error: null,
      status: 200,
    })
    ;(getStripeClient as jest.Mock).mockReturnValue(stripe)
    ;(getAppBaseUrl as jest.Mock).mockReturnValue('http://localhost:3000')
    ;(validateStripeConnectAccount as jest.Mock).mockResolvedValue({
      accountId: 'acct_builder',
      mismatchCleared: false,
    })
  })

  afterAll(() => {
    if (originalCHIFlag === undefined) {
      delete process.env.CHI_NEW_ENGINE_ENABLED
    } else {
      process.env.CHI_NEW_ENGINE_ENABLED = originalCHIFlag
    }
  })

  it('sends a Stripe invoice for invoice-settlement kickback payments', async () => {
    const response = await POST(makeRequest(), { params: { id: PAYMENT_ID } })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      hosted_invoice_url: 'https://invoice.test/in_1',
      checkoutUrl: 'https://invoice.test/in_1',
      principal_cents: 51360,
      processing_fee_cents: 411,
      total_due_cents: 51771,
    })
    expect(stripe.customers.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'venue@example.com',
      name: 'The Roof',
    }))
    expect(stripe.invoiceItems.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        customer: 'cus_venue',
        amount: 51360,
        description: 'Revenue share for "Tech Mixer" - 12% bar revenue share of $4280.00',
        metadata: expect.objectContaining({ settlement_method: 'invoice', item_type: 'principal' }),
      }),
      expect.objectContaining({
        idempotencyKey: `kickback_invoice_item_${PAYMENT_ID}_principal_51360`,
      })
    )
    expect(stripe.invoiceItems.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        amount: 411,
        description: 'Payment processing fee (ACH)',
      }),
      expect.objectContaining({
        idempotencyKey: `kickback_invoice_item_${PAYMENT_ID}_processing_411`,
      })
    )
    expect(stripe.invoices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection_method: 'send_invoice',
        pending_invoice_items_behavior: 'include',
        days_until_due: 7,
        metadata: expect.objectContaining({
          kickback_payment_id: PAYMENT_ID,
          settlement_method: 'invoice',
          builder_stripe_account_id: 'acct_builder',
          principal_cents: '51360',
        }),
      }),
      expect.objectContaining({
        idempotencyKey: `kickback_invoice_${PAYMENT_ID}_51360_411`,
      })
    )
    expect(db.rows.venues[0]).toMatchObject({ stripe_customer_id: 'cus_venue' })
    expect(db.rows.kickback_payments[0]).toMatchObject({
      status: 'invoice_sent',
      stripe_invoice_id: 'in_1',
      invoice_hosted_url: 'https://invoice.test/in_1',
      processing_fee_cents: 411,
    })
    expect(sendVenueInvoiceEmail).toHaveBeenCalledWith({ paymentId: PAYMENT_ID })
    expect(db.rows.event_kickback_agreements[0]).toMatchObject({
      status: 'payment_pending',
    })
  })

  it('replaces a stale venue Stripe customer when switching Stripe modes', async () => {
    db.rows.venues[0].stripe_customer_id = 'cus_test_stale'
    stripe.customers.retrieve.mockRejectedValue({
      code: 'resource_missing',
      message: "No such customer: 'cus_test_stale'; a similar object exists in test mode, but a live mode key was used to make this request.",
    })
    stripe.customers.create.mockResolvedValue({ id: 'cus_live_replacement' })

    const response = await POST(makeRequest(), { params: { id: PAYMENT_ID } })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.checkoutUrl).toBe('https://invoice.test/in_1')
    expect(stripe.customers.retrieve).toHaveBeenCalledWith('cus_test_stale')
    expect(stripe.customers.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'venue@example.com',
      name: 'The Roof',
    }))
    expect(stripe.invoiceItems.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        customer: 'cus_live_replacement',
        amount: 51360,
      }),
      expect.objectContaining({
        idempotencyKey: `kickback_invoice_item_${PAYMENT_ID}_principal_51360`,
      })
    )
    expect(stripe.invoices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_live_replacement',
      }),
      expect.objectContaining({
        idempotencyKey: `kickback_invoice_${PAYMENT_ID}_51360_411`,
      })
    )
    expect(db.rows.venues[0]).toMatchObject({ stripe_customer_id: 'cus_live_replacement' })
  })

  it('keeps legacy checkout payments on the Checkout Session path', async () => {
    db.rows.kickback_payments[0] = {
      id: PAYMENT_ID,
      agreement_id: AGREEMENT_ID,
      event_id: EVENT_ID,
      payer_id: VENUE_OWNER_ID,
      recipient_id: BUILDER_ID,
      amount: 120,
      amount_cents: null,
      currency: 'usd',
      status: 'pending',
      settlement_method: 'checkout',
    }

    const response = await POST(makeRequest(), { params: { id: PAYMENT_ID } })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      checkoutUrl: 'https://checkout.test/cs_1',
      sessionId: 'cs_1',
    })
    expect(stripe.checkout.sessions.create).toHaveBeenCalled()
    expect(stripe.invoices.create).not.toHaveBeenCalled()
    expect(sendVenueInvoiceEmail).not.toHaveBeenCalled()
    expect(db.rows.kickback_payments[0]).toMatchObject({
      status: 'processing',
      stripe_checkout_session_id: 'cs_1',
    })
  })

  it('routes eligible venues through the flagged Community Host Incentive invoice path', async () => {
    process.env.CHI_NEW_ENGINE_ENABLED = 'true'
    Object.assign(db.rows.venues[0], { venue_type: 'bar' })
    Object.assign(db.rows.event_kickback_agreements[0], {
      per_head_amount: 10,
      bar_revenue_share_percent: null,
      actual_qualified_attendance: 200,
      attendance_proof_url: 'https://storage.test/attendance.csv',
      venue_approved: true,
      venue_approved_at: '2026-06-09T12:00:00.000Z',
    })

    const response = await POST(makeRequest(), { params: { id: PAYMENT_ID } })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      hosted_invoice_url: 'https://invoice.test/in_1',
      principal_cents: 200000,
      processing_fee_cents: 500,
      total_due_cents: 200500,
      chi_agreement_id: 'community_host_incentive_agreements-1',
      chi_settlement_id: 'community_host_incentive_settlements-1',
    })
    expect(stripe.customers.create).toHaveBeenCalledWith(expect.objectContaining({
      metadata: {
        venue_id: VENUE_ID,
        payment_type: 'community_host_incentive',
      },
    }))
    expect(stripe.invoiceItems.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        amount: 200000,
        description: 'Community Host Incentive - 200 verified attendees x $10.00 = $2,000.00',
        metadata: expect.objectContaining({
          payment_type: 'community_host_incentive',
          incentive_type: 'per_verified_attendee',
          calculation_basis: 'verified_attendance',
          verified_attendees: '200',
          per_head_rate_cents: '1000',
          applied_floor: 'false',
          applied_cap: 'false',
          is_revenue_share: 'false',
          is_percentage_of_alcohol: 'false',
          is_percentage_of_pos: 'false',
          event_id: '',
          venue_id: VENUE_ID,
          organizer_id: BUILDER_ID,
          chi_agreement_id: 'community_host_incentive_agreements-1',
          chi_settlement_id: 'community_host_incentive_settlements-1',
          legacy_payment_id: PAYMENT_ID,
          builder_stripe_account_id: 'acct_builder',
          principal_cents: '200000',
          settlement_method: 'invoice',
          item_type: 'principal',
        }),
      }),
      expect.objectContaining({
        idempotencyKey: 'community_host_incentive_invoice_item_community_host_incentive_settlements-1_principal_200000',
      })
    )
    expect(stripe.invoices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          payment_type: 'community_host_incentive',
          legacy_payment_id: PAYMENT_ID,
          chi_settlement_id: 'community_host_incentive_settlements-1',
        }),
      }),
      expect.objectContaining({
        idempotencyKey: 'community_host_incentive_invoice_community_host_incentive_settlements-1_200000_500',
      })
    )
    expect(db.rows.community_host_incentive_agreements[0]).toMatchObject({
      venue_id: VENUE_ID,
      organizer_user_id: BUILDER_ID,
      agreement_type: 'per_verified_attendee',
      per_head_rate_cents: 1000,
      settlement_mode: 'community_host_incentive',
      status: 'active',
      venue_approved: true,
      is_legacy_revenue_share: false,
    })
    expect(db.rows.community_host_incentive_settlements[0]).toMatchObject({
      agreement_id: 'community_host_incentive_agreements-1',
      verified_attendees: 200,
      verification_source: 'csv_upload',
      organizer_payout_cents: 200000,
      calculation_basis: 'verified_attendance',
      status: 'invoice_sent',
      stripe_invoice_id: 'in_1',
      is_legacy_revenue_share: false,
    })
    expect(db.rows.kickback_payments[0]).toMatchObject({
      status: 'invoice_sent',
      builder_payout_cents: 200000,
      processing_fee_cents: 500,
    })
    expect(sendVenueInvoiceEmail).not.toHaveBeenCalled()
  })

  it('keeps rental-only venues on the legacy invoice path when the CHI flag is on', async () => {
    process.env.CHI_NEW_ENGINE_ENABLED = 'true'
    Object.assign(db.rows.venues[0], { venue_type: 'event_space' })

    const response = await POST(makeRequest(), { params: { id: PAYMENT_ID } })

    expect(response.status).toBe(200)
    expect(stripe.invoiceItems.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        description: 'Revenue share for "Tech Mixer" - 12% bar revenue share of $4280.00',
      }),
      expect.objectContaining({
        idempotencyKey: `kickback_invoice_item_${PAYMENT_ID}_principal_51360`,
      })
    )
    expect(db.rows.community_host_incentive_agreements).toEqual([])
    expect(db.rows.community_host_incentive_settlements).toEqual([])
    expect(sendVenueInvoiceEmail).toHaveBeenCalledWith({ paymentId: PAYMENT_ID })
  })
})
