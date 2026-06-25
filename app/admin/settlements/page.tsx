import Link from 'next/link'
import { redirect } from 'next/navigation'

import { SettlementDisputeResolver } from '@/components/admin/SettlementDisputeResolver'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type SettlementRunListRow = {
  id: string
  event_id: string
  organizer_id: string
  venue_id: string
  status: string
  total_cents: number | null
  attendance_count: number | null
  disputed_at: string | null
  dispute_reason: string | null
  created_at: string
  updated_at: string
}

export default async function AdminSettlementsPage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  const admin = createServiceRoleClient()
  const { data, error } = await (admin as any)
    .from('settlement_runs')
    .select('id, event_id, organizer_id, venue_id, status, total_cents, attendance_count, disputed_at, dispute_reason, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(50)

  const rows = ((data ?? []) as SettlementRunListRow[])

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-3 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal admin</p>
            <h1 className="mt-2 font-display text-4xl font-bold">CHI settlements</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Monitor settlement runs, disputed venue acknowledgements, and Stripe Checkout charge readiness.
            </p>
          </div>
          <Link href="/admin" className="text-sm font-semibold text-primary hover:underline">
            Back to admin
          </Link>
        </div>

        {error ? (
          <div className="mt-6 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            {error.message ?? 'Unable to load settlement runs.'}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4">
          {rows.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
              No settlement runs yet.
            </div>
          ) : rows.map((row) => (
            <article key={row.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {row.status}
                  </p>
                  <h2 className="mt-2 font-display text-2xl font-bold">{formatCents(row.total_cents ?? 0)}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    <Link href={`/admin/settlements/${row.id}`} className="font-semibold text-primary hover:underline">
                      Run {row.id}
                    </Link>
                    {' '}· Event {row.event_id}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Attendance {row.attendance_count ?? 'pending'} · Updated {formatDate(row.updated_at)}
                  </p>
                </div>
                <div className="rounded-full border border-border px-3 py-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Venue {row.venue_id.slice(0, 8)}
                </div>
              </div>

              {row.dispute_reason ? (
                <div className="mt-4 rounded-xl border border-primary/20 bg-primary/10 p-3 text-sm text-primary">
                  {row.dispute_reason}
                </div>
              ) : null}

              {row.status === 'disputed' ? <SettlementDisputeResolver runId={row.id} /> : null}
            </article>
          ))}
        </div>
      </div>
    </main>
  )
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
