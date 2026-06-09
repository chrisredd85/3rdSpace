export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { calculateBookingRefund, type BookingRefundCalculation } from '@/lib/payments/refund-calculator'
import { sendEmailNotification } from '@/lib/email'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'
import { getStripeClient } from '@/lib/stripe/connect'
import { centsToDollars, dollarsToCents, getFriendlyStripeError, readCents, toMoney } from '@/lib/payments/vendor-payments'

export const runtime = 'nodejs'

const refundProcessSchema = z.object({
  bookingId: z.string().uuid(),
  reason: z.string().trim().min(1, 'Cancellation reason is required').max(1000),
})

type RefundableVendorTransaction = {
  id: string
  booking_id: string
  vendor_id: string
  builder_id: string
  stripe_payment_intent_id: string | null
  stripe_transfer_id: string | null
  amount: number | string
  amount_cents?: number | string | null
  vendor_payout: number | string | null
  vendor_payout_cents?: number | string | null
  payment_type: string
}

type RefundablePlatformTransaction = {
  id: string
  stripe_payment_intent_id: string | null
  amount: number | string
}

function getRefundFailureStatus(error: unknown) {
  const status = (error as Error & { status?: number }).status
  return status && status >= 400 ? status : 500
}

async function reverseVendorTransfer(params: {
  transaction: RefundableVendorTransaction
  refundAmount: number
  stripeRefundId: string
}) {
  const payoutCents = readCents(params.transaction.vendor_payout_cents, params.transaction.vendor_payout) ?? 0
  if (!params.transaction.stripe_transfer_id || payoutCents <= 0) return 0

  const stripe = getStripeClient()
  const originalAmountCents = readCents(params.transaction.amount_cents, params.transaction.amount) ?? 0
  const refundCents = dollarsToCents(params.refundAmount)
  const payoutRatio = originalAmountCents > 0 ? refundCents / originalAmountCents : 0
  const reversalCents = Math.min(payoutCents, Math.round(payoutCents * payoutRatio))

  if (reversalCents <= 0) return 0

  await stripe.transfers.createReversal(
    params.transaction.stripe_transfer_id,
    {
      amount: reversalCents,
      metadata: {
        booking_id: params.transaction.booking_id,
        refund_id: params.stripeRefundId,
        original_transaction_id: params.transaction.id,
      },
    },
    { idempotencyKey: `vendor_cancel_reversal_${params.transaction.id}_${params.stripeRefundId}_${reversalCents}` }
  )

  return centsToDollars(reversalCents)
}

async function refundPlatformFee(params: {
  admin: any
  bookingId: string
  refundAmount: number
}) {
  if (params.refundAmount <= 0) return []

  const { data, error } = await params.admin
    .from('platform_fee_transactions')
    .select('id, stripe_payment_intent_id, amount')
    .eq('booking_id', params.bookingId)
    .eq('status', 'succeeded')
    .gt('amount', 0)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to load platform fee transaction: ${error.message}`)

  const transactions = (data || []) as RefundablePlatformTransaction[]
  const stripe = getStripeClient()
  const refunds: Array<{ type: 'platform_fee'; amount: number; refund_id: string }> = []
  let remainingCents = dollarsToCents(params.refundAmount)

  for (const transaction of transactions) {
    if (remainingCents <= 0) break
    if (!transaction.stripe_payment_intent_id) continue

    const refundCents = Math.min(remainingCents, dollarsToCents(toMoney(transaction.amount)))
    if (refundCents <= 0) continue

    console.info('[payments.refund.process] Refunding platform fee', {
      bookingId: params.bookingId,
      transactionId: transaction.id,
      refundCents,
    })

    const refund = await stripe.refunds.create(
      {
        payment_intent: transaction.stripe_payment_intent_id,
        amount: refundCents,
        reason: 'requested_by_customer',
        metadata: {
          booking_id: params.bookingId,
          refund_type: 'platform_fee',
          platform_fee_transaction_id: transaction.id,
        },
      },
      { idempotencyKey: `platform_fee_refund_${transaction.id}_${refundCents}` }
    )

    refunds.push({
      type: 'platform_fee',
      amount: centsToDollars(refundCents),
      refund_id: refund.id,
    })

    await params.admin
      .from('platform_fee_transactions')
      .update({
        status: refundCents >= dollarsToCents(toMoney(transaction.amount)) ? 'refunded' : 'succeeded',
        refunded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', transaction.id)

    remainingCents -= refundCents
  }

  return refunds
}

async function refundVendorService(params: {
  admin: any
  bookingId: string
  refundAmount: number
  reason: string
}) {
  if (params.refundAmount <= 0) return []

  const { data, error } = await params.admin
    .from('vendor_transactions')
    .select('id, booking_id, vendor_id, builder_id, stripe_payment_intent_id, stripe_transfer_id, amount, amount_cents, vendor_payout, vendor_payout_cents, payment_type')
    .eq('booking_id', params.bookingId)
    .eq('status', 'succeeded')
    .neq('payment_type', 'refund')
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to load vendor payment transactions: ${error.message}`)

  const transactions = (data || []) as RefundableVendorTransaction[]
  const stripe = getStripeClient()
  const refunds: Array<{ type: 'vendor_service'; amount: number; refund_id: string; transaction_id: string }> = []
  let remainingCents = dollarsToCents(params.refundAmount)

  for (const transaction of transactions) {
    if (remainingCents <= 0) break
    if (!transaction.stripe_payment_intent_id) continue

    const transactionCents = readCents(transaction.amount_cents, transaction.amount) ?? 0
    const refundCents = Math.min(remainingCents, transactionCents)
    if (refundCents <= 0) continue

    console.info('[payments.refund.process] Refunding vendor payment', {
      bookingId: params.bookingId,
      transactionId: transaction.id,
      refundCents,
    })

    const refundAmount = centsToDollars(refundCents)
    const refund = await stripe.refunds.create(
      {
        payment_intent: transaction.stripe_payment_intent_id,
        amount: refundCents,
        reason: 'requested_by_customer',
        reverse_transfer: transaction.stripe_transfer_id ? undefined : true,
        metadata: {
          booking_id: params.bookingId,
          refund_type: 'vendor_service',
          original_transaction_id: transaction.id,
          cancellation_reason: params.reason,
        },
      },
      { idempotencyKey: `vendor_cancel_refund_${transaction.id}_${refundCents}` }
    )
    const reversedPayout = await reverseVendorTransfer({
      transaction,
      refundAmount,
      stripeRefundId: refund.id,
    })
    const now = new Date().toISOString()

    await params.admin
      .from('vendor_transactions')
      .insert({
        booking_id: transaction.booking_id,
        vendor_id: transaction.vendor_id,
        builder_id: transaction.builder_id,
        stripe_payment_intent_id: transaction.stripe_payment_intent_id,
        stripe_charge_id: refund.id,
        stripe_transfer_id: transaction.stripe_transfer_id,
        amount_cents: refundCents,
        platform_fee_cents: 0,
        stripe_fee_cents: 0,
        vendor_payout_cents: dollarsToCents(reversedPayout),
        payment_type: 'refund',
        status: 'refunded',
        paid_at: now,
      })

    await params.admin
      .from('vendor_transactions')
      .update({ status: refundCents >= transactionCents ? 'refunded' : 'succeeded' })
      .eq('id', transaction.id)

    refunds.push({
      type: 'vendor_service',
      amount: refundAmount,
      refund_id: refund.id,
      transaction_id: transaction.id,
    })

    remainingCents -= refundCents
  }

  return refunds
}

async function sendCancellationNotifications(params: {
  admin: any
  bookingId: string
  calculation: BookingRefundCalculation
  reason: string
}) {
  const { data: booking } = await params.admin
    .from('vendor_bookings')
    .select(`
      id,
      vendor_profiles!inner(user_id, business_name, name, email),
      events!inner(event_name, builder_profiles!inner(user_id, name))
    `)
    .eq('id', params.bookingId)
    .maybeSingle()

  if (!booking) return

  const vendorProfile = Array.isArray(booking.vendor_profiles) ? booking.vendor_profiles[0] : booking.vendor_profiles
  const event = Array.isArray(booking.events) ? booking.events[0] : booking.events
  const builderProfile = Array.isArray(event?.builder_profiles) ? event.builder_profiles[0] : event?.builder_profiles
  const userIds = [vendorProfile?.user_id, builderProfile?.user_id].filter((id): id is string => typeof id === 'string')
  const { data: users } = userIds.length
    ? await params.admin.from('users').select('id, email').in('id', userIds)
    : { data: [] }
  const emailByUserId = new Map<string, string | null>(
    (users || []).map((user: { id: string; email: string | null }) => [user.id, user.email])
  )
  const vendorEmail = vendorProfile?.email || emailByUserId.get(vendorProfile?.user_id)
  const builderEmail = emailByUserId.get(builderProfile?.user_id)
  const eventName = event?.event_name || 'your event'
  const totalRefund = `$${params.calculation.total_refund.toFixed(2)}`

  const notifications = [
    vendorEmail
      ? sendEmailNotification({
          to: vendorEmail,
          subject: `Booking cancelled for ${eventName}`,
          body: `A builder cancelled this booking. Reason: ${params.reason}. The calculated refund total is ${totalRefund}.`,
          templateType: 'booking_cancelled',
        })
      : null,
    builderEmail
      ? sendEmailNotification({
          to: builderEmail,
          subject: `Cancellation refund for ${eventName}`,
          body: `Your cancellation has been processed. Total refund: ${totalRefund}. Reason submitted: ${params.reason}.`,
          templateType: 'booking_cancelled',
        })
      : null,
  ].filter(Boolean) as Promise<unknown>[]

  const results = await Promise.allSettled(notifications)
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('[payments.refund.process] Cancellation email failed', result.reason)
    }
  }
}

/**
 * Processes a cancellation refund across builder platform fee and vendor service payments.
 *
 * @route POST /api/payments/refund/process
 * @auth Required - builder owner of the event.
 *
 * @param request - JSON body containing bookingId and cancellation reason.
 * @returns Stripe refund ids and total refunded amount.
 */
export async function POST(request: NextRequest) {
  let bookingIdForLog: string | null = null

  try {
    const parsedBody = refundProcessSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid refund process payload', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const { bookingId, reason } = parsedBody.data
    bookingIdForLog = bookingId
    console.info('[payments.refund.process] Cancellation refund started', { bookingId })

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

    const { data: existingBooking, error: existingBookingError } = await (admin as any)
      .from('vendor_bookings')
      .select('status')
      .eq('id', bookingId)
      .maybeSingle()

    if (existingBookingError) {
      throw new Error(`Failed to load booking status: ${existingBookingError.message}`)
    }

    if (existingBooking?.status === 'cancelled') {
      return NextResponse.json({ error: 'This booking has already been cancelled.' }, { status: 409 })
    }

    const calculation = await calculateBookingRefund({
      admin,
      builderId: builderProfileId,
      bookingId,
    })

    const platformRefunds = await refundPlatformFee({
      admin,
      bookingId,
      refundAmount: calculation.platform_fee_refund,
    })
    const vendorRefunds = await refundVendorService({
      admin,
      bookingId,
      refundAmount: calculation.vendor_service_refund,
      reason,
    })
    const processedRefunds = [...platformRefunds, ...vendorRefunds]
    const refundedTotal = processedRefunds.reduce((sum, refund) => sum + refund.amount, 0)
    const now = new Date().toISOString()

    const bookingUpdate: Record<string, string | number> = {
      status: 'cancelled',
      cancellation_reason: reason,
      cancelled_at: now,
      refund_amount: Math.round(refundedTotal * 100) / 100,
      updated_at: now,
    }

    if (refundedTotal > 0) {
      bookingUpdate.payment_status = 'refunded'
    }

    await (admin as any)
      .from('vendor_bookings')
      .update(bookingUpdate)
      .eq('id', bookingId)

    await sendCancellationNotifications({
      admin,
      bookingId,
      calculation: {
        ...calculation,
        total_refund: Math.round(refundedTotal * 100) / 100,
      },
      reason,
    })

    console.info('[payments.refund.process] Cancellation refund completed', {
      bookingId,
      refundedTotal,
      refunds: processedRefunds.length,
    })

    return NextResponse.json({
      success: true,
      total_refunded: Math.round(refundedTotal * 100) / 100,
      calculated_total_refund: calculation.total_refund,
      refunds: processedRefunds,
    })
  } catch (error) {
    console.error('[payments.refund.process] Failed to process cancellation refund', {
      bookingId: bookingIdForLog,
      error,
    })
    return NextResponse.json({ error: getFriendlyStripeError(error) }, { status: getRefundFailureStatus(error) })
  }
}
