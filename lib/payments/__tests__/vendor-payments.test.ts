jest.mock('server-only', () => ({}))

import {
  calculatePaymentAmounts,
  centsToDollars,
  dollarsToCents,
  getBookingTotal,
  getPaymentAmount,
  getPlatformFeePercentage,
  toMoney,
} from '@/lib/payments/vendor-payments'

describe('vendor payment helpers', () => {
  it('converts dollars and cents predictably', () => {
    expect(dollarsToCents(30)).toBe(3000)
    expect(dollarsToCents(69)).toBe(6900)
    expect(centsToDollars(3000)).toBe(30)
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
})
