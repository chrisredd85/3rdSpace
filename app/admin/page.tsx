import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAdminContext } from '@/lib/server/admin-auth'

export const dynamic = 'force-dynamic'

const adminLinks = [
  ['Catalog venues', '/admin/catalog/venues', 'Seed spaces, bars, rooftops, and claim-ready venue records.'],
  ['Catalog vendors', '/admin/catalog/vendors', 'Seed caterers, AV teams, photographers, DJs, and service partners.'],
  ['Claims', '/admin/claims', 'Review unclaimed catalog listings and pending approval work.'],
  ['Tasks', '/admin/tasks', 'Work general planner handoffs, catalog gaps, confirmations, receipts, and compliance tasks.'],
  ['Concierge', '/admin/concierge', 'Handle opportunity invites that need manual outreach.'],
  ['Overrides', '/admin/overrides', 'Review recommendation pin/exclude candidates for plans.'],
  ['Failures', '/admin/failures', 'Failed sends, payments, dead jobs, and webhook issues.'],
  ['Health', '/admin/health', 'Operational health counts and recent errors.'],
  ['Ops', '/admin/ops', 'Full operations command console.'],
] as const

/**
 * Admin command center index.
 */
export default async function AdminIndexPage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-6xl">
        <div className="border-b border-border pb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal admin</p>
          <h1 className="mt-2 font-display text-4xl font-bold">3rdPlace command center</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Catalog operations, opportunity outreach, failures, and manual planner controls.
          </p>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {adminLinks.map(([title, href, body]) => (
            <Link key={href} href={href} className="rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/40">
              <h2 className="font-display text-xl font-bold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
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
