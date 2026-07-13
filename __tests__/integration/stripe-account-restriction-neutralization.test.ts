jest.mock('server-only', () => ({}))

const mockCaptureException = jest.fn()
jest.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}))

const mockApplyPlannerStripePaymentIntentWebhook = jest.fn(async (db: MemoryDb, stripeIntent: { id: string }) => {
  const row = db.rows.payment_intents.find((candidate) => candidate.stripe_payment_intent_id === stripeIntent.id)
  if (row) row.status = 'captured'
  return Boolean(row)
})

jest.mock('@/lib/planner/depositPayments', () => {
  const actual = jest.requireActual('@/lib/planner/depositPayments')
  return {
    ...actual,
    applyPlannerStripePaymentIntentWebhook: (...args: unknown[]) => mockApplyPlannerStripePaymentIntentWebhook(...args),
  }
})

import type Stripe from 'stripe'
import { neutralizeRestrictedStripeAccountObjects } from '@/lib/stripe/accountRestrictionNeutralization'

type Row = Record<string, any>

class MemoryDb {
  rows: Record<string, Row[]> = {
    vendor_stripe_accounts: [],
    venue_stripe_accounts: [],
    builder_stripe_accounts: [],
    venues: [],
    payment_intents: [],
    vendor_transactions: [],
    vendor_bookings: [],
    venue_payment_transactions: [],
    settlement_charges: [],
    admin_audit_log: [],
  }

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery {
  private operation: 'select' | 'update' | 'insert' = 'select'
  private payload: Row | null = null
  private filters: Array<(row: Row) => boolean> = []
  private limitCount: number | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select() {
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

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]))
    return this
  }

  not(column: string, operator: string, value: unknown) {
    if (operator === 'is' && value === null) {
      this.filters.push((row) => row[column] !== null && row[column] !== undefined)
    }
    return this
  }

  contains(column: string, expected: Row) {
    this.filters.push((row) => {
      const actual = row[column]
      return Boolean(actual) && Object.entries(expected).every(([key, value]) => actual[key] === value)
    })
    return this
  }

  limit(value: number) {
    this.limitCount = value
    return this
  }

  async maybeSingle() {
    const result = await this.execute()
    return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error }
  }

  async single() {
    const result = await this.execute()
    const row = Array.isArray(result.data) ? result.data[0] ?? null : result.data
    return { data: row, error: row ? null : { message: 'No row' } }
  }

  then<TResult1 = { data: Row[] | Row | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | Row | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected)
  }

  private async execute() {
    if (this.operation === 'insert' && this.payload) {
      const inserted = {
        id: this.payload.id ?? `${this.table}-${this.db.rows[this.table].length + 1}`,
        ...this.payload,
      }
      this.db.rows[this.table].push(inserted)
      return { data: inserted, error: null }
    }

    let matches = this.db.rows[this.table].filter((row) => this.filters.every((filter) => filter(row)))
    if (this.limitCount !== null) matches = matches.slice(0, this.limitCount)
    if (this.operation === 'update' && this.payload) {
      matches.forEach((row) => Object.assign(row, this.payload))
    }
    return { data: matches, error: null }
  }
}

function plannerPayment(overrides: Row = {}) {
  return {
    id: '550e8400-e29b-41d4-a716-446655440101',
    plan_id: '550e8400-e29b-41d4-a716-446655440102',
    approval_id: '550e8400-e29b-41d4-a716-446655440103',
    partner_kind: 'vendor',
    partner_id: '550e8400-e29b-41d4-a716-446655440104',
    amount_cents: 10_000,
    currency: 'usd',
    status: 'blocked_by_account_state',
    stripe_payment_intent_id: 'pi_restricted',
    stripe_payment_method_id: 'pm_card',
    authorized_at: null,
    captured_at: null,
    refunded_at: null,
    refund_terms: 'Refundable',
    platform_fee_cents: 0,
    failure_reason: null,
    capture_attempt_id: null,
    capture_started_at: null,
    capture_effects_started_at: null,
    capture_effects_completed_at: null,
    refunded_amount_cents: 0,
    account_state_blocked_previous_status: 'requested',
    account_state_blocked_stripe_account_id: 'acct_restricted',
    account_state_blocked_at: '2026-07-11T00:00:00.000Z',
    account_state_block_reason: 'account.updated',
    created_at: '2026-07-11T00:00:00.000Z',
    updated_at: '2026-07-11T00:00:00.000Z',
    ...overrides,
  }
}

function seedVendor(db: MemoryDb) {
  db.rows.vendor_stripe_accounts.push({
    vendor_id: '550e8400-e29b-41d4-a716-446655440104',
    stripe_account_id: 'acct_restricted',
  })
}

function fakeStripe(initialPaymentStatus: Stripe.PaymentIntent.Status = 'requires_action') {
  let paymentStatus = initialPaymentStatus
  const retrievePaymentIntent = jest.fn(async () => ({
    id: 'pi_restricted',
    status: paymentStatus,
  } as Stripe.PaymentIntent))
  const cancelPaymentIntent = jest.fn(async () => {
    paymentStatus = 'canceled'
    return { id: 'pi_restricted', status: 'canceled' } as Stripe.PaymentIntent
  })
  const retrieveCheckout = jest.fn(async () => ({
    id: 'cs_restricted',
    status: 'open',
    payment_status: 'unpaid',
  } as Stripe.Checkout.Session))
  const expireCheckout = jest.fn(async () => ({
    id: 'cs_restricted',
    status: 'expired',
    payment_status: 'unpaid',
  } as Stripe.Checkout.Session))
  const createTransfer = jest.fn(async () => ({ id: 'tr_vendor_restricted' } as Stripe.Transfer))

  return {
    client: {
      paymentIntents: { retrieve: retrievePaymentIntent, cancel: cancelPaymentIntent },
      checkout: { sessions: { retrieve: retrieveCheckout, expire: expireCheckout } },
      transfers: { create: createTransfer },
    },
    retrievePaymentIntent,
    cancelPaymentIntent,
    retrieveCheckout,
    expireCheckout,
    createTransfer,
  }
}

describe('connected-account Stripe object neutralization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('retrieves and cancels a cancelable PaymentIntent, then writes a system audit row', async () => {
    const db = new MemoryDb()
    seedVendor(db)
    db.rows.payment_intents.push(plannerPayment())
    const stripe = fakeStripe('requires_action')

    const result = await neutralizeRestrictedStripeAccountObjects({
      db,
      stripe: stripe.client,
      accountId: 'acct_restricted',
      eventId: 'evt_restricted_cancel',
    })

    expect(stripe.retrievePaymentIntent).toHaveBeenCalledWith('pi_restricted')
    expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith(
      'pi_restricted',
      { cancellation_reason: 'abandoned' },
      { idempotencyKey: 'account_restricted_cancel_evt_restricted_cancel_pi_restricted' }
    )
    expect(db.rows.payment_intents[0].status).toBe('failed')
    expect(result.payment_intents_cancelled).toBe(1)
    expect(db.rows.admin_audit_log).toEqual([
      expect.objectContaining({
        action: 'stripe_object.cancelled',
        entity_type: 'planner_payment_intent',
        reason: 'account_restricted',
        metadata: expect.objectContaining({
          actor: 'system',
          stripe_object_id: 'pi_restricted',
          action_taken: 'stripe_object.cancelled',
        }),
      }),
    ])
  })

  it('does not cancel a succeeded PaymentIntent and routes it to existing reconciliation', async () => {
    const db = new MemoryDb()
    seedVendor(db)
    db.rows.payment_intents.push(plannerPayment())
    const stripe = fakeStripe('succeeded')

    const result = await neutralizeRestrictedStripeAccountObjects({
      db,
      stripe: stripe.client,
      accountId: 'acct_restricted',
      eventId: 'evt_restricted_succeeded',
    })

    expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled()
    expect(mockApplyPlannerStripePaymentIntentWebhook).toHaveBeenCalledTimes(1)
    expect(db.rows.payment_intents[0].status).toBe('captured')
    expect(result.payment_intents_routed_to_reconciliation).toBe(1)
  })

  it('preserves a capturing PaymentIntent for the crash-safe reconciler', async () => {
    const db = new MemoryDb()
    seedVendor(db)
    db.rows.payment_intents.push(plannerPayment({
      status: 'capturing',
      capture_attempt_id: '550e8400-e29b-41d4-a716-446655440105',
    }))
    const stripe = fakeStripe('requires_capture')

    const result = await neutralizeRestrictedStripeAccountObjects({
      db,
      stripe: stripe.client,
      accountId: 'acct_restricted',
      eventId: 'evt_restricted_capturing',
    })

    expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled()
    expect(db.rows.payment_intents[0].status).toBe('capturing')
    expect(result.capturing_payment_intents_preserved).toBe(1)
    expect(db.rows.admin_audit_log[0]).toEqual(expect.objectContaining({
      action: 'stripe_object.capture_preserved',
    }))
  })

  it('expires an open venue Checkout Session and records the failed local checkout', async () => {
    const db = new MemoryDb()
    db.rows.venue_stripe_accounts.push({
      owner_id: '550e8400-e29b-41d4-a716-446655440201',
      stripe_account_id: 'acct_restricted',
    })
    db.rows.venues.push({
      id: '550e8400-e29b-41d4-a716-446655440202',
      owner_id: '550e8400-e29b-41d4-a716-446655440201',
    })
    db.rows.venue_payment_transactions.push({
      id: '550e8400-e29b-41d4-a716-446655440203',
      venue_owner_id: '550e8400-e29b-41d4-a716-446655440201',
      status: 'blocked_by_account_state',
      stripe_checkout_session_id: 'cs_restricted',
    })
    const stripe = fakeStripe()

    const result = await neutralizeRestrictedStripeAccountObjects({
      db,
      stripe: stripe.client,
      accountId: 'acct_restricted',
      eventId: 'evt_restricted_checkout',
    })

    expect(stripe.retrieveCheckout).toHaveBeenCalledWith('cs_restricted')
    expect(stripe.expireCheckout).toHaveBeenCalledWith(
      'cs_restricted',
      {},
      { idempotencyKey: 'account_restricted_expire_evt_restricted_checkout_cs_restricted' }
    )
    expect(db.rows.venue_payment_transactions[0].status).toBe('failed')
    expect(result.checkout_sessions_expired).toBe(1)
    expect(db.rows.admin_audit_log[0]).toEqual(expect.objectContaining({
      action: 'stripe_object.expired',
      entity_type: 'venue_checkout_session',
    }))
  })

  it('invokes the canonical venue reconciliation path for a completed Checkout Session', async () => {
    const db = new MemoryDb()
    db.rows.venue_stripe_accounts.push({
      owner_id: '550e8400-e29b-41d4-a716-446655440201',
      stripe_account_id: 'acct_restricted',
    })
    db.rows.venues.push({
      id: '550e8400-e29b-41d4-a716-446655440202',
      owner_id: '550e8400-e29b-41d4-a716-446655440201',
    })
    db.rows.venue_payment_transactions.push({
      id: '550e8400-e29b-41d4-a716-446655440203',
      venue_owner_id: '550e8400-e29b-41d4-a716-446655440201',
      status: 'blocked_by_account_state',
      amount_cents: 50_000,
      paid_at: null,
      stripe_checkout_session_id: 'cs_restricted',
      stripe_payment_intent_id: null,
      stripe_charge_id: null,
      stripe_transfer_id: null,
    })
    const stripe = fakeStripe()
    stripe.retrieveCheckout.mockResolvedValueOnce({
      id: 'cs_restricted',
      status: 'complete',
      payment_status: 'paid',
      payment_intent: 'pi_venue_completed',
      metadata: {
        payment_kind_namespace: 'venue_rental',
        venue_payment_transaction_id: '550e8400-e29b-41d4-a716-446655440203',
      },
    } as Stripe.Checkout.Session)
    stripe.retrievePaymentIntent.mockResolvedValueOnce({
      id: 'pi_venue_completed',
      status: 'succeeded',
      latest_charge: {
        id: 'ch_venue_completed',
        transfer: 'tr_venue_completed',
      },
    } as unknown as Stripe.PaymentIntent)

    const result = await neutralizeRestrictedStripeAccountObjects({
      db,
      stripe: stripe.client,
      accountId: 'acct_restricted',
      eventId: 'evt_restricted_completed_checkout',
    })

    expect(stripe.retrievePaymentIntent).toHaveBeenCalledWith(
      'pi_venue_completed',
      { expand: ['latest_charge'] }
    )
    expect(db.rows.venue_payment_transactions[0]).toEqual(expect.objectContaining({
      status: 'paid',
      stripe_payment_intent_id: 'pi_venue_completed',
      stripe_charge_id: 'ch_venue_completed',
      stripe_transfer_id: 'tr_venue_completed',
    }))
    expect(result.checkout_sessions_routed_to_reconciliation).toBe(1)
    expect(result.object_results).toEqual([
      expect.objectContaining({
        stripe_object_id: 'cs_restricted',
        outcome: 'reconciled',
        action: 'stripe_object.reconciled',
      }),
    ])
  })

  it('preserves a complete but unpaid Checkout Session for the signed async webhook', async () => {
    const db = new MemoryDb()
    db.rows.venue_stripe_accounts.push({
      owner_id: '550e8400-e29b-41d4-a716-446655440201',
      stripe_account_id: 'acct_restricted',
    })
    db.rows.venues.push({
      id: '550e8400-e29b-41d4-a716-446655440202',
      owner_id: '550e8400-e29b-41d4-a716-446655440201',
    })
    db.rows.venue_payment_transactions.push({
      id: '550e8400-e29b-41d4-a716-446655440203',
      venue_owner_id: '550e8400-e29b-41d4-a716-446655440201',
      status: 'blocked_by_account_state',
      stripe_checkout_session_id: 'cs_restricted',
    })
    const stripe = fakeStripe()
    stripe.retrieveCheckout.mockResolvedValueOnce({
      id: 'cs_restricted',
      status: 'complete',
      payment_status: 'unpaid',
      payment_intent: 'pi_venue_pending',
      metadata: {
        payment_kind_namespace: 'venue_rental',
        venue_payment_transaction_id: '550e8400-e29b-41d4-a716-446655440203',
      },
    } as Stripe.Checkout.Session)

    const result = await neutralizeRestrictedStripeAccountObjects({
      db,
      stripe: stripe.client,
      accountId: 'acct_restricted',
      eventId: 'evt_restricted_pending_checkout',
    })

    expect(stripe.retrievePaymentIntent).not.toHaveBeenCalled()
    expect(stripe.expireCheckout).not.toHaveBeenCalled()
    expect(db.rows.venue_payment_transactions[0].status).toBe('blocked_by_account_state')
    expect(result.object_results).toEqual([
      expect.objectContaining({
        stripe_object_id: 'cs_restricted',
        outcome: 'skipped',
        action: 'stripe_object.payment_pending',
      }),
    ])
  })

  it('fully finalizes a succeeded legacy vendor PaymentIntent', async () => {
    const db = new MemoryDb()
    seedVendor(db)
    db.rows.vendor_transactions.push({
      id: '550e8400-e29b-41d4-a716-446655440301',
      booking_id: '550e8400-e29b-41d4-a716-446655440302',
      vendor_id: '550e8400-e29b-41d4-a716-446655440104',
      builder_id: '550e8400-e29b-41d4-a716-446655440303',
      stripe_payment_intent_id: 'pi_vendor_succeeded',
      stripe_charge_id: null,
      stripe_transfer_id: null,
      amount: 100,
      amount_cents: 10_000,
      platform_fee: 10,
      platform_fee_cents: 1_000,
      stripe_fee: 0,
      stripe_fee_cents: 0,
      vendor_payout: 90,
      vendor_payout_cents: 9_000,
      payment_type: 'deposit',
      status: 'blocked_by_account_state',
      paid_at: null,
      created_at: '2026-07-11T00:00:00.000Z',
    })
    db.rows.vendor_bookings.push({
      id: '550e8400-e29b-41d4-a716-446655440302',
      vendor_id: '550e8400-e29b-41d4-a716-446655440104',
      event_id: '550e8400-e29b-41d4-a716-446655440304',
      payment_status: 'pending',
      deposit_paid: false,
    })
    const stripe = fakeStripe()
    stripe.retrievePaymentIntent.mockImplementation(async () => ({
      id: 'pi_vendor_succeeded',
      status: 'succeeded',
      latest_charge: {
        id: 'ch_vendor_succeeded',
        transfer: null,
        balance_transaction: { fee: 329 },
      },
    } as unknown as Stripe.PaymentIntent))

    const result = await neutralizeRestrictedStripeAccountObjects({
      db,
      stripe: stripe.client,
      accountId: 'acct_restricted',
      eventId: 'evt_vendor_succeeded',
    })

    expect(stripe.createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 9_000,
        destination: 'acct_restricted',
        source_transaction: 'ch_vendor_succeeded',
      }),
      { idempotencyKey: 'vendor_transfer_550e8400-e29b-41d4-a716-446655440301' }
    )
    expect(db.rows.vendor_transactions[0]).toEqual(expect.objectContaining({
      status: 'succeeded',
      stripe_charge_id: 'ch_vendor_succeeded',
      stripe_transfer_id: 'tr_vendor_restricted',
      stripe_fee_cents: 329,
      platform_fee_cents: 1_000,
    }))
    expect(db.rows.vendor_bookings[0]).toEqual(expect.objectContaining({
      payment_status: 'succeeded',
      deposit_paid: true,
    }))
    expect(result.payment_intents_routed_to_reconciliation).toBe(1)
  })

  it('continues neutralizing later objects and reports a middle-object failure', async () => {
    const db = new MemoryDb()
    seedVendor(db)
    db.rows.payment_intents.push(
      plannerPayment({ id: 'payment-1', stripe_payment_intent_id: 'pi_first' }),
      plannerPayment({ id: 'payment-2', stripe_payment_intent_id: 'pi_middle' }),
      plannerPayment({ id: 'payment-3', stripe_payment_intent_id: 'pi_third' }),
    )
    const retrieve = jest.fn(async (id: string) => {
      if (id === 'pi_middle') throw new Error('Stripe retrieval failed')
      return { id, status: 'requires_action' } as Stripe.PaymentIntent
    })
    const cancel = jest.fn(async (id: string) => ({ id, status: 'canceled' } as Stripe.PaymentIntent))
    const stripe = {
      paymentIntents: { retrieve, cancel },
      checkout: { sessions: { retrieve: jest.fn(), expire: jest.fn() } },
      transfers: { create: jest.fn() },
    }

    const result = await neutralizeRestrictedStripeAccountObjects({
      db,
      stripe,
      accountId: 'acct_restricted',
      eventId: 'evt_resilient_neutralization',
    })

    expect(cancel).toHaveBeenCalledTimes(2)
    expect(cancel).toHaveBeenNthCalledWith(
      1,
      'pi_first',
      { cancellation_reason: 'abandoned' },
      { idempotencyKey: 'account_restricted_cancel_evt_resilient_neutralization_pi_first' }
    )
    expect(cancel).toHaveBeenNthCalledWith(
      2,
      'pi_third',
      { cancellation_reason: 'abandoned' },
      { idempotencyKey: 'account_restricted_cancel_evt_resilient_neutralization_pi_third' }
    )
    expect(db.rows.payment_intents.map((row) => row.status)).toEqual([
      'failed',
      'blocked_by_account_state',
      'failed',
    ])
    expect(result.objects_failed).toBe(1)
    expect(result.object_results.map((entry) => entry.outcome)).toEqual([
      'neutralized',
      'failed',
      'neutralized',
    ])
    expect(db.rows.admin_audit_log).toContainEqual(expect.objectContaining({
      action: 'stripe_object.neutralization_failed',
      entity_id: 'payment-2',
    }))
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ action: 'stripe_object.neutralization_failed' }),
      })
    )
  })

  it('is safe to re-run without a second Stripe cancellation', async () => {
    const db = new MemoryDb()
    seedVendor(db)
    db.rows.payment_intents.push(plannerPayment())
    const stripe = fakeStripe('requires_confirmation')

    await neutralizeRestrictedStripeAccountObjects({
      db,
      stripe: stripe.client,
      accountId: 'acct_restricted',
      eventId: 'evt_restricted_replay',
    })
    await neutralizeRestrictedStripeAccountObjects({
      db,
      stripe: stripe.client,
      accountId: 'acct_restricted',
      eventId: 'evt_restricted_replay',
    })

    expect(stripe.cancelPaymentIntent).toHaveBeenCalledTimes(1)
    expect(db.rows.payment_intents[0].status).toBe('failed')
  })
})
