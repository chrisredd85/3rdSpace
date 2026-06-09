export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe/connect'
import { validateStripeConnectAccount } from '@/lib/billing/stripeConnectGuard'
import { centsToDollars, dollarsToCents, getFriendlyStripeError, type VendorTransactionStatus } from '@/lib/payments/vendor-payments'
import {
  PAYMENT_APPROVAL_SELECT_COLUMNS,
  validatePaymentApprovalForExecution,
  type PaymentApprovalRow,
} from '@/lib/planner/execution/paymentApproval'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

export const runtime = 'nodejs'

const vendorPaymentSchema = z.object({
  bookingId: z.string().uuid(),
  approvalId: z.string().uuid(),
  paymentMethodId: z.string().min(1),
  amount_cents: z.number().int().positive().refine(Number.isSafeInteger).optional(),
  amount: z.coerce.number().positive().optional(),
}).refine((body) => body.amount_cents !== undefined || body.amount !== undefined, {
  message: 'amount_cents is required',
})

type VendorPaymentBooking = {
  id: string
  vendor_id: string
  event_id: string
  status?: string | null
  vendor_profiles?: { id: string; name?: string | null; business_name?: string | null } | null
  events?: { builder_id: string } | null
}

/**
 * Estimates Stripe's standard processing fee for display and transaction logging.
 *
 * @param amount - Dollar amount charged to the builder.
 * @returns Estimated processing fee in dollars.
 */
function estimateStripeFeeCents(amountCents: number) {
  return Math.round(amountCents * 0.029 + 30)
}

/**
 * Maps a Stripe PaymentIntent status to the app's vendor transaction status.
 *
 * @param status - Stripe PaymentIntent status.
 * @returns Transaction status suitable for vendor_transactions.
 */
function mapPaymentIntentStatus(status: string): VendorTransactionStatus {
  if (status === 'succeeded') return 'succeeded'
  if (status === 'requires_payment_method' || status === 'canceled') return 'failed'
  return 'processing'
}

/**
 * Processes a direct vendor service payment with zero 3rdPlace application fee.
 *
 * @route POST /api/payments/vendor
 * @auth Required - builder owner of the booking's event.
 *
 * @param request - JSON body containing bookingId, paymentMethodId, and service amount.
 * @returns Stripe PaymentIntent status and id.
 */
export async function POST(request: NextRequest) {
  const requestStartedAt = new Date().toISOString()
  let bookingIdForLog: string | null = null

  try {
    const parsedBody = vendorPaymentSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid vendor payment payload', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const { bookingId, approvalId, paymentMethodId } = parsedBody.data
    bookingIdForLog = bookingId
    const amountCents = readRequestAmountCents(parsedBody.data)
    if (amountCents === null) {
      return NextResponse.json({ error: 'amount_cents must be a safe integer number of cents.' }, { status: 422 })
    }
    console.info('[payments.vendor] Attempt started', {
      bookingId,
      amountCents,
      requestStartedAt,
    })

    const supabase = createClient()
    const admin = createServiceRoleClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { builderProfileId, error: builderProfileError } = await getBuilderProfileId(supabase, user.id)
    if (builderProfileError || !builderProfileId) {
      return NextResponse.json({ error: 'Builder profile not found' }, { status: 403 })
    }

    const { data: bookingRow, error: bookingError } = await (admin as any)
      .from('vendor_bookings')
      .select(`
        id,
        vendor_id,
        event_id,
        status,
        vendor_profiles!inner(id, name, business_name),
        events!inner(builder_id)
      `)
      .eq('id', bookingId)
      .maybeSingle()

    if (bookingError) {
      console.error('[payments.vendor] Booking lookup failed', { bookingId, error: bookingError })
      return NextResponse.json({ error: 'Failed to load booking' }, { status: 500 })
    }

    const booking = bookingRow as VendorPaymentBooking | null
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    if (booking.events?.builder_id !== builderProfileId) {
      return NextResponse.json({ error: 'Not authorized for this booking' }, { status: 403 })
    }

    if (booking.status !== 'confirmed') {
      return NextResponse.json({ error: 'Vendor bookings must be confirmed before payment.' }, { status: 400 })
    }

    const { data: vendorStripe, error: vendorStripeError } = await (admin as any)
      .from('vendor_stripe_accounts')
      .select('stripe_account_id, charges_enabled, payouts_enabled')
      .eq('vendor_id', booking.vendor_id)
      .maybeSingle()

    if (vendorStripeError) {
      console.error('[payments.vendor] Vendor Stripe lookup failed', { bookingId, error: vendorStripeError })
      return NextResponse.json({ error: 'Failed to verify vendor Stripe setup' }, { status: 500 })
    }

    if (!vendorStripe?.stripe_account_id) {
      return NextResponse.json(
        {
          error: 'Vendor needs to reconnect Stripe before receiving payouts.',
          code: 'vendor_requires_reconnect',
          onboarding_required: true,
        },
        { status: 409 }
      )
    }

    const approval = await loadPaymentApproval(admin as any, approvalId)
    const approvalValidation = validatePaymentApprovalForExecution({
      approval,
      expectedAmountCents: amountCents,
    })
    if (!approvalValidation.ok) {
      return NextResponse.json({ error: approvalValidation.error }, { status: approvalValidation.status })
    }

    const stripeFeeCents = estimateStripeFeeCents(amountCents)
    const stripe = getStripeClient()
    const validation = await validateStripeConnectAccount({
      stripe,
      db: admin as any,
      table: 'vendor_stripe_accounts',
      rowId: booking.vendor_id,
      currentAccountId: vendorStripe.stripe_account_id,
    })

    if (validation.mismatchCleared || !validation.accountId) {
      return NextResponse.json(
        {
          error: 'Vendor needs to reconnect Stripe before receiving payouts.',
          code: 'vendor_requires_reconnect',
          onboarding_required: true,
          reason: 'stripe_mode_mismatch',
        },
        { status: 409 }
      )
    }

    if (!vendorStripe.charges_enabled) {
      return NextResponse.json(
        { error: 'Vendor has not completed Stripe setup' },
        { status: 400 }
      )
    }

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: 'usd',
        payment_method: paymentMethodId,
        confirm: true,
        application_fee_amount: 0,
        transfer_data: {
          destination: validation.accountId,
        },
        metadata: {
          booking_id: booking.id,
          vendor_id: booking.vendor_id,
          builder_id: builderProfileId,
          approval_id: approvalId,
          platform_fee: '0',
          payment_type: 'service_payment',
        },
        description: `3rdPlace vendor payment: ${booking.vendor_profiles?.business_name || booking.vendor_profiles?.name || 'service'}`,
      },
      { idempotencyKey: `vendor_service_payment_${approvalId}_${booking.id}_${amountCents}` }
    )
    const status = mapPaymentIntentStatus(paymentIntent.status)
    const paidAt = paymentIntent.status === 'succeeded' ? new Date().toISOString() : null

    const { error: transactionError } = await (admin as any)
      .from('vendor_transactions')
      .insert({
        booking_id: booking.id,
        vendor_id: booking.vendor_id,
        builder_id: builderProfileId,
        approval_id: approvalId,
        stripe_payment_intent_id: paymentIntent.id,
        amount_cents: amountCents,
        platform_fee_cents: 0,
        stripe_fee_cents: stripeFeeCents,
        vendor_payout_cents: Math.max(amountCents - stripeFeeCents, 0),
        payment_type: 'service_payment',
        status,
        paid_at: paidAt,
      })

    if (transactionError) {
      console.error('[payments.vendor] Failed to store transaction', {
        bookingId,
        paymentIntentId: paymentIntent.id,
        error: transactionError,
      })
      return NextResponse.json({ error: 'Payment processed but transaction logging failed' }, { status: 500 })
    }

    if (paymentIntent.status === 'succeeded') {
      await (admin as any)
        .from('vendor_bookings')
        .update({
          stripe_payment_intent_id: paymentIntent.id,
          payment_status: 'succeeded',
          platform_fee_percentage: 0,
          platform_fee_amount: 0,
          total_amount: centsToDollars(amountCents),
          paid_at: paidAt,
          updated_at: paidAt,
        })
        .eq('id', booking.id)
    }

    console.info('[payments.vendor] Attempt finished', {
      bookingId,
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status,
      platformFee: 0,
    })

    return NextResponse.json({
      success: paymentIntent.status === 'succeeded',
      payment_intent_id: paymentIntent.id,
      status: paymentIntent.status,
    })
  } catch (error) {
    console.error('[payments.vendor] Attempt failed', {
      bookingId: bookingIdForLog,
      error,
    })

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

function readRequestAmountCents(body: z.infer<typeof vendorPaymentSchema>) {
  if (body.amount_cents !== undefined) return body.amount_cents
  const value = body.amount
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const cents = value * 100
  if (Math.abs(cents - Math.round(cents)) > 0.000001) return null
  const amountCents = dollarsToCents(value)
  return Number.isSafeInteger(amountCents) ? amountCents : null
}
