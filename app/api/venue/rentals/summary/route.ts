export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedVenueOwner } from '@/lib/stripe/connect'

type VenueRentalSummaryRow = {
  id: string
  plan_id: string
  venue_booking_id: string | null
  builder_id: string
  venue_id: string
  venue_owner_id: string
  amount_cents: number
  processing_fee_cents: number
  venue_payout_cents: number
  currency: string
  status: string
  payment_method_type: string
  stripe_checkout_session_id: string | null
  stripe_payment_intent_id: string | null
  stripe_charge_id: string | null
  stripe_transfer_id: string | null
  stripe_refund_id: string | null
  stripe_transfer_reversal_id: string | null
  refund_amount_cents: number | null
  refund_reason: string | null
  refund_requested_at: string | null
  refund_approved_at: string | null
  paid_at: string | null
  transfer_completed_at: string | null
  failed_at: string | null
  failure_reason: string | null
  created_at: string
}

const RECEIVED_STATUSES = new Set(['paid', 'refund_requested', 'refund_approved', 'refunded_partial', 'refunded_full'])

/**
 * Returns incoming venue rental payments for the authenticated venue owner.
 */
export async function GET() {
  try {
    const supabase = createClient()
    const auth = await getAuthenticatedVenueOwner(supabase)

    if (auth.error || !auth.user || !auth.owner) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createServiceRoleClient()
    const { data: paymentRows, error: paymentsError } = await (admin as any)
      .from('venue_payment_transactions')
      .select('*')
      .eq('venue_owner_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (paymentsError) throw new Error(paymentsError.message)

    const payments = ((paymentRows || []) as VenueRentalSummaryRow[])
    const planIds = [...new Set(payments.map((payment) => payment.plan_id).filter(Boolean))]
    const builderIds = [...new Set(payments.map((payment) => payment.builder_id).filter(Boolean))]

    const [{ data: plans }, { data: builders }] = await Promise.all([
      planIds.length
        ? (admin as any).from('plans').select('id, title, date_window_start').in('id', planIds)
        : { data: [] },
      builderIds.length
        ? (admin as any).from('builder_profiles').select('user_id, name').in('user_id', builderIds)
        : { data: [] },
    ])

    const planById = new Map<string, any>((plans || []).map((plan: any) => [plan.id, plan]))
    const builderByUserId = new Map<string, any>((builders || []).map((builder: any) => [builder.user_id, builder]))

    const transactions = payments.map((payment) => {
      const plan = planById.get(payment.plan_id)
      const builder = builderByUserId.get(payment.builder_id)

      return {
        ...payment,
        event_name: plan?.title ?? 'Untitled event',
        event_date: plan?.date_window_start ?? null,
        builder_name: builder?.name ?? 'Event builder',
      }
    })

    return NextResponse.json({
      transactions,
      summary: {
        total_received_cents: payments
          .filter((payment) => RECEIVED_STATUSES.has(payment.status))
          .reduce((sum, payment) => sum + Math.max(0, payment.venue_payout_cents - (payment.refund_amount_cents ?? 0)), 0),
        pending_refund_requests: payments.filter((payment) => payment.status === 'refund_requested').length,
        refunded_cents: payments.reduce((sum, payment) => sum + (payment.refund_amount_cents ?? 0), 0),
        count: payments.length,
      },
    })
  } catch (error) {
    console.error('[venue.rentals.summary] Failed to load venue rental payments', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load venue rental payments' },
      { status: 500 }
    )
  }
}
