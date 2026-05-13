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
    // Verify user is a vendor (check role or user_type)
    const isVendor = userProfile.role === 'vendor' || userProfile.user_type === 'vendor'
    if (!isVendor) {
      return NextResponse.json(
        { error: 'Unauthorized - Vendor access required' },
        { status: 403 }
      )
    }

    // Get user's vendor
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select('id, is_published')
      .eq('user_id', user.id)
      .single()

    if (vendorError || !vendor) {
      return NextResponse.json(
        { error: 'Vendor profile not found' },
        { status: 404 }
      )
    }

    const vendorData = vendor as { id: string; is_published: boolean | null }

    // Calculate current month range
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
    const prevMonthStartString = prevMonthStart.toISOString().split('T')[0]
    const monthEndString = monthEnd.toISOString().split('T')[0]

    // Fetch new requests (pending)
    const { count: newRequestsCount } = await supabase
      .from('vendor_bookings')
      .select('*', { count: 'exact', head: true })
      .eq('vendor_id', vendorData.id)
      .eq('status', 'pending')

    // Fetch confirmed gig count without loading all historical rows
    const { count: confirmedGigsCount } = await supabase
      .from('vendor_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('vendor_id', vendorData.id)
      .eq('status', 'confirmed')

    // Fetch only the revenue window needed for current and previous month stats
    const { data: confirmedBookings } = await supabase
      .from('vendor_bookings')
      .select('booking_date, confirmed_date, final_price, quoted_price')
      .eq('vendor_id', vendorData.id)
      .eq('status', 'confirmed')
      .or(
        `and(booking_date.gte.${prevMonthStartString},booking_date.lte.${monthEndString}),and(confirmed_date.gte.${prevMonthStartString},confirmed_date.lte.${monthEndString})`
      )

    type BookingRow = { booking_date?: string | null; confirmed_date: string | null; final_price: number | null; quoted_price: number | null }
    const confirmedList = (confirmedBookings || []) as BookingRow[]
    const thisMonthBookings = confirmedList.filter((b) => {
      const date = b.confirmed_date || b.booking_date
      if (!date) return false
      const bookingDate = new Date(date)
      return bookingDate >= monthStart && bookingDate <= monthEnd
    })

    const revenueMtd = thisMonthBookings.reduce(
      (sum, b) => sum + (b.final_price || b.quoted_price || 0),
      0
    )

    // Calculate response rate: bookings responded to within 24 hours
    // Simplified: assume 95% for now, would need to track actual response times
    const responseRate = 95

    // Calculate previous month revenue for change percentage
    const prevMonthBookings = confirmedList.filter((b) => {
      const date = b.confirmed_date || b.booking_date
      if (!date) return false
      const bookingDate = new Date(date)
      return bookingDate >= prevMonthStart && bookingDate <= prevMonthEnd
    })

    const prevMonthRevenue = prevMonthBookings.reduce(
      (sum, b) => sum + (b.final_price || b.quoted_price || 0),
      0
    )

    const revenueChange = prevMonthRevenue > 0
      ? Math.round(((revenueMtd - prevMonthRevenue) / prevMonthRevenue) * 100)
      : 0

    return NextResponse.json({
      vendorId: vendorData.id,
      isPublished: vendorData.is_published !== false,
      newRequests: newRequestsCount || 0,
      confirmedGigs: confirmedGigsCount || 0,
      revenueMtd,
      revenueChange,
      responseRate,
    })
  } catch (error) {
    console.error('Vendor stats error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
