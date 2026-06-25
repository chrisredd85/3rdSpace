import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { reviewChiTrueupManualReview } from '@/lib/finance/chi-rate-trueup'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type ChiTrueupReviewRow = {
  id: string
  organizer_id: string
  venue_id: string
  archetype: string
  venue_type: string
  current_rate_cents: number
  proposed_rate_cents: number
  movement_pct: number
  movement_bucket: string
  derived_from_event_count: number
  triggering_settlement_run_id: string | null
  reason: string
  created_at: string
}

type VenueRow = {
  id: string
  venue_name: string | null
  city: string | null
  state: string | null
}

export default async function AdminChiTrueupReviewPage() {
  const context = await getAdminContext()
  if (!context.authorized) {
    if (context.status === 401) redirect('/login')
    return <AccessRequired />
  }

  const admin = createServiceRoleClient() as any
  const { data, error } = await admin
    .from('chi_trueup_manual_review')
    .select('id, organizer_id, venue_id, archetype, venue_type, current_rate_cents, proposed_rate_cents, movement_pct, movement_bucket, derived_from_event_count, triggering_settlement_run_id, reason, created_at')
    .is('reviewed_at', null)
    .order('created_at', { ascending: true })
    .limit(75)

  const rows = (data ?? []) as ChiTrueupReviewRow[]
  const venueIds = [...new Set(rows.map((row) => row.venue_id))]
  const venues = await loadVenues(admin, venueIds)

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-3 border-b border-border pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Internal admin</p>
            <h1 className="mt-2 font-display text-4xl font-bold">CHI true-up review</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Review CHI rate changes that exceeded the automatic movement cap. Approving or adjusting a rate only changes future event recommendations.
            </p>
          </div>
          <Link href="/admin" className="text-sm font-semibold text-primary hover:underline">
            Back to admin
          </Link>
        </header>

        {error ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            {error.message ?? 'Unable to load CHI true-up review queue.'}
          </div>
        ) : null}

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No CHI true-up proposals need review.</p>
          ) : (
            <div className="space-y-4">
              {rows.map((row) => {
                const venue = venues.get(row.venue_id)
                const venueName = venue?.venue_name ?? `Venue ${row.venue_id.slice(0, 8)}`
                return (
                  <article key={row.id} className="rounded-xl border border-border bg-background p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          {formatArchetype(row.archetype)} · {formatArchetype(row.venue_type)}
                        </p>
                        <h2 className="mt-1 font-display text-2xl font-bold">{venueName}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatVenueLocation(venue)} · {row.derived_from_event_count} settled event{row.derived_from_event_count === 1 ? '' : 's'} in sample
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Queued {formatDate(row.created_at)}
                          {row.triggering_settlement_run_id ? ` · Run ${row.triggering_settlement_run_id}` : ''}
                        </p>
                      </div>
                      <div className="grid shrink-0 gap-2 text-sm sm:grid-cols-4 lg:min-w-[520px]">
                        <Metric label="Current" value={formatCents(row.current_rate_cents)} />
                        <Metric label="Proposed" value={formatCents(row.proposed_rate_cents)} />
                        <Metric label="Movement" value={`${Math.round(row.movement_pct * 1000) / 10}%`} />
                        <Metric label="Bucket" value={row.movement_bucket} />
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
                      <form action={adjustReview} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <input type="hidden" name="id" value={row.id} />
                        <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Adjusted cents
                          <input
                            name="adjusted_rate_cents"
                            type="number"
                            min="0"
                            step="1"
                            defaultValue={row.proposed_rate_cents}
                            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Notes
                          <input
                            name="review_notes"
                            type="text"
                            maxLength={500}
                            placeholder="Why this adjusted rate is correct"
                            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
                          />
                        </label>
                        <button className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" type="submit">
                          Apply adjusted rate
                        </button>
                      </form>
                      <form action={approveReview}>
                        <input type="hidden" name="id" value={row.id} />
                        <button className="h-full rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:border-primary/50" type="submit">
                          Approve proposed
                        </button>
                      </form>
                      <form action={rejectReview}>
                        <input type="hidden" name="id" value={row.id} />
                        <button className="h-full rounded-md border border-destructive/30 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10" type="submit">
                          Reject
                        </button>
                      </form>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

async function approveReview(formData: FormData) {
  'use server'
  const context = await requireAdminAction()
  await reviewChiTrueupManualReview(createServiceRoleClient() as any, {
    reviewId: readFormId(formData),
    reviewerUserId: context.user.id,
    decision: 'approve',
    reviewNotes: readNotes(formData),
  })
  revalidatePath('/admin/chi-trueup-review')
}

async function rejectReview(formData: FormData) {
  'use server'
  const context = await requireAdminAction()
  await reviewChiTrueupManualReview(createServiceRoleClient() as any, {
    reviewId: readFormId(formData),
    reviewerUserId: context.user.id,
    decision: 'reject',
    reviewNotes: readNotes(formData),
  })
  revalidatePath('/admin/chi-trueup-review')
}

async function adjustReview(formData: FormData) {
  'use server'
  const context = await requireAdminAction()
  await reviewChiTrueupManualReview(createServiceRoleClient() as any, {
    reviewId: readFormId(formData),
    reviewerUserId: context.user.id,
    decision: 'adjust',
    adjustedRateCents: readRequiredCents(formData.get('adjusted_rate_cents')),
    reviewNotes: readNotes(formData),
  })
  revalidatePath('/admin/chi-trueup-review')
}

async function requireAdminAction() {
  const context = await getAdminContext()
  if (!context.authorized) {
    throw new Error(context.error)
  }
  return context
}

async function loadVenues(admin: any, venueIds: string[]): Promise<Map<string, VenueRow>> {
  if (venueIds.length === 0) return new Map<string, VenueRow>()
  const { data } = await admin
    .from('venues')
    .select('id, venue_name, city, state')
    .in('id', venueIds)

  return new Map<string, VenueRow>(((data ?? []) as VenueRow[]).map((venue) => [venue.id, venue]))
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
  const id = String(formData.get('id') ?? '').trim()
  if (!id) throw new Error('Missing review id')
  return id
}

function readNotes(formData: FormData) {
  const notes = String(formData.get('review_notes') ?? '').trim()
  return notes || null
}

function readRequiredCents(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? '').trim())
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Adjusted rate must be a non-negative integer cents value')
  }
  return parsed
}

function formatCents(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function formatArchetype(value: string) {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function formatVenueLocation(venue: VenueRow | undefined) {
  if (!venue) return 'Venue location unavailable'
  return [venue.city, venue.state].filter(Boolean).join(', ') || 'Venue location unavailable'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}
