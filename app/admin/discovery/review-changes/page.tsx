import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { cascadeInvalidationForEntityChange, type DiscoveryEntityType } from '@/lib/discovery/cascadeInvalidation'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/types'

export const dynamic = 'force-dynamic'

type DiscoveryChangeRow = {
  id: string
  entity_type: DiscoveryEntityType
  entity_id: string
  source: string
  field_name: string
  old_value: Json | null
  new_value: Json | null
  confidence: number | null
  source_evidence: string | null
  created_at: string
}

export default async function DiscoveryChangeReviewPage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  const admin = createServiceRoleClient() as any
  const { data, error } = await admin
    .from('discovery_change_log')
    .select('id,entity_type,entity_id,source,field_name,old_value,new_value,confidence,source_evidence,created_at')
    .eq('applied', false)
    .order('created_at', { ascending: false })
    .limit(75)

  const rows = (data ?? []) as DiscoveryChangeRow[]

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="border-b border-border pb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal admin</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Discovery change review</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Review Places or website-discovered changes before they become trusted planning inputs. Applying a change refreshes affected plans and marks stale outreach.
          </p>
        </header>

        {error ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            {error.message ?? 'Unable to load discovery change log.'}
          </div>
        ) : null}

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No discovery changes need review.</p>
          ) : (
            <div className="space-y-4">
              {rows.map((row) => (
                <article key={row.id} className="rounded-xl border border-border bg-background p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        {row.entity_type.replace('_', ' ')} · {row.source} · {formatDate(row.created_at)}
                      </p>
                      <h2 className="font-display text-2xl font-bold">{row.field_name}</h2>
                      <p className="break-all text-xs text-muted-foreground">Entity: {row.entity_id}</p>
                      {row.source_evidence ? (
                        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{row.source_evidence}</p>
                      ) : null}
                    </div>
                    <div className="grid shrink-0 gap-2 text-sm md:min-w-[420px] md:grid-cols-3">
                      <Metric label="Old" value={formatJson(row.old_value)} />
                      <Metric label="New" value={formatJson(row.new_value)} />
                      <Metric label="Confidence" value={row.confidence === null ? 'Review' : `${Math.round(row.confidence * 100)}%`} />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <form action={applyDiscoveryChange}>
                      <input type="hidden" name="id" value={row.id} />
                      <button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" type="submit">
                        Apply change
                      </button>
                    </form>
                    <form action={rejectDiscoveryChange}>
                      <input type="hidden" name="id" value={row.id} />
                      <button className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:border-primary/50" type="submit">
                        Keep current value
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

async function applyDiscoveryChange(formData: FormData) {
  'use server'
  const context = await getAdminContext()
  if (!context.authorized) throw new Error('Admin access required')
  const id = readFormId(formData)
  const admin = createServiceRoleClient() as any
  const { data, error } = await admin
    .from('discovery_change_log')
    .select('id,entity_type,entity_id,field_name,new_value')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) throw new Error(error?.message ?? 'Discovery change not found')
  const entityType = data.entity_type as DiscoveryEntityType
  const table = entityType === 'discovery_venue' ? 'discovery_venues' : 'discovery_vendors'
  const fieldName = String(data.field_name)
  const appliedAt = new Date().toISOString()

  await admin
    .from(table)
    .update({
      [fieldName]: data.new_value,
      last_meaningful_change_at: appliedAt,
      data_freshness_status: fieldName === 'business_status' && data.new_value !== 'OPERATIONAL' ? 'closed' : 'changed',
      updated_at: appliedAt,
    })
    .eq('id', data.entity_id)

  const impact = await cascadeInvalidationForEntityChange({
    supabase: admin,
    entityType,
    entityId: String(data.entity_id),
    changedField: fieldName,
    newValue: data.new_value,
    actorId: context.user?.id ?? null,
  })

  await admin
    .from('discovery_change_log')
    .update({
      applied: true,
      applied_at: appliedAt,
      reviewed_by: context.user?.id ?? null,
      review_notes: 'Applied by admin review queue.',
      cascade_impact: impact as unknown as Json,
    })
    .eq('id', id)

  revalidatePath('/admin/discovery/review-changes')
}

async function rejectDiscoveryChange(formData: FormData) {
  'use server'
  const context = await getAdminContext()
  if (!context.authorized) throw new Error('Admin access required')
  const id = readFormId(formData)
  await (createServiceRoleClient() as any)
    .from('discovery_change_log')
    .update({
      reviewed_by: context.user?.id ?? null,
      review_notes: 'Kept current value from admin review queue.',
    })
    .eq('id', id)
  revalidatePath('/admin/discovery/review-changes')
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-semibold">{value}</p>
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
  if (!id) throw new Error('Missing discovery change id')
  return id
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function formatJson(value: Json | null): string {
  if (value === null) return 'None'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
