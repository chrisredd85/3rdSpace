'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, CreditCard, ExternalLink, Loader2, RefreshCw, RotateCcw, ShieldCheck, WalletCards, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { centsToDollars, dollarsToCents } from '@/lib/money'
import { cn } from '@/lib/utils'

type BuilderPayoutPayment = {
  id: string
  plan_id?: string | null
  event_name: string
  event_date: string | null
  venue_name: string
  status: string
  amount_cents: number
  principal_cents?: number | null
  payout_cents?: number | null
  processing_fee_cents?: number | null
  reported_revenue_cents?: number | null
  consumption_share_percent?: number | null
  refund_amount_cents?: number | null
  refund_reason?: string | null
  invoice_hosted_url?: string | null
  paid_at?: string | null
  completed_at?: string | null
  created_at?: string | null
}

type BuilderPayoutSummary = {
  account: {
    account_status?: string | null
    charges_enabled?: boolean | null
    payouts_enabled?: boolean | null
    stripe_account_id?: string | null
  } | null
  summary: {
    pending: number
    completed: number
    failed: number
    refunded: number
    count: number
  }
  payments: BuilderPayoutPayment[]
  error?: string
}

type VenueRentalPayment = {
  id: string
  plan_id: string
  venue_booking_id?: string | null
  event_name: string
  event_date: string | null
  venue_name: string
  builder_name?: string | null
  amount_cents: number
  processing_fee_cents: number
  venue_payout_cents: number
  status: string
  payment_method_type: string
  paid_at?: string | null
  transfer_completed_at?: string | null
  created_at?: string | null
  stripe_transfer_id?: string | null
  refund_amount_cents?: number | null
  refund_reason?: string | null
  refund_requested_at?: string | null
  refund_approved_at?: string | null
}

type VenueRentalSummary = {
  summary: {
    total_paid_cents: number
    total_processing_fee_cents: number
    refunded_cents: number
    pending_refund_count: number
    count: number
  }
  transactions: VenueRentalPayment[]
  error?: string
}

const emptySummary: BuilderPayoutSummary = {
  account: null,
  summary: {
    pending: 0,
    completed: 0,
    failed: 0,
    refunded: 0,
    count: 0,
  },
  payments: [],
}

const emptyVenueRentalSummary: VenueRentalSummary = {
  summary: {
    total_paid_cents: 0,
    total_processing_fee_cents: 0,
    refunded_cents: 0,
    pending_refund_count: 0,
    count: 0,
  },
  transactions: [],
}

const paidStatuses = new Set(['paid', 'completed', 'refunded_partial', 'refunded_full'])
const pendingStatuses = new Set(['pending', 'processing', 'pending_venue_approval', 'invoice_sent', 'refund_requested', 'refund_approved', 'refund_processing'])

/**
 * Payments and approvals operations route for the planner shell.
 */
export default function PaymentsPage() {
  const [data, setData] = useState<BuilderPayoutSummary>(emptySummary)
  const [venueRentalData, setVenueRentalData] = useState<VenueRentalSummary>(emptyVenueRentalSummary)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refundDecisionLoading, setRefundDecisionLoading] = useState<string | null>(null)
  const [rentalSortNewestFirst, setRentalSortNewestFirst] = useState(true)
  const [rentalRefundPayment, setRentalRefundPayment] = useState<VenueRentalPayment | null>(null)
  const [rentalRefundAmount, setRentalRefundAmount] = useState('')
  const [rentalRefundReason, setRentalRefundReason] = useState('')
  const [isRentalRefundSubmitting, setIsRentalRefundSubmitting] = useState(false)

  const loadPayouts = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [payoutResponse, rentalResponse] = await Promise.all([
        fetch('/api/builder/payouts/summary', { cache: 'no-store' }),
        fetch('/api/planner/payments/venue-rentals/summary', { cache: 'no-store' }),
      ])
      const payoutPayload = await payoutResponse.json().catch(() => ({}))
      const rentalPayload = await rentalResponse.json().catch(() => ({}))
      if (!payoutResponse.ok) throw new Error(payoutPayload?.error ?? 'Unable to load payout payments')
      if (!rentalResponse.ok) throw new Error(rentalPayload?.error ?? 'Unable to load venue rental payments')
      setData(payoutPayload as BuilderPayoutSummary)
      setVenueRentalData(rentalPayload as VenueRentalSummary)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load payments')
      setData(emptySummary)
      setVenueRentalData(emptyVenueRentalSummary)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPayouts()
  }, [loadPayouts])

  const paidThisMonthCents = useMemo(() => {
    const now = new Date()
    return data.payments
      .filter((payment) => paidStatuses.has(payment.status))
      .filter((payment) => {
        const rawDate = payment.paid_at ?? payment.completed_at ?? payment.created_at
        if (!rawDate) return false
        const date = new Date(rawDate)
        return !Number.isNaN(date.getTime()) &&
          date.getUTCFullYear() === now.getUTCFullYear() &&
          date.getUTCMonth() === now.getUTCMonth()
      })
      .reduce((sum, payment) => sum + getPayoutCents(payment), 0)
  }, [data.payments])

  const paymentMetrics = [
    { label: 'Total earned', value: formatCents(data.summary.completed), detail: 'All settled Community Host Incentives' },
    { label: 'Pending', value: formatCents(data.summary.pending), detail: 'Awaiting report, invoice payment, or refund decision' },
    { label: 'Paid this month', value: formatCents(paidThisMonthCents), detail: 'Transferred or completed in the current month' },
    { label: 'Ledger entries', value: String(data.summary.count), detail: 'Incentives tied to event agreements' },
  ]

  const refundRequests = data.payments.filter((payment) => payment.status === 'refund_requested')
  const ledgerRows = data.payments
  const venueRentalRows = useMemo(() => {
    return [...venueRentalData.transactions].sort((first, second) => {
      const firstTime = getVenueRentalSortTime(first)
      const secondTime = getVenueRentalSortTime(second)
      return rentalSortNewestFirst ? secondTime - firstTime : firstTime - secondTime
    })
  }, [venueRentalData.transactions, rentalSortNewestFirst])

  function openRentalRefund(payment: VenueRentalPayment) {
    setRentalRefundPayment(payment)
    setRentalRefundAmount(centsToDollars(payment.amount_cents).toFixed(2))
    setRentalRefundReason('')
    setError(null)
  }

  async function submitRentalRefundRequest() {
    if (!rentalRefundPayment) return

    const refundAmountCents = dollarsToCents(rentalRefundAmount)
    if (refundAmountCents <= 0) {
      setError('Refund amount must be greater than $0.00.')
      return
    }
    if (refundAmountCents > rentalRefundPayment.amount_cents) {
      setError('Refund amount cannot exceed the rental principal.')
      return
    }
    if (rentalRefundReason.trim().length < 10) {
      setError('Refund reason must be at least 10 characters.')
      return
    }

    setIsRentalRefundSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`/api/planner/plans/${rentalRefundPayment.plan_id}/venue-payment/${rentalRefundPayment.id}/refund-request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          refund_amount_cents: refundAmountCents,
          reason: rentalRefundReason.trim(),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to request venue rental refund')
      setRentalRefundPayment(null)
      setRentalRefundAmount('')
      setRentalRefundReason('')
      await loadPayouts()
    } catch (refundError) {
      setError(refundError instanceof Error ? refundError.message : 'Unable to request venue rental refund')
    } finally {
      setIsRentalRefundSubmitting(false)
    }
  }

  const decideRefund = async (
    payment: BuilderPayoutPayment,
    decision: 'approve' | 'reject',
    counterAmountCents?: number
  ) => {
    if (!payment.plan_id) {
      setError('This refund request is missing a plan link. Ask support to review it manually.')
      return
    }

    setRefundDecisionLoading(`${payment.id}:${decision}`)
    setError(null)

    try {
      const response = await fetch(`/api/planner/plans/${payment.plan_id}/refund-decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payment_id: payment.id,
          decision,
          ...(counterAmountCents ? { counter_amount_cents: counterAmountCents } : {}),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to update refund request')
      await loadPayouts()
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'Unable to update refund request')
    } finally {
      setRefundDecisionLoading(null)
    }
  }

  const counterRefund = async (payment: BuilderPayoutPayment) => {
    const entered = window.prompt('Counter refund amount in dollars')
    if (!entered) return
    const amount = dollarsToCents(entered)
    if (amount <= 0) {
      setError('Counter amount must be greater than $0.00.')
      return
    }
    await decideRefund(payment, 'approve', amount)
  }

  return (
    <div className="min-h-screen">
      <div className="border-b border-tan px-6 py-5">
        <h1 className="font-display text-2xl font-bold">Payments & Approvals</h1>
        <p className="mt-1 text-sm text-ink-soft">Authorize agent actions, track deposits, and keep spend tied to the active event plan.</p>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <section className="rounded-lg border border-tan bg-cream p-5 shadow-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">Payment Control Center</p>
              <h2 className="mt-2 font-display text-xl font-bold text-ink">No money moves without organizer approval</h2>
              <p className="mt-1 max-w-2xl text-sm text-ink-soft">
                Track Community Host Incentives, approval requests, deposit deadlines, and partner payment history from one ledger.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="glass" size="sm" onClick={() => void loadPayouts()} disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
              <Button variant="hero" size="sm" asChild>
                <Link href="/planner">
                  Start from plan
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {paymentMetrics.map((metric) => (
              <div key={metric.label} className="rounded-lg border border-tan bg-cream-deep/60 p-4">
                <p className="text-xs font-semibold text-ink-soft">{metric.label}</p>
                <p className="mt-2 font-display text-2xl font-bold text-ink">{metric.value}</p>
                <p className="mt-1 text-xs leading-snug text-ink-soft">{metric.detail}</p>
              </div>
            ))}
          </div>

          {error ? (
            <div className="mt-4 flex gap-2 rounded-lg border border-brick/40 bg-brick-tint px-4 py-3 text-sm text-brick">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </section>

        {refundRequests.length > 0 ? (
          <section className="rounded-lg border border-clay/30 bg-clay-tint p-5 shadow-card">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-clay/20 text-clay">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-ink">Refund Requests</h2>
                <p className="text-sm text-ink-soft">Pending venue refund requests will become actionable in the refund flow.</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {refundRequests.map((payment) => (
                <div key={payment.id} className="rounded-lg border border-tan bg-cream-deep/60 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                <p className="font-semibold text-ink">{payment.event_name}</p>
                      <p className="text-sm text-ink-soft">
                        {payment.venue_name} requested {formatCents(payment.refund_amount_cents ?? getPayoutCents(payment))}.
                      </p>
                      {payment.refund_reason ? (
                        <p className="mt-1 text-xs text-ink-soft">Reason: {payment.refund_reason}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="hero"
                        size="sm"
                        disabled={Boolean(refundDecisionLoading)}
                        onClick={() => void decideRefund(payment, 'approve')}
                      >
                        {refundDecisionLoading === `${payment.id}:approve` ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Approve
                      </Button>
                      <Button
                        type="button"
                        variant="glass"
                        size="sm"
                        disabled={Boolean(refundDecisionLoading)}
                        onClick={() => void counterRefund(payment)}
                      >
                        Counter
                      </Button>
                      <Button
                        type="button"
                        variant="glass"
                        size="sm"
                        disabled={Boolean(refundDecisionLoading)}
                        onClick={() => void decideRefund(payment, 'reject')}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-lg border border-tan bg-cream shadow-card">
            <div className="border-b border-tan p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cream-deep text-clay">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-ink">Approval Queue</h2>
                  <p className="text-sm text-ink-soft">Venue holds, vendor outreach, and deposit payments waiting for action.</p>
                </div>
              </div>
            </div>
            <div className="p-5">
              <div className="rounded-lg border border-dashed border-tan bg-cream-deep/55 p-8 text-center">
                <CreditCard className="mx-auto h-8 w-8 text-ink-soft" />
                <h3 className="mt-3 font-display text-lg font-bold text-ink">No approvals pending</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">
                  Recommendation buttons create approval requests here. Once a venue or vendor accepts, the payment row will show amount, deadline, refund terms, and status.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-tan bg-cream p-5 shadow-card">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cream-deep text-clay">
                <Clock3 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-ink">Payout Readiness</h2>
                <p className="text-sm text-ink-soft">Builder Connect account status for venue payouts.</p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <ReadinessRow label="Connect account" ready={Boolean(data.account?.stripe_account_id)} />
              <ReadinessRow label="Payouts enabled" ready={Boolean(data.account?.payouts_enabled)} />
              <ReadinessRow label="Charges enabled" ready={Boolean(data.account?.charges_enabled)} />
            </div>
          </section>
        </div>

        <section className="rounded-lg border border-tan bg-cream p-5 shadow-card">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cream-deep text-clay">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-ink">Venue Rental Payments</h2>
                <p className="text-sm text-ink-soft">Outgoing rental payments tied to confirmed venue bookings.</p>
              </div>
            </div>
            <Button
              type="button"
              variant="glass"
              size="sm"
              onClick={() => setRentalSortNewestFirst((current) => !current)}
            >
              {rentalSortNewestFirst ? 'Newest first' : 'Oldest first'}
            </Button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-tan bg-cream-deep/60 p-4">
              <p className="text-xs font-semibold text-ink-soft">Paid principal</p>
              <p className="mt-2 font-display text-2xl font-bold text-ink">{formatCents(venueRentalData.summary.total_paid_cents)}</p>
            </div>
            <div className="rounded-lg border border-tan bg-cream-deep/60 p-4">
              <p className="text-xs font-semibold text-ink-soft">Processing fees</p>
              <p className="mt-2 font-display text-2xl font-bold text-ink">{formatCents(venueRentalData.summary.total_processing_fee_cents)}</p>
            </div>
            <div className="rounded-lg border border-tan bg-cream-deep/60 p-4">
              <p className="text-xs font-semibold text-ink-soft">Refunds requested</p>
              <p className="mt-2 font-display text-2xl font-bold text-ink">{venueRentalData.summary.pending_refund_count}</p>
            </div>
            <div className="rounded-lg border border-tan bg-cream-deep/60 p-4">
              <p className="text-xs font-semibold text-ink-soft">Ledger entries</p>
              <p className="mt-2 font-display text-2xl font-bold text-ink">{venueRentalData.summary.count}</p>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-lg border border-tan">
            <div className="grid grid-cols-[1.1fr_0.9fr_0.75fr_0.75fr_0.85fr_0.75fr_0.75fr] gap-3 bg-cream-deep px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] text-ink-soft">
              <span>Event</span>
              <span>Venue</span>
              <span>Amount</span>
              <span>Fee</span>
              <span>Status</span>
              <span>Transfer</span>
              <span>Action</span>
            </div>
            {isLoading ? (
              <div className="flex items-center gap-3 px-4 py-8 text-sm text-ink-soft">
                <Loader2 className="h-5 w-5 animate-spin text-clay" />
                Loading venue rentals...
              </div>
            ) : venueRentalRows.length > 0 ? (
              venueRentalRows.map((payment) => (
                <div key={payment.id} className="grid grid-cols-[1.1fr_0.9fr_0.75fr_0.75fr_0.85fr_0.75fr_0.75fr] gap-3 border-t border-tan px-4 py-4 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{payment.event_name}</p>
                    <p className="mt-1 text-xs text-ink-soft">{formatDate(payment.event_date)}</p>
                  </div>
                  <p className="min-w-0 truncate text-ink-soft">{payment.venue_name}</p>
                  <p className="font-semibold text-ink">{formatCents(payment.amount_cents)}</p>
                  <p className="text-ink-soft">{formatCents(payment.processing_fee_cents)}</p>
                  <div>
                    <StatusBadge status={payment.status} />
                    {payment.status === 'refund_requested' ? (
                      <p className="mt-1 text-xs text-ink-soft">
                        {formatCents(payment.refund_amount_cents ?? 0)} awaiting venue
                      </p>
                    ) : null}
                    {(payment.status === 'refund_approved' || payment.status === 'refunded_partial' || payment.status === 'refunded_full') ? (
                      <p className="mt-1 text-xs text-ink-soft">
                        {formatCents(payment.refund_amount_cents ?? 0)} refund
                      </p>
                    ) : null}
                  </div>
                  <p className="min-w-0 truncate text-xs text-ink-soft" title={payment.stripe_transfer_id ?? undefined}>
                    {payment.stripe_transfer_id ?? 'Pending'}
                  </p>
                  <div>
                    {payment.status === 'paid' ? (
                      <Button type="button" variant="glass" size="sm" onClick={() => openRentalRefund(payment)}>
                        <RotateCcw className="h-3.5 w-3.5" />
                        Refund
                      </Button>
                    ) : (
                      <span className="text-xs text-ink-soft">—</span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="flex items-center gap-3 px-4 py-8 text-sm text-ink-soft">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-clay" />
                No venue rental payments yet. Pay a confirmed venue booking from your event plan to start tracking here.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-tan bg-cream p-5 shadow-card">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cream-deep text-clay">
              <WalletCards className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-ink">Builder Payout Ledger</h2>
              <p className="text-sm text-ink-soft">Venue-approved Community Host Incentive payments. Platform fees are not taken from these payouts.</p>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-lg border border-tan">
            <div className="grid grid-cols-[1.2fr_0.9fr_0.8fr_0.8fr_0.6fr] gap-3 bg-cream-deep px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] text-ink-soft">
              <span>Event</span>
              <span>Venue</span>
              <span>Amount</span>
              <span>Status</span>
              <span>Action</span>
            </div>
            {isLoading ? (
              <div className="flex items-center gap-3 px-4 py-8 text-sm text-ink-soft">
                <Loader2 className="h-5 w-5 animate-spin text-clay" />
                Loading payments...
              </div>
            ) : ledgerRows.length > 0 ? (
              ledgerRows.map((payment) => (
                <div key={payment.id} className="grid grid-cols-[1.2fr_0.9fr_0.8fr_0.8fr_0.6fr] gap-3 border-t border-tan px-4 py-4 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{payment.event_name}</p>
                    <p className="mt-1 text-xs text-ink-soft">{formatDate(payment.event_date)}</p>
                  </div>
                  <p className="min-w-0 truncate text-ink-soft">{payment.venue_name}</p>
                  <p className="font-semibold text-ink">{formatCents(getPayoutCents(payment))}</p>
                  <StatusBadge status={payment.status} />
                  <div>
                    {payment.invoice_hosted_url && pendingStatuses.has(payment.status) ? (
                      <Button variant="glass" size="sm" asChild>
                        <a href={payment.invoice_hosted_url} target="_blank" rel="noreferrer" aria-label={`Open invoice for ${payment.event_name}`}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    ) : (
                      <span className="text-xs text-ink-soft">—</span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="flex items-center gap-3 px-4 py-8 text-sm text-ink-soft">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-clay" />
                Ledger rows will populate after the first Community Host Incentive payment is created.
              </div>
            )}
          </div>
        </section>
      </div>

      {rentalRefundPayment ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-cream-deep/80 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="venue-rental-refund-request-title"
            className="w-full max-w-lg rounded-lg border border-tan bg-cream p-6 shadow-card"
          >
            <button
              type="button"
              aria-label="Close venue rental refund request"
              onClick={() => setRentalRefundPayment(null)}
              disabled={isRentalRefundSubmitting}
              className="float-right rounded-full border border-tan bg-cream-deep/60 p-2 text-ink-soft transition-smooth hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
            <h2 id="venue-rental-refund-request-title" className="font-display text-xl font-bold text-ink">
              Request refund from {rentalRefundPayment.venue_name}
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              Processing fees are not refunded. The venue decides whether to approve, reject, or counter this request.
            </p>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-ink">
                Refund amount
                <input
                  value={rentalRefundAmount}
                  onChange={(event) => setRentalRefundAmount(event.target.value)}
                  inputMode="decimal"
                  className="mt-2 w-full rounded-lg border border-tan bg-cream-deep px-3 py-2 text-ink outline-none focus:border-clay"
                />
              </label>
              <label className="block text-sm font-medium text-ink">
                Reason
                <textarea
                  value={rentalRefundReason}
                  onChange={(event) => setRentalRefundReason(event.target.value)}
                  className="mt-2 min-h-28 w-full rounded-lg border border-tan bg-cream-deep px-3 py-2 text-ink outline-none focus:border-clay"
                  placeholder="Explain what changed about the venue rental."
                />
              </label>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="glass" onClick={() => setRentalRefundPayment(null)} disabled={isRentalRefundSubmitting}>
                Cancel
              </Button>
              <Button type="button" variant="hero" onClick={() => void submitRentalRefundRequest()} disabled={isRentalRefundSubmitting}>
                {isRentalRefundSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Send request
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ReadinessRow({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-tan bg-cream-deep/55 p-3">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <span className={cn(
        'rounded-full border px-3 py-1 text-xs font-bold',
        ready
          ? 'border-forest/30 bg-forest-tint text-forest'
          : 'border-tan bg-cream-deep/60 text-ink-soft'
      )}>
        {ready ? 'Ready' : 'Needs setup'}
      </span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const paid = paidStatuses.has(status)
  const pending = pendingStatuses.has(status)

  return (
    <span className={cn(
      'w-fit rounded-full border px-3 py-1 text-xs font-bold',
      paid
        ? 'border-forest/30 bg-forest-tint text-forest'
        : pending
          ? 'border-clay/30 bg-clay-tint text-clay'
          : 'border-brick/30 bg-brick-tint text-brick'
    )}>
      {formatStatus(status)}
    </span>
  )
}

function getPayoutCents(payment: BuilderPayoutPayment) {
  return payment.payout_cents ?? payment.principal_cents ?? payment.amount_cents ?? 0
}

function getVenueRentalSortTime(payment: VenueRentalPayment) {
  const rawDate = payment.paid_at ?? payment.transfer_completed_at ?? payment.created_at ?? payment.event_date
  if (!rawDate) return 0
  const date = new Date(rawDate)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function formatCents(value: number | null | undefined) {
  return `$${centsToDollars(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Date pending'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date pending'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatStatus(status: string) {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}
