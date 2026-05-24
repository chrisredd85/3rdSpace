export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe/connect'
import {
  createVendorTransfer,
  ensureVendorCanReceivePayments,
  getAuthenticatedBuilderForBooking,
  getChargeIdFromPaymentIntent,
  getFriendlyStripeError,
  getStripeFeeFromPaymentIntent,
  getVendorBookingForPayment,
  VendorRequiresReconnectError,
  type VendorTransaction,
} from '@/lib/payments/vendor-payments'

export const runtime = 'nodejs'

const confirmSchema = z.object({
  paymentIntentId: z.string().min(1),
})

/**
 * Finalizes a vendor booking payment after Stripe confirms the PaymentIntent.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = confirmSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid confirmation request' }, { status: 400 })
    }

    const supabase = createClient()
    const admin = createServiceRoleClient()
    const { data: transaction, error: transactionError } = await (admin as any)
      .from('vendor_transactions')
      .select('*')
      .eq('stripe_payment_intent_id', parsedBody.data.paymentIntentId)
      .maybeSingle()

    if (transactionError) throw new Error(transactionError.message)
    if (!transaction) return NextResponse.json({ error: 'Payment transaction not found' }, { status: 404 })

    const tx = transaction as VendorTransaction
    const booking = await getVendorBookingForPayment(admin as any, tx.booking_id)
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

    const auth = await getAuthenticatedBuilderForBooking(supabase, booking)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Not authorized for this payment' }, { status: auth.status })
    }

    const stripe = getStripeClient()
    const paymentIntent = await stripe.paymentIntents.retrieve(parsedBody.data.paymentIntentId, {
      expand: ['latest_charge.balance_transaction'],
    })

    if (paymentIntent.status !== 'succeeded') {
      const status = paymentIntent.status === 'requires_payment_method' ? 'failed' : 'processing'
      await (admin as any)
        .from('vendor_transactions')
        .update({ status })
        .eq('id', tx.id)

      await (admin as any)
        .from('vendor_bookings')
        .update({ payment_status: status, updated_at: new Date().toISOString() })
        .eq('id', tx.booking_id)

      return NextResponse.json({ status: paymentIntent.status, transaction: { ...tx, status } })
    }

    const chargeId = getChargeIdFromPaymentIntent(paymentIntent)
    if (!chargeId) {
      return NextResponse.json({ error: 'Stripe did not return a charge for this payment yet.' }, { status: 409 })
    }

    const connectedAccountId = await ensureVendorCanReceivePayments(admin as any, tx.vendor_id)
    let transferId = tx.stripe_transfer_id

    if (!transferId && tx.vendor_payout > 0) {
      transferId = await createVendorTransfer({
        transaction: tx,
        connectedAccountId,
        chargeId,
      })
    }

    const paidAt = new Date().toISOString()
    const stripeFee = getStripeFeeFromPaymentIntent(paymentIntent)
    const { data: updatedTransaction, error: updateError } = await (admin as any)
      .from('vendor_transactions')
      .update({
        stripe_charge_id: chargeId,
        stripe_transfer_id: transferId,
        stripe_fee: stripeFee,
        status: 'succeeded',
        paid_at: paidAt,
      })
      .eq('id', tx.id)
      .select('*')
      .single()

    if (updateError) throw new Error(updateError.message)

    const bookingUpdates: Record<string, unknown> = {
      stripe_payment_intent_id: paymentIntent.id,
      payment_status: tx.payment_type === 'final_payment' ? 'fully_paid' : 'succeeded',
      paid_at: tx.payment_type === 'final_payment' ? paidAt : booking.payment_status === 'fully_paid' ? paidAt : undefined,
      updated_at: paidAt,
    }

    if (tx.payment_type === 'deposit') {
      bookingUpdates.deposit_paid = true
    }

    Object.keys(bookingUpdates).forEach((key) => bookingUpdates[key] === undefined && delete bookingUpdates[key])

    await (admin as any)
      .from('vendor_bookings')
      .update(bookingUpdates)
      .eq('id', tx.booking_id)

    return NextResponse.json({
      status: 'succeeded',
      transaction: updatedTransaction,
    })
  } catch (error) {
    if (error instanceof VendorRequiresReconnectError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          onboarding_required: true,
          reason: error.reason,
        },
        { status: error.status }
      )
    }

    console.error('[payments.confirm] Failed to confirm payment', error)
    return NextResponse.json({ error: getFriendlyStripeError(error) }, { status: 500 })
  }
}
