import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  normalizeAvailabilityBlocks,
  normalizeAvailabilityBlock,
  toAvailabilityBlockInsert,
  type AvailabilityBlockRow,
} from '@/lib/bookings/availability-adapter'

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
        blocks: [],
        count: 0,
      })
    }

    const venuesList = (venues || []) as { id: string }[]
    const venueIds = venuesList.map((v) => v.id)

    // Fetch all blocks for user's venues
    const { data: blocks, error: blocksError } = await supabase
      .from('availability_blocks')
      .select('*')
      .eq('blockable_type', 'venue')
      .in('blockable_id', venueIds)
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

    // Verify user is a venue owner
    const userType = user.user_metadata?.user_type
    if (userType !== 'venue_owner') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const {
      venue_id,
      start_date,
      end_date,
      reason,
      notes,
    } = body

    // Validate required fields
    if (!venue_id || !start_date || !end_date) {
      return NextResponse.json(
        { error: 'Missing required fields: venue_id, start_date, and end_date are required' },
        { status: 400 }
      )
    }

    // Verify venue belongs to user
    const { data: venue, error: venueError } = await supabase
      .from('venues')
      .select('id, owner_id')
      .eq('id', venue_id)
      .eq('owner_id', user.id)
      .single()

    if (venueError || !venue) {
      return NextResponse.json(
        { error: 'Venue not found or unauthorized' },
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
      .from('venue_bookings')
      .select('id')
      .eq('venue_id', venue_id)
      .in('status', ['pending', 'confirmed'])
      .gte('booking_date', start_date.split('T')[0])
      .lte('booking_date', end_date.split('T')[0])

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
        venue_id,
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
