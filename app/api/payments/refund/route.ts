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
import {
  PAYMENT_APPROVAL_SELECT_COLUMNS,
  validatePaymentApprovalForExecution,
  type PaymentApprovalRow,
} from '@/lib/planner/execution/paymentApproval'
import { writePaymentExecutionAudit } from '@/lib/planner/execution/paymentExecutionAudit'

export const runtime = 'nodejs'

const refundSchema = z.object({
  transactionId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  approval_id: z.string().uuid().optional(),
  approvalId: z.string().uuid().optional(),
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
    const approvalId = parsedBody.data.approval_id ?? parsedBody.data.approvalId
    if (!approvalId) {
      return NextResponse.json(
        { error: 'Approval is required before executing this refund action.', code: 'APPROVAL_MISSING' },
        { status: 422 }
      )
    }

    const approval = await loadPaymentApproval(admin as any, approvalId)
    const approvalValidation = validatePaymentApprovalForExecution({
      approval,
      expectedAmountCents: refundCents,
      expectedCounterparty: {
        targetType: 'vendor_transaction',
        targetId: tx.id,
        payloadKeys: ['transaction_id', 'transactionId', 'vendor_transaction_id', 'original_transaction_id'],
      },
    })
    if (!approvalValidation.ok) {
      return NextResponse.json(
        { error: approvalValidation.error, code: approvalValidation.code },
        { status: approvalValidation.status }
      )
    }
    if (!approval) {
      return NextResponse.json(
        { error: 'Approval is required before executing this refund action.', code: 'APPROVAL_MISSING' },
        { status: 422 }
      )
    }

    const stripe = getStripeClient()
    const refund = await stripe.refunds.create(
      {
        payment_intent: tx.stripe_payment_intent_id || undefined,
        amount: refundCents,
        reason: 'requested_by_customer',
        metadata: {
          booking_id: tx.booking_id,
          original_transaction_id: tx.id,
          approval_id: approvalId,
          reason: parsedBody.data.reason || '',
        },
      },
      { idempotencyKey: `vendor_refund_${approvalId}_${tx.id}_${refundCents}` }
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
              approval_id: approvalId,
            },
          },
          { idempotencyKey: `vendor_refund_reversal_${approvalId}_${tx.id}_${refund.id}_${reversalAmount}` }
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
        approval_id: approvalId,
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

    await writePaymentExecutionAudit(admin as any, {
      approval,
      userId: auth.user.id,
      role: 'community_builder',
      action: 'payment.vendor_refund.executed',
      amountCents: refundCents,
      stripeObjectId: refund.id,
      outcome: 'refunded',
      entityId: tx.id,
      metadata: {
        booking_id: tx.booking_id,
        original_transaction_id: tx.id,
        reversal_amount_cents: dollarsToCents(reversedPayout),
      },
    })

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

async function loadPaymentApproval(admin: any, approvalId: string): Promise<PaymentApprovalRow | null> {
  const { data, error } = await admin
    .from('approvals')
    .select(`
      ${PAYMENT_APPROVAL_SELECT_COLUMNS},
      agent_action:agent_actions(id, target_type, target_id, amount_cents, payload_json)
    `)
    .eq('id', approvalId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load refund approval')
  return data as PaymentApprovalRow | null
}
