import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  normalizeAvailabilityBlock,
  normalizeAvailabilityBlocks,
  toAvailabilityBlockInsert,
  type AvailabilityBlockRow,
} from '@/lib/bookings/availability-adapter'

async function requireVendorAccount(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('role, user_type')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.error('[vendor.blocks] Failed to load user account', error)
    return false
  }

  const account = data as { role?: string | null; user_type?: string | null } | null
  return account?.role === 'vendor' || account?.user_type === 'vendor'
}

function toDateOnly(value: string) {
  return value.split('T')[0]
}

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

    if (!(await requireVendorAccount(supabase, user.id))) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Get user's vendor
    const { data: vendor, error: vendorError } = await supabase
      .from('vendor_profiles')
      .select('id')
      .eq('user_id', user.id)
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
      .eq('blockable_type', 'vendor')
      .eq('blockable_id', (vendor as { id: string }).id)
      .order('start_date', { ascending: true })

    if (blocksError) {
      console.error('Error fetching blocks:', blocksError)
      return NextResponse.json(
        { error: 'Failed to fetch blocks' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      blocks: normalizeAvailabilityBlocks(blocks as AvailabilityBlockRow[] | null),
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

    if (!(await requireVendorAccount(supabase, user.id))) {
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
      reason,
      notes,
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
      .from('vendor_profiles')
      .select('id, user_id')
      .eq('id', vendor_id)
      .eq('user_id', user.id)
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

    const startDate = toDateOnly(start_date)
    const endDate = toDateOnly(end_date)

    // Check for overlapping bookings
    const { data: overlappingBookings } = await supabase
      .from('vendor_bookings')
      .select('id')
      .eq('vendor_id', vendor_id)
      .in('status', ['pending', 'confirmed'])
      .or(
        `and(booking_date.gte.${startDate},booking_date.lte.${endDate}),and(confirmed_date.gte.${startDate},confirmed_date.lte.${endDate}),and(requested_date.gte.${startDate},requested_date.lte.${endDate})`
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
      .insert(toAvailabilityBlockInsert({
        vendor_id,
        start_date,
        end_date,
        reason,
        notes,
      }) as never)
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
      block: normalizeAvailabilityBlock(block as AvailabilityBlockRow),
    })
  } catch (error) {
    console.error('Create block error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
