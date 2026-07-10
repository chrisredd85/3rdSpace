import type { NextRequest } from 'next/server'
import { POST } from '@/app/api/planner/plans/[planId]/materialize/route'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

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

const plan = {
  id: PLAN_ID,
  user_id: USER_ID,
  title: 'Founder dinner',
  event_type: 'founders dinner',
  status: 'approved',
  guest_count: 40,
  budget_cap_cents: 500000,
  neighborhood: 'Oakland',
  date_window_start: '2026-08-20',
  date_window_end: '2026-08-22',
  ticketed: false,
  profit_goal_cents: null,
  notes: null,
  metadata: {},
  created_at: '2026-07-09T12:00:00.000Z',
  updated_at: '2026-07-09T12:00:00.000Z',
}

const eventRecord = {
  id: EVENT_ID,
  plan_id: PLAN_ID,
  builder_id: 'builder-1',
  event_name: 'Founder dinner',
  description: null,
  event_type: 'founder_operator_dinner',
  event_date: '2026-08-20',
  start_time: '18:30:00',
  end_time: '21:30:00',
  starts_at: '2026-08-21T01:30:00.000Z',
  ends_at: '2026-08-21T04:30:00.000Z',
  time_zone: 'America/Los_Angeles',
  expected_attendance: 40,
  status: 'confirmed',
  venue_id: null,
  budget: 5000,
  created_at: '2026-07-09T12:00:00.000Z',
  updated_at: '2026-07-09T12:00:00.000Z',
}

describe('POST /api/planner/plans/[planId]/materialize', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('proves ownership then calls the service-only RPC with lossless taxonomy and exact schedule', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ event_id: EVENT_ID, existing: false, event_record: eventRecord, plan_status: 'executing' }],
      error: null,
    })
    mockClients({ rpc })

    const response = await POST(request({
      eventDate: '2026-08-20',
      startTime: '18:30',
      durationMinutes: 180,
    }), context())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('materialize_plan_event', {
      p_plan_id: PLAN_ID,
      p_actor_id: USER_ID,
      p_archetype_key: 'founder_operator_dinner',
      p_event_date: '2026-08-20',
      p_start_time: '18:30',
      p_duration_minutes: 180,
      p_time_zone: 'America/Los_Angeles',
    })
    expect(payload).toEqual(expect.objectContaining({
      plan_id: PLAN_ID,
      event_id: EVENT_ID,
      existing: false,
      plan_status: 'executing',
      event: expect.objectContaining({
        plan_id: PLAN_ID,
        event_type: 'founder_operator_dinner',
        starts_at: '2026-08-21T01:30:00.000Z',
        time_zone: 'America/Los_Angeles',
      }),
    }))
  })

  it('returns an idempotent existing event from the RPC', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ event_id: EVENT_ID, existing: true, event_record: eventRecord, plan_status: 'executing' }],
      error: null,
    })
    mockClients({ rpc })

    const response = await POST(request(validSchedule()), context())
    expect(await response.json()).toEqual(expect.objectContaining({ event_id: EVENT_ID, existing: true }))
  })

  it('rejects an unresolved archetype without calling the service writer', async () => {
    const rpc = jest.fn()
    mockClients({ rpc, plan: { ...plan, event_type: 'conference' } })

    const response = await POST(request(validSchedule()), context())

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'plan_archetype_unresolved' }))
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    [{ eventDate: '2026-02-30', startTime: '18:30', durationMinutes: 180 }, 'invalid calendar date'],
    [{ eventDate: '2026-08-20', startTime: '24:00', durationMinutes: 180 }, 'invalid clock time'],
    [{ eventDate: '2026-08-20', startTime: '18:30', durationMinutes: 0 }, 'invalid duration'],
    [{ ...validSchedule(), timeZone: 'Mars/Olympus_Mons' }, 'invalid timezone'],
  ])('rejects %s as an invalid exact schedule (%s)', async (body) => {
    const rpc = jest.fn()
    mockClients({ rpc })

    const response = await POST(request(body), context())

    expect(response.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a date outside the plan window before the service writer', async () => {
    const rpc = jest.fn()
    mockClients({ rpc })

    const response = await POST(request({ ...validSchedule(), eventDate: '2026-08-23' }), context())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'plan_event_date_outside_window' }))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('maps an ineligible plan transition to a conflict', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'plan_materialization_status_ineligible' },
    })
    mockClients({ rpc })

    const response = await POST(request(validSchedule()), context())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'plan_materialization_ineligible' }))
  })

  it('maps an idempotency payload mismatch to an identity conflict', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'plan_event_identity_conflict' },
    })
    mockClients({ rpc })

    const response = await POST(request(validSchedule()), context())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'plan_event_identity_conflict' }))
  })

  it('does not expose plan existence to an unauthenticated caller', async () => {
    ;(createClient as jest.Mock).mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: { message: 'missing' } }) },
    })
    const service = { rpc: jest.fn() }
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(service)

    const response = await POST(request(validSchedule()), context())

    expect(response.status).toBe(401)
    expect(service.rpc).not.toHaveBeenCalled()
  })
})

function mockClients(input: {
  rpc: jest.Mock
  plan?: Record<string, unknown> | null
}) {
  const maybeSingle = jest.fn().mockResolvedValue({ data: input.plan === undefined ? plan : input.plan, error: null })
  const eqUser = jest.fn().mockReturnValue({ maybeSingle })
  const eqPlan = jest.fn().mockReturnValue({ eq: eqUser })
  const select = jest.fn().mockReturnValue({ eq: eqPlan })
  const session = {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: USER_ID, user_metadata: { user_type: 'community_builder' } } },
        error: null,
      }),
    },
    from: jest.fn().mockReturnValue({ select }),
  }
  ;(createClient as jest.Mock).mockReturnValue(session)
  ;(createServiceRoleClient as jest.Mock).mockReturnValue({ rpc: input.rpc })
}

function validSchedule() {
  return {
    eventDate: '2026-08-20',
    startTime: '18:30',
    durationMinutes: 180,
    timeZone: 'America/Los_Angeles',
  }
}

function request(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/planner/plans/${PLAN_ID}/materialize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

function context() {
  return { params: Promise.resolve({ planId: PLAN_ID }) }
}
