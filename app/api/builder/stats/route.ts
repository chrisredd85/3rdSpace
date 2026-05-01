export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Event } from '@/lib/types'
import { getBuilderProfileId, getUserAccountRecord, mapDbEventToApp } from '@/lib/supabase/server-helpers'

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()

    // Verify user is authenticated
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    const { data: profileData, error: profileError } = await getUserAccountRecord(supabase, user.id)

    if (profileError || !profileData) {
      console.error('Error fetching user profile:', profileError)
      return NextResponse.json(
        { error: 'Failed to load user profile' },
        { status: 500 }
      )
    }

    const userProfile = profileData as { role?: string; user_type?: string }
    // Verify user is a community builder (check role or user_type)
    const isBuilder = userProfile.role === 'builder' || userProfile.user_type === 'community_builder'
    if (!isBuilder) {
      return NextResponse.json(
        { error: 'Unauthorized - Community Builder access required' },
        { status: 403 }
      )
    }

    const { builderProfileId, error: builderProfileError } = await getBuilderProfileId(supabase, user.id)
    if (builderProfileError || !builderProfileId) {
      return NextResponse.json(
        { error: 'Builder profile not found' },
        { status: 404 }
      )
    }

    const now = new Date()
    const startOfYear = new Date(now.getFullYear(), 0, 1)

    // Fetch user's events
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('*')
      .eq('builder_id', builderProfileId)

    if (eventsError) {
      console.error('Error fetching events:', eventsError)
      return NextResponse.json(
        { error: 'Failed to fetch events' },
        { status: 500 }
      )
    }

    const { count: savedVendorsCount, error: vendorsError } = await supabase
      .from('saved_vendors')
      .select('vendor_id', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if (vendorsError) {
      console.error('Error fetching saved vendors count:', vendorsError)
      return NextResponse.json(
        { error: 'Failed to fetch saved vendors count' },
        { status: 500 }
      )
    }

    const { count: savedVenuesCount, error: venuesError } = await supabase
      .from('saved_venues')
      .select('venue_id', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if (venuesError) {
      console.error('Error fetching saved venues count:', venuesError)
      return NextResponse.json(
        { error: 'Failed to fetch saved venues count' },
        { status: 500 }
      )
    }

    // Calculate stats (cast: Supabase client infers never for table rows)
    const eventsList = (events || []).map(mapDbEventToApp) as Pick<Event, 'id' | 'event_date' | 'status' | 'budget' | 'builder_id'>[]
    const upcomingEvents = eventsList.filter(
      (e) =>
        new Date(e.event_date) >= now &&
        e.status !== 'completed' &&
        e.status !== 'cancelled'
    )

    const thisYearEvents = eventsList.filter(
      (e) => new Date(e.event_date) >= startOfYear
    )

    const ytdSpend = thisYearEvents.reduce(
      (sum, e) => sum + (e.budget || 0),
      0
    )

    // Get unique active vendors from vendor bookings
    const eventIds = eventsList.map((event) => event.id)

    const { data: vendorBookings } = eventIds.length
      ? await supabase
          .from('vendor_bookings')
          .select('vendor_id, event_id')
          .in('event_id', eventIds)
          .eq('status', 'confirmed')
      : { data: [] }

    const activeVendorIds = new Set(
      (vendorBookings || []).map((vb: any) => vb.vendor_id)
    )

    return NextResponse.json({
      upcomingEvents: upcomingEvents.length,
      activeVendors: activeVendorIds.size,
      savedVendors: savedVendorsCount || 0,
      savedVenues: savedVenuesCount || 0,
      ytdSpend,
      eventsThisYear: thisYearEvents.length,
      totalEvents: eventsList.length,
    })
  } catch (error) {
    console.error('Stats error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
