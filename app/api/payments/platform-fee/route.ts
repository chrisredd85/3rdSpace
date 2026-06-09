export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe/connect'
import {
  BUILDER_BILLING_PRICES,
  ensureStripeCustomerForBuilder,
  getAuthenticatedBuilderBillingProfile,
  upsertBuilderSubscription,
} from '@/lib/billing/builder-billing'
import { dollarsToCents, getFriendlyStripeError } from '@/lib/payments/vendor-payments'
import {
  PAYMENT_APPROVAL_SELECT_COLUMNS,
  validatePaymentApprovalForExecution,
  type PaymentApprovalRow,
} from '@/lib/planner/execution/paymentApproval'
import { writePaymentExecutionAudit } from '@/lib/planner/execution/paymentExecutionAudit'

export const runtime = 'nodejs'

const platformFeeSchema = z.object({
  bookingId: z.string().uuid(),
  approval_id: z.string().uuid().optional(),
  approvalId: z.string().uuid().optional(),
  paymentMethodId: z.string().min(1).optional(),
})

type PlatformFeeStatus = 'pending' | 'succeeded' | 'failed' | 'refunded'

/**
 * Converts Stripe PaymentIntent statuses into platform fee transaction statuses.
 *
 * @param status - Stripe PaymentIntent status.
 * @returns Platform fee transaction status.
 */
function mapPaymentIntentStatus(status: string): PlatformFeeStatus {
  if (status === 'succeeded') return 'succeeded'
  if (status === 'requires_payment_method' || status === 'canceled') return 'failed'
  return 'pending'
}

/**
 * Returns the first day of the current month in YYYY-MM-DD form.
 *
 * @returns Month key used by builder_event_usage.
 */
function getCurrentMonthKey() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
}

/**
 * Charges or waives the builder platform fee for a vendor booking.
 *
 * @route POST /api/payments/platform-fee
 * @auth Required - builder only.
 *
 * @param request - JSON body containing bookingId and, for pay-per-event, paymentMethodId.
 * @returns Payment result with charged flag and amount.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = platformFeeSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid platform fee payload', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const supabase = createClient()
    const admin = createServiceRoleClient()
    const auth = await getAuthenticatedBuilderBillingProfile(supabase)

    if (!auth.user || !auth.builder) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { data: booking, error: bookingError } = await (admin as any)
      .from('vendor_bookings')
      .select('id, events!inner(builder_id)')
      .eq('id', parsedBody.data.bookingId)
      .maybeSingle()

    if (bookingError) {
      return NextResponse.json({ error: 'Failed to load booking' }, { status: 500 })
    }

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    if ((booking as { events?: { builder_id?: string } }).events?.builder_id !== auth.builder.id) {
      return NextResponse.json({ error: 'Not authorized for this booking' }, { status: 403 })
    }

    const { data: subscription } = await (admin as any)
      .from('builder_subscriptions')
      .select('plan_type, status, stripe_customer_id')
      .eq('builder_id', auth.builder.id)
      .maybeSingle()
    const isPro =
      subscription &&
      (subscription.plan_type === 'pro_monthly' || subscription.plan_type === 'pro_annual') &&
      subscription.status === 'active'

    if (isPro) {
      const paidAt = new Date().toISOString()
      await (admin as any)
        .from('platform_fee_transactions')
        .insert({
          builder_id: auth.builder.id,
          booking_id: parsedBody.data.bookingId,
          amount: 0,
          amount_cents: 0,
          fee_type: 'pro_subscriber_free',
          status: 'succeeded',
          paid_at: paidAt,
        })

      await (admin as any).rpc('increment_event_usage', {
        p_builder_id: auth.builder.id,
        p_month: getCurrentMonthKey(),
        p_fee_paid: 0,
      })

      return NextResponse.json({
        success: true,
        charged: false,
        message: 'Pro subscriber - no booking fee',
      })
    }

    if (!parsedBody.data.paymentMethodId) {
      return NextResponse.json({ error: 'paymentMethodId is required for pay-per-event billing' }, { status: 400 })
    }

    const amount = BUILDER_BILLING_PRICES.payPerEventAmount
    const amountCents = dollarsToCents(amount)
    const approvalId = parsedBody.data.approval_id ?? parsedBody.data.approvalId
    if (!approvalId) {
      return NextResponse.json(
        { error: 'Approval is required before executing this payment action.', code: 'APPROVAL_MISSING' },
        { status: 422 }
      )
    }

    const approval = await loadPaymentApproval(admin as any, approvalId)
    const approvalValidation = validatePaymentApprovalForExecution({
      approval,
      expectedAmountCents: amountCents,
      expectedCounterparty: {
        targetType: 'vendor_booking',
        targetId: parsedBody.data.bookingId,
        payloadKeys: ['booking_id', 'bookingId', 'vendor_booking_id'],
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
        { error: 'Approval is required before executing this payment action.', code: 'APPROVAL_MISSING' },
        { status: 422 }
      )
    }

    const stripe = getStripeClient()
    const existingCustomerId = subscription?.stripe_customer_id || auth.builder.stripe_customer_id || null
    const customerId = await ensureStripeCustomerForBuilder({
      admin,
      builder: auth.builder,
      email: auth.user.email,
      stripeCustomerId: existingCustomerId,
    })

    if (!existingCustomerId) {
      await upsertBuilderSubscription({
        admin,
        builderId: auth.builder.id,
        userId: auth.user.id,
        type: 'pay_per_event',
        stripeCustomerId: customerId,
        status: 'active',
      })

      await (admin as any)
        .from('builder_profiles')
        .update({
          stripe_customer_id: customerId,
          billing_tier: 'pay_per_event',
          updated_at: new Date().toISOString(),
        })
        .eq('id', auth.builder.id)
    }

    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: parsedBody.data.paymentMethodId,
      },
    })

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: 'usd',
        customer: customerId,
        payment_method: parsedBody.data.paymentMethodId,
        confirm: true,
        description: '3rdPlace booking fee - Event booking',
        metadata: {
          booking_id: parsedBody.data.bookingId,
          builder_id: auth.builder.id,
          approval_id: approvalId,
          fee_type: 'per_event',
        },
      },
      { idempotencyKey: `platform_fee_${approvalId}_${auth.builder.id}_${parsedBody.data.bookingId}_${amountCents}` }
    )
    const status = mapPaymentIntentStatus(paymentIntent.status)
    const paidAt = paymentIntent.status === 'succeeded' ? new Date().toISOString() : null

    await (admin as any)
      .from('platform_fee_transactions')
      .insert({
        builder_id: auth.builder.id,
        booking_id: parsedBody.data.bookingId,
        approval_id: approvalId,
        stripe_payment_intent_id: paymentIntent.id,
        amount,
        amount_cents: amountCents,
        fee_type: 'per_event',
        status,
        paid_at: paidAt,
        failed_at: status === 'failed' ? new Date().toISOString() : null,
      })

    if (paymentIntent.status === 'succeeded') {
      await (admin as any).rpc('increment_event_usage', {
        p_builder_id: auth.builder.id,
        p_month: getCurrentMonthKey(),
        p_fee_paid: amount,
      })
    }

    await writePaymentExecutionAudit(admin as any, {
      approval,
      userId: auth.user.id,
      role: 'community_builder',
      action: 'payment.platform_fee.executed',
      amountCents,
      stripeObjectId: paymentIntent.id,
      outcome: status === 'succeeded' ? 'succeeded' : 'failed',
      entityId: parsedBody.data.bookingId,
      metadata: {
        booking_id: parsedBody.data.bookingId,
        stripe_status: paymentIntent.status,
        fee_type: 'per_event',
      },
    })

    return NextResponse.json({
      success: paymentIntent.status === 'succeeded',
      charged: true,
      amount,
      payment_intent_id: paymentIntent.id,
      status: paymentIntent.status,
    })
  } catch (error) {
    console.error('[payments.platform-fee] Failed to process platform fee', error)
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

  if (error) throw new Error(error.message ?? 'Failed to load payment approval')
  return data as PaymentApprovalRow | null
}
