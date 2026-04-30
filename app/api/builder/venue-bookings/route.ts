import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const venueBookingRequestSchema = z.object({
  venueId: z.string().uuid(),
  requested_date: z.string().min(1),
  requested_start_time: z.string().min(1),
  requested_end_time: z.string().optional(),
  expected_attendees: z.number().int().positive(),
  min_attendees: z.number().int().positive().optional(),
  max_attendees: z.number().int().positive().optional(),
  notes: z.string().max(1000).optional(),
})

type BuilderProfileRow = {
  id: string
}

type VenueLookupRow = {
  id: string
  venue_name: string
  hourly_rate: number | null
  minimum_hours: number | null
  is_published: boolean | null
}

type CreatedEventRow = {
  id: string
}

/**
 * Calculates booking duration in hours from form time strings.
 *
 * @param startTime - HH:mm start time.
 * @param endTime - Optional HH:mm end time.
 * @returns Positive duration in hours, defaulting to two hours.
 */
function calculateDurationHours(startTime: string, endTime?: string) {
  if (!endTime || endTime <= startTime) return 2

  const [startHour, startMinute] = startTime.split(':').map(Number)
  const [endHour, endMinute] = endTime.split(':').map(Number)
  const minutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute)
  return Math.max(minutes / 60, 1)
}

/**
 * Estimates venue booking cost for deposit display and pending request records.
 *
 * @param hourlyRate - Venue hourly rate.
 * @param minimumHours - Venue minimum booked hours.
 * @param durationHours - Requested duration.
 * @returns Estimated booking cost.
 */
function estimateBookingCost(hourlyRate: number | null, minimumHours: number | null, durationHours: number) {
  if (hourlyRate && hourlyRate > 0) {
    return hourlyRate * Math.max(durationHours, minimumHours || 1)
  }
  return 0
}

/**
 * Creates a lightweight event and pending venue booking request from a venue detail page.
 *
 * @route POST /api/builder/venue-bookings
 * @auth Required - community builder.
 *
 * @param request - Booking request form payload.
 * @returns Created event and venue booking.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsedBody = venueBookingRequestSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid booking request', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const body = parsedBody.data
    const { data: builderProfile, error: builderError } = await supabase
      .from('builder_profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (builderError) {
      console.error('[builder.venue-bookings] Builder lookup failed', builderError)
      return NextResponse.json({ error: 'Failed to verify builder profile' }, { status: 500 })
    }

    const builder = builderProfile as BuilderProfileRow | null

    if (!builder) {
      return NextResponse.json({ error: 'Builder profile not found' }, { status: 403 })
    }

    const { data: venue, error: venueError } = await supabase
      .from('venues')
      .select('id, venue_name, hourly_rate, minimum_hours, is_published')
      .eq('id', body.venueId)
      .maybeSingle()

    if (venueError) {
      console.error('[builder.venue-bookings] Venue lookup failed', venueError)
      return NextResponse.json({ error: 'Failed to load venue' }, { status: 500 })
    }

    const venueRow = venue as VenueLookupRow | null

    if (!venueRow || venueRow.is_published === false) {
      return NextResponse.json({ error: 'Venue not available' }, { status: 404 })
    }

    const durationHours = calculateDurationHours(body.requested_start_time, body.requested_end_time)
    const endTime = body.requested_end_time || `${String(Number(body.requested_start_time.split(':')[0]) + 2).padStart(2, '0')}:00`
    const quotedPrice = estimateBookingCost(venueRow.hourly_rate, venueRow.minimum_hours, durationHours)
    const expectedMin = body.min_attendees ?? body.expected_attendees
    const expectedMax = body.max_attendees ?? body.expected_attendees

    const { data: event, error: eventError } = await supabase
      .from('events')
      .insert({
        builder_id: builder.id,
        event_name: `Booking request for ${venueRow.venue_name}`,
        event_type: 'other',
        event_description: body.notes || null,
        description: body.notes || null,
        event_date: body.requested_date,
        start_time: body.requested_start_time,
        end_time: endTime,
        event_time: body.requested_start_time,
        duration_hours: durationHours,
        status: 'venue_pending',
        expected_attendance: body.expected_attendees,
        expected_attendance_min: expectedMin,
        expected_attendance_max: expectedMax,
        venue_id: body.venueId,
        venue_confirmed: false,
        budget: quotedPrice,
        total_budget: quotedPrice,
      } as never)
      .select('id')
      .single()

    if (eventError) {
      console.error('[builder.venue-bookings] Event creation failed', eventError)
      return NextResponse.json({ error: 'Failed to create event request' }, { status: 500 })
    }

    const createdEvent = event as CreatedEventRow

    const { data: booking, error: bookingError } = await supabase
      .from('venue_bookings')
      .insert({
        venue_id: body.venueId,
        event_id: createdEvent.id,
        organizer_id: user.id,
        booking_date: body.requested_date,
        start_time: body.requested_start_time,
        end_time: endTime,
        guest_count_min: expectedMin,
        guest_count_max: expectedMax,
        status: 'pending',
        quoted_price: quotedPrice,
        subtotal: quotedPrice,
        total_amount: quotedPrice,
        payment_status: 'pending',
        special_requests: body.notes || null,
      } as never)
      .select('*')
      .single()

    if (bookingError) {
      console.error('[builder.venue-bookings] Booking creation failed', bookingError)
      await supabase.from('events').delete().eq('id', createdEvent.id)
      return NextResponse.json({ error: 'Failed to create booking request' }, { status: 500 })
    }

    return NextResponse.json({ event, booking }, { status: 201 })
  } catch (error) {
    console.error('[builder.venue-bookings] Unexpected POST error', error)
    return NextResponse.json({ error: 'Failed to create booking request' }, { status: 500 })
  }
}
