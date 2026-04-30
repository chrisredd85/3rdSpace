import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  isCompletedVendorBooking,
  normalizeVendorBookings,
  VENDOR_BOOKING_WITH_DETAILS_SELECT,
  type VendorBookingJoinRow,
} from '@/lib/bookings/vendor-booking-adapter'

const statusFilterSchema = z.enum(['all', 'pending', 'confirmed', 'completed', 'declined', 'cancelled'])

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

    // Get query parameters
    const { searchParams } = new URL(request.url)
    const vendorId = searchParams.get('vendorId')
    const rawStatus = searchParams.get('status') || 'all'
    const parsedStatus = statusFilterSchema.safeParse(rawStatus)

    if (!parsedStatus.success) {
      return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 })
    }

    if (vendorId && !z.string().uuid().safeParse(vendorId).success) {
      return NextResponse.json({ error: 'Invalid vendor id' }, { status: 400 })
    }

    // Get vendor owned by this user
    let vendorQuery = supabase
      .from('vendor_profiles')
      .select('id')
      .eq('user_id', user.id)

    if (vendorId) vendorQuery = vendorQuery.eq('id', vendorId)

    const { data: vendor, error: vendorError } = await vendorQuery.limit(1).maybeSingle()

    if (vendorError || !vendor) {
      return NextResponse.json(
        { error: 'Vendor profile not found' },
        { status: 404 }
      )
    }

    // Build query for bookings
    let query = supabase
      .from('vendor_bookings')
      .select(VENDOR_BOOKING_WITH_DETAILS_SELECT)
      .eq('vendor_id', (vendor as { id: string }).id)
      .order('created_at', { ascending: false })

    // Apply status filter if provided
    const status = parsedStatus.data
    if (status === 'completed') {
      query = query.eq('status', 'confirmed')
    } else if (status !== 'all') {
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

    const today = new Date().toISOString().split('T')[0]
    const rows = normalizeVendorBookings(bookings as VendorBookingJoinRow[] | null)
    const filteredBookings = status === 'completed'
      ? rows.filter((booking) => isCompletedVendorBooking(booking, today))
      : status === 'confirmed'
      ? rows.filter((booking) => !isCompletedVendorBooking(booking, today))
      : rows

    return NextResponse.json({
      bookings: filteredBookings,
      count: filteredBookings.length,
      vendorId: (vendor as { id: string }).id,
    })
  } catch (error) {
    console.error('Get vendor bookings error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
