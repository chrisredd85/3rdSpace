export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  normalizeVendorBooking,
  VENDOR_BOOKING_WITH_DETAILS_SELECT,
  type VendorBookingJoinRow,
} from '@/lib/bookings/vendor-booking-adapter'

const rejectBookingSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
})

/**
 * Rejects a vendor booking request.
 *
 * @route POST /api/vendor/bookings/{id}/reject
 * @auth Required - vendor owner only.
 *
 * @param request - Rejection request with optional reason.
 * @param params - Booking id route params.
 * @returns Updated booking row.
 */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const parsedId = z.string().uuid().safeParse(params.id)
    if (!parsedId.success) {
      return NextResponse.json({ error: 'Invalid booking id' }, { status: 400 })
    }

    const parsedBody = rejectBookingSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid rejection payload', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: booking, error: bookingError } = await supabase
      .from('vendor_bookings')
      .select('id, vendor_profiles!inner(user_id)')
      .eq('id', parsedId.data)
      .maybeSingle()

    if (bookingError) {
      console.error('[vendor.bookings.reject] Booking lookup failed', bookingError)
      return NextResponse.json({ error: 'Failed to verify booking' }, { status: 500 })
    }

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    const row = booking as { vendor_profiles?: { user_id?: string } }
    if (row.vendor_profiles?.user_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const reason = parsedBody.data.reason || null
    const { data: updated, error: updateError } = await supabase
      .from('vendor_bookings')
      .update({
        status: 'declined',
        decline_reason: reason,
        notes: reason,
        responded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', parsedId.data)
      .select(VENDOR_BOOKING_WITH_DETAILS_SELECT)
      .single()

    if (updateError) {
      console.error('[vendor.bookings.reject] Booking rejection failed', updateError)
      return NextResponse.json({ error: 'Failed to reject booking' }, { status: 500 })
    }

    return NextResponse.json({ booking: normalizeVendorBooking(updated as VendorBookingJoinRow) })
  } catch (error) {
    console.error('[vendor.bookings.reject] Unexpected POST error', error)
    return NextResponse.json({ error: 'Failed to reject booking' }, { status: 500 })
  }
}
