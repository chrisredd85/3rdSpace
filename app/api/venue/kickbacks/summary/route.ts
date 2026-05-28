export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { readCents } from '@/lib/money'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedVenueOwner } from '@/lib/stripe/connect'

export const runtime = 'nodejs'

type KickbackPaymentRow = {
  id: string
  agreement_id: string
  event_id: string | null
  payer_id: string
  recipient_id: string
  amount: number | null
  amount_cents: number | null
  currency: string | null
  status: string
  failure_reason: string | null
  notes: string | null
  settlement_method: string | null
  invoice_hosted_url: string | null
  stripe_invoice_id: string | null
  processing_fee_cents: number | null
  builder_payout_cents: number | null
  refund_amount_cents: number | null
  refund_reason: string | null
  refund_requested_at: string | null
  due_date: string | null
  paid_at: string | null
  initiated_at: string | null
  completed_at: string | null
  failed_at: string | null
  created_at: string | null
}

function getPaymentPrincipalCents(payment: Pick<KickbackPaymentRow, 'amount_cents' | 'amount'>) {
  return readCents(payment.amount_cents, payment.amount) ?? 0
}

function sumByStatus(payments: KickbackPaymentRow[], statuses: string[]) {
  return payments
    .filter((payment) => statuses.includes(payment.status))
    .reduce((sum, payment) => sum + getPaymentPrincipalCents(payment), 0)
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
        'id, agreement_id, event_id, payer_id, recipient_id, amount, amount_cents, currency, status, failure_reason, notes, settlement_method, invoice_hosted_url, stripe_invoice_id, processing_fee_cents, builder_payout_cents, refund_amount_cents, refund_reason, refund_requested_at, due_date, paid_at, initiated_at, completed_at, failed_at, created_at'
      )
      .eq('payer_id', auth.owner.id)
      .order('initiated_at', { ascending: false })
      .limit(50)

    if (paymentsError) throw new Error(paymentsError.message)

    const payments = ((paymentRows || []) as KickbackPaymentRow[])
    const eventIds = [
      ...new Set(payments.map((payment) => payment.event_id).filter((id): id is string => Boolean(id))),
    ]
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
            .select('id, event_id, plan_id, venue_id, per_head_amount, minimum_attendees, maximum_payout, actual_attendance, actual_kickback_amount, reported_revenue_cents, bar_revenue_share_percent, ticket_revenue_share_percent, lift_share_percentage, status')
            .in('id', agreementIds)
        : { data: [] },
      recipientIds.length
        ? (admin as any)
            .from('builder_profiles')
            .select('id, user_id, name')
            .in('user_id', recipientIds)
        : { data: [] },
    ])

    const planIds = [
      ...new Set(
        ((agreements || []) as Array<{ plan_id?: string | null }>)
          .map((agreement) => agreement.plan_id)
          .filter((id): id is string => Boolean(id))
      ),
    ]
    const { data: plans } = planIds.length
      ? await (admin as any).from('plans').select('id, title, date_window_start').in('id', planIds)
      : { data: [] }

    const eventById = new Map<string, any>((events || []).map((event: any) => [event.id, event]))
    const agreementById = new Map<string, any>((agreements || []).map((agreement: any) => [agreement.id, agreement]))
    const builderByUserId = new Map<string, any>((builders || []).map((builder: any) => [builder.user_id, builder]))
    const planById = new Map<string, any>((plans || []).map((plan: any) => [plan.id, plan]))

    const enrichedPayments = payments.map((payment) => {
      const agreement = agreementById.get(payment.agreement_id)
      const event = payment.event_id ? eventById.get(payment.event_id) : null
      const plan = agreement?.plan_id ? planById.get(agreement.plan_id) : null
      const builder = builderByUserId.get(payment.recipient_id)
      const principalCents = getPaymentPrincipalCents(payment)
      const payoutCents = readCents(payment.builder_payout_cents, null) ?? principalCents

      return {
        ...payment,
        amount_cents: principalCents,
        principal_cents: principalCents,
        payout_cents: payoutCents,
        processing_fee_cents: payment.processing_fee_cents ?? 0,
        event_name: event?.event_name ?? plan?.title ?? 'Untitled event',
        event_date: event?.event_date ?? plan?.date_window_start ?? null,
        builder_name: builder?.name ?? 'Event builder',
        actual_attendance: agreement?.actual_attendance ?? null,
        per_head_amount: agreement?.per_head_amount ?? null,
        minimum_attendees: agreement?.minimum_attendees ?? null,
        maximum_payout: agreement?.maximum_payout ?? null,
        reported_revenue_cents: agreement?.reported_revenue_cents ?? null,
        revenue_share_percent:
          agreement?.bar_revenue_share_percent ??
          agreement?.ticket_revenue_share_percent ??
          agreement?.lift_share_percentage ??
          null,
        agreement_status: agreement?.status ?? null,
      }
    })

    return NextResponse.json({
      summary: {
        pending: sumByStatus(payments, ['pending', 'failed', 'pending_venue_approval', 'invoice_failed']),
        processing: sumByStatus(payments, ['processing', 'invoice_sent', 'refund_requested', 'refund_approved', 'refund_processing']),
        completed: sumByStatus(payments, ['completed', 'paid', 'refunded_partial', 'refunded_full']),
        refunded: sumByStatus(payments, ['refunded', 'refunded_partial', 'refunded_full']),
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
