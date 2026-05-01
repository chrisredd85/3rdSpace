export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types'
import {
  getBuilderProfileId,
  mapAppEventTypeToDb,
  mapAppEventStatusToDb,
  mapDbEventToApp,
} from '@/lib/supabase/server-helpers'

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

    const { builderProfileId, error: builderProfileError } = await getBuilderProfileId(supabase, user.id)
    if (builderProfileError || !builderProfileId) {
      return NextResponse.json(
        { error: 'Builder profile not found' },
        { status: 404 }
      )
    }

    const { id } = params

    // Fetch event
    const { data: eventData, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .eq('builder_id', builderProfileId)
      .single()
    const event = eventData ? mapDbEventToApp(eventData as Record<string, any>) : null

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
      .select('*, vendor_profiles(*)')
      .eq('event_id', id)

    const vendors =
      vendorBookings
        ?.map((vb: any) => vb.vendor_profiles)
        .filter(Boolean) || []

    return NextResponse.json({
      event: {
        ...event,
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

    const { builderProfileId, error: builderProfileError } = await getBuilderProfileId(supabase, user.id)
    if (builderProfileError || !builderProfileId) {
      return NextResponse.json(
        { error: 'Builder profile not found' },
        { status: 404 }
      )
    }

    const { id } = params
    const body = await request.json()

    // Verify event belongs to user
    const { data: existingEvent } = await supabase
      .from('events')
      .select('id')
      .eq('id', id)
      .eq('builder_id', builderProfileId)
      .single()

    if (!existingEvent) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      )
    }

    // Update event
    const resolvedExpectedAttendance =
      body.expected_attendees ?? body.expected_attendance_min ?? body.expected_attendance_max

    const updatePayload = {
      ...(body.title !== undefined ? { event_name: body.title } : {}),
      ...(body.name !== undefined ? { event_name: body.name } : {}),
      ...(body.description !== undefined
        ? { description: body.description, event_description: body.description }
        : {}),
      ...(body.event_type !== undefined ? { event_type: mapAppEventTypeToDb(body.event_type) } : {}),
      ...(body.event_date !== undefined ? { event_date: body.event_date } : {}),
      ...(body.start_time !== undefined ? { start_time: body.start_time } : {}),
      ...(body.end_time !== undefined ? { end_time: body.end_time } : {}),
      ...(resolvedExpectedAttendance !== undefined
        ? {
            expected_attendance: resolvedExpectedAttendance,
            expected_attendance_min: resolvedExpectedAttendance,
            expected_attendance_max: resolvedExpectedAttendance,
          }
        : {}),
      ...(body.budget !== undefined ? { budget: body.budget, total_budget: body.budget } : {}),
      ...(body.venue_id !== undefined ? { venue_id: body.venue_id } : {}),
      ...(body.status !== undefined ? { status: mapAppEventStatusToDb(body.status) } : {}),
      updated_at: new Date().toISOString(),
    } as Record<string, any>

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

    const updatedEvent = eventData ? mapDbEventToApp(eventData as Record<string, any>) : null

    return NextResponse.json({
      success: true,
      event: updatedEvent,
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

    const { builderProfileId, error: builderProfileError } = await getBuilderProfileId(supabase, user.id)
    if (builderProfileError || !builderProfileId) {
      return NextResponse.json(
        { error: 'Builder profile not found' },
        { status: 404 }
      )
    }

    const { id } = params

    // Verify event belongs to user
    const { data: existingEvent } = await supabase
      .from('events')
      .select('id')
      .eq('id', id)
      .eq('builder_id', builderProfileId)
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
