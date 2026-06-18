'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  DatabaseZap,
  Loader2,
  RefreshCw,
  Ticket,
  TrendingUp,
  WalletCards,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  LiveAgentFeed,
  type LiveRecommendation,
  type LiveRecommendationState,
} from '@/components/planner/LiveAgentFeed'

type LiveEventSnapshot = {
  event: {
    id: string
    name: string
    status: string | null
    event_date: string | null
    capacity: number | null
  }
  pnl: {
    revenue: {
      gross_revenue_cents: number
      refunds_cents: number
      platform_fees_cents: number
      taxes_collected_cents: number
      net_revenue_cents: number
      tickets_sold: number
      tickets_refunded: number
      tickets_checked_in: number | null
      tier_breakdown: Array<{
        tier_name: string
        sold: number
        gross_cents: number
        sellout_pct: number | null
      }>
      velocity: {
        last_24h_cents: number
        last_7d_cents: number
        since_launch_cents: number
        projected_sellout_at: string | null
      }
      data_sources: string[]
      confidence: {
        revenue: 'low' | 'medium' | 'high'
        attendance: 'low' | 'medium' | 'high'
      }
      last_event_at: string | null
    }
    costs: {
      estimated_cents: number
      committed_cents: number
      paid_cents: number
    }
    net: {
      conservative_cents: number
      expected_cents: number
      optimistic_cents: number
    }
    breakeven: {
      tickets_needed: number
      tickets_to_go: number
      crossed_at: string | null
    }
    margin_pct: number
    consumption_share_adjustments: Array<{
      party_name: string
      type: string
      amount_cents: number
    }>
    terms_conflict?: boolean
  }
  kpis: {
    tickets_sold: number
    active_tickets: number
    capacity: number | null
    gross_revenue_cents: number
    net_revenue_cents: number
    breakeven_progress_pct: number
    refund_risk_level: 'low' | 'watch' | 'high' | 'urgent'
    no_show_rate: number | null
    profit_target_gap_cents: number | null
  }
  velocity_points: Array<{
    bucket_start: string
    gross_cents: number
    orders: number
  }>
  signals: {
    refund_risk: {
      level: 'low' | 'watch' | 'high' | 'urgent'
      refund_ratio: number
      refunds_cents: number
      tickets_refunded: number
      tickets_sold: number
    }
    attendance: {
      status: 'unknown' | 'on_track' | 'watch' | 'high_no_show'
      active_tickets: number
      checked_in: number | null
      no_show_count: number | null
      no_show_rate: number | null
      confidence: 'low' | 'medium' | 'high'
    }
    cost_commitments: {
      estimated_cents: number
      committed_cents: number
      paid_cents: number
      total_expected_cents: number
    }
    profit_target: {
      target_cents: number | null
      current_expected_net_cents: number
      gap_cents: number | null
    }
  }
  costs: {
    estimated_cents: number
    committed_cents: number
    paid_cents: number
    total_expected_cents: number
  }
  revenue_terms: {
    impacts: Array<{
      term_id: string | null
      term_type: string
      party_name: string | null
      applies_to: string
      basis_cents: number
      unit_count: number | null
      amount_cents: number
      net_revenue_delta_cents: number
      cost_delta_cents: number
    }>
    summary: {
      sales_tax_cents: number
      platform_fee_cents: number
      venue_chi_cents: number
      sponsor_credit_cents: number
      vendor_consumption_share_cents: number
      venue_minimum_spend_cents: number
      other_cents: number
    }
  }
  recommendations: LiveRecommendation[]
  freshness: {
    data_sources: string[]
    last_event_at: string | null
    has_connected_source: boolean
    connected_platforms: string[]
    has_recent_csv: boolean
  }
  empty_state: {
    show: boolean
    reason: string
  }
}

type LiveEventResponse = {
  snapshot?: LiveEventSnapshot
  error?: string
}

type LiveEventDashboardProps = {
  eventId: string
}

export function LiveEventDashboard({ eventId }: LiveEventDashboardProps) {
  const [snapshot, setSnapshot] = useState<LiveEventSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isUpdating, setIsUpdating] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const recomputeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadSnapshot = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setIsLoading(true)
    setErrorMessage(null)
    try {
      const response = await fetch(`/api/planner/events/${eventId}/live`, {
        cache: 'no-store',
      })
      const payload = (await response.json().catch(() => ({}))) as LiveEventResponse
      if (!response.ok || !payload.snapshot) {
        throw new Error(payload.error ?? 'Unable to load live event snapshot')
      }
      setSnapshot(payload.snapshot)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load live event snapshot')
    } finally {
      setIsLoading(false)
      setIsUpdating(false)
    }
  }, [eventId])

  useEffect(() => {
    void loadSnapshot()
  }, [loadSnapshot])

  useEffect(() => {
    const supabase = createClient()
    const scheduleRecompute = () => {
      setIsUpdating(true)
      void loadSnapshot({ silent: true })
      if (recomputeTimerRef.current) clearTimeout(recomputeTimerRef.current)
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)

      recomputeTimerRef.current = setTimeout(async () => {
        await fetch(`/api/planner/events/${eventId}/live`, { method: 'POST' }).catch(() => null)
        refreshTimerRef.current = setTimeout(() => {
          void loadSnapshot({ silent: true })
        }, 1_500)
      }, 5_000)
    }

    const salesChannel = supabase
      .channel(`live-event-sales:${eventId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'event_sales_data',
          filter: `event_id=eq.${eventId}`,
        },
        scheduleRecompute
      )
      .subscribe()

    const recommendationChannel = supabase
      .channel(`live-recommendations:${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'live_recommendations',
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          void loadSnapshot({ silent: true })
        }
      )
      .subscribe()

    return () => {
      if (recomputeTimerRef.current) clearTimeout(recomputeTimerRef.current)
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      void supabase.removeChannel(salesChannel)
      void supabase.removeChannel(recommendationChannel)
    }
  }, [eventId, loadSnapshot])

  const sparkline = useMemo(() => buildSparkline(snapshot?.velocity_points ?? []), [snapshot?.velocity_points])

  const handleRecommendationStateChange = useCallback(async (
    recommendationId: string,
    state: LiveRecommendationState
  ) => {
    setSnapshot((current) => {
      if (!current) return current
      return {
        ...current,
        recommendations: current.recommendations.map((recommendation) => (
          recommendation.id === recommendationId
            ? { ...recommendation, state }
            : recommendation
        )),
      }
    })

    try {
      const response = await fetch(`/api/planner/events/${eventId}/live`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recommendation_id: recommendationId, state }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to update recommendation')
      await loadSnapshot({ silent: true })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to update recommendation')
      await loadSnapshot({ silent: true })
    }
  }, [eventId, loadSnapshot])

  if (isLoading && !snapshot) {
    return (
      <div className="flex min-h-72 items-center justify-center rounded-md border border-border bg-card/50 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading live event
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {errorMessage ?? 'Unable to load live event.'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {errorMessage ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          {errorMessage}
        </div>
      ) : null}

      {snapshot.empty_state.show ? (
        <EmptyState />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Tickets sold"
          value={`${snapshot.kpis.tickets_sold}${snapshot.kpis.capacity ? ` / ${snapshot.kpis.capacity}` : ''}`}
          sublabel={snapshot.pnl.revenue.tickets_refunded > 0 ? `${snapshot.kpis.active_tickets} active after refunds` : 'Active sold'}
          icon={<Ticket className="h-4 w-4" aria-hidden="true" />}
        />
        <KpiTile
          label="Gross revenue"
          value={formatCents(snapshot.kpis.gross_revenue_cents)}
          sublabel={`${formatCents(snapshot.pnl.revenue.refunds_cents)} refund exposure`}
          icon={<WalletCards className="h-4 w-4" aria-hidden="true" />}
        />
        <KpiTile
          label="Net revenue"
          value={formatCents(snapshot.kpis.net_revenue_cents)}
          sublabel={`${formatCents(snapshot.pnl.revenue.platform_fees_cents + snapshot.pnl.revenue.taxes_collected_cents)} fees and taxes`}
          icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />}
          tone={snapshot.kpis.net_revenue_cents >= 0 ? 'positive' : 'negative'}
        />
        <KpiTile
          label="Breakeven"
          value={snapshot.pnl.breakeven.crossed_at ? 'Crossed' : `${snapshot.pnl.breakeven.tickets_to_go} to go`}
          sublabel={`${snapshot.pnl.breakeven.tickets_needed} tickets needed`}
          icon={<DatabaseZap className="h-4 w-4" aria-hidden="true" />}
        />
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-md border border-border bg-card p-4">
          <h2 className="font-display text-xl font-semibold text-foreground">Refund risk</h2>
          <div className="mt-4 space-y-3">
            <MiniMetric label="Risk" value={formatRiskLabel(snapshot.signals.refund_risk.level)} />
            <MiniMetric label="Refund ratio" value={formatPercent(snapshot.signals.refund_risk.refund_ratio)} />
            <MiniMetric label="Refunded" value={formatCents(snapshot.signals.refund_risk.refunds_cents)} />
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-4">
          <h2 className="font-display text-xl font-semibold text-foreground">Attendance signal</h2>
          <div className="mt-4 space-y-3">
            <MiniMetric label="Status" value={formatAttendanceStatus(snapshot.signals.attendance.status)} />
            <MiniMetric
              label="Checked in"
              value={snapshot.signals.attendance.checked_in === null ? 'Needs check-ins' : String(snapshot.signals.attendance.checked_in)}
            />
            <MiniMetric
              label="No-show rate"
              value={snapshot.signals.attendance.no_show_rate === null ? 'Needs check-ins' : formatPercent(snapshot.signals.attendance.no_show_rate)}
            />
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-4">
          <h2 className="font-display text-xl font-semibold text-foreground">Profit target gap</h2>
          <div className="mt-4 space-y-3">
            <MiniMetric
              label="Target"
              value={snapshot.signals.profit_target.target_cents === null ? 'No target set' : formatCents(snapshot.signals.profit_target.target_cents)}
            />
            <MiniMetric label="Expected net" value={formatCents(snapshot.signals.profit_target.current_expected_net_cents)} />
            <MiniMetric
              label="Gap"
              value={snapshot.signals.profit_target.gap_cents === null ? 'No target set' : formatCents(snapshot.signals.profit_target.gap_cents)}
            />
          </div>
        </div>
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">Breakeven progress</h2>
            <p className="text-sm text-muted-foreground">
              Conservative net {formatCents(snapshot.pnl.net.conservative_cents)} · Expected net {formatCents(snapshot.pnl.net.expected_cents)}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => void loadSnapshot()}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              snapshot.pnl.breakeven.crossed_at ? 'bg-primary' : 'bg-foreground'
            )}
            style={{ width: `${Math.round(snapshot.kpis.breakeven_progress_pct * 100)}%` }}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold text-foreground">Velocity</h2>
              <p className="text-sm text-muted-foreground">
                Last 24h {formatCents(snapshot.pnl.revenue.velocity.last_24h_cents)} · Last 7d {formatCents(snapshot.pnl.revenue.velocity.last_7d_cents)}
              </p>
            </div>
            {snapshot.pnl.revenue.velocity.projected_sellout_at ? (
              <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                Sellout {formatRelativeTime(snapshot.pnl.revenue.velocity.projected_sellout_at)}
              </span>
            ) : null}
          </div>
          <svg
            className="mt-5 h-28 w-full overflow-visible"
            viewBox="0 0 320 96"
            role="img"
            aria-label="Seven day hourly revenue velocity"
          >
            <path d="M0 88H320" className="stroke-border" strokeWidth="1" fill="none" />
            <path d={sparkline.areaPath} className="fill-primary/10" />
            <path d={sparkline.linePath} className="stroke-primary" strokeWidth="3" fill="none" strokeLinecap="round" />
          </svg>
        </section>

        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="font-display text-xl font-semibold text-foreground">Cost commitments</h2>
          <div className="mt-4 space-y-3">
            <MiniMetric label="Total expected" value={formatCents(snapshot.costs.total_expected_cents)} />
            <MiniMetric label="Estimated" value={formatCents(snapshot.costs.estimated_cents)} />
            <MiniMetric label="Committed" value={formatCents(snapshot.costs.committed_cents)} />
            <MiniMetric label="Paid" value={formatCents(snapshot.costs.paid_cents)} />
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="font-display text-xl font-semibold text-foreground">Tier breakdown</h2>
          {snapshot.pnl.revenue.tier_breakdown.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No tier-level sales rows yet.</p>
          ) : (
            <div className="mt-4 overflow-hidden rounded-md border border-border">
              {snapshot.pnl.revenue.tier_breakdown.map((tier, index) => (
                <div
                  key={tier.tier_name}
                  className={cn(
                    'grid gap-3 px-4 py-3 text-sm sm:grid-cols-[1.2fr_0.6fr_0.8fr_0.8fr]',
                    index > 0 && 'border-t border-border'
                  )}
                >
                  <span className="font-medium text-foreground">{tier.tier_name}</span>
                  <span className="text-muted-foreground">{tier.sold} sold</span>
                  <span className="text-foreground">{formatCents(tier.gross_cents)}</span>
                  <span className="text-muted-foreground">
                    {tier.sellout_pct === null ? 'No cap' : `${Math.round(tier.sellout_pct * 100)}% sold`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="font-display text-xl font-semibold text-foreground">Revenue terms</h2>
          <div className="mt-4 space-y-3">
            <MiniMetric label="Taxes" value={`-${formatCents(snapshot.revenue_terms.summary.sales_tax_cents)}`} />
            <MiniMetric label="Platform fees" value={`-${formatCents(snapshot.revenue_terms.summary.platform_fee_cents)}`} />
            <MiniMetric label="Community Host Incentive" value={formatCents(snapshot.revenue_terms.summary.venue_chi_cents)} />
            {snapshot.revenue_terms.impacts.slice(0, 3).map((impact) => (
              <MiniMetric
                key={`${impact.term_id ?? impact.term_type}-${impact.party_name ?? 'term'}`}
                label={formatTermLabel(impact)}
                value={formatCents(impact.amount_cents)}
              />
            ))}
          </div>
          {snapshot.pnl.terms_conflict ? (
            <p className="mt-4 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
              A partner-share term overlaps a manual vendor commitment; the larger cost basis is being used.
            </p>
          ) : null}
        </section>
      </div>

      <LiveAgentFeed
        recommendations={snapshot.recommendations}
        isUpdating={isUpdating}
        onStateChange={handleRecommendationStateChange}
      />

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Clock className="h-4 w-4" aria-hidden="true" />
          Last event received {snapshot.freshness.last_event_at ? formatRelativeTime(snapshot.freshness.last_event_at) : 'never'}
        </span>
        <span>
          Source {snapshot.freshness.data_sources.length > 0 ? snapshot.freshness.data_sources.join(', ') : 'none'}
        </span>
      </footer>
    </div>
  )
}

function EmptyState() {
  return (
    <section className="rounded-md border border-dashed border-border bg-card/40 px-5 py-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold text-foreground">Connect sales data</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Live P&L starts once this event has webhook data or an imported sales file.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/planner/integrations/posh">
              Posh
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/planner/integrations/eventbrite">
              Eventbrite
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild>
            <Link href="/planner/events/import">
              Import
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  )
}

function KpiTile({
  label,
  value,
  sublabel,
  icon,
  tone = 'default',
}: {
  label: string
  value: string
  sublabel: string
  icon: ReactNode
  tone?: 'default' | 'positive' | 'negative'
}) {
  return (
    <div className={cn(
      'rounded-md border bg-card px-4 py-4',
      tone === 'positive' && 'border-primary/30',
      tone === 'negative' && 'border-destructive/40'
    )}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-foreground">
          {icon}
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{sublabel}</p>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-semibold text-foreground">{value}</span>
    </div>
  )
}

function buildSparkline(points: LiveEventSnapshot['velocity_points']) {
  const values = points.map((point) => point.gross_cents)
  const max = Math.max(...values, 1)
  const width = 320
  const height = 88
  const step = points.length > 1 ? width / (points.length - 1) : width
  const coords = points.map((point, index) => {
    const x = index * step
    const y = height - (Math.max(point.gross_cents, 0) / max) * (height - 8)
    return [x, Math.max(8, Math.min(height, y))] as const
  })
  const linePath = coords.length > 0
    ? coords.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`).join(' ')
    : 'M0 88 L320 88'
  const areaPath = coords.length > 0
    ? `${linePath} L320 96 L0 96 Z`
    : 'M0 96 L320 96 Z'
  return { linePath, areaPath }
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

function formatTermLabel(impact: LiveEventSnapshot['revenue_terms']['impacts'][number]) {
  const party = impact.party_name ? `${impact.party_name} ` : ''
  return `${party}${impact.term_type.replace(/_/g, ' ')}`
}

function formatRelativeTime(value: string) {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return 'never'
  const diffSeconds = Math.floor((Date.now() - parsed.getTime()) / 1000)
  if (diffSeconds < -60) return parsed.toLocaleDateString()
  if (diffSeconds < 60) return 'just now'
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

function formatRiskLabel(value: LiveEventSnapshot['signals']['refund_risk']['level']) {
  const labels: Record<typeof value, string> = {
    low: 'Low',
    watch: 'Watch',
    high: 'High',
    urgent: 'Urgent',
  }
  return labels[value]
}

function formatAttendanceStatus(value: LiveEventSnapshot['signals']['attendance']['status']) {
  const labels: Record<typeof value, string> = {
    unknown: 'Needs check-ins',
    on_track: 'On track',
    watch: 'Watch',
    high_no_show: 'High no-show',
  }
  return labels[value]
}

function formatPercent(value: number) {
  return `${Math.round(value * 1000) / 10}%`
}

function formatCents(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}
