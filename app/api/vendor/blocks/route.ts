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

    // Verify user is a vendor
    const userType = user.user_metadata?.user_type
    if (userType !== 'vendor') {
      return NextResponse.json(
        { error: 'Unauthorized' },
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

    // Fetch all blocks for user's vendor
    const { data: blocks, error: blocksError } = await supabase
      .from('availability_blocks')
      .select('*')
      .eq('vendor_id', (vendor as { id: string }).id)
      .order('start_date', { ascending: true })

    if (blocksError) {
      console.error('Error fetching blocks:', blocksError)
      return NextResponse.json(
        { error: 'Failed to fetch blocks' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      blocks: blocks || [],
      count: blocks?.length || 0,
    })
  } catch (error) {
    console.error('Get blocks error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const {
      vendor_id,
      start_date,
      end_date,
      start_time,
      end_time,
      is_available = false,
      reason,
    } = body

    // Validate required fields
    if (!vendor_id || !start_date || !end_date) {
      return NextResponse.json(
        { error: 'Missing required fields: vendor_id, start_date, and end_date are required' },
        { status: 400 }
      )
    }

    // Verify vendor belongs to user
    const { data: vendor, error: vendorError } = await supabase
      .from('vendors')
      .select('id, owner_id')
      .eq('id', vendor_id)
      .eq('owner_id', user.id)
      .single()

    if (vendorError || !vendor) {
      return NextResponse.json(
        { error: 'Vendor not found or unauthorized' },
        { status: 404 }
      )
    }

    // Validate dates
    const start = new Date(start_date)
    const end = new Date(end_date)

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format' },
        { status: 400 }
      )
    }

    if (end < start) {
      return NextResponse.json(
        { error: 'end_date must be after start_date' },
        { status: 400 }
      )
    }

    // Check for overlapping bookings
    const { data: overlappingBookings } = await supabase
      .from('vendor_bookings')
      .select('id')
      .eq('vendor_id', vendor_id)
      .in('status', ['pending', 'confirmed'])
      .or(
        `and(confirmed_date.gte.${start_date},confirmed_date.lte.${end_date}),and(requested_date.gte.${start_date},requested_date.lte.${end_date})`
      )

    if (overlappingBookings && overlappingBookings.length > 0) {
      return NextResponse.json(
        { error: 'Cannot create block: overlapping with existing bookings' },
        { status: 400 }
      )
    }

    // Create block
    const { data: block, error: blockError } = await supabase
      .from('availability_blocks')
      .insert({
        venue_id: null,
        vendor_id,
        start_date: start_date.split('T')[0],
        end_date: end_date.split('T')[0],
        start_time: start_time || null,
        end_time: end_time || null,
        is_available,
        reason: reason || null,
      } as never)
      .select()
      .single()

    if (blockError) {
      console.error('Error creating block:', blockError)
      return NextResponse.json(
        { error: 'Failed to create block' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      block,
    })
  } catch (error) {
    console.error('Create block error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
