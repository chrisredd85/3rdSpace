'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, History, Loader2, X } from 'lucide-react'
import type { PlanRevision } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils/relativeTime'

interface RevisionHistoryModalProps {
  planId?: string | null
  isOpen: boolean
  onClose: () => void
}

const PAGE_SIZE = 20

export function RevisionHistoryModal({ planId, isOpen, onClose }: RevisionHistoryModalProps) {
  const [revisions, setRevisions] = useState<PlanRevision[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  useEffect(() => {
    if (!isOpen || !planId) return
    let cancelled = false

    async function loadRevisions() {
      setIsLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/planner/plans/${planId}/revisions`, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const payload = await response.json().catch(() => ({})) as { revisions?: PlanRevision[]; error?: string }
        if (!response.ok) throw new Error(payload.error ?? 'Could not load revision history.')
        if (!cancelled) {
          setRevisions(Array.isArray(payload.revisions) ? payload.revisions : [])
          setPage(0)
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load revision history.')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadRevisions()
    return () => {
      cancelled = true
    }
  }, [isOpen, planId])

  const totalPages = Math.max(1, Math.ceil(revisions.length / PAGE_SIZE))
  const pageItems = useMemo(() => {
    const start = page * PAGE_SIZE
    return revisions.slice(start, start + PAGE_SIZE)
  }, [page, revisions])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 px-4 py-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Plan revision history"
        className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-lg border border-tan bg-cream shadow-card"
      >
        <div className="flex items-start justify-between gap-4 border-b border-tan px-5 py-4">
          <div className="min-w-0">
            <p className="label-caps text-clay">Plan memory</p>
            <h2 className="mt-1 font-display text-2xl font-bold text-ink">Revision history</h2>
            <p className="mt-1 text-sm leading-6 text-ink-soft">
              Changes that refreshed the event brief, recommendations, approvals, or outreach assumptions.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close revision history"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-tan bg-cream-deep text-ink-soft transition-colors hover:border-clay hover:text-clay focus:outline-none focus-visible:ring-2 focus-visible:ring-clay"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[62vh] overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="flex min-h-48 items-center justify-center gap-3 text-sm font-semibold text-ink-soft">
              <Loader2 className="h-5 w-5 animate-spin text-clay" />
              Loading revision history
            </div>
          ) : error ? (
            <div className="rounded-md border border-brick/25 bg-brick/10 px-4 py-3 text-sm font-semibold text-brick">
              {error}
            </div>
          ) : revisions.length === 0 ? (
            <div className="rounded-lg border border-tan bg-cream-deep px-4 py-8 text-center">
              <History className="mx-auto h-6 w-6 text-clay" />
              <p className="mt-3 font-semibold text-ink">No plan revisions yet.</p>
              <p className="mt-1 text-sm leading-6 text-ink-soft">
                When the organizer changes date, budget, guests, partner terms, or scope, those changes appear here.
              </p>
            </div>
          ) : (
            <ol className="space-y-3">
              {pageItems.map((revision) => (
                <li key={revision.id} className="rounded-lg border border-tan bg-cream-deep/70 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-bold leading-5 text-ink">
                        {formatTriggerSummary(revision)}
                      </p>
                      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.08em] text-ink-faint">
                        {formatRevisionTime(revision.applied_at)}
                      </p>
                    </div>
                    <span className="inline-flex w-fit rounded-full border border-clay/20 bg-clay-tint px-2 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-clay">
                      {revision.trigger_type.replace(/_/g, ' ')}
                    </span>
                  </div>
                  {sourceExcerpt(revision) ? (
                    <blockquote className="mt-3 rounded-md border-l-2 border-clay bg-cream px-3 py-2 text-sm leading-6 text-ink-soft">
                      {sourceExcerpt(revision)}
                    </blockquote>
                  ) : null}
                  <p className="mt-3 text-sm leading-6 text-ink-soft">
                    {formatImpactSummary(revision)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-tan px-5 py-4 text-sm text-ink-soft">
          <span>
            {revisions.length === 0 ? '0 revisions' : `Page ${page + 1} of ${totalPages}`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              className="inline-flex min-h-10 items-center gap-1 rounded-md border border-tan bg-cream px-3 font-bold text-ink-soft transition-colors hover:border-clay hover:text-clay disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
              Newer
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
              className="inline-flex min-h-10 items-center gap-1 rounded-md border border-tan bg-cream px-3 font-bold text-ink-soft transition-colors hover:border-clay hover:text-clay disabled:cursor-not-allowed disabled:opacity-50"
            >
              Older
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

function formatTriggerSummary(revision: PlanRevision) {
  const payload = asRecord(revision.trigger_payload)
  const field = readString(payload?.field)
  const typeLabel = revision.trigger_type.replace(/_/g, ' ')
  if (field) return `${sentenceCase(typeLabel)} changed ${field.replace(/_/g, ' ')}`
  return `${sentenceCase(typeLabel)} applied`
}

function formatRevisionTime(value: string) {
  const relative = formatRelativeTime(value)
  const exact = new Date(value)
  if (Number.isNaN(exact.getTime())) return relative
  return `${relative} · ${exact.toLocaleString()}`
}

function sourceExcerpt(revision: PlanRevision) {
  const payload = asRecord(revision.trigger_payload)
  return readString(payload?.source_message_excerpt) ?? readString(payload?.sourceMessageExcerpt)
}

function formatImpactSummary(revision: PlanRevision) {
  const impact = asRecord(revision.impact_summary)
  if (!impact) return 'Event brief refreshed. No additional stale records were reported.'

  const parts: string[] = []
  const supersededRecommendations = countArray(impact.superseded_recommendation_ids ?? impact.invalidated_recommendation_ids)
  const supersededApprovals = countArray(impact.superseded_approval_ids)
  const outreachThreads = countArray(impact.superseded_outreach_thread_ids)
  const rediscovery = readStringArray(revision.rediscovery_triggered_for)

  if (supersededRecommendations > 0) parts.push(`${supersededRecommendations} recommendation${supersededRecommendations === 1 ? '' : 's'} marked stale`)
  if (supersededApprovals > 0) parts.push(`${supersededApprovals} approval${supersededApprovals === 1 ? '' : 's'} blocked for re-review`)
  if (outreachThreads > 0) parts.push(`${outreachThreads} outreach thread${outreachThreads === 1 ? '' : 's'} needs updated terms`)
  if (rediscovery.length > 0) parts.push(`rediscovery queued for ${rediscovery.join(', ')}`)

  return parts.length > 0 ? parts.join('. ') + '.' : 'Event brief refreshed. Current options remain usable.'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function countArray(value: unknown) {
  return Array.isArray(value) ? value.length : 0
}

function sentenceCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
