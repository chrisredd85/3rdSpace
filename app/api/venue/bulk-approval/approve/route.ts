import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const approveSchema = z.object({
  bookingIds: z.array(z.string().uuid()).min(1).max(100),
  message: z.string().trim().max(1000).nullable().optional(),
})

/**
 * Loads bookings and verifies that they belong to venues owned by the user.
 *
 * @param bookingIds - Booking ids requested for batch action.
 * @returns Authenticated context or an HTTP error payload.
 */
async function loadAuthorizedBookings(bookingIds: string[]) {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { ok: false as const, status: 401, error: 'Unauthorized' }
  }

  const { data: bookings, error } = await supabase
    .from('venue_bookings')
    .select(`
      id,
      event_id,
      venue_id,
      status,
      venues!inner (
        id,
        owner_id,
        venue_name
      ),
      events (
        id,
        event_name,
        builder_id,
        builder_profiles!events_builder_id_fkey (
          id,
          user_id,
          name
        )
      )
    `)
    .in('id', bookingIds)

  if (error) {
    console.error('[bulk-approval.approve] Booking lookup failed', error)
    return { ok: false as const, status: 500, error: 'Failed to load bookings' }
  }

  const rows = (bookings as any[]) ?? []
  if (rows.length !== bookingIds.length) {
    return { ok: false as const, status: 404, error: 'One or more bookings were not found' }
  }

  const unauthorized = rows.filter((booking) => booking.venues?.owner_id !== user.id)
  if (unauthorized.length > 0) {
    return { ok: false as const, status: 403, error: `Not authorized to approve ${unauthorized.length} bookings` }
  }

  return { ok: true as const, supabase, userId: user.id, bookings: rows }
}

/**
 * Creates builder notifications after bulk approval.
 *
 * @param supabase - Authenticated Supabase client.
 * @param bookings - Approved bookings with joined event rows.
 * @param message - Optional venue owner note.
 */
async function notifyBuilders(supabase: ReturnType<typeof createClient>, bookings: any[], message?: string | null) {
  const notifications = bookings
    .filter((booking) => booking.events?.builder_profiles?.user_id)
    .map((booking) => ({
      user_id: booking.events.builder_profiles.user_id,
      notification_type: 'booking_confirmed',
      title: 'Venue booking confirmed',
      message: message || `Your booking request for ${booking.events?.event_name || 'your event'} has been approved.`,
      link_url: `/builder/event/${booking.event_id}`,
    }))

  if (notifications.length === 0) return

  const { error } = await supabase.from('notifications').insert(notifications as never)
  if (error) {
    console.error('[bulk-approval.approve] Notification insert failed', error)
  }
}

/**
 * Writes one audit row per approved booking.
 *
 * @param supabase - Authenticated Supabase client.
 * @param bookings - Authorized booking rows before update.
 * @param userId - Venue owner id performing the action.
 * @param message - Optional approval message.
 */
async function auditApprovals(
  supabase: ReturnType<typeof createClient>,
  bookings: any[],
  userId: string,
  message?: string | null
) {
  const rows = bookings.map((booking) => ({
    venue_id: booking.venue_id,
    booking_id: booking.id,
    actor_id: userId,
    action: 'bulk_approve',
    previous_status: booking.status,
    new_status: 'confirmed',
    message: message || null,
    metadata: {
      event_id: booking.event_id,
      venue_name: booking.venues?.venue_name || null,
    },
  }))

  const { error } = await supabase.from('venue_booking_approval_audit').insert(rows as never)
  if (error) {
    console.error('[bulk-approval.approve] Audit insert failed', error)
  }
}

/**
 * Approves multiple pending venue bookings in a single owner-only action.
 *
 * @route POST /api/venue/bulk-approval/approve
 * @auth Required - venue owner only.
 *
 * @param request - JSON body with bookingIds and optional message.
 * @returns Approval count and updated booking rows.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = approveSchema.safeParse(await request.json())

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid approval payload', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const { bookingIds, message } = parsedBody.data
    const context = await loadAuthorizedBookings(bookingIds)

    if (!context.ok) {
      return NextResponse.json({ error: context.error }, { status: context.status })
    }

    const pendingBookings = context.bookings.filter((booking) => booking.status === 'pending')
    const skipped = context.bookings
      .filter((booking) => booking.status !== 'pending')
      .map((booking) => ({ id: booking.id, reason: `Booking is ${booking.status}` }))

    if (pendingBookings.length === 0) {
      return NextResponse.json({ approved: 0, skipped, bookings: [] })
    }

    const { data: approved, error } = await context.supabase
      .from('venue_bookings')
      .update({
        status: 'confirmed',
        approved_at: new Date().toISOString(),
        approval_source: 'bulk',
        rejection_reason: null,
        updated_at: new Date().toISOString(),
      } as never)
      .in('id', pendingBookings.map((booking) => booking.id))
      .select('*')

    if (error) {
      console.error('[bulk-approval.approve] Failed to approve bookings', error)
      return NextResponse.json({ error: 'Failed to approve bookings' }, { status: 500 })
    }

    await notifyBuilders(context.supabase, pendingBookings, message)
    await auditApprovals(context.supabase, pendingBookings, context.userId, message)

    return NextResponse.json({
      approved: approved?.length || 0,
      skipped,
      bookings: approved || [],
    })
  } catch (error) {
    console.error('[bulk-approval.approve] Unexpected POST error', error)
    return NextResponse.json({ error: 'Failed to approve bookings' }, { status: 500 })
  }
}
