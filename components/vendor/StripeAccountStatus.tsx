'use client'

import { AlertCircle, CheckCircle2, Clock, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Json } from '@/lib/types/database'

type StripeAccount = {
  account_status: 'pending' | 'active' | 'restricted'
  charges_enabled: boolean
  payouts_enabled: boolean
  requirements_due: Json
}

interface StripeAccountStatusProps {
  account: StripeAccount | null
  completionPercent: number
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
  if (status === 'active') {
    return {
      icon: CheckCircle2,
      label: 'Ready for payouts',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    }
  }

  if (status === 'restricted') {
    return {
      icon: AlertCircle,
      label: 'Action required',
      className: 'border-destructive/30 bg-destructive/10 text-red-900',
    }
  }

  return {
    icon: Clock,
    label: status === 'not_connected' ? 'Not connected' : 'Onboarding in progress',
    className: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200',
  }
}

/**
 * Displays Stripe account readiness, payout state, and due requirements.
 */
export function StripeAccountStatus({
  account,
  completionPercent,
  isRefreshing = false,
  notConnectedDescription = 'Create a Stripe Express account to receive direct payments.',
  onRefresh,
}: StripeAccountStatusProps) {
  const status = account?.account_status ?? 'not_connected'
  const meta = getStatusMeta(status)
  const Icon = meta.icon
  const due = flattenRequirements(account?.requirements_due ?? null)

  return (
    <div className={`rounded-lg border p-4 ${meta.className}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <Icon className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-semibold">{meta.label}</p>
            <p className="mt-1 text-sm opacity-90">
              {account
                ? `Charges ${account.charges_enabled ? 'enabled' : 'pending'} · Payouts ${account.payouts_enabled ? 'enabled' : 'pending'}`
                : notConnectedDescription}
            </p>
          </div>
        </div>

        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={isRefreshing || !account}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between text-xs font-medium">
          <span>Onboarding completion</span>
          <span>{completionPercent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-background/50">
          <div className="h-full rounded-full bg-current" style={{ width: `${completionPercent}%` }} />
        </div>
      </div>

      {due.length > 0 && (
        <div className="mt-4 rounded-md bg-background/50 p-3">
          <p className="text-xs font-semibold uppercase">Stripe still needs</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {due.slice(0, 6).map((item) => (
              <span key={item} className="rounded-md bg-card/40 px-2 py-1 text-xs font-medium">
                {item.replace(/_/g, ' ')}
              </span>
            ))}
            {due.length > 6 && (
              <span className="rounded-md bg-card/40 px-2 py-1 text-xs font-medium">+{due.length - 6} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
