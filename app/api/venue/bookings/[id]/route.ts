import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { BookingStatus } from '@/lib/types'

interface RouteContext {
  params: {
    id: string
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
    const bookingWithVenue = booking as { venues?: { owner_id: string }; event_id: string; venue_id: string }
    if (bookingWithVenue.venues?.owner_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Prepare updates
    const updates: any = {
      updated_at: new Date().toISOString(),
    }

    if (status) {
      updates.status = status as BookingStatus
    }

    if (status === 'confirmed') {
      if (confirmed_date) updates.confirmed_date = confirmed_date
      if (confirmed_start_time) updates.confirmed_start_time = confirmed_start_time
      if (confirmed_end_time) updates.confirmed_end_time = confirmed_end_time
      if (final_price !== undefined) updates.final_price = final_price
    }

    if (quoted_price !== undefined) updates.quoted_price = quoted_price
    if (notes !== undefined) updates.notes = notes

    // Update booking
    const { data: updatedBooking, error: updateError } = await supabase
      .from('venue_bookings')
      .update(updates as never)
      .eq('id', id)
      .select('*, events!inner(builder_id)')
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
        if (event && event.builder_id) {
          // Check if thread already exists
          const { data: existingThread } = await supabase
            .from('message_threads')
            .select('id')
            .eq('event_id', bookingWithVenue.event_id)
            .eq('venue_id', bookingWithVenue.venue_id)
            .maybeSingle()

          if (!existingThread) {
            // Create message thread
            await supabase.from('message_threads').insert({
              event_id: bookingWithVenue.event_id,
              venue_id: bookingWithVenue.venue_id,
              builder_id: event.builder_id,
              venue_owner_id: user.id,
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
        if (event && event.builder_id) {
          await supabase.from('notifications').insert({
            user_id: event.builder_id,
            type: status === 'confirmed' ? 'booking_confirmed' : 'booking_declined',
            title:
              status === 'confirmed'
                ? 'Venue booking confirmed!'
                : 'Venue booking declined',
            message: `Your booking request has been ${status}.`,
            metadata: {
              booking_id: id,
              booking_type: 'venue',
              event_id: bookingWithVenue.event_id,
            },
          } as never)
        }
      } catch (notificationError) {
        console.error('Error creating notification:', notificationError)
        // Don't fail the request if notification creation fails
      }
    }

    return NextResponse.json({
      success: true,
      booking: updatedBooking,
    })
  } catch (error) {
    console.error('Update booking error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
