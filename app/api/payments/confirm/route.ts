export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe/connect'
import {
  ensureVendorCanReceivePayments,
  finalizeSucceededVendorPayment,
  getAuthenticatedBuilderForBooking,
  getFriendlyStripeError,
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

    const connectedAccountId = await ensureVendorCanReceivePayments(admin as any, tx.vendor_id)
    const finalized = await finalizeSucceededVendorPayment({
      admin: admin as any,
      stripe,
      paymentIntentId: paymentIntent.id,
      connectedAccountId,
      actor: { id: auth.user?.id ?? null, type: 'organizer' },
      reason: 'Organizer confirmed a succeeded vendor booking payment.',
    })

    return NextResponse.json({
      status: 'succeeded',
      transaction: finalized.transaction,
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
