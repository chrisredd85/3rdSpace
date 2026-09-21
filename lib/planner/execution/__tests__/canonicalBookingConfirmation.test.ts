jest.mock('server-only', () => ({}))

import {
  CanonicalBookingConfirmationError,
  confirmCanonicalBookingIfLinked,
  hasCanonicalBookingProvenance,
} from '../canonicalBookingConfirmation'

const BOOKING_ID = '550e8400-e29b-41d4-a716-446655440000'
const PLAN_ID = '550e8400-e29b-41d4-a716-446655440001'
const ACTION_ID = '550e8400-e29b-41d4-a716-446655440002'
const APPROVAL_ID = '550e8400-e29b-41d4-a716-446655440003'
const ACTOR_ID = '550e8400-e29b-41d4-a716-446655440004'

describe('canonical booking confirmation boundary', () => {
  it('preserves the legacy route when all canonical provenance is absent', async () => {
    const rpc = jest.fn()

    await expect(confirmCanonicalBookingIfLinked({
      admin: { rpc },
      booking: { plan_id: null, agent_action_id: null, approval_id: null },
      bookingId: BOOKING_ID,
      bookingKind: 'venue',
      actorId: ACTOR_ID,
      source: 'test_route',
    })).resolves.toBe(false)

    expect(rpc).not.toHaveBeenCalled()
  })

  it('fails closed when only part of the canonical identity is present', () => {
    expect(() => hasCanonicalBookingProvenance({
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      approval_id: null,
    })).toThrow(CanonicalBookingConfirmationError)

    try {
      hasCanonicalBookingProvenance({ plan_id: PLAN_ID, agent_action_id: null, approval_id: null })
    } catch (error) {
      expect(error).toEqual(expect.objectContaining({ status: 409 }))
    }
  })

  it('confirms a fully linked booking through the atomic canonical command', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: { booking_status: 'confirmed' }, error: null })

    await expect(confirmCanonicalBookingIfLinked({
      admin: { rpc },
      booking: {
        plan_id: PLAN_ID,
        agent_action_id: ACTION_ID,
        approval_id: APPROVAL_ID,
      },
      bookingId: BOOKING_ID,
      bookingKind: 'vendor',
      actorId: ACTOR_ID,
      source: 'vendor_booking_approve_route',
    })).resolves.toBe(true)

    expect(rpc).toHaveBeenCalledWith('confirm_canonical_booking', {
      p_booking_kind: 'vendor',
      p_booking_id: BOOKING_ID,
      p_actor_id: ACTOR_ID,
      p_confirmation_context: {
        source: 'vendor_booking_approve_route',
        route_confirmed: true,
      },
    })
  })

  it('surfaces stale canonical state as an actionable conflict', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'canonical_booking_invalid_state' },
    })

    await expect(confirmCanonicalBookingIfLinked({
      admin: { rpc },
      booking: {
        plan_id: PLAN_ID,
        agent_action_id: ACTION_ID,
        approval_id: APPROVAL_ID,
      },
      bookingId: BOOKING_ID,
      bookingKind: 'venue',
      actorId: ACTOR_ID,
      source: 'venue_booking_detail_route',
    })).rejects.toEqual(expect.objectContaining({
      status: 409,
      message: expect.stringContaining('Refresh'),
    }))
  })

  it.each([
    ['42501', 403],
    ['P0002', 404],
    ['22023', 400],
    ['40001', 409],
    ['40P01', 409],
  ])('maps canonical confirmation database error %s to HTTP %i', async (code, status) => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { code, message: 'confirm_canonical_booking_test_error' },
    })

    await expect(confirmCanonicalBookingIfLinked({
      admin: { rpc },
      booking: {
        plan_id: PLAN_ID,
        agent_action_id: ACTION_ID,
        approval_id: APPROVAL_ID,
      },
      bookingId: BOOKING_ID,
      bookingKind: 'venue',
      actorId: ACTOR_ID,
      source: 'test_route',
    })).rejects.toEqual(expect.objectContaining({ status }))
  })
})
