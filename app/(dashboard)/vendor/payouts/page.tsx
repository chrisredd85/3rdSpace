'use client'

import { useCallback, useEffect, useState } from 'react'
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

/**
 * Placeholder for vendor payout setup while Stripe integration is pending.
 *
 * @returns Vendor payout placeholder page.
 */
export default function VendorPayoutsPage() {
  const [status, setStatus] = useState<StripeStatusResponse>({
    account: null,
    completionPercent: 0,
  })
  const [isLoadingStatus, setIsLoadingStatus] = useState(true)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isOpeningDashboard, setIsOpeningDashboard] = useState(false)
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

  const startConnect = async () => {
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
  }

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
                Connect a Stripe Express account so 3rdSpace can route vendor payments and payouts directly.
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
        {PLACEHOLDERS.map((item) => {
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

      <StripeOnboardingModal
        isOpen={isModalOpen}
        isLoading={isConnecting}
        onClose={() => setIsModalOpen(false)}
        onStart={startConnect}
      />
    </div>
  )
}
