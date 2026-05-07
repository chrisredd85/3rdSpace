import { redirect } from 'next/navigation'
import { getAdminContext } from '@/lib/server/admin-auth'
import { getAdminHealthData } from '@/lib/server/admin-health'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Admin failures page focused on dead jobs, webhook failures, and failed payments.
 */
export default async function AdminFailuresPage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  const admin = createServiceRoleClient()
  const [health, failedPayments] = await Promise.all([
    getAdminHealthData(admin as any),
    (admin as any)
      .from('payment_intents')
      .select('id, plan_id, approval_id, partner_kind, partner_id, amount_cents, status, stripe_payment_intent_id, updated_at')
      .eq('status', 'failed')
      .order('updated_at', { ascending: false })
      .limit(50),
  ])

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="border-b border-border pb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal admin</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Failures</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Dead jobs, failed delivery attempts, logged errors, and failed planner deposits.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <FailureList title="Failed jobs" rows={health.failedJobs} empty="No failed jobs." />
          <FailureList title="Failed webhooks" rows={health.failedWebhookLogs} empty="No failed webhook logs." />
          <FailureList title="Recent app errors" rows={health.recentErrors} empty="No recent app errors." />
          <FailureList title="Failed payments" rows={(failedPayments.data ?? []) as Array<Record<string, unknown>>} empty="No failed planner deposits." />
        </div>
      </div>
    </main>
  )
}

function FailureList({
  title,
  rows,
  empty,
}: {
  title: string
  rows: Array<Record<string, unknown>>
  empty: string
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">{title}</h2>
        <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-3">
          {rows.slice(0, 12).map((row, index) => (
            <div key={String(row.id ?? index)} className="rounded-xl border border-border bg-background p-3">
              <p className="truncate text-sm font-semibold" title={String(row.job_type ?? row.event_type ?? row.message ?? row.id)}>
                {String(row.job_type ?? row.event_type ?? row.message ?? row.id ?? 'Failure')}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground" title={String(row.error ?? row.outcome ?? row.status ?? '')}>
                {String(row.error ?? row.outcome ?? row.status ?? 'No detail')}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function AccessRequired() {
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
