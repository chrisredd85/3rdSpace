'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertCircle, Info, RefreshCw, Save, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { StripeAccountStatus } from '@/components/vendor/StripeAccountStatus'
import { StripeConnectButton } from '@/components/vendor/StripeConnectButton'
import { StripeDashboardLink } from '@/components/vendor/StripeDashboardLink'
import { StripeOnboardingModal } from '@/components/vendor/StripeOnboardingModal'
import { useToast } from '@/components/ui/toast'
import type { Json } from '@/lib/types/database'

type SettingsRole = 'builder' | 'venue' | 'vendor'

type Profile = {
  email: string | null
  companyName: string | null
  displayName: string | null
  phone: string | null
}

type StripeAccount = {
  stripe_account_id?: string | null
  account_status: 'pending' | 'active' | 'restricted'
  charges_enabled: boolean
  payouts_enabled: boolean
  requirements_due: Json
  updated_at?: string
}

type StripeStatusResponse = {
  connected?: boolean
  status?: 'not_connected' | 'pending' | 'active' | 'restricted'
  charges_enabled?: boolean
  payouts_enabled?: boolean
  details_submitted?: boolean
  account: StripeAccount | null
  completionPercent: number
  error?: string
}

const roleCopy = {
  builder: {
    title: 'Account Settings',
    description: 'Update your event creator contact details and Stripe payout setup.',
    companyLabel: 'Organization name',
    displayLabel: 'Your name',
    stripeDescription: 'Connect Stripe to receive venue kickbacks after verified attendance.',
    notConnectedDescription: 'Create a Stripe account to receive venue kickbacks.',
    endpointPrefix: 'builder',
  },
  venue: {
    title: 'Account Settings',
    description: 'Update your venue owner contact details and Stripe payout setup.',
    companyLabel: 'Venue name',
    displayLabel: 'Contact name',
    stripeDescription: 'Connect Stripe so 3rdPlace can route venue payments and payouts.',
    notConnectedDescription: 'Create a Stripe account to receive venue payouts.',
    endpointPrefix: 'venue',
  },
  vendor: {
    title: 'Account Settings',
    description: 'Update your vendor contact details and Stripe payout setup.',
    companyLabel: 'Business name',
    displayLabel: 'Contact name',
    stripeDescription: 'Connect Stripe so 3rdPlace can route vendor payments and payouts.',
    notConnectedDescription: 'Create a Stripe account to receive vendor payouts.',
    endpointPrefix: 'vendor',
  },
} satisfies Record<SettingsRole, {
  title: string
  description: string
  companyLabel: string
  displayLabel: string
  stripeDescription: string
  notConnectedDescription: string
  endpointPrefix: string
}>

/**
 * Account/contact settings and Stripe Connect management for dashboard users.
 */
export function AccountSettingsClient({ role }: { role: SettingsRole }) {
  const copy = roleCopy[role]
  const { addToast } = useToast()
  const [profile, setProfile] = useState<Profile>({
    email: '',
    companyName: '',
    displayName: '',
    phone: '',
  })
  const [status, setStatus] = useState<StripeStatusResponse>({
    account: null,
    completionPercent: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingStatus, setIsLoadingStatus] = useState(true)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isOpeningDashboard, setIsOpeningDashboard] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const endpoints = useMemo(() => ({
    status: `/api/${copy.endpointPrefix}/stripe/status`,
    connect: `/api/${copy.endpointPrefix}/stripe/connect`,
    dashboard: `/api/${copy.endpointPrefix}/stripe/dashboard`,
    refresh: `/api/${copy.endpointPrefix}/stripe/refresh`,
  }), [copy.endpointPrefix])

  const loadProfile = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/account/settings', { credentials: 'include' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load account settings')

      setProfile({
        email: data.profile?.email || '',
        companyName: data.profile?.companyName || '',
        displayName: data.profile?.displayName || '',
        phone: data.profile?.phone || '',
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load account settings')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const loadStatus = useCallback(async () => {
    setIsLoadingStatus(true)

    try {
      const response = await fetch(endpoints.status, { credentials: 'include' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load Stripe status')

      setStatus(data)
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Unable to load Stripe status')
    } finally {
      setIsLoadingStatus(false)
    }
  }, [endpoints.status])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/account/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: profile.email,
          companyName: profile.companyName,
          displayName: profile.displayName,
          phone: profile.phone,
        }),
      })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Unable to save account settings')

      addToast({ title: 'Settings saved', description: data.message || 'Your account details were updated.' })
      if (data.profile) {
        setProfile({
          email: data.profile.email || '',
          companyName: data.profile.companyName || '',
          displayName: data.profile.displayName || '',
          phone: data.profile.phone || '',
        })
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save account settings')
    } finally {
      setIsSaving(false)
    }
  }

  async function startConnect() {
    setIsConnecting(true)
    setError(null)

    try {
      const response = await fetch(endpoints.connect, {
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

  async function refreshStatus() {
    setIsRefreshing(true)
    setError(null)

    try {
      const response = await fetch(endpoints.refresh, {
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

  async function openDashboard() {
    setIsOpeningDashboard(true)
    setError(null)

    try {
      const response = await fetch(endpoints.dashboard, { credentials: 'include' })
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
        <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <UserRound className="h-5 w-5" />
        </div>
        <h1 className="font-display text-3xl font-bold text-foreground">{copy.title}</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">{copy.description}</p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
            <CardDescription>Keep account and contact details current for bookings, payments, and support.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={copy.displayLabel}>
                <Input
                  value={profile.displayName || ''}
                  onChange={(event) => setProfile((current) => ({ ...current, displayName: event.target.value }))}
                  disabled={isLoading || isSaving}
                />
              </Field>
              <Field label={copy.companyLabel}>
                <Input
                  value={profile.companyName || ''}
                  onChange={(event) => setProfile((current) => ({ ...current, companyName: event.target.value }))}
                  disabled={isLoading || isSaving}
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={profile.email || ''}
                  onChange={(event) => setProfile((current) => ({ ...current, email: event.target.value }))}
                  disabled={isLoading || isSaving}
                />
              </Field>
              <Field label="Phone">
                <Input
                  type="tel"
                  value={profile.phone || ''}
                  onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value }))}
                  disabled={isLoading || isSaving}
                  placeholder="Optional"
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={isLoading || isSaving}>
                {isSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {isSaving ? 'Saving...' : 'Save changes'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle>Stripe Connect</CardTitle>
              <CardDescription className="mt-2">{copy.stripeDescription}</CardDescription>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(true)}>
                <Info className="h-4 w-4" />
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
              detailsSubmitted={status.details_submitted}
              isRefreshing={isRefreshing}
              notConnectedDescription={copy.notConnectedDescription}
              onRefresh={refreshStatus}
            />
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  )
}
