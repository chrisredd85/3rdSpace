import type { NextRequest } from 'next/server'
import { PATCH, POST } from '@/app/api/planner/plans/[planId]/materialize/route'
import { resumeCanonicalQuoteBookingsAfterMaterialization } from '@/lib/planner/execution/canonicalQuoteBooking'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/planner/execution/canonicalQuoteBooking', () => ({
  resumeCanonicalQuoteBookingsAfterMaterialization: jest.fn().mockResolvedValue([]),
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

const plan = {
  id: PLAN_ID,
  user_id: USER_ID,
  title: 'Founder dinner',
  event_type: 'Founder/operator dinner',
  status: 'approved',
  guest_count: 40,
  budget_cap_cents: 500000,
  neighborhood: 'Oakland',
  date_window_start: '2026-08-20',
  date_window_end: '2026-08-22',
  ticketed: false,
  profit_goal_cents: null,
  notes: null,
  materialized_event_id: null,
  metadata: {
    event_archetype_lock: {
      key: 'founder_operator_dinner',
      display_name: 'Founder/operator dinner',
    },
  },
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
    ;(resumeCanonicalQuoteBookingsAfterMaterialization as jest.Mock).mockResolvedValue([])
  })

  it('proves ownership then calls the service-only RPC with lossless taxonomy and exact schedule', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ event_id: EVENT_ID, existing: false, event_record: eventRecord, plan_status: 'executing' }],
      error: null,
    })
    const { serviceFrom } = mockClients({ rpc })

    const response = await POST(request({
      eventDate: '2026-08-20',
      startTime: '18:30',
      durationMinutes: 180,
      confirmed: true,
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
      booking_resume: { status: 'complete', results: [], error: null },
      event: expect.objectContaining({
        plan_id: PLAN_ID,
        event_type: 'founder_operator_dinner',
        starts_at: '2026-08-21T01:30:00.000Z',
        time_zone: 'America/Los_Angeles',
      }),
      schedule_confirmation: {
        confirmed: true,
        confirmed_by: USER_ID,
        event_date: '2026-08-20',
        start_time: '18:30',
        duration_minutes: 180,
        time_zone: 'America/Los_Angeles',
      },
    }))
    expect(serviceFrom).not.toHaveBeenCalled()
    expect(resumeCanonicalQuoteBookingsAfterMaterialization).toHaveBeenCalledWith(expect.objectContaining({
      planId: PLAN_ID,
      actorId: USER_ID,
    }))
  })

  it('returns the resumed canonical booking evidence with the materialized event', async () => {
    const resumed = {
      disposition: 'executing',
      metadata: {
        canonical_booking_status: 'pending_partner_confirmation',
        booking_id: 'booking-1',
        event_id: EVENT_ID,
      },
    }
    ;(resumeCanonicalQuoteBookingsAfterMaterialization as jest.Mock).mockResolvedValue([resumed])
    const rpc = jest.fn().mockResolvedValue({
      data: [{ event_id: EVENT_ID, existing: false, event_record: eventRecord, plan_status: 'executing' }],
      error: null,
    })
    mockClients({ rpc })

    const response = await POST(request(validSchedule()), context())

    expect(await response.json()).toEqual(expect.objectContaining({
      event_id: EVENT_ID,
      booking_resume: { status: 'complete', results: [resumed], error: null },
    }))
  })

  it('returns structured re-approval state when authorization expired before materialization', async () => {
    const resumed = {
      disposition: 'waiting',
      metadata: {
        canonical_booking_status: 'reapproval_required',
        reapproval_required: true,
        reapproval_reason: 'approval_expired',
        approval_id: 'approval-expired',
        agent_action_id: 'action-expired',
      },
    }
    ;(resumeCanonicalQuoteBookingsAfterMaterialization as jest.Mock).mockResolvedValue([resumed])
    const rpc = jest.fn().mockResolvedValue({
      data: [{ event_id: EVENT_ID, existing: false, event_record: eventRecord, plan_status: 'executing' }],
      error: null,
    })
    mockClients({ rpc })

    const response = await POST(request(validSchedule()), context())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      event_id: EVENT_ID,
      booking_resume: {
        status: 'reapproval_required',
        results: [resumed],
        error: null,
        reapproval: {
          approval_ids: ['approval-expired'],
          review_href: `/planner?plan=${encodeURIComponent(PLAN_ID)}&tab=approvals`,
        },
      },
    }))
  })

  it('does not report a raced persisted failed action as a completed resume', async () => {
    const failed = {
      disposition: 'waiting',
      metadata: {
        canonical_booking_status: 'failed',
        action_status: 'failed',
        agent_action_id: 'action-failed',
        failure_code: 'partner_handoff_interrupted',
      },
    }
    ;(resumeCanonicalQuoteBookingsAfterMaterialization as jest.Mock).mockResolvedValue([failed])
    const rpc = jest.fn().mockResolvedValue({
      data: [{ event_id: EVENT_ID, existing: true, event_record: eventRecord, plan_status: 'executing' }],
      error: null,
    })
    mockClients({ rpc, plan: { ...plan, status: 'executing', materialized_event_id: EVENT_ID } })

    const response = await POST(request(validSchedule()), context())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      booking_resume: {
        status: 'failed',
        results: [failed],
        error: 'canonical_quote_booking_action_failed',
        recovery: {
          action_ids: ['action-failed'],
          review_href: `/planner?plan=${encodeURIComponent(PLAN_ID)}&tab=approvals`,
          reason: 'action_failed',
        },
      },
    }))
  })

  it('retries approved booking handoffs without rematerializing the event', async () => {
    const resumed = {
      disposition: 'executing',
      metadata: { booking_id: 'booking-1', booking_status: 'pending', event_id: EVENT_ID },
    }
    ;(resumeCanonicalQuoteBookingsAfterMaterialization as jest.Mock).mockResolvedValue([resumed])
    const rpc = jest.fn()
    mockClients({ rpc, plan: { ...plan, status: 'executing', materialized_event_id: EVENT_ID } })

    const response = await PATCH(
      new Request(`http://localhost/api/planner/plans/${PLAN_ID}/materialize`, { method: 'PATCH' }) as NextRequest,
      context(),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      event_id: EVENT_ID,
      booking_resume: { status: 'complete', results: [resumed], error: null },
    }))
    expect(rpc).not.toHaveBeenCalled()
    expect(resumeCanonicalQuoteBookingsAfterMaterialization).toHaveBeenCalledWith(expect.objectContaining({
      planId: PLAN_ID,
      actorId: USER_ID,
    }))
  })

  it('reports a pre-existing failed canonical action on PATCH without replaying materialization', async () => {
    const failed = {
      disposition: 'waiting',
      metadata: {
        canonical_booking_status: 'failed',
        action_status: 'failed',
        agent_action_id: 'action-preexisting-failed',
        failure_code: 'partner_handoff_interrupted',
      },
    }
    ;(resumeCanonicalQuoteBookingsAfterMaterialization as jest.Mock).mockResolvedValue([failed])
    const rpc = jest.fn()
    mockClients({ rpc, plan: { ...plan, status: 'executing', materialized_event_id: EVENT_ID } })

    const response = await PATCH(
      new Request(`http://localhost/api/planner/plans/${PLAN_ID}/materialize`, { method: 'PATCH' }) as NextRequest,
      context(),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      booking_resume: {
        status: 'failed',
        results: [failed],
        error: 'canonical_quote_booking_action_failed',
        recovery: {
          action_ids: ['action-preexisting-failed'],
          review_href: `/planner?plan=${encodeURIComponent(PLAN_ID)}&tab=approvals`,
          reason: 'action_failed',
        },
      },
    }))
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(['completed', 'archived'])('reports blocked recovery on a %s plan without replaying work', async (status) => {
    const blocked = {
      disposition: 'waiting',
      metadata: {
        canonical_booking_status: 'resume_blocked_plan_status',
        resume_blocked: true,
        recovery_required: true,
        resume_blocked_reason: 'plan_status_not_executable',
        plan_status: status,
        action_status: 'approved',
        agent_action_id: `action-${status}`,
      },
    }
    ;(resumeCanonicalQuoteBookingsAfterMaterialization as jest.Mock).mockResolvedValue([blocked])
    const rpc = jest.fn()
    mockClients({ rpc, plan: { ...plan, status, materialized_event_id: EVENT_ID } })

    const response = await PATCH(
      new Request(`http://localhost/api/planner/plans/${PLAN_ID}/materialize`, { method: 'PATCH' }) as NextRequest,
      context(),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      booking_resume: {
        status: 'failed',
        results: [blocked],
        error: 'canonical_quote_booking_resume_blocked',
        recovery: {
          action_ids: [`action-${status}`],
          review_href: `/planner?plan=${encodeURIComponent(PLAN_ID)}&tab=approvals`,
          reason: 'plan_status_ineligible',
          plan_statuses: [status],
        },
      },
    }))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns an actionable failure when booking handoff recovery is interrupted', async () => {
    ;(resumeCanonicalQuoteBookingsAfterMaterialization as jest.Mock).mockRejectedValue(new Error('temporary failure'))
    mockClients({
      rpc: jest.fn(),
      plan: { ...plan, status: 'executing', materialized_event_id: EVENT_ID },
    })

    const response = await PATCH(
      new Request(`http://localhost/api/planner/plans/${PLAN_ID}/materialize`, { method: 'PATCH' }) as NextRequest,
      context(),
    )

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual(expect.objectContaining({
      code: 'canonical_quote_booking_resume_failed',
    }))
  })

  it.each(['executing', 'booked', 'completed'])('allows an exact idempotent retry after the plan has advanced to %s', async (status) => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ event_id: EVENT_ID, existing: true, event_record: eventRecord, plan_status: 'executing' }],
      error: null,
    })
    mockClients({ rpc, plan: { ...plan, status, materialized_event_id: EVENT_ID } })

    const response = await POST(request(validSchedule()), context())
    expect(await response.json()).toEqual(expect.objectContaining({ event_id: EVENT_ID, existing: true }))
  })

  it('rejects an unresolved archetype without calling the service writer', async () => {
    const rpc = jest.fn()
    mockClients({ rpc, plan: { ...plan, event_type: 'conference', metadata: {} } })

    const response = await POST(request(validSchedule()), context())

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'plan_archetype_unresolved' }))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('does not use a fuzzy alias when a legacy plan has no confirmed archetype lock', async () => {
    const rpc = jest.fn()
    mockClients({ rpc, plan: { ...plan, event_type: 'founders dinner', metadata: {} } })

    const response = await POST(request(validSchedule()), context())

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'plan_archetype_unresolved' }))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects a display type that conflicts with the confirmed archetype lock', async () => {
    const rpc = jest.fn()
    mockClients({ rpc, plan: { ...plan, event_type: 'Networking mixer' } })

    const response = await POST(request(validSchedule()), context())

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'plan_archetype_lock_conflict' }))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('requires approval before a first materialization', async () => {
    const rpc = jest.fn()
    mockClients({ rpc, plan: { ...plan, status: 'ready' } })

    const response = await POST(request(validSchedule()), context())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'plan_materialization_requires_approval' }))
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    [{ eventDate: '2026-02-30', startTime: '18:30', durationMinutes: 180, confirmed: true }, 'invalid calendar date'],
    [{ eventDate: '2026-08-20', startTime: '24:00', durationMinutes: 180, confirmed: true }, 'invalid clock time'],
    [{ eventDate: '2026-08-20', startTime: '18:30', durationMinutes: 0, confirmed: true }, 'invalid duration'],
    [{ ...validSchedule(), timeZone: 'Mars/Olympus_Mons' }, 'invalid timezone'],
    [{ ...validSchedule(), confirmed: false }, 'missing host confirmation'],
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

  it.each([
    ['materialize_plan_event_plan_must_be_approved', '23514', 409, 'plan_materialization_ineligible'],
    ['materialize_plan_event_date_outside_plan_window', '22023', 409, 'plan_event_date_outside_window'],
    ['materialize_plan_event_idempotency_conflict', '22023', 409, 'plan_event_identity_conflict'],
    ['materialize_plan_event_unknown_archetype', '22023', 422, 'plan_archetype_unresolved'],
    ['materialize_plan_event_nonexistent_local_time', '22023', 422, 'plan_event_local_time_nonexistent'],
    ['materialize_plan_event_ambiguous_local_time', '22023', 422, 'plan_event_local_time_ambiguous'],
    ['materialize_plan_event_unknown_time_zone', '22023', 422, 'plan_event_time_zone_invalid'],
    ['materialize_plan_event_actor_mismatch', '42501', 403, 'plan_materialization_actor_mismatch'],
  ])('maps migration error %s to a stable route response', async (message, code, status, responseCode) => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { code, message } })
    mockClients({ rpc })

    const response = await POST(request(validSchedule()), context())

    expect(response.status).toBe(status)
    expect(await response.json()).toEqual(expect.objectContaining({ code: responseCode }))
  })

  it('maps the migration plan-not-found error without leaking internals', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { code: 'P0002', message: 'materialize_plan_event_plan_not_found' },
    })
    mockClients({ rpc })

    const response = await POST(request(validSchedule()), context())

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Plan not found' })
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
  const serviceFrom = jest.fn(() => {
    throw new Error('Materialization must not perform booking, approval, payment, or transaction table writes')
  })
  ;(createClient as jest.Mock).mockReturnValue(session)
  ;(createServiceRoleClient as jest.Mock).mockReturnValue({ rpc: input.rpc, from: serviceFrom })
  return { serviceFrom }
}

function validSchedule() {
  return {
    eventDate: '2026-08-20',
    startTime: '18:30',
    durationMinutes: 180,
    timeZone: 'America/Los_Angeles',
    confirmed: true,
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
