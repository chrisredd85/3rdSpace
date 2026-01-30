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

    // Verify user is a vendor
    const userType = user.user_metadata?.user_type
    if (userType !== 'vendor') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Get query parameters
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') as BookingStatus | null

    // Get vendor owned by this user
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

    // Build query for bookings
    let query = supabase
      .from('vendor_bookings')
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
          venue_id,
          profiles!events_builder_id_fkey (
            id,
            name,
            email,
            avatar_url
          ),
          venues (
            id,
            name,
            address,
            city,
            state
          )
        ),
        vendors (
          id,
          name,
          business_name,
          service_type
        )
      `
      )
      .eq('vendor_id', vendor.id)
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
    console.error('Get vendor bookings error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
