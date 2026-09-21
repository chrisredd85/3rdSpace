export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { ensureInvoiceForBooking } from '@/lib/invoices/vendor-invoices'
import {
  CanonicalBookingConfirmationError,
  confirmCanonicalBookingIfLinked,
} from '@/lib/planner/execution/canonicalBookingConfirmation'
import {
  normalizeVendorBooking,
  VENDOR_BOOKING_WITH_DETAILS_SELECT,
  type VendorBookingJoinRow,
} from '@/lib/bookings/vendor-booking-adapter'

/**
 * Approves a vendor booking request.
 *
 * Confirming a booking also fills the legacy booking_date/start_time fields so
 * the existing availability trigger can mark the date as booked.
 *
 * @route POST /api/vendor/bookings/{id}/approve
 * @auth Required - vendor owner only.
 *
 * @param request - Approval request.
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
      .select(`
        id,
        vendor_id,
        status,
        requested_date,
        requested_start_time,
        requested_end_time,
        booking_date,
        start_time,
        end_time,
        quoted_price,
        final_price,
        plan_id,
        agent_action_id,
        approval_id,
        vendor_profiles!inner(user_id)
      `)
      .eq('id', parsedId.data)
      .maybeSingle()

    if (bookingError) {
      console.error('[vendor.bookings.approve] Booking lookup failed', bookingError)
      return NextResponse.json({ error: 'Failed to verify booking' }, { status: 500 })
    }

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    const row = booking as {
      requested_date?: string | null
      requested_start_time?: string | null
      requested_end_time?: string | null
      booking_date?: string | null
      start_time?: string | null
      end_time?: string | null
      quoted_price?: number | null
      final_price?: number | null
      plan_id?: string | null
      agent_action_id?: string | null
      approval_id?: string | null
      vendor_profiles?: { user_id?: string }
    }

    if (row.vendor_profiles?.user_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const confirmedDate = row.requested_date || row.booking_date
    if (!confirmedDate) {
      return NextResponse.json({ error: 'Booking has no requested date' }, { status: 400 })
    }

    const admin = createServiceRoleClient()
    let updated: unknown
    let updateError: { message?: string } | null = null
    try {
      const canonicalConfirmed = await confirmCanonicalBookingIfLinked({
        admin,
        booking: row,
        bookingId: parsedId.data,
        bookingKind: 'vendor',
        actorId: user.id,
        source: 'vendor_booking_approve_route',
      })

      if (canonicalConfirmed) {
        const reload = await admin
          .from('vendor_bookings')
          .select(VENDOR_BOOKING_WITH_DETAILS_SELECT)
          .eq('id', parsedId.data)
          .single()
        updated = reload.data
        updateError = reload.error
      } else {
        const legacyUpdate = await supabase
          .from('vendor_bookings')
          .update({
            status: 'confirmed',
            confirmed_date: confirmedDate,
            confirmed_start_time: row.requested_start_time || row.start_time || null,
            confirmed_end_time: row.requested_end_time || row.end_time || null,
            booking_date: confirmedDate,
            start_time: row.requested_start_time || row.start_time || null,
            end_time: row.requested_end_time || row.end_time || null,
            final_price: row.final_price ?? row.quoted_price ?? null,
            responded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', parsedId.data)
          .select(VENDOR_BOOKING_WITH_DETAILS_SELECT)
          .single()
        updated = legacyUpdate.data
        updateError = legacyUpdate.error
      }
    } catch (confirmationError) {
      if (confirmationError instanceof CanonicalBookingConfirmationError) {
        return NextResponse.json({ error: confirmationError.message }, { status: confirmationError.status })
      }
      throw confirmationError
    }

    if (updateError) {
      console.error('[vendor.bookings.approve] Booking approval failed', updateError)
      return NextResponse.json({ error: updateError.message || 'Failed to approve booking' }, { status: 409 })
    }

    try {
      await ensureInvoiceForBooking({
        admin: admin as any,
        bookingId: parsedId.data,
        request,
      })
    } catch (invoiceError) {
      console.warn('[vendor.bookings.approve] Invoice auto-generation skipped', invoiceError)
    }

    return NextResponse.json({ booking: normalizeVendorBooking(updated as VendorBookingJoinRow) })
  } catch (error) {
    console.error('[vendor.bookings.approve] Unexpected POST error', error)
    return NextResponse.json({ error: 'Failed to approve booking' }, { status: 500 })
  }
}
