import { redirect } from 'next/navigation'
import { SupplyScoutConsole } from '@/components/admin/SupplyScoutConsole'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const LEAD_SELECT = `
  id,
  name,
  address,
  neighborhood,
  city,
  state,
  source_platform,
  source_url,
  event_title,
  event_type,
  evidence_summary,
  booking_signals,
  disqualifiers,
  website,
  capacity_hint,
  price_hint_cents_low,
  price_hint_cents_high,
  booking_likelihood,
  confidence,
  review_status,
  discovery_venue_id,
  updated_at,
  created_at
`

/**
 * Internal Supply Scout console for sourcing the first production venue set.
 */
export default async function SupplyScoutPage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  const admin = createServiceRoleClient()
  const { data, error } = await admin
    .from('supply_scout_venue_leads')
    .select(LEAD_SELECT)
    .order('updated_at', { ascending: false })
    .limit(300)

  if (error) {
    console.error('[admin.supply-scout.page] Failed to load leads', error)
    return (
      <main className="min-h-screen bg-background px-6 py-8 text-foreground">
        <div className="mx-auto max-w-3xl rounded-md border border-border bg-cream p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal supply</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Supply Scout unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{error.message}</p>
        </div>
      </main>
    )
  }

  return <SupplyScoutConsole initialLeads={(data ?? []) as any[]} />
}

function AccessRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
      <div className="rounded-md border border-border bg-cream p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase text-primary">Internal admin</p>
        <h1 className="mt-2 font-display text-3xl font-bold">Access required</h1>
        <p className="mt-2 text-muted-foreground">Your account is not on the admin allowlist.</p>
      </div>
    </div>
  )
}
