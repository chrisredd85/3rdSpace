'use client'

import { CheckCircle2, Circle, ClipboardCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type LiveRecommendationState = 'open' | 'acknowledged' | 'dismissed' | 'acted_on'
export type LiveRecommendationSeverity = 'info' | 'recommend' | 'urgent'

export type LiveRecommendation = {
  id: string
  event_id: string
  org_id: string
  trigger_key: string
  severity: LiveRecommendationSeverity
  suggested_action: string
  evidence: Record<string, number | string>
  agent_narrative: string
  state: LiveRecommendationState
  created_at: string
  updated_at: string
}

type LiveAgentFeedProps = {
  recommendations: LiveRecommendation[]
  isUpdating?: boolean
  onStateChange: (recommendationId: string, state: LiveRecommendationState) => Promise<void>
}

const severityLabels: Record<LiveRecommendationSeverity, string> = {
  info: 'Info',
  recommend: 'Recommended',
  urgent: 'Urgent',
}

const triggerLabels: Record<string, string> = {
  breakeven_crossed: 'Breakeven crossed',
  velocity_drop: 'Velocity drop',
  tier_imbalance: 'Tier imbalance',
  refund_spike: 'Refund spike',
  capacity_warning: 'Capacity warning',
  sellout_imminent: 'Sellout imminent',
  cost_overrun: 'Cost overrun',
  margin_room_for_upgrade: 'Margin room',
}

export function LiveAgentFeed({
  recommendations,
  isUpdating = false,
  onStateChange,
}: LiveAgentFeedProps) {
  const visibleRecommendations = recommendations
    .filter((recommendation) => recommendation.state !== 'dismissed')
    .sort((first, second) => new Date(first.created_at).getTime() - new Date(second.created_at).getTime())

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-foreground">Live agent feed</h2>
          <p className="text-sm text-muted-foreground">
            {visibleRecommendations.length} active recommendations
          </p>
        </div>
        {isUpdating ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Circle className="h-2.5 w-2.5 fill-primary text-primary" aria-hidden="true" />
            Updating
          </span>
        ) : null}
      </div>

      {visibleRecommendations.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card/40 px-5 py-10 text-center">
          <p className="font-medium text-foreground">No live recommendations are open.</p>
          <p className="mt-1 text-sm text-muted-foreground">The feed will populate when revenue, velocity, capacity, refunds, or cost triggers fire.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleRecommendations.map((recommendation) => (
            <article
              key={recommendation.id}
              className={cn(
                'rounded-md border bg-card p-4 shadow-sm',
                recommendation.severity === 'urgent' && 'border-destructive/40',
                recommendation.severity === 'recommend' && 'border-primary/30',
                recommendation.severity === 'info' && 'border-border'
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn(
                      'rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em]',
                      recommendation.severity === 'urgent' && 'border-destructive/30 bg-destructive/10 text-destructive',
                      recommendation.severity === 'recommend' && 'border-primary/30 bg-primary/10 text-primary',
                      recommendation.severity === 'info' && 'border-border bg-muted text-muted-foreground'
                    )}>
                      {severityLabels[recommendation.severity]}
                    </span>
                    <h3 className="font-semibold text-foreground">
                      {triggerLabels[recommendation.trigger_key] ?? recommendation.trigger_key}
                    </h3>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-foreground">
                    {recommendation.agent_narrative || recommendation.suggested_action}
                  </p>
                </div>
                <p className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatRelativeTime(recommendation.created_at)}
                </p>
              </div>

              <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(recommendation.evidence ?? {}).map(([key, value]) => (
                  <div key={key} className="rounded-md border border-border bg-background px-3 py-2">
                    <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {formatEvidenceLabel(key)}
                    </dt>
                    <dd className="mt-1 font-mono text-sm text-foreground">
                      {formatEvidenceValue(key, value)}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                {recommendation.state !== 'acknowledged' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onStateChange(recommendation.id, 'acknowledged')}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    Acknowledge
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onStateChange(recommendation.id, 'acted_on')}
                >
                  <ClipboardCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                  Mark acted on
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onStateChange(recommendation.id, 'dismissed')}
                >
                  <X className="mr-2 h-4 w-4" aria-hidden="true" />
                  Dismiss
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function formatRelativeTime(value: string) {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return 'Just now'
  const diffSeconds = Math.max(Math.floor((Date.now() - parsed.getTime()) / 1000), 0)
  if (diffSeconds < 60) return 'Just now'
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

function formatEvidenceLabel(key: string) {
  return key.replace(/_/g, ' ')
}

function formatEvidenceValue(key: string, value: number | string) {
  if (typeof value === 'number' && key.endsWith('_cents')) return formatCents(value)
  if (typeof value === 'number' && (key.endsWith('_pct') || key.includes('ratio'))) {
    const percent = value <= 1 ? value * 100 : value
    return `${Math.round(percent * 100) / 100}%`
  }
  return String(value)
}

function formatCents(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}
