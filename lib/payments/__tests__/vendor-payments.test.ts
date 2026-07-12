jest.mock('server-only', () => ({}))

import {
  calculatePaymentAmounts,
  centsToDollars,
  dollarsToCents,
  finalizeSucceededVendorPayment,
  getBookingTotal,
  getPaymentAmount,
  getPlatformFeePercentage,
  readCents,
  toMoney,
} from '@/lib/payments/vendor-payments'
import type Stripe from 'stripe'

type Row = Record<string, any>

class VendorPaymentMemoryDb {
  rows: Record<string, Row[]> = {
    vendor_transactions: [{
      id: '11111111-1111-4111-8111-111111111111',
      booking_id: '22222222-2222-4222-8222-222222222222',
      vendor_id: '33333333-3333-4333-8333-333333333333',
      builder_id: '44444444-4444-4444-8444-444444444444',
      stripe_payment_intent_id: 'pi_vendor',
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
    }],
    vendor_bookings: [{
      id: '22222222-2222-4222-8222-222222222222',
      vendor_id: '33333333-3333-4333-8333-333333333333',
      event_id: '55555555-5555-4555-8555-555555555555',
      organizer_id: '66666666-6666-4666-8666-666666666666',
      payment_status: 'processing',
      deposit_paid: false,
    }],
    vendor_stripe_accounts: [{
      vendor_id: '33333333-3333-4333-8333-333333333333',
      stripe_account_id: 'acct_restricted',
      account_status: 'restricted',
      charges_enabled: false,
      payouts_enabled: false,
    }],
    admin_audit_log: [],
  }

  from(table: string) {
    return new VendorPaymentMemoryQuery(this, table)
  }
}

class VendorPaymentMemoryQuery implements PromiseLike<{ data: any; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'select' | 'update' | 'insert' = 'select'
  private payload: Row | null = null
  private rowLimit: number | null = null

  constructor(private db: VendorPaymentMemoryDb, private table: string) {}

  select() { return this }
  update(payload: Row) { this.operation = 'update'; this.payload = payload; return this }
  insert(payload: Row) { this.operation = 'insert'; this.payload = payload; return this }
  eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this }
  contains(column: string, expected: Row) {
    this.filters.push((row) => Object.entries(expected).every(([key, value]) => row[column]?.[key] === value))
    return this
  }
  limit(count: number) { this.rowLimit = count; return this }
  maybeSingle() { return Promise.resolve(this.execute()).then((result) => ({ ...result, data: result.data[0] ?? null })) }
  single() { return this.maybeSingle() }
  then<TResult1 = { data: any; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private execute() {
    if (this.operation === 'insert' && this.payload) {
      const row = { id: `${this.table}-${this.db.rows[this.table].length + 1}`, ...this.payload }
      this.db.rows[this.table].push(row)
      return { data: [row], error: null }
    }
    let rows = this.db.rows[this.table].filter((row) => this.filters.every((filter) => filter(row)))
    if (this.rowLimit != null) rows = rows.slice(0, this.rowLimit)
    if (this.operation === 'update' && this.payload) rows.forEach((row) => Object.assign(row, this.payload))
    return { data: rows, error: null }
  }
}

function vendorFinalizationStripe() {
  return {
    paymentIntents: {
      retrieve: jest.fn(async () => ({
        id: 'pi_vendor',
        status: 'succeeded',
        latest_charge: {
          id: 'ch_vendor',
          balance_transaction: { id: 'txn_vendor', fee: 321 },
        },
      } as Stripe.PaymentIntent)),
    },
    transfers: {
      create: jest.fn(async () => ({ id: 'tr_vendor' } as Stripe.Transfer)),
    },
  }
}

describe('vendor payment helpers', () => {
  it('converts dollars and cents predictably', () => {
    expect(dollarsToCents(30)).toBe(3000)
    expect(dollarsToCents(69)).toBe(6900)
    expect(centsToDollars(3000)).toBe(30)
    expect(readCents(125075, 999)).toBe(125075)
    expect(readCents(null, 1250.75)).toBe(125075)
  })

  it('keeps vendor payout at 100 percent for MVP payments', () => {
    const amounts = calculatePaymentAmounts(1250.75)

    expect(getPlatformFeePercentage()).toBe(0)
    expect(amounts.amountCents).toBe(125075)
    expect(amounts.platformFee).toBe(0)
    expect(amounts.platformFeeCents).toBe(0)
    expect(amounts.vendorPayout).toBe(1250.75)
    expect(amounts.vendorPayoutCents).toBe(125075)
  })

  it('normalizes invalid money input to zero', () => {
    expect(toMoney('42.25')).toBe(42.25)
    expect(toMoney(Number.NaN)).toBe(0)
    expect(toMoney('not-money')).toBe(0)
    expect(toMoney(null)).toBe(0)
  })

  it('uses final price before quoted price for booking totals', () => {
    expect(getBookingTotal({ id: 'booking-1', vendor_id: 'vendor-1', event_id: 'event-1', final_price: '900', quoted_price: '750' })).toBe(900)
    expect(getBookingTotal({ id: 'booking-2', vendor_id: 'vendor-1', event_id: 'event-1', quoted_price: '750' })).toBe(750)
  })

  it('calculates deposit and final payment amounts without overcharging', () => {
    const booking = {
      id: 'booking-1',
      vendor_id: 'vendor-1',
      event_id: 'event-1',
      final_price: 1000,
      deposit_amount: 300,
      deposit_paid: true,
    }

    expect(getPaymentAmount(booking, 'deposit')).toBe(300)
    expect(getPaymentAmount(booking, 'final_payment')).toBe(700)
    expect(getPaymentAmount({ ...booking, deposit_amount: 1200 }, 'deposit')).toBe(1000)
    expect(getPaymentAmount({ ...booking, deposit_paid: false }, 'final_payment')).toBe(1000)
  })

  it('fully finalizes a succeeded vendor intent even after the destination account is restricted', async () => {
    const db = new VendorPaymentMemoryDb()
    const stripe = vendorFinalizationStripe()

    const result = await finalizeSucceededVendorPayment({
      admin: db,
      stripe,
      paymentIntentId: 'pi_vendor',
      connectedAccountId: 'acct_restricted',
      actor: { id: null, type: 'system' },
      reason: 'account_restricted',
    })

    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith(
      'pi_vendor',
      { expand: ['latest_charge.balance_transaction'] },
    )
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 9_000,
        destination: 'acct_restricted',
        source_transaction: 'ch_vendor',
      }),
      { idempotencyKey: 'vendor_transfer_11111111-1111-4111-8111-111111111111' },
    )
    expect(result.transaction).toMatchObject({
      status: 'succeeded',
      stripe_charge_id: 'ch_vendor',
      stripe_transfer_id: 'tr_vendor',
      stripe_fee_cents: 321,
      platform_fee_cents: 1_000,
    })
    expect(db.rows.vendor_bookings[0]).toMatchObject({
      payment_status: 'succeeded',
      deposit_paid: true,
      stripe_payment_intent_id: 'pi_vendor',
    })
    expect(db.rows.admin_audit_log).toEqual([
      expect.objectContaining({
        action: 'vendor_payment.finalized',
        entity_type: 'vendor_transaction',
      }),
    ])

    await finalizeSucceededVendorPayment({
      admin: db,
      stripe,
      paymentIntentId: 'pi_vendor',
      connectedAccountId: 'acct_restricted',
      actor: { id: null, type: 'system' },
      reason: 'account_restricted',
    })
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1)
    expect(db.rows.admin_audit_log).toHaveLength(1)
  })

  it('leaves local payment state blocked when Stripe refuses the restricted-account transfer', async () => {
    const db = new VendorPaymentMemoryDb()
    const stripe = vendorFinalizationStripe()
    stripe.transfers.create.mockRejectedValueOnce(new Error('destination capability disabled'))

    await expect(finalizeSucceededVendorPayment({
      admin: db,
      stripe,
      paymentIntentId: 'pi_vendor',
      connectedAccountId: 'acct_restricted',
      actor: { id: null, type: 'system' },
      reason: 'account_restricted',
    })).rejects.toThrow('destination capability disabled')

    expect(db.rows.vendor_transactions[0]).toMatchObject({
      status: 'blocked_by_account_state',
      stripe_charge_id: null,
      stripe_transfer_id: null,
    })
    expect(db.rows.vendor_bookings[0]).toMatchObject({
      payment_status: 'processing',
      deposit_paid: false,
    })
    expect(db.rows.admin_audit_log).toEqual([
      expect.objectContaining({ action: 'vendor_payment.finalization_failed' }),
    ])
  })

  it('reuses a destination-charge transfer instead of creating a duplicate vendor transfer', async () => {
    const db = new VendorPaymentMemoryDb()
    db.rows.vendor_transactions[0].payment_type = 'service_payment'
    const stripe = vendorFinalizationStripe()
    stripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_vendor',
      status: 'succeeded',
      latest_charge: {
        id: 'ch_vendor',
        transfer: 'tr_destination_charge',
        balance_transaction: { id: 'txn_vendor', fee: 321 },
      },
    } as Stripe.PaymentIntent)

    const result = await finalizeSucceededVendorPayment({
      admin: db,
      stripe,
      paymentIntentId: 'pi_vendor',
      connectedAccountId: 'acct_restricted',
      actor: { id: null, type: 'system' },
      reason: 'account_restricted',
    })

    expect(stripe.transfers.create).not.toHaveBeenCalled()
    expect(result.transaction).toMatchObject({
      status: 'succeeded',
      stripe_transfer_id: 'tr_destination_charge',
    })
    expect(db.rows.vendor_bookings[0]).toMatchObject({ payment_status: 'succeeded' })
  })
})
