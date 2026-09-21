jest.mock('server-only', () => ({}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => {
      const headers = new Headers(init?.headers)
      headers.set('content-type', 'application/json')
      return new Response(JSON.stringify(data), {
        ...init,
        status: init?.status ?? 200,
        headers,
      })
    },
  },
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/invoices/vendor-invoices', () => ({
  ensureInvoiceForBooking: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/bookings/vendor-booking-adapter', () => ({
  normalizeVendorBooking: (booking: unknown) => booking,
  VENDOR_BOOKING_WITH_DETAILS_SELECT: '*',
}))

jest.mock('@/lib/bookings/venue-booking-adapter', () => ({
  normalizeVenueBooking: (booking: unknown) => booking,
  toVenueBookingUpdate: () => ({}),
  VENUE_BOOKING_WITH_DETAILS_SELECT: '*',
}))

import type { NextRequest } from 'next/server'
import { POST as rejectVendorBooking } from '@/app/api/vendor/bookings/[id]/reject/route'
import { PATCH as updateVendorBooking } from '@/app/api/vendor/bookings/[id]/route'
import { PATCH as updateVenueBooking } from '@/app/api/venue/bookings/[id]/route'
import { POST as bulkRejectVenueBookings } from '@/app/api/venue/bulk-approval/reject/route'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const BOOKING_ID = '550e8400-e29b-41d4-a716-446655440000'
const PLAN_ID = '550e8400-e29b-41d4-a716-446655440001'
const ACTION_ID = '550e8400-e29b-41d4-a716-446655440002'
const APPROVAL_ID = '550e8400-e29b-41d4-a716-446655440003'
const PARTNER_USER_ID = '550e8400-e29b-41d4-a716-446655440004'

type Row = Record<string, any>

const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock

function makeQuery(
  source: Row | Row[] | null,
  options: {
    updateSpy?: jest.Mock
    insertSpy?: jest.Mock
    error?: Row | null
  } = {},
) {
  const rows = Array.isArray(source) ? source : source ? [source] : []
  const query: Record<string, jest.Mock> = {}
  query.select = jest.fn(() => query)
  query.eq = jest.fn(() => query)
  query.in = jest.fn(() => query)
  query.update = jest.fn((payload: unknown) => {
    options.updateSpy?.(payload)
    return query
  })
  query.insert = jest.fn((payload: unknown) => {
    options.insertSpy?.(payload)
    return Promise.resolve({ data: null, error: options.error ?? null })
  })
  query.maybeSingle = jest.fn(async () => ({ data: rows[0] ?? null, error: options.error ?? null }))
  query.single = jest.fn(async () => ({ data: rows[0] ?? null, error: options.error ?? null }))
  query.then = jest.fn((resolve: (value: unknown) => unknown) => Promise.resolve(resolve({
    data: rows,
    error: options.error ?? null,
  })))
  return query
}

function request(path: string, body: Row, method = 'POST') {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

function declineResult(kind: 'venue' | 'vendor', bookings: Row[], reason = 'Unavailable') {
  return {
    status: 'complete',
    booking_kind: kind,
    requested_count: bookings.length,
    declined_count: bookings.length,
    existing_count: 0,
    reason,
    results: bookings.map((booking) => ({ booking_id: booking.id, existing: false })),
    bookings: bookings.map((booking) => ({ ...booking, status: 'declined' })),
  }
}

function canonicalVendorBooking(overrides: Row = {}) {
  return {
    id: BOOKING_ID,
    status: 'pending',
    requested_date: '2026-08-10',
    plan_id: PLAN_ID,
    agent_action_id: ACTION_ID,
    approval_id: APPROVAL_ID,
    vendor_profiles: { user_id: PARTNER_USER_ID },
    ...overrides,
  }
}

function canonicalVenueBooking(overrides: Row = {}) {
  return {
    id: BOOKING_ID,
    event_id: '550e8400-e29b-41d4-a716-446655440005',
    venue_id: '550e8400-e29b-41d4-a716-446655440006',
    status: 'pending',
    plan_id: PLAN_ID,
    agent_action_id: ACTION_ID,
    approval_id: APPROVAL_ID,
    venues: { owner_id: PARTNER_USER_ID, venue_name: 'Foundry Rooftop' },
    events: null,
    ...overrides,
  }
}

describe('canonical partner decline routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('routes vendor reject through the canonical command without a session status update', async () => {
    const directUpdate = jest.fn()
    const booking = canonicalVendorBooking()
    const sessionQuery = makeQuery(booking, { updateSpy: directUpdate })
    const serviceQuery = makeQuery({ ...booking, status: 'declined' })
    const rpc = jest.fn().mockResolvedValue({
      data: declineResult('vendor', [booking]),
      error: null,
    })
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: jest.fn(() => sessionQuery),
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: jest.fn(() => serviceQuery) })

    const response = await rejectVendorBooking(
      request(`/api/vendor/bookings/${BOOKING_ID}/reject`, { reason: 'Unavailable' }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('decline_canonical_bookings', expect.objectContaining({
      p_booking_kind: 'vendor',
      p_booking_ids: [BOOKING_ID],
      p_actor_id: PARTNER_USER_ID,
      p_reason: 'Unavailable',
    }))
    expect(directUpdate).not.toHaveBeenCalled()
  })

  it('routes vendor detail decline through the same command and treats notes only as the decline reason', async () => {
    const directUpdate = jest.fn()
    const booking = canonicalVendorBooking()
    const sessionQuery = makeQuery(booking, { updateSpy: directUpdate })
    const serviceQuery = makeQuery({ ...booking, status: 'declined' })
    const rpc = jest.fn().mockResolvedValue({
      data: declineResult('vendor', [booking], 'Schedule conflict'),
      error: null,
    })
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: jest.fn(() => sessionQuery),
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: jest.fn(() => serviceQuery) })

    const response = await updateVendorBooking(
      request(`/api/vendor/bookings/${BOOKING_ID}`, { status: 'declined', notes: 'Schedule conflict' }, 'PATCH'),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('decline_canonical_bookings', expect.objectContaining({
      p_reason: 'Schedule conflict',
      p_decline_context: expect.objectContaining({ source: 'vendor_booking_detail_route' }),
    }))
    expect(directUpdate).not.toHaveBeenCalled()
  })

  it('routes venue decline through the command and suppresses legacy notification/thread writes', async () => {
    const directUpdate = jest.fn()
    const legacyInsert = jest.fn()
    const booking = canonicalVenueBooking()
    const sessionQuery = makeQuery(booking, { updateSpy: directUpdate, insertSpy: legacyInsert })
    const sessionFrom = jest.fn(() => sessionQuery)
    const serviceQuery = makeQuery({ ...booking, status: 'declined' })
    const rpc = jest.fn().mockResolvedValue({ data: declineResult('venue', [booking]), error: null })
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: PARTNER_USER_ID, user_metadata: { user_type: 'venue_owner' } } },
          error: null,
        }),
      },
      from: sessionFrom,
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: jest.fn(() => serviceQuery) })

    const response = await updateVenueBooking(
      request(`/api/venue/bookings/${BOOKING_ID}`, { status: 'declined', notes: 'Unavailable' }, 'PATCH'),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(directUpdate).not.toHaveBeenCalled()
    expect(legacyInsert).not.toHaveBeenCalled()
    expect(sessionFrom).toHaveBeenCalledTimes(1)
  })

  it('keeps the owned legacy venue detail decline on the session update path', async () => {
    const directUpdate = jest.fn()
    const legacy = canonicalVenueBooking({
      plan_id: null,
      agent_action_id: null,
      approval_id: null,
      quoted_price_cents: null,
      approved_terms_snapshot: null,
      events: null,
    })
    const sessionQuery = makeQuery(legacy, { updateSpy: directUpdate })
    const rpc = jest.fn()
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: PARTNER_USER_ID, user_metadata: { user_type: 'venue_owner' } } },
          error: null,
        }),
      },
      from: jest.fn(() => sessionQuery),
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: jest.fn() })

    const response = await updateVenueBooking(
      request(`/api/venue/bookings/${BOOKING_ID}`, { status: 'declined', notes: 'Unavailable' }, 'PATCH'),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(200)
    expect(directUpdate).toHaveBeenCalledTimes(1)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('also suppresses legacy post-writes after canonical venue confirmation replay', async () => {
    const legacyInsert = jest.fn()
    const booking = canonicalVenueBooking()
    const sessionQuery = makeQuery(booking, { insertSpy: legacyInsert })
    const sessionFrom = jest.fn(() => sessionQuery)
    const serviceQuery = makeQuery({ ...booking, status: 'confirmed' })
    const rpc = jest.fn().mockResolvedValue({ data: { existing: true }, error: null })
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: PARTNER_USER_ID, user_metadata: { user_type: 'venue_owner' } } },
          error: null,
        }),
      },
      from: sessionFrom,
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: jest.fn(() => serviceQuery) })

    const response = await updateVenueBooking(
      request(`/api/venue/bookings/${BOOKING_ID}`, { status: 'confirmed' }, 'PATCH'),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(200)
    expect(legacyInsert).not.toHaveBeenCalled()
    expect(sessionFrom).toHaveBeenCalledTimes(1)
  })

  it('declines a canonical venue batch through one atomic RPC', async () => {
    const directUpdate = jest.fn()
    const secondId = '550e8400-e29b-41d4-a716-446655440007'
    const first = canonicalVenueBooking()
    const second = canonicalVenueBooking({
      id: secondId,
      plan_id: '550e8400-e29b-41d4-a716-446655440008',
      agent_action_id: '550e8400-e29b-41d4-a716-446655440009',
      approval_id: '550e8400-e29b-41d4-a716-446655440010',
    })
    const sessionQuery = makeQuery([first, second], { updateSpy: directUpdate })
    const rpc = jest.fn().mockResolvedValue({ data: declineResult('venue', [first, second]), error: null })
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: jest.fn(() => sessionQuery),
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: jest.fn() })

    const response = await bulkRejectVenueBookings(
      request('/api/venue/bulk-approval/reject', { bookingIds: [BOOKING_ID, secondId], reason: 'Unavailable' }),
    )

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('decline_canonical_bookings', expect.objectContaining({
      p_booking_kind: 'venue',
      p_booking_ids: [BOOKING_ID, secondId],
    }))
    expect(directUpdate).not.toHaveBeenCalled()
  })

  it('preserves the legacy vendor rejection path when all provenance is absent', async () => {
    const directUpdate = jest.fn()
    const legacy = canonicalVendorBooking({ plan_id: null, agent_action_id: null, approval_id: null })
    const sessionQuery = makeQuery(legacy, { updateSpy: directUpdate })
    const rpc = jest.fn()
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: jest.fn(() => sessionQuery),
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: jest.fn() })

    const response = await rejectVendorBooking(
      request(`/api/vendor/bookings/${BOOKING_ID}/reject`, { reason: 'Unavailable' }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(200)
    expect(directUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'declined' }))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('preserves the owned legacy venue bulk rejection path when provenance is absent', async () => {
    const directUpdate = jest.fn()
    const legacy = canonicalVenueBooking({
      plan_id: null,
      agent_action_id: null,
      approval_id: null,
      quoted_price_cents: null,
      approved_terms_snapshot: null,
      events: null,
    })
    const bookingQuery = makeQuery(legacy, { updateSpy: directUpdate })
    const auditQuery = makeQuery(null)
    const rpc = jest.fn()
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: jest.fn(() => bookingQuery),
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: jest.fn(() => auditQuery) })

    const response = await bulkRejectVenueBookings(
      request('/api/venue/bulk-approval/reject', { bookingIds: [BOOKING_ID], reason: 'Unavailable' }),
    )

    expect(response.status).toBe(200)
    expect(directUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'declined' }))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects mixed canonical and legacy batches before either execution path runs', async () => {
    const legacyId = '550e8400-e29b-41d4-a716-446655440007'
    const canonical = canonicalVenueBooking()
    const legacy = canonicalVenueBooking({
      id: legacyId,
      plan_id: null,
      agent_action_id: null,
      approval_id: null,
    })
    const directUpdate = jest.fn()
    const lookupQuery = makeQuery([canonical, legacy], { updateSpy: directUpdate })
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: jest.fn(() => lookupQuery),
    })

    const response = await bulkRejectVenueBookings(
      request('/api/venue/bulk-approval/reject', {
        bookingIds: [BOOKING_ID, legacyId],
        reason: 'Unavailable',
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toEqual(expect.objectContaining({ code: 'mixed_booking_execution_modes' }))
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
    expect(directUpdate).not.toHaveBeenCalled()
  })

  it('keeps ownership authorization ahead of the service-only decline command', async () => {
    const booking = canonicalVenueBooking({
      venues: { owner_id: '550e8400-e29b-41d4-a716-446655440099' },
    })
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: jest.fn(() => makeQuery(booking)),
    })

    const response = await bulkRejectVenueBookings(
      request('/api/venue/bulk-approval/reject', { bookingIds: [BOOKING_ID], reason: 'Unavailable' }),
    )

    expect(response.status).toBe(403)
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
  })
})
