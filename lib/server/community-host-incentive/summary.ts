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

type KickbackAgreementRow = {
  id: string
  event_id: string | null
  plan_id: string | null
  venue_id: string
  builder_id: string
  actual_attendance: number | null
  per_head_amount: number | null
  minimum_attendees: number | null
  maximum_payout: number | null
  actual_kickback_amount: number | null
  reported_revenue_cents: number | null
  revenue_proof_url: string | null
  revenue_extracted_value_cents: number | null
  revenue_extraction_confidence: string | null
  revenue_submitted_at: string | null
  bar_revenue_share_percent: number | null
  ticket_revenue_share_percent: number | null
  lift_share_percentage: number | null
  status: string
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
 * Returns venue owner outgoing Community Host Incentive obligations.
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
    const { data: agreementRows, error: agreementsError } = await (admin as any)
      .from('event_kickback_agreements')
      .select(
        [
          'id',
          'event_id',
          'plan_id',
          'venue_id',
          'builder_id',
          'actual_attendance',
          'per_head_amount',
          'minimum_attendees',
          'maximum_payout',
          'actual_kickback_amount',
          'reported_revenue_cents',
          'revenue_proof_url',
          'revenue_extracted_value_cents',
          'revenue_extraction_confidence',
          'revenue_submitted_at',
          'bar_revenue_share_percent',
          'ticket_revenue_share_percent',
          'lift_share_percentage',
          'status',
        ].join(', ')
      )
      .eq('venue_owner_id', auth.owner.id)

    if (agreementsError) throw new Error(agreementsError.message)

    const ownedAgreements = ((agreementRows || []) as KickbackAgreementRow[])
    const eventIds = [
      ...new Set([
        ...payments.map((payment) => payment.event_id),
        ...ownedAgreements.map((agreement) => agreement.event_id),
      ].filter((id): id is string => Boolean(id))),
    ]
    const agreementIds = [...new Set([
      ...payments.map((payment) => payment.agreement_id),
      ...ownedAgreements.map((agreement) => agreement.id),
    ])]
    const recipientIds = [...new Set([
      ...payments.map((payment) => payment.recipient_id),
      ...ownedAgreements.map((agreement) => agreement.builder_id),
    ])]

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
            .select('id, event_id, plan_id, venue_id, builder_id, per_head_amount, minimum_attendees, maximum_payout, actual_attendance, actual_kickback_amount, reported_revenue_cents, revenue_proof_url, revenue_extracted_value_cents, revenue_extraction_confidence, revenue_submitted_at, bar_revenue_share_percent, ticket_revenue_share_percent, lift_share_percentage, status')
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
    const paymentByAgreementId = new Map<string, KickbackPaymentRow>(
      payments.map((payment) => [payment.agreement_id, payment])
    )
    const displayAgreementIds = new Set<string>([
      ...ownedAgreements
        .filter((agreement) => shouldSurfaceAgreementForSpendReport(agreement))
        .map((agreement) => agreement.id),
      ...payments.map((payment) => payment.agreement_id),
    ])

    const enrichedPayments = Array.from(displayAgreementIds).map((agreementId) => {
      const payment = paymentByAgreementId.get(agreementId) ?? null
      const agreement = agreementById.get(agreementId)
      const eventId = payment?.event_id ?? agreement?.event_id ?? null
      const event = eventId ? eventById.get(eventId) : null
      const plan = agreement?.plan_id ? planById.get(agreement.plan_id) : null
      const builderId = payment?.recipient_id ?? agreement?.builder_id ?? null
      const builder = builderId ? builderByUserId.get(builderId) : null
      const principalCents = payment ? getPaymentPrincipalCents(payment) : 0
      const payoutCents = readCents(payment?.builder_payout_cents, null) ?? principalCents

      return {
        ...(payment ?? buildAgreementPlaceholderPayment(agreement, auth.owner.id)),
        amount_cents: principalCents,
        principal_cents: principalCents,
        payout_cents: payoutCents,
        processing_fee_cents: payment?.processing_fee_cents ?? 0,
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
        agreement_id: agreement?.id ?? payment?.agreement_id ?? null,
        payment_id: payment?.id ?? null,
        proof_status: getRevenueProofStatus(agreement, payment),
        revenue_proof_url: agreement?.revenue_proof_url ?? null,
        revenue_submitted_at: agreement?.revenue_submitted_at ?? null,
        revenue_extracted_value_cents: agreement?.revenue_extracted_value_cents ?? null,
        revenue_extraction_confidence: agreement?.revenue_extraction_confidence ?? null,
        requires_manual_review: Boolean(
          agreement?.revenue_extraction_confidence === 'low' ||
          (agreement?.revenue_submitted_at && agreement?.reported_revenue_cents == null)
        ),
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
    console.error('[venue.community-host-incentive.summary] Failed to load records', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load Community Host Incentive records' },
      { status: 500 }
    )
  }
}

function shouldSurfaceAgreementForSpendReport(agreement: KickbackAgreementRow) {
  if (agreement.status === 'cancelled') return false
  if (agreement.actual_attendance == null && !agreement.revenue_submitted_at && agreement.reported_revenue_cents == null) {
    return false
  }
  return true
}

function buildAgreementPlaceholderPayment(
  agreement: KickbackAgreementRow | undefined,
  venueOwnerId: string
): KickbackPaymentRow {
  const agreementId = agreement?.id ?? 'unknown'
  return {
    id: `agreement:${agreementId}`,
    agreement_id: agreementId,
    event_id: agreement?.event_id ?? null,
    payer_id: venueOwnerId,
    recipient_id: agreement?.builder_id ?? '',
    amount: null,
    amount_cents: null,
    currency: 'usd',
    status: agreement?.revenue_submitted_at ? 'pending_venue_approval' : 'revenue_report_needed',
    failure_reason: null,
    notes: null,
    settlement_method: 'invoice',
    invoice_hosted_url: null,
    stripe_invoice_id: null,
    processing_fee_cents: null,
    builder_payout_cents: null,
    refund_amount_cents: null,
    refund_reason: null,
    refund_requested_at: null,
    due_date: null,
    paid_at: null,
    initiated_at: null,
    completed_at: null,
    failed_at: null,
    created_at: null,
  }
}

function getRevenueProofStatus(
  agreement: KickbackAgreementRow | null | undefined,
  payment: KickbackPaymentRow | null
) {
  if (!agreement) return 'unavailable'
  if (agreement.actual_attendance == null && !agreement.revenue_submitted_at) return 'waiting_for_attendance'
  if (agreement.revenue_extraction_confidence === 'low' || (agreement.revenue_submitted_at && agreement.reported_revenue_cents == null)) {
    return 'manual_review'
  }
  if (agreement.revenue_submitted_at || agreement.reported_revenue_cents != null || agreement.revenue_proof_url) {
    return payment ? 'submitted' : 'ready_for_invoice_review'
  }
  return 'needed'
}
