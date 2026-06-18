import type { NextRequest } from 'next/server'
import { GET as getCatalogVenues, POST as postCatalogVenue } from '@/app/api/admin/catalog/venues/route'
import { GET as getCatalogVendors, POST as postCatalogVendor } from '@/app/api/admin/catalog/vendors/route'
import { SERVICE_TYPE_LABELS } from '@/lib/constants/account-setup'
import { getAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/server/admin-auth', () => ({
  getAdminContext: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))

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

type JsonObject = Record<string, unknown>

const mockGetAdminContext = getAdminContext as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock

let fromMock: jest.Mock
let insertMock: jest.Mock

beforeAll(() => {
  const responseWithJson = Response as typeof Response & {
    json?: (data: unknown, init?: ResponseInit) => Response
  }

  if (typeof responseWithJson.json !== 'function') {
    responseWithJson.json = (data: unknown, init?: ResponseInit) => {
      const headers = new Headers(init?.headers)
      headers.set('content-type', 'application/json')

      return new Response(JSON.stringify(data), { ...init, headers })
    }
  }
})

function makePostRequest(path: string, body: JsonObject) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

async function readJson(response: Response) {
  return response.json() as Promise<JsonObject>
}

function mockAdminAuth() {
  mockGetAdminContext.mockResolvedValue({
    authorized: true,
    user: { id: 'admin-user-1', email: 'ops@3rdspace.com' },
  })
}

function mockUnauthenticated() {
  mockGetAdminContext.mockResolvedValue({
    authorized: false,
    status: 401,
    error: 'Unauthorized',
  })
}

function mockInsertSuccess(id: string) {
  const singleMock = jest.fn().mockResolvedValue({ data: { id }, error: null })
  const insertSelectMock = jest.fn(() => ({ single: singleMock }))
  insertMock = jest.fn(() => ({ select: insertSelectMock }))
  fromMock.mockReturnValue({ insert: insertMock })

  return { insertMock, insertSelectMock, singleMock }
}

function mockSelectSuccess(rows: JsonObject[]) {
  const orderMock = jest.fn().mockResolvedValue({ data: rows, error: null })
  const eqMock = jest.fn(() => ({ order: orderMock }))
  const selectMock = jest.fn(() => ({ eq: eqMock }))
  fromMock.mockReturnValue({ select: selectMock })

  return { selectMock, eqMock, orderMock }
}

function validVenueBody(overrides: JsonObject = {}) {
  return {
    name: 'The Foundry Loft',
    neighborhood: 'SoMa',
    address: '123 Main St',
    zip_code: '94105',
    venue_type: 'loft_warehouse',
    capacity: 150,
    contact_email: 'owner@foundryloft.com',
    ...overrides,
  }
}

function validVendorBody(overrides: JsonObject = {}) {
  return {
    name: 'Mixt Catering',
    service_type: 'catering',
    price_band: 'mid',
    contact_email: 'bookings@mixt.com',
    package_summary: '6-meal package from $560',
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  insertMock = jest.fn()
  fromMock = jest.fn(() => ({ insert: insertMock }))
  mockCreateServiceRoleClient.mockReturnValue({ from: fromMock })
})

describe('Admin Catalog — Venue Seeding', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    insertMock = jest.fn()
    fromMock = jest.fn(() => ({ insert: insertMock }))
    mockCreateServiceRoleClient.mockReturnValue({ from: fromMock })
  })

  it('rejects unauthenticated requests with 401', async () => {
    mockUnauthenticated()

    const response = await postCatalogVenue(makePostRequest('/api/admin/catalog/venues', validVenueBody()))

    expect([401, 403]).toContain(response.status)
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('rejects missing required fields with 400', async () => {
    mockAdminAuth()

    const response = await postCatalogVenue(makePostRequest('/api/admin/catalog/venues', {
      neighborhood: 'SoMa',
      address: '123 Main St',
    }))
    const json = await readJson(response)

    expect(response.status).toBe(400)
    expect(json.error).toBe('Invalid venue seed payload')
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('seeds a venue with is_admin_seeded=true and is_claimed=false', async () => {
    mockAdminAuth()
    mockInsertSuccess('venue-123')

    const response = await postCatalogVenue(makePostRequest('/api/admin/catalog/venues', validVenueBody()))
    const json = await readJson(response)
    const insertPayload = insertMock.mock.calls[0]?.[0]

    expect(response.status).toBe(200)
    expect(json).toEqual({
      success: true,
      venueId: 'venue-123',
      message: 'Venue added to catalog',
    })
    expect(fromMock).toHaveBeenCalledWith('venues')
    expect(insertPayload).toEqual(expect.objectContaining({
      is_admin_seeded: true,
      is_claimed: false,
      is_published: true,
      contact_email: 'owner@foundryloft.com',
    }))
  })

  it('defaults city to San Francisco and state to CA when omitted', async () => {
    mockAdminAuth()
    mockInsertSuccess('venue-123')

    await postCatalogVenue(makePostRequest('/api/admin/catalog/venues', validVenueBody()))
    const insertPayload = insertMock.mock.calls[0]?.[0]

    expect(insertPayload).toEqual(expect.objectContaining({
      city: 'San Francisco',
      state: 'CA',
    }))
  })

  it('does not set owner_id to a real user id', async () => {
    mockAdminAuth()
    mockInsertSuccess('venue-123')

    await postCatalogVenue(makePostRequest('/api/admin/catalog/venues', validVenueBody()))
    const insertPayload = insertMock.mock.calls[0]?.[0]

    expect(insertPayload).toEqual(expect.objectContaining({ owner_id: null }))
    expect(insertPayload.owner_id).not.toEqual(expect.stringMatching(/[0-9a-f-]{36}/i))
  })
})

describe('Admin Catalog — Vendor Seeding', () => {
  it('rejects unauthenticated requests', async () => {
    mockUnauthenticated()

    const response = await postCatalogVendor(makePostRequest('/api/admin/catalog/vendors', validVendorBody()))

    expect([401, 403]).toContain(response.status)
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('rejects missing required fields with 400', async () => {
    mockAdminAuth()

    const response = await postCatalogVendor(makePostRequest('/api/admin/catalog/vendors', {
      price_band: 'mid',
      package_summary: '6-meal package from $560',
    }))
    const json = await readJson(response)

    expect(response.status).toBe(400)
    expect(json.error).toBe('Invalid vendor seed payload')
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('seeds a vendor with correct fields', async () => {
    mockAdminAuth()
    mockInsertSuccess('vendor-456')

    const response = await postCatalogVendor(makePostRequest('/api/admin/catalog/vendors', validVendorBody()))
    const json = await readJson(response)
    const insertPayload = insertMock.mock.calls[0]?.[0]

    expect(response.status).toBe(200)
    expect(json).toEqual({ success: true, vendorId: 'vendor-456' })
    expect(fromMock).toHaveBeenCalledWith('vendor_profiles')
    expect(insertPayload).toEqual(expect.objectContaining({
      is_admin_seeded: true,
      is_claimed: false,
      contact_email: 'bookings@mixt.com',
      user_id: null,
      vendor_type: SERVICE_TYPE_LABELS.catering,
    }))
    expect(insertPayload.vendor_type).not.toBe('catering')
  })

  it('does not set user_id to a real user id', async () => {
    mockAdminAuth()
    mockInsertSuccess('vendor-456')

    await postCatalogVendor(makePostRequest('/api/admin/catalog/vendors', validVendorBody()))
    const insertPayload = insertMock.mock.calls[0]?.[0]

    expect(insertPayload).toEqual(expect.objectContaining({ user_id: null }))
    expect(insertPayload.user_id).not.toEqual(expect.stringMatching(/[0-9a-f-]{36}/i))
  })
})

describe('Admin Catalog — GET endpoints', () => {
  it('GET /api/admin/catalog/venues requires admin auth', async () => {
    mockUnauthenticated()

    const response = await getCatalogVenues()

    expect([401, 403]).toContain(response.status)
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
  })

  it('GET /api/admin/catalog/venues returns only is_admin_seeded rows', async () => {
    mockAdminAuth()
    const rows = [
      { id: 'venue-1', is_admin_seeded: true, contact_email: 'one@example.com' },
      { id: 'venue-2', is_admin_seeded: true, contact_email: 'two@example.com' },
    ]
    const { selectMock, eqMock, orderMock } = mockSelectSuccess(rows)

    const response = await getCatalogVenues()
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(fromMock).toHaveBeenCalledWith('venues')
    expect(selectMock).toHaveBeenCalledWith('*')
    expect(eqMock).toHaveBeenCalledWith('is_admin_seeded', true)
    expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(response.headers.get('X-Deprecated-Keys')).toContain('per_head_kickback_amount')
    expect(json.venues).toEqual([
      expect.objectContaining({
        ...rows[0],
        per_head_chi_cents: null,
        per_head_kickback_amount: null,
        per_head_kickback_cents: null,
      }),
      expect.objectContaining({
        ...rows[1],
        per_head_chi_cents: null,
        per_head_kickback_amount: null,
        per_head_kickback_cents: null,
      }),
    ])
    expect((json.venues as JsonObject[])[0].contact_email).toBe('one@example.com')
  })

  it('GET /api/admin/catalog/vendors returns only is_admin_seeded rows', async () => {
    mockAdminAuth()
    const rows = [
      { id: 'vendor-1', is_admin_seeded: true, contact_email: 'one@example.com' },
      { id: 'vendor-2', is_admin_seeded: true, contact_email: 'two@example.com' },
    ]
    const { selectMock, eqMock, orderMock } = mockSelectSuccess(rows)

    const response = await getCatalogVendors()
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(fromMock).toHaveBeenCalledWith('vendor_profiles')
    expect(selectMock).toHaveBeenCalledWith('*')
    expect(eqMock).toHaveBeenCalledWith('is_admin_seeded', true)
    expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(json.vendors).toEqual(rows)
    expect((json.vendors as JsonObject[])[0].contact_email).toBe('one@example.com')
  })
})
