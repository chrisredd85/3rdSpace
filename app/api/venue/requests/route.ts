import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { BookingStatus } from '@/lib/types'

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
    const status = searchParams.get('status') as BookingStatus | null

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

    const venueIds = venues.map((v) => v.id)

    // Build query for bookings
    let query = supabase
      .from('venue_bookings')
      .select(
        `
        *,
        events (
          id,
          title,
          event_date,
          start_time,
          end_time,
          expected_attendance_min,
          expected_attendance_max,
          budget,
          builder_id,
          profiles!events_builder_id_fkey (
            id,
            name,
            email,
            avatar_url
          )
        ),
        venues (
          id,
          name,
          address,
          city,
          state
        )
      `
      )
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
      bookings: bookings || [],
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
