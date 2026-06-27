'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarDays, ChevronDown, ChevronRight, FileText, MapPin, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Plan, PlanMessage } from '@/lib/types'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/utils/relativeTime'

type PlannerBriefStripProps = {
  plan: Plan | null
  messages?: PlanMessage[]
  accountId?: string | null
  className?: string
}

type BriefStatus = 'planning' | 'discovery' | 'outreach' | 'committed' | 'settled'

export function PlannerBriefStrip({ plan, messages = [], accountId, className }: PlannerBriefStripProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const storageKey = useMemo(() => {
    if (!plan) return 'brief_strip_collapsed:anonymous'
    return `brief_strip_collapsed:${accountId ?? plan.user_id ?? plan.id}`
  }, [accountId, plan])

  useEffect(() => {
    if (!plan) return
    try {
      const scoped = window.localStorage.getItem(storageKey)
      const legacy = window.localStorage.getItem('brief_strip_collapsed')
      const stored = scoped ?? legacy
      if (stored === 'true' || stored === 'collapsed') setIsCollapsed(true)
      if (stored === 'false' || stored === 'expanded') setIsCollapsed(false)
    } catch {
      // Ignore storage errors; the strip still works without persistence.
    }
  }, [plan, storageKey])

  if (!plan) return null

  const status = getBriefStatus(plan, messages)
  const statusLabel = statusLabels[status]
  const relativeUpdated = formatRelativeTime(plan.updated_at)
  const chips = buildBriefChips(plan)
  const fullBriefHref = `/planner/experiences/${plan.id}`

  function toggleCollapsed() {
    setIsCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem(storageKey, next ? 'true' : 'false')
      } catch {
        // Ignore storage errors.
      }
      return next
    })
  }

  return (
    <section
      className={cn(
        'rounded-2xl border border-border bg-card/60 px-4 py-3 shadow-card',
        'transition-smooth',
        className
      )}
      aria-label="Active event brief summary"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!isCollapsed}
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cream-deep text-secondary">
            <FileText className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="truncate font-display text-base font-bold leading-tight text-foreground sm:text-lg" title={plan.title}>
                {plan.title}
              </span>
              <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em]', statusStyles[status])}>
                {statusLabel}
              </span>
            </span>
            {isCollapsed ? (
              <span className="mt-1 block truncate text-xs font-medium text-muted-foreground">
                {relativeUpdated ? `Updated ${relativeUpdated}` : 'Current event brief'}
              </span>
            ) : null}
          </span>
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
          )}
        </button>

        <Button asChild variant="glass" size="sm" className="shrink-0 justify-center">
          <Link href={fullBriefHref}>
            Open full brief
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      {!isCollapsed ? (
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap gap-2">
            {chips.map((chip) => (
              <span
                key={chip.label}
                className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 py-1 text-xs font-semibold text-muted-foreground"
              >
                {chip.icon}
                <span className="truncate" title={chip.value}>{chip.value}</span>
              </span>
            ))}
          </div>
          <p className="shrink-0 text-xs font-medium text-muted-foreground">
            {relativeUpdated ? `Updated ${relativeUpdated}` : 'Saved plan context'}
          </p>
        </div>
      ) : null}
    </section>
  )
}

const statusLabels: Record<BriefStatus, string> = {
  planning: 'Planning',
  discovery: 'Discovery',
  outreach: 'Outreach',
  committed: 'Committed',
  settled: 'Settled',
}

const statusStyles: Record<BriefStatus, string> = {
  planning: 'bg-muted text-muted-foreground',
  discovery: 'bg-secondary/10 text-secondary',
  outreach: 'bg-clay-tint text-clay',
  committed: 'bg-forest-tint text-forest',
  settled: 'bg-success/10 text-success',
}

function buildBriefChips(plan: Plan) {
  return [
    {
      label: 'date',
      value: formatDateWindow(plan.date_window_start, plan.date_window_end) ?? 'Date TBD',
      icon: <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
    },
    {
      label: 'area',
      value: plan.neighborhood ?? plan.event_city ?? 'Area TBD',
      icon: <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
    },
    {
      label: 'guests',
      value: plan.guest_count ? `${plan.guest_count} guests` : 'Guests TBD',
      icon: <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
    },
  ]
}

function getBriefStatus(plan: Plan, messages: PlanMessage[]): BriefStatus {
  if (plan.status === 'complete' || plan.status === 'archived') return 'settled'
  if (plan.committed_venue_at || hasCommittedVendors(plan)) return 'committed'
  if (messages.some(hasPendingApproval)) return 'outreach'
  if (messages.some(isRecommendationMessage) || plan.status === 'ready' || plan.status === 'approved' || plan.status === 'executing') return 'discovery'
  return 'planning'
}

function hasCommittedVendors(plan: Plan) {
  return Array.isArray(plan.committed_vendors) ? plan.committed_vendors.length > 0 : Boolean(plan.committed_vendors)
}

function hasPendingApproval(message: PlanMessage) {
  const metadata = readRecord(message.metadata)
  const approval = readRecord(metadata?.approval)
  const status = typeof approval?.status === 'string' ? approval.status : null
  return message.message_type === 'confirmation_card' && status !== 'approved' && status !== 'cancelled' && status !== 'superseded'
}

function isRecommendationMessage(message: PlanMessage) {
  return message.message_type === 'recommendation' || Boolean(readRecord(message.metadata)?.recommendations)
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function formatDateWindow(start: string | null, end: string | null) {
  if (!start && !end) return null
  if (start && end && start !== end) return `${formatDate(start)} - ${formatDate(end)}`
  return formatDate(start ?? end)
}

function formatDate(value: string | null) {
  if (!value) return 'Date TBD'
  const parsed = new Date(`${value}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(parsed)
}
