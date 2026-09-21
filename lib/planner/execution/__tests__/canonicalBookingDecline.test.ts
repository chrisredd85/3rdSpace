jest.mock('server-only', () => ({}))

import {
  CanonicalBookingDeclineError,
  declineCanonicalBookingIfLinked,
  declineCanonicalBookings,
} from '../canonicalBookingDecline'

const BOOKING_ID = '550e8400-e29b-41d4-a716-446655440000'
const PLAN_ID = '550e8400-e29b-41d4-a716-446655440001'
const ACTION_ID = '550e8400-e29b-41d4-a716-446655440002'
const APPROVAL_ID = '550e8400-e29b-41d4-a716-446655440003'
const ACTOR_ID = '550e8400-e29b-41d4-a716-446655440004'

function completeResult(overrides: Record<string, unknown> = {}) {
  return {
    status: 'complete',
    booking_kind: 'venue',
    requested_count: 1,
    declined_count: 1,
    existing_count: 0,
    reason: 'Unavailable',
    results: [{ booking_id: BOOKING_ID, existing: false }],
    bookings: [{ id: BOOKING_ID, status: 'declined' }],
    ...overrides,
  }
}

describe('canonical booking decline boundary', () => {
  it('preserves the legacy path only when all canonical identity is absent', async () => {
    const rpc = jest.fn()

    await expect(declineCanonicalBookingIfLinked({
      admin: { rpc },
      booking: { plan_id: null, agent_action_id: null, approval_id: null },
      bookingId: BOOKING_ID,
      bookingKind: 'vendor',
      actorId: ACTOR_ID,
      reason: 'Unavailable',
      source: 'vendor_booking_reject_route',
    })).resolves.toBe(false)

    expect(rpc).not.toHaveBeenCalled()
  })

  it('uses one service command and validates the complete returned booking set', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: completeResult(), error: null })

    await expect(declineCanonicalBookings({
      admin: { rpc },
      bookingKind: 'venue',
      bookingIds: [BOOKING_ID],
      actorId: ACTOR_ID,
      reason: '  Unavailable  ',
      source: 'venue_booking_detail_route',
    })).resolves.toEqual(expect.objectContaining({ declined_count: 1 }))

    expect(rpc).toHaveBeenCalledWith('decline_canonical_bookings', {
      p_booking_kind: 'venue',
      p_booking_ids: [BOOKING_ID],
      p_actor_id: ACTOR_ID,
      p_reason: 'Unavailable',
      p_decline_context: {
        source: 'venue_booking_detail_route',
        route_confirmed: true,
      },
    })
  })

  it.each([
    ['42501', 403],
    ['P0002', 404],
    ['22023', 400],
    ['23514', 409],
    ['40001', 409],
    ['40P01', 409],
  ])('maps database error %s to HTTP %i', async (code, status) => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { code, message: 'decline_canonical_bookings_test_error' },
    })

    await expect(declineCanonicalBookings({
      admin: { rpc },
      bookingKind: 'venue',
      bookingIds: [BOOKING_ID],
      actorId: ACTOR_ID,
      reason: 'Unavailable',
      source: 'test_route',
    })).rejects.toEqual(expect.objectContaining({ status }))
  })

  it('fails closed on an incomplete command result', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: completeResult({ bookings: [] }),
      error: null,
    })

    await expect(declineCanonicalBookings({
      admin: { rpc },
      bookingKind: 'venue',
      bookingIds: [BOOKING_ID],
      actorId: ACTOR_ID,
      reason: 'Unavailable',
      source: 'test_route',
    })).rejects.toBeInstanceOf(CanonicalBookingDeclineError)
  })

  it('rejects duplicate ids before reaching the database', async () => {
    const rpc = jest.fn()

    await expect(declineCanonicalBookings({
      admin: { rpc },
      bookingKind: 'venue',
      bookingIds: [BOOKING_ID, BOOKING_ID],
      actorId: ACTOR_ID,
      reason: 'Unavailable',
      source: 'test_route',
    })).rejects.toEqual(expect.objectContaining({ status: 400 }))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('fails closed on partial canonical provenance', async () => {
    const rpc = jest.fn()

    await expect(declineCanonicalBookingIfLinked({
      admin: { rpc },
      booking: { plan_id: PLAN_ID, agent_action_id: ACTION_ID, approval_id: null },
      bookingId: BOOKING_ID,
      bookingKind: 'vendor',
      actorId: ACTOR_ID,
      reason: 'Unavailable',
      source: 'test_route',
    })).rejects.toEqual(expect.objectContaining({ status: 409 }))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('accepts complete canonical lineage for the linked single-booking path', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: completeResult({ booking_kind: 'vendor' }),
      error: null,
    })

    await expect(declineCanonicalBookingIfLinked({
      admin: { rpc },
      booking: { plan_id: PLAN_ID, agent_action_id: ACTION_ID, approval_id: APPROVAL_ID },
      bookingId: BOOKING_ID,
      bookingKind: 'vendor',
      actorId: ACTOR_ID,
      reason: 'Unavailable',
      source: 'test_route',
    })).resolves.toEqual(expect.objectContaining({ booking_kind: 'vendor' }))
  })
})
