export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { sendVenueRefundRequestedEmail } from '@/lib/email'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const paramsSchema = z.object({
  planId: z.string().uuid(),
  transactionId: z.string().uuid(),
})

const bodySchema = z.object({
  refund_amount_cents: z.number().int().positive(),
  reason: z.string().trim().min(10).max(2000),
}).strict()

type VenuePaymentTransactionForRefundRequest = {
  id: string
  plan_id: string
  builder_id: string
  amount_cents: number
  status: string
}

/**
 * Builder-side venue rental refund request.
 *
 * This only records the request and notifies the venue. Stripe refund/reversal
 * execution is intentionally deferred until the venue owner approves through
 * /api/venue/rentals/[transactionId]/refund-decision.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ planId: string; transactionId: string }> }
) {
  try {
    const parsedParams = paramsSchema.safeParse((await context.params))
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid refund request params' }, { status: 400 })
    }

    const parsedBody = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'refund_amount_cents and reason are required', details: parsedBody.error.flatten() },
        { status: 422 }
      )
    }

    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    if (user.user_metadata?.user_type !== 'community_builder') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const admin = createServiceRoleClient() as any
    const plan = await loadPlan(admin, parsedParams.data.planId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (plan.user_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized for this plan' }, { status: 403 })
    }

    const transaction = await loadVenuePaymentTransaction(admin, parsedParams.data.transactionId)
    if (!transaction || transaction.plan_id !== plan.id) {
      return NextResponse.json({ error: 'Venue rental payment not found' }, { status: 404 })
    }
    if (transaction.builder_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized for this venue rental payment' }, { status: 403 })
    }
    if (transaction.status === 'refunded_full' || transaction.status === 'refunded_partial') {
      return NextResponse.json({ error: 'Venue rental payment has already been refunded' }, { status: 409 })
    }
    if (transaction.status !== 'paid') {
      return NextResponse.json({ error: 'Refunds can only be requested for paid venue rentals' }, { status: 409 })
    }
    if (parsedBody.data.refund_amount_cents > transaction.amount_cents) {
      return NextResponse.json({ error: 'Refund amount cannot exceed the rental payment amount' }, { status: 422 })
    }

    const now = new Date().toISOString()
    const { data: updated, error: updateError } = await admin
      .from('venue_payment_transactions')
      .update({
        status: 'refund_requested',
        refund_amount_cents: parsedBody.data.refund_amount_cents,
        refund_reason: parsedBody.data.reason,
        refund_requested_by: user.id,
        refund_requested_at: now,
        refund_approved_by: null,
        refund_approved_at: null,
      } as never)
      .eq('id', transaction.id)
      .select('*')
      .maybeSingle()

    if (updateError) throw new Error(updateError.message ?? 'Failed to request venue rental refund')

    await sendVenueRefundRequestedEmail({ transactionId: transaction.id }).catch((emailError) => {
      console.error('[venue-rental.refund-request] Failed to send venue refund request email', emailError)
    })

    return NextResponse.json({ transaction: updated })
  } catch (error) {
    console.error('[venue-rental.refund-request] Failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to request venue rental refund' },
      { status: 500 }
    )
  }
}

async function loadPlan(admin: any, planId: string) {
  const { data, error } = await admin
    .from('plans')
    .select('id, user_id')
    .eq('id', planId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load plan')
  return data as { id: string; user_id: string } | null
}

async function loadVenuePaymentTransaction(admin: any, transactionId: string) {
  const { data, error } = await admin
    .from('venue_payment_transactions')
    .select('id, plan_id, builder_id, amount_cents, status')
    .eq('id', transactionId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load venue rental payment')
  return data as VenuePaymentTransactionForRefundRequest | null
}
