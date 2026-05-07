'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertCircle, CalendarClock, CreditCard, FileText, Info } from 'lucide-react'
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

type VenueKickbackPayment = {
  id: string
  amount: number
  currency: string | null
  status: string
  event_name: string
  event_date: string | null
  builder_name: string
  actual_attendance: number | null
  per_head_amount: number | null
  initiated_at: string | null
  completed_at: string | null
  failure_reason: string | null
}

type VenueKickbackSummaryResponse = {
  summary: {
    pending: number
    processing: number
    completed: number
    refunded: number
    count: number
  }
  payments: VenueKickbackPayment[]
  error?: string
}

const PAYOUT_CARDS = [
  {
    icon: CreditCard,
    title: 'Stripe Connect account',
    description: 'Connect Stripe Express so 3rdPlace can route venue deposits, balances, and revenue-share payouts.',
  },
  {
    icon: CalendarClock,
    title: 'Payout schedule',
    description: 'Future deposits, kickbacks, and revenue-share payouts will be summarized here.',
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
  const [kickbacks, setKickbacks] = useState<VenueKickbackSummaryResponse | null>(null)
  const [isLoadingKickbacks, setIsLoadingKickbacks] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
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

  const loadKickbacks = useCallback(async () => {
    try {
      const response = await fetch('/api/venue/kickbacks/summary', { credentials: 'include' })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Unable to load kickbacks')

      setKickbacks(data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load kickbacks')
    } finally {
      setIsLoadingKickbacks(false)
    }
  }, [])

  useEffect(() => {
    loadKickbacks()
  }, [loadKickbacks])

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

  const payKickback = async (paymentId: string) => {
    setCheckoutLoading(paymentId)
    setError(null)

    try {
      const response = await fetch(`/api/venue/kickbacks/${paymentId}/checkout`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Unable to start kickback payment')

      window.location.href = data.checkoutUrl
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Unable to start kickback payment')
      setCheckoutLoading(null)
    }
  }

  const isConnected = Boolean(status.account)
  const isDashboardReady = Boolean(status.account?.payouts_enabled || status.account?.charges_enabled)
  const kickbackPayments = kickbacks?.payments ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Payouts</h1>
        <p className="mt-1 text-muted-foreground">Venue payment collection, payout setup, and statements.</p>
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
                Connect a Stripe Express account so 3rdPlace can route venue payouts directly.
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
              notConnectedDescription="Create a Stripe Express account to receive venue payouts."
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
                <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar-accent/40 text-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg">{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md bg-background px-3 py-2 text-xs font-medium text-muted-foreground">
                  {status.account?.account_status === 'active' ? 'Ready for payment activity' : 'Available after onboarding'}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Venue Kickbacks</CardTitle>
          <CardDescription>Qualified payouts owed to builders after verified attendance.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-sm text-muted-foreground">Ready to pay</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{formatMoney(kickbacks?.summary.pending ?? 0)}</p>
            </div>
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-sm text-muted-foreground">Processing</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{formatMoney(kickbacks?.summary.processing ?? 0)}</p>
            </div>
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-sm text-muted-foreground">Paid</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{formatMoney(kickbacks?.summary.completed ?? 0)}</p>
            </div>
          </div>

          {isLoadingKickbacks ? (
            <div className="h-28 animate-pulse rounded-lg bg-sidebar-accent/40" />
          ) : kickbackPayments.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
              Kickbacks will appear here after event check-ins qualify for a venue agreement.
            </div>
          ) : (
            <div className="space-y-3">
              {kickbackPayments.map((payment) => {
                const canPay = payment.status === 'pending' || payment.status === 'failed'

                return (
                  <div
                    key={payment.id}
                    className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div>
                      <p className="font-medium text-foreground">{payment.event_name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {payment.builder_name} - {formatDate(payment.event_date)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {payment.actual_attendance ?? 0} verified attendees
                        {payment.per_head_amount ? ` at ${formatMoney(payment.per_head_amount)}/head` : ''}
                      </p>
                      {payment.failure_reason ? (
                        <p className="mt-1 text-xs text-destructive">{payment.failure_reason}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:justify-end">
                      <div className="sm:text-right">
                        <p className="text-lg font-semibold text-foreground">{formatMoney(payment.amount, payment.currency || 'usd')}</p>
                        <p className="text-xs font-medium uppercase text-muted-foreground">{statusLabel(payment.status)}</p>
                      </div>
                      {canPay ? (
                        <Button
                          type="button"
                          disabled={Boolean(checkoutLoading)}
                          onClick={() => payKickback(payment.id)}
                        >
                          {checkoutLoading === payment.id ? 'Starting...' : 'Pay'}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
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
