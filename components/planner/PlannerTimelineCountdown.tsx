'use client'

/**
 * Countdown-anchored timeline for the planner.
 *
 * Milestones are bucketed by how far their due date is from today:
 *   Overdue → Next 7 days → Next 30 days → Later
 *
 * Status is derived from the observable planner message state (venue holds,
 * outreach approvals) via `lib/planner/timelineDerivation.ts` — no extra API
 * calls needed. Blocker links use `?tab=...&msg=...` deep linking so clicking
 * "Resolve →" opens the relevant recommendation or approval card directly.
 */

import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  deriveMilestoneStatuses,
  type DerivationPlan,
  type DerivedMilestone,
  type MilestoneStatus,
} from '@/lib/planner/timelineDerivation'
import type { PlanMessage } from '@/lib/types/planner'
import type { PlanningMilestone } from '@/lib/events/milestoneTemplates'

// ─── Tab type re-declared locally to avoid circular page.tsx imports ──────────
type PlannerNavigationTab = 'chat' | 'event_plan' | 'recommendations' | 'approvals' | 'data' | 'timeline'

// ─── Timeline output shape (mirrors page.tsx TimelineOutput) ─────────────────
interface TimelineOutput {
  planning_milestones: PlanningMilestone[]
  day_of_timeline: Array<{ time: string; activity: string; owner: string; notes: string | null }>
  staffing_needs: string[]
  reminders: string[]
  dependency_warnings: string[]
  impossible_timeline: boolean
}

// ─── Countdown bucket ─────────────────────────────────────────────────────────
type BucketId = 'overdue' | 'next_7' | 'next_30' | 'later'

interface CountdownBucket {
  id: BucketId
  heading: string
  headingClass: string
  milestones: DerivedMilestone[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Public component
// ─────────────────────────────────────────────────────────────────────────────

interface PlannerTimelineCountdownProps {
  plan: DerivationPlan & { date_window_start?: string | null; date_window_end?: string | null }
  messages: PlanMessage[]
  timeline: TimelineOutput | null
  isLoading: boolean
  error: string | null
  onRefresh: () => void
  onNavigateToTab?: (tab: PlannerNavigationTab, messageId?: string) => void
}

export function PlannerTimelineCountdown({
  plan,
  messages,
  timeline,
  isLoading,
  error,
  onRefresh,
  onNavigateToTab,
}: PlannerTimelineCountdownProps) {
  const eventDate = plan.date_window_start ?? plan.date_window_end ?? null

  const derivedMilestones = timeline
    ? deriveMilestoneStatuses(plan, messages, timeline.planning_milestones)
    : []

  const sorted = [...derivedMilestones].sort((a, b) => a.due_date.localeCompare(b.due_date))
  const buckets = bucketMilestones(sorted)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background/60 px-4 py-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Timeline</p>
          <h3 className="mt-1 font-display text-lg font-bold">Planning milestones</h3>
        </div>
        <Button type="button" variant="glass" size="sm" onClick={onRefresh} disabled={isLoading}>
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Loading skeleton */}
      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl border border-border bg-muted/40" />
          ))}
        </div>
      ) : null}

      {/* Error */}
      {!isLoading && error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* Timeline content */}
      {!isLoading && !error && timeline ? (
        <>
          {timeline.impossible_timeline ? (
            <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              This timeline is compressed — critical milestones may not be realistic before the event date.
            </div>
          ) : null}

          {timeline.dependency_warnings.length > 0 ? (
            <div className="rounded-2xl border border-secondary/30 bg-secondary/10 px-4 py-3 text-sm text-secondary">
              {timeline.dependency_warnings.join(' ')}
            </div>
          ) : null}

          {buckets.map((bucket) =>
            bucket.milestones.length === 0 ? null : (
              <section key={bucket.id} className="space-y-3">
                <div className="flex items-baseline justify-between border-b border-border/60 pb-1">
                  <h4 className={cn('text-xs font-bold uppercase tracking-widest', bucket.headingClass)}>
                    {bucket.heading}
                  </h4>
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {bucket.milestones.length} {bucket.milestones.length === 1 ? 'item' : 'items'}
                  </span>
                </div>

                {bucket.milestones.map((milestone) => (
                  <MilestoneCard
                    key={`${milestone.due_date}:${milestone.title}`}
                    milestone={milestone}
                    eventDate={eventDate}
                    onNavigateToTab={onNavigateToTab}
                  />
                ))}
              </section>
            )
          )}
        </>
      ) : null}

      {/* Empty state */}
      {!isLoading && !error && !timeline ? (
        <div className="rounded-2xl border border-border bg-background/60 px-4 py-10 text-center text-sm text-muted-foreground">
          Open this tab to generate a timeline from the current plan.
        </div>
      ) : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Milestone card sub-component
// ─────────────────────────────────────────────────────────────────────────────

function MilestoneCard({
  milestone,
  eventDate,
  onNavigateToTab,
}: {
  milestone: DerivedMilestone
  eventDate: string | null
  onNavigateToTab?: (tab: PlannerNavigationTab, messageId?: string) => void
}) {
  const { status } = milestone

  return (
    <div className="flex gap-4 rounded-2xl border border-border bg-background/60 p-4">
      {/* Date label */}
      <div className="w-24 shrink-0 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {formatDateLabel(milestone.due_date, eventDate)}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-display text-base font-bold">{milestone.title}</h4>

          {/* Category chip */}
          <span className="rounded-full border border-border bg-card/70 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {milestone.category}
          </span>

          {/* Status badge */}
          <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest', statusBadgeClass(status))}>
            {statusLabel(status)}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Blocking indicator */}
          {milestone.is_blocking ? (
            <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              Blocking
            </span>
          ) : null}

          {/* Blocker resolve link */}
          {milestone.blocker_tab && onNavigateToTab ? (
            <button
              type="button"
              onClick={() =>
                onNavigateToTab(milestone.blocker_tab!, milestone.blocker_msg_id)
              }
              className="rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary transition hover:border-primary hover:bg-primary/20"
            >
              {resolveLabel(milestone.blocker_tab)} →
            </button>
          ) : null}

          {/* Blocker reason */}
          {milestone.blocker_reason && !milestone.blocker_tab ? (
            <span className="text-xs text-muted-foreground">{milestone.blocker_reason}</span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Bucketing
// ─────────────────────────────────────────────────────────────────────────────

function bucketMilestones(milestones: DerivedMilestone[]): CountdownBucket[] {
  const today = parseDateOnly(new Date().toISOString().slice(0, 10))
  const overdue: DerivedMilestone[] = []
  const next7: DerivedMilestone[] = []
  const next30: DerivedMilestone[] = []
  const later: DerivedMilestone[] = []

  for (const milestone of milestones) {
    const due = parseDateOnly(milestone.due_date)
    if (!today || !due) {
      later.push(milestone)
      continue
    }
    const days = Math.round((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
    if (days < 0) overdue.push(milestone)
    else if (days <= 7) next7.push(milestone)
    else if (days <= 30) next30.push(milestone)
    else later.push(milestone)
  }

  return [
    { id: 'overdue', heading: 'Overdue', headingClass: 'text-destructive', milestones: overdue },
    { id: 'next_7', heading: 'Next 7 days', headingClass: 'text-primary', milestones: next7 },
    { id: 'next_30', heading: 'Next 30 days', headingClass: 'text-foreground', milestones: next30 },
    { id: 'later', heading: 'Later', headingClass: 'text-muted-foreground', milestones: later },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// Status display helpers
// ─────────────────────────────────────────────────────────────────────────────

function statusLabel(status: MilestoneStatus): string {
  switch (status) {
    case 'done': return '✓ done'
    case 'in_progress': return '⏳ in progress'
    case 'blocked': return '⚠ blocked'
    case 'overdue': return '✗ overdue'
    case 'pending': return 'pending'
  }
}

function statusBadgeClass(status: MilestoneStatus): string {
  switch (status) {
    case 'done': return 'border-success/30 bg-success/10 text-success'
    case 'in_progress': return 'border-primary/30 bg-primary/10 text-primary'
    case 'blocked': return 'border-secondary/30 bg-secondary/10 text-secondary'
    case 'overdue': return 'border-destructive/30 bg-destructive/10 text-destructive'
    case 'pending': return 'border-border bg-muted text-muted-foreground'
  }
}

function resolveLabel(tab: PlannerNavigationTab): string {
  if (tab === 'recommendations') return 'Resolve in Recommendations'
  if (tab === 'approvals') return 'Open in Approvals'
  return 'Resolve'
}

// ─────────────────────────────────────────────────────────────────────────────
// Date label helper
// ─────────────────────────────────────────────────────────────────────────────

function formatDateLabel(dueDate: string, eventDate: string | null): string {
  if (!eventDate) return dueDate
  const due = parseDateOnly(dueDate)
  const event = parseDateOnly(eventDate)
  if (!due || !event) return dueDate
  const diffDays = Math.round((event.getTime() - due.getTime()) / (24 * 60 * 60 * 1000))
  if (diffDays === 0) return 'Event day'
  if (diffDays > 0) return `T-${diffDays} days`
  return `T+${Math.abs(diffDays)} days`
}

function parseDateOnly(value: string): Date | null {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
