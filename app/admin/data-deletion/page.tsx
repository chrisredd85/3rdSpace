import Link from 'next/link'
import { redirect } from 'next/navigation'

import { DataDeletionQueue } from '@/components/admin/DataDeletionQueue'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function AdminDataDeletionPage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  const admin = createServiceRoleClient() as any
  const { data, error } = await admin
    .from('data_deletion_requests')
    .select('id,user_id,email,status,reason,requested_at,cooling_off_ends_at,executed_at,rejected_reason,execution_log')
    .order('requested_at', { ascending: false })
    .limit(100)

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-3 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal admin</p>
            <h1 className="mt-2 font-display text-4xl font-bold">Data deletion requests</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Review user privacy deletion requests, enforce the 7-day cooling-off period, and execute audited deletion.
            </p>
          </div>
          <Link href="/admin" className="text-sm font-semibold text-primary hover:underline">
            Back to admin
          </Link>
        </div>

        {error ? (
          <div className="mt-6 rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            {error.message ?? 'Unable to load deletion requests.'}
          </div>
        ) : null}

        <section className="mt-6">
          <DataDeletionQueue initialRows={(data ?? []) as any} />
        </section>
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
