import type { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/planner/templates/route'
import { createClient } from '@/lib/supabase/server'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('@/lib/server/builderAttendanceHistory', () => ({
  summarizeBuilderAttendance: jest.fn().mockResolvedValue(null),
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

const USER_ID = '11111111-1111-4111-8111-111111111111'
const PLAN_ID = '22222222-2222-4222-8222-222222222222'
const EVENT_ID = '33333333-3333-4333-8333-333333333333'

const completedPlan = {
  id: PLAN_ID,
  user_id: USER_ID,
  title: 'Founder dinner',
  event_type: 'Founder/operator dinner',
  status: 'completed',
  guest_count: 40,
  budget_cap_cents: 500000,
  neighborhood: 'Oakland',
  date_window_start: '2026-06-20',
  date_window_end: '2026-06-20',
  ticketed: false,
  ticketing_model: null,
  food_responsibility: null,
  venue_terms: null,
  agent_action: null,
  profit_goal_cents: null,
  notes: null,
  materialized_event_id: EVENT_ID,
  metadata: {},
  created_at: '2026-06-01T12:00:00.000Z',
  updated_at: '2026-06-21T12:00:00.000Z',
}

const eligibleEvent = {
  id: EVENT_ID,
  plan_id: PLAN_ID,
  status: 'completed',
  ends_at: '2026-06-21T04:00:00.000Z',
  outcome_summary: { attendance: 38, host_notes: 'Strong repeat candidate' },
  outcome_recorded_at: '2026-06-21T12:00:00.000Z',
}

const templateRow = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Founder dinner template',
  source_event_id: EVENT_ID,
  event_type: 'Founder/operator dinner',
  target_audience: 'Oakland',
  guest_count_min: 32,
  guest_count_max: 48,
  budget_model: {},
  ticket_price_model: {},
  profit_assumptions: {},
  kickback_model: {},
  run_of_show: {},
  shopping_list: {},
  email_copy: null,
  export_copy: 'Founder/operator dinner · 40 guests · Oakland',
  approval_checklist: {},
  historical_performance: {},
  created_at: '2026-06-21T12:30:00.000Z',
}

describe('POST /api/planner/templates canonical eligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('saves a completed plan only after verifying its completed canonical event evidence', async () => {
    const mock = mockPlannerDb()

    const response = await POST(request())

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(expect.objectContaining({
      template: expect.objectContaining({ source_event_id: EVENT_ID }),
    }))
    expect(mock.from).toHaveBeenCalledWith('events')
    expect(mock.templateInsert).toHaveBeenCalledWith(expect.objectContaining({
      source_plan_id: PLAN_ID,
      source_event_id: EVENT_ID,
      historical_performance: expect.objectContaining({
        source_event_id: EVENT_ID,
        outcome_recorded_at: eligibleEvent.outcome_recorded_at,
        outcome_summary: eligibleEvent.outcome_summary,
      }),
    }))
    expect(mock.from).not.toHaveBeenCalledWith('venue_bookings')
    expect(mock.from).not.toHaveBeenCalledWith('vendor_bookings')
    expect(mock.from).not.toHaveBeenCalledWith('payments')
  })

  it('rejects a legacy complete plan before canonical event or template writes', async () => {
    const mock = mockPlannerDb({ plan: { ...completedPlan, status: 'complete' } })

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'template_source_plan_incomplete' }))
    expect(mock.from).not.toHaveBeenCalledWith('events')
    expect(mock.from).not.toHaveBeenCalledWith('recommendations')
    expect(mock.from).not.toHaveBeenCalledWith('templates')
  })

  it('rejects a completed plan without canonical identity before recommendation or template writes', async () => {
    const mock = mockPlannerDb({ plan: { ...completedPlan, materialized_event_id: null } })

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'template_source_event_required' }))
    expect(mock.from).not.toHaveBeenCalledWith('events')
    expect(mock.from).not.toHaveBeenCalledWith('recommendations')
    expect(mock.from).not.toHaveBeenCalledWith('templates')
  })

  it('rejects a canonical event without substantive completed outcome evidence before any template write', async () => {
    const mock = mockPlannerDb({ event: { ...eligibleEvent, outcome_summary: {} } })

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'template_source_event_ineligible' }))
    expect(mock.from).not.toHaveBeenCalledWith('recommendations')
    expect(mock.from).not.toHaveBeenCalledWith('templates')
  })

  it('rejects a completed event that does not reciprocally belong to the source plan', async () => {
    const mock = mockPlannerDb({
      event: { ...eligibleEvent, plan_id: '55555555-5555-4555-8555-555555555555' },
    })

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'template_source_event_ineligible' }))
    expect(mock.from).not.toHaveBeenCalledWith('recommendations')
    expect(mock.from).not.toHaveBeenCalledWith('templates')
  })

  it('rejects an executing plan even when it already has a canonical event', async () => {
    const mock = mockPlannerDb({ plan: { ...completedPlan, status: 'executing' } })

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(expect.objectContaining({ code: 'template_source_plan_incomplete' }))
    expect(mock.from).not.toHaveBeenCalledWith('events')
    expect(mock.from).not.toHaveBeenCalledWith('templates')
  })
})

describe('GET /api/planner/templates legacy read compatibility', () => {
  it('continues returning older template rows without a canonical source event', async () => {
    const legacyTemplate = { ...templateRow, source_event_id: null }
    const from = jest.fn((table: string) => {
      if (table !== 'templates') throw new Error(`Unexpected table ${table}`)
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({ data: [legacyTemplate], error: null }),
            }),
          }),
        }),
      }
    })
    ;(createClient as jest.Mock).mockReturnValue({
      auth: { getUser: authenticatedUser },
      from,
    })

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      templates: [expect.objectContaining({ id: legacyTemplate.id, source_event_id: null })],
    }))
  })
})

function mockPlannerDb(input: {
  plan?: Record<string, unknown>
  event?: Record<string, unknown> | null
} = {}) {
  const templateInsert = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({ data: templateRow, error: null }),
    }),
  })
  const from = jest.fn((table: string) => {
    if (table === 'plans') return ownedSingleQuery(input.plan ?? completedPlan)
    if (table === 'events') return ownedSingleQuery(input.event === undefined ? eligibleEvent : input.event)
    if (table === 'recommendations') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }
    }
    if (table === 'builder_profiles') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }
    }
    if (table === 'templates') return { insert: templateInsert }
    throw new Error(`Unexpected table ${table}`)
  })
  ;(createClient as jest.Mock).mockReturnValue({
    auth: { getUser: authenticatedUser },
    from,
  })
  return { from, templateInsert }
}

function ownedSingleQuery(data: Record<string, unknown> | null) {
  const maybeSingle = jest.fn().mockResolvedValue({ data, error: null })
  const secondEq = jest.fn().mockReturnValue({ maybeSingle })
  const firstEq = jest.fn().mockReturnValue({ eq: secondEq, maybeSingle })
  return { select: jest.fn().mockReturnValue({ eq: firstEq }) }
}

function authenticatedUser() {
  return Promise.resolve({ data: { user: { id: USER_ID } }, error: null })
}

function request() {
  return new Request('http://localhost/api/planner/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan_id: PLAN_ID }),
  }) as NextRequest
}
