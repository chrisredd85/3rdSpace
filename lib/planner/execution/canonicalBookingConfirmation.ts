import 'server-only'

export type CanonicalBookingKind = 'venue' | 'vendor'

export type CanonicalBookingProvenance = {
  plan_id?: string | null
  agent_action_id?: string | null
  approval_id?: string | null
}

type CanonicalBookingConfirmationDb = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown
    error: { code?: string; message?: string; details?: string; hint?: string } | null
  }>
}

export class CanonicalBookingConfirmationError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
  ) {
    super(message)
    this.name = 'CanonicalBookingConfirmationError'
  }
}

/**
 * Canonical quote bookings carry all three lineage fields. Legacy bookings
 * carry none. A partial identity is corruption and must never fall through to
 * the legacy direct-update path.
 */
export function hasCanonicalBookingProvenance(
  booking: CanonicalBookingProvenance,
): boolean {
  const values = [booking.plan_id, booking.agent_action_id, booking.approval_id]
  const populated = values.filter((value) => typeof value === 'string' && value.length > 0)
  if (populated.length === 0) return false
  if (populated.length !== values.length) {
    throw new CanonicalBookingConfirmationError(
      'Canonical booking identity is incomplete. Refresh before confirming this booking.',
      409,
    )
  }
  return true
}

/**
 * Confirms only provenance-linked bookings through the atomic canonical command.
 * Returning false tells the caller to preserve the existing legacy behavior.
 */
export async function confirmCanonicalBookingIfLinked(input: {
  admin: unknown
  booking: CanonicalBookingProvenance
  bookingId: string
  bookingKind: CanonicalBookingKind
  actorId: string
  source: string
}): Promise<boolean> {
  if (!hasCanonicalBookingProvenance(input.booking)) return false

  const admin = input.admin as CanonicalBookingConfirmationDb
  const { error } = await admin.rpc('confirm_canonical_booking', {
    p_booking_kind: input.bookingKind,
    p_booking_id: input.bookingId,
    p_actor_id: input.actorId,
    p_confirmation_context: {
      source: input.source,
      route_confirmed: true,
    },
  })
  if (!error) return true

  const detail = [error.message, error.details, error.hint].filter(Boolean).join(' ')
  if (error.code === '42501') {
    throw new CanonicalBookingConfirmationError(
      'You are not authorized to confirm this canonical booking.',
      403,
    )
  }
  if (error.code === 'P0002') {
    throw new CanonicalBookingConfirmationError('Canonical booking not found.', 404)
  }
  if (error.code === '22023') {
    throw new CanonicalBookingConfirmationError('Invalid canonical booking confirmation request.', 400)
  }

  const conflict = ['23514', '40001', '40P01'].includes(error.code ?? '')
    || /invalid_(?:booking_)?state|mismatch|conflict|provenance/i.test(detail)
  throw new CanonicalBookingConfirmationError(
    conflict
      ? 'This canonical booking changed before confirmation. Refresh and review its current state.'
      : 'Canonical booking confirmation failed.',
    conflict ? 409 : 500,
  )
}
