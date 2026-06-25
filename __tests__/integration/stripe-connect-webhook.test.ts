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
import { sendEmailNotification } from '@/lib/email'
import {
  getStripeClient,
  saveBuilderStripeAccount,
  saveVendorStripeAccount,
  saveVenueStripeAccount,
} from '@/lib/stripe/connect'
import { handleVenueStripeReadyForOwner } from '@/lib/venues/venueOpportunityRecovery'

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

jest.mock('@/lib/venues/venueOpportunityRecovery', () => ({
  handleVenueStripeReadyForOwner: jest.fn().mockResolvedValue({ updated: 1 }),
}))

type Row = Record<string, unknown>

class MemoryDb {
  rows: Record<string, Row[]> = {
    vendor_stripe_accounts: [],
    vendor_profiles: [],
    venue_stripe_accounts: [],
    builder_stripe_accounts: [
      {
        user_id: 'builder-user-1',
        builder_id: 'builder-profile-1',
        stripe_account_id: 'acct_builder',
        account_status: 'active',
      },
    ],
    users: [
      {
        id: 'builder-user-1',
        email: 'builder@example.com',
      },
    ],
    settlement_runs: [],
    settlement_charges: [],
    stripe_webhook_events: [],
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }

  rpc(fn: string, args: Record<string, unknown>) {
    if (fn === 'release_stale_stripe_webhook_reservations') {
      return Promise.resolve({ data: [{ released_count: 0 }], error: null })
    }

    if (fn === 'reserve_stripe_webhook_event') {
      const eventId = String(args.p_stripe_event_id)
      const endpointPath = String(args.p_endpoint_path)
      const existing = this.rows.stripe_webhook_events.find((row) => (
        row.stripe_event_id === eventId &&
        row.endpoint_path === endpointPath
      ))

      if (!existing) {
        this.rows.stripe_webhook_events.push({
          id: `stripe_webhook_events-${this.rows.stripe_webhook_events.length + 1}`,
          stripe_event_id: eventId,
          event_type: args.p_event_type,
          payload: args.p_payload,
          source: args.p_source,
          endpoint_path: endpointPath,
          livemode: args.p_livemode,
          processed: false,
          processed_at: null,
          completed_at: null,
          in_flight: true,
          reserved_at: new Date().toISOString(),
          processing_outcome: 'received',
          duplicate_count: 0,
        })
        return Promise.resolve({
          data: [{ existed: false, in_flight: true, completed: false, reserved_now: true, processed_at: null }],
          error: null,
        })
      }

      if (existing.completed_at || existing.processed) {
        existing.duplicate_count = Number(existing.duplicate_count ?? 0) + 1
        return Promise.resolve({
          data: [{
            existed: true,
            in_flight: false,
            completed: true,
            reserved_now: false,
            processed_at: existing.completed_at ?? existing.processed_at ?? null,
          }],
          error: null,
        })
      }

      if (existing.in_flight) {
        return Promise.resolve({
          data: [{ existed: true, in_flight: true, completed: false, reserved_now: false, processed_at: null }],
          error: null,
        })
      }

      Object.assign(existing, {
        event_type: args.p_event_type,
        payload: args.p_payload,
        source: args.p_source,
        endpoint_path: endpointPath,
        livemode: args.p_livemode,
        in_flight: true,
        reserved_at: new Date().toISOString(),
        processing_outcome: 'received',
        last_error: null,
        error: null,
      })
      return Promise.resolve({
        data: [{ existed: true, in_flight: true, completed: false, reserved_now: true, processed_at: null }],
        error: null,
      })
    }

    if (fn === 'record_stripe_webhook_event_result') {
      const eventId = String(args.p_stripe_event_id)
      const endpointPath = String(args.p_endpoint_path)
      const existing = this.rows.stripe_webhook_events.find((row) => (
        row.stripe_event_id === eventId &&
        row.endpoint_path === endpointPath
      ))
      const now = new Date().toISOString()
      const row = existing ?? {
        id: `stripe_webhook_events-${this.rows.stripe_webhook_events.length + 1}`,
        stripe_event_id: eventId,
        endpoint_path: endpointPath,
        duplicate_count: 0,
      }

      Object.assign(row, {
        event_type: args.p_event_type,
        payload: args.p_payload,
        source: args.p_source,
        endpoint_path: endpointPath,
        livemode: args.p_livemode,
        processed: args.p_processed,
        processed_at: args.p_processed ? now : null,
        completed_at: args.p_processed ? now : null,
        in_flight: false,
        processing_outcome: args.p_processing_outcome,
        last_error: args.p_error ?? null,
        error: args.p_error ?? null,
      })
      if (!existing) this.rows.stripe_webhook_events.push(row)

      return Promise.resolve({ data: row, error: null })
    }

    if (fn === 'increment_stripe_webhook_duplicate_count') {
      const eventId = String(args.p_stripe_event_id)
      const endpointPath = args.p_endpoint_path == null ? null : String(args.p_endpoint_path)
      const row = this.rows.stripe_webhook_events.find((event) => (
        event.stripe_event_id === eventId &&
        (!endpointPath || event.endpoint_path === endpointPath)
      ))
      if (row) row.duplicate_count = Number(row.duplicate_count ?? 0) + 1
      return Promise.resolve({ data: null, error: null })
    }

    if (fn === 'block_inflight_stripe_account_payments') {
      const accountId = String(args.p_stripe_account_id)
      const reason = String(args.p_reason)
      const eventId = String(args.p_event_id)
      const now = new Date().toISOString()
      const builderUserIds = this.rows.builder_stripe_accounts
        .filter((row) => row.stripe_account_id === accountId)
        .map((row) => row.user_id)
      let settlementRuns = 0
      let settlementCharges = 0

      this.rows.settlement_runs.forEach((row) => {
        if (
          builderUserIds.includes(row.organizer_id) &&
          ['pending', 'awaiting_attendance', 'awaiting_organizer_review', 'awaiting_venue_ack', 'awaiting_venue_payment', 'ready_to_settle'].includes(String(row.status))
        ) {
          row.blocked_previous_status = row.status
          row.status = 'blocked'
          row.blocked_at = now
          row.blocked_stripe_account_id = accountId
          row.account_state_blocked_at = now
          row.account_state_block_reason = reason
          row.account_state_blocked_event_id = eventId
          settlementRuns += 1
        }
      })

      this.rows.settlement_charges.forEach((row) => {
        if (row.stripe_connected_account_id === accountId && row.status === 'checkout_created') {
          row.blocked_previous_status = row.status
          row.status = 'blocked'
          row.blocked_at = now
          row.blocked_stripe_account_id = accountId
          row.account_state_blocked_at = now
          row.account_state_block_reason = reason
          row.account_state_blocked_event_id = eventId
          settlementCharges += 1
        }
      })

      return Promise.resolve({
        data: { settlement_runs: settlementRuns, settlement_charges: settlementCharges },
        error: null,
      })
    }

    if (fn === 'unblock_stripe_account_settlements') {
      const accountId = String(args.p_stripe_account_id)
      let settlementRuns = 0
      let settlementCharges = 0

      this.rows.settlement_runs.forEach((row) => {
        if (row.status === 'blocked' && row.blocked_stripe_account_id === accountId && row.blocked_previous_status) {
          row.status = row.blocked_previous_status
          row.blocked_previous_status = null
          row.blocked_at = null
          row.blocked_stripe_account_id = null
          settlementRuns += 1
        }
      })

      this.rows.settlement_charges.forEach((row) => {
        if (row.status === 'blocked' && row.blocked_stripe_account_id === accountId && row.blocked_previous_status === 'checkout_created') {
          row.status = row.blocked_previous_status
          row.blocked_previous_status = null
          row.blocked_at = null
          row.blocked_stripe_account_id = null
          settlementCharges += 1
        }
      })

      return Promise.resolve({
        data: { settlement_runs: settlementRuns, settlement_charges: settlementCharges },
        error: null,
      })
    }

    return Promise.resolve({ data: null, error: null })
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
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

  gt(field: string, value: unknown) {
    this.filters.push((row) => String(row[field] ?? '') > String(value))
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
    const rows = (this.db.rows[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)))
    return this.rowLimit == null ? rows : rows.slice(0, this.rowLimit)
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
      id: 'evt_platform_payout',
      type: 'payout.paid',
      livemode: false,
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
      id: 'evt_connect_account_updated',
      type: 'account.updated',
      livemode: false,
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

  it('blocks in-flight settlement runs and notifies the organizer when account.updated restricts a builder account', async () => {
    db.rows.settlement_runs.push({
      id: 'settlement-run-1',
      organizer_id: 'builder-user-1',
      status: 'awaiting_venue_ack',
    })
    const account = {
      id: 'acct_builder',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: {
        currently_due: [],
        eventually_due: [],
        past_due: ['external_account'],
        pending_verification: [],
        disabled_reason: null,
      },
    }
    event = {
      id: 'evt_connect_builder_restricted',
      type: 'account.updated',
      livemode: false,
      data: { object: account },
    }

    const response = await stripeConnectWebhookPost(makeWebhookRequest('/api/webhooks/stripe/connect'))

    expect(response.status).toBe(200)
    expect(db.rows.settlement_runs[0]).toEqual(expect.objectContaining({
      status: 'blocked',
      blocked_previous_status: 'awaiting_venue_ack',
      blocked_stripe_account_id: 'acct_builder',
      account_state_block_reason: 'account.updated',
    }))
    expect(sendEmailNotification).toHaveBeenCalledTimes(1)
    expect(sendEmailNotification).toHaveBeenCalledWith(expect.objectContaining({
      to: 'builder@example.com',
      subject: 'Action needed: your Stripe account needs attention',
      actionUrl: 'https://www.3rdplace.io/planner/settings/stripe',
    }))
  })

  it('blocks settlement charges when account.updated disables a builder account', async () => {
    db.rows.settlement_charges.push({
      id: 'settlement-charge-1',
      settlement_run_id: 'settlement-run-1',
      stripe_connected_account_id: 'acct_builder',
      status: 'checkout_created',
    })
    db.rows.settlement_runs.push({
      id: 'settlement-run-1',
      organizer_id: 'builder-user-1',
      status: 'awaiting_venue_payment',
    })
    const account = {
      id: 'acct_builder',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: {
        currently_due: [],
        eventually_due: [],
        past_due: [],
        pending_verification: [],
        disabled_reason: 'requirements.past_due',
      },
    }
    event = {
      id: 'evt_connect_builder_disabled',
      type: 'account.updated',
      livemode: false,
      data: { object: account },
    }

    const response = await stripeConnectWebhookPost(makeWebhookRequest('/api/webhooks/stripe/connect'))

    expect(response.status).toBe(200)
    expect(db.rows.settlement_charges[0]).toEqual(expect.objectContaining({
      status: 'blocked',
      blocked_previous_status: 'checkout_created',
      blocked_stripe_account_id: 'acct_builder',
    }))
    expect(db.rows.settlement_runs[0]).toEqual(expect.objectContaining({
      status: 'blocked',
      blocked_previous_status: 'awaiting_venue_payment',
    }))
    expect(sendEmailNotification).toHaveBeenCalledTimes(1)
  })

  it('restores account-state-blocked settlement rows when a builder account becomes active again', async () => {
    db.rows.builder_stripe_accounts[0].account_status = 'restricted'
    db.rows.settlement_runs.push({
      id: 'settlement-run-1',
      organizer_id: 'builder-user-1',
      status: 'blocked',
      blocked_previous_status: 'awaiting_venue_ack',
      blocked_stripe_account_id: 'acct_builder',
      account_state_blocked_at: '2026-06-24T12:00:00.000Z',
    })
    db.rows.settlement_charges.push({
      id: 'settlement-charge-1',
      settlement_run_id: 'settlement-run-1',
      stripe_connected_account_id: 'acct_builder',
      status: 'blocked',
      blocked_previous_status: 'checkout_created',
      blocked_stripe_account_id: 'acct_builder',
      account_state_blocked_at: '2026-06-24T12:00:00.000Z',
    })
    const account = {
      id: 'acct_builder',
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
    }
    event = {
      id: 'evt_connect_builder_active',
      type: 'account.updated',
      livemode: false,
      data: { object: account },
    }

    const response = await stripeConnectWebhookPost(makeWebhookRequest('/api/webhooks/stripe/connect'))

    expect(response.status).toBe(200)
    expect(db.rows.settlement_runs[0]).toEqual(expect.objectContaining({
      status: 'awaiting_venue_ack',
      blocked_previous_status: null,
      blocked_stripe_account_id: null,
    }))
    expect(db.rows.settlement_charges[0]).toEqual(expect.objectContaining({
      status: 'checkout_created',
      blocked_previous_status: null,
      blocked_stripe_account_id: null,
    }))
    expect(sendEmailNotification).not.toHaveBeenCalled()
  })

  it('rate-limits Stripe recovery notification email to one per account within six hours', async () => {
    db.rows.settlement_runs.push({
      id: 'settlement-run-1',
      organizer_id: 'builder-user-1',
      status: 'awaiting_venue_ack',
    })
    const account = {
      id: 'acct_builder',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
      requirements: {
        currently_due: [],
        eventually_due: [],
        past_due: ['external_account'],
        pending_verification: [],
        disabled_reason: null,
      },
    }
    event = {
      id: 'evt_connect_builder_restricted_1',
      type: 'account.updated',
      livemode: false,
      data: { object: account },
    }

    await stripeConnectWebhookPost(makeWebhookRequest('/api/webhooks/stripe/connect'))

    db.rows.settlement_runs.push({
      id: 'settlement-run-2',
      organizer_id: 'builder-user-1',
      status: 'awaiting_venue_ack',
    })
    event = {
      ...event,
      id: 'evt_connect_builder_restricted_2',
    }

    await stripeConnectWebhookPost(makeWebhookRequest('/api/webhooks/stripe/connect'))

    expect(sendEmailNotification).toHaveBeenCalledTimes(1)
    expect(db.rows.settlement_runs.filter((row) => row.status === 'blocked')).toHaveLength(2)
  })

  it('clears vendor Stripe skipped state when account.updated enables charges', async () => {
    db.rows.vendor_stripe_accounts.push({
      vendor_id: 'vendor-1',
      stripe_account_id: 'acct_vendor',
    })
    db.rows.vendor_profiles.push({
      id: 'vendor-1',
      stripe_skipped_at: '2026-06-16T12:00:00.000Z',
    })
    const account = {
      id: 'acct_vendor',
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
      id: 'evt_connect_vendor_account_updated',
      type: 'account.updated',
      livemode: false,
      data: { object: account },
    }

    const response = await stripeConnectWebhookPost(makeWebhookRequest('/api/webhooks/stripe/connect'))

    expect(response.status).toBe(200)
    expect(saveVendorStripeAccount).toHaveBeenCalledWith(db, 'vendor-1', account)
    expect(db.rows.vendor_profiles[0]).toEqual(expect.objectContaining({
      stripe_skipped_at: null,
      updated_at: expect.any(String),
    }))
    expect(saveBuilderStripeAccount).not.toHaveBeenCalled()
    expect(saveVenueStripeAccount).not.toHaveBeenCalled()
  })

  it('fans out venue payment confirmation when Connect reports payouts ready', async () => {
    db.rows.venue_stripe_accounts.push({
      owner_id: 'venue-owner-1',
      stripe_account_id: 'acct_venue',
      payouts_enabled: false,
    })
    const account = {
      id: 'acct_venue',
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
      id: 'evt_connect_venue_ready',
      type: 'account.updated',
      livemode: false,
      data: { object: account },
    }

    const response = await stripeConnectWebhookPost(makeWebhookRequest('/api/webhooks/stripe/connect'))

    expect(response.status).toBe(200)
    expect(saveVenueStripeAccount).toHaveBeenCalledWith(db, 'venue-owner-1', account)
    expect(handleVenueStripeReadyForOwner).toHaveBeenCalledWith(db, 'venue-owner-1')
    expect(saveVendorStripeAccount).not.toHaveBeenCalled()
    expect(saveBuilderStripeAccount).not.toHaveBeenCalled()
  })

  it('rejects Connect webhook requests without a Stripe signature', async () => {
    event = {
      id: 'evt_missing_signature',
      type: 'account.updated',
      livemode: false,
      data: { object: { id: 'acct_builder' } },
    }

    const response = await stripeConnectWebhookPost(makeWebhookRequest('/api/webhooks/stripe/connect', false))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Missing Stripe signature' })
    expect(stripe.webhooks.constructEvent).not.toHaveBeenCalled()
    expect(allowWebhookRequest).not.toHaveBeenCalled()
  })
})
