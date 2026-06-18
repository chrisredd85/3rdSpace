import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

const OVERDUE_THRESHOLD = 3
const GRACE_PERIOD_DAYS = 7

export type VenueComplianceStatus = {
  is_compliant: boolean
  overdue_count: number
  overdue_threshold: number
  oldest_overdue_event_date: string | null
  reason: string | null
}

type AgreementRow = {
  id: string
  event_id: string | null
  plan_id: string | null
  reported_revenue_cents: number | null
}

type PaymentRow = {
  id: string
  agreement_id: string
  status: string
  paid_at: string | null
  due_date: string | null
}

export async function getVenueComplianceStatus(
  admin: SupabaseClient,
  venueId: string
): Promise<VenueComplianceStatus> {
  const { data: agreements, error: agreementError } = await (admin as any)
    .from('event_kickback_agreements')
    .select('id, event_id, plan_id, reported_revenue_cents')
    .eq('venue_id', venueId)

  if (agreementError) {
    throw new Error(agreementError.message ?? 'Failed to load venue CHI agreements')
  }

  const agreementRows = ((agreements ?? []) as AgreementRow[])
  if (agreementRows.length === 0) return compliantStatus()

  const agreementIds = agreementRows.map((agreement) => agreement.id)
  const { data: payments, error: paymentError } = await (admin as any)
    .from('kickback_payments')
    .select('id, agreement_id, status, paid_at, due_date')
    .in('agreement_id', agreementIds)

  if (paymentError) {
    throw new Error(paymentError.message ?? 'Failed to load venue CHI payments')
  }

  const eventDates = await loadAgreementEventDates(admin, agreementRows)
  const now = new Date()
  const graceCutoff = now.getTime() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
  const agreementById = new Map(agreementRows.map((agreement) => [agreement.id, agreement]))
  const overdueDates: string[] = []

  for (const payment of ((payments ?? []) as PaymentRow[])) {
    const agreement = agreementById.get(payment.agreement_id)
    if (!agreement) continue

    const eventDate = eventDates.get(agreement.id)
    if (!eventDate || eventDate.getTime() >= graceCutoff) continue

    if (isOverduePayment(payment, agreement, now)) {
      overdueDates.push(eventDate.toISOString())
    }
  }

  overdueDates.sort()
  const overdueCount = overdueDates.length
  const isCompliant = overdueCount < OVERDUE_THRESHOLD

  return {
    is_compliant: isCompliant,
    overdue_count: overdueCount,
    overdue_threshold: OVERDUE_THRESHOLD,
    oldest_overdue_event_date: overdueDates[0] ?? null,
    reason: isCompliant
      ? null
      : `Venue has ${overdueCount} overdue revenue reports. Resolve in dashboard to receive new bookings.`,
  }
}

async function loadAgreementEventDates(admin: SupabaseClient, agreements: AgreementRow[]) {
  const datesByAgreementId = new Map<string, Date>()
  const eventIds = Array.from(new Set(agreements.map((agreement) => agreement.event_id).filter(Boolean))) as string[]
  const planIds = Array.from(new Set(agreements.map((agreement) => agreement.plan_id).filter(Boolean))) as string[]

  const [eventsResult, plansResult] = await Promise.all([
    eventIds.length
      ? (admin as any).from('events').select('id, event_date').in('id', eventIds)
      : Promise.resolve({ data: [], error: null }),
    planIds.length
      ? (admin as any).from('plans').select('id, date_window_start').in('id', planIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (eventsResult.error) throw new Error(eventsResult.error.message ?? 'Failed to load event dates')
  if (plansResult.error) throw new Error(plansResult.error.message ?? 'Failed to load plan dates')

  const eventDateById = new Map<string, string | null>(
    ((eventsResult.data ?? []) as Array<{ id: string; event_date: string | null }>)
      .map((event) => [event.id, event.event_date])
  )
  const planDateById = new Map<string, string | null>(
    ((plansResult.data ?? []) as Array<{ id: string; date_window_start: string | null }>)
      .map((plan) => [plan.id, plan.date_window_start])
  )

  for (const agreement of agreements) {
    const eventDate = agreement.event_id
      ? eventDateById.get(agreement.event_id)
      : null
    const planDate = agreement.plan_id ? planDateById.get(agreement.plan_id) : null
    const rawDate = eventDate ?? planDate ?? null
    const parsed = rawDate ? new Date(rawDate) : null
    if (parsed && !Number.isNaN(parsed.getTime())) {
      datesByAgreementId.set(agreement.id, parsed)
    }
  }

  return datesByAgreementId
}

function isOverduePayment(payment: PaymentRow, agreement: AgreementRow, now: Date) {
  if (payment.status === 'pending_venue_approval' && agreement.reported_revenue_cents === null) {
    return true
  }

  if (payment.status === 'invoice_sent' && !payment.paid_at) {
    const dueDate = payment.due_date ? new Date(payment.due_date) : null
    return Boolean(dueDate && !Number.isNaN(dueDate.getTime()) && dueDate.getTime() < now.getTime())
  }

  return false
}

function compliantStatus(): VenueComplianceStatus {
  return {
    is_compliant: true,
    overdue_count: 0,
    overdue_threshold: OVERDUE_THRESHOLD,
    oldest_overdue_event_date: null,
    reason: null,
  }
}
