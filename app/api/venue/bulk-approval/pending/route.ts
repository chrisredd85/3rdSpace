export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  normalizeVenueBooking,
  VENUE_BOOKING_WITH_DETAILS_SELECT,
  type VenueBookingJoinRow,
} from '@/lib/bookings/venue-booking-adapter'

/**
 * Calculates whether a pending booking matches the venue's auto-approval rules.
 *
 * @param booking - Booking row with joined event and venue settings.
 * @returns Eligibility flag and explanation strings.
 */
function evaluateAutoApproval(booking: any) {
  const venue = booking.venues || {}
  const event = booking.events || {}
  const conditions = venue.auto_approve_conditions || {}
  const amount = Number(booking.final_price ?? booking.quoted_price ?? 0)
  const reasons: string[] = []

  if (!venue.bulk_approval_enabled) {
    return { eligible: false, reasons: ['Bulk approval is disabled'] }
  }

  if (venue.auto_approve_threshold != null && amount > Number(venue.auto_approve_threshold)) {
    reasons.push(`Cost is above $${Number(venue.auto_approve_threshold).toLocaleString()}`)
  }

  if (conditions.minNotice != null && event.event_date) {
    const eventDate = new Date(`${event.event_date}T00:00:00`)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const noticeDays = Math.floor((eventDate.getTime() - today.getTime()) / 86400000)
    if (noticeDays < Number(conditions.minNotice)) {
      reasons.push(`Less than ${conditions.minNotice} days notice`)
    }
  }

  const expectedAttendees =
    event.expected_attendees ??
    event.expected_attendance ??
    event.expected_attendance_min ??
    event.expected_attendance_max

  if (conditions.maxCapacity != null && expectedAttendees != null && Number(expectedAttendees) > Number(conditions.maxCapacity)) {
    reasons.push(`Guest count is above ${conditions.maxCapacity}`)
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  }
}

/**
 * Gets pending venue bookings for the bulk approval dashboard.
 *
 * @route GET /api/venue/bulk-approval/pending?venueId={id}
 * @auth Required - venue owner only.
 *
 * @param request - Request with optional venueId query parameter.
 * @returns Pending bookings with event, venue, builder, and auto-approval metadata.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const venueId = request.nextUrl.searchParams.get('venueId')
    const parsedVenueId = venueId ? z.string().uuid().safeParse(venueId) : null

    if (parsedVenueId && !parsedVenueId.success) {
      return NextResponse.json({ error: 'Invalid venue id' }, { status: 400 })
    }

    let venueIds: string[] = []

    if (parsedVenueId?.success) {
      const { data: venue, error: venueError } = await supabase
        .from('venues')
        .select('id, owner_id')
        .eq('id', parsedVenueId.data)
        .maybeSingle()

      if (venueError) {
        console.error('[bulk-approval.pending] Venue lookup failed', venueError)
        return NextResponse.json({ error: 'Failed to verify venue ownership' }, { status: 500 })
      }

      if (!venue) {
        return NextResponse.json({ error: 'Venue not found' }, { status: 404 })
      }

      if ((venue as { owner_id?: string }).owner_id !== user.id) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
      }

      venueIds = [parsedVenueId.data]
    } else {
      const { data: venues, error: venuesError } = await supabase
        .from('venues')
        .select('id')
        .eq('owner_id', user.id)

      if (venuesError) {
        console.error('[bulk-approval.pending] Venue list failed', venuesError)
        return NextResponse.json({ error: 'Failed to load venues' }, { status: 500 })
      }

      venueIds = ((venues as Array<{ id: string }> | null) ?? []).map((venue) => venue.id)
    }

    if (venueIds.length === 0) {
      return NextResponse.json({ bookings: [], count: 0 })
    }

    const { data: bookings, error } = await supabase
      .from('venue_bookings')
      .select(VENUE_BOOKING_WITH_DETAILS_SELECT)
      .in('venue_id', venueIds)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[bulk-approval.pending] Failed to load bookings', error)
      return NextResponse.json({ error: 'Failed to load pending bookings' }, { status: 500 })
    }

    const rows = ((bookings as VenueBookingJoinRow[] | null) ?? []).map((booking) =>
      normalizeVenueBooking({
        ...booking,
        auto_approval: evaluateAutoApproval(booking),
      })
    )

    return NextResponse.json({ bookings: rows, count: rows.length })
  } catch (error) {
    console.error('[bulk-approval.pending] Unexpected GET error', error)
    return NextResponse.json({ error: 'Failed to load pending bookings' }, { status: 500 })
  }
}
