export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { ensureInvoiceForBooking } from '@/lib/invoices/vendor-invoices'
import {
  CanonicalBookingConfirmationError,
  confirmCanonicalBookingIfLinked,
  hasCanonicalBookingProvenance,
} from '@/lib/planner/execution/canonicalBookingConfirmation'
import {
  CanonicalBookingDeclineError,
  declineCanonicalBookings,
} from '@/lib/planner/execution/canonicalBookingDecline'
import {
  normalizeVendorBooking,
  VENDOR_BOOKING_WITH_DETAILS_SELECT,
  type VendorBookingJoinRow,
} from '@/lib/bookings/vendor-booking-adapter'

const updateVendorBookingSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'declined', 'cancelled']),
  confirmed_date: z.string().optional().nullable(),
  confirmed_start_time: z.string().optional().nullable(),
  confirmed_end_time: z.string().optional().nullable(),
  final_price: z.number().optional().nullable(),
  quoted_price: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
})

/**
 * Updates vendor booking status and confirmation details.
 *
 * The database trigger prevents double-booking and syncs vendor_availability
 * to tentative/booked/available as status changes.
 *
 * @route PATCH /api/vendor/bookings/{id}
 * @auth Required - vendor owner only.
 *
 * @param request - Booking status update payload.
 * @param params - Booking id route params.
 * @returns Updated vendor booking.
 */
export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const parsedId = z.string().uuid().safeParse(params.id)
    if (!parsedId.success) {
      return NextResponse.json({ error: 'Invalid booking id' }, { status: 400 })
    }

    const parsedBody = updateVendorBookingSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid booking payload', details: parsedBody.error.flatten() },
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
      .select('id, vendor_id, requested_date, requested_start_time, requested_end_time, booking_date, quoted_price, final_price, plan_id, agent_action_id, approval_id, vendor_profiles!inner(user_id)')
      .eq('id', parsedId.data)
      .maybeSingle()

    if (bookingError) {
      console.error('[vendor.bookings.detail] Booking lookup failed', bookingError)
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

    const body = parsedBody.data
    const confirmedDate = body.confirmed_date || row.requested_date || row.booking_date || null
    const confirmedStartTime = body.confirmed_start_time || row.requested_start_time || null
    const confirmedEndTime = body.confirmed_end_time || row.requested_end_time || null

    const updates: Record<string, unknown> = {
      status: body.status,
      updated_at: new Date().toISOString(),
      responded_at: body.status === 'confirmed' || body.status === 'declined' ? new Date().toISOString() : undefined,
    }

    if (body.status === 'confirmed') {
      updates.confirmed_date = confirmedDate
      updates.confirmed_start_time = confirmedStartTime
      updates.confirmed_end_time = confirmedEndTime
      updates.booking_date = confirmedDate
      updates.start_time = confirmedStartTime
      updates.end_time = confirmedEndTime
    }

    if (body.status === 'declined') {
      updates.decline_reason = body.notes || null
    }

    if (body.final_price !== undefined) updates.final_price = body.final_price
    if (body.quoted_price !== undefined) updates.quoted_price = body.quoted_price
    if (body.notes !== undefined) updates.notes = body.notes

    Object.keys(updates).forEach((key) => updates[key] === undefined && delete updates[key])

    const admin = createServiceRoleClient()
    let updated: unknown
    let updateError: { message?: string } | null = null
    try {
      const canonical = hasCanonicalBookingProvenance(row)
      if (canonical) {
        if (
          body.confirmed_date !== undefined ||
          body.confirmed_start_time !== undefined ||
          body.confirmed_end_time !== undefined ||
          body.final_price !== undefined ||
          body.quoted_price !== undefined ||
          (body.notes !== undefined && body.status !== 'declined')
        ) {
          return NextResponse.json(
            { error: 'Canonical booking terms cannot change during a partner response. Request a new approval version.' },
            { status: 409 },
          )
        }

        if (body.status !== 'confirmed' && body.status !== 'declined') {
          return NextResponse.json(
            {
              error: 'Canonical booking status changes require the approval workflow. Refresh before continuing.',
              code: 'canonical_booking_status_transition_required',
            },
            { status: 409 },
          )
        }

        if (body.status === 'declined') {
          await declineCanonicalBookings({
            admin,
            bookingKind: 'vendor',
            bookingIds: [parsedId.data],
            actorId: user.id,
            reason: body.notes?.trim() || 'Vendor declined without an additional reason.',
            source: 'vendor_booking_detail_route',
          })
        } else {
          await confirmCanonicalBookingIfLinked({
            admin,
            booking: row,
            bookingId: parsedId.data,
            bookingKind: 'vendor',
            actorId: user.id,
            source: 'vendor_booking_detail_route',
          })
        }
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
          .update(updates as never)
          .eq('id', parsedId.data)
          .select(VENDOR_BOOKING_WITH_DETAILS_SELECT)
          .single()
        updated = legacyUpdate.data
        updateError = legacyUpdate.error
      }
    } catch (canonicalError) {
      if (
        canonicalError instanceof CanonicalBookingConfirmationError
        || canonicalError instanceof CanonicalBookingDeclineError
      ) {
        return NextResponse.json({ error: canonicalError.message }, { status: canonicalError.status })
      }
      throw canonicalError
    }

    if (updateError) {
      console.error('[vendor.bookings.detail] Booking update failed', updateError)
      return NextResponse.json({ error: updateError.message || 'Failed to update booking' }, { status: 409 })
    }

    if (body.status === 'confirmed') {
      try {
        await ensureInvoiceForBooking({
          admin: admin as any,
          bookingId: parsedId.data,
          request,
        })
      } catch (invoiceError) {
        console.warn('[vendor.bookings.detail] Invoice auto-generation skipped', invoiceError)
      }
    }

    return NextResponse.json({ booking: normalizeVendorBooking(updated as VendorBookingJoinRow) })
  } catch (error) {
    console.error('[vendor.bookings.detail] Unexpected PATCH error', error)
    return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 })
  }
}
