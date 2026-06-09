export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe/connect'
import {
  centsToDollars,
  dollarsToCents,
  getAuthenticatedBuilderForBooking,
  getFriendlyStripeError,
  getVendorBookingForPayment,
  readCents,
  type VendorTransaction,
} from '@/lib/payments/vendor-payments'

export const runtime = 'nodejs'

const refundSchema = z.object({
  transactionId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  amount: z.number().positive().optional(),
  reason: z.string().max(500).optional(),
}).refine((body) => body.transactionId || body.bookingId, {
  message: 'transactionId or bookingId is required',
})

/**
 * Processes a refund for a succeeded vendor booking payment.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = refundSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Invalid refund request', details: parsedBody.error.flatten() }, { status: 400 })
    }

    const supabase = createClient()
    const admin = createServiceRoleClient()
    let query = (admin as any)
      .from('vendor_transactions')
      .select('*')
      .eq('status', 'succeeded')
      .neq('payment_type', 'refund')
      .order('created_at', { ascending: false })
      .limit(1)

    if (parsedBody.data.transactionId) {
      query = query.eq('id', parsedBody.data.transactionId)
    } else {
      query = query.eq('booking_id', parsedBody.data.bookingId)
    }

    const { data: transactions, error: transactionError } = await query
    if (transactionError) throw new Error(transactionError.message)

    const tx = Array.isArray(transactions) ? transactions[0] as VendorTransaction | undefined : transactions as VendorTransaction | undefined
    if (!tx) return NextResponse.json({ error: 'Refundable payment not found' }, { status: 404 })

    const booking = await getVendorBookingForPayment(admin as any, tx.booking_id)
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

    const auth = await getAuthenticatedBuilderForBooking(supabase, booking)
    if (!auth.authorized || !auth.builderProfileId) {
      return NextResponse.json({ error: auth.error || 'Not authorized for this refund' }, { status: auth.status })
    }

    const transactionCents = readCents(tx.amount_cents, tx.amount) ?? 0
    const requestedRefundCents = parsedBody.data.amount === undefined
      ? transactionCents
      : dollarsToCents(parsedBody.data.amount)
    const refundCents = Math.min(requestedRefundCents, transactionCents)
    const refundAmount = centsToDollars(refundCents)
    const stripe = getStripeClient()
    const refund = await stripe.refunds.create(
      {
        payment_intent: tx.stripe_payment_intent_id || undefined,
        amount: refundCents,
        reason: 'requested_by_customer',
        metadata: {
          booking_id: tx.booking_id,
          original_transaction_id: tx.id,
          reason: parsedBody.data.reason || '',
        },
      },
      { idempotencyKey: `vendor_refund_${tx.id}_${refundCents}` }
    )

    let reversedPayout = 0

    const vendorPayoutCents = readCents(tx.vendor_payout_cents, tx.vendor_payout) ?? 0
    if (tx.stripe_transfer_id && vendorPayoutCents > 0) {
      const payoutRatio = transactionCents > 0 ? refundCents / transactionCents : 0
      const reversalAmount = Math.min(vendorPayoutCents, Math.round(vendorPayoutCents * payoutRatio))

      if (reversalAmount > 0) {
        await stripe.transfers.createReversal(
          tx.stripe_transfer_id,
          {
            amount: reversalAmount,
            metadata: {
              booking_id: tx.booking_id,
              refund_id: refund.id,
            },
          },
          { idempotencyKey: `vendor_refund_reversal_${tx.id}_${refund.id}_${reversalAmount}` }
        )
        reversedPayout = centsToDollars(reversalAmount)
      }
    }

    const now = new Date().toISOString()
    const { data: refundTransaction, error: insertError } = await (admin as any)
      .from('vendor_transactions')
      .insert({
        booking_id: tx.booking_id,
        vendor_id: tx.vendor_id,
        builder_id: tx.builder_id,
        stripe_payment_intent_id: tx.stripe_payment_intent_id,
        stripe_charge_id: refund.id,
        stripe_transfer_id: tx.stripe_transfer_id,
        amount_cents: refundCents,
        platform_fee_cents: 0,
        stripe_fee_cents: 0,
        vendor_payout_cents: dollarsToCents(reversedPayout),
        payment_type: 'refund',
        status: 'refunded',
        paid_at: now,
      })
      .select('*')
      .single()

    if (insertError) throw new Error(insertError.message)

    await (admin as any)
      .from('vendor_transactions')
      .update({ status: refundCents >= transactionCents ? 'refunded' : 'succeeded' })
      .eq('id', tx.id)

    if (refundCents >= transactionCents) {
      await (admin as any)
        .from('vendor_bookings')
        .update({
          payment_status: 'refunded',
          deposit_paid: false,
          updated_at: now,
        })
        .eq('id', tx.booking_id)
    }

    return NextResponse.json({
      refund,
      transaction: refundTransaction,
    })
  } catch (error) {
    console.error('[payments.refund] Failed to process refund', error)
    return NextResponse.json({ error: getFriendlyStripeError(error) }, { status: 500 })
  }
}
