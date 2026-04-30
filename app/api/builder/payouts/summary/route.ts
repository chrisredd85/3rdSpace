import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedBuilderPayoutOwner } from '@/lib/stripe/connect'

export const runtime = 'nodejs'

type KickbackPaymentRow = {
  id: string
  agreement_id: string
  event_id: string
  payer_id: string
  recipient_id: string
  amount: number
  currency: string | null
  status: string
  failure_reason: string | null
  notes: string | null
  stripe_transfer_id: string | null
  stripe_payout_id: string | null
  initiated_at: string | null
  completed_at: string | null
  failed_at: string | null
  created_at: string | null
}

function sumByStatus(payments: KickbackPaymentRow[], statuses: string[]) {
  return payments
    .filter((payment) => statuses.includes(payment.status))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
}

/**
 * Returns builder payout readiness and incoming venue kickback payments.
 */
export async function GET() {
  try {
    const supabase = createClient()
    const auth = await getAuthenticatedBuilderPayoutOwner(supabase)

    if (auth.error || !auth.user || !auth.builder) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const admin = createServiceRoleClient()
    const [{ data: account }, { data: paymentRows, error: paymentsError }] = await Promise.all([
      (admin as any)
        .from('builder_stripe_accounts')
        .select('account_status, charges_enabled, payouts_enabled, requirements_due, stripe_account_id')
        .eq('user_id', auth.user.id)
        .maybeSingle(),
      (admin as any)
        .from('kickback_payments')
        .select(
          'id, agreement_id, event_id, payer_id, recipient_id, amount, currency, status, failure_reason, notes, stripe_transfer_id, stripe_payout_id, initiated_at, completed_at, failed_at, created_at'
        )
        .eq('recipient_id', auth.user.id)
        .order('initiated_at', { ascending: false })
        .limit(50),
    ])

    if (paymentsError) {
      throw new Error(paymentsError.message)
    }

    const payments = ((paymentRows || []) as KickbackPaymentRow[])
    const eventIds = [...new Set(payments.map((payment) => payment.event_id))]
    const agreementIds = [...new Set(payments.map((payment) => payment.agreement_id))]

    const [{ data: events }, { data: agreements }] = await Promise.all([
      eventIds.length
        ? (admin as any)
            .from('events')
            .select('id, event_name, event_date, expected_attendance')
            .in('id', eventIds)
        : { data: [] },
      agreementIds.length
        ? (admin as any)
            .from('event_kickback_agreements')
            .select('id, venue_id, per_head_amount, minimum_attendees, maximum_payout, actual_attendance, actual_kickback_amount, status')
            .in('id', agreementIds)
        : { data: [] },
    ])

    const venueIds = [
      ...new Set(
        ((agreements || []) as Array<{ venue_id?: string | null }>)
          .map((agreement) => agreement.venue_id)
          .filter((id): id is string => Boolean(id))
      ),
    ]
    const { data: venues } = venueIds.length
      ? await (admin as any).from('venues').select('id, venue_name').in('id', venueIds)
      : { data: [] }

    const eventById = new Map<string, any>((events || []).map((event: any) => [event.id, event]))
    const agreementById = new Map<string, any>((agreements || []).map((agreement: any) => [agreement.id, agreement]))
    const venueById = new Map<string, any>((venues || []).map((venue: any) => [venue.id, venue]))

    const enrichedPayments = payments.map((payment) => {
      const event = eventById.get(payment.event_id)
      const agreement = agreementById.get(payment.agreement_id)
      const venue = agreement?.venue_id ? venueById.get(agreement.venue_id) : null

      return {
        ...payment,
        event_name: event?.event_name ?? 'Untitled event',
        event_date: event?.event_date ?? null,
        venue_name: venue?.venue_name ?? 'Venue',
        actual_attendance: agreement?.actual_attendance ?? null,
        per_head_amount: agreement?.per_head_amount ?? null,
        minimum_attendees: agreement?.minimum_attendees ?? null,
        maximum_payout: agreement?.maximum_payout ?? null,
        agreement_status: agreement?.status ?? null,
      }
    })

    return NextResponse.json({
      account: account || null,
      summary: {
        pending: sumByStatus(payments, ['pending', 'processing']),
        completed: sumByStatus(payments, ['completed']),
        failed: sumByStatus(payments, ['failed']),
        refunded: sumByStatus(payments, ['refunded']),
        count: payments.length,
      },
      payments: enrichedPayments,
    })
  } catch (error) {
    console.error('[builder.payouts.summary] Failed to load payout summary', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load payout summary' },
      { status: 500 }
    )
  }
}
