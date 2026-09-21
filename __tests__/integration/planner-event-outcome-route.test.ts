import type { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/planner/plans/[planId]/outcome/route'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data), {
      ...init,
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    }),
  },
}))

const PLAN_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const EVENT_ID = '33333333-3333-4333-8333-333333333333'

const bookedPlan = {
  id: PLAN_ID,
  user_id: USER_ID,
  status: 'booked',
  materialized_event_id: EVENT_ID,
}

const endedEvent = {
  id: EVENT_ID,
  plan_id: PLAN_ID,
  status: 'confirmed',
  event_name: 'Founder dinner',
  event_date: '2026-07-01',
  ends_at: '2026-07-02T04:00:00.000Z',
  time_zone: 'America/Los_Angeles',
  outcome_recorded_at: null,
  outcome_summary: null,
}

describe('planner canonical event outcome route', () => {
  beforeEach(() => jest.clearAllMocks())

  it('loads an ended booked canonical event as recordable', async () => {
    mockClients()

    const response = await GET(request('GET'), context())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual(expect.objectContaining({
      canRecord: true,
      templateEligible: false,
      plan: expect.objectContaining({ id: PLAN_ID, status: 'booked' }),
      event: expect.objectContaining({ id: EVENT_ID, plan_id: PLAN_ID }),
    }))
  })

  it('records normalized integer-cent evidence through the service-only command', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: {
        event: { ...endedEvent, status: 'completed', outcome_recorded_at: '2026-07-09T20:00:00.000Z' },
        plan: { ...bookedPlan, status: 'completed' },
        template_eligible: true,
      },
      error: null,
    })
    mockClients({ rpc })

    const response = await POST(request('POST', {
      actualAttendance: 84,
      grossRevenueCents: 245000,
      totalCostCents: 172500,
      notes: 'Strong repeat candidate.',
    }), context())

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('record_plan_event_outcome_command', {
      p_event_id: EVENT_ID,
      p_actor_id: USER_ID,
      p_outcome_summary: {
        actual_attendance: 84,
        gross_revenue_cents: 245000,
        total_cost_cents: 172500,
        notes: 'Strong repeat candidate.',
      },
    })
    expect(await response.json()).toEqual(expect.objectContaining({ success: true, template_eligible: true }))
  })

  it.each([
    [{}, 'empty evidence'],
    [{ actualAttendance: -1 }, 'negative attendance'],
    [{ grossRevenueCents: 9.5 }, 'fractional cents'],
    [{ notes: '' }, 'empty notes'],
  ])('rejects %s (%s) before the command', async (body) => {
    const rpc = jest.fn()
    mockClients({ rpc })

    const response = await POST(request('POST', body), context())

    expect(response.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('fails closed when the plan has no canonical event', async () => {
    const rpc = jest.fn()
    mockClients({ rpc, plan: { ...bookedPlan, materialized_event_id: null } })

    const response = await POST(request('POST', { notes: 'Outcome notes' }), context())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'canonical_event_required' }))
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['record_plan_event_outcome_event_has_not_ended', '23514', 409, 'event_not_ended'],
    ['record_plan_event_outcome_plan_must_be_booked', '23514', 409, 'plan_not_booked'],
    ['record_plan_event_outcome_idempotency_conflict', '40001', 409, 'outcome_conflict'],
  ])('maps %s to a stable response', async (message, code, status, responseCode) => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message, code } })
    mockClients({ rpc })

    const response = await POST(request('POST', { notes: 'Outcome notes' }), context())

    expect(response.status).toBe(status)
    expect(await response.json()).toEqual(expect.objectContaining({ code: responseCode }))
  })

  it('maps a PostgreSQL deadlock to a retryable outcome conflict', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'deadlock detected', code: '40P01' },
    })
    mockClients({ rpc })

    const response = await POST(request('POST', { notes: 'Outcome notes' }), context())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({
      code: 'outcome_retryable_conflict',
      retryable: true,
      error: expect.stringContaining('Refresh'),
    }))
  })

  it('does not reveal plan state to an unauthenticated caller', async () => {
    ;(createClient as jest.Mock).mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: { message: 'missing' } }) },
    })
    const rpc = jest.fn()
    ;(createServiceRoleClient as jest.Mock).mockReturnValue({ rpc })

    const response = await POST(request('POST', { notes: 'Outcome notes' }), context())

    expect(response.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })
})

function mockClients(input: {
  rpc?: jest.Mock
  plan?: Record<string, unknown> | null
  event?: Record<string, unknown> | null
} = {}) {
  const plan = input.plan === undefined ? bookedPlan : input.plan
  const event = input.event === undefined ? endedEvent : input.event
  const session = {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: USER_ID, user_metadata: { user_type: 'community_builder' } } },
        error: null,
      }),
    },
    from: jest.fn((table: string) => queryFor(table === 'plans' ? plan : event)),
  }
  ;(createClient as jest.Mock).mockReturnValue(session)
  ;(createServiceRoleClient as jest.Mock).mockReturnValue({
    rpc: input.rpc ?? jest.fn().mockResolvedValue({ data: null, error: null }),
  })
}

function queryFor(row: Record<string, unknown> | null) {
  const query: Record<string, jest.Mock> = {}
  query.select = jest.fn(() => query)
  query.eq = jest.fn(() => query)
  query.maybeSingle = jest.fn().mockResolvedValue({ data: row, error: null })
  return query
}

function request(method: 'GET' | 'POST', body?: Record<string, unknown>) {
  return new Request(`http://localhost/api/planner/plans/${PLAN_ID}/outcome`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }) as NextRequest
}

function context() {
  return { params: Promise.resolve({ planId: PLAN_ID }) }
}
