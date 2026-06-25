import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type SettlementRunRow = {
  id: string
  event_id: string
  organizer_id: string
  venue_id: string
  status: string
  total_cents: number | null
  attendance_count: number | null
  dispute_reason: string | null
  updated_at: string
}

type AuditRow = {
  id: string
  entity_type: string
  entity_id: string
  action: string
  before_state: Record<string, unknown> | null
  after_state: Record<string, unknown> | null
  actor_id: string | null
  actor_type: string | null
  reason: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

type PageProps = {
  params: {
    runId: string
  }
}

export default async function AdminSettlementDetailPage({ params }: PageProps) {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  const admin = createServiceRoleClient()
  const { data: run, error: runError } = await (admin as any)
    .from('settlement_runs')
    .select('id, event_id, organizer_id, venue_id, status, total_cents, attendance_count, dispute_reason, updated_at')
    .eq('id', params.runId)
    .maybeSingle()

  const { data: charges } = await (admin as any)
    .from('settlement_charges')
    .select('id')
    .eq('settlement_run_id', params.runId)

  const auditEntityIds = [params.runId, ...((charges ?? []) as Array<{ id: string }>).map((charge) => charge.id)]
  const { data: auditRows, error: auditError } = await (admin as any)
    .from('settlement_audit_log')
    .select('id, entity_type, entity_id, action, before_state, after_state, actor_id, actor_type, reason, metadata, created_at')
    .in('entity_id', auditEntityIds)
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-3 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal admin</p>
            <h1 className="mt-2 font-display text-4xl font-bold">Settlement audit</h1>
            <p className="mt-2 text-sm text-muted-foreground">Run {params.runId}</p>
          </div>
          <Link href="/admin/settlements" className="text-sm font-semibold text-primary hover:underline">
            Back to settlements
          </Link>
        </div>

        {runError || !run ? (
          <div className="mt-6 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            {runError?.message ?? 'Settlement run not found.'}
          </div>
        ) : (
          <RunSummary run={run as SettlementRunRow} />
        )}

        {auditError ? (
          <div className="mt-6 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            {auditError.message ?? 'Unable to load audit timeline.'}
          </div>
        ) : null}

        <section className="mt-8">
          <h2 className="font-display text-2xl font-bold">Audit timeline</h2>
          <div className="mt-4 grid gap-3">
            {((auditRows ?? []) as AuditRow[]).length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
                No audit entries have been recorded for this settlement yet.
              </div>
            ) : ((auditRows ?? []) as AuditRow[]).map((entry) => (
              <article key={entry.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-primary">
                      {entry.actor_type ?? 'unknown actor'} · {entry.action}
                    </p>
                    <h3 className="mt-2 font-display text-xl font-bold">
                      {statusLabel(entry.before_state)} → {statusLabel(entry.after_state)}
                    </h3>
                    {entry.reason ? <p className="mt-2 text-sm text-muted-foreground">{entry.reason}</p> : null}
                  </div>
                  <time className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {formatDate(entry.created_at)}
                  </time>
                </div>
                <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
                  <StateBlock label="Before" state={entry.before_state} />
                  <StateBlock label="After" state={entry.after_state} />
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

function RunSummary({ run }: { run: SettlementRunRow }) {
  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{run.status}</p>
      <h2 className="mt-2 font-display text-3xl font-bold">{formatCents(run.total_cents ?? 0)}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Event {run.event_id} · Venue {run.venue_id} · Attendance {run.attendance_count ?? 'pending'}
      </p>
      {run.dispute_reason ? (
        <div className="mt-4 rounded-xl border border-primary/20 bg-primary/10 p-3 text-sm text-primary">
          {run.dispute_reason}
        </div>
      ) : null}
    </section>
  )
}

function StateBlock({ label, state }: { label: string; state: Record<string, unknown> | null }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <p className="font-semibold uppercase tracking-widest">{label}</p>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
        {JSON.stringify(compactState(state), null, 2)}
      </pre>
    </div>
  )
}

function compactState(state: Record<string, unknown> | null) {
  if (!state) return {}
  return {
    status: state.status ?? null,
    total_cents: state.total_cents ?? state.amount_cents ?? null,
    dispute_reason: state.dispute_reason ?? null,
    updated_at: state.updated_at ?? null,
  }
}

function statusLabel(state: Record<string, unknown> | null) {
  const status = state?.status
  return typeof status === 'string' ? status : 'unknown'
}

function formatCents(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function AccessRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
      <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase text-primary">Internal admin</p>
        <h1 className="mt-2 font-display text-3xl font-bold">Access required</h1>
        <p className="mt-2 text-muted-foreground">Your account is not on the admin allowlist.</p>
      </div>
    </div>
  )
}
