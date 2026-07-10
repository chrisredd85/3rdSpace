import type { NextRequest } from 'next/server'
import {
  DELETE as cancelVendor,
  POST as commitVendor,
} from '@/app/api/planner/plans/[planId]/commit-vendor/route'
import {
  DELETE as cancelVenue,
  POST as commitVenue,
} from '@/app/api/planner/plans/[planId]/commit-venue/route'
import {
  cancelStagedCanonicalQuoteBooking,
  stageCanonicalQuoteBooking,
} from '@/lib/planner/execution/canonicalQuoteBooking'
import { recomputePlanDerivedState } from '@/lib/planner/recomputeDerivedState'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/planner/recomputeDerivedState', () => ({
  recomputePlanDerivedState: jest.fn().mockResolvedValue(null),
}))

jest.mock('@/lib/planner/execution/canonicalQuoteBooking', () => ({
  stageCanonicalQuoteBooking: jest.fn(),
  cancelStagedCanonicalQuoteBooking: jest.fn(),
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
const RESPONSE_ID = '55555555-5555-4555-8555-555555555555'
const AUTHORIZATION_OR_EXECUTION_TABLES = [
  'agent_actions',
  'approvals',
  'events',
  'venue_bookings',
  'vendor_bookings',
  'payment_transactions',
  'planner_payment_transactions',
  'venue_payment_transactions',
  'payment_intents',
  'kickback_payments',
]

const MUTATIONS = [
  {
    label: 'venue POST',
    invoke: () => commitVenue(request('/commit-venue', 'POST', {
      response_id: RESPONSE_ID,
    }), context()),
    operation: 'stage',
  },
  {
    label: 'venue DELETE',
    invoke: () => cancelVenue(request('/commit-venue', 'DELETE', { response_id: RESPONSE_ID }), context()),
    operation: 'cancel',
  },
  {
    label: 'vendor POST',
    invoke: () => commitVendor(request('/commit-vendor', 'POST', {
      response_id: RESPONSE_ID,
    }), context()),
    operation: 'stage',
  },
  {
    label: 'vendor DELETE',
    invoke: () => cancelVendor(request('/commit-vendor', 'DELETE', {
      response_id: RESPONSE_ID,
    }), context()),
    operation: 'cancel',
  },
]

const FROZEN_PLANS = [
  { label: 'materialized drafting plan', status: 'drafting', materialized_event_id: EVENT_ID },
  { label: 'approved plan', status: 'approved', materialized_event_id: null },
  { label: 'executing plan', status: 'executing', materialized_event_id: null },
  { label: 'booked plan', status: 'booked', materialized_event_id: null },
  { label: 'completed plan', status: 'completed', materialized_event_id: null },
  { label: 'legacy complete plan', status: 'complete', materialized_event_id: null },
  { label: 'archived plan', status: 'archived', materialized_event_id: null },
]

const REJECTION_CASES = MUTATIONS.flatMap((mutation) =>
  FROZEN_PLANS.map((plan) => ({
    label: `${mutation.label} rejects ${plan.label}`,
    invoke: mutation.invoke,
    plan,
  }))
)

describe('partner quote commitments require a pre-authorization plan', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(stageCanonicalQuoteBooking as jest.Mock).mockResolvedValue({
      existing: false,
      plan: buildPlan(),
      agent_action: { id: 'action-1', status: 'pending' },
      approval: { id: 'approval-1', status: 'pending' },
      approval_message: { id: 'message-1' },
    })
    ;(cancelStagedCanonicalQuoteBooking as jest.Mock).mockResolvedValue({
      existing: false,
      plan: buildPlan({ committed_vendors: [], metadata: {} }),
      agent_action: { id: 'action-1', status: 'cancelled' },
      approval: { id: 'approval-1', status: 'cancelled' },
    })
  })

  it.each(REJECTION_CASES)('$label without attempting a write', async ({ invoke, plan }) => {
    const db = buildDb(buildPlan(plan))
    mockClients(db)

    const response = await invoke()
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload).toEqual(expect.objectContaining({
      code: 'PLAN_REAPPROVAL_REQUIRED',
      plan_id: PLAN_ID,
      plan_status: plan.status,
      materialized_event_id: plan.materialized_event_id,
      error: expect.stringMatching(/frozen.*re-approval/i),
    }))
    expect(db.writeTables).toEqual([])
    expect(db.planUpdates).toEqual([])
    expect(db.messageInserts).toEqual([])
    expect(createServiceRoleClient).not.toHaveBeenCalled()
    expect(recomputePlanDerivedState).not.toHaveBeenCalled()
  })

  it.each(MUTATIONS)('atomically stages $label while the plan is ready and not materialized', async ({ invoke, operation }) => {
    const db = buildDb(buildPlan())
    mockClients(db)

    const response = await invoke()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual(expect.objectContaining({ canonical_event_id: null }))
    expect(payload).toEqual(expect.objectContaining({
      booking_status: operation === 'stage' ? 'approval_required' : 'cancelled_before_authorization',
      agentAction: expect.any(Object),
      approval: expect.any(Object),
    }))
    expect(db.planUpdates).toHaveLength(0)
    expect(db.writeTables).toHaveLength(0)
    expect(db.tables).not.toEqual(expect.arrayContaining(AUTHORIZATION_OR_EXECUTION_TABLES))
    expect(createServiceRoleClient).toHaveBeenCalledTimes(1)
    expect(recomputePlanDerivedState).toHaveBeenCalledTimes(1)
    if (operation === 'stage') {
      expect(stageCanonicalQuoteBooking).toHaveBeenCalledWith(expect.objectContaining({ responseId: RESPONSE_ID }))
      expect(cancelStagedCanonicalQuoteBooking).not.toHaveBeenCalled()
    } else {
      expect(cancelStagedCanonicalQuoteBooking).toHaveBeenCalledWith(expect.objectContaining({ responseId: RESPONSE_ID }))
      expect(stageCanonicalQuoteBooking).not.toHaveBeenCalled()
    }
  })

  it('accepts a new trusted quote on an executing plan with reciprocal event identity', async () => {
    const executingPlan = buildPlan({ status: 'executing', materialized_event_id: EVENT_ID })
    const db = buildDb(executingPlan)
    mockClients(db)

    const response = await commitVenue(request('/commit-venue', 'POST', {
      response_id: RESPONSE_ID,
    }), context())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ canonical_event_id: EVENT_ID }))
    expect(stageCanonicalQuoteBooking).toHaveBeenCalledWith(expect.objectContaining({
      plan: executingPlan,
      quoteKind: 'venue',
      responseId: RESPONSE_ID,
    }))
  })
})

function buildPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAN_ID,
    user_id: USER_ID,
    title: 'Pre-authorization plan',
    event_type: 'community_meetup',
    status: 'ready',
    guest_count: 60,
    budget_cap_cents: 500000,
    neighborhood: 'Oakland',
    date_window_start: '2026-08-20',
    date_window_end: '2026-08-20',
    ticketed: false,
    profit_goal_cents: null,
    notes: null,
    materialized_event_id: null,
    committed_vendors: [{
      discovery_vendor_id: PARTNER_ID,
      service_type: 'catering',
      quoted_package_cents: 225000,
    }],
    metadata: {
      committed_venue: { discovery_venue_id: PARTNER_ID },
      accepted_quote_state: {
        venue: { discovery_venue_id: PARTNER_ID },
        vendors: [{ discovery_vendor_id: PARTNER_ID, service_type: 'catering' }],
      },
    },
    created_at: '2026-07-09T12:00:00.000Z',
    updated_at: '2026-07-09T12:00:00.000Z',
    ...overrides,
  }
}

function buildDb(plan: Record<string, unknown>) {
  const planUpdates: Record<string, unknown>[] = []
  const messageInserts: Record<string, unknown>[] = []
  const tables: string[] = []
  const writeTables: string[] = []

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
          writeTables.push(table)
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
          writeTables.push(table)
          messageInserts.push(values)
          return Promise.resolve({ error: null })
        }),
      }
    }

    const mutation = {
      eq: jest.fn(),
      neq: jest.fn(),
      in: jest.fn().mockResolvedValue({ error: null }),
    }
    mutation.eq.mockReturnValue(mutation)
    mutation.neq.mockReturnValue(mutation)
    return {
      update: jest.fn(() => {
        writeTables.push(table)
        return mutation
      }),
    }
  })

  return { from, planUpdates, messageInserts, tables, writeTables }
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

function request(path: string, method: 'POST' | 'DELETE', body?: Record<string, unknown>) {
  return new Request(`http://localhost/api/planner/plans/${PLAN_ID}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }) as NextRequest
}

function context() {
  return { params: Promise.resolve({ planId: PLAN_ID }) }
}
