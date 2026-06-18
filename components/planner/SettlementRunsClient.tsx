'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileWarning, Pencil, RefreshCw } from 'lucide-react'
import { centsToDollars } from '@/lib/money'
import { cn } from '@/lib/utils'

export type SettlementRunViewModel = {
  id: string
  event_id: string
  event_name: string
  event_date: string | null
  venue_name: string
  status: string
  attendance_count: number | null
  attendance_source: string | null
  per_attendee_cents: number | null
  rate_source: string | null
  rate_derived_from_event_count: number | null
  total_cents: number | null
  archetype: string
  venue_type: string
  neighborhood: string
}

type SettlementRunsClientProps = {
  initialRuns: SettlementRunViewModel[]
}

type BusyState = {
  id: string
  action: 'approve' | 'dispute' | 'attendance'
} | null

export function SettlementRunsClient({ initialRuns }: SettlementRunsClientProps) {
  const [runs, setRuns] = useState(initialRuns)
  const [busy, setBusy] = useState<BusyState>(null)
  const [error, setError] = useState<string | null>(null)
  const [attendanceRun, setAttendanceRun] = useState<SettlementRunViewModel | null>(null)
  const [attendanceCount, setAttendanceCount] = useState('')
  const [disputeRun, setDisputeRun] = useState<SettlementRunViewModel | null>(null)
  const [disputeReason, setDisputeReason] = useState('')

  const grouped = useMemo(() => ({
    actionNeeded: runs.filter((run) => run.status === 'awaiting_organizer_review'),
    inProgress: runs.filter((run) => ['pending', 'awaiting_attendance', 'awaiting_venue_ack', 'ready_to_settle'].includes(run.status)),
    complete: runs.filter((run) => run.status === 'settled'),
    other: runs.filter((run) => ['disputed', 'cancelled'].includes(run.status)),
  }), [runs])

  async function review(run: SettlementRunViewModel, action: 'approve' | 'dispute', reason?: string) {
    setBusy({ id: run.id, action })
    setError(null)
    try {
      const response = await fetch(`/api/planner/settlement-runs/${run.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, dispute_reason: reason }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Settlement review failed')
      replaceRun(payload.settlement_run)
      setDisputeRun(null)
      setDisputeReason('')
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Settlement review failed')
    } finally {
      setBusy(null)
    }
  }

  async function updateAttendance() {
    if (!attendanceRun) return
    const count = Number(attendanceCount)
    if (!Number.isSafeInteger(count) || count < 0) {
      setError('Attendance must be a non-negative whole number.')
      return
    }

    setBusy({ id: attendanceRun.id, action: 'attendance' })
    setError(null)
    try {
      const response = await fetch(`/api/planner/settlement-runs/${attendanceRun.id}/attendance`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attendance_count: count,
          source: 'organizer_manual',
          evidence_kind: 'organizer_attestation',
          notes: 'Organizer updated attendance from planner settlement review.',
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Attendance update failed')
      replaceRun(payload.settlement_run)
      setAttendanceRun(null)
      setAttendanceCount('')
    } catch (attendanceError) {
      setError(attendanceError instanceof Error ? attendanceError.message : 'Attendance update failed')
    } finally {
      setBusy(null)
    }
  }

  function replaceRun(updated: SettlementRunViewModel) {
    setRuns((current) => current.map((run) => run.id === updated.id ? { ...run, ...updated } : run))
  }

  return (
    <div className="space-y-8">
      {error ? (
        <div className="flex items-start gap-3 rounded-lg border border-clay/30 bg-clay-tint px-4 py-3 text-sm text-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-clay" />
          <p>{error}</p>
        </div>
      ) : null}

      <SettlementSection
        title="Action needed"
        description="Review verified attendance and approve the CHI settlement record for venue acknowledgment."
        runs={grouped.actionNeeded}
        empty="No settlement runs need review."
        busy={busy}
        onApprove={(run) => review(run, 'approve')}
        onDispute={(run) => setDisputeRun(run)}
        onEditAttendance={(run) => {
          setAttendanceRun(run)
          setAttendanceCount(String(run.attendance_count ?? ''))
        }}
      />

      <SettlementSection
        title="In progress"
        description="Runs waiting for attendance, venue acknowledgment, or final settlement."
        runs={grouped.inProgress}
        empty="No settlement runs are in progress."
        busy={busy}
        onApprove={(run) => review(run, 'approve')}
        onDispute={(run) => setDisputeRun(run)}
        onEditAttendance={(run) => {
          setAttendanceRun(run)
          setAttendanceCount(String(run.attendance_count ?? ''))
        }}
      />

      <SettlementSection
        title="Complete"
        description="Settled CHI records."
        runs={grouped.complete}
        empty="No completed settlements yet."
        busy={busy}
      />

      <SettlementSection
        title="Disputed / Cancelled"
        description="Runs paused for operator review or cancelled."
        runs={grouped.other}
        empty="No disputed or cancelled settlement runs."
        busy={busy}
      />

      {attendanceRun ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4">
          <div className="w-full max-w-md rounded-xl border border-tan bg-cream p-5 shadow-xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">Verified attendance</p>
            <h2 className="mt-2 font-display text-2xl font-bold text-ink">{attendanceRun.event_name}</h2>
            <label className="mt-5 block text-sm font-semibold text-ink-soft" htmlFor="attendance-count">
              Attendance count
            </label>
            <input
              id="attendance-count"
              value={attendanceCount}
              onChange={(event) => setAttendanceCount(event.target.value)}
              inputMode="numeric"
              className="mt-2 w-full rounded-lg border border-tan bg-cream-deep px-3 py-2 text-ink outline-none focus:border-clay"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-md border border-tan px-4 py-2 text-sm font-semibold text-ink-soft" onClick={() => setAttendanceRun(null)}>
                Cancel
              </button>
              <button className="rounded-md bg-clay px-4 py-2 text-sm font-semibold text-cream" onClick={updateAttendance}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {disputeRun ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4">
          <div className="w-full max-w-md rounded-xl border border-tan bg-cream p-5 shadow-xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">Dispute settlement</p>
            <h2 className="mt-2 font-display text-2xl font-bold text-ink">{disputeRun.event_name}</h2>
            <label className="mt-5 block text-sm font-semibold text-ink-soft" htmlFor="dispute-reason">
              Reason
            </label>
            <textarea
              id="dispute-reason"
              value={disputeReason}
              onChange={(event) => setDisputeReason(event.target.value)}
              rows={4}
              className="mt-2 w-full rounded-lg border border-tan bg-cream-deep px-3 py-2 text-ink outline-none focus:border-clay"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-md border border-tan px-4 py-2 text-sm font-semibold text-ink-soft" onClick={() => setDisputeRun(null)}>
                Cancel
              </button>
              <button
                className="rounded-md bg-clay px-4 py-2 text-sm font-semibold text-cream"
                onClick={() => review(disputeRun, 'dispute', disputeReason)}
              >
                Submit dispute
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SettlementSection({
  title,
  description,
  runs,
  empty,
  busy,
  onApprove,
  onDispute,
  onEditAttendance,
}: {
  title: string
  description: string
  runs: SettlementRunViewModel[]
  empty: string
  busy: BusyState
  onApprove?: (run: SettlementRunViewModel) => void
  onDispute?: (run: SettlementRunViewModel) => void
  onEditAttendance?: (run: SettlementRunViewModel) => void
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-2xl font-bold text-ink">{title}</h2>
        <p className="mt-1 text-sm text-ink-soft">{description}</p>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-tan bg-cream-deep px-5 py-6 text-sm text-ink-soft">
          {empty}
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <SettlementRunCard
              key={run.id}
              run={run}
              busy={busy?.id === run.id ? busy.action : null}
              onApprove={onApprove}
              onDispute={onDispute}
              onEditAttendance={onEditAttendance}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function SettlementRunCard({
  run,
  busy,
  onApprove,
  onDispute,
  onEditAttendance,
}: {
  run: SettlementRunViewModel
  busy: NonNullable<BusyState>['action'] | null
  onApprove?: (run: SettlementRunViewModel) => void
  onDispute?: (run: SettlementRunViewModel) => void
  onEditAttendance?: (run: SettlementRunViewModel) => void
}) {
  const canReview = run.status === 'awaiting_organizer_review'
  const canEditAttendance = ['awaiting_attendance', 'awaiting_organizer_review'].includes(run.status)

  return (
    <article className="rounded-xl border border-tan bg-cream px-5 py-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-xl font-bold text-ink">{run.event_name}</h3>
            <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide', statusClass(run.status))}>
              {formatStatus(run.status)}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            {run.venue_name} {run.event_date ? `· ${formatDate(run.event_date)}` : ''}
          </p>
          <p className="mt-3 text-sm text-ink">
            {run.attendance_count ?? '—'} × {formatMoney(run.per_attendee_cents)} / head = {formatMoney(run.total_cents)} CHI
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            {rateCopy(run)} · Attendance source: {formatLabel(run.attendance_source ?? 'pending')}
          </p>
          <a
            href={`/planner/experiences?record=event:${run.event_id}`}
            className="mt-3 inline-flex text-sm font-semibold text-clay underline-offset-4 hover:underline"
          >
            View event details
          </a>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {canEditAttendance && onEditAttendance ? (
            <button
              className="inline-flex items-center gap-2 rounded-md border border-tan px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-cream-deep"
              onClick={() => onEditAttendance(run)}
              disabled={Boolean(busy)}
            >
              <Pencil className="h-4 w-4" />
              Edit attendance
            </button>
          ) : null}
          {canReview && onDispute ? (
            <button
              className="inline-flex items-center gap-2 rounded-md border border-tan px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-cream-deep"
              onClick={() => onDispute(run)}
              disabled={Boolean(busy)}
            >
              <FileWarning className="h-4 w-4" />
              Dispute
            </button>
          ) : null}
          {canReview && onApprove ? (
            <button
              className="inline-flex items-center gap-2 rounded-md bg-clay px-3 py-2 text-sm font-semibold text-cream disabled:opacity-60"
              onClick={() => onApprove(run)}
              disabled={Boolean(busy)}
            >
              {busy === 'approve' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Approve
            </button>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function formatMoney(cents: number | null) {
  if (cents == null) return '$0.00'
  return `$${centsToDollars(cents).toFixed(2)}`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function formatLabel(value: string) {
  return value.replace(/_/g, ' ')
}

function formatStatus(status: string) {
  return formatLabel(status)
}

function rateCopy(run: SettlementRunViewModel) {
  if (run.rate_source === 'measured') {
    return `Rate based on your group's last ${run.rate_derived_from_event_count ?? 0} events`
  }
  if (run.rate_source === 'network_default') {
    return `Rate based on Bay Area network average for ${formatLabel(run.archetype)} at ${formatLabel(run.venue_type)}`
  }
  return 'Rate needs operator review'
}

function statusClass(status: string) {
  if (status === 'awaiting_organizer_review') return 'bg-clay-tint text-clay'
  if (status === 'settled') return 'bg-forest/10 text-forest'
  if (status === 'disputed') return 'bg-amber-100 text-amber-900'
  if (status === 'cancelled') return 'bg-cream-deep text-ink-faint'
  return 'bg-cream-deep text-ink-soft'
}
