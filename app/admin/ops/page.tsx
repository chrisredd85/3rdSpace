import { redirect } from 'next/navigation'
import { AdminOpsConsole } from '@/components/admin/AdminOpsConsole'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAdminContext } from '@/lib/server/admin-auth'
import { getAdminOpsData } from '@/lib/server/admin-ops'

export const dynamic = 'force-dynamic'

export default async function AdminOpsPage() {
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

  const data = await getAdminOpsData(createServiceRoleClient() as any)

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
        <div className="rounded-2xl border border-border bg-card/40 p-8 shadow-card">
          <p className="text-sm font-semibold uppercase text-primary">Internal admin</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Console unavailable</h1>
          <p className="mt-2 text-muted-foreground">Could not load operations data.</p>
        </div>
      </div>
    )
  }

  return <AdminOpsConsole initialData={data} />
}
