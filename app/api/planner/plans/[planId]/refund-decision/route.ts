export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { sendVenueRefundDeniedEmail } from '@/lib/email'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe/connect'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  planId: z.string().uuid(),
})

const bodySchema = z.object({
  payment_id: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
  counter_amount_cents: z.number().int().positive().optional(),
  builder_note: z.string().trim().max(2000).optional(),
})

type PlannerDb = { from: (table: string) => any }

type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<{ error: string }> }

class RouteError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function POST(
  request: NextRequest,
  context: { params: { planId: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid plan id' }, { status: 400 })
    }

    const auth = await getAuthenticatedPlannerDb()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, parsedParams.data.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const body = bodySchema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json({ error: 'payment_id and decision are required' }, { status: 400 })
    }

    const admin = createServiceRoleClient() as any
    const payment = await loadPayment(admin, body.data.payment_id)
    if (!payment) return NextResponse.json({ error: 'Community Host Incentive payment not found' }, { status: 404 })
    if (payment.recipient_id !== auth.userId) {
      return NextResponse.json({ error: 'Not authorized for this refund request' }, { status: 403 })
    }
    if (payment.status !== 'refund_requested') {
      return NextResponse.json({ error: 'Refund request is not pending' }, { status: 409 })
    }

    if (body.data.decision === 'reject') {
      const updated = await rejectRefund(admin, payment.id, body.data.builder_note ?? null)
      return NextResponse.json({ payment: updated })
    }

    const refundAmountCents = body.data.counter_amount_cents ?? payment.refund_amount_cents
    if (!refundAmountCents || refundAmountCents <= 0) {
      return NextResponse.json({ error: 'Refund amount is required' }, { status: 400 })
    }
    const payoutCents = Number(payment.builder_payout_cents ?? payment.amount_cents ?? 0)
    if (refundAmountCents > payoutCents) {
      return NextResponse.json({ error: 'Refund amount cannot exceed the builder payout' }, { status: 400 })
    }

    const updated = await approveRefund(admin, payment, refundAmountCents, auth.userId)
    return NextResponse.json({ payment: updated })
  } catch (error) {
    console.error('[planner.refund-decision] Failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process refund decision' },
      { status: error instanceof RouteError ? error.status : 500 }
    )
  }
}

async function getAuthenticatedPlannerDb(): Promise<PlannerAuth> {
  const supabase = createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return {
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    }
  }

  return { db: supabase as unknown as PlannerDb, userId: user.id }
}

async function loadOwnedPlan(db: PlannerDb, planId: string, userId: string) {
  const { data, error } = await db
    .from('plans')
    .select('id, user_id')
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load plan')
  return data as { id: string; user_id: string } | null
}

async function loadPayment(admin: any, paymentId: string) {
  const { data, error } = await admin
    .from('kickback_payments')
    .select('id, agreement_id, recipient_id, status, amount_cents, builder_payout_cents, refund_amount_cents, refund_reason, stripe_transfer_id, stripe_invoice_id')
    .eq('id', paymentId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load Community Host Incentive payment')
  return data as {
    id: string
    agreement_id: string | null
    recipient_id: string
    status: string
    amount_cents: number | null
    builder_payout_cents: number | null
    refund_amount_cents: number | null
    refund_reason: string | null
    stripe_transfer_id: string | null
    stripe_invoice_id: string | null
  } | null
}

async function rejectRefund(admin: any, paymentId: string, builderNote: string | null) {
  const { data, error } = await admin
    .from('kickback_payments')
    .update({
      status: 'paid',
      refund_amount_cents: null,
      refund_reason: null,
      refund_requested_at: null,
      refund_requested_by: null,
      refund_approved_at: null,
      refund_approved_by: null,
    })
    .eq('id', paymentId)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to reject refund')

  await sendVenueRefundDeniedEmail({ paymentId, builderNote }).catch((emailError) => {
    console.error('[planner.refund-decision] Failed to send refund denied email', emailError)
  })

  return data
}

async function approveRefund(
  admin: any,
  payment: NonNullable<Awaited<ReturnType<typeof loadPayment>>>,
  refundAmountCents: number,
  builderUserId: string
) {
  if (!payment.stripe_transfer_id) throw new RouteError('Missing builder transfer for refund reversal', 409)
  if (!payment.stripe_invoice_id) throw new RouteError('Missing Stripe invoice for venue refund', 409)

  const stripe = getStripeClient()
  const invoice = await stripe.invoices.retrieve(payment.stripe_invoice_id, {
    expand: ['charge', 'payment_intent.latest_charge'],
  })
  const chargeId = readInvoiceChargeId(invoice)
  if (!chargeId) throw new RouteError('Missing Stripe charge for refund', 409)

  const now = new Date().toISOString()
  const chiSettlement = await loadCHISettlementForPayment(admin, payment.id)
  const { error: approvalError } = await admin
    .from('kickback_payments')
    .update({
      status: 'refund_approved',
      refund_amount_cents: refundAmountCents,
      refund_approved_at: now,
      refund_approved_by: builderUserId,
    })
    .eq('id', payment.id)

  if (approvalError) throw new Error(approvalError.message ?? 'Failed to save refund approval state')

  const stripeMetadata: Record<string, string> = chiSettlement
    ? {
        payment_type: 'community_host_incentive',
        chi_settlement_id: chiSettlement.id,
        chi_agreement_id: chiSettlement.agreement_id,
        legacy_payment_id: payment.id,
        settlement_method: 'invoice',
        refund_reason: payment.refund_reason ?? '',
      }
    : {
        kickback_payment_id: payment.id,
        settlement_method: 'invoice',
        refund_reason: payment.refund_reason ?? '',
      }
  const idempotencyPrefix = chiSettlement
    ? `community_host_incentive_refund_${chiSettlement.id}`
    : `kickback_refund_${payment.id}`

  const reversal = await (stripe.transfers as any).createReversal(
    payment.stripe_transfer_id,
    {
      amount: refundAmountCents,
      metadata: stripeMetadata,
    },
    { idempotencyKey: `${idempotencyPrefix}_reversal_${refundAmountCents}` }
  )
  const refund = await stripe.refunds.create(
    {
      charge: chargeId,
      amount: refundAmountCents,
      reason: 'requested_by_customer',
      metadata: stripeMetadata,
    },
    { idempotencyKey: `${idempotencyPrefix}_${chargeId}_${refundAmountCents}` }
  )

  const { data: latestPayment, error: latestPaymentError } = await admin
    .from('kickback_payments')
    .select('status')
    .eq('id', payment.id)
    .maybeSingle()

  if (latestPaymentError) throw new Error(latestPaymentError.message ?? 'Failed to reload refund state')

  const webhookAlreadyFinalized =
    latestPayment?.status === 'refunded_full' || latestPayment?.status === 'refunded_partial'

  const { data, error } = await admin
    .from('kickback_payments')
    .update({
      ...(webhookAlreadyFinalized ? {} : { status: 'refund_processing' }),
      refund_amount_cents: refundAmountCents,
      stripe_transfer_reversal_id: reversal.id,
      stripe_refund_id: refund.id,
    })
    .eq('id', payment.id)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to save refund processing state')

  return data
}

async function loadCHISettlementForPayment(admin: any, paymentId: string) {
  const { data, error } = await admin
    .from('community_host_incentive_settlements')
    .select('id, agreement_id')
    .contains('metadata', { legacy_payment_id: paymentId })
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load CHI settlement for refund')
  return data as { id: string; agreement_id: string } | null
}

function readInvoiceChargeId(invoice: any) {
  const directCharge = invoice.charge
  if (typeof directCharge === 'string') return directCharge
  if (directCharge?.id) return directCharge.id

  const paymentIntent = invoice.payment_intent
  const latestCharge = paymentIntent?.latest_charge
  if (typeof latestCharge === 'string') return latestCharge
  return latestCharge?.id ?? null
}
