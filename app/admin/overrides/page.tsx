import { redirect } from 'next/navigation'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Admin recommendation override review page.
 */
export default async function AdminOverridesPage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  const admin = createServiceRoleClient()
  const { data } = await admin
    .from('recommendations')
    .select('id, plan_id, type, external_name, reference_id, price_cents, rank, is_best_fit, status, created_at')
    .order('created_at', { ascending: false })
    .limit(75)

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="border-b border-border pb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal admin</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Recommendation overrides</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Review planner recommendations before adding pin/exclude controls and audit-backed override mutations.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <RecommendationTable rows={(data ?? []) as Array<Record<string, unknown>>} />
        </div>
      </div>
    </main>
  )
}

function RecommendationTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No recommendations found.</p>

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
            <th className="pb-2 pr-4">Type</th>
            <th className="pb-2 pr-4">Name/ref</th>
            <th className="pb-2 pr-4">Rank</th>
            <th className="pb-2 pr-4">Best</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2 pr-4">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={String(row.id)}>
              <td className="py-3 pr-4">{String(row.type ?? '—')}</td>
              <td className="max-w-[320px] truncate py-3 pr-4" title={String(row.external_name ?? row.reference_id ?? '')}>
                {String(row.external_name ?? row.reference_id ?? '—')}
              </td>
              <td className="py-3 pr-4">{String(row.rank ?? '—')}</td>
              <td className="py-3 pr-4">{row.is_best_fit ? 'Yes' : 'No'}</td>
              <td className="py-3 pr-4">{String(row.status ?? '—')}</td>
              <td className="py-3 pr-4">{formatDate(row.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatDate(value: unknown) {
  if (typeof value !== 'string' || !value) return '—'
  return new Date(value).toLocaleDateString()
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
