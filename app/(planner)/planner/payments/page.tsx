'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, CreditCard, ExternalLink, Loader2, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { centsToDollars } from '@/lib/money'
import { cn } from '@/lib/utils'

type BuilderPayoutPayment = {
  id: string
  event_name: string
  event_date: string | null
  venue_name: string
  status: string
  amount_cents: number
  principal_cents?: number | null
  payout_cents?: number | null
  processing_fee_cents?: number | null
  reported_revenue_cents?: number | null
  revenue_share_percent?: number | null
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

const paidStatuses = new Set(['paid', 'completed', 'refunded_partial', 'refunded_full'])
const pendingStatuses = new Set(['pending', 'processing', 'pending_venue_approval', 'invoice_sent', 'refund_requested', 'refund_approved', 'refund_processing'])

/**
 * Payments and approvals operations route for the planner shell.
 */
export default function PaymentsPage() {
  const [data, setData] = useState<BuilderPayoutSummary>(emptySummary)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPayouts = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/builder/payouts/summary', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to load payments')
      setData(payload as BuilderPayoutSummary)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load payments')
      setData(emptySummary)
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
    { label: 'Total earned', value: formatCents(data.summary.completed), detail: 'All settled venue revenue-share payouts' },
    { label: 'Pending', value: formatCents(data.summary.pending), detail: 'Awaiting report, invoice payment, or refund decision' },
    { label: 'Paid this month', value: formatCents(paidThisMonthCents), detail: 'Transferred or completed in the current month' },
    { label: 'Ledger entries', value: String(data.summary.count), detail: 'Kickback payouts tied to event agreements' },
  ]

  const refundRequests = data.payments.filter((payment) => payment.status === 'refund_requested')
  const ledgerRows = data.payments

  return (
    <div className="min-h-screen">
      <div className="border-b border-border px-6 py-5">
        <h1 className="font-display text-2xl font-bold">Payments & Approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">Authorize agent actions, track deposits, and keep spend tied to the active event plan.</p>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <section className="rounded-3xl border border-border bg-gradient-card p-5 shadow-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Payment Control Center</p>
              <h2 className="mt-2 font-display text-xl font-bold text-foreground">No money moves without organizer approval</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Track venue revenue-share payouts, approval requests, deposit deadlines, and partner payment history from one ledger.
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
              <div key={metric.label} className="rounded-2xl border border-border bg-background/50 p-4">
                <p className="text-xs font-semibold text-muted-foreground">{metric.label}</p>
                <p className="mt-2 font-display text-2xl font-bold text-foreground">{metric.value}</p>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{metric.detail}</p>
              </div>
            ))}
          </div>

          {error ? (
            <div className="mt-4 flex gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </section>

        {refundRequests.length > 0 ? (
          <section className="rounded-3xl border border-secondary/30 bg-secondary/10 p-5 shadow-card">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-secondary/20 text-secondary">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-foreground">Refund Requests</h2>
                <p className="text-sm text-muted-foreground">Pending venue refund requests will become actionable in the refund flow.</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {refundRequests.map((payment) => (
                <div key={payment.id} className="rounded-2xl border border-border bg-background/50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{payment.event_name}</p>
                      <p className="text-sm text-muted-foreground">{payment.venue_name} requested review for {formatCents(getPayoutCents(payment))}.</p>
                    </div>
                    <span className="w-fit rounded-full border border-secondary/30 bg-secondary/10 px-3 py-1 text-xs font-bold text-secondary">
                      Refund requested
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-border bg-card/70 shadow-card">
            <div className="border-b border-border p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sidebar-accent text-primary">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-foreground">Approval Queue</h2>
                  <p className="text-sm text-muted-foreground">Venue holds, vendor outreach, and deposit payments waiting for action.</p>
                </div>
              </div>
            </div>
            <div className="p-5">
              <div className="rounded-2xl border border-dashed border-border bg-background/40 p-8 text-center">
                <CreditCard className="mx-auto h-8 w-8 text-muted-foreground" />
                <h3 className="mt-3 font-display text-lg font-bold text-foreground">No approvals pending</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Recommendation buttons create approval requests here. Once a venue or vendor accepts, the payment row will show amount, deadline, refund terms, and status.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-border bg-card/70 p-5 shadow-card">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sidebar-accent text-primary">
                <Clock3 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-foreground">Payout Readiness</h2>
                <p className="text-sm text-muted-foreground">Builder Connect account status for venue payouts.</p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <ReadinessRow label="Connect account" ready={Boolean(data.account?.stripe_account_id)} />
              <ReadinessRow label="Payouts enabled" ready={Boolean(data.account?.payouts_enabled)} />
              <ReadinessRow label="Charges enabled" ready={Boolean(data.account?.charges_enabled)} />
            </div>
          </section>
        </div>

        <section className="rounded-3xl border border-border bg-card/70 p-5 shadow-card">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sidebar-accent text-primary">
              <WalletCards className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-foreground">Builder Payout Ledger</h2>
              <p className="text-sm text-muted-foreground">Venue-to-builder revenue share payments. Platform fees are not taken from these payouts.</p>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl border border-border">
            <div className="grid grid-cols-[1.2fr_0.9fr_0.8fr_0.8fr_0.6fr] gap-3 bg-muted px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
              <span>Event</span>
              <span>Venue</span>
              <span>Amount</span>
              <span>Status</span>
              <span>Action</span>
            </div>
            {isLoading ? (
              <div className="flex items-center gap-3 px-4 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Loading payments...
              </div>
            ) : ledgerRows.length > 0 ? (
              ledgerRows.map((payment) => (
                <div key={payment.id} className="grid grid-cols-[1.2fr_0.9fr_0.8fr_0.8fr_0.6fr] gap-3 border-t border-border px-4 py-4 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{payment.event_name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDate(payment.event_date)}</p>
                  </div>
                  <p className="min-w-0 truncate text-muted-foreground">{payment.venue_name}</p>
                  <p className="font-semibold text-foreground">{formatCents(getPayoutCents(payment))}</p>
                  <StatusBadge status={payment.status} />
                  <div>
                    {payment.invoice_hosted_url && pendingStatuses.has(payment.status) ? (
                      <Button variant="glass" size="sm" asChild>
                        <a href={payment.invoice_hosted_url} target="_blank" rel="noreferrer" aria-label={`Open invoice for ${payment.event_name}`}>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="flex items-center gap-3 px-4 py-8 text-sm text-muted-foreground">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                Ledger rows will populate after the first revenue share payment is created.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function ReadinessRow({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-border bg-background/40 p-3">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <span className={cn(
        'rounded-full border px-3 py-1 text-xs font-bold',
        ready
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-muted-foreground/30 bg-muted/30 text-muted-foreground'
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
        ? 'border-success/30 bg-success/10 text-success'
        : pending
          ? 'border-secondary/30 bg-secondary/10 text-secondary'
          : 'border-destructive/30 bg-destructive/10 text-destructive'
    )}>
      {formatStatus(status)}
    </span>
  )
}

function getPayoutCents(payment: BuilderPayoutPayment) {
  return payment.payout_cents ?? payment.principal_cents ?? payment.amount_cents ?? 0
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
