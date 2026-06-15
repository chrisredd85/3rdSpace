'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const DEFAULT_REFRESH_INTERVAL_MS = 30_000

type ExperiencesLiveRefreshProps = {
  lastUpdatedAt: string | null
  sourceCount: number
  sourceLabels: string[]
  refreshIntervalMs?: number
}

export function ExperiencesLiveRefresh({
  lastUpdatedAt,
  sourceCount,
  sourceLabels,
  refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
}: ExperiencesLiveRefreshProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [lastClientRefreshAt, setLastClientRefreshAt] = useState<Date | null>(null)

  const refresh = useCallback(() => {
    setLastClientRefreshAt(new Date())
    startTransition(() => {
      router.refresh()
    })
  }, [router])

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    const interval = window.setInterval(refreshWhenVisible, refreshIntervalMs)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [refresh, refreshIntervalMs])

  const sourceLabel = sourceCount === 0
    ? 'Waiting for collected data'
    : `${sourceCount} live source${sourceCount === 1 ? '' : 's'}`
  const sourceUpdatedLabel = useMemo(() => formatPacificDateTime(lastUpdatedAt), [lastUpdatedAt])
  const clientRefreshLabel = useMemo(() => formatPacificDateTime(lastClientRefreshAt?.toISOString() ?? null), [lastClientRefreshAt])
  const refreshIntervalLabel = formatRefreshInterval(refreshIntervalMs)

  return (
    <div className="rounded-md border border-tan bg-cream-deep/55 px-3 py-2 text-xs text-ink-soft">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-ink">
            <span className={cn('h-2 w-2 rounded-full', sourceCount > 0 ? 'bg-forest' : 'bg-ochre')} />
            <span>{sourceLabel}</span>
          </div>
          <p className="mt-1 leading-snug">
            {sourceUpdatedLabel ? `Source updated ${sourceUpdatedLabel}` : 'This will fill in as planner, booking, ticketing, and financial rows are collected.'}
          </p>
          <p className="mt-1 leading-snug">
            Auto-refreshes every {refreshIntervalLabel} and when you return to this tab.
          </p>
          {sourceLabels.length > 0 ? (
            <p className="mt-1 truncate leading-snug" title={sourceLabels.join(', ')}>
              Reading {sourceLabels.join(', ')}
            </p>
          ) : null}
          {clientRefreshLabel ? (
            <p className="mt-1 leading-snug">Last checked {clientRefreshLabel}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 border-tan bg-cream"
          onClick={refresh}
          disabled={isPending}
        >
          <RefreshCw className={cn('h-4 w-4', isPending && 'animate-spin')} />
          {isPending ? 'Updating' : 'Refresh'}
        </Button>
      </div>
    </div>
  )
}

function formatPacificDateTime(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'short',
  }).format(parsed)
}

function formatRefreshInterval(valueMs: number) {
  const seconds = Math.round(valueMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  return `${minutes}m`
}
