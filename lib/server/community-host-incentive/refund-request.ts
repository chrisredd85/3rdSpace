export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { sendBuilderRefundRequestEmail } from '@/lib/email'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedVenueOwner } from '@/lib/stripe/connect'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const bodySchema = z.object({
  refund_amount_cents: z.number().int().positive(),
  reason: z.string().trim().min(1).max(2000),
})

class RouteError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const parsedParams = paramsSchema.safeParse(await context.params)
    if (!parsedParams.success) {
      return NextResponse.json({ error: 'Invalid payment id' }, { status: 400 })
    }
    const paymentId = parsedParams.data.id

    const supabase = createClient()
    const auth = await getAuthenticatedVenueOwner(supabase)
    if (auth.error || !auth.user || !auth.owner) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = bodySchema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json({ error: 'refund_amount_cents and reason are required' }, { status: 400 })
    }

    const admin = createServiceRoleClient() as any
    const payment = await loadPayment(admin, paymentId)
    if (!payment) return NextResponse.json({ error: 'Community Host Incentive payment not found' }, { status: 404 })
    if (payment.status !== 'paid') {
      return NextResponse.json({ error: 'Refunds can only be requested for paid Community Host Incentives' }, { status: 409 })
    }

    const agreement = await loadAgreement(admin, payment.agreement_id)
    if (!agreement) return NextResponse.json({ error: 'Community Host Incentive agreement not found' }, { status: 404 })
    await assertVenueOwner(admin, agreement, auth.user.id)

    const maxRefundCents = Number(payment.builder_payout_cents ?? payment.amount_cents ?? 0)
    if (body.data.refund_amount_cents > maxRefundCents) {
      return NextResponse.json({ error: 'Refund amount cannot exceed the builder payout' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const { data: updated, error: updateError } = await admin
      .from('kickback_payments')
      .update({
        status: 'refund_requested',
        refund_amount_cents: body.data.refund_amount_cents,
        refund_reason: body.data.reason,
        refund_requested_at: now,
        refund_requested_by: auth.user.id,
      })
      .eq('id', payment.id)
      .select('*')
      .maybeSingle()

    if (updateError) throw new Error(updateError.message ?? 'Failed to request refund')

    await sendBuilderRefundRequestEmail({ paymentId: payment.id }).catch((error) => {
      console.error('[community-host-incentive.refund-request] Failed to send builder refund email', error)
    })

    return NextResponse.json({ payment: updated })
  } catch (error) {
    console.error('[community-host-incentive.refund-request] Failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to request refund' },
      { status: error instanceof RouteError ? error.status : 500 }
    )
  }
}

async function loadPayment(admin: any, paymentId: string) {
  const { data, error } = await admin
    .from('kickback_payments')
    .select('id, agreement_id, status, amount_cents, builder_payout_cents')
    .eq('id', paymentId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load Community Host Incentive payment')
  return data as {
    id: string
    agreement_id: string
    status: string
    amount_cents: number | null
    builder_payout_cents: number | null
  } | null
}

async function loadAgreement(admin: any, agreementId: string) {
  const { data, error } = await admin
    .from('event_kickback_agreements')
    .select('id, venue_id, venue_owner_id')
    .eq('id', agreementId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load kickback agreement')
  return data as { id: string; venue_id: string; venue_owner_id: string | null } | null
}

async function assertVenueOwner(admin: any, agreement: { venue_id: string; venue_owner_id: string | null }, userId: string) {
  if (agreement.venue_owner_id === userId) return

  const { data, error } = await admin
    .from('venues')
    .select('owner_id')
    .eq('id', agreement.venue_id)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to verify venue owner')
  if ((data as { owner_id?: string | null } | null)?.owner_id !== userId) {
    throw new RouteError('Not authorized for this Community Host Incentive', 403)
  }
}
