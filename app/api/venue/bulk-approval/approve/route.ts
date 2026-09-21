export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  CanonicalBookingConfirmationError,
  hasCanonicalBookingProvenance,
} from '@/lib/planner/execution/canonicalBookingConfirmation'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const approveSchema = z.object({
  bookingIds: z.array(z.string().uuid()).min(1).max(100),
  message: z.string().trim().max(1000).nullable().optional(),
})

type TableWriter = Pick<ReturnType<typeof createServiceRoleClient>, 'from'>

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
async function notifyBuilders(supabase: TableWriter, bookings: any[], message?: string | null) {
  const notifications = bookings
    .filter((booking) => booking.events?.builder_profiles?.user_id)
    .map((booking) => ({
      user_id: booking.events.builder_profiles.user_id,
      notification_type: 'booking_confirmed',
      title: 'Venue booking confirmed',
      message: message || `Your booking request for ${booking.events?.event_name || 'your event'} has been approved.`,
      link_url: '/planner/experiences',
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
  supabase: TableWriter,
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

  if (rows.length === 0) return

  const { error } = await supabase.from('venue_booking_approval_audit').insert(rows as never)
  if (error) {
    console.error('[bulk-approval.approve] Audit insert failed', error)
  }
}

type CanonicalBatchError = {
  code?: string
  message?: string
  details?: string
  hint?: string
}

function canonicalBatchErrorResponse(error: CanonicalBatchError) {
  const detail = [error.message, error.details, error.hint].filter(Boolean).join(' ')
  if (error.code === '42501') {
    return NextResponse.json({ error: 'Not authorized to approve one or more bookings' }, { status: 403 })
  }
  if (error.code === 'P0002') {
    return NextResponse.json(
      { error: 'One or more bookings changed or no longer exist. Refresh and try again.' },
      { status: 404 },
    )
  }
  if (error.code === '22023') {
    return NextResponse.json({ error: 'Invalid canonical booking batch' }, { status: 400 })
  }
  if (['23514', '40001', '40P01'].includes(error.code ?? '') || /invalid_state|mismatch|provenance|deadlock/i.test(detail)) {
    return NextResponse.json(
      { error: 'A canonical booking changed before confirmation. Refresh and review the batch.' },
      { status: 409 },
    )
  }
  console.error('[bulk-approval.approve] Canonical batch command failed', error)
  return NextResponse.json({ error: 'Failed to approve canonical bookings' }, { status: 500 })
}

type CanonicalBatchConfirmation = {
  bookings: any[]
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readCanonicalBatchConfirmation(
  data: unknown,
  expectedBookings: any[],
): CanonicalBatchConfirmation | null {
  const payload = readRecord(data)
  const results = payload?.results
  const bookings = payload?.bookings
  const expectedById = new Map(expectedBookings.map((booking) => [booking.id, booking]))
  if (
    !payload || payload.status !== 'complete' ||
    payload.requested_count !== expectedBookings.length ||
    payload.confirmed_count !== expectedBookings.length ||
    !Number.isInteger(payload.existing_count) ||
    !Array.isArray(results) || results.length !== expectedBookings.length ||
    !Array.isArray(bookings) || bookings.length !== expectedBookings.length ||
    expectedById.size !== expectedBookings.length
  ) {
    return null
  }

  const resultIds = new Set<string>()
  let existingCount = 0
  for (const value of results) {
    const result = readRecord(value)
    const bookingId = typeof result?.booking_id === 'string' ? result.booking_id : null
    const expected = bookingId ? expectedById.get(bookingId) : null
    if (
      !result || !bookingId || !expected || resultIds.has(bookingId) ||
      typeof result.existing !== 'boolean' ||
      result.booking_kind !== 'venue' ||
      result.booking_status !== 'confirmed' ||
      result.action_status !== 'complete' ||
      result.plan_id !== expected.plan_id ||
      result.event_id !== expected.event_id
    ) {
      return null
    }
    resultIds.add(bookingId)
    if (result.existing) existingCount += 1
  }

  const bookingIds = new Set<string>()
  for (const value of bookings) {
    const booking = readRecord(value)
    const bookingId = typeof booking?.id === 'string' ? booking.id : null
    const expected = bookingId ? expectedById.get(bookingId) : null
    if (
      !booking || !bookingId || !expected || bookingIds.has(bookingId) ||
      booking.status !== 'confirmed' ||
      booking.plan_id !== expected.plan_id ||
      booking.event_id !== expected.event_id ||
      booking.agent_action_id !== expected.agent_action_id ||
      booking.approval_id !== expected.approval_id ||
      booking.venue_id !== expected.venue_id
    ) {
      return null
    }
    bookingIds.add(bookingId)
  }

  if (
    resultIds.size !== expectedById.size ||
    bookingIds.size !== expectedById.size ||
    existingCount !== payload.existing_count
  ) {
    return null
  }

  return { bookings }
}

async function ensureCanonicalConfirmationEffects(
  writeDb: ReturnType<typeof createServiceRoleClient>,
  bookingIds: string[],
  actorId: string,
  message?: string | null,
) {
  const { data, error } = await writeDb.rpc('ensure_canonical_venue_confirmation_effects', {
    p_booking_ids: bookingIds,
    p_actor_id: actorId,
    p_message: message ?? undefined,
  })
  if (error) return { ok: false as const, error }

  const payload = readRecord(data)
  const results = payload?.results
  const expectedIds = new Set(bookingIds)
  const resultIds = new Set<string>()
  if (
    !payload || payload.status !== 'complete' ||
    payload.requested_count !== bookingIds.length ||
    !Number.isInteger(payload.effected_count) ||
    !Number.isInteger(payload.existing_count) ||
    !Number.isInteger(payload.skipped_count) ||
    !Array.isArray(results) || results.length !== bookingIds.length
  ) {
    return { ok: false as const, error: { message: 'Canonical confirmation effects returned incomplete evidence' } }
  }

  for (const value of results) {
    const result = readRecord(value)
    const bookingId = typeof result?.booking_id === 'string' ? result.booking_id : null
    if (!bookingId || !expectedIds.has(bookingId) || resultIds.has(bookingId)) {
      return { ok: false as const, error: { message: 'Canonical confirmation effects returned mismatched evidence' } }
    }
    resultIds.add(bookingId)
  }
  if (resultIds.size !== expectedIds.size) {
    return { ok: false as const, error: { message: 'Canonical confirmation effects omitted a booking' } }
  }
  return { ok: true as const, data: payload }
}

function canonicalEffectsPendingResponse(input: {
  bookingIds: string[]
  approved: any[]
  skipped: Array<{ id: string; reason: string }>
}) {
  return NextResponse.json({
    error: 'Canonical bookings are confirmed, but notification and audit reconciliation must be retried.',
    confirmationState: 'confirmed_effects_pending',
    retryable: true,
    approved: input.approved.length,
    approvedBookingIds: input.approved.map((booking) => booking.id),
    confirmedBookingIds: input.bookingIds,
    skipped: input.skipped,
    bookings: input.approved,
  }, { status: 207 })
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
    const confirmedCanonicalBookings = context.bookings.filter((booking) =>
      booking.status === 'confirmed' && hasCanonicalBookingProvenance(booking)
    )
    const skipped = context.bookings
      .filter((booking) => booking.status !== 'pending')
      .map((booking) => ({ id: booking.id, reason: `Booking is ${booking.status}` }))

    if (pendingBookings.length === 0) {
      if (confirmedCanonicalBookings.length > 0) {
        const writeDb = createServiceRoleClient()
        const confirmedBookingIds = confirmedCanonicalBookings.map((booking) => booking.id)
        const effects = await ensureCanonicalConfirmationEffects(
          writeDb,
          confirmedBookingIds,
          context.userId,
          message,
        )
        if (!effects.ok) {
          console.error('[bulk-approval.approve] Canonical effect replay failed', effects.error)
          return canonicalEffectsPendingResponse({ bookingIds: confirmedBookingIds, approved: [], skipped })
        }
      }
      return NextResponse.json({ approved: 0, skipped, bookings: [] })
    }
    const writeDb = createServiceRoleClient()
    let approved: any[] = []
    const legacyEffectBookings: any[] = []
    let canonicalBookings: any[] = []
    let legacyBookings: any[] = []
    try {
      canonicalBookings = pendingBookings.filter((booking) => hasCanonicalBookingProvenance(booking))
      const canonicalIds = new Set(canonicalBookings.map((booking) => booking.id))
      legacyBookings = pendingBookings.filter((booking) => !canonicalIds.has(booking.id))

      if (canonicalBookings.length > 0) {
        const canonicalBookingIds = canonicalBookings.map((booking) => booking.id)
        const { data, error } = await writeDb.rpc('confirm_canonical_venue_bookings_batch', {
          p_booking_ids: canonicalBookingIds,
          p_actor_id: context.userId,
          p_confirmation_context: {
            source: 'venue_bulk_approval_route',
            route_confirmed: true,
            host_message: message ?? null,
          },
        })
        if (error) return canonicalBatchErrorResponse(error)

        const effects = await ensureCanonicalConfirmationEffects(
          writeDb,
          canonicalBookingIds,
          context.userId,
          message,
        )
        if (!effects.ok) {
          console.error('[bulk-approval.approve] Canonical confirmation effect reconciliation failed', effects.error)
          return canonicalEffectsPendingResponse({
            bookingIds: canonicalBookingIds,
            approved: canonicalBookings.map((booking) => ({ ...booking, status: 'confirmed' })),
            skipped,
          })
        }

        const confirmation = readCanonicalBatchConfirmation(data, canonicalBookings)
        if (!confirmation) {
          // The database command succeeded atomically, so all requested rows
          // are confirmed. Without exact per-row `existing` provenance, route
          // side effects must stop instead of guessing which confirmation was
          // newly performed by this invocation.
          return NextResponse.json({
            error: 'Canonical bookings were confirmed, but booking details require a refresh.',
            confirmationState: 'confirmed_response_incomplete',
            approved: canonicalBookingIds.length,
            approvedBookingIds: canonicalBookingIds,
            skipped,
            bookings: [],
          }, { status: 207 })
        }
        approved.push(...confirmation.bookings)
      }

      if (legacyBookings.length > 0) {
        const { data, error } = await context.supabase
          .from('venue_bookings')
          .update({
            status: 'confirmed',
            approved_at: new Date().toISOString(),
            approval_source: 'bulk',
            rejection_reason: null,
            updated_at: new Date().toISOString(),
          } as never)
          .in('id', legacyBookings.map((booking) => booking.id))
          .select('*')
        if (error) {
          if (canonicalBookings.length > 0) {
            return NextResponse.json({
              error: 'Canonical bookings were confirmed, but legacy bookings could not be approved.',
              confirmationState: 'partial',
              approved: approved.length,
              approvedBookingIds: approved.map((booking) => booking.id),
              skipped,
              failed: legacyBookings.map((booking) => ({
                id: booking.id,
                reason: 'Legacy booking confirmation failed',
              })),
              bookings: approved,
            }, { status: 207 })
          }
          throw error
        }
        approved.push(...(data ?? []))
        legacyEffectBookings.push(...legacyBookings)
      }
    } catch (confirmationError) {
      if (confirmationError instanceof CanonicalBookingConfirmationError) {
        return NextResponse.json({ error: confirmationError.message }, { status: confirmationError.status })
      }
      console.error('[bulk-approval.approve] Failed to approve bookings', confirmationError)
      return NextResponse.json({ error: 'Failed to approve bookings' }, { status: 500 })
    }

    await notifyBuilders(context.supabase, legacyEffectBookings, message)
    await auditApprovals(writeDb, legacyEffectBookings, context.userId, message)

    return NextResponse.json({
      approved: approved.length,
      skipped,
      bookings: approved,
    })
  } catch (error) {
    console.error('[bulk-approval.approve] Unexpected POST error', error)
    return NextResponse.json({ error: 'Failed to approve bookings' }, { status: 500 })
  }
}
