import 'server-only'

import {
  hasCanonicalBookingProvenance,
  type CanonicalBookingKind,
  type CanonicalBookingProvenance,
} from './canonicalBookingConfirmation'

type CanonicalBookingDeclineDb = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown
    error: { code?: string; message?: string; details?: string; hint?: string } | null
  }>
}

export type CanonicalBookingDeclineResult = {
  status: 'complete'
  booking_kind: CanonicalBookingKind
  requested_count: number
  declined_count: number
  existing_count: number
  reason: string
  results: Array<Record<string, unknown>>
  bookings: Array<Record<string, unknown> & { id: string }>
}

export class CanonicalBookingDeclineError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
  ) {
    super(message)
    this.name = 'CanonicalBookingDeclineError'
  }
}

function declineError(error: {
  code?: string
  message?: string
  details?: string
  hint?: string
}): CanonicalBookingDeclineError {
  const detail = [error.message, error.details, error.hint].filter(Boolean).join(' ')

  if (error.code === '42501') {
    return new CanonicalBookingDeclineError('You are not authorized to decline this booking.', 403)
  }
  if (error.code === 'P0002') {
    return new CanonicalBookingDeclineError('Canonical booking not found.', 404)
  }
  if (error.code === '22023') {
    return new CanonicalBookingDeclineError('Invalid canonical booking decline request.', 400)
  }
  if (
    ['23514', '40001', '40P01'].includes(error.code ?? '')
    || /invalid_(?:booking_)?state|mismatch|conflict|provenance|idempotency/i.test(detail)
  ) {
    return new CanonicalBookingDeclineError(
      'This canonical booking changed before decline. Refresh and review its current state.',
      409,
    )
  }

  return new CanonicalBookingDeclineError('Canonical booking decline failed.')
}

function parseDeclineResult(
  data: unknown,
  bookingKind: CanonicalBookingKind,
  bookingIds: string[],
): CanonicalBookingDeclineResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new CanonicalBookingDeclineError('Canonical booking decline returned an invalid result.')
  }

  const result = data as Partial<CanonicalBookingDeclineResult>
  const bookings = Array.isArray(result.bookings) ? result.bookings : []
  const returnedIds = new Set(
    bookings
      .map((booking) => booking && typeof booking === 'object' ? (booking as { id?: unknown }).id : null)
      .filter((id): id is string => typeof id === 'string'),
  )

  if (
    result.status !== 'complete'
    || result.booking_kind !== bookingKind
    || result.requested_count !== bookingIds.length
    || result.declined_count !== bookingIds.length
    || !Number.isInteger(result.existing_count)
    || !Array.isArray(result.results)
    || bookings.length !== bookingIds.length
    || bookingIds.some((id) => !returnedIds.has(id))
  ) {
    throw new CanonicalBookingDeclineError('Canonical booking decline returned an incomplete result.')
  }

  return result as CanonicalBookingDeclineResult
}

/**
 * Declines one or more canonical bookings through the service-only atomic
 * command. The database owns booking/action/audit/host-evidence consistency.
 */
export async function declineCanonicalBookings(input: {
  admin: unknown
  bookingKind: CanonicalBookingKind
  bookingIds: string[]
  actorId: string
  reason: string
  source: string
}): Promise<CanonicalBookingDeclineResult> {
  const distinctIds = new Set(input.bookingIds)
  if (
    input.bookingIds.length < 1
    || distinctIds.size !== input.bookingIds.length
    || input.reason.trim().length < 1
    || input.reason.trim().length > 1000
  ) {
    throw new CanonicalBookingDeclineError('Invalid canonical booking decline request.', 400)
  }

  const admin = input.admin as CanonicalBookingDeclineDb
  const { data, error } = await admin.rpc('decline_canonical_bookings', {
    p_booking_kind: input.bookingKind,
    p_booking_ids: input.bookingIds,
    p_actor_id: input.actorId,
    p_reason: input.reason.trim(),
    p_decline_context: {
      source: input.source,
      route_confirmed: true,
    },
  })

  if (error) throw declineError(error)
  return parseDeclineResult(data, input.bookingKind, input.bookingIds)
}

/** Returns false only for a fully legacy booking with no canonical lineage. */
export async function declineCanonicalBookingIfLinked(input: {
  admin: unknown
  booking: CanonicalBookingProvenance
  bookingId: string
  bookingKind: CanonicalBookingKind
  actorId: string
  reason: string
  source: string
}): Promise<CanonicalBookingDeclineResult | false> {
  if (!hasCanonicalBookingProvenance(input.booking)) return false
  return declineCanonicalBookings({
    admin: input.admin,
    bookingKind: input.bookingKind,
    bookingIds: [input.bookingId],
    actorId: input.actorId,
    reason: input.reason,
    source: input.source,
  })
}
