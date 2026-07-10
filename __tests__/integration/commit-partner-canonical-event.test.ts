import type { NextRequest } from 'next/server'
import { POST as commitVenue } from '@/app/api/planner/plans/[planId]/commit-venue/route'
import { POST as commitVendor } from '@/app/api/planner/plans/[planId]/commit-vendor/route'
import { recomputePlanDerivedState } from '@/lib/planner/recomputeDerivedState'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/planner/recomputeDerivedState', () => ({
  recomputePlanDerivedState: jest.fn().mockResolvedValue(null),
}))

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

const PLAN_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const EVENT_ID = '33333333-3333-4333-8333-333333333333'
const PARTNER_ID = '44444444-4444-4444-8444-444444444444'
const AUTHORIZATION_OR_EXECUTION_TABLES = [
  'agent_actions',
  'approvals',
  'venue_bookings',
  'vendor_bookings',
  'payment_transactions',
  'planner_payment_transactions',
  'venue_payment_transactions',
  'payment_intents',
  'kickback_payments',
]

const plan = {
  id: PLAN_ID,
  user_id: USER_ID,
  title: 'Materialized plan',
  event_type: 'community_meetup',
  status: 'executing',
  guest_count: 60,
  budget_cap_cents: 500000,
  neighborhood: 'Oakland',
  date_window_start: '2026-08-20',
  date_window_end: '2026-08-20',
  ticketed: false,
  profit_goal_cents: null,
  notes: null,
  materialized_event_id: EVENT_ID,
  committed_vendors: [],
  metadata: {},
  created_at: '2026-07-09T12:00:00.000Z',
  updated_at: '2026-07-09T12:00:00.000Z',
}

describe('accepted partner quotes keep canonical event identity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('persists and exposes canonical_event_id for an accepted venue quote without creating a booking', async () => {
    const db = buildDb()
    mockClients(db)

    const response = await commitVenue(request('/commit-venue', {
      discovery_venue_id: PARTNER_ID,
      quoted_price_cents: 150000,
      quoted_deal_model: 'flat_rental',
      quoted_terms: { cancellation: '72 hours' },
    }), context())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.canonical_event_id).toBe(EVENT_ID)
    expect(db.planUpdates[0]).toEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        committed_venue: expect.objectContaining({ canonical_event_id: EVENT_ID }),
        accepted_quote_state: expect.objectContaining({
          venue: expect.objectContaining({ canonical_event_id: EVENT_ID }),
        }),
      }),
    }))
    expect(db.messageInserts[0]).toEqual(expect.objectContaining({
      metadata: expect.objectContaining({ canonical_event_id: EVENT_ID }),
    }))
    expect(db.tables).not.toEqual(expect.arrayContaining(['events', ...AUTHORIZATION_OR_EXECUTION_TABLES]))
  })

  it('persists and exposes canonical_event_id for an accepted vendor quote without creating a booking', async () => {
    const db = buildDb()
    mockClients(db)

    const response = await commitVendor(request('/commit-vendor', {
      discovery_vendor_id: PARTNER_ID,
      service_type: 'catering',
      quoted_package_cents: 225000,
      quoted_terms: { menu: 'family style' },
    }), context())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.canonical_event_id).toBe(EVENT_ID)
    expect(db.planUpdates[0]).toEqual(expect.objectContaining({
      committed_vendors: expect.arrayContaining([
        expect.objectContaining({ canonical_event_id: EVENT_ID, discovery_vendor_id: PARTNER_ID }),
      ]),
      metadata: expect.objectContaining({
        accepted_quote_state: expect.objectContaining({
          vendors: expect.arrayContaining([expect.objectContaining({ canonical_event_id: EVENT_ID })]),
        }),
      }),
    }))
    expect(db.messageInserts[0]).toEqual(expect.objectContaining({
      metadata: expect.objectContaining({ canonical_event_id: EVENT_ID }),
    }))
    expect(db.tables).not.toEqual(expect.arrayContaining(['events', ...AUTHORIZATION_OR_EXECUTION_TABLES]))
    expect(recomputePlanDerivedState).toHaveBeenCalled()
  })
})

function buildDb() {
  const planUpdates: Record<string, unknown>[] = []
  const messageInserts: Record<string, unknown>[] = []
  const tables: string[] = []

  const from = jest.fn((table: string) => {
    tables.push(table)
    if (table === 'plans') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: plan, error: null }),
            }),
          }),
        }),
        update: jest.fn((values: Record<string, unknown>) => {
          planUpdates.push(values)
          return {
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({ data: { ...plan, ...values }, error: null }),
                }),
              }),
            }),
          }
        }),
      }
    }
    if (table === 'plan_messages') {
      return {
        insert: jest.fn((values: Record<string, unknown>) => {
          messageInserts.push(values)
          return Promise.resolve({ error: null })
        }),
      }
    }

    return {
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            neq: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({ error: null }),
            }),
            neq: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({ error: null }),
            }),
          }),
          neq: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }),
    }
  })

  return { from, planUpdates, messageInserts, tables }
}

function mockClients(db: ReturnType<typeof buildDb>) {
  ;(createClient as jest.Mock).mockReturnValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: USER_ID, user_metadata: { user_type: 'community_builder' } } },
        error: null,
      }),
    },
    from: db.from,
  })
  ;(createServiceRoleClient as jest.Mock).mockReturnValue({ from: db.from })
}

function request(path: string, body: Record<string, unknown>) {
  return new Request(`http://localhost/api/planner/plans/${PLAN_ID}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

function context() {
  return { params: Promise.resolve({ planId: PLAN_ID }) }
}
