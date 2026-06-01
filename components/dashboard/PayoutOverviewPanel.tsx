'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowRight, Banknote, CheckCircle2, Clock, CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/button'

type PayoutRole = 'builder' | 'venue' | 'vendor'

type StripeStatus = {
  account: {
    account_status?: string
    charges_enabled?: boolean
    payouts_enabled?: boolean
  } | null
  completionPercent?: number
}

type SummaryShape = {
  summary?: {
    pending?: number
    processing?: number
    completed?: number
    failed?: number
    refunded?: number
    count?: number
  }
  transactions?: unknown[]
  payments?: unknown[]
}

type PanelState = {
  stripe: StripeStatus | null
  summary: SummaryShape | null
}

const roleConfig = {
  builder: {
    title: 'Payouts',
    description: 'Venue kickbacks and builder payout readiness',
    summaryUrl: '/api/builder/payouts/summary',
    statusUrl: '/api/builder/stripe/status',
    payoutHref: '/planner/payments',
    settingsHref: '/planner/settings',
    pendingLabel: 'Pending kickbacks',
    completedLabel: 'Paid to builder',
    emptyLabel: 'No kickbacks yet',
    summaryUnit: 'cents',
  },
  venue: {
    title: 'Payouts',
    description: 'Venue payout readiness and qualified builder kickbacks',
    summaryUrl: '/api/venue/kickbacks/summary',
    statusUrl: '/api/venue/stripe/status',
    payoutHref: '/venue/payouts',
    settingsHref: '/venue/settings',
    pendingLabel: 'Ready to pay',
    completedLabel: 'Paid',
    emptyLabel: 'No kickbacks yet',
    summaryUnit: 'cents',
  },
  vendor: {
    title: 'Payouts',
    description: 'Vendor payment activity and Stripe readiness',
    summaryUrl: '/api/vendor/payouts/summary',
    statusUrl: '/api/vendor/stripe/status',
    payoutHref: '/vendor/payouts',
    settingsHref: '/vendor/settings',
    pendingLabel: 'Pending payouts',
    completedLabel: 'Paid to vendor',
    emptyLabel: 'No payout activity yet',
    summaryUnit: 'dollars',
  },
} satisfies Record<PayoutRole, {
  title: string
  description: string
  summaryUrl: string
  statusUrl: string
  payoutHref: string
  settingsHref: string
  pendingLabel: string
  completedLabel: string
  emptyLabel: string
  summaryUnit: 'cents' | 'dollars'
}>

/**
 * Compact payout overview for main role dashboards.
 */
export function PayoutOverviewPanel({ role }: { role: PayoutRole }) {
  const config = roleConfig[role]
  const [state, setState] = useState<PanelState>({ stripe: null, summary: null })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadPayouts() {
      setIsLoading(true)
      setError(null)

      try {
        const [stripeResponse, summaryResponse] = await Promise.all([
          fetch(config.statusUrl, { credentials: 'include' }),
          fetch(config.summaryUrl, { credentials: 'include' }),
        ])
        const [stripeData, summaryData] = await Promise.all([
          stripeResponse.json(),
          summaryResponse.json(),
        ])

        if (!stripeResponse.ok) throw new Error(stripeData.error || 'Unable to load Stripe status')
        if (!summaryResponse.ok) throw new Error(summaryData.error || 'Unable to load payout summary')

        if (isMounted) {
          setState({ stripe: stripeData, summary: summaryData })
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load payouts')
        }
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    loadPayouts()

    return () => {
      isMounted = false
    }
  }, [config.statusUrl, config.summaryUrl])

  const summary = state.summary?.summary
  const isConnected = Boolean(state.stripe?.account)
  const isReady = Boolean(state.stripe?.account?.payouts_enabled)
  const statusLabel = useMemo(() => {
    if (!isConnected) return 'Stripe not connected'
    if (isReady) return 'Payouts ready'
    return `Setup ${state.stripe?.completionPercent ?? 0}% complete`
  }, [isConnected, isReady, state.stripe?.completionPercent])

  const pending = Number(summary?.pending || 0) + Number(summary?.processing || 0)
  const completed = Number(summary?.completed || 0)
  const count = Number(summary?.count || 0)

  return (
    <section className="rounded-lg border border-tan bg-cream p-5 shadow-card sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-clay/15 text-clay">
            <Banknote className="h-5 w-5" />
          </div>
          <h2 className="font-display text-xl font-semibold">{config.title}</h2>
          <p className="mt-1 text-sm text-ink-soft">{config.description}</p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" size="sm" asChild>
            <Link href={config.settingsHref}>
              <CreditCard className="h-4 w-4" />
              Stripe settings
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href={config.payoutHref}>
              Details <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-5 flex items-start gap-3 rounded-lg border border-brick/30 bg-brick/10 p-4 text-sm text-brick">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      ) : (
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <PayoutMetric
            label="Stripe"
            value={isLoading ? 'Loading...' : statusLabel}
            icon={isReady ? CheckCircle2 : CreditCard}
            emphasis={isReady ? 'success' : 'muted'}
          />
          <PayoutMetric
            label={config.pendingLabel}
            value={isLoading ? 'Loading...' : formatMoney(pending, config.summaryUnit)}
            icon={Clock}
            emphasis="primary"
          />
          <PayoutMetric
            label={config.completedLabel}
            value={isLoading ? 'Loading...' : formatMoney(completed, config.summaryUnit)}
            icon={Banknote}
            emphasis="success"
          />
          <PayoutMetric
            label="Records"
            value={isLoading ? 'Loading...' : count > 0 ? String(count) : config.emptyLabel}
            icon={ArrowRight}
            emphasis="muted"
          />
        </div>
      )}
    </section>
  )
}

function PayoutMetric({
  label,
  value,
  icon: Icon,
  emphasis,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  emphasis: 'primary' | 'success' | 'muted'
}) {
  const iconClass = {
    primary: 'bg-clay/15 text-clay',
    success: 'bg-forest/15 text-forest',
    muted: 'bg-cream-deep text-ink-soft',
  }[emphasis]

  return (
    <div className="rounded-lg border border-tan bg-cream/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconClass}`}>
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">{label}</p>
      </div>
      <p className="font-display text-lg font-semibold leading-tight text-ink">{value}</p>
    </div>
  )
}

function formatMoney(amount: number, unit: 'cents' | 'dollars') {
  const dollars = unit === 'cents' ? amount / 100 : amount
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: unit === 'cents' ? 2 : 0,
    maximumFractionDigits: unit === 'cents' ? 2 : 0,
  }).format(dollars || 0)
}
