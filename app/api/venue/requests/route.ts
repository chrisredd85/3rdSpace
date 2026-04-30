import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { BookingStatus } from '@/lib/types'
import {
  normalizeVenueBookings,
  VENUE_BOOKING_WITH_DETAILS_SELECT,
  type VenueBookingJoinRow,
} from '@/lib/bookings/venue-booking-adapter'

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

    // Verify user is a venue owner
    const userType = user.user_metadata?.user_type
    if (userType !== 'venue_owner') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Get query parameters
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') as BookingStatus | 'all' | null

    // Get all venues owned by this user
    const { data: venues, error: venuesError } = await supabase
      .from('venues')
      .select('id')
      .eq('owner_id', user.id)

    if (venuesError) {
      console.error('Error fetching venues:', venuesError)
      return NextResponse.json(
        { error: 'Failed to fetch venues' },
        { status: 500 }
      )
    }

    if (!venues || venues.length === 0) {
      return NextResponse.json({
        bookings: [],
        count: 0,
      })
    }

    const venuesList = (venues || []) as { id: string }[]
    const venueIds = venuesList.map((v) => v.id)

    // Build query for bookings
    let query = supabase
      .from('venue_bookings')
      .select(VENUE_BOOKING_WITH_DETAILS_SELECT)
      .in('venue_id', venueIds)
      .order('created_at', { ascending: false })

    // Apply status filter if provided
    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    const { data: bookings, error } = await query

    if (error) {
      console.error('Error fetching bookings:', error)
      return NextResponse.json(
        { error: 'Failed to fetch bookings' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      bookings: normalizeVenueBookings(bookings as VenueBookingJoinRow[] | null),
      count: bookings?.length || 0,
    })
  } catch (error) {
    console.error('Get venue requests error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
