export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

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

const PAID_STATUSES = new Set(['paid', 'refund_requested', 'refund_approved', 'refunded_partial', 'refunded_full'])

/**
 * Returns outgoing venue rental payments for the authenticated builder's planner plans.
 */
export async function GET() {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const admin = createServiceRoleClient()
    const { data: plans, error: plansError } = await (admin as any)
      .from('plans')
      .select('id, title, date_window_start')
      .eq('user_id', user.id)

    if (plansError) throw new Error(plansError.message)

    const planRows = (plans || []) as Array<{ id: string; title: string | null; date_window_start: string | null }>
    const planIds = planRows.map((plan) => plan.id)
    if (planIds.length === 0) {
      return NextResponse.json(emptyResponse())
    }

    const { data: paymentRows, error: paymentsError } = await (admin as any)
      .from('venue_payment_transactions')
      .select('*')
      .in('plan_id', planIds)
      .order('created_at', { ascending: false })
      .limit(100)

    if (paymentsError) throw new Error(paymentsError.message)

    const payments = ((paymentRows || []) as VenueRentalSummaryRow[])
    const venueIds = [...new Set(payments.map((payment) => payment.venue_id).filter(Boolean))]
    const builderIds = [...new Set(payments.map((payment) => payment.builder_id).filter(Boolean))]

    const [{ data: venues }, { data: builders }] = await Promise.all([
      venueIds.length
        ? (admin as any).from('venues').select('id, venue_name').in('id', venueIds)
        : { data: [] },
      builderIds.length
        ? (admin as any).from('builder_profiles').select('user_id, name').in('user_id', builderIds)
        : { data: [] },
    ])

    const planById = new Map(planRows.map((plan) => [plan.id, plan]))
    const venueById = new Map<string, any>((venues || []).map((venue: any) => [venue.id, venue]))
    const builderByUserId = new Map<string, any>((builders || []).map((builder: any) => [builder.user_id, builder]))

    const transactions = payments.map((payment) => {
      const plan = planById.get(payment.plan_id)
      const venue = venueById.get(payment.venue_id)
      const builder = builderByUserId.get(payment.builder_id)

      return {
        ...payment,
        event_name: plan?.title ?? 'Untitled event',
        event_date: plan?.date_window_start ?? null,
        venue_name: venue?.venue_name ?? 'Venue',
        builder_name: builder?.name ?? 'Event builder',
      }
    })

    return NextResponse.json({
      transactions,
      summary: {
        total_paid_cents: payments
          .filter((payment) => PAID_STATUSES.has(payment.status))
          .reduce((sum, payment) => sum + payment.amount_cents, 0),
        total_processing_fee_cents: payments
          .filter((payment) => PAID_STATUSES.has(payment.status))
          .reduce((sum, payment) => sum + payment.processing_fee_cents, 0),
        refunded_cents: payments.reduce((sum, payment) => sum + (payment.refund_amount_cents ?? 0), 0),
        pending_refund_count: payments.filter((payment) => payment.status === 'refund_requested').length,
        count: payments.length,
      },
    })
  } catch (error) {
    console.error('[planner.payments.venue-rentals.summary] Failed to load venue rentals', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load venue rental payments' },
      { status: 500 }
    )
  }
}

function emptyResponse() {
  return {
    transactions: [],
    summary: {
      total_paid_cents: 0,
      total_processing_fee_cents: 0,
      refunded_cents: 0,
      pending_refund_count: 0,
      count: 0,
    },
  }
}
