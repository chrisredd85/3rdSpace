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
import { getStripeClient, isConnectedStripeAccountBlocked } from '@/lib/stripe/connect'

export type VendorPaymentType = 'deposit' | 'final_payment'
export type VendorTransactionStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'blocked_by_account_state'

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
  payment_type: VendorPaymentType | 'service_payment' | 'refund'
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

export type VendorBookingPaymentRow = {
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

export type VendorPaymentFinalizationStripeClient = {
  paymentIntents: {
    retrieve: (
      id: string,
      params: Stripe.PaymentIntentRetrieveParams,
    ) => Promise<Stripe.PaymentIntent>
  }
  transfers: {
    create: (
      params: Stripe.TransferCreateParams,
      options: Stripe.RequestOptions,
    ) => Promise<Stripe.Transfer>
  }
}

export type VendorPaymentFinalizationActor = {
  id: string | null
  type: 'organizer' | 'stripe_webhook' | 'system'
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

  if (!account.payouts_enabled || isConnectedStripeAccountBlocked(account.account_status)) {
    throw new Error('This vendor cannot receive payouts right now. We have notified the team to review the account.')
  }

  return validation.accountId
}

export async function createVendorTransfer(params: {
  transaction: VendorTransaction
  connectedAccountId: string
  chargeId: string
  stripe?: Pick<VendorPaymentFinalizationStripeClient, 'transfers'>
}) {
  const stripe = params.stripe ?? getStripeClient()
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

/**
 * Canonical finalization for an already-succeeded legacy vendor PaymentIntent.
 * Authorization-time readiness checks intentionally live outside this helper:
 * recovery callers may be handling an account that became restricted after the
 * customer charge succeeded. The trusted destination account is still matched
 * against the vendor's stored Stripe account, then Stripe decides whether the
 * previously approved idempotent transfer can complete.
 */
export async function finalizeSucceededVendorPayment(input: {
  admin: any
  stripe: VendorPaymentFinalizationStripeClient
  paymentIntentId: string
  connectedAccountId: string
  actor: VendorPaymentFinalizationActor
  reason: string
}) {
  const { data: transactionData, error: transactionError } = await input.admin
    .from('vendor_transactions')
    .select('*')
    .eq('stripe_payment_intent_id', input.paymentIntentId)
    .maybeSingle()
  if (transactionError) throw new Error(transactionError.message ?? 'Failed to load vendor transaction')
  if (!transactionData) throw new Error(`Vendor transaction not found for ${input.paymentIntentId}`)

  const transaction = transactionData as VendorTransaction
  const booking = await getVendorBookingForPayment(input.admin, transaction.booking_id)
  if (!booking) throw new Error(`Vendor booking not found: ${transaction.booking_id}`)

  const account = await getVendorStripeAccount(input.admin, transaction.vendor_id)
  if (!account?.stripe_account_id || account.stripe_account_id !== input.connectedAccountId) {
    throw new Error('Vendor payout destination no longer matches the stored Stripe account.')
  }

  const beforeState = {
    transaction: { ...transaction },
    booking: { ...booking },
  }

  try {
    // Retrieve immediately before the transfer mutation. This also expands the
    // balance transaction needed to persist Stripe's fee truth.
    const paymentIntent = await input.stripe.paymentIntents.retrieve(
      input.paymentIntentId,
      { expand: ['latest_charge.balance_transaction'] },
    )
    if (paymentIntent.status !== 'succeeded') {
      throw new Error(
        `Cannot finalize vendor PaymentIntent ${paymentIntent.id} in Stripe status ${paymentIntent.status}`,
      )
    }

    const chargeId = getChargeIdFromPaymentIntent(paymentIntent)
    if (!chargeId) {
      throw new Error('Stripe did not return a charge for this payment yet.')
    }

    const vendorPayoutCents = readCents(
      transaction.vendor_payout_cents,
      transaction.vendor_payout,
    ) ?? 0
    let transferId = transaction.stripe_transfer_id ?? getTransferIdFromPaymentIntent(paymentIntent)
    if (!transferId && vendorPayoutCents > 0) {
      transferId = await createVendorTransfer({
        transaction,
        connectedAccountId: input.connectedAccountId,
        chargeId,
        stripe: input.stripe,
      })
    }

    const paidAt = transaction.paid_at ?? new Date().toISOString()
    const stripeFeeCents = getStripeFeeCentsFromPaymentIntent(paymentIntent)
    const bookingUpdates: Record<string, unknown> = {
      stripe_payment_intent_id: paymentIntent.id,
      payment_status: transaction.payment_type === 'final_payment' ? 'fully_paid' : 'succeeded',
      paid_at: transaction.payment_type === 'final_payment'
        ? paidAt
        : booking.payment_status === 'fully_paid'
          ? paidAt
          : undefined,
      updated_at: paidAt,
    }
    if (transaction.payment_type === 'deposit') bookingUpdates.deposit_paid = true
    Object.keys(bookingUpdates).forEach((key) => {
      if (bookingUpdates[key] === undefined) delete bookingUpdates[key]
    })

    const { data: updatedBooking, error: bookingUpdateError } = await input.admin
      .from('vendor_bookings')
      .update(bookingUpdates)
      .eq('id', transaction.booking_id)
      .select('*')
      .single()
    if (bookingUpdateError) {
      throw new Error(bookingUpdateError.message ?? 'Failed to finalize vendor booking payment')
    }
    if (!updatedBooking) throw new Error(`Vendor booking disappeared during finalization: ${transaction.booking_id}`)

    // Commit the terminal transaction status last. If an earlier booking write
    // fails, the transaction stays in a retryable state and account-restriction
    // neutralization will pick it up again; Stripe transfer idempotency prevents
    // duplicate money movement on that retry.
    const { data: updatedTransaction, error: updateError } = await input.admin
      .from('vendor_transactions')
      .update({
        stripe_charge_id: chargeId,
        stripe_transfer_id: transferId,
        stripe_fee_cents: stripeFeeCents,
        status: 'succeeded',
        paid_at: paidAt,
      })
      .eq('id', transaction.id)
      .eq('stripe_payment_intent_id', paymentIntent.id)
      .select('*')
      .single()
    if (updateError) throw new Error(updateError.message ?? 'Failed to finalize vendor transaction')
    if (!updatedTransaction) throw new Error(`Vendor transaction disappeared during finalization: ${transaction.id}`)

    await writeVendorFinalizationAudit(input.admin, {
      action: 'vendor_payment.finalized',
      transactionId: transaction.id,
      paymentIntentId: paymentIntent.id,
      actor: input.actor,
      reason: input.reason,
      beforeState,
      afterState: {
        transaction: updatedTransaction,
        booking: updatedBooking,
      },
      metadata: {
        stripe_connected_account_id: input.connectedAccountId,
        stripe_charge_id: chargeId,
        stripe_transfer_id: transferId,
        stripe_fee_cents: stripeFeeCents,
        platform_fee_cents: transaction.platform_fee_cents ?? null,
        vendor_payout_cents: vendorPayoutCents,
      },
    })

    return {
      status: 'succeeded' as const,
      transaction: updatedTransaction as VendorTransaction,
      booking: updatedBooking as VendorBookingPaymentRow,
    }
  } catch (error) {
    await writeVendorFinalizationAudit(input.admin, {
      action: 'vendor_payment.finalization_failed',
      transactionId: transaction.id,
      paymentIntentId: input.paymentIntentId,
      actor: input.actor,
      reason: input.reason,
      beforeState,
      afterState: null,
      metadata: {
        stripe_connected_account_id: input.connectedAccountId,
        error: error instanceof Error ? error.message : 'Unknown vendor payment finalization error',
      },
    }).catch(() => undefined)
    throw error
  }
}

async function writeVendorFinalizationAudit(
  admin: any,
  input: {
    action: 'vendor_payment.finalized' | 'vendor_payment.finalization_failed'
    transactionId: string
    paymentIntentId: string
    actor: VendorPaymentFinalizationActor
    reason: string
    beforeState: Record<string, unknown>
    afterState: Record<string, unknown> | null
    metadata: Record<string, unknown>
  },
) {
  const auditMetadata = {
    actor: input.actor.type,
    actor_id: input.actor.id,
    stripe_payment_intent_id: input.paymentIntentId,
    ...input.metadata,
  }
  const { data: existing, error: lookupError } = await admin
    .from('admin_audit_log')
    .select('id')
    .eq('entity_type', 'vendor_transaction')
    .eq('entity_id', input.transactionId)
    .eq('action', input.action)
    .contains('metadata', { stripe_payment_intent_id: input.paymentIntentId })
    .limit(1)
  if (lookupError) throw new Error(lookupError.message ?? 'Failed to check vendor finalization audit')
  if (Array.isArray(existing) && existing.length > 0) return

  const { error } = await admin.from('admin_audit_log').insert({
    admin_user_id: null,
    action: input.action,
    entity_type: 'vendor_transaction',
    entity_id: input.transactionId,
    before_state: input.beforeState,
    after_state: input.afterState,
    reason: input.reason,
    metadata: auditMetadata,
  })
  if (error) throw new Error(error.message ?? 'Failed to audit vendor payment finalization')
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

export function getTransferIdFromPaymentIntent(paymentIntent: Stripe.PaymentIntent) {
  const charge = paymentIntent.latest_charge
  if (!charge || typeof charge === 'string') return null
  const transfer = (charge as Stripe.Charge & {
    transfer?: string | { id: string } | null
  }).transfer
  return typeof transfer === 'string' ? transfer : transfer?.id ?? null
}
