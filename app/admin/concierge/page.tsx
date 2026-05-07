import { redirect } from 'next/navigation'
import { ConciergeQueueConsole } from '@/components/admin/ConciergeQueueConsole'
import { getAdminContext } from '@/lib/server/admin-auth'
import { getAdminConciergeData } from '@/lib/server/admin-concierge'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Admin-only concierge queue for stalled or manually routed venue opportunity invites.
 */
export default async function AdminConciergePage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
        <div className="rounded-2xl border border-border bg-card/40 p-8 shadow-card">
          <p className="text-sm font-semibold uppercase text-primary">Internal admin</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Access required</h1>
          <p className="mt-2 text-muted-foreground">Your account is not on the admin allowlist.</p>
        </div>
      </div>
    )
  }

  const data = await getAdminConciergeData(createServiceRoleClient() as any)
  return <ConciergeQueueConsole initialData={data} />
}
