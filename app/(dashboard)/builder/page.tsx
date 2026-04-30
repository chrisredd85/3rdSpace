import { BuilderDashboardClient } from '@/components/builder/BuilderDashboardClient'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId, mapDbEventToApp } from '@/lib/supabase/server-helpers'
import type { Event } from '@/lib/types'
import type { BuilderStats } from '@/lib/hooks/useBuilderStats'

export const dynamic = 'force-dynamic'

const emptyStats: BuilderStats = {
  upcomingEvents: 0,
  activeVendors: 0,
  savedVendors: 0,
  savedVenues: 0,
  ytdSpend: 0,
  eventsThisYear: 0,
  totalEvents: 0,
}

/**
 * Server-load the builder dashboard's first render so client API polling cannot
 * leave the user stranded on a spinner.
 */
export default async function BuilderDashboardPage() {
  const { stats, events } = await getBuilderDashboardData()

  return (
    <BuilderDashboardClient
      initialStats={stats}
      initialEvents={events}
    />
  )
}

/**
 * Fetches the authenticated builder's dashboard metrics and events.
 */
async function getBuilderDashboardData(): Promise<{
  stats: BuilderStats
  events: Event[]
}> {
  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { stats: emptyStats, events: [] }
    }

    const { builderProfileId } = await getBuilderProfileId(supabase, user.id)
    if (!builderProfileId) {
      return { stats: emptyStats, events: [] }
    }

    const { data: eventsData, error: eventsError } = await supabase
      .from('events')
      .select('*')
      .eq('builder_id', builderProfileId)
      .order('event_date', { ascending: false })
      .range(0, 49)

    if (eventsError) {
      console.error('Error loading builder dashboard events:', eventsError)
      return { stats: emptyStats, events: [] }
    }

    const events = (eventsData || []).map((event) =>
      mapDbEventToApp(event as Record<string, any>)
    )

    const now = new Date()
    const startOfYear = new Date(now.getFullYear(), 0, 1)
    const upcomingEvents = events.filter(
      (event) =>
        new Date(event.event_date) >= now &&
        event.status !== 'completed' &&
        event.status !== 'cancelled'
    )
    const thisYearEvents = events.filter(
      (event) => new Date(event.event_date) >= startOfYear
    )
    const ytdSpend = thisYearEvents.reduce(
      (sum, event) => sum + (event.budget || 0),
      0
    )

    const eventIds = events.map((event) => event.id)
    const { data: vendorBookings } = eventIds.length
      ? await supabase
          .from('vendor_bookings')
          .select('vendor_id, event_id')
          .in('event_id', eventIds)
          .eq('status', 'confirmed')
      : { data: [] }

    const [savedVendorsCount, savedVenuesCount] = await Promise.all([
      getSavedCount(supabase, 'saved_vendors', 'vendor_id', user.id),
      getSavedCount(supabase, 'saved_venues', 'venue_id', user.id),
    ])

    return {
      stats: {
        upcomingEvents: upcomingEvents.length,
        activeVendors: new Set((vendorBookings || []).map((booking: any) => booking.vendor_id)).size,
        savedVendors: savedVendorsCount,
        savedVenues: savedVenuesCount,
        ytdSpend,
        eventsThisYear: thisYearEvents.length,
        totalEvents: events.length,
      },
      events,
    }
  } catch (error) {
    console.error('Error loading builder dashboard:', error)
    return { stats: emptyStats, events: [] }
  }
}

/**
 * Counts optional saved item rows while tolerating missing MVP tables.
 */
async function getSavedCount(
  supabase: any,
  table: 'saved_vendors' | 'saved_venues',
  column: 'vendor_id' | 'venue_id',
  userId: string
) {
  try {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .eq('user_id', userId)

    if (error) {
      console.warn(`${table} table not available:`, error.message)
      return 0
    }

    return data?.length || 0
  } catch (error) {
    console.warn(`${table} table not available`)
    return 0
  }
}
