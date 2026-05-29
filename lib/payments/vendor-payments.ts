import 'server-only'

import Stripe from 'stripe'
import { validateStripeConnectAccount } from '@/lib/billing/stripeConnectGuard'
import {
  centsToDollars,
  dollarsToCents,
  readCents,
  toFiniteNumber,
} from '@/lib/money'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'
import { getStripeClient } from '@/lib/stripe/connect'

export type VendorPaymentType = 'deposit' | 'final_payment'
export type VendorTransactionStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'refunded'

export type VendorTransaction = {
  id: string
  booking_id: string
  vendor_id: string
  builder_id: string
  stripe_payment_intent_id: string | null
  stripe_charge_id: string | null
  stripe_transfer_id: string | null
  amount: number
  amount_cents?: number | null
  platform_fee: number
  platform_fee_cents?: number | null
  stripe_fee: number
  stripe_fee_cents?: number | null
  vendor_payout: number
  vendor_payout_cents?: number | null
  payment_type: VendorPaymentType | 'refund'
  status: VendorTransactionStatus
  paid_at: string | null
  created_at: string
}

export class VendorRequiresReconnectError extends Error {
  code = 'vendor_requires_reconnect'
  status = 409
  reason = 'stripe_mode_mismatch'

  constructor(message = 'Reconnect Stripe to receive vendor payouts.') {
    super(message)
    this.name = 'VendorRequiresReconnectError'
  }
}

type VendorBookingPaymentRow = {
  id: string
  vendor_id: string
  event_id: string
  organizer_id?: string | null
  status?: string | null
  quoted_price?: number | string | null
  final_price?: number | string | null
  deposit_amount?: number | string | null
  deposit_paid?: boolean | null
  payment_status?: string | null
}

export { centsToDollars, dollarsToCents, readCents }

export function toMoney(value: number | string | null | undefined) {
  return toFiniteNumber(value) ?? 0
}

export function getPlatformFeePercentage() {
  const parsed = Number(process.env.PLATFORM_FEE_PERCENTAGE ?? '0')
  if (!Number.isFinite(parsed)) return 0
  return Math.min(Math.max(parsed, 0), 30)
}

export function calculatePaymentAmounts(amount: number) {
  const amountCents = dollarsToCents(amount)
  const platformFeeCents = Math.round(amountCents * (getPlatformFeePercentage() / 100))
  const vendorPayoutCents = Math.max(amountCents - platformFeeCents, 0)

  return {
    amount,
    amountCents,
    platformFee: centsToDollars(platformFeeCents),
    platformFeeCents,
    vendorPayout: centsToDollars(vendorPayoutCents),
    vendorPayoutCents,
  }
}

export function getBookingTotal(booking: VendorBookingPaymentRow) {
  return toMoney(booking.final_price) || toMoney(booking.quoted_price)
}

export function getPaymentAmount(booking: VendorBookingPaymentRow, paymentType: VendorPaymentType) {
  const total = getBookingTotal(booking)

  if (paymentType === 'deposit') {
    const deposit = toMoney(booking.deposit_amount)
    return deposit > 0 ? Math.min(deposit, total || deposit) : total
  }

  const depositPaid = booking.deposit_paid ? toMoney(booking.deposit_amount) : 0
  return Math.max(total - depositPaid, 0)
}

export function getFriendlyStripeError(error: unknown) {
  if (error instanceof Stripe.errors.StripeCardError) {
    if (error.decline_code === 'insufficient_funds') {
      return 'This card has insufficient funds. Please try another payment method.'
    }

    return error.message || 'The card was declined. Please try another payment method.'
  }

  if (error instanceof Stripe.errors.StripeConnectionError) {
    return 'We could not reach Stripe. Please try again in a moment.'
  }

  if (error instanceof Error) return error.message
  return 'Payment processing failed. Please try again.'
}

export async function getAuthenticatedBuilderForBooking(supabase: any, booking: VendorBookingPaymentRow) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { user: null, builderProfileId: null, authorized: false, error: 'Unauthorized', status: 401 }
  }

  const { builderProfileId } = await getBuilderProfileId(supabase, user.id)
  const isOrganizer = booking.organizer_id === user.id

  if (!isOrganizer && !builderProfileId) {
    return { user, builderProfileId: null, authorized: false, error: 'Builder profile not found', status: 403 }
  }

  let ownsEvent = false
  if (!isOrganizer && builderProfileId) {
    const { data: event } = await supabase
      .from('events')
      .select('id')
      .eq('id', booking.event_id)
      .eq('builder_id', builderProfileId)
      .maybeSingle()

    ownsEvent = Boolean(event)
  }

  return {
    user,
    builderProfileId,
    authorized: isOrganizer || ownsEvent,
    error: null,
    status: 200,
  }
}

export async function getVendorBookingForPayment(admin: any, bookingId: string) {
  const { data: booking, error } = await admin
    .from('vendor_bookings')
    .select(
      'id, vendor_id, event_id, organizer_id, status, quoted_price, final_price, deposit_amount, deposit_paid, payment_status'
    )
    .eq('id', bookingId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load booking: ${error.message}`)
  return (booking || null) as VendorBookingPaymentRow | null
}

export async function getVendorStripeAccount(admin: any, vendorId: string) {
  const { data, error } = await admin
    .from('vendor_stripe_accounts')
    .select('stripe_account_id, account_status, charges_enabled, payouts_enabled')
    .eq('vendor_id', vendorId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load vendor Stripe account: ${error.message}`)
  return data as {
    stripe_account_id?: string | null
    account_status?: string | null
    charges_enabled?: boolean | null
    payouts_enabled?: boolean | null
  } | null
}

export async function ensureVendorCanReceivePayments(admin: any, vendorId: string) {
  const account = await getVendorStripeAccount(admin, vendorId)

  if (!account?.stripe_account_id) {
    throw new VendorRequiresReconnectError('This vendor needs to reconnect Stripe before receiving payouts.')
  }

  const stripe = getStripeClient()
  const validation = await validateStripeConnectAccount({
    stripe,
    db: admin,
    table: 'vendor_stripe_accounts',
    rowId: vendorId,
    currentAccountId: account.stripe_account_id,
  })

  if (validation.mismatchCleared || !validation.accountId) {
    throw new VendorRequiresReconnectError('This vendor needs to reconnect Stripe before receiving payouts.')
  }

  if (!account.payouts_enabled || account.account_status === 'restricted') {
    throw new Error('This vendor cannot receive payouts right now. We have notified the team to review the account.')
  }

  return validation.accountId
}

export async function createVendorTransfer(params: {
  transaction: VendorTransaction
  connectedAccountId: string
  chargeId: string
}) {
  const stripe = getStripeClient()
  const vendorPayoutCents = readCents(
    params.transaction.vendor_payout_cents,
    params.transaction.vendor_payout
  ) ?? 0
  const transfer = await stripe.transfers.create(
    {
      amount: vendorPayoutCents,
      currency: 'usd',
      destination: params.connectedAccountId,
      source_transaction: params.chargeId,
      transfer_group: `vendor_booking_${params.transaction.booking_id}`,
      metadata: {
        booking_id: params.transaction.booking_id,
        vendor_id: params.transaction.vendor_id,
        transaction_id: params.transaction.id,
        payment_type: params.transaction.payment_type,
      },
    },
    {
      idempotencyKey: `vendor_transfer_${params.transaction.id}`,
    },
  )

  return transfer.id
}

export function getStripeFeeCentsFromPaymentIntent(paymentIntent: Stripe.PaymentIntent) {
  const charge = paymentIntent.latest_charge

  if (!charge || typeof charge === 'string') return 0
  const balanceTransaction = charge.balance_transaction

  if (!balanceTransaction || typeof balanceTransaction === 'string') return 0
  return Math.round(balanceTransaction.fee)
}

export function getStripeFeeFromPaymentIntent(paymentIntent: Stripe.PaymentIntent) {
  return centsToDollars(getStripeFeeCentsFromPaymentIntent(paymentIntent))
}

export function getChargeIdFromPaymentIntent(paymentIntent: Stripe.PaymentIntent) {
  const charge = paymentIntent.latest_charge
  if (!charge) return null
  return typeof charge === 'string' ? charge : charge.id
}
