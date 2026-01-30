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
        pendingRequests: 0,
        thisMonthBookings: 0,
        revenueMtd: 0,
        acceptanceRate: 0,
        bookedPercentage: 0,
      })
    }

    const venueIds = venues.map((v) => v.id)

    // Calculate current month range
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

    // Fetch pending requests
    const { count: pendingCount } = await supabase
      .from('venue_bookings')
      .select('*', { count: 'exact', head: true })
      .in('venue_id', venueIds)
      .eq('status', 'pending')

    // Fetch this month's bookings (confirmed)
    const { data: thisMonthBookings } = await supabase
      .from('venue_bookings')
      .select('*')
      .in('venue_id', venueIds)
      .eq('status', 'confirmed')
      .gte('confirmed_date', monthStart.toISOString())
      .lte('confirmed_date', monthEnd.toISOString())

    // Calculate revenue (MTD)
    const revenueMtd = (thisMonthBookings || []).reduce(
      (sum, booking) => sum + (booking.final_price || booking.quoted_price || 0),
      0
    )

    // Calculate acceptance rate
    const { data: allBookings } = await supabase
      .from('venue_bookings')
      .select('status')
      .in('venue_id', venueIds)
      .in('status', ['pending', 'confirmed', 'declined'])

    const totalRequests = allBookings?.length || 0
    const confirmedCount = allBookings?.filter((b) => b.status === 'confirmed').length || 0
    const acceptanceRate = totalRequests > 0 ? Math.round((confirmedCount / totalRequests) * 100) : 0

    // Calculate booked percentage for current month
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const bookedDays = new Set(
      (thisMonthBookings || []).map((b) => {
        if (b.confirmed_date) {
          return new Date(b.confirmed_date).getDate()
        }
        return null
      }).filter(Boolean) as number[]
    )
    const bookedPercentage = Math.round((bookedDays.size / daysInMonth) * 100)

    return NextResponse.json({
      pendingRequests: pendingCount || 0,
      thisMonthBookings: thisMonthBookings?.length || 0,
      revenueMtd,
      acceptanceRate,
      bookedPercentage,
    })
  } catch (error) {
    console.error('Venue stats error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
