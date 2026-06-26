export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  normalizeVendorBooking,
  VENDOR_BOOKING_WITH_DETAILS_SELECT,
  type VendorBookingJoinRow,
} from '@/lib/bookings/vendor-booking-adapter'

/**
 * Gets full details for a vendor booking owned by the signed-in vendor.
 *
 * @route GET /api/vendor/bookings/{id}/details
 * @auth Required - vendor owner only.
 *
 * @param request - Details request.
 * @param params - Booking id route params.
 * @returns Booking with event, venue, service, package, and vendor data.
 */
export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const parsedId = z.string().uuid().safeParse(params.id)
    if (!parsedId.success) {
      return NextResponse.json({ error: 'Invalid booking id' }, { status: 400 })
    }

    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: booking, error } = await supabase
      .from('vendor_bookings')
      .select(VENDOR_BOOKING_WITH_DETAILS_SELECT)
      .eq('id', parsedId.data)
      .maybeSingle()

    if (error) {
      console.error('[vendor.bookings.details] Detail lookup failed', error)
      return NextResponse.json({ error: 'Failed to load booking details' }, { status: 500 })
    }

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    const row = booking as { vendor_profiles?: { user_id?: string } }
    if (row.vendor_profiles?.user_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    return NextResponse.json({ booking: normalizeVendorBooking(booking as VendorBookingJoinRow) })
  } catch (error) {
    console.error('[vendor.bookings.details] Unexpected GET error', error)
    return NextResponse.json({ error: 'Failed to load booking details' }, { status: 500 })
  }
}
