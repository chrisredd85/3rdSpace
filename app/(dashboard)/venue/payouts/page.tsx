'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  AlertCircle,
  Banknote,
  CalendarClock,
  CheckCircle2,
  Clock3,
  CreditCard,
  FileText,
  Info,
  Loader2,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
  UsersRound,
  WalletCards,
  XCircle,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StripeAccountStatus } from '@/components/vendor/StripeAccountStatus'
import { StripeConnectButton } from '@/components/vendor/StripeConnectButton'
import { StripeDashboardLink } from '@/components/vendor/StripeDashboardLink'
import { StripeOnboardingModal } from '@/components/vendor/StripeOnboardingModal'
import {
  VenueSpendReportUpload,
  type VenueSpendReportSettlement,
} from '@/components/venue/VenueSpendReportUpload'
import { centsToDollars, dollarsToCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { Json } from '@/lib/types/database'

type StripeAccount = {
  stripe_account_id?: string | null
  account_status:
    | 'pending'
    | 'pending_onboarding'
    | 'onboarding_started'
    | 'capabilities_pending'
    | 'active'
    | 'complete'
    | 'restricted'
    | 'disabled'
  charges_enabled: boolean
  payouts_enabled: boolean
  requirements_due: Json
  updated_at?: string
}

type StripeStatusResponse = {
  connected?: boolean
  status?:
    | 'not_connected'
    | 'pending'
    | 'pending_onboarding'
    | 'onboarding_started'
    | 'capabilities_pending'
    | 'active'
    | 'complete'
    | 'restricted'
    | 'disabled'
  charges_enabled?: boolean
  payouts_enabled?: boolean
  details_submitted?: boolean
  account: StripeAccount | null
  completionPercent: number
  onboarding_required?: boolean
  reason?: string
  error?: string
}

type VenueChiPayment = {
  id: string
  agreement_id: string | null
  payment_id?: string | null
  amount: number | null
  amount_cents: number
  principal_cents?: number | null
  payout_cents?: number | null
  processing_fee_cents?: number | null
  invoice_hosted_url?: string | null
  refund_amount_cents?: number | null
  refund_reason?: string | null
  refund_requested_at?: string | null
  currency: string | null
  status: string
  proof_status?: string | null
  event_name: string
  event_date: string | null
  builder_name: string
  actual_attendance: number | null
  per_head_amount: number | null
  reported_revenue_cents?: number | null
  revenue_extracted_value_cents?: number | null
  revenue_extraction_confidence?: string | null
  revenue_proof_url?: string | null
  revenue_submitted_at?: string | null
  consumption_share_percent?: number | null
  agreement_status?: string | null
  requires_manual_review?: boolean | null
  initiated_at: string | null
  completed_at: string | null
  failure_reason: string | null
}

type VenueChiSummaryResponse = {
  summary: {
    pending: number
    processing: number
    completed: number
    refunded: number
    count: number
  }
  payments: VenueChiPayment[]
  error?: string
}

type VenueRentalPayment = {
  id: string
  plan_id: string
  event_name: string
  event_date: string | null
  builder_name: string
  amount_cents: number
  processing_fee_cents: number
  venue_payout_cents: number
  currency: string
  status: string
  payment_method_type: string
  paid_at: string | null
  transfer_completed_at: string | null
  created_at: string | null
  stripe_transfer_id: string | null
  refund_amount_cents: number | null
  refund_reason: string | null
  refund_requested_at: string | null
  refund_approved_at: string | null
}

type VenueRentalSummaryResponse = {
  summary: {
    total_received_cents: number
    pending_refund_requests: number
    refunded_cents: number
    count: number
  }
  transactions: VenueRentalPayment[]
  error?: string
}

const PAYOUT_CARDS = [
  {
    icon: CreditCard,
    title: 'Stripe Connect account',
    description: 'Connect Stripe Express so 3rdPlace can route venue deposits, balances, and Community Host Incentive payments.',
  },
  {
    icon: CalendarClock,
    title: 'Payout schedule',
    description: 'Future deposits, Community Host Incentives, and settlement payments will be summarized here.',
  },
  {
    icon: FileText,
    title: 'Invoices and statements',
    description: 'Downloadable statements will be generated after payment processing is live.',
  },
]

function formatMoney(amount: number, currency = 'usd') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount || 0)
}

function formatCents(amountCents: number | null | undefined, currency = 'usd') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(centsToDollars(amountCents ?? 0))
}

function formatDate(value: string | null) {
  if (!value) return 'Date TBD'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function countDueRequirements(requirements: Json | null | undefined) {
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) return 0

  const values = requirements as Record<string, Json | undefined>
  return [
    ...(Array.isArray(values.currently_due) ? values.currently_due : []),
    ...(Array.isArray(values.past_due) ? values.past_due : []),
  ].filter((item) => typeof item === 'string').length
}

function maskStripeAccountId(accountId: string | null | undefined) {
  if (!accountId) return 'Not created'
  if (accountId.length <= 12) return accountId
  return `${accountId.slice(0, 7)}...${accountId.slice(-4)}`
}

function statusLabel(status: string) {
  if (status === 'revenue_report_needed') return 'Proof needed'
  if (status === 'completed' || status === 'paid') return 'Paid'
  if (status === 'processing' || status === 'invoice_sent') return 'Processing'
  if (status === 'refund_requested') return 'Refund requested'
  if (status === 'refund_approved' || status === 'refund_processing') return 'Refund processing'
  if (status === 'failed' || status === 'invoice_failed') return 'Payment failed'
  if (status === 'refunded' || status === 'refunded_partial' || status === 'refunded_full') return 'Refunded'
  return 'Pending'
}

type StatusTone = 'ready' | 'processing' | 'paid' | 'failed' | 'refunded'

function statusTone(status: string): StatusTone {
  if (status === 'completed' || status === 'paid') return 'paid'
  if (status === 'failed' || status === 'invoice_failed') return 'failed'
  if (status === 'refunded' || status === 'refunded_partial' || status === 'refunded_full') return 'refunded'
  if (status === 'processing' || status === 'invoice_sent' || status === 'refund_requested' || status === 'refund_approved' || status === 'refund_processing') {
    return 'processing'
  }
  return 'ready'
}

function statusIcon(status: string) {
  if (status === 'revenue_report_needed') return UploadCloud
  const tone = statusTone(status)
  if (tone === 'paid') return CheckCircle2
  if (tone === 'failed') return XCircle
  if (tone === 'refunded') return RotateCcw
  if (tone === 'processing') return Clock3
  return ReceiptText
}

const statusStyles: Record<StatusTone, {
  badge: string
  row: string
  accent: string
  amount: string
}> = {
  ready: {
    badge: 'border-clay/30 bg-clay/10 text-clay',
    row: 'hover:border-clay/40',
    accent: 'bg-clay',
    amount: 'text-ink',
  },
  processing: {
    badge: 'border-forest/30 bg-forest/10 text-forest',
    row: 'hover:border-forest/40',
    accent: 'bg-forest',
    amount: 'text-ink',
  },
  paid: {
    badge: 'border-forest/30 bg-forest/10 text-forest',
    row: 'hover:border-forest/40',
    accent: 'bg-forest',
    amount: 'text-forest',
  },
  failed: {
    badge: 'border-brick/40 bg-brick/10 text-brick',
    row: 'hover:border-brick/40',
    accent: 'bg-brick',
    amount: 'text-ink',
  },
  refunded: {
    badge: 'border-clay/40 bg-clay/10 text-clay',
    row: 'hover:border-clay/40',
    accent: 'bg-clay',
    amount: 'text-clay',
  },
}

function paymentSettlementCents(payment: VenueChiPayment) {
  return payment.payout_cents ?? payment.amount_cents ?? 0
}

function calculateSettlementTotals(payments: VenueChiPayment[]) {
  return payments.reduce(
    (totals, payment) => {
      const amountCents = paymentSettlementCents(payment)

      if (payment.status === 'pending' || payment.status === 'failed' || payment.status === 'pending_venue_approval' || payment.status === 'invoice_failed') {
        totals.needsAction += amountCents
      } else if (payment.status === 'processing' || payment.status === 'invoice_sent' || payment.status === 'refund_requested' || payment.status === 'refund_approved' || payment.status === 'refund_processing') {
        totals.inProgress += amountCents
      } else if (payment.status === 'paid' || payment.status === 'completed') {
        totals.settled += amountCents
      } else if (payment.status === 'refunded' || payment.status === 'refunded_partial' || payment.status === 'refunded_full') {
        totals.refunded += payment.refund_amount_cents ?? amountCents
      }

      return totals
    },
    { needsAction: 0, inProgress: 0, settled: 0, refunded: 0 }
  )
}

function stripeReadinessMeta(status: StripeStatusResponse, isLoadingStatus: boolean) {
  if (isLoadingStatus) {
    return {
      label: 'Checking Stripe',
      detail: 'Refreshing the connected account from Stripe.',
      tone: 'processing' as StatusTone,
      icon: RefreshCw,
    }
  }

  if (!status.account) {
    return {
      label: 'Needs Stripe account',
      detail: 'Create a Stripe Express account before venue payouts can route.',
      tone: 'ready' as StatusTone,
      icon: Clock3,
    }
  }

  if (status.account.account_status === 'active' || status.account.account_status === 'complete') {
    return {
      label: 'Verified for payouts',
      detail: 'Stripe returned an account with charges and payouts enabled.',
      tone: 'paid' as StatusTone,
      icon: CheckCircle2,
    }
  }

  if (status.account.account_status === 'restricted' || status.account.account_status === 'disabled') {
    return {
      label: 'Stripe action required',
      detail: 'Stripe returned requirements that must be completed before payout routing.',
      tone: 'failed' as StatusTone,
      icon: AlertCircle,
    }
  }

  return {
    label: 'Stripe setup in progress',
    detail: 'The account exists, but Stripe has not enabled payouts yet.',
    tone: 'processing' as StatusTone,
    icon: Clock3,
  }
}

/**
 * Venue owner Stripe Connect onboarding and payout readiness page.
 */
export default function VenuePayoutsPage() {
  const searchParams = useSearchParams()
  const didAutoStartStripe = useRef(false)
  const [status, setStatus] = useState<StripeStatusResponse>({
    account: null,
    completionPercent: 0,
  })
  const [isLoadingStatus, setIsLoadingStatus] = useState(true)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isOpeningDashboard, setIsOpeningDashboard] = useState(false)
  const [chiSummary, setChiSummary] = useState<VenueChiSummaryResponse | null>(null)
  const [isLoadingChi, setIsLoadingChi] = useState(true)
  const [rentals, setRentals] = useState<VenueRentalSummaryResponse | null>(null)
  const [isLoadingRentals, setIsLoadingRentals] = useState(true)
  const [refundLoading, setRefundLoading] = useState(false)
  const [refundPayment, setRefundPayment] = useState<VenueChiPayment | null>(null)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [rentalRefundPayment, setRentalRefundPayment] = useState<VenueRentalPayment | null>(null)
  const [rentalRefundDecision, setRentalRefundDecision] = useState<'approve' | 'reject' | 'counter'>('approve')
  const [rentalCounterAmount, setRentalCounterAmount] = useState('')
  const [rentalDecisionNote, setRentalDecisionNote] = useState('')
  const [isRentalDecisionSubmitting, setIsRentalDecisionSubmitting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    setError(null)

    try {
      const response = await fetch('/api/venue/stripe/status', {
        credentials: 'include',
      })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Unable to load Stripe status')

      setStatus(data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load Stripe status')
    } finally {
      setIsLoadingStatus(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const loadChi = useCallback(async () => {
    try {
      const response = await fetch('/api/venue/community-host-incentive/summary', { credentials: 'include' })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Unable to load Community Host Incentives')

      setChiSummary(data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load Community Host Incentives')
    } finally {
      setIsLoadingChi(false)
    }
  }, [])

  useEffect(() => {
    loadChi()
  }, [loadChi])

  const loadRentals = useCallback(async () => {
    try {
      const response = await fetch('/api/venue/rentals/summary', { credentials: 'include' })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Unable to load rental payments')

      setRentals(data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load rental payments')
    } finally {
      setIsLoadingRentals(false)
    }
  }, [])

  useEffect(() => {
    loadRentals()
  }, [loadRentals])

  const startConnect = useCallback(async () => {
    setIsConnecting(true)
    setError(null)

    try {
      const response = await fetch('/api/venue/stripe/connect', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Unable to start Stripe onboarding')

      window.location.href = data.url
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Unable to start Stripe onboarding')
      setIsConnecting(false)
      setIsModalOpen(false)
    }
  }, [])

  useEffect(() => {
    if (didAutoStartStripe.current || isLoadingStatus || searchParams.get('connect') !== 'stripe') return

    didAutoStartStripe.current = true
    startConnect()
  }, [isLoadingStatus, searchParams, startConnect])

  const refreshStatus = async () => {
    setIsRefreshing(true)
    setError(null)

    try {
      const response = await fetch('/api/venue/stripe/refresh', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Unable to refresh Stripe status')

      setStatus(data)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Unable to refresh Stripe status')
    } finally {
      setIsRefreshing(false)
    }
  }

  const openDashboard = async () => {
    setIsOpeningDashboard(true)
    setError(null)

    try {
      const response = await fetch('/api/venue/stripe/dashboard', {
        credentials: 'include',
      })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Unable to open Stripe dashboard')

      window.location.href = data.url
    } catch (dashboardError) {
      setError(dashboardError instanceof Error ? dashboardError.message : 'Unable to open Stripe dashboard')
      setIsOpeningDashboard(false)
    }
  }

  const openRefundRequest = (payment: VenueChiPayment) => {
    setRefundPayment(payment)
    setRefundAmount(centsToDollars(payment.payout_cents ?? payment.amount_cents ?? 0).toFixed(2))
    setRefundReason('')
    setError(null)
  }

  const submitRefundRequest = async () => {
    if (!refundPayment) return

    const refundAmountCents = dollarsToCents(refundAmount)
    if (refundAmountCents <= 0) {
      setError('Refund amount must be greater than $0.00.')
      return
    }
    if (!refundReason.trim()) {
      setError('Add a reason for the refund request.')
      return
    }

    setRefundLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/venue/community-host-incentive/${refundPayment.id}/refund-request`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          refund_amount_cents: refundAmountCents,
          reason: refundReason.trim(),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Unable to request refund')
      setRefundPayment(null)
      setRefundAmount('')
      setRefundReason('')
      setIsLoadingChi(true)
      await loadChi()
    } catch (refundError) {
      setError(refundError instanceof Error ? refundError.message : 'Unable to request refund')
    } finally {
      setRefundLoading(false)
    }
  }

  const handleSpendReportUploaded = useCallback(async () => {
    setIsLoadingChi(true)
    await loadChi()
  }, [loadChi])

  const openRentalRefundDecision = (payment: VenueRentalPayment) => {
    setRentalRefundPayment(payment)
    setRentalRefundDecision('approve')
    setRentalCounterAmount(centsToDollars(payment.refund_amount_cents ?? payment.amount_cents).toFixed(2))
    setRentalDecisionNote('')
    setError(null)
  }

  const submitRentalRefundDecision = async () => {
    if (!rentalRefundPayment) return

    const body: Record<string, unknown> = {
      decision: rentalRefundDecision,
      note: rentalDecisionNote.trim() || undefined,
    }

    if (rentalRefundDecision === 'counter') {
      const counterAmountCents = dollarsToCents(rentalCounterAmount)
      if (counterAmountCents <= 0) {
        setError('Counter amount must be greater than $0.00.')
        return
      }
      body.counter_amount_cents = counterAmountCents
    }

    setIsRentalDecisionSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`/api/venue/rentals/${rentalRefundPayment.id}/refund-decision`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Unable to update rental refund request')
      setRentalRefundPayment(null)
      setIsLoadingRentals(true)
      await loadRentals()
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'Unable to update rental refund request')
    } finally {
      setIsRentalDecisionSubmitting(false)
    }
  }

  const isConnected = Boolean(status.account)
  const isDashboardReady = Boolean(status.account?.payouts_enabled || status.account?.charges_enabled)
  const dueRequirementCount = countDueRequirements(status.account?.requirements_due ?? null)
  const readiness = stripeReadinessMeta(status, isLoadingStatus)
  const ReadinessIcon = readiness.icon
  const readinessStyles = statusStyles[readiness.tone]
  const connectDescription = status.reason === 'stripe_mode_mismatch'
    ? 'Reconnect your Stripe account to receive venue payouts. Your previous connection is no longer valid for this environment.'
    : 'Create a Stripe Express account to receive venue payouts.'
  const chiPayments = chiSummary?.payments ?? []
  const settlementTotals = calculateSettlementTotals(chiPayments)
  const rentalPayments = rentals?.transactions ?? []

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-lg border border-tan bg-cream p-6 shadow-card">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-clay/25 bg-clay/10 px-3 py-1 text-xs font-semibold uppercase text-clay">
              <WalletCards className="h-3.5 w-3.5" />
              Venue payouts
            </div>
            <h1 className="mt-4 font-display text-4xl font-bold text-ink">Payouts</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft sm:text-base">
              Track Stripe Connect readiness, venue-to-builder settlement invoices, refund requests, and statement-ready payout history.
            </p>
          </div>

          <div className={cn('flex min-w-0 items-start gap-3 rounded-lg border p-4 lg:max-w-md', readinessStyles.badge)}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cream/45">
              <ReadinessIcon className={cn('h-5 w-5', isLoadingStatus ? 'animate-spin' : '')} />
            </span>
            <div className="min-w-0">
              <p className="font-display text-lg font-bold text-ink">{readiness.label}</p>
              <p className="mt-1 text-sm text-ink-soft">{readiness.detail}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-tan bg-cream/45 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Stripe account</p>
            <p className="mt-2 truncate font-display text-xl font-bold text-ink">{maskStripeAccountId(status.account?.stripe_account_id)}</p>
          </div>
          <div className="rounded-lg border border-tan bg-cream/45 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Payout readiness</p>
            <p className="mt-2 font-display text-xl font-bold text-ink">{isLoadingStatus ? 'Checking' : `${status.completionPercent}%`}</p>
          </div>
          <div className="rounded-lg border border-tan bg-cream/45 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Requirements due</p>
            <p className="mt-2 font-display text-xl font-bold text-ink">{isLoadingStatus ? 'Checking' : dueRequirementCount}</p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-brick/30 bg-brick/10 p-4 text-brick">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Stripe Connect</CardTitle>
              <CardDescription className="mt-2">
                Connect a Stripe Express account so 3rdPlace can route venue payouts directly. The status below is pulled from Stripe, not only from the local database.
              </CardDescription>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" variant="glass" onClick={() => setIsModalOpen(true)}>
                <Info className="mr-2 h-4 w-4" />
                Setup guide
              </Button>
              <StripeConnectButton
                isConnected={isConnected}
                isLoading={isConnecting}
                disabled={isLoadingStatus}
                onConnect={() => setIsModalOpen(true)}
              />
              <StripeDashboardLink
                disabled={!isDashboardReady}
                isLoading={isOpeningDashboard}
                onOpen={openDashboard}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingStatus ? (
            <div className="h-32 animate-pulse rounded-lg bg-cream-deep/40" />
          ) : (
            <StripeAccountStatus
              account={status.account}
              completionPercent={status.completionPercent}
              detailsSubmitted={status.details_submitted}
              isRefreshing={isRefreshing}
              notConnectedDescription={connectDescription}
              onRefresh={refreshStatus}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {PAYOUT_CARDS.map((item) => {
          const Icon = item.icon

          return (
            <Card key={item.title}>
              <CardHeader>
                <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-cream-deep/40 text-ink">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md bg-cream px-3 py-2 text-xs font-medium text-ink-soft">
                  {status.account?.account_status === 'active' || status.account?.account_status === 'complete'
                    ? 'Ready for payment activity'
                    : 'Available after onboarding'}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-clay/20 bg-clay/10 px-3 py-1 text-xs font-semibold uppercase text-clay">
              <WalletCards className="h-3.5 w-3.5" />
              Rental payments
            </div>
            <h2 className="mt-3 font-display text-2xl font-bold text-ink">Rental payments received</h2>
            <p className="mt-1 text-sm text-ink-soft">Incoming builder-to-venue rental payments and refund decisions.</p>
          </div>
          <div className="text-sm text-ink-soft">
            {isLoadingRentals ? 'Loading rentals...' : `${rentalPayments.length} payment${rentalPayments.length === 1 ? '' : 's'}`}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <SettlementMetric
            label="Received"
            value={formatCents(rentals?.summary.total_received_cents ?? 0)}
            detail="Net principal after approved refunds"
            icon={CheckCircle2}
            tone="paid"
          />
          <SettlementMetric
            label="Refund requests"
            value={String(rentals?.summary.pending_refund_requests ?? 0)}
            detail="Waiting on venue decision"
            icon={RotateCcw}
            tone="processing"
          />
          <SettlementMetric
            label="Refunded"
            value={formatCents(rentals?.summary.refunded_cents ?? 0)}
            detail="Returned rental principal"
            icon={ReceiptText}
            tone="refunded"
          />
        </div>

        {isLoadingRentals ? (
          <div className="h-36 animate-pulse rounded-lg border border-tan bg-cream shadow-card" />
        ) : rentalPayments.length === 0 ? (
          <div className="rounded-lg border border-dashed border-tan bg-cream p-8 text-sm text-ink-soft shadow-card">
            Rental payments will appear here after a builder pays a confirmed venue booking.
          </div>
        ) : (
          <div className="space-y-3">
            {rentalPayments.map((payment) => (
              <RentalPaymentRow
                key={payment.id}
                payment={payment}
                onDecideRefund={openRentalRefundDecision}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-clay/20 bg-clay/10 px-3 py-1 text-xs font-semibold uppercase text-clay">
              <ShieldCheck className="h-3.5 w-3.5" />
              Community Host Incentive
            </div>
            <h2 className="mt-3 font-display text-2xl font-bold text-ink">Settlement ledger</h2>
            <p className="mt-1 text-sm text-ink-soft">Venue-approved Community Host Incentives after verified attendance.</p>
          </div>
          <div className="text-sm text-ink-soft">
            {isLoadingChi ? 'Loading records...' : `${chiPayments.length} settlement${chiPayments.length === 1 ? '' : 's'}`}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SettlementMetric
            label="Needs action"
            value={formatCents(settlementTotals.needsAction)}
            detail="Automatic settlement records awaiting follow-up"
            icon={ReceiptText}
            tone="ready"
          />
          <SettlementMetric
            label="In progress"
            value={formatCents(settlementTotals.inProgress)}
            detail="Invoice or refund processing"
            icon={Clock3}
            tone="processing"
          />
          <SettlementMetric
            label="Settled"
            value={formatCents(settlementTotals.settled)}
            detail="Paid and completed settlements"
            icon={CheckCircle2}
            tone="paid"
          />
          <SettlementMetric
            label="Refunded"
            value={formatCents(settlementTotals.refunded)}
            detail="Returned or partially returned"
            icon={RotateCcw}
            tone="refunded"
          />
        </div>

        {isLoadingChi ? (
          <div className="grid gap-3">
            <div className="h-36 animate-pulse rounded-lg border border-tan bg-cream shadow-card" />
            <div className="h-36 animate-pulse rounded-lg border border-tan bg-cream shadow-card" />
          </div>
        ) : chiPayments.length === 0 ? (
          <div className="rounded-lg border border-dashed border-tan bg-cream p-8 text-sm text-ink-soft shadow-card">
            Community Host Incentives will appear here after verified post-event reports qualify for a venue agreement.
          </div>
        ) : (
          <div className="space-y-3">
            {chiPayments.map((payment) => (
              <SettlementRow
                key={payment.id}
                payment={payment}
                onRefund={openRefundRequest}
                onSpendReportUploaded={handleSpendReportUploaded}
              />
            ))}
          </div>
        )}
      </section>

      <StripeOnboardingModal
        isOpen={isModalOpen}
        isLoading={isConnecting}
        onClose={() => setIsModalOpen(false)}
        onStart={startConnect}
      />

      {rentalRefundPayment ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-cream/80 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rental-refund-decision-title"
            className="w-full max-w-xl rounded-lg border border-tan bg-cream p-6 shadow-card"
          >
            <h2 id="rental-refund-decision-title" className="font-display text-xl font-bold text-ink">
              Decide on refund
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              {rentalRefundPayment.builder_name} requested {formatCents(rentalRefundPayment.refund_amount_cents ?? 0)} for {rentalRefundPayment.event_name}.
            </p>

            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              {(['approve', 'counter', 'reject'] as const).map((decision) => (
                <button
                  key={decision}
                  type="button"
                  onClick={() => setRentalRefundDecision(decision)}
                  className={cn(
                    'rounded-lg border px-4 py-3 text-sm font-semibold capitalize transition-smooth',
                    rentalRefundDecision === decision
                      ? 'border-clay/40 bg-clay/15 text-clay'
                      : 'border-tan bg-cream/50 text-ink hover:bg-cream/70'
                  )}
                >
                  {decision}
                </button>
              ))}
            </div>

            {rentalRefundDecision === 'counter' ? (
              <label className="mt-5 block text-sm font-medium text-ink">
                Counter amount
                <input
                  value={rentalCounterAmount}
                  onChange={(event) => setRentalCounterAmount(event.target.value)}
                  inputMode="decimal"
                  className="mt-2 w-full rounded-lg border border-tan bg-cream px-3 py-2 text-ink outline-none focus:border-clay"
                />
              </label>
            ) : null}

            <label className="mt-5 block text-sm font-medium text-ink">
              Venue note
              <textarea
                value={rentalDecisionNote}
                onChange={(event) => setRentalDecisionNote(event.target.value)}
                className="mt-2 min-h-28 w-full rounded-lg border border-tan bg-cream px-3 py-2 text-ink outline-none focus:border-clay"
                placeholder="Optional message for the builder"
              />
            </label>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="glass" onClick={() => setRentalRefundPayment(null)} disabled={isRentalDecisionSubmitting}>
                Cancel
              </Button>
              <Button type="button" variant="hero" onClick={() => void submitRentalRefundDecision()} disabled={isRentalDecisionSubmitting}>
                {isRentalDecisionSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Submit decision
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {refundPayment ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-cream/80 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="refund-request-title"
            aria-describedby="refund-request-description"
            className="w-full max-w-lg rounded-lg border border-tan bg-cream p-6 shadow-card"
          >
            <div>
              <h2 id="refund-request-title" className="font-display text-xl font-bold text-ink">Request refund</h2>
              <p id="refund-request-description" className="mt-1 text-sm text-ink-soft">
                Send a refund request to the builder for {refundPayment.event_name}.
              </p>
            </div>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-ink">
                Amount
                <input
                  value={refundAmount}
                  onChange={(event) => setRefundAmount(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-tan bg-cream px-3 py-2 text-ink outline-none focus:border-clay"
                  inputMode="decimal"
                />
              </label>
              <label className="block text-sm font-medium text-ink">
                Reason
                <textarea
                  value={refundReason}
                  onChange={(event) => setRefundReason(event.target.value)}
                  className="mt-2 min-h-28 w-full rounded-lg border border-tan bg-cream px-3 py-2 text-ink outline-none focus:border-clay"
                  placeholder="What changed about the reported revenue or agreement?"
                />
              </label>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setRefundPayment(null)} disabled={refundLoading}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void submitRefundRequest()} disabled={refundLoading}>
                {refundLoading ? 'Sending...' : 'Send request'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SettlementMetric({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  detail: string
  icon: ComponentType<{ className?: string }>
  tone: StatusTone
}) {
  const styles = statusStyles[tone]

  return (
    <div className="rounded-lg border border-tan bg-cream p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">{label}</p>
          <p className="mt-2 font-display text-2xl font-bold tabular-nums text-ink sm:text-3xl">{value}</p>
        </div>
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border', styles.badge)}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-3 text-sm text-ink-soft">{detail}</p>
    </div>
  )
}

function SettlementRow({
  payment,
  onRefund,
  onSpendReportUploaded,
}: {
  payment: VenueChiPayment
  onRefund: (payment: VenueChiPayment) => void
  onSpendReportUploaded: () => void | Promise<void>
}) {
  const tone = statusTone(payment.status)
  const styles = statusStyles[tone]
  const StatusIcon = statusIcon(payment.status)
  const canRequestRefund = payment.status === 'paid' || payment.status === 'completed'
  const amountCents = paymentSettlementCents(payment)

  return (
    <article className={cn('group relative overflow-hidden rounded-lg border border-tan bg-cream p-5 shadow-card transition-smooth sm:p-6', styles.row)}>
      <div className={cn('absolute inset-y-0 left-0 w-1.5', styles.accent)} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0 pl-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold', styles.badge)}>
              <StatusIcon className="h-3.5 w-3.5" />
              {statusLabel(payment.status)}
            </span>
            {payment.processing_fee_cents ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-tan bg-cream/40 px-3 py-1 text-xs font-medium text-ink-soft">
                <WalletCards className="h-3.5 w-3.5" />
                {formatCents(payment.processing_fee_cents, payment.currency || 'usd')} fee
              </span>
            ) : null}
          </div>

          <h3 className="mt-4 truncate font-display text-xl font-bold text-ink sm:text-2xl">
            {payment.event_name}
          </h3>

          <div className="mt-3 flex flex-wrap gap-2 text-sm text-ink-soft">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cream/40 px-3 py-1">
              <Banknote className="h-3.5 w-3.5" />
              {payment.builder_name}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cream/40 px-3 py-1">
              <CalendarClock className="h-3.5 w-3.5" />
              {formatDate(payment.event_date)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cream/40 px-3 py-1">
              <UsersRound className="h-3.5 w-3.5" />
              {payment.actual_attendance ?? 0} verified
            </span>
            {payment.per_head_amount ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-cream/40 px-3 py-1">
                <ReceiptText className="h-3.5 w-3.5" />
                {formatMoney(payment.per_head_amount)}/head
              </span>
            ) : null}
          </div>

          {payment.failure_reason ? (
            <div className="mt-4 inline-flex max-w-full items-start gap-2 rounded-lg border border-brick/30 bg-brick/10 px-3 py-2 text-sm text-brick">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0">{payment.failure_reason}</span>
            </div>
          ) : null}

          <VenueSpendReportUpload
            settlement={payment as VenueSpendReportSettlement}
            onUploaded={onSpendReportUploaded}
          />
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-tan bg-cream/50 p-4 sm:min-w-64 lg:items-end">
          <div className="lg:text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Settlement</p>
            <p className={cn('mt-1 font-display text-3xl font-bold tabular-nums', styles.amount)}>
              {formatCents(amountCents, payment.currency || 'usd')}
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row lg:justify-end">
            <div className="rounded-lg border border-forest/20 bg-forest/10 px-3 py-2 text-sm text-forest sm:max-w-72 lg:text-right">
              <p className="font-semibold">Settlement now runs automatically</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                CHI settlements are scheduled 7 days after each event. Check your email for settlement links when due.
              </p>
            </div>
            {canRequestRefund ? (
              <Button
                type="button"
                variant="glass"
                className="w-full sm:w-auto"
                onClick={() => onRefund(payment)}
              >
                <RotateCcw className="h-4 w-4" />
                Request refund
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}

function RentalPaymentRow({
  payment,
  onDecideRefund,
}: {
  payment: VenueRentalPayment
  onDecideRefund: (payment: VenueRentalPayment) => void
}) {
  const tone = statusTone(payment.status)
  const styles = statusStyles[tone]
  const StatusIcon = statusIcon(payment.status)
  const canDecideRefund = payment.status === 'refund_requested'

  return (
    <article className={cn('group relative overflow-hidden rounded-lg border border-tan bg-cream p-5 shadow-card transition-smooth sm:p-6', styles.row)}>
      <div className={cn('absolute inset-y-0 left-0 w-1.5', styles.accent)} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0 pl-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold', styles.badge)}>
              <StatusIcon className="h-3.5 w-3.5" />
              {statusLabel(payment.status)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-tan bg-cream/40 px-3 py-1 text-xs font-medium text-ink-soft">
              <CreditCard className="h-3.5 w-3.5" />
              {payment.payment_method_type === 'us_bank_account' ? 'ACH' : 'Card'}
            </span>
          </div>

          <h3 className="mt-4 truncate font-display text-xl font-bold text-ink sm:text-2xl">
            {payment.event_name}
          </h3>

          <div className="mt-3 flex flex-wrap gap-2 text-sm text-ink-soft">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cream/40 px-3 py-1">
              <UsersRound className="h-3.5 w-3.5" />
              {payment.builder_name}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cream/40 px-3 py-1">
              <CalendarClock className="h-3.5 w-3.5" />
              {formatDate(payment.event_date)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cream/40 px-3 py-1">
              <ReceiptText className="h-3.5 w-3.5" />
              Transfer {payment.stripe_transfer_id ?? 'pending'}
            </span>
          </div>

          {payment.refund_reason ? (
            <div className="mt-4 inline-flex max-w-full items-start gap-2 rounded-lg border border-clay/30 bg-clay/10 px-3 py-2 text-sm text-clay">
              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0">{payment.refund_reason}</span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-tan bg-cream/50 p-4 sm:min-w-72 lg:items-end">
          <div className="lg:text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Amount received</p>
            <p className={cn('mt-1 font-display text-3xl font-bold tabular-nums', styles.amount)}>
              {formatCents(payment.venue_payout_cents, payment.currency || 'usd')}
            </p>
            {payment.refund_amount_cents ? (
              <p className="mt-1 text-xs text-ink-soft">
                Refund: {formatCents(payment.refund_amount_cents, payment.currency || 'usd')}
              </p>
            ) : null}
          </div>

          {canDecideRefund ? (
            <Button type="button" variant="hero" className="w-full sm:w-auto" onClick={() => onDecideRefund(payment)}>
              <RotateCcw className="h-4 w-4" />
              Decide on refund
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  )
}
