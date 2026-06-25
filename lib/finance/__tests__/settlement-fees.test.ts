import {
  SETTLEMENT_CURRENCY,
  assertSettlementChargeAmounts,
  calculateSettlementChargeAmounts,
} from '@/lib/finance/settlement-fees'

describe('settlement fee invariants', () => {
  it('routes the full CHI settlement amount to the organizer with no platform fee', () => {
    expect(calculateSettlementChargeAmounts(12_000)).toEqual({
      amountCents: 12_000,
      platformFeeCents: 0,
      organizerPayoutCents: 12_000,
      currency: SETTLEMENT_CURRENCY,
    })
  })

  it('rejects non-positive or non-integer settlement amounts', () => {
    expect(() => calculateSettlementChargeAmounts(0)).toThrow('Settlement amount must be positive')
    expect(() => calculateSettlementChargeAmounts(12.25)).toThrow('settlement_amount_cents must be a safe integer number of cents')
  })

  it('rejects any platform spread or non-USD charge state', () => {
    expect(() => assertSettlementChargeAmounts({
      amount_cents: 12_000,
      platform_fee_cents: 100,
      organizer_payout_cents: 11_900,
      currency: 'usd',
    })).toThrow('CHI settlements cannot include a 3rdPlace platform fee')

    expect(() => assertSettlementChargeAmounts({
      amount_cents: 12_000,
      platform_fee_cents: 0,
      organizer_payout_cents: 11_900,
      currency: 'usd',
    })).toThrow('CHI settlement payout must equal the full settlement amount')

    expect(() => assertSettlementChargeAmounts({
      amount_cents: 12_000,
      platform_fee_cents: 0,
      organizer_payout_cents: 12_000,
      currency: 'eur',
    })).toThrow('CHI settlement currency must be usd')
  })
})
