import { redirect } from 'next/navigation'
import { getAdminContext } from '@/lib/server/admin-auth'

export const dynamic = 'force-dynamic'

/**
 * Temporary operator surface for P0 capture reconciliation.
 *
 * Reconciler audit-table UI is intentionally deferred to a Phase 1 follow-up.
 * Until that lands, operators should monitor Sentry events tagged
 * `action=capture_reconciled` and run history for the cron route.
 */
export default async function AdminTaskQueuePage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <section className="mx-auto max-w-4xl rounded-lg border border-border bg-card p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Internal operations</p>
        <h1 className="mt-3 font-display text-4xl font-bold">Capture reconciler</h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Captured planner deposits are checked every 15 minutes. If Stripe capture succeeds but the local payout row is missing,
          the reconciler inserts the payout and emits a Sentry event tagged <code>capture_reconciled</code>.
        </p>
        <div className="mt-6 rounded-lg border border-border bg-background p-5 text-sm text-muted-foreground">
          Reconciler audit-table history is deferred to Phase 1. For this P0 hardening PR, monitor Sentry for
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5">action=capture_reconciled</code> and
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5">action=approval_rollback_failed</code>.
        </div>
      </section>
    </main>
  )
}

function AccessRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase text-primary">Internal admin</p>
        <h1 className="mt-2 font-display text-3xl font-bold">Access required</h1>
        <p className="mt-2 text-muted-foreground">Your account is not on the admin allowlist.</p>
      </div>
    </div>
  )
}
