'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertCircle, Banknote, CalendarClock, CreditCard, Info, ReceiptText } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StripeAccountStatus } from '@/components/vendor/StripeAccountStatus'
import { StripeConnectButton } from '@/components/vendor/StripeConnectButton'
import { StripeDashboardLink } from '@/components/vendor/StripeDashboardLink'
import { StripeOnboardingModal } from '@/components/vendor/StripeOnboardingModal'
import type { Json } from '@/lib/types/database'

type StripeAccount = {
  account_status: 'pending' | 'active' | 'restricted'
  charges_enabled: boolean
  payouts_enabled: boolean
  requirements_due: Json
}

type StripeStatusResponse = {
  account: StripeAccount | null
  completionPercent: number
  error?: string
}

type BuilderPayoutPayment = {
  id: string
  amount: number
  currency: string | null
  status: string
  event_name: string
  event_date: string | null
  venue_name: string
  actual_attendance: number | null
  per_head_amount: number | null
  initiated_at: string | null
  completed_at: string | null
  failure_reason: string | null
}

type BuilderPayoutSummaryResponse = {
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

function formatMoney(amount: number, currency = 'usd') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount || 0)
}

function formatDate(value: string | null) {
  if (!value) return 'Date TBD'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function statusLabel(status: string) {
  if (status === 'completed') return 'Paid'
  if (status === 'processing') return 'Processing'
  if (status === 'failed') return 'Failed'
  if (status === 'refunded') return 'Refunded'
  return 'Pending'
}

/**
 * Builder payout setup and incoming venue kickback tracking.
 */
export default function BuilderPayoutsPage() {
  const searchParams = useSearchParams()
  const didAutoStartStripe = useRef(false)
  const [status, setStatus] = useState<StripeStatusResponse>({
    account: null,
    completionPercent: 0,
  })
  const [summary, setSummary] = useState<BuilderPayoutSummaryResponse | null>(null)
  const [isLoadingStatus, setIsLoadingStatus] = useState(true)
  const [isLoadingSummary, setIsLoadingSummary] = useState(true)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isOpeningDashboard, setIsOpeningDashboard] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    setError(null)

    try {
      const response = await fetch('/api/builder/stripe/status', { credentials: 'include' })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Unable to load Stripe status')

      setStatus(data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load Stripe status')
    } finally {
      setIsLoadingStatus(false)
    }
  }, [])

  const loadSummary = useCallback(async () => {
    try {
      const response = await fetch('/api/builder/payouts/summary', { credentials: 'include' })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Unable to load payout summary')

      setSummary(data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load payout summary')
    } finally {
      setIsLoadingSummary(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
    loadSummary()
  }, [loadStatus, loadSummary])

  const startConnect = useCallback(async () => {
    setIsConnecting(true)
    setError(null)

    try {
      const response = await fetch('/api/builder/stripe/connect', {
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
      const response = await fetch('/api/builder/stripe/refresh', {
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
      const response = await fetch('/api/builder/stripe/dashboard', { credentials: 'include' })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Unable to open Stripe dashboard')

      window.location.href = data.url
    } catch (dashboardError) {
      setError(dashboardError instanceof Error ? dashboardError.message : 'Unable to open Stripe dashboard')
      setIsOpeningDashboard(false)
    }
  }

  const isConnected = Boolean(status.account)
  const isDashboardReady = Boolean(status.account?.payouts_enabled || status.account?.charges_enabled)
  const payments = summary?.payments ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Payouts</h1>
        <p className="mt-1 text-muted-foreground">Builder payout setup, venue kickbacks, and payout statements.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-red-900">
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
                Connect Stripe Express so 3rdSpace can send venue kickbacks to you after verified attendance.
              </CardDescription>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(true)}>
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
            <div className="h-32 animate-pulse rounded-lg bg-sidebar-accent/40" />
          ) : (
            <StripeAccountStatus
              account={status.account}
              completionPercent={status.completionPercent}
              isRefreshing={isRefreshing}
              notConnectedDescription="Create a Stripe Express account to receive venue kickbacks."
              onRefresh={refreshStatus}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar-accent/40">
              <CalendarClock className="h-5 w-5" />
            </div>
            <CardDescription>Pending kickbacks</CardDescription>
            <CardTitle>{formatMoney(summary?.summary.pending ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar-accent/40">
              <Banknote className="h-5 w-5" />
            </div>
            <CardDescription>Paid to builder</CardDescription>
            <CardTitle>{formatMoney(summary?.summary.completed ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar-accent/40">
              <ReceiptText className="h-5 w-5" />
            </div>
            <CardDescription>Kickback records</CardDescription>
            <CardTitle>{summary?.summary.count ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Venue Kickbacks</CardTitle>
          <CardDescription>Payments owed or sent by venues for verified attendance.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingSummary ? (
            <div className="h-28 animate-pulse rounded-lg bg-sidebar-accent/40" />
          ) : payments.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
              Kickbacks will appear here after check-ins are imported and a venue agreement qualifies.
            </div>
          ) : (
            <div className="space-y-3">
              {payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="font-medium text-foreground">{payment.event_name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {payment.venue_name} - {formatDate(payment.event_date)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {payment.actual_attendance ?? 0} verified attendees
                      {payment.per_head_amount ? ` at ${formatMoney(payment.per_head_amount)}/head` : ''}
                    </p>
                    {payment.failure_reason ? (
                      <p className="mt-1 text-xs text-destructive">{payment.failure_reason}</p>
                    ) : null}
                  </div>
                  <div className="text-left md:text-right">
                    <p className="text-lg font-semibold text-foreground">{formatMoney(payment.amount, payment.currency || 'usd')}</p>
                    <p className="text-xs font-medium uppercase text-muted-foreground">{statusLabel(payment.status)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {payment.completed_at ? `Paid ${formatDate(payment.completed_at)}` : `Created ${formatDate(payment.initiated_at)}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <StripeOnboardingModal
        isOpen={isModalOpen}
        isLoading={isConnecting}
        onClose={() => setIsModalOpen(false)}
        onStart={startConnect}
      />
    </div>
  )
}
