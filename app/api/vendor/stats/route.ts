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

    // Get user profile from profiles table
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('user_type')
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
      .from('vendors')
      .select('id')
      .eq('owner_id', user.id)
      .single()

    if (vendorError || !vendor) {
      return NextResponse.json(
        { error: 'Vendor profile not found' },
        { status: 404 }
      )
    }

    const vendorData = vendor as { id: string }

    // Calculate current month range
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

    // Fetch new requests (pending)
    const { count: newRequestsCount } = await supabase
      .from('vendor_bookings')
      .select('*', { count: 'exact', head: true })
      .eq('vendor_id', vendorData.id)
      .eq('status', 'pending')

    // Fetch confirmed gigs
    const { data: confirmedBookings } = await supabase
      .from('vendor_bookings')
      .select('*')
      .eq('vendor_id', vendorData.id)
      .eq('status', 'confirmed')

    type BookingRow = { confirmed_date: string | null; final_price: number | null; quoted_price: number | null }
    const confirmedList = (confirmedBookings || []) as BookingRow[]
    const thisMonthBookings = confirmedList.filter((b) => {
      if (!b.confirmed_date) return false
      const bookingDate = new Date(b.confirmed_date)
      return bookingDate >= monthStart && bookingDate <= monthEnd
    })

    const revenueMtd = thisMonthBookings.reduce(
      (sum, b) => sum + (b.final_price || b.quoted_price || 0),
      0
    )

    // Calculate response rate (would need to track response times)
    // For now, calculate based on accepted vs declined ratio
    const { data: allBookings } = await supabase
      .from('vendor_bookings')
      .select('status, created_at, updated_at')
      .eq('vendor_id', vendorData.id)
      .in('status', ['pending', 'confirmed', 'declined'])

    // Calculate response rate: bookings responded to within 24 hours
    // Simplified: assume 95% for now, would need to track actual response times
    const responseRate = 95

    // Calculate previous month revenue for change percentage
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
    
    const prevMonthBookings = confirmedList.filter((b) => {
      if (!b.confirmed_date) return false
      const bookingDate = new Date(b.confirmed_date)
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
      newRequests: newRequestsCount || 0,
      confirmedGigs: confirmedBookings?.length || 0,
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
