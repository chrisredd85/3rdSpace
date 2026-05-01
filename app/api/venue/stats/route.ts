export const dynamic = 'force-dynamic'
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
    const { data: profileData, error: profileError } = await supabase
      .from('users')
      .select('role, user_type')
      .eq('id', user.id)
      .single()

    if (profileError || !profileData) {
      console.error('Error fetching user profile:', profileError)
      return NextResponse.json(
        { error: 'Failed to load user profile' },
        { status: 500 }
      )
    }

    const userProfile = profileData as { role?: string; user_type?: string }
    // Verify user is a venue owner (check role or user_type)
    const isVenueOwner = userProfile.role === 'owner' || userProfile.user_type === 'venue_owner'
    if (!isVenueOwner) {
      return NextResponse.json(
        { error: 'Unauthorized - Venue Owner access required' },
        { status: 403 }
      )
    }

    // Get user's venues
    const { data: venues, error: venuesError } = await supabase
      .from('venues')
      .select('id, venue_name, address, city, state, standing_capacity, seated_capacity, is_published')
      .eq('owner_id', user.id)

    if (venuesError) {
      console.error('Error fetching venues:', venuesError)
      return NextResponse.json(
        { error: 'Failed to fetch venues' },
        { status: 500 }
      )
    }

    if (!venues || venues.length === 0) {
      return NextResponse.json(
        {
          pendingRequests: 0,
          thisMonthBookings: 0,
          revenueMtd: 0,
          acceptanceRate: 0,
          bookedPercentage: 0,
          venues: [],
        },
        {
          headers: {
            'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
          },
        }
      )
    }

    const venuesList = (venues || []) as Array<{
      id: string
      venue_name?: string | null
      address?: string | null
      city?: string | null
      state?: string | null
      standing_capacity?: number | null
      seated_capacity?: number | null
      is_published?: boolean | null
    }>
    const venueIds = venuesList.map((v) => v.id)

    // Calculate current month range
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
    const monthStartString = monthStart.toISOString().split('T')[0]
    const monthEndString = monthEnd.toISOString().split('T')[0]

    // Fetch pending requests
    const { count: pendingCount } = await supabase
      .from('venue_bookings')
      .select('*', { count: 'exact', head: true })
      .in('venue_id', venueIds as string[])
      .eq('status', 'pending')

    // Fetch this month's bookings (confirmed)
    const { data: thisMonthBookings } = await supabase
      .from('venue_bookings')
      .select('*')
      .in('venue_id', venueIds as string[])
      .eq('status', 'confirmed')
      .gte('booking_date', monthStartString)
      .lte('booking_date', monthEndString)

    type BookingRow = { final_price: number | null; quoted_price: number | null; booking_date?: string | null; status?: string }
    const thisMonthList = (thisMonthBookings || []) as BookingRow[]
    const revenueMtd = thisMonthList.reduce(
      (sum, booking) => sum + (booking.final_price || booking.quoted_price || 0),
      0
    )

    // Calculate acceptance rate
    const { data: allBookings } = await supabase
      .from('venue_bookings')
      .select('status')
      .in('venue_id', venueIds as string[])
      .in('status', ['pending', 'confirmed', 'declined'])

    const allBookingsList = (allBookings || []) as BookingRow[]
    const totalRequests = allBookingsList.length
    const confirmedCount = allBookingsList.filter((b) => b.status === 'confirmed').length
    const acceptanceRate = totalRequests > 0 ? Math.round((confirmedCount / totalRequests) * 100) : 0

    // Calculate booked percentage for current month
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const bookedDays = new Set(
      thisMonthList.map((b) => {
        if (b.booking_date) {
          return new Date(b.booking_date).getDate()
        }
        return null
      }).filter(Boolean) as number[]
    )
    const bookedPercentage = Math.round((bookedDays.size / daysInMonth) * 100)

    return NextResponse.json(
      {
        pendingRequests: pendingCount || 0,
        thisMonthBookings: thisMonthList.length,
        revenueMtd,
        acceptanceRate,
        bookedPercentage,
        venues: venuesList.map((venue) => ({
          id: venue.id,
          name: venue.venue_name || 'Untitled venue',
          address: venue.address || null,
          city: venue.city || null,
          state: venue.state || null,
          capacity: venue.standing_capacity || venue.seated_capacity || null,
          isPublished: Boolean(venue.is_published),
        })),
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
        },
      }
    )
  } catch (error) {
    console.error('Venue stats error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
