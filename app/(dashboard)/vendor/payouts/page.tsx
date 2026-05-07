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

type VendorPayoutTransaction = {
  id: string
  amount: number
  vendor_payout: number
  payment_type: string
  status: string
  stripe_transfer_id: string | null
  paid_at: string | null
  created_at: string
  event_name: string
  event_date: string | null
}

type VendorPayoutSummaryResponse = {
  summary: {
    pending: number
    completed: number
    refunded: number
    failed: number
    count: number
  }
  transactions: VendorPayoutTransaction[]
  error?: string
}

const PLACEHOLDERS = [
  {
    icon: CreditCard,
    title: 'Stripe Connect account',
    description: 'Vendor payout onboarding and account status will live here once Stripe is connected.',
  },
  {
    icon: CalendarClock,
    title: 'Deposit and balance tracking',
    description: 'Upcoming deposits, remaining balances, and service payouts will be summarized here.',
  },
  {
    icon: FileText,
    title: 'Invoices and receipts',
    description: 'Downloadable receipts and payout statements will be generated after payment processing is live.',
  },
]

function formatMoney(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount || 0)
}

function formatDate(value: string | null) {
  if (!value) return 'Date TBD'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function statusLabel(status: string) {
  if (status === 'succeeded') return 'Paid'
  if (status === 'processing') return 'Processing'
  if (status === 'failed') return 'Failed'
  if (status === 'refunded') return 'Refunded'
  return 'Pending'
}

/**
 * Placeholder for vendor payout setup while Stripe integration is pending.
 *
 * @returns Vendor payout placeholder page.
 */
export default function VendorPayoutsPage() {
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
  const [summary, setSummary] = useState<VendorPayoutSummaryResponse | null>(null)
  const [isLoadingSummary, setIsLoadingSummary] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    setError(null)

    try {
      const response = await fetch('/api/vendor/stripe/status', {
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

  const loadSummary = useCallback(async () => {
    try {
      const response = await fetch('/api/vendor/payouts/summary', { credentials: 'include' })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Unable to load payout activity')

      setSummary(data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load payout activity')
    } finally {
      setIsLoadingSummary(false)
    }
  }, [])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  const startConnect = useCallback(async () => {
    setIsConnecting(true)
    setError(null)

    try {
      const response = await fetch('/api/vendor/stripe/connect', {
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
      const response = await fetch('/api/vendor/stripe/refresh', {
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
      const response = await fetch('/api/vendor/stripe/dashboard', {
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

  const isConnected = Boolean(status.account)
  const isDashboardReady = Boolean(status.account?.payouts_enabled || status.account?.charges_enabled)
  const transactions = summary?.transactions ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Payouts</h1>
        <p className="mt-1 text-muted-foreground">Vendor payment collection, payout setup, and statements.</p>
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
                Connect a Stripe Express account so 3rdPlace can route vendor payments and payouts directly.
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
              onRefresh={refreshStatus}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {PLACEHOLDERS.map((item, index) => {
          const Icon = item.icon
          const values = [
            formatMoney(summary?.summary.pending ?? 0),
            formatMoney(summary?.summary.completed ?? 0),
            String(summary?.summary.count ?? 0),
          ]

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
                <div className="rounded-md bg-background px-3 py-2 text-sm font-semibold text-foreground">
                  {isLoadingSummary ? 'Loading...' : values[index]}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payment Activity</CardTitle>
          <CardDescription>Recent vendor deposits, balances, refunds, and Stripe transfer status.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingSummary ? (
            <div className="h-28 animate-pulse rounded-lg bg-sidebar-accent/40" />
          ) : transactions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
              Vendor payment activity will appear here after builders pay deposits or balances.
            </div>
          ) : (
            <div className="space-y-3">
              {transactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="font-medium text-foreground">{transaction.event_name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatDate(transaction.event_date)} - {transaction.payment_type.replace(/_/g, ' ')}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {transaction.stripe_transfer_id ? 'Stripe transfer created' : 'Awaiting transfer'}
                    </p>
                  </div>
                  <div className="text-left md:text-right">
                    <p className="text-lg font-semibold text-foreground">{formatMoney(transaction.vendor_payout)}</p>
                    <p className="text-xs font-medium uppercase text-muted-foreground">{statusLabel(transaction.status)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {transaction.paid_at ? `Paid ${formatDate(transaction.paid_at)}` : `Created ${formatDate(transaction.created_at)}`}
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
