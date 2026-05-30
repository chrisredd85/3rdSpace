export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  sendBuilderRefundApprovedEmail,
  sendBuilderRefundCounteredEmail,
  sendBuilderRefundRejectedEmail,
} from '@/lib/email'
import { VENUE_RENTAL_PAYMENT_NAMESPACE } from '@/lib/payments/venue-rental'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedVenueOwner, getStripeClient } from '@/lib/stripe/connect'

const paramsSchema = z.object({
  transactionId: z.string().uuid(),
})

const bodySchema = z.object({
  decision: z.enum(['approve', 'reject', 'counter']),
  counter_amount_cents: z.number().int().positive().optional(),
  note: z.string().trim().max(2000).optional(),
}).strict()

type VenuePaymentTransactionForDecision = {
  id: string
  plan_id: string
  venue_booking_id: string | null
  builder_id: string
  venue_id: string
  venue_owner_id: string
  amount_cents: number
  processing_fee_cents: number
  status: string
  refund_amount_cents: number | null
  refund_reason: string | null
  stripe_payment_intent_id: string | null
  stripe_transfer_id: string | null
}

class RouteError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/**
 * Venue-owner decision route for builder-requested venue rental refunds.
 *
 * The refund amount always applies to rental principal only. Processing fees
 * are never refunded here because Stripe has already collected them during the
 * original Checkout payment and refunding them would create platform shortfall.
 */
export async function POST(
  request: NextRequest,
  context: { params: { transactionId: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid transaction id' }, { status: 400 })
    }

    const parsedBody = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'decision is required', details: parsedBody.error.flatten() },
        { status: 422 }
      )
    }

    const supabase = createClient()
    const auth = await getAuthenticatedVenueOwner(supabase)
    if (auth.error || !auth.user || !auth.owner) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createServiceRoleClient() as any
    const transaction = await loadVenuePaymentTransaction(admin, parsedParams.data.transactionId)
    if (!transaction) return NextResponse.json({ error: 'Venue rental payment not found' }, { status: 404 })
    if (transaction.venue_owner_id !== auth.user.id) {
      return NextResponse.json({ error: 'Not authorized for this venue rental payment' }, { status: 403 })
    }
    if (transaction.status !== 'refund_requested') {
      return NextResponse.json({ error: 'Refund request is not pending' }, { status: 409 })
    }

    if (parsedBody.data.decision === 'reject') {
      const updated = await rejectRefund(admin, transaction.id)
      await sendBuilderRefundRejectedEmail({
        transactionId: transaction.id,
        venueNote: parsedBody.data.note ?? null,
      }).catch((emailError) => {
        console.error('[venue-rental.refund-decision] Failed to send refund rejected email', emailError)
      })
      return NextResponse.json({ transaction: updated })
    }

    if (parsedBody.data.decision === 'counter') {
      const counterAmountCents = parsedBody.data.counter_amount_cents
      if (!counterAmountCents) {
        return NextResponse.json({ error: 'counter_amount_cents is required for counter decisions' }, { status: 422 })
      }
      if (!transaction.refund_amount_cents || counterAmountCents >= transaction.refund_amount_cents) {
        return NextResponse.json(
          { error: 'Counter amount must be lower than the original requested refund amount' },
          { status: 422 }
        )
      }

      const updated = await counterRefund(admin, transaction, counterAmountCents, parsedBody.data.note ?? null)
      await sendBuilderRefundCounteredEmail({ transactionId: transaction.id }).catch((emailError) => {
        console.error('[venue-rental.refund-decision] Failed to send refund counter email', emailError)
      })
      return NextResponse.json({ transaction: updated })
    }

    const updated = await approveRefund(admin, transaction, auth.user.id)
    await sendBuilderRefundApprovedEmail({ transactionId: transaction.id }).catch((emailError) => {
      console.error('[venue-rental.refund-decision] Failed to send refund approved email', emailError)
    })
    return NextResponse.json({ transaction: updated })
  } catch (error) {
    console.error('[venue-rental.refund-decision] Failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process venue rental refund decision' },
      { status: error instanceof RouteError ? error.status : 500 }
    )
  }
}

async function loadVenuePaymentTransaction(admin: any, transactionId: string) {
  const { data, error } = await admin
    .from('venue_payment_transactions')
    .select(
      [
        'id',
        'plan_id',
        'venue_booking_id',
        'builder_id',
        'venue_id',
        'venue_owner_id',
        'amount_cents',
        'processing_fee_cents',
        'status',
        'refund_amount_cents',
        'refund_reason',
        'stripe_payment_intent_id',
        'stripe_transfer_id',
      ].join(', ')
    )
    .eq('id', transactionId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load venue rental payment')
  return data as VenuePaymentTransactionForDecision | null
}

async function rejectRefund(admin: any, transactionId: string) {
  const { data, error } = await admin
    .from('venue_payment_transactions')
    .update({
      status: 'paid',
      refund_amount_cents: null,
      refund_reason: null,
      refund_requested_by: null,
      refund_requested_at: null,
      refund_approved_by: null,
      refund_approved_at: null,
    } as never)
    .eq('id', transactionId)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to reject venue rental refund')
  return data
}

async function counterRefund(
  admin: any,
  transaction: VenuePaymentTransactionForDecision,
  counterAmountCents: number,
  venueNote: string | null
) {
  const { data, error } = await admin
    .from('venue_payment_transactions')
    .update({
      status: 'refund_requested',
      refund_amount_cents: counterAmountCents,
      refund_reason: formatCounterReason(transaction.refund_reason, venueNote),
    } as never)
    .eq('id', transaction.id)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to counter venue rental refund')
  return data
}

async function approveRefund(
  admin: any,
  transaction: VenuePaymentTransactionForDecision,
  venueOwnerId: string
) {
  const refundAmountCents = transaction.refund_amount_cents
  if (!refundAmountCents || refundAmountCents <= 0) {
    throw new RouteError('Refund amount is required before approval', 409)
  }
  if (refundAmountCents > transaction.amount_cents) {
    throw new RouteError('Refund amount cannot exceed the original rental payment amount', 422)
  }
  if (!transaction.stripe_transfer_id) {
    throw new RouteError('Missing venue transfer for refund reversal', 409)
  }
  if (!transaction.stripe_payment_intent_id) {
    throw new RouteError('Missing Stripe PaymentIntent for venue rental refund', 409)
  }

  const now = new Date().toISOString()
  const { data: approved, error: approvalError } = await admin
    .from('venue_payment_transactions')
    .update({
      status: 'refund_approved',
      refund_approved_by: venueOwnerId,
      refund_approved_at: now,
    } as never)
    .eq('id', transaction.id)
    .select('*')
    .maybeSingle()

  if (approvalError) throw new Error(approvalError.message ?? 'Failed to save venue rental refund approval')

  const metadata = {
    payment_kind_namespace: VENUE_RENTAL_PAYMENT_NAMESPACE,
    venue_payment_transaction_id: transaction.id,
  }
  const stripe = getStripeClient()
  await (stripe.transfers as any).createReversal(transaction.stripe_transfer_id, {
    amount: refundAmountCents,
    metadata,
  })
  await stripe.refunds.create({
    payment_intent: transaction.stripe_payment_intent_id,
    amount: refundAmountCents,
    metadata,
  })

  return approved
}

function formatCounterReason(originalReason: string | null, venueNote: string | null) {
  return [
    `[Venue counter-offer]: ${venueNote || 'No venue note provided.'}`,
    '',
    `Original request: ${originalReason || 'No reason provided.'}`,
  ].join('\n')
}
