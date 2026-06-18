import { redirect } from 'next/navigation'
import { SettlementRunsClient, type SettlementRunViewModel } from '@/components/planner/SettlementRunsClient'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type SettlementRunRow = {
  id: string
  event_id: string
  venue_id: string
  status: string
  attendance_count: number | null
  attendance_source: string | null
  per_attendee_cents: number | null
  rate_source: string | null
  rate_derived_from_event_count: number | null
  total_cents: number | null
  archetype: string
  venue_type: string
  neighborhood: string
  created_at: string
}

export default async function PlannerSettlementsPage() {
  const supabase = createClient()
  const admin = createServiceRoleClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?redirect=/planner/settlements')
  }

  const { data: runs, error } = await (admin as any)
    .from('settlement_runs')
    .select('id, event_id, venue_id, status, attendance_count, attendance_source, per_attendee_cents, rate_source, rate_derived_from_event_count, total_cents, archetype, venue_type, neighborhood, created_at')
    .eq('organizer_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message ?? 'Failed to load settlement runs')
  }

  const typedRuns = ((runs ?? []) as SettlementRunRow[])
  const [eventsById, venuesById] = await Promise.all([
    loadEvents(admin, typedRuns.map((run) => run.event_id)),
    loadVenues(admin, typedRuns.map((run) => run.venue_id)),
  ])

  const viewModels = typedRuns.map((run): SettlementRunViewModel => {
    const event = eventsById.get(run.event_id)
    const venue = venuesById.get(run.venue_id)
    return {
      ...run,
      event_name: event?.event_name ?? 'Untitled event',
      event_date: event?.event_date ?? null,
      venue_name: venue?.venue_name ?? 'Venue',
    }
  })

  return (
    <main className="min-h-screen bg-cream text-ink">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 lg:px-8">
        <div className="mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">Community host incentive</p>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-normal text-ink">Settlements</h1>
          <p className="mt-3 max-w-3xl text-base text-ink-soft">
            Review verified attendance and CHI math before the venue acknowledgment step. Approval here prepares the record for settlement; no money moves from this page.
          </p>
        </div>

        <SettlementRunsClient initialRuns={viewModels} />
      </div>
    </main>
  )
}

async function loadEvents(admin: ReturnType<typeof createServiceRoleClient>, eventIds: string[]) {
  const ids = [...new Set(eventIds.filter(Boolean))]
  if (ids.length === 0) return new Map<string, { event_name: string; event_date: string | null }>()

  const { data, error } = await (admin as any)
    .from('events')
    .select('id, event_name, event_date')
    .in('id', ids)
  if (error) throw new Error(error.message ?? 'Failed to load settlement events')

  return new Map(
    ((data ?? []) as Array<{ id: string; event_name: string; event_date: string | null }>)
      .map((event) => [event.id, { event_name: event.event_name, event_date: event.event_date }])
  )
}

async function loadVenues(admin: ReturnType<typeof createServiceRoleClient>, venueIds: string[]) {
  const ids = [...new Set(venueIds.filter(Boolean))]
  if (ids.length === 0) return new Map<string, { venue_name: string }>()

  const { data, error } = await (admin as any)
    .from('venues')
    .select('id, venue_name')
    .in('id', ids)
  if (error) throw new Error(error.message ?? 'Failed to load settlement venues')

  return new Map(
    ((data ?? []) as Array<{ id: string; venue_name: string }>)
      .map((venue) => [venue.id, { venue_name: venue.venue_name }])
  )
}
