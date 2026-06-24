import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type DiscoveryVendorRateRow = {
  id: string
  name: string
  service_type: string | null
  website: string | null
  inferred_hourly_rate_cents: number | null
  inferred_package_rate_cents: number | null
  inferred_minimum_cents: number | null
  rate_inference_confidence: number | null
  rate_inference_source_quote: string | null
  rate_inference_admin_status: string | null
  updated_at: string | null
}

export default async function VendorRateReviewPage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  const admin = createServiceRoleClient() as any
  const { data, error } = await admin
    .from('discovery_vendors')
    .select('id,name,service_type,website,inferred_hourly_rate_cents,inferred_package_rate_cents,inferred_minimum_cents,rate_inference_confidence,rate_inference_source_quote,rate_inference_admin_status,updated_at')
    .or('rate_inference_admin_status.is.null,rate_inference_admin_status.eq.pending')
    .order('rate_inference_confidence', { ascending: true, nullsFirst: true })
    .order('updated_at', { ascending: false })
    .limit(75)

  const rows = (data ?? []) as DiscoveryVendorRateRow[]

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="border-b border-border pb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal admin</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Vendor rate review</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Approve, reject, or override low-confidence rates inferred from discovery vendor websites before they appear as trusted estimates.
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
                      <h2 className="mt-1 truncate font-display text-2xl font-bold" title={row.name}>{row.name}</h2>
                      {row.website ? (
                        <a className="mt-1 block truncate text-sm font-semibold text-primary hover:underline" href={row.website} target="_blank" rel="noreferrer">
                          {row.website}
                        </a>
                      ) : null}
                      {row.rate_inference_source_quote ? (
                        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{row.rate_inference_source_quote}</p>
                      ) : null}
                    </div>
                    <div className="grid shrink-0 gap-2 text-sm sm:grid-cols-4 lg:min-w-[440px]">
                      <Metric label="Hourly" value={formatCents(row.inferred_hourly_rate_cents)} />
                      <Metric label="Package" value={formatCents(row.inferred_package_rate_cents)} />
                      <Metric label="Minimum" value={formatCents(row.inferred_minimum_cents)} />
                      <Metric label="Confidence" value={row.rate_inference_confidence !== null ? `${Math.round(row.rate_inference_confidence * 100)}%` : 'Review'} />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
                    <form action={editRate} className="grid gap-2 sm:grid-cols-4">
                      <input type="hidden" name="id" value={row.id} />
                      <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Hourly cents
                        <input name="hourly_cents" type="number" min="0" step="100" defaultValue={row.inferred_hourly_rate_cents ?? ''} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground" />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Package cents
                        <input name="package_cents" type="number" min="0" step="100" defaultValue={row.inferred_package_rate_cents ?? ''} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground" />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Minimum cents
                        <input name="minimum_cents" type="number" min="0" step="100" defaultValue={row.inferred_minimum_cents ?? ''} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground" />
                      </label>
                      <button className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" type="submit">
                        Save override
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

async function approveRate(formData: FormData) {
  'use server'
  const id = readFormId(formData)
  await (createServiceRoleClient() as any)
    .from('discovery_vendors')
    .update({ rate_inference_admin_status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', id)
  revalidatePath('/admin/discovery/vendor-rate-review')
}

async function rejectRate(formData: FormData) {
  'use server'
  const id = readFormId(formData)
  await (createServiceRoleClient() as any)
    .from('discovery_vendors')
    .update({ rate_inference_admin_status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', id)
  revalidatePath('/admin/discovery/vendor-rate-review')
}

async function editRate(formData: FormData) {
  'use server'
  const id = readFormId(formData)
  await (createServiceRoleClient() as any)
    .from('discovery_vendors')
    .update({
      inferred_hourly_rate_cents: readOptionalCents(formData.get('hourly_cents')),
      inferred_package_rate_cents: readOptionalCents(formData.get('package_cents')),
      inferred_minimum_cents: readOptionalCents(formData.get('minimum_cents')),
      rate_inference_confidence: 1,
      rate_inference_source_quote: 'Admin-reviewed vendor rate override.',
      rate_inference_admin_status: 'edited',
      rate_inference_extracted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  revalidatePath('/admin/discovery/vendor-rate-review')
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

function readFormId(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  if (!id) throw new Error('Missing vendor id')
  return id
}

function readOptionalCents(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed)
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
