export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  CanonicalBookingConfirmationError,
  hasCanonicalBookingProvenance,
} from '@/lib/planner/execution/canonicalBookingConfirmation'
import {
  CanonicalBookingDeclineError,
  declineCanonicalBookings,
} from '@/lib/planner/execution/canonicalBookingDecline'

const rejectSchema = z.object({
  bookingIds: z.array(z.string().uuid()).min(1).max(100).refine(
    (ids) => new Set(ids).size === ids.length,
    'Booking ids must be unique',
  ),
  reason: z.string().trim().min(1, 'Rejection reason required').max(1000),
})

/**
 * Loads bookings and verifies that they belong to venues owned by the user.
 *
 * @param bookingIds - Booking ids requested for batch rejection.
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
      plan_id,
      agent_action_id,
      approval_id,
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
    console.error('[bulk-approval.reject] Booking lookup failed', error)
    return { ok: false as const, status: 500, error: 'Failed to load bookings' }
  }

  const rows = (bookings as any[]) ?? []
  if (rows.length !== bookingIds.length) {
    return { ok: false as const, status: 404, error: 'One or more bookings were not found' }
  }

  const unauthorized = rows.filter((booking) => booking.venues?.owner_id !== user.id)
  if (unauthorized.length > 0) {
    return { ok: false as const, status: 403, error: `Not authorized to reject ${unauthorized.length} bookings` }
  }

  return { ok: true as const, supabase, userId: user.id, bookings: rows }
}

/**
 * Creates builder notifications after bulk rejection.
 *
 * @param supabase - Authenticated Supabase client.
 * @param bookings - Rejected bookings with joined event rows.
 * @param reason - Venue owner rejection reason.
 */
async function notifyBuilders(supabase: ReturnType<typeof createClient>, bookings: any[], reason: string) {
  const notifications = bookings
    .filter((booking) => booking.events?.builder_profiles?.user_id)
    .map((booking) => ({
      user_id: booking.events.builder_profiles.user_id,
      notification_type: 'booking_declined',
      title: 'Venue booking declined',
      message: reason,
      link_url: '/planner/experiences',
    }))

  if (notifications.length === 0) return

  const { error } = await supabase.from('notifications').insert(notifications as never)
  if (error) {
    console.error('[bulk-approval.reject] Notification insert failed', error)
  }
}

/**
 * Writes one audit row per rejected booking.
 *
 * @param supabase - Authenticated Supabase client.
 * @param bookings - Authorized booking rows before update.
 * @param userId - Venue owner id performing the action.
 * @param reason - Rejection reason.
 */
async function auditRejections(
  supabase: ReturnType<typeof createClient>,
  bookings: any[],
  userId: string,
  reason: string
) {
  const rows = bookings.map((booking) => ({
    venue_id: booking.venue_id,
    booking_id: booking.id,
    actor_id: userId,
    action: 'bulk_reject',
    previous_status: booking.status,
    new_status: 'declined',
    message: reason,
    metadata: {
      event_id: booking.event_id,
      venue_name: booking.venues?.venue_name || null,
    },
  }))

  const { error } = await supabase.from('venue_booking_approval_audit').insert(rows as never)
  if (error) {
    console.error('[bulk-approval.reject] Audit insert failed', error)
  }
}

/**
 * Rejects multiple pending venue bookings in a single owner-only action.
 *
 * @route POST /api/venue/bulk-approval/reject
 * @auth Required - venue owner only.
 *
 * @param request - JSON body with bookingIds and rejection reason.
 * @returns Rejection count and updated booking rows.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = rejectSchema.safeParse(await request.json())

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid rejection payload', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const { bookingIds, reason } = parsedBody.data
    const context = await loadAuthorizedBookings(bookingIds)

    if (!context.ok) {
      return NextResponse.json({ error: context.error }, { status: context.status })
    }

    let canonicalBookings: any[]
    let legacyBookings: any[]
    try {
      canonicalBookings = context.bookings.filter((booking) => hasCanonicalBookingProvenance(booking))
      legacyBookings = context.bookings.filter((booking) => !hasCanonicalBookingProvenance(booking))
    } catch (provenanceError) {
      if (provenanceError instanceof CanonicalBookingConfirmationError) {
        return NextResponse.json({ error: provenanceError.message }, { status: provenanceError.status })
      }
      throw provenanceError
    }

    const canonicalCandidates = canonicalBookings.filter(
      (booking) => booking.status === 'pending' || booking.status === 'declined',
    )
    const legacyPending = legacyBookings.filter((booking) => booking.status === 'pending')
    const skipped = [
      ...canonicalBookings
        .filter((booking) => booking.status !== 'pending' && booking.status !== 'declined')
        .map((booking) => ({ id: booking.id, reason: `Booking is ${booking.status}` })),
      ...legacyBookings
        .filter((booking) => booking.status !== 'pending')
        .map((booking) => ({ id: booking.id, reason: `Booking is ${booking.status}` })),
    ]

    if (canonicalCandidates.length === 0 && legacyPending.length === 0) {
      return NextResponse.json({ rejected: 0, skipped, bookings: [] })
    }

    if (canonicalCandidates.length > 0 && legacyPending.length > 0) {
      return NextResponse.json({
        error: 'Canonical and legacy bookings must be declined in separate bulk requests.',
        code: 'mixed_booking_execution_modes',
      }, { status: 409 })
    }

    const writeDb = createServiceRoleClient() as unknown as ReturnType<typeof createClient>

    // One RPC owns every canonical booking/action/audit/message mutation. Any
    // invalid canonical member rolls the whole canonical batch back before the
    // legacy path is attempted.
    if (canonicalCandidates.length > 0) {
      try {
        const result = await declineCanonicalBookings({
          admin: writeDb,
          bookingKind: 'venue',
          bookingIds: canonicalCandidates.map((booking) => booking.id),
          actorId: context.userId,
          reason,
          source: 'venue_bulk_rejection_route',
        })
        return NextResponse.json({
          rejected: result.bookings.length,
          skipped,
          bookings: result.bookings,
        })
      } catch (declineError) {
        if (declineError instanceof CanonicalBookingDeclineError) {
          return NextResponse.json({ error: declineError.message }, { status: declineError.status })
        }
        throw declineError
      }
    }

    const { data: legacyRejected, error } = await context.supabase
      .from('venue_bookings')
      .update({
        status: 'declined',
        rejection_reason: reason,
        approval_source: 'bulk',
        updated_at: new Date().toISOString(),
      } as never)
      .in('id', legacyPending.map((booking) => booking.id))
      .select('*')

    if (error) {
      console.error('[bulk-approval.reject] Failed to reject legacy bookings', error)
      return NextResponse.json({ error: 'Failed to reject bookings' }, { status: 500 })
    }

    const legacyRows = (legacyRejected as Array<Record<string, unknown>> | null) ?? []
    if (legacyRows.length !== legacyPending.length) {
      console.error('[bulk-approval.reject] Legacy rejection returned an incomplete booking set')
      return NextResponse.json({ error: 'Failed to reject all bookings' }, { status: 500 })
    }

    await notifyBuilders(context.supabase, legacyPending, reason)
    await auditRejections(writeDb, legacyPending, context.userId, reason)

    return NextResponse.json({
      rejected: legacyRows.length,
      skipped,
      bookings: legacyRows,
    })
  } catch (error) {
    console.error('[bulk-approval.reject] Unexpected POST error', error)
    return NextResponse.json({ error: 'Failed to reject bookings' }, { status: 500 })
  }
}
