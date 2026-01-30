import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

    // Get user profile from users table
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('role, user_type')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile) {
      console.error('Error fetching user profile:', profileError)
      return NextResponse.json(
        { error: 'Failed to load user profile' },
        { status: 500 }
      )
    }

    // Verify user is a community builder (check role or user_type)
    const isBuilder = userProfile.role === 'builder' || userProfile.user_type === 'community_builder'
    if (!isBuilder) {
      return NextResponse.json(
        { error: 'Unauthorized - Community Builder access required' },
        { status: 403 }
      )
    }

    const now = new Date()
    const startOfYear = new Date(now.getFullYear(), 0, 1)

    // Fetch user's events
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, event_date, status, budget, builder_id')
      .eq('builder_id', user.id)

    if (eventsError) {
      console.error('Error fetching events:', eventsError)
      return NextResponse.json(
        { error: 'Failed to fetch events' },
        { status: 500 }
      )
    }

    // Fetch saved vendors count (table may not exist, handle gracefully)
    let savedVendorsCount = 0
    try {
      const { data: savedVendors, error: vendorsError } = await supabase
        .from('saved_vendors')
        .select('vendor_id')
        .eq('user_id', user.id)

      if (vendorsError) {
        // Table doesn't exist or other error - just log and continue
        console.warn('Saved vendors table not available:', vendorsError.message)
      } else {
        savedVendorsCount = savedVendors?.length || 0
      }
    } catch (err) {
      // Table doesn't exist - continue with 0
      console.warn('Saved vendors table not available')
    }

    // Fetch saved venues count (table may not exist, handle gracefully)
    let savedVenuesCount = 0
    try {
      const { data: savedVenues, error: venuesError } = await supabase
        .from('saved_venues')
        .select('venue_id')
        .eq('user_id', user.id)

      if (venuesError) {
        // Table doesn't exist or other error - just log and continue
        console.warn('Saved venues table not available:', venuesError.message)
      } else {
        savedVenuesCount = savedVenues?.length || 0
      }
    } catch (err) {
      // Table doesn't exist - continue with 0
      console.warn('Saved venues table not available')
    }

    // Calculate stats
    const eventsList = events || []
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
    const { data: vendorBookings } = await supabase
      .from('vendor_bookings')
      .select('vendor_id, events!inner(builder_id)')
      .eq('events.builder_id', user.id)
      .eq('status', 'confirmed')

    const activeVendorIds = new Set(
      (vendorBookings || []).map((vb: any) => vb.vendor_id)
    )

    return NextResponse.json({
      upcomingEvents: upcomingEvents.length,
      activeVendors: activeVendorIds.size,
      savedVendors: savedVendorsCount,
      savedVenues: savedVenuesCount,
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
