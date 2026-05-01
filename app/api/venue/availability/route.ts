export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  normalizeAvailabilityBlocks,
  type AvailabilityBlockRow,
} from '@/lib/bookings/availability-adapter'
import {
  normalizeVenueBookings,
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
    const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()), 10)
    const month = parseInt(searchParams.get('month') || String(new Date().getMonth() + 1), 10)

    // Validate month
    if (month < 1 || month > 12) {
      return NextResponse.json(
        { error: 'Invalid month. Must be between 1 and 12' },
        { status: 400 }
      )
    }

    // Get user's venues
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
        blocks: [],
        availableDates: [],
        month: { year, month },
      })
    }

    const venuesList = (venues || []) as { id: string }[]
    const venueIds = venuesList.map((v) => v.id)

    // Calculate date range for the month
    const startDate = new Date(year, month - 1, 1)
    const endDate = new Date(year, month, 0, 23, 59, 59)
    const startDateString = startDate.toISOString().split('T')[0]
    const endDateString = endDate.toISOString().split('T')[0]

    // Fetch bookings (confirmed and pending) for the month
    const { data: bookings, error: bookingsError } = await supabase
      .from('venue_bookings')
      .select('*')
      .in('venue_id', venueIds)
      .gte('booking_date', startDateString)
      .lte('booking_date', endDateString)
      .in('status', ['pending', 'confirmed'])

    if (bookingsError) {
      console.error('Error fetching bookings:', bookingsError)
      return NextResponse.json(
        { error: 'Failed to fetch bookings' },
        { status: 500 }
      )
    }

    // Fetch availability blocks for the month
    const { data: blocks, error: blocksError } = await supabase
      .from('availability_blocks')
      .select('*')
      .eq('blockable_type', 'venue')
      .in('blockable_id', venueIds)
      .lte('start_date', endDateString)
      .gte('end_date', startDateString)
      .order('start_date', { ascending: true })

    if (blocksError) {
      console.error('Error fetching blocks:', blocksError)
      return NextResponse.json(
        { error: 'Failed to fetch availability blocks' },
        { status: 500 }
      )
    }

    // Calculate available dates (dates not in bookings or blocks)
    const bookedDates = new Set<string>()
    const blockedDates = new Set<string>()

    // Process bookings
    type BookingRow = { booking_date: string | null }
    ;((bookings || []) as BookingRow[]).forEach((booking) => {
      const date = booking.booking_date
      if (date) {
        const dateStr = new Date(date).toISOString().split('T')[0]
        bookedDates.add(dateStr)
      }
    })

    // Process blocks (where is_available = false)
    type BlockRow = { start_date: string; end_date: string }
    ;((blocks || []) as BlockRow[])
      .forEach((block) => {
        const start = new Date(block.start_date)
        const end = new Date(block.end_date)
        const current = new Date(start)

        while (current <= end) {
          const dateStr = current.toISOString().split('T')[0]
          blockedDates.add(dateStr)
          current.setDate(current.getDate() + 1)
        }
      })

    // Generate all dates in the month
    const allDates: string[] = []
    const current = new Date(startDate)
    while (current <= endDate) {
      allDates.push(current.toISOString().split('T')[0])
      current.setDate(current.getDate() + 1)
    }

    // Available dates are those not booked or blocked
    const availableDates = allDates.filter(
      (date) => !bookedDates.has(date) && !blockedDates.has(date)
    )

    return NextResponse.json({
      bookings: normalizeVenueBookings(bookings as VenueBookingJoinRow[] | null),
      blocks: normalizeAvailabilityBlocks(blocks as AvailabilityBlockRow[] | null),
      availableDates,
      bookedDates: Array.from(bookedDates),
      blockedDates: Array.from(blockedDates),
      month: { year, month },
    })
  } catch (error) {
    console.error('Get venue availability error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
