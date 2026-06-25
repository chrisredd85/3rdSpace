export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe/connect'
import { centsToDollars, readCents } from '@/lib/money'
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
import {
  PAYMENT_APPROVAL_SELECT_COLUMNS,
  validatePaymentApprovalForExecution,
  type PaymentApprovalRow,
} from '@/lib/planner/execution/paymentApproval'
import {
  checkStripeReadinessForAuthorization,
  getStripeGateErrorMessage,
} from '@/lib/planner/stripeReadinessGate'
import { notifyEntityStripeSetup } from '@/lib/server/notifyEntityStripeSetup'

export const runtime = 'nodejs'

const createIntentSchema = z.object({
  bookingId: z.string().uuid(),
  approvalId: z.string().uuid(),
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

    const readinessGate = await checkStripeReadinessForAuthorization({
      supabase: admin as any,
      entityType: 'vendor',
      entityId: booking.vendor_id,
    })
    if (!readinessGate.ready) {
      notifyEntityStripeSetup({
        supabase: admin as any,
        entityType: 'vendor',
        entityId: booking.vendor_id,
        organizerId: null,
        reason: readinessGate.reason,
      }).catch((notifyError) => {
        console.error('[payments.create-intent] Stripe setup notification failed', notifyError)
      })

      return NextResponse.json(
        {
          error: getStripeGateErrorMessage({
            entityType: 'vendor',
            reason: readinessGate.reason,
          }),
          code: 'stripe_recipient_not_ready',
          stripe_gate: readinessGate,
        },
        { status: 409 }
      )
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

    const approval = await loadPaymentApproval(admin as any, parsedBody.data.approvalId)
    const approvalValidation = validatePaymentApprovalForExecution({
      approval,
      expectedAmountCents: amounts.amountCents,
    })
    if (!approvalValidation.ok) {
      return NextResponse.json({ error: approvalValidation.error }, { status: approvalValidation.status })
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
        const existingAmountCents = readCents(existingTransaction.amount_cents, existingTransaction.amount) ?? 0
        const existingPlatformFeeCents = readCents(existingTransaction.platform_fee_cents, existingTransaction.platform_fee) ?? 0
        const existingVendorPayoutCents = readCents(existingTransaction.vendor_payout_cents, existingTransaction.vendor_payout) ?? 0
        return NextResponse.json({
          clientSecret: existingIntent.client_secret,
          paymentIntentId: existingIntent.id,
          connectedAccountId,
          transaction: existingTransaction,
          summary: {
            amount: centsToDollars(existingAmountCents),
            platformFee: centsToDollars(existingPlatformFeeCents),
            vendorPayout: centsToDollars(existingVendorPayoutCents),
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
          approval_id: parsedBody.data.approvalId,
          payment_type: paymentType,
          platform_fee_percentage: String(getPlatformFeePercentage()),
        },
      },
      {
        idempotencyKey: `vendor_booking_${parsedBody.data.approvalId}_${booking.id}_${paymentType}_${amounts.amountCents}`,
      }
    )

    let { data: transaction, error: transactionError } = await (admin as any)
      .from('vendor_transactions')
      .insert({
        booking_id: booking.id,
        vendor_id: booking.vendor_id,
        builder_id: auth.builderProfileId,
        approval_id: parsedBody.data.approvalId,
        stripe_payment_intent_id: paymentIntent.id,
        amount_cents: amounts.amountCents,
        platform_fee_cents: amounts.platformFeeCents,
        stripe_fee_cents: 0,
        vendor_payout_cents: amounts.vendorPayoutCents,
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

async function loadPaymentApproval(admin: any, approvalId: string): Promise<PaymentApprovalRow | null> {
  const { data, error } = await admin
    .from('approvals')
    .select(PAYMENT_APPROVAL_SELECT_COLUMNS)
    .eq('id', approvalId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load payment approval')
  return data as PaymentApprovalRow | null
}
