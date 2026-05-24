export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe/connect'
import {
  calculatePaymentAmounts,
  ensureVendorCanReceivePayments,
  getAuthenticatedBuilderForBooking,
  getFriendlyStripeError,
  getPaymentAmount,
  getPlatformFeePercentage,
  getVendorBookingForPayment,
  VendorRequiresReconnectError,
  type VendorPaymentType,
} from '@/lib/payments/vendor-payments'

export const runtime = 'nodejs'

const createIntentSchema = z.object({
  bookingId: z.string().uuid(),
  paymentType: z.enum(['deposit', 'final_payment']).default('deposit'),
})

/**
 * Creates a Stripe PaymentIntent for a vendor booking payment.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = createIntentSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid payment request', details: parsedBody.error.flatten() }, { status: 400 })
    }

    const supabase = createClient()
    const admin = createServiceRoleClient()
    const booking = await getVendorBookingForPayment(admin as any, parsedBody.data.bookingId)

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    const auth = await getAuthenticatedBuilderForBooking(supabase, booking)
    if (!auth.authorized || !auth.builderProfileId) {
      return NextResponse.json({ error: auth.error || 'Not authorized for this booking' }, { status: auth.status })
    }

    if (booking.status !== 'confirmed') {
      return NextResponse.json({ error: 'Vendor bookings must be confirmed before payment.' }, { status: 400 })
    }

    const connectedAccountId = await ensureVendorCanReceivePayments(admin as any, booking.vendor_id)
    const paymentType = parsedBody.data.paymentType as VendorPaymentType
    const paymentAmount = getPaymentAmount(booking, paymentType)

    if (paymentAmount <= 0) {
      return NextResponse.json({ error: 'There is no outstanding amount to pay for this booking.' }, { status: 400 })
    }

    const amounts = calculatePaymentAmounts(paymentAmount)
    if (amounts.amountCents < 50) {
      return NextResponse.json({ error: 'Stripe requires payments to be at least $0.50.' }, { status: 400 })
    }

    const stripe = getStripeClient()
    const { data: existingTransaction, error: existingTransactionError } = await (admin as any)
      .from('vendor_transactions')
      .select('*')
      .eq('booking_id', booking.id)
      .eq('payment_type', paymentType)
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingTransactionError) {
      throw new Error(existingTransactionError.message)
    }

    if (existingTransaction?.stripe_payment_intent_id) {
      const existingIntent = await stripe.paymentIntents.retrieve(existingTransaction.stripe_payment_intent_id)
      if (existingIntent.client_secret && !['canceled', 'succeeded'].includes(existingIntent.status)) {
        return NextResponse.json({
          clientSecret: existingIntent.client_secret,
          paymentIntentId: existingIntent.id,
          connectedAccountId,
          transaction: existingTransaction,
          summary: {
            amount: existingTransaction.amount,
            platformFee: existingTransaction.platform_fee,
            vendorPayout: existingTransaction.vendor_payout,
            paymentType,
          },
        })
      }
    }

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amounts.amountCents,
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        transfer_group: `vendor_booking_${booking.id}`,
        metadata: {
          booking_id: booking.id,
          vendor_id: booking.vendor_id,
          builder_id: auth.builderProfileId,
          payment_type: paymentType,
          platform_fee_percentage: String(getPlatformFeePercentage()),
        },
      },
      {
        idempotencyKey: `vendor_booking_${booking.id}_${paymentType}_${amounts.amountCents}`,
      }
    )

    let { data: transaction, error: transactionError } = await (admin as any)
      .from('vendor_transactions')
      .insert({
        booking_id: booking.id,
        vendor_id: booking.vendor_id,
        builder_id: auth.builderProfileId,
        stripe_payment_intent_id: paymentIntent.id,
        amount: amounts.amount,
        platform_fee: amounts.platformFee,
        stripe_fee: 0,
        vendor_payout: amounts.vendorPayout,
        payment_type: paymentType,
        status: 'pending',
      })
      .select('*')
      .single()

    if (transactionError) {
      const isConflict =
        transactionError.code === '23505' ||
        /duplicate key|unique constraint/i.test(transactionError.message)

      if (!isConflict) {
        throw new Error(transactionError.message)
      }

      const { data: recoveredTransaction, error: recoveredTransactionError } = await (admin as any)
        .from('vendor_transactions')
        .select('*')
        .eq('booking_id', booking.id)
        .eq('payment_type', paymentType)
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (recoveredTransactionError || !recoveredTransaction) {
        throw new Error(recoveredTransactionError?.message || 'Payment is already being created. Please try again.')
      }

      transaction = recoveredTransaction
    }

    await (admin as any)
      .from('vendor_bookings')
      .update({
        stripe_payment_intent_id: paymentIntent.id,
        payment_status: 'processing',
        platform_fee_percentage: getPlatformFeePercentage(),
        platform_fee_amount: amounts.platformFee,
        total_amount: amounts.amount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', booking.id)

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      connectedAccountId,
      transaction,
      summary: {
        amount: amounts.amount,
        platformFee: amounts.platformFee,
        vendorPayout: amounts.vendorPayout,
        paymentType,
      },
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

    console.error('[payments.create-intent] Failed to create PaymentIntent', error)
    return NextResponse.json({ error: getFriendlyStripeError(error) }, { status: 500 })
  }
}
