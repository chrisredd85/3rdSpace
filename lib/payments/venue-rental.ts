import type Stripe from 'stripe'
import type { VenuePaymentTransaction } from '@/lib/types/database'

export const VENUE_RENTAL_PAYMENT_NAMESPACE = 'venue_rental'
export const VENUE_RENTAL_CARD_PROCESSING_RATE = 0.029
export const VENUE_RENTAL_CARD_PROCESSING_FIXED_CENTS = 30
export const VENUE_RENTAL_ACH_PROCESSING_RATE = 0.008
export const VENUE_RENTAL_ACH_PROCESSING_CAP_CENTS = 500

export type VenueRentalPaymentMethodType = 'card' | 'us_bank_account'

type VenueRentalDb = {
  from: (table: 'venue_payment_transactions') => {
    select: (columns?: string) => VenueRentalQuery
    update: (payload: Record<string, unknown>) => VenueRentalQuery
  }
}

type VenueRentalQuery = {
  eq: (column: string, value: unknown) => VenueRentalQuery
  maybeSingle: () => Promise<{ data: VenuePaymentTransaction | null; error: { message?: string } | null }>
  select: (columns?: string) => VenueRentalQuery
}

export type VenueRentalTransactionLookup = {
  venuePaymentTransactionId?: string | null
  checkoutSessionId?: string | null
  paymentIntentId?: string | null
  chargeId?: string | null
  transferId?: string | null
}

const TERMINAL_REFUND_STATUSES = new Set(['refunded_partial', 'refunded_full'])

export function calculateVenueRentalCardProcessingFeeCents(amountCents: number) {
  return Math.ceil(Math.max(0, amountCents) * VENUE_RENTAL_CARD_PROCESSING_RATE) +
    VENUE_RENTAL_CARD_PROCESSING_FIXED_CENTS
}

export function calculateVenueRentalAchProcessingFeeCents(amountCents: number) {
  return Math.min(
    Math.ceil(Math.max(0, amountCents) * VENUE_RENTAL_ACH_PROCESSING_RATE),
    VENUE_RENTAL_ACH_PROCESSING_CAP_CENTS
  )
}

export function calculateVenueRentalProcessingFeeCents(
  amountCents: number,
  paymentMethodType: VenueRentalPaymentMethodType
) {
  return paymentMethodType === 'card'
    ? calculateVenueRentalCardProcessingFeeCents(amountCents)
    : calculateVenueRentalAchProcessingFeeCents(amountCents)
}

export function isVenueRentalEvent(metadata: Stripe.Metadata | null | undefined) {
  return (
    metadata?.payment_kind_namespace === VENUE_RENTAL_PAYMENT_NAMESPACE ||
    Boolean(metadata?.venue_payment_transaction_id)
  )
}

export function getVenueRentalTransactionId(metadata: Stripe.Metadata | null | undefined) {
  return metadata?.venue_payment_transaction_id ?? null
}

export async function loadVenueRentalTransaction(
  admin: VenueRentalDb,
  lookup: VenueRentalTransactionLookup
) {
  const lookupOrder: Array<[keyof VenueRentalTransactionLookup, string]> = [
    ['venuePaymentTransactionId', 'id'],
    ['checkoutSessionId', 'stripe_checkout_session_id'],
    ['paymentIntentId', 'stripe_payment_intent_id'],
    ['chargeId', 'stripe_charge_id'],
    ['transferId', 'stripe_transfer_id'],
  ]

  for (const [lookupKey, column] of lookupOrder) {
    const value = lookup[lookupKey]
    if (!value) continue

    const { data, error } = await admin
      .from('venue_payment_transactions')
      .select('*')
      .eq(column, value)
      .maybeSingle()

    if (error) throw new Error(error.message ?? `Unable to load venue rental transaction by ${column}`)
    if (data?.id) return data
  }

  return null
}

export async function markVenueRentalPaid(
  admin: VenueRentalDb,
  row: VenuePaymentTransaction,
  input: {
    stripe_charge_id?: string | null
    stripe_payment_intent_id?: string | null
    stripe_transfer_id?: string | null
    paid_at: string
  }
) {
  if (row.status === 'paid' || TERMINAL_REFUND_STATUSES.has(row.status)) return row

  return updateVenueRentalTransaction(admin, row.id, {
    status: 'paid',
    paid_at: row.paid_at ?? input.paid_at,
    stripe_charge_id: input.stripe_charge_id ?? row.stripe_charge_id,
    stripe_payment_intent_id: input.stripe_payment_intent_id ?? row.stripe_payment_intent_id,
    stripe_transfer_id: input.stripe_transfer_id ?? row.stripe_transfer_id,
    failed_at: null,
    failure_reason: null,
  })
}

export async function markVenueRentalFailed(
  admin: VenueRentalDb,
  row: VenuePaymentTransaction,
  input: {
    failure_reason: string
    failed_at: string
  }
) {
  if (row.status === 'paid' || TERMINAL_REFUND_STATUSES.has(row.status)) return row

  return updateVenueRentalTransaction(admin, row.id, {
    status: 'failed',
    failed_at: input.failed_at,
    failure_reason: input.failure_reason,
  })
}

export async function markVenueRentalRefunded(
  admin: VenueRentalDb,
  row: VenuePaymentTransaction,
  input: {
    refund_amount_cents: number
    stripe_refund_id?: string | null
  }
) {
  const refundAmountCents = Math.max(0, Math.min(input.refund_amount_cents, row.amount_cents))
  const nextStatus = refundAmountCents >= row.amount_cents ? 'refunded_full' : 'refunded_partial'

  if (
    row.status === nextStatus &&
    row.refund_amount_cents === refundAmountCents &&
    (!input.stripe_refund_id || row.stripe_refund_id === input.stripe_refund_id)
  ) {
    return row
  }

  if (row.status === 'refunded_full' && refundAmountCents <= (row.refund_amount_cents ?? row.amount_cents)) {
    return row
  }

  return updateVenueRentalTransaction(admin, row.id, {
    status: nextStatus,
    refund_amount_cents: refundAmountCents,
    stripe_refund_id: input.stripe_refund_id ?? row.stripe_refund_id,
  })
}

export async function markVenueRentalTransferComplete(
  admin: VenueRentalDb,
  row: VenuePaymentTransaction,
  input: {
    stripe_transfer_id: string
    transfer_completed_at: string
  }
) {
  if (row.stripe_transfer_id === input.stripe_transfer_id && row.transfer_completed_at) return row

  return updateVenueRentalTransaction(admin, row.id, {
    stripe_transfer_id: input.stripe_transfer_id,
    transfer_completed_at: row.transfer_completed_at ?? input.transfer_completed_at,
  })
}

export async function markVenueRentalTransferReversed(
  admin: VenueRentalDb,
  row: VenuePaymentTransaction,
  input: {
    stripe_transfer_reversal_id: string
  }
) {
  if (row.stripe_transfer_reversal_id === input.stripe_transfer_reversal_id) return row

  return updateVenueRentalTransaction(admin, row.id, {
    stripe_transfer_reversal_id: input.stripe_transfer_reversal_id,
  })
}

async function updateVenueRentalTransaction(
  admin: VenueRentalDb,
  transactionId: string,
  payload: Record<string, unknown>
) {
  const { data, error } = await admin
    .from('venue_payment_transactions')
    .update(payload)
    .eq('id', transactionId)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Unable to update venue rental transaction')
  if (!data?.id) throw new Error(`Venue rental transaction not found: ${transactionId}`)
  return data
}
