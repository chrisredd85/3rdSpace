import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type DiscoveryVenueCapacityRow = {
  id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  website: string | null
  inferred_capacity_standing: number | null
  inferred_capacity_seated: number | null
  capacity_inference_confidence: number | null
  capacity_inference_source_quote: string | null
  capacity_inference_admin_status: string | null
  updated_at: string | null
}

export default async function VenueCapacityReviewPage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  const admin = createServiceRoleClient() as any
  const { data, error } = await admin
    .from('discovery_venues')
    .select('id,name,address,city,state,website,inferred_capacity_standing,inferred_capacity_seated,capacity_inference_confidence,capacity_inference_source_quote,capacity_inference_admin_status,updated_at')
    .or('capacity_inference_admin_status.is.null,capacity_inference_admin_status.eq.pending')
    .order('capacity_inference_confidence', { ascending: true, nullsFirst: true })
    .order('updated_at', { ascending: false })
    .limit(75)

  const rows = (data ?? []) as DiscoveryVenueCapacityRow[]

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="border-b border-border pb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal admin</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Venue capacity review</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Approve, reject, or override inferred discovery venue capacity before low-confidence values become trusted planning inputs.
          </p>
        </header>

        {error ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            {error.message ?? 'Unable to load discovery venues.'}
          </div>
        ) : null}

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No venue capacity inferences need review.</p>
          ) : (
            <div className="space-y-4">
              {rows.map((row) => (
                <article key={row.id} className="rounded-xl border border-border bg-background p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        {[row.city, row.state].filter(Boolean).join(', ') || 'Discovery venue'}
                      </p>
                      <h2 className="mt-1 truncate font-display text-2xl font-bold" title={row.name}>{row.name}</h2>
                      {row.address ? <p className="mt-1 text-sm text-muted-foreground">{row.address}</p> : null}
                      {row.website ? (
                        <a className="mt-1 block truncate text-sm font-semibold text-primary hover:underline" href={row.website} target="_blank" rel="noreferrer">
                          {row.website}
                        </a>
                      ) : null}
                      {row.capacity_inference_source_quote ? (
                        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{row.capacity_inference_source_quote}</p>
                      ) : null}
                    </div>
                    <div className="grid shrink-0 gap-2 text-sm sm:grid-cols-3 lg:min-w-[360px]">
                      <Metric label="Standing" value={formatPeople(row.inferred_capacity_standing)} />
                      <Metric label="Seated" value={formatPeople(row.inferred_capacity_seated)} />
                      <Metric label="Confidence" value={row.capacity_inference_confidence !== null ? `${Math.round(row.capacity_inference_confidence * 100)}%` : 'Review'} />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
                    <form action={editCapacity} className="grid gap-2 sm:grid-cols-3">
                      <input type="hidden" name="id" value={row.id} />
                      <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Standing
                        <input name="standing" type="number" min="0" step="1" defaultValue={row.inferred_capacity_standing ?? ''} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground" />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Seated
                        <input name="seated" type="number" min="0" step="1" defaultValue={row.inferred_capacity_seated ?? ''} className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground" />
                      </label>
                      <button className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" type="submit">
                        Save override
                      </button>
                    </form>
                    <form action={approveCapacity}>
                      <input type="hidden" name="id" value={row.id} />
                      <button className="h-full rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:border-primary/50" type="submit">
                        Approve
                      </button>
                    </form>
                    <form action={rejectCapacity}>
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

async function approveCapacity(formData: FormData) {
  'use server'
  await assertAdminAction()
  const id = readFormId(formData)
  await (createServiceRoleClient() as any)
    .from('discovery_venues')
    .update({ capacity_inference_admin_status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', id)
  revalidatePath('/admin/discovery/capacity-review')
}

async function rejectCapacity(formData: FormData) {
  'use server'
  await assertAdminAction()
  const id = readFormId(formData)
  await (createServiceRoleClient() as any)
    .from('discovery_venues')
    .update({ capacity_inference_admin_status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', id)
  revalidatePath('/admin/discovery/capacity-review')
}

async function editCapacity(formData: FormData) {
  'use server'
  await assertAdminAction()
  const id = readFormId(formData)
  await (createServiceRoleClient() as any)
    .from('discovery_venues')
    .update({
      inferred_capacity_standing: readOptionalPeople(formData.get('standing')),
      inferred_capacity_seated: readOptionalPeople(formData.get('seated')),
      capacity_inference_confidence: 1,
      capacity_inference_source_quote: 'Admin-reviewed venue capacity override.',
      capacity_inference_admin_status: 'edited',
      capacity_inference_extracted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  revalidatePath('/admin/discovery/capacity-review')
}

async function assertAdminAction() {
  const context = await getAdminContext()
  if (!context.authorized) throw new Error('Admin access required')
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
  if (!id) throw new Error('Missing venue id')
  return id
}

function readOptionalPeople(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed)
}

function formatPeople(value: number | null) {
  return value === null ? 'TBD' : `${value.toLocaleString()} people`
}
