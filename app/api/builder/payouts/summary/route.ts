export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getAuthenticatedBuilderPayoutOwner } from '@/lib/stripe/connect'
import { readCents } from '@/lib/money'

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
  stripe_transfer_id: string | null
  stripe_payout_id: string | null
  processing_fee_cents: number | null
  builder_payout_cents: number | null
  refund_amount_cents: number | null
  refund_reason: string | null
  due_date: string | null
  paid_at: string | null
  initiated_at: string | null
  completed_at: string | null
  failed_at: string | null
  created_at: string | null
}

function sumByStatus(payments: KickbackPaymentRow[], statuses: string[]) {
  return payments
    .filter((payment) => statuses.includes(payment.status))
    .reduce((sum, payment) => sum + getPaymentPrincipalCents(payment), 0)
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
          'id, agreement_id, event_id, payer_id, recipient_id, amount, amount_cents, currency, status, failure_reason, notes, settlement_method, invoice_hosted_url, stripe_invoice_id, stripe_transfer_id, stripe_payout_id, processing_fee_cents, builder_payout_cents, refund_amount_cents, refund_reason, due_date, paid_at, initiated_at, completed_at, failed_at, created_at'
        )
        .eq('recipient_id', auth.user.id)
        .order('created_at', { ascending: false })
        .limit(50),
    ])

    if (paymentsError) {
      throw new Error(paymentsError.message)
    }

    const payments = ((paymentRows || []) as KickbackPaymentRow[])
    const eventIds = [
      ...new Set(payments.map((payment) => payment.event_id).filter((id): id is string => Boolean(id))),
    ]
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
            .select('id, event_id, plan_id, venue_id, per_head_amount, minimum_attendees, maximum_payout, actual_attendance, actual_kickback_amount, reported_revenue_cents, bar_revenue_share_percent, ticket_revenue_share_percent, lift_share_percentage, status')
            .in('id', agreementIds)
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
    const planById = new Map<string, any>((plans || []).map((plan: any) => [plan.id, plan]))
    const venueById = new Map<string, any>((venues || []).map((venue: any) => [venue.id, venue]))

    const enrichedPayments = payments.map((payment) => {
      const event = payment.event_id ? eventById.get(payment.event_id) : null
      const agreement = agreementById.get(payment.agreement_id)
      const plan = agreement?.plan_id ? planById.get(agreement.plan_id) : null
      const venue = agreement?.venue_id ? venueById.get(agreement.venue_id) : null
      const principalCents = getPaymentPrincipalCents(payment)
      const payoutCents = readCents(payment.builder_payout_cents, null) ?? principalCents

      return {
        ...payment,
        amount_cents: principalCents,
        principal_cents: principalCents,
        payout_cents: payoutCents,
        plan_id: agreement?.plan_id ?? null,
        processing_fee_cents: payment.processing_fee_cents ?? 0,
        event_name: event?.event_name ?? plan?.title ?? 'Untitled event',
        event_date: event?.event_date ?? plan?.date_window_start ?? null,
        venue_name: venue?.venue_name ?? 'Venue',
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
      account: account || null,
      summary: {
        pending: sumByStatus(payments, ['pending', 'processing', 'pending_venue_approval', 'invoice_sent', 'refund_requested', 'refund_approved', 'refund_processing']),
        completed: sumByStatus(payments, ['completed', 'paid', 'refunded_partial', 'refunded_full']),
        failed: sumByStatus(payments, ['failed']),
        refunded: sumByStatus(payments, ['refunded', 'refunded_partial', 'refunded_full']),
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

function getPaymentPrincipalCents(payment: Pick<KickbackPaymentRow, 'amount_cents' | 'amount'>) {
  return readCents(payment.amount_cents, payment.amount) ?? 0
}
