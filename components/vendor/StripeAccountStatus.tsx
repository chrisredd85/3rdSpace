'use client'

import { AlertCircle, CheckCircle2, Clock, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

interface StripeAccountStatusProps {
  account: StripeAccount | null
  completionPercent: number
  detailsSubmitted?: boolean
  isRefreshing?: boolean
  notConnectedDescription?: string
  onRefresh: () => void
}

function flattenRequirements(requirements: Json): string[] {
  if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) return []

  const values = requirements as Record<string, Json | undefined>
  const due = [
    ...(Array.isArray(values.currently_due) ? values.currently_due : []),
    ...(Array.isArray(values.past_due) ? values.past_due : []),
  ]

  return due.filter((item): item is string => typeof item === 'string')
}

function getStatusMeta(status: StripeAccount['account_status'] | 'not_connected') {
  if (status === 'active' || status === 'complete') {
    return {
      icon: CheckCircle2,
      label: 'Ready for payouts',
      className: 'border-forest/30 bg-forest/10 text-forest',
    }
  }

  if (status === 'restricted' || status === 'disabled') {
    return {
      icon: AlertCircle,
      label: 'Action required',
      className: 'border-brick/30 bg-brick/10 text-brick',
    }
  }

  return {
    icon: Clock,
    label: status === 'not_connected' ? 'Not connected' : 'Onboarding in progress',
    className: 'border-forest/30 bg-forest/10 text-forest',
  }
}

function maskStripeAccountId(accountId: string | null | undefined) {
  if (!accountId) return 'Not created'
  if (accountId.length <= 12) return accountId
  return `${accountId.slice(0, 7)}...${accountId.slice(-4)}`
}

function verifiedLabel(isVerified: boolean) {
  return isVerified ? 'Verified' : 'Pending'
}

/**
 * Displays Stripe account readiness, payout state, and due requirements.
 */
export function StripeAccountStatus({
  account,
  completionPercent,
  detailsSubmitted = false,
  isRefreshing = false,
  notConnectedDescription = 'Create a Stripe Express account to receive direct payments.',
  onRefresh,
}: StripeAccountStatusProps) {
  const status = account?.account_status ?? 'not_connected'
  const meta = getStatusMeta(status)
  const Icon = meta.icon
  const due = flattenRequirements(account?.requirements_due ?? null)
  const verificationChecks = [
    {
      label: 'Express account',
      value: maskStripeAccountId(account?.stripe_account_id),
      isVerified: Boolean(account?.stripe_account_id),
    },
    {
      label: 'Business details',
      value: verifiedLabel(Boolean(detailsSubmitted)),
      isVerified: Boolean(detailsSubmitted),
    },
    {
      label: 'Charges',
      value: account?.charges_enabled ? 'Enabled' : 'Pending',
      isVerified: Boolean(account?.charges_enabled),
    },
    {
      label: 'Payouts',
      value: account?.payouts_enabled ? 'Enabled' : 'Pending',
      isVerified: Boolean(account?.payouts_enabled),
    },
  ]

  return (
    <div className={cn('rounded-lg border p-5', meta.className)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-cream/40">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-display text-xl font-bold text-ink">{meta.label}</p>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              {account ? (
                <>
                  Stripe is checked server-side on page load and every refresh. This page only marks setup complete after Stripe returns a live account ID, cleared requirements, and enabled payout flags.
                </>
              ) : (
                notConnectedDescription
              )}
            </p>
          </div>
        </div>

        <Button type="button" variant="glass" size="sm" onClick={onRefresh} disabled={isRefreshing || !account}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {verificationChecks.map((check) => (
          <div key={check.label} className="rounded-lg border border-tan bg-cream/45 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">{check.label}</p>
              {check.isVerified ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-forest" />
              ) : (
                <Clock className="h-4 w-4 shrink-0 text-ink-soft" />
              )}
            </div>
            <p className="mt-2 truncate text-sm font-semibold text-ink">{check.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-xs font-medium">
          <span>Onboarding completion</span>
          <span>{completionPercent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-cream/60">
          <div className="h-full rounded-full bg-current" style={{ width: `${completionPercent}%` }} />
        </div>
      </div>

      {account && due.length === 0 ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-forest/20 bg-forest/10 p-3 text-sm text-forest">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>No currently due or past due Stripe requirements were returned.</span>
        </div>
      ) : null}

      {due.length > 0 && (
        <div className="mt-4 rounded-lg border border-tan bg-cream/50 p-3">
          <p className="text-xs font-semibold uppercase">Stripe still needs</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {due.slice(0, 6).map((item) => (
              <span key={item} className="rounded-lg bg-cream/60 px-2 py-1 text-xs font-medium">
                {item.replace(/_/g, ' ')}
              </span>
            ))}
            {due.length > 6 && (
              <span className="rounded-lg bg-cream/60 px-2 py-1 text-xs font-medium">+{due.length - 6} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
