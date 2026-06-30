jest.mock('server-only', () => ({}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
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

import type { NextRequest } from 'next/server'
import { GET } from '@/app/api/venues/route'
import { createServiceRoleClient } from '@/lib/supabase/server'

const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock

type QueryResult = {
  data: Array<Record<string, unknown>> | null
  error: { code?: string; message?: string; hint?: string | null } | null
}

function makeRequest(path = '/api/venues?planner_catalog=1&include_blocked=1') {
  return new Request(`http://localhost${path}`) as NextRequest
}

function makeCatalogClient(primaryResult: QueryResult, fallbackResult: QueryResult) {
  const selectCalls: string[] = []

  function venueQuery(columns: string) {
    const query = {
      eq: jest.fn(() => query),
      order: jest.fn(() => query),
      gte: jest.fn(() => query),
      lte: jest.fn(() => query),
      overlaps: jest.fn(() => query),
      range: jest.fn(async () => {
        return columns.includes('bar_consumption_share_enabled')
          ? primaryResult
          : fallbackResult
      }),
    }
    return query
  }

  function amenitiesQuery() {
    const query = {
      in: jest.fn(() => query),
      limit: jest.fn(async () => ({ data: [], error: null })),
    }
    return query
  }

  const client = {
    selectCalls,
    from: jest.fn((table: string) => ({
      select: jest.fn((columns: string) => {
        selectCalls.push(columns)
        if (table === 'venue_amenities') return amenitiesQuery()
        return venueQuery(columns)
      }),
    })),
  }

  return client
}

describe('GET /api/venues public catalog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('falls back to the legacy select when new optional venue columns are absent', async () => {
    const client = makeCatalogClient(
      {
        data: null,
        error: {
          code: '42703',
          message: 'column venues.per_head_chi_cents does not exist',
        },
      },
      {
        data: [{
          id: 'venue-1',
          owner_id: null,
          venue_name: 'Moongate Lounge',
          venue_type: 'bar',
          neighborhood: 'Chinatown',
          address: '28 Waverly Pl',
          city: 'San Francisco',
          state: 'CA',
          zip_code: '94108',
          standing_capacity: 80,
          hourly_rate: 500,
          is_published: true,
          created_at: '2026-06-29T00:00:00.000Z',
          updated_at: '2026-06-29T00:00:00.000Z',
        }],
        error: null,
      }
    )
    mockCreateServiceRoleClient.mockReturnValue(client)

    const response = await GET(makeRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.venues).toHaveLength(1)
    expect(json.venues[0]).toMatchObject({
      id: 'venue-1',
      name: 'Moongate Lounge',
      hourly_rate_cents: 50000,
    })
    expect(client.selectCalls.some((columns) => columns.includes('per_head_chi_cents'))).toBe(true)
    expect(client.selectCalls.some((columns) => !columns.includes('per_head_chi_cents'))).toBe(true)
  })
})
