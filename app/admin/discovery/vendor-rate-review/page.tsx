import { redirect } from 'next/navigation'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { SAFE_VENDOR_TABLE, readSafeDiscoveryVendor } from '@/lib/discovery/vendorRepository'
import { approveRate, rejectRate, editRate } from './actions'

export const dynamic = 'force-dynamic'

export default async function VendorRateReviewPage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  const admin = createServiceRoleClient()
  const { data, error } = await admin
    .from(SAFE_VENDOR_TABLE)
    .select('id,name,service_type,website,inferred_hourly_rate_cents,inferred_package_rate_cents,inferred_minimum_cents,field_provenance,rate_inference_admin_status,updated_at')
    .or('rate_inference_admin_status.is.null,rate_inference_admin_status.eq.pending')
    .order('updated_at', { ascending: false })
    .limit(75)

  const rows = (data ?? []).map(readSafeDiscoveryVendor)

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="border-b border-border pb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal admin</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Vendor rate review</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Review saved estimates and their independent evidence. A different amount needs independently acquired evidence before it can be saved.
          </p>
        </header>

        {error ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            {error.message ?? 'Unable to load discovery vendors.'}
          </div>
        ) : null}

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No vendor rates need review.</p>
          ) : (
            <div className="space-y-4">
              {rows.map((row) => (
                <article key={row.id} className="rounded-xl border border-border bg-background p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        {formatServiceType(row.service_type)}
                      </p>
                      <h2 className="mt-1 truncate font-display text-2xl font-bold" title={row.name ?? undefined}>{row.name ?? 'Vendor name unavailable'}</h2>
                      {row.website ? (
                        <a className="mt-1 block truncate text-sm font-semibold text-primary hover:underline" href={row.website} target="_blank" rel="noreferrer">
                          {row.website}
                        </a>
                      ) : null}
                    </div>
                    <div className="grid shrink-0 gap-2 text-sm sm:grid-cols-3 lg:min-w-[440px]">
                      <Metric label="Hourly" value={formatCents(row.inferred_hourly_rate_cents)} />
                      <Metric label="Package" value={formatCents(row.inferred_package_rate_cents)} />
                      <Metric label="Minimum" value={formatCents(row.inferred_minimum_cents)} />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
                    <form action={editRate} className="grid gap-2 sm:grid-cols-4">
                      <input type="hidden" name="id" value={row.id} />
                      <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Hourly cents
                        <input name="hourly_cents" type="number" readOnly defaultValue={row.inferred_hourly_rate_cents ?? ''} placeholder="Unavailable" className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground" />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Package cents
                        <input name="package_cents" type="number" readOnly defaultValue={row.inferred_package_rate_cents ?? ''} placeholder="Unavailable" className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground" />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Minimum cents
                        <input name="minimum_cents" type="number" readOnly defaultValue={row.inferred_minimum_cents ?? ''} placeholder="Unavailable" className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground" />
                      </label>
                      <button disabled={[row.inferred_hourly_rate_cents, row.inferred_package_rate_cents, row.inferred_minimum_cents].every(value => value === null)} className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" type="submit">
                        Save review
                      </button>
                    </form>
                    <form action={approveRate}>
                      <input type="hidden" name="id" value={row.id} />
                      <button className="h-full rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:border-primary/50" type="submit">
                        Approve
                      </button>
                    </form>
                    <form action={rejectRate}>
                      <input type="hidden" name="id" value={row.id} />
                      <button className="h-full rounded-md border border-destructive/30 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10" type="submit">
                        Reject
                      </button>
                    </form>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
    </div>
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

function formatCents(value: number | null) {
  if (value === null) return 'TBD'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}

function formatServiceType(value: string | null) {
  if (!value) return 'Vendor'
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => (part.toLowerCase() === 'av' ? 'AV' : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join(' ')
}
