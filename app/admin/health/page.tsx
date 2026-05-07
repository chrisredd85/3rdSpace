import { redirect } from 'next/navigation'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAdminContext } from '@/lib/server/admin-auth'
import { getAdminHealthData } from '@/lib/server/admin-health'

export const dynamic = 'force-dynamic'

/**
 * Admin health dashboard for failed jobs, failed delivery attempts, and logged errors.
 */
export default async function AdminHealthPage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-card">
          <p className="text-sm font-semibold uppercase text-primary">Internal admin</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Access required</h1>
          <p className="mt-2 text-muted-foreground">Your account is not on the admin allowlist.</p>
        </div>
      </div>
    )
  }

  const health = await getAdminHealthData(createServiceRoleClient() as any)
  const summaryItems = [
    ['Failed jobs', health.summary.failedJobs],
    ['Stuck jobs', health.summary.stuckJobs],
    ['Failed webhooks', health.summary.failedWebhookLogs],
    ['Recent errors', health.summary.recentErrors],
    ['Action transitions', health.summary.recentActionTransitions],
  ] as const

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-6xl">
        <div className="border-b border-border pb-6">
          <p className="text-sm font-semibold uppercase text-primary">Admin health</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Operational health</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Failed sends, stuck jobs, webhook issues, and recent application errors.
          </p>
        </div>

        <section className="mt-6 grid gap-3 md:grid-cols-5">
          {summaryItems.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
              <p className="mt-2 font-display text-3xl font-bold">{value}</p>
            </div>
          ))}
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          <HealthList title="Failed Jobs" rows={health.failedJobs} empty="No failed jobs." />
          <HealthList title="Stuck Jobs" rows={health.stuckJobs} empty="No stuck jobs." />
          <HealthList title="Failed Webhooks" rows={health.failedWebhookLogs} empty="No failed webhook logs." />
          <HealthList title="Recent Errors" rows={health.recentErrors} empty="No recent errors." />
        </section>
      </div>
    </main>
  )
}

interface HealthListProps {
  title: string
  rows: Array<Record<string, unknown>>
  empty: string
}

/**
 * Compact row list for admin health sections.
 */
function HealthList({ title, rows, empty }: HealthListProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="font-display text-lg font-bold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.slice(0, 8).map((row, index) => (
            <div key={String(row.id ?? index)} className="rounded-lg border border-border bg-background p-3">
              <p className="truncate text-sm font-semibold" title={String(row.job_type ?? row.source ?? row.message ?? row.id)}>
                {String(row.job_type ?? row.source ?? row.message ?? row.id ?? 'Item')}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground" title={String(row.error ?? row.path ?? row.outcome ?? '')}>
                {String(row.error ?? row.path ?? row.outcome ?? 'No detail')}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
