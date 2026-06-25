'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

type DataDeletionRequestRow = {
  id: string
  user_id: string
  email: string
  status: string
  reason: string | null
  requested_at: string
  cooling_off_ends_at: string
  executed_at: string | null
  rejected_reason: string | null
  execution_log: unknown
}

type DataDeletionQueueProps = {
  initialRows: DataDeletionRequestRow[]
}

export function DataDeletionQueue({ initialRows }: DataDeletionQueueProps) {
  const { addToast } = useToast()
  const [rows, setRows] = useState(initialRows)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({})

  async function submitAction(row: DataDeletionRequestRow, action: 'review' | 'reject' | 'execute') {
    setBusyId(row.id)
    try {
      const response = await fetch(`/api/admin/data-deletion/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action,
          ...(action === 'reject' ? { reason: rejectReason[row.id] || 'Rejected after admin review.' } : {}),
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Action failed')

      setRows((current) =>
        current.map((item) =>
          item.id === row.id
            ? {
                ...item,
                status: payload.request?.status ?? item.status,
                executed_at: payload.request?.executed_at ?? item.executed_at,
                rejected_reason: payload.request?.rejected_reason ?? item.rejected_reason,
                execution_log: payload.request?.execution_log ?? item.execution_log,
              }
            : item
        )
      )
      addToast({ title: 'Request updated', description: `Marked ${action}.` })
    } catch (error) {
      addToast({
        title: 'Update failed',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          No data deletion requests yet.
        </div>
      ) : null}

      {rows.map((row) => {
        const coolingComplete = new Date(row.cooling_off_ends_at) <= new Date()
        return (
          <article key={row.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                  {row.status}
                </p>
                <h2 className="mt-2 font-display text-2xl font-bold">{row.email}</h2>
                <p className="mt-1 text-sm text-muted-foreground">User {row.user_id}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Requested {formatDate(row.requested_at)} · Cooling-off ends {formatDate(row.cooling_off_ends_at)}
                </p>
                {row.reason ? (
                  <p className="mt-3 rounded-xl border border-border bg-background p-3 text-sm text-foreground">
                    {row.reason}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusPill complete={coolingComplete} />
              </div>
            </div>

            {row.execution_log ? (
              <pre className="mt-4 max-h-64 overflow-auto rounded-xl border border-border bg-background p-3 text-xs text-muted-foreground">
                {JSON.stringify(row.execution_log, null, 2)}
              </pre>
            ) : null}

            <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
              <input
                value={rejectReason[row.id] ?? ''}
                onChange={(event) => setRejectReason((current) => ({ ...current, [row.id]: event.target.value }))}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                placeholder="Rejection reason if needed"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busyId === row.id || row.status === 'executed'}
                  onClick={() => submitAction(row, 'review')}
                >
                  {busyId === row.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Mark in review
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busyId === row.id || row.status === 'executed'}
                  onClick={() => submitAction(row, 'reject')}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject
                </Button>
                <Button
                  type="button"
                  disabled={busyId === row.id || !coolingComplete || row.status === 'executed'}
                  onClick={() => submitAction(row, 'execute')}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Execute
                </Button>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function StatusPill({ complete }: { complete: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
      complete ? 'border-forest/30 bg-forest-tint text-forest' : 'border-clay/30 bg-clay-tint text-clay'
    }`}>
      <AlertTriangle className="h-3.5 w-3.5" />
      {complete ? 'Cooling-off complete' : 'Cooling-off active'}
    </span>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}
