'use client'

import { AlertCircle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StaleRecommendationNoticeProps {
  planRevisionAtCreation?: number | null
  currentPlanRevisionCount?: number | null
  isRefreshing?: boolean
  compact?: boolean
  className?: string
  onRefresh?: () => void
}

export function isRecommendationStale(
  planRevisionAtCreation?: number | null,
  currentPlanRevisionCount?: number | null
) {
  return typeof planRevisionAtCreation === 'number' &&
    typeof currentPlanRevisionCount === 'number' &&
    currentPlanRevisionCount > planRevisionAtCreation
}

export function StaleRecommendationNotice({
  planRevisionAtCreation,
  currentPlanRevisionCount,
  isRefreshing = false,
  compact = false,
  className,
  onRefresh,
}: StaleRecommendationNoticeProps) {
  if (!isRecommendationStale(planRevisionAtCreation, currentPlanRevisionCount)) return null

  return (
    <div
      className={cn(
        'flex max-w-full flex-wrap items-center gap-2 rounded-md border border-ochre/25 bg-ochre-tint px-3 py-2 text-xs font-semibold text-ochre',
        compact ? 'py-1.5 text-[11px]' : null,
        className
      )}
      title="Your plan changed after we surfaced this option. Click refresh to update."
    >
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">From earlier version of your plan</span>
      {onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="inline-flex min-h-8 items-center gap-1 rounded-full border border-ochre/25 bg-cream px-2 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-ochre transition-colors hover:border-ochre hover:bg-ochre hover:text-cream disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing ? 'animate-spin' : null)} />
          Refresh
        </button>
      ) : null}
    </div>
  )
}
