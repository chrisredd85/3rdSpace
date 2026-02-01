import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Event, Database } from '@/lib/types'

interface RouteContext {
  params: {
    id: string
  }
}

export async function GET(
  request: NextRequest,
  { params }: RouteContext
) {
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

    // Verify user is a community builder
    const userType = user.user_metadata?.user_type
    if (userType !== 'community_builder') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const { id } = params

    // Fetch event
    const { data: eventData, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .eq('builder_id', user.id)
      .single()
    const event = eventData as Event | null

    if (eventError || !event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      )
    }

    // Fetch venue if venue_id exists
    let venue = null
    if (event.venue_id) {
      const { data: venueData } = await supabase
        .from('venues')
        .select('*')
        .eq('id', event.venue_id)
        .single()

      venue = venueData
    }

    // Fetch venue booking
    let venue_booking = null
    const { data: venueBooking } = await supabase
      .from('venue_bookings')
      .select('*')
      .eq('event_id', id)
      .maybeSingle()

    venue_booking = venueBooking

    // Fetch vendor bookings and vendors
    const { data: vendorBookings } = await supabase
      .from('vendor_bookings')
      .select('*, vendors(*)')
      .eq('event_id', id)

    const vendors =
      vendorBookings
        ?.map((vb: any) => vb.vendors)
        .filter(Boolean) || []

    return NextResponse.json({
      event: {
        ...(event as Event),
        venue,
        venue_booking,
        vendor_bookings: vendorBookings || [],
        vendors,
      },
    })
  } catch (error) {
    console.error('Get event error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteContext
) {
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

    // Verify user is a community builder
    const userType = user.user_metadata?.user_type
    if (userType !== 'community_builder') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const { id } = params
    const body = await request.json()

    // Verify event belongs to user
    const { data: existingEvent } = await supabase
      .from('events')
      .select('id')
      .eq('id', id)
      .eq('builder_id', user.id)
      .single()

    if (!existingEvent) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      )
    }

    // Update event
    const updatePayload: Database['public']['Tables']['events']['Update'] = {
      ...(body as Partial<Database['public']['Tables']['events']['Update']>),
      updated_at: new Date().toISOString(),
    }

    const { data: eventData, error } = await supabase
      .from('events')
      .update(updatePayload as never)
      .eq('id', id)
      .select()
      .single()
    const event = eventData as Event | null

    if (error) {
      console.error('Error updating event:', error)
      return NextResponse.json(
        { error: 'Failed to update event' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      event,
    })
  } catch (error) {
    console.error('Update event error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext
) {
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

    // Verify user is a community builder
    const userType = user.user_metadata?.user_type
    if (userType !== 'community_builder') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const { id } = params

    // Verify event belongs to user
    const { data: existingEvent } = await supabase
      .from('events')
      .select('id')
      .eq('id', id)
      .eq('builder_id', user.id)
      .single()

    if (!existingEvent) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      )
    }

    // Delete event (cascade will handle related records)
    const { error } = await supabase.from('events').delete().eq('id', id)

    if (error) {
      console.error('Error deleting event:', error)
      return NextResponse.json(
        { error: 'Failed to delete event' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Event deleted successfully',
    })
  } catch (error) {
    console.error('Delete event error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
