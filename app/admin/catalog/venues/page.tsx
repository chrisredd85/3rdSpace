import { redirect } from 'next/navigation'
import { AdminCatalogConsole } from '@/components/admin/AdminCatalogConsole'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Admin venue catalog seeding and review page.
 */
export default async function AdminVenueCatalogPage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  const admin = createServiceRoleClient()
  const { data } = await admin
    .from('venues')
    .select('id, venue_name, name, venue_type, contact_email, is_claimed, claimed_user_id, is_admin_seeded, is_published, created_at')
    .eq('is_admin_seeded', true)
    .order('created_at', { ascending: false })

  return <AdminCatalogConsole kind="venues" initialRows={(data ?? []) as Array<Record<string, any>>} />
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
