export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

type BookingConflictRow = {
  id: string
  status: string | null
  booking_date?: string | null
  requested_date?: string | null
  confirmed_date?: string | null
}

/**
 * Resolves a vendor booking date.
 *
 * @param booking - Booking row.
 * @returns Date string or null.
 */
function getBookingDate(booking: BookingConflictRow) {
  if (booking.status === 'confirmed') {
    return booking.confirmed_date || booking.requested_date || booking.booking_date || null
  }
  return booking.requested_date || booking.booking_date || booking.confirmed_date || null
}

/**
 * Checks whether a vendor has a conflict on a date.
 *
 * @route GET /api/vendor/conflicts?vendorId={id}&date={YYYY-MM-DD}
 * @auth Public when vendorId/date are supplied.
 *
 * @param request - Conflict query.
 * @returns Conflict flag with availability and booking details.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    const vendorId = request.nextUrl.searchParams.get('vendorId')
    const date = request.nextUrl.searchParams.get('date')

    const parsedVendorId = z.string().uuid().safeParse(vendorId)
    const parsedDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(date)

    if (!parsedVendorId.success || !parsedDate.success) {
      return NextResponse.json({ error: 'vendorId and date are required' }, { status: 400 })
    }

    const { data: availability, error: availabilityError } = await supabase
      .from('vendor_availability')
      .select('*')
      .eq('vendor_id', parsedVendorId.data)
      .eq('date', parsedDate.data)
      .maybeSingle()

    if (availabilityError) {
      console.error('[vendor.conflicts] Availability lookup failed', availabilityError)
      return NextResponse.json({ error: 'Failed to check availability' }, { status: 500 })
    }

    const { data: bookings, error: bookingsError } = await supabase
      .from('vendor_bookings')
      .select('id, status, booking_date, requested_date, confirmed_date')
      .eq('vendor_id', parsedVendorId.data)
      .in('status', ['pending', 'confirmed'])

    if (bookingsError) {
      console.error('[vendor.conflicts] Booking lookup failed', bookingsError)
      return NextResponse.json({ error: 'Failed to check bookings' }, { status: 500 })
    }

    const bookingConflicts = ((bookings as BookingConflictRow[] | null) || [])
      .filter((booking) => getBookingDate(booking) === parsedDate.data)

    const availabilityStatus = (availability as { status?: string } | null)?.status
    const hasConflict =
      availabilityStatus === 'blocked' ||
      availabilityStatus === 'booked' ||
      bookingConflicts.some((booking) => booking.status === 'confirmed')

    return NextResponse.json({
      hasConflict,
      status: availabilityStatus || (bookingConflicts[0]?.status === 'confirmed' ? 'booked' : bookingConflicts[0]?.status === 'pending' ? 'tentative' : 'available'),
      availability,
      bookings: bookingConflicts,
    })
  } catch (error) {
    console.error('[vendor.conflicts] Unexpected GET error', error)
    return NextResponse.json({ error: 'Failed to check conflicts' }, { status: 500 })
  }
}
