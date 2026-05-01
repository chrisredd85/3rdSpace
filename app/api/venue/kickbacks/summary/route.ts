export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedVenueOwner } from '@/lib/stripe/connect'

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
 * Returns venue owner outgoing kickback obligations.
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
      .from('kickback_payments')
      .select(
        'id, agreement_id, event_id, payer_id, recipient_id, amount, currency, status, failure_reason, notes, initiated_at, completed_at, failed_at, created_at'
      )
      .eq('payer_id', auth.owner.id)
      .order('initiated_at', { ascending: false })
      .limit(50)

    if (paymentsError) throw new Error(paymentsError.message)

    const payments = ((paymentRows || []) as KickbackPaymentRow[])
    const eventIds = [...new Set(payments.map((payment) => payment.event_id))]
    const agreementIds = [...new Set(payments.map((payment) => payment.agreement_id))]
    const recipientIds = [...new Set(payments.map((payment) => payment.recipient_id))]

    const [{ data: events }, { data: agreements }, { data: builders }] = await Promise.all([
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
      recipientIds.length
        ? (admin as any)
            .from('builder_profiles')
            .select('id, user_id, name')
            .in('user_id', recipientIds)
        : { data: [] },
    ])

    const eventById = new Map<string, any>((events || []).map((event: any) => [event.id, event]))
    const agreementById = new Map<string, any>((agreements || []).map((agreement: any) => [agreement.id, agreement]))
    const builderByUserId = new Map<string, any>((builders || []).map((builder: any) => [builder.user_id, builder]))

    const enrichedPayments = payments.map((payment) => {
      const event = eventById.get(payment.event_id)
      const agreement = agreementById.get(payment.agreement_id)
      const builder = builderByUserId.get(payment.recipient_id)

      return {
        ...payment,
        event_name: event?.event_name ?? 'Untitled event',
        event_date: event?.event_date ?? null,
        builder_name: builder?.name ?? 'Event builder',
        actual_attendance: agreement?.actual_attendance ?? null,
        per_head_amount: agreement?.per_head_amount ?? null,
        minimum_attendees: agreement?.minimum_attendees ?? null,
        maximum_payout: agreement?.maximum_payout ?? null,
        agreement_status: agreement?.status ?? null,
      }
    })

    return NextResponse.json({
      summary: {
        pending: sumByStatus(payments, ['pending', 'failed']),
        processing: sumByStatus(payments, ['processing']),
        completed: sumByStatus(payments, ['completed']),
        refunded: sumByStatus(payments, ['refunded']),
        count: payments.length,
      },
      payments: enrichedPayments,
    })
  } catch (error) {
    console.error('[venue.kickbacks.summary] Failed to load kickbacks', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load kickbacks' },
      { status: 500 }
    )
  }
}
