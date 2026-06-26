export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { BookingStatus } from '@/lib/types'
import {
  normalizeVenueBooking,
  toVenueBookingUpdate,
  VENUE_BOOKING_WITH_DETAILS_SELECT,
  type VenueBookingJoinRow,
} from '@/lib/bookings/venue-booking-adapter'

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

export async function PATCH(request: NextRequest, props: RouteContext) {
  const params = await props.params;
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

    const { id } = params
    const body = await request.json()
    const {
      status,
      confirmed_date,
      confirmed_start_time,
      confirmed_end_time,
      final_price,
      quoted_price,
      notes,
    } = body

    // Verify booking exists and belongs to user's venue
    const { data: booking, error: bookingError } = await supabase
      .from('venue_bookings')
      .select('*, venues!inner(owner_id)')
      .eq('id', id)
      .single()

    if (bookingError || !booking) {
      return NextResponse.json(
        { error: 'Booking not found' },
        { status: 404 }
      )
    }

    // Verify venue belongs to user
    const bookingWithVenue = booking as { venues?: { owner_id: string | null }; event_id: string; venue_id: string }
    if (bookingWithVenue.venues?.owner_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const updates = toVenueBookingUpdate({
      status: status as BookingStatus | undefined,
      confirmed_date,
      confirmed_start_time,
      confirmed_end_time,
      final_price,
      quoted_price,
      notes,
    })

    // Update booking
    const { data: updatedBooking, error: updateError } = await supabase
      .from('venue_bookings')
      .update(updates as never)
      .eq('id', id)
      .select(VENUE_BOOKING_WITH_DETAILS_SELECT)
      .single()

    if (updateError) {
      console.error('Error updating booking:', updateError)
      return NextResponse.json(
        { error: 'Failed to update booking' },
        { status: 500 }
      )
    }

    // Create message thread if status changed to confirmed or declined
    if (status === 'confirmed' || status === 'declined') {
      try {
        const event = (updatedBooking as any).events
        const builderUserId = event?.builder_profiles?.user_id
        if (event && builderUserId) {
          // Check if thread already exists
          const { data: existingThread } = await supabase
            .from('message_threads')
            .select('id')
            .eq('booking_type', 'venue_booking')
            .eq('booking_id', id)
            .maybeSingle()

          if (!existingThread) {
            // Create message thread
            await supabase.from('message_threads').insert({
              event_id: bookingWithVenue.event_id,
              booking_id: id,
              booking_type: 'venue_booking',
              participant_1_id: user.id,
              participant_2_id: builderUserId,
            } as never)
          }
        }
      } catch (threadError) {
        console.error('Error creating message thread:', threadError)
        // Don't fail the request if thread creation fails
      }
    }

    // Create notification for organizer
    if (status === 'confirmed' || status === 'declined') {
      try {
        const event = (updatedBooking as any).events
        const builderUserId = event?.builder_profiles?.user_id
        if (event && builderUserId) {
          await supabase.from('notifications').insert({
            user_id: builderUserId,
            notification_type: status === 'confirmed' ? 'booking_confirmed' : 'booking_declined',
            title:
              status === 'confirmed'
                ? 'Venue booking confirmed!'
                : 'Venue booking declined',
            message: `Your booking request has been ${status}.`,
            link_url: '/planner/experiences',
          } as never)
        }
      } catch (notificationError) {
        console.error('Error creating notification:', notificationError)
        // Don't fail the request if notification creation fails
      }
    }

    return NextResponse.json({
      success: true,
      booking: normalizeVenueBooking(updatedBooking as VenueBookingJoinRow),
    })
  } catch (error) {
    console.error('Update booking error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
