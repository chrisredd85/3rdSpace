jest.mock('server-only', () => ({}))

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

  return {
    client: {
      paymentIntents: { retrieve: retrievePaymentIntent, cancel: cancelPaymentIntent },
      checkout: { sessions: { retrieve: retrieveCheckout, expire: expireCheckout } },
    },
    retrievePaymentIntent,
    cancelPaymentIntent,
    retrieveCheckout,
    expireCheckout,
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
