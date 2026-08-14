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
import { POST as approveVendorBooking } from '@/app/api/vendor/bookings/[id]/approve/route'
import { PATCH as updateVendorBooking } from '@/app/api/vendor/bookings/[id]/route'
import { PATCH as updateVenueBooking } from '@/app/api/venue/bookings/[id]/route'
import { POST as bulkApproveVenueBookings } from '@/app/api/venue/bulk-approval/approve/route'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const BOOKING_ID = '550e8400-e29b-41d4-a716-446655440000'
const PLAN_ID = '550e8400-e29b-41d4-a716-446655440001'
const ACTION_ID = '550e8400-e29b-41d4-a716-446655440002'
const APPROVAL_ID = '550e8400-e29b-41d4-a716-446655440003'
const PARTNER_USER_ID = '550e8400-e29b-41d4-a716-446655440004'

const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock

type Row = Record<string, any>

function makeQuery(
  source: Row | Row[] | null,
  updateSpy = jest.fn(),
  queryError: Row | null = null,
) {
  const rows = Array.isArray(source) ? source : source ? [source] : []
  const query: Record<string, jest.Mock> = {}
  query.select = jest.fn(() => query)
  query.eq = jest.fn(() => query)
  query.in = jest.fn(() => query)
  query.update = jest.fn((payload: unknown) => {
    updateSpy(payload)
    return query
  })
  query.insert = jest.fn(() => Promise.resolve({ data: null, error: queryError }))
  query.maybeSingle = jest.fn(async () => ({ data: rows[0] ?? null, error: queryError }))
  query.single = jest.fn(async () => ({ data: rows[0] ?? null, error: queryError }))
  query.then = jest.fn((resolve: (value: unknown) => unknown) => Promise.resolve(resolve({
    data: rows,
    error: queryError,
  })))
  return query
}

function request(path: string, body?: Row, method = body ? 'PATCH' : 'POST') {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as NextRequest
}

function canonicalBatchPayload(bookings: Row[], existingBookingIds: string[] = []) {
  const existingIds = new Set(existingBookingIds)
  const confirmedBookings = bookings.map((booking) => ({ ...booking, status: 'confirmed' }))
  return {
    status: 'complete',
    requested_count: bookings.length,
    confirmed_count: bookings.length,
    existing_count: existingIds.size,
    results: confirmedBookings.map((booking) => ({
      existing: existingIds.has(booking.id),
      booking_id: booking.id,
      booking_kind: 'venue',
      booking_status: 'confirmed',
      action_status: 'complete',
      plan_id: booking.plan_id,
      event_id: booking.event_id,
    })),
    bookings: confirmedBookings,
  }
}

function canonicalEffectPayload(bookings: Row[], existingBookingIds: string[] = []) {
  const existingIds = new Set(existingBookingIds)
  return {
    status: 'complete',
    requested_count: bookings.length,
    effected_count: bookings.length,
    existing_count: existingIds.size,
    skipped_count: 0,
    results: bookings.map((booking) => ({
      booking_id: booking.id,
      effect_status: existingIds.has(booking.id) ? 'existing' : 'created',
      notification_id: `notification-${booking.id}`,
      approval_audit_id: `audit-${booking.id}`,
    })),
  }
}

function canonicalBulkRpc(
  bookings: Row[],
  options: { existingBookingIds?: string[]; confirmation?: Row; effects?: Row } = {},
) {
  return jest.fn(async (name: string) => {
    if (name === 'confirm_canonical_venue_bookings_batch') {
      return {
        data: options.confirmation ?? canonicalBatchPayload(bookings, options.existingBookingIds),
        error: null,
      }
    }
    if (name === 'ensure_canonical_venue_confirmation_effects') {
      return {
        data: options.effects ?? canonicalEffectPayload(bookings, options.existingBookingIds),
        error: null,
      }
    }
    throw new Error(`Unexpected RPC ${name}`)
  })
}

describe('canonical partner confirmation routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('routes vendor approval through the canonical command without a direct status update', async () => {
    const directUpdate = jest.fn()
    const pendingBooking = {
      id: BOOKING_ID,
      status: 'pending',
      requested_date: '2026-08-10',
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      approval_id: APPROVAL_ID,
      vendor_profiles: { user_id: PARTNER_USER_ID },
    }
    const confirmedBooking = { ...pendingBooking, status: 'confirmed' }
    const sessionQuery = makeQuery(pendingBooking, directUpdate)
    const rpc = jest.fn().mockResolvedValue({ data: { booking_status: 'confirmed' }, error: null })
    const serviceQuery = makeQuery(confirmedBooking)
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: jest.fn(() => sessionQuery),
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: jest.fn(() => serviceQuery) })

    const response = await approveVendorBooking(
      request(`/api/vendor/bookings/${BOOKING_ID}/approve`),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('confirm_canonical_booking', expect.objectContaining({
      p_booking_kind: 'vendor',
      p_booking_id: BOOKING_ID,
      p_actor_id: PARTNER_USER_ID,
    }))
    expect(directUpdate).not.toHaveBeenCalled()
  })

  it('fails closed when transactional partner ownership changed after the route read', async () => {
    const directUpdate = jest.fn()
    const pendingBooking = {
      id: BOOKING_ID,
      status: 'pending',
      requested_date: '2026-08-10',
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      approval_id: APPROVAL_ID,
      vendor_profiles: { user_id: PARTNER_USER_ID },
    }
    const sessionQuery = makeQuery(pendingBooking, directUpdate)
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'confirm_canonical_booking_partner_mismatch' },
    })
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: jest.fn(() => sessionQuery),
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: jest.fn() })

    const response = await approveVendorBooking(
      request(`/api/vendor/bookings/${BOOKING_ID}/approve`),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(expect.objectContaining({
      error: expect.stringContaining('not authorized'),
    }))
    expect(directUpdate).not.toHaveBeenCalled()
  })

  it('routes venue confirmation through the canonical command without a direct status update', async () => {
    const directUpdate = jest.fn()
    const pendingBooking = {
      id: BOOKING_ID,
      event_id: '550e8400-e29b-41d4-a716-446655440005',
      venue_id: '550e8400-e29b-41d4-a716-446655440006',
      status: 'pending',
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      approval_id: APPROVAL_ID,
      venues: { owner_id: PARTNER_USER_ID },
    }
    const confirmedBooking = { ...pendingBooking, status: 'confirmed', events: null }
    const sessionQuery = makeQuery(pendingBooking, directUpdate)
    const rpc = jest.fn().mockResolvedValue({ data: { booking_status: 'confirmed' }, error: null })
    const serviceQuery = makeQuery(confirmedBooking)
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: PARTNER_USER_ID, user_metadata: { user_type: 'venue_owner' } } },
          error: null,
        }),
      },
      from: jest.fn(() => sessionQuery),
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: jest.fn(() => serviceQuery) })

    const response = await updateVenueBooking(
      request(`/api/venue/bookings/${BOOKING_ID}`, { status: 'confirmed' }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('confirm_canonical_booking', expect.objectContaining({
      p_booking_kind: 'venue',
      p_booking_id: BOOKING_ID,
      p_actor_id: PARTNER_USER_ID,
    }))
    expect(directUpdate).not.toHaveBeenCalled()
  })

  it('keeps the owned legacy venue detail confirmation on the session update path', async () => {
    const directUpdate = jest.fn()
    const legacyBooking = {
      id: BOOKING_ID,
      event_id: '550e8400-e29b-41d4-a716-446655440005',
      venue_id: '550e8400-e29b-41d4-a716-446655440006',
      status: 'pending',
      plan_id: null,
      agent_action_id: null,
      approval_id: null,
      quoted_price_cents: null,
      approved_terms_snapshot: null,
      venues: { owner_id: PARTNER_USER_ID },
      events: null,
    }
    const sessionQuery = makeQuery(legacyBooking, directUpdate)
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
      request(`/api/venue/bookings/${BOOKING_ID}`, { status: 'confirmed' }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(200)
    expect(directUpdate).toHaveBeenCalledTimes(1)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a wrong owner before the legacy venue detail update', async () => {
    const directUpdate = jest.fn()
    const legacyBooking = {
      id: BOOKING_ID,
      event_id: '550e8400-e29b-41d4-a716-446655440005',
      venue_id: '550e8400-e29b-41d4-a716-446655440006',
      status: 'pending',
      plan_id: null,
      agent_action_id: null,
      approval_id: null,
      venues: { owner_id: '550e8400-e29b-41d4-a716-446655440099' },
    }
    const sessionQuery = makeQuery(legacyBooking, directUpdate)
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: PARTNER_USER_ID, user_metadata: { user_type: 'venue_owner' } } },
          error: null,
        }),
      },
      from: jest.fn(() => sessionQuery),
    })

    const response = await updateVenueBooking(
      request(`/api/venue/bookings/${BOOKING_ID}`, { status: 'confirmed' }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(403)
    expect(directUpdate).not.toHaveBeenCalled()
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
  })

  it('routes the vendor detail confirmation path through the same canonical command', async () => {
    const directUpdate = jest.fn()
    const pendingBooking = {
      id: BOOKING_ID,
      status: 'pending',
      requested_date: '2026-08-10',
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      approval_id: APPROVAL_ID,
      vendor_profiles: { user_id: PARTNER_USER_ID },
    }
    const confirmedBooking = { ...pendingBooking, status: 'confirmed' }
    const sessionQuery = makeQuery(pendingBooking, directUpdate)
    const rpc = jest.fn().mockResolvedValue({ data: { booking_status: 'confirmed' }, error: null })
    const serviceQuery = makeQuery(confirmedBooking)
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: jest.fn(() => sessionQuery),
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: jest.fn(() => serviceQuery) })

    const response = await updateVendorBooking(
      request(`/api/vendor/bookings/${BOOKING_ID}`, { status: 'confirmed' }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('confirm_canonical_booking', expect.objectContaining({
      p_booking_kind: 'vendor',
      p_booking_id: BOOKING_ID,
      p_confirmation_context: expect.objectContaining({ source: 'vendor_booking_detail_route' }),
    }))
    expect(directUpdate).not.toHaveBeenCalled()
  })

  it('confirms every canonical bulk row through one atomic database command', async () => {
    const directUpdate = jest.fn()
    const secondBookingId = '550e8400-e29b-41d4-a716-446655440007'
    const pendingBooking = {
      id: BOOKING_ID,
      event_id: '550e8400-e29b-41d4-a716-446655440005',
      venue_id: '550e8400-e29b-41d4-a716-446655440006',
      status: 'pending',
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      approval_id: APPROVAL_ID,
      venues: { owner_id: PARTNER_USER_ID, venue_name: 'Foundry Rooftop' },
      events: null,
    }
    const secondPendingBooking = {
      ...pendingBooking,
      id: secondBookingId,
      event_id: '550e8400-e29b-41d4-a716-446655440008',
      plan_id: '550e8400-e29b-41d4-a716-446655440009',
      agent_action_id: '550e8400-e29b-41d4-a716-446655440010',
      approval_id: '550e8400-e29b-41d4-a716-446655440011',
    }
    const bookingQuery = makeQuery([pendingBooking, secondPendingBooking], directUpdate)
    const insertQuery = makeQuery(null)
    const rpc = canonicalBulkRpc([pendingBooking, secondPendingBooking])
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: jest.fn((table: string) => table === 'venue_bookings' ? bookingQuery : insertQuery),
    })
    mockCreateServiceRoleClient.mockReturnValue({
      rpc,
      from: jest.fn(() => insertQuery),
    })

    const response = await bulkApproveVenueBookings(
      request('/api/venue/bulk-approval/approve', { bookingIds: [BOOKING_ID, secondBookingId] }, 'POST'),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ approved: 2 }))
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenCalledWith('confirm_canonical_venue_bookings_batch', expect.objectContaining({
      p_booking_ids: [BOOKING_ID, secondBookingId],
      p_actor_id: PARTNER_USER_ID,
      p_confirmation_context: expect.objectContaining({ source: 'venue_bulk_approval_route' }),
    }))
    expect(rpc).toHaveBeenCalledWith('ensure_canonical_venue_confirmation_effects', {
      p_booking_ids: [BOOKING_ID, secondBookingId],
      p_actor_id: PARTNER_USER_ID,
      p_message: undefined,
    })
    expect(directUpdate).not.toHaveBeenCalled()
  })

  it('delegates new and replayed canonical route effects to the idempotent database command', async () => {
    const secondBookingId = '550e8400-e29b-41d4-a716-446655440007'
    const pendingBooking = {
      id: BOOKING_ID,
      event_id: '550e8400-e29b-41d4-a716-446655440005',
      venue_id: '550e8400-e29b-41d4-a716-446655440006',
      status: 'pending',
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      approval_id: APPROVAL_ID,
      venues: { owner_id: PARTNER_USER_ID, venue_name: 'Foundry Rooftop' },
      events: {
        event_name: 'Newly confirmed event',
        builder_profiles: { user_id: '550e8400-e29b-41d4-a716-446655440020' },
      },
    }
    const replayedBooking = {
      ...pendingBooking,
      id: secondBookingId,
      event_id: '550e8400-e29b-41d4-a716-446655440008',
      plan_id: '550e8400-e29b-41d4-a716-446655440009',
      agent_action_id: '550e8400-e29b-41d4-a716-446655440010',
      approval_id: '550e8400-e29b-41d4-a716-446655440011',
      events: {
        event_name: 'Concurrent replay event',
        builder_profiles: { user_id: '550e8400-e29b-41d4-a716-446655440021' },
      },
    }
    const notificationInsert = jest.fn().mockResolvedValue({ data: null, error: null })
    const auditInsert = jest.fn().mockResolvedValue({ data: null, error: null })
    const rpc = canonicalBulkRpc(
      [pendingBooking, replayedBooking],
      { existingBookingIds: [secondBookingId] },
    )
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: jest.fn((table: string) => table === 'venue_bookings'
        ? makeQuery([pendingBooking, replayedBooking])
        : { insert: notificationInsert }),
    })
    mockCreateServiceRoleClient.mockReturnValue({
      rpc,
      from: jest.fn(() => ({ insert: auditInsert })),
    })

    const response = await bulkApproveVenueBookings(
      request('/api/venue/bulk-approval/approve', { bookingIds: [BOOKING_ID, secondBookingId] }, 'POST'),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ approved: 2 }))
    expect(rpc).toHaveBeenCalledWith('ensure_canonical_venue_confirmation_effects', {
      p_booking_ids: [BOOKING_ID, secondBookingId],
      p_actor_id: PARTNER_USER_ID,
      p_message: undefined,
    })
    expect(notificationInsert).not.toHaveBeenCalled()
    expect(auditInsert).not.toHaveBeenCalled()
  })

  it('does not emit notifications or route audit rows for an all-existing canonical replay', async () => {
    const pendingBooking = {
      id: BOOKING_ID,
      event_id: '550e8400-e29b-41d4-a716-446655440005',
      venue_id: '550e8400-e29b-41d4-a716-446655440006',
      status: 'pending',
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      approval_id: APPROVAL_ID,
      venues: { owner_id: PARTNER_USER_ID, venue_name: 'Foundry Rooftop' },
      events: {
        event_name: 'Already confirmed event',
        builder_profiles: { user_id: '550e8400-e29b-41d4-a716-446655440020' },
      },
    }
    const sessionFrom = jest.fn(() => makeQuery(pendingBooking))
    const serviceFrom = jest.fn()
    const rpc = canonicalBulkRpc([pendingBooking], { existingBookingIds: [BOOKING_ID] })
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: sessionFrom,
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: serviceFrom })

    const response = await bulkApproveVenueBookings(
      request('/api/venue/bulk-approval/approve', { bookingIds: [BOOKING_ID] }, 'POST'),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ approved: 1 }))
    expect(sessionFrom).toHaveBeenCalledTimes(1)
    expect(serviceFrom).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('repairs canonical effects on replay after confirmation committed before effect reconciliation', async () => {
    const pendingBooking = {
      id: BOOKING_ID,
      event_id: '550e8400-e29b-41d4-a716-446655440005',
      venue_id: '550e8400-e29b-41d4-a716-446655440006',
      status: 'pending',
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      approval_id: APPROVAL_ID,
      venues: { owner_id: PARTNER_USER_ID, venue_name: 'Foundry Rooftop' },
      events: null,
    }
    const confirmedBooking = { ...pendingBooking, status: 'confirmed' }
    const firstRpc = jest.fn(async (name: string) => name === 'confirm_canonical_venue_bookings_batch'
      ? { data: canonicalBatchPayload([pendingBooking]), error: null }
      : { data: null, error: { code: '57014', message: 'worker terminated before effects' } })
    const replayRpc = jest.fn(async (name: string) => {
      if (name !== 'ensure_canonical_venue_confirmation_effects') {
        throw new Error(`Unexpected replay RPC ${name}`)
      }
      return { data: canonicalEffectPayload([confirmedBooking]), error: null }
    })

    mockCreateClient
      .mockReturnValueOnce({
        auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
        from: jest.fn(() => makeQuery(pendingBooking)),
      })
      .mockReturnValueOnce({
        auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
        from: jest.fn(() => makeQuery(confirmedBooking)),
      })
    mockCreateServiceRoleClient
      .mockReturnValueOnce({ rpc: firstRpc, from: jest.fn() })
      .mockReturnValueOnce({ rpc: replayRpc, from: jest.fn() })

    const first = await bulkApproveVenueBookings(
      request('/api/venue/bulk-approval/approve', { bookingIds: [BOOKING_ID] }, 'POST'),
    )
    expect(first.status).toBe(207)
    expect(await first.json()).toEqual(expect.objectContaining({
      confirmationState: 'confirmed_effects_pending',
      confirmedBookingIds: [BOOKING_ID],
      retryable: true,
    }))

    const replay = await bulkApproveVenueBookings(
      request('/api/venue/bulk-approval/approve', { bookingIds: [BOOKING_ID] }, 'POST'),
    )
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(expect.objectContaining({ approved: 0 }))
    expect(replayRpc).toHaveBeenCalledTimes(1)
    expect(replayRpc).toHaveBeenCalledWith('ensure_canonical_venue_confirmation_effects', {
      p_booking_ids: [BOOKING_ID],
      p_actor_id: PARTNER_USER_ID,
      p_message: undefined,
    })
  })

  it('fails closed without route effects when canonical replay provenance is incomplete', async () => {
    const pendingBooking = {
      id: BOOKING_ID,
      event_id: '550e8400-e29b-41d4-a716-446655440005',
      venue_id: '550e8400-e29b-41d4-a716-446655440006',
      status: 'pending',
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      approval_id: APPROVAL_ID,
      venues: { owner_id: PARTNER_USER_ID, venue_name: 'Foundry Rooftop' },
      events: null,
    }
    const incomplete = canonicalBatchPayload([pendingBooking])
    delete (incomplete.results[0] as Partial<Row>).existing
    const sessionFrom = jest.fn(() => makeQuery(pendingBooking))
    const serviceFrom = jest.fn()
    const rpc = canonicalBulkRpc([pendingBooking], { confirmation: incomplete })
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: sessionFrom,
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: serviceFrom })

    const response = await bulkApproveVenueBookings(
      request('/api/venue/bulk-approval/approve', { bookingIds: [BOOKING_ID] }, 'POST'),
    )

    expect(response.status).toBe(207)
    expect(await response.json()).toEqual(expect.objectContaining({
      confirmationState: 'confirmed_response_incomplete',
      bookings: [],
    }))
    expect(sessionFrom).toHaveBeenCalledTimes(1)
    expect(serviceFrom).not.toHaveBeenCalled()
  })

  it.each(['23514', '40P01'])('reports canonical batch conflict %s without attempting legacy direct updates', async (code) => {
    const directUpdate = jest.fn()
    const pendingBooking = {
      id: BOOKING_ID,
      event_id: '550e8400-e29b-41d4-a716-446655440005',
      venue_id: '550e8400-e29b-41d4-a716-446655440006',
      status: 'pending',
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      approval_id: APPROVAL_ID,
      venues: { owner_id: PARTNER_USER_ID, venue_name: 'Foundry Rooftop' },
      events: null,
    }
    const bookingQuery = makeQuery(pendingBooking, directUpdate)
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { code, message: code === '40P01' ? 'deadlock detected' : 'confirm_canonical_booking_invalid_state' },
    })
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: jest.fn(() => bookingQuery),
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: jest.fn() })

    const response = await bulkApproveVenueBookings(
      request('/api/venue/bulk-approval/approve', { bookingIds: [BOOKING_ID] }, 'POST'),
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({
      error: expect.stringContaining('changed before confirmation'),
    }))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(directUpdate).not.toHaveBeenCalled()
  })

  it('preserves the legacy bulk update path when canonical provenance is absent', async () => {
    const directUpdate = jest.fn()
    const legacyBooking = {
      id: BOOKING_ID,
      event_id: '550e8400-e29b-41d4-a716-446655440005',
      venue_id: '550e8400-e29b-41d4-a716-446655440006',
      status: 'pending',
      plan_id: null,
      agent_action_id: null,
      approval_id: null,
      venues: { owner_id: PARTNER_USER_ID, venue_name: 'Legacy Venue' },
      events: null,
    }
    const bookingQuery = makeQuery(legacyBooking, directUpdate)
    const insertQuery = makeQuery(null)
    const rpc = jest.fn()
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: jest.fn((table: string) => table === 'venue_bookings' ? bookingQuery : insertQuery),
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: jest.fn(() => insertQuery) })

    const response = await bulkApproveVenueBookings(
      request('/api/venue/bulk-approval/approve', { bookingIds: [BOOKING_ID] }, 'POST'),
    )

    expect(response.status).toBe(200)
    expect(directUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns truthful per-item state if legacy approval fails after a canonical batch commits', async () => {
    const legacyBookingId = '550e8400-e29b-41d4-a716-446655440007'
    const canonicalBooking = {
      id: BOOKING_ID,
      event_id: '550e8400-e29b-41d4-a716-446655440005',
      venue_id: '550e8400-e29b-41d4-a716-446655440006',
      status: 'pending',
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      approval_id: APPROVAL_ID,
      venues: { owner_id: PARTNER_USER_ID, venue_name: 'Canonical Venue' },
      events: null,
    }
    const legacyBooking = {
      ...canonicalBooking,
      id: legacyBookingId,
      plan_id: null,
      agent_action_id: null,
      approval_id: null,
      venues: { owner_id: PARTNER_USER_ID, venue_name: 'Legacy Venue' },
    }
    const initialQuery = makeQuery([canonicalBooking, legacyBooking])
    const failedLegacyUpdate = makeQuery(null, jest.fn(), { message: 'legacy update failed' })
    const insertQuery = makeQuery(null)
    const rpc = canonicalBulkRpc([canonicalBooking])
    const sessionFrom = jest.fn()
      .mockReturnValueOnce(initialQuery)
      .mockReturnValueOnce(failedLegacyUpdate)
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: sessionFrom,
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: jest.fn(() => insertQuery) })

    const response = await bulkApproveVenueBookings(
      request('/api/venue/bulk-approval/approve', { bookingIds: [BOOKING_ID, legacyBookingId] }, 'POST'),
    )
    const result = await response.json()

    expect(response.status).toBe(207)
    expect(result).toEqual(expect.objectContaining({
      confirmationState: 'partial',
      approved: 1,
      approvedBookingIds: [BOOKING_ID],
      failed: [{ id: legacyBookingId, reason: 'Legacy booking confirmation failed' }],
    }))
  })

  it('keeps ownership authorization ahead of the service-only batch command', async () => {
    const bookingQuery = makeQuery({
      id: BOOKING_ID,
      status: 'pending',
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      approval_id: APPROVAL_ID,
      venues: { owner_id: '550e8400-e29b-41d4-a716-446655440099' },
    })
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: jest.fn(() => bookingQuery),
    })

    const response = await bulkApproveVenueBookings(
      request('/api/venue/bulk-approval/approve', { bookingIds: [BOOKING_ID] }, 'POST'),
    )

    expect(response.status).toBe(403)
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
  })

  it('rejects a term mutation instead of bypassing re-approval', async () => {
    const pendingBooking = {
      id: BOOKING_ID,
      event_id: '550e8400-e29b-41d4-a716-446655440005',
      venue_id: '550e8400-e29b-41d4-a716-446655440006',
      status: 'pending',
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      approval_id: APPROVAL_ID,
      venues: { owner_id: PARTNER_USER_ID },
    }
    const sessionQuery = makeQuery(pendingBooking)
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
      request(`/api/venue/bookings/${BOOKING_ID}`, {
        status: 'confirmed',
        final_price: 150_000,
      }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({
      error: expect.stringContaining('new approval version'),
    }))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects canonical venue term edits even when status remains pending', async () => {
    const directUpdate = jest.fn()
    const pendingBooking = {
      id: BOOKING_ID,
      event_id: '550e8400-e29b-41d4-a716-446655440005',
      venue_id: '550e8400-e29b-41d4-a716-446655440006',
      status: 'pending',
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      approval_id: APPROVAL_ID,
      venues: { owner_id: PARTNER_USER_ID },
    }
    const sessionQuery = makeQuery(pendingBooking, directUpdate)
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
      request(`/api/venue/bookings/${BOOKING_ID}`, { status: 'pending', final_price: 1 }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(409)
    expect(directUpdate).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects canonical vendor term edits even when status remains pending', async () => {
    const directUpdate = jest.fn()
    const pendingBooking = {
      id: BOOKING_ID,
      status: 'pending',
      requested_date: '2026-08-10',
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      approval_id: APPROVAL_ID,
      vendor_profiles: { user_id: PARTNER_USER_ID },
    }
    const sessionQuery = makeQuery(pendingBooking, directUpdate)
    const rpc = jest.fn()
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: jest.fn(() => sessionQuery),
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: jest.fn() })

    const response = await updateVendorBooking(
      request(`/api/vendor/bookings/${BOOKING_ID}`, { status: 'pending', final_price: 1 }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(409)
    expect(directUpdate).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('fails closed on canonical partner cancellation instead of using the legacy update path', async () => {
    const directUpdate = jest.fn()
    const pendingBooking = {
      id: BOOKING_ID,
      status: 'pending',
      requested_date: '2026-08-10',
      plan_id: PLAN_ID,
      agent_action_id: ACTION_ID,
      approval_id: APPROVAL_ID,
      vendor_profiles: { user_id: PARTNER_USER_ID },
    }
    const sessionQuery = makeQuery(pendingBooking, directUpdate)
    const rpc = jest.fn()
    mockCreateClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: PARTNER_USER_ID } }, error: null }) },
      from: jest.fn(() => sessionQuery),
    })
    mockCreateServiceRoleClient.mockReturnValue({ rpc, from: jest.fn() })

    const response = await updateVendorBooking(
      request(`/api/vendor/bookings/${BOOKING_ID}`, { status: 'cancelled' }),
      { params: Promise.resolve({ id: BOOKING_ID }) },
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({
      code: 'canonical_booking_status_transition_required',
    }))
    expect(directUpdate).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})
