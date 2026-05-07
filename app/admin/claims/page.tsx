import { redirect } from 'next/navigation'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Admin claim review page for unclaimed venue and vendor listings.
 */
export default async function AdminClaimsPage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  const admin = createServiceRoleClient()
  const [{ data: venues }, { data: vendors }] = await Promise.all([
    admin
      .from('venues')
      .select('id, venue_name, contact_email, is_claimed, claimed_user_id, created_at')
      .eq('is_admin_seeded', true)
      .eq('is_claimed', false)
      .order('created_at', { ascending: false })
      .limit(50),
    admin
      .from('vendor_profiles')
      .select('id, name, contact_email, service_type, is_claimed, claimed_user_id, created_at')
      .eq('is_admin_seeded', true)
      .eq('is_claimed', false)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  const rows = [
    ...((venues ?? []) as Array<Record<string, unknown>>).map((row) => ({ ...row, kind: 'Venue', name: row.venue_name })),
    ...((vendors ?? []) as Array<Record<string, unknown>>).map((row) => ({ ...row, kind: 'Vendor' })),
  ]

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-6xl space-y-6">
        <Header title="Claims" body="Unclaimed admin-seeded listings that need owner approval, claim links, or manual follow-up." />
        <SimpleTable
          rows={rows}
          columns={[
            ['kind', 'Type'],
            ['name', 'Listing'],
            ['contact_email', 'Contact'],
            ['created_at', 'Created'],
          ]}
          empty="No unclaimed listings need review."
        />
      </div>
    </main>
  )
}

function Header({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-b border-border pb-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal admin</p>
      <h1 className="mt-2 font-display text-3xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  )
}

function SimpleTable({
  rows,
  columns,
  empty,
}: {
  rows: Array<Record<string, unknown>>
  columns: Array<[string, string]>
  empty: string
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                {columns.map(([, label]) => <th key={label} className="pb-2 pr-4">{label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={String(row.id)}>
                  {columns.map(([key]) => (
                    <td key={key} className="max-w-[320px] truncate py-3 pr-4" title={formatValue(row[key])}>
                      {formatValue(row[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function formatValue(value: unknown) {
  if (typeof value !== 'string' || !value) return '—'
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return new Date(value).toLocaleDateString()
  return value
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
