import type { NextRequest } from 'next/server'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('@/lib/supabase/server-helpers', () => ({
  getBuilderProfileId: jest.fn().mockResolvedValue({ builderProfileId: 'builder-1', error: null }),
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

import { GET as getPostEventReport } from '@/app/api/planner/post-event/report/route'
import { createClient } from '@/lib/supabase/server'

const mockCreateClient = createClient as jest.Mock

function makeRequest(path: string) {
  const url = `http://localhost${path}`
  const request = new Request(url) as NextRequest
  Object.defineProperty(request, 'nextUrl', { value: new URL(url) })
  return request
}

async function readJson(response: Response) {
  return JSON.parse(await response.text()) as Record<string, any>
}

function mockPlannerClient(overrides: Partial<Record<string, any[]>> = {}) {
  const rows: Record<string, any[]> = {
    events: [{ id: 'event-1', event_name: 'Mixer', event_date: '2026-07-04' }],
    imported_attendees: [
      { checked_in: true, check_in_time: '2026-07-04T20:10:00.000Z' },
      { checked_in: false, check_in_time: null },
    ],
    event_sales_data: [
      {
        ticket_quantity: 2,
        total_amount_cents: 8000,
        total_amount: null,
        ticket_price_cents: 4000,
        ticket_tier_name: 'GA',
        ticket_type: 'GA',
        is_refund: false,
        purchase_timestamp: '2026-06-01T00:00:00.000Z',
      },
      {
        ticket_quantity: -1,
        total_amount_cents: -4000,
        total_amount: null,
        ticket_price_cents: 4000,
        ticket_tier_name: 'GA',
        ticket_type: 'GA',
        is_refund: true,
        purchase_timestamp: '2026-06-15T00:00:00.000Z',
      },
    ],
  }
  Object.assign(rows, overrides)

  mockCreateClient.mockReturnValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: {
          user: {
            id: 'user-1',
            user_metadata: { user_type: 'community_builder' },
          },
        },
        error: null,
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: rows[table] ?? [], error: null }),
          }),
        }),
        in: () => ({
          limit: () => Promise.resolve({ data: rows[table] ?? [], error: null }),
          order: () => ({
            limit: () => Promise.resolve({ data: rows[table] ?? [], error: null }),
          }),
        }),
      }),
    }),
  })
}

describe('post-event report', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPlannerClient()
  })

  it('counts negative refund rows and exposes net revenue and foot-traffic proxy', async () => {
    const response = await getPostEventReport(makeRequest('/api/planner/post-event/report'))
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(json.summary).toEqual(expect.objectContaining({
      tickets_sold: 2,
      tickets_refunded: 1,
      gross_revenue_cents: 8000,
      refund_amount_cents: 4000,
      net_revenue_cents: 4000,
      average_ticket_price_cents: 4000,
      venue_foot_traffic_proxy: 1,
    }))
    expect(json.tier_velocity).toEqual([
      expect.objectContaining({
        tier_name: 'GA',
        tickets_sold: 2,
        tickets_refunded: 1,
      }),
    ])
  })

  it('uses recorded canonical outcome evidence when imports are absent', async () => {
    mockPlannerClient({
      events: [{
        id: 'event-1',
        event_name: 'Mixer',
        event_date: '2026-07-04',
        outcome_recorded_at: '2026-07-05T12:00:00.000Z',
        outcome_summary: {
          actual_attendance: 84,
          gross_revenue_cents: 245050,
          total_cost_cents: 172525,
        },
      }],
      imported_attendees: [],
      event_sales_data: [],
    })

    const response = await getPostEventReport(makeRequest('/api/planner/post-event/report?eventId=event-1'))
    const json = await readJson(response)

    expect(response.status).toBe(200)
    expect(json.summary).toEqual(expect.objectContaining({
      checked_in: 84,
      rsvps_or_imported_attendees: 84,
      gross_revenue_cents: 245050,
      net_revenue_cents: 245050,
      total_cost_cents: 172525,
      canonical_outcome_recorded: true,
      source_confidence: 'canonical_outcome',
    }))
  })
})
