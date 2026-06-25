import { assertIntegerCents } from '@/lib/planner/execution/approvalState'

export const SETTLEMENT_CURRENCY = 'usd'
export const SETTLEMENT_PLATFORM_FEE_CENTS = 0

export type SettlementChargeAmounts = {
  amountCents: number
  platformFeeCents: number
  organizerPayoutCents: number
  currency: typeof SETTLEMENT_CURRENCY
}

export function calculateSettlementChargeAmounts(amountCents: number): SettlementChargeAmounts {
  const principalCents = assertIntegerCents(amountCents, 'settlement_amount_cents')
  if (principalCents <= 0) {
    throw new Error('Settlement amount must be positive')
  }

  return {
    amountCents: principalCents,
    platformFeeCents: SETTLEMENT_PLATFORM_FEE_CENTS,
    organizerPayoutCents: principalCents,
    currency: SETTLEMENT_CURRENCY,
  }
}

export function assertSettlementChargeAmounts(input: {
  amount_cents?: number | null
  amountCents?: number | null
  platform_fee_cents?: number | null
  platformFeeCents?: number | null
  organizer_payout_cents?: number | null
  organizerPayoutCents?: number | null
  currency?: string | null
}) {
  const amountCents = assertIntegerCents(input.amount_cents ?? input.amountCents ?? 0, 'amount_cents')
  const platformFeeCents = assertIntegerCents(input.platform_fee_cents ?? input.platformFeeCents ?? 0, 'platform_fee_cents')
  const organizerPayoutCents = assertIntegerCents(
    input.organizer_payout_cents ?? input.organizerPayoutCents ?? 0,
    'organizer_payout_cents',
  )
  const currency = input.currency ?? SETTLEMENT_CURRENCY

  if (currency !== SETTLEMENT_CURRENCY) {
    throw new Error(`CHI settlement currency must be ${SETTLEMENT_CURRENCY}`)
  }
  if (platformFeeCents !== SETTLEMENT_PLATFORM_FEE_CENTS) {
    throw new Error('CHI settlements cannot include a 3rdPlace platform fee')
  }
  if (organizerPayoutCents !== amountCents) {
    throw new Error('CHI settlement payout must equal the full settlement amount')
  }

  return {
    amountCents,
    platformFeeCents,
    organizerPayoutCents,
    currency: SETTLEMENT_CURRENCY,
  } satisfies SettlementChargeAmounts
}
