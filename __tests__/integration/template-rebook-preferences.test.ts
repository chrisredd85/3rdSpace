/**
 * Integration tests for template rebook preferences.
 *
 * Tests confirm that:
 * 1. Applying a template with use_same_venue writes preferred venue IDs into plan metadata.
 * 2. Applying a template with use_same_vendors writes preferred vendor IDs into plan metadata.
 * 3. Applying with both flags off writes no preferred IDs.
 */

import type { NextRequest } from 'next/server'
import { POST as applyTemplate } from '@/app/api/planner/templates/[id]/apply/route'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

jest.mock('@/lib/planner/autoRecommendations', () => ({
  createAutoRecommendationMessage: jest.fn().mockResolvedValue([]),
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

const TEMPLATE_ID = 'tpl-rebook-test-001'
const USER_ID = 'user-rebook-test-001'
const PREFERRED_VENUE_ID = 'venue-saved-001'
const PREFERRED_VENDOR_ID_1 = 'vendor-saved-001'
const PREFERRED_VENDOR_ID_2 = 'vendor-saved-002'

const MOCK_TEMPLATE = {
  id: TEMPLATE_ID,
  name: 'Hayes Mixer Template',
  event_type: 'mixer',
  target_audience: 'Hayes Valley',
  guest_count_min: 80,
  guest_count_max: 120,
  budget_model: { budget_cap_cents: 500_000, venue_terms: 'flat rental', food_responsibility: 'Organizer prepays food/beverage' },
  ticket_price_model: { ticketed: false, ticketing_model: 'rsvp' },
  profit_assumptions: { profit_goal_cents: 0 },
  kickback_model: {},
  run_of_show: {},
  shopping_list: {
    selected_venue: {
      id: null,
      reference_id: PREFERRED_VENUE_ID,
      type: 'venue',
      is_best_fit: true,
      external_name: 'Hayes Rooftop Studio',
    },
    selected_vendors: [
      { reference_id: PREFERRED_VENDOR_ID_1, type: 'vendor', external_name: 'Saffron Catering' },
      { reference_id: PREFERRED_VENDOR_ID_2, type: 'vendor', external_name: 'Signal AV' },
    ],
    recommendations: [],
  },
  email_copy: null,
  export_copy: 'mixer · 100 guests · Hayes Valley',
  approval_checklist: {},
  historical_performance: {},
}

const MOCK_PLAN = {
  id: 'plan-rebook-new-001',
  user_id: USER_ID,
  title: 'Hayes Mixer Template rebook',
  event_type: 'mixer',
  status: 'ready',
  guest_count: 100,
  budget_cap_cents: 500_000,
  neighborhood: 'Hayes Valley',
  date_window_start: '2026-08-15',
  date_window_end: '2026-08-15',
  ticketed: false,
  ticketing_model: 'rsvp',
  food_responsibility: 'Organizer prepays food/beverage',
  venue_terms: 'flat rental',
  profit_goal_cents: null,
  notes: 'Created from a saved planner template.',
  metadata: null,
}

function buildMockSupabase(insertedPlan: Record<string, unknown>) {
  const mockSingle = jest.fn().mockResolvedValue({ data: insertedPlan, error: null })
  const mockSelectFn = jest.fn().mockReturnValue({ single: mockSingle })
  const mockInsertPlan = jest.fn().mockReturnValue({ select: mockSelectFn })

  const mockTemplateResult = { data: MOCK_TEMPLATE, error: null }
  const mockInsertRun = jest.fn().mockResolvedValue({ error: null })
  const mockInsertMsg = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    }),
  })

  const mockFrom = jest.fn((table: string) => {
    if (table === 'templates') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue(mockTemplateResult),
            }),
          }),
        }),
      }
    }
    if (table === 'plans') {
      return { insert: mockInsertPlan }
    }
    if (table === 'template_runs') {
      return { insert: mockInsertRun }
    }
    if (table === 'plan_messages') {
      return { insert: mockInsertMsg }
    }
    return {
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    }
  })

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: mockFrom,
    _insertedPlanArgs: mockInsertPlan,
  }
}

function buildRequest(body: Record<string, unknown>): NextRequest {
  return {
    json: jest.fn().mockResolvedValue(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as NextRequest
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  return JSON.parse(text) as Record<string, unknown>
}

describe('template apply — rebook preferences in plan metadata', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('stores preferred venue ID when use_same_venue is true', async () => {
    let capturedInsertArg: Record<string, unknown> | null = null

    const mockSupabase = buildMockSupabase(MOCK_PLAN)
    const originalInsert = mockSupabase._insertedPlanArgs
    mockSupabase._insertedPlanArgs = jest.fn((arg: Record<string, unknown>) => {
      capturedInsertArg = arg
      return originalInsert(arg)
    })
    mockSupabase.from = jest.fn((table: string) => {
      if (table === 'plans') return { insert: mockSupabase._insertedPlanArgs }
      return (buildMockSupabase(MOCK_PLAN) as ReturnType<typeof buildMockSupabase>).from(table)
    })

    ;(createClient as jest.Mock).mockReturnValue(mockSupabase)
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(mockSupabase)

    const request = buildRequest({
      create_new_plan: true,
      date_window_start: '2026-08-15',
      date_window_end: '2026-08-15',
      guest_count: 100,
      neighborhood: 'Hayes Valley',
      use_same_venue: true,
      use_same_vendors: false,
      rerun_recommendations: false,
    })

    const response = await applyTemplate(request, { params: { id: TEMPLATE_ID } })
    expect(response.status).toBe(200)

    expect(capturedInsertArg).not.toBeNull()
    const metadata = capturedInsertArg!.metadata as Record<string, unknown>
    expect(metadata).toBeDefined()
    const rebookPrefs = metadata.template_rebook_preferences as Record<string, unknown>
    expect(rebookPrefs).toBeDefined()
    expect(rebookPrefs.use_same_venue).toBe(true)
    expect(rebookPrefs.use_same_vendors).toBe(false)
    expect(Array.isArray(rebookPrefs.preferred_venue_ids)).toBe(true)
    expect((rebookPrefs.preferred_venue_ids as string[])).toContain(PREFERRED_VENUE_ID)
    expect((rebookPrefs.preferred_vendor_ids as string[])).toHaveLength(0)
  })

  it('stores preferred vendor IDs when use_same_vendors is true', async () => {
    let capturedInsertArg: Record<string, unknown> | null = null

    const mockSupabase = buildMockSupabase(MOCK_PLAN)
    const originalInsert = mockSupabase._insertedPlanArgs
    mockSupabase._insertedPlanArgs = jest.fn((arg: Record<string, unknown>) => {
      capturedInsertArg = arg
      return originalInsert(arg)
    })
    mockSupabase.from = jest.fn((table: string) => {
      if (table === 'plans') return { insert: mockSupabase._insertedPlanArgs }
      return (buildMockSupabase(MOCK_PLAN) as ReturnType<typeof buildMockSupabase>).from(table)
    })

    ;(createClient as jest.Mock).mockReturnValue(mockSupabase)
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(mockSupabase)

    const request = buildRequest({
      create_new_plan: true,
      date_window_start: '2026-08-15',
      date_window_end: '2026-08-15',
      guest_count: 100,
      neighborhood: 'Hayes Valley',
      use_same_venue: false,
      use_same_vendors: true,
      rerun_recommendations: false,
    })

    const response = await applyTemplate(request, { params: { id: TEMPLATE_ID } })
    expect(response.status).toBe(200)

    expect(capturedInsertArg).not.toBeNull()
    const metadata = capturedInsertArg!.metadata as Record<string, unknown>
    const rebookPrefs = metadata.template_rebook_preferences as Record<string, unknown>
    expect(rebookPrefs).toBeDefined()
    expect(rebookPrefs.use_same_venue).toBe(false)
    expect(rebookPrefs.use_same_vendors).toBe(true)
    expect((rebookPrefs.preferred_venue_ids as string[])).toHaveLength(0)
    expect((rebookPrefs.preferred_vendor_ids as string[])).toContain(PREFERRED_VENDOR_ID_1)
    expect((rebookPrefs.preferred_vendor_ids as string[])).toContain(PREFERRED_VENDOR_ID_2)
  })

  it('stores preferred venue and vendor IDs when both flags are true', async () => {
    let capturedInsertArg: Record<string, unknown> | null = null

    const mockSupabase = buildMockSupabase(MOCK_PLAN)
    const originalInsert = mockSupabase._insertedPlanArgs
    mockSupabase._insertedPlanArgs = jest.fn((arg: Record<string, unknown>) => {
      capturedInsertArg = arg
      return originalInsert(arg)
    })
    mockSupabase.from = jest.fn((table: string) => {
      if (table === 'plans') return { insert: mockSupabase._insertedPlanArgs }
      return (buildMockSupabase(MOCK_PLAN) as ReturnType<typeof buildMockSupabase>).from(table)
    })

    ;(createClient as jest.Mock).mockReturnValue(mockSupabase)
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(mockSupabase)

    const request = buildRequest({
      create_new_plan: true,
      date_window_start: '2026-08-15',
      date_window_end: '2026-08-15',
      guest_count: 100,
      neighborhood: 'Hayes Valley',
      use_same_venue: true,
      use_same_vendors: true,
      rerun_recommendations: false,
    })

    const response = await applyTemplate(request, { params: { id: TEMPLATE_ID } })
    expect(response.status).toBe(200)

    expect(capturedInsertArg).not.toBeNull()
    const metadata = capturedInsertArg!.metadata as Record<string, unknown>
    const rebookPrefs = metadata.template_rebook_preferences as Record<string, unknown>
    expect(rebookPrefs.template_id).toBe(TEMPLATE_ID)
    expect((rebookPrefs.preferred_venue_ids as string[])).toContain(PREFERRED_VENUE_ID)
    expect((rebookPrefs.preferred_vendor_ids as string[])).toContain(PREFERRED_VENDOR_ID_1)
    expect((rebookPrefs.preferred_vendor_ids as string[])).toContain(PREFERRED_VENDOR_ID_2)
  })

  it('does not set template_rebook_preferences when both flags are false', async () => {
    let capturedInsertArg: Record<string, unknown> | null = null

    const mockSupabase = buildMockSupabase(MOCK_PLAN)
    const originalInsert = mockSupabase._insertedPlanArgs
    mockSupabase._insertedPlanArgs = jest.fn((arg: Record<string, unknown>) => {
      capturedInsertArg = arg
      return originalInsert(arg)
    })
    mockSupabase.from = jest.fn((table: string) => {
      if (table === 'plans') return { insert: mockSupabase._insertedPlanArgs }
      return (buildMockSupabase(MOCK_PLAN) as ReturnType<typeof buildMockSupabase>).from(table)
    })

    ;(createClient as jest.Mock).mockReturnValue(mockSupabase)
    ;(createServiceRoleClient as jest.Mock).mockReturnValue(mockSupabase)

    const request = buildRequest({
      create_new_plan: true,
      date_window_start: '2026-08-15',
      date_window_end: '2026-08-15',
      guest_count: 100,
      neighborhood: 'Hayes Valley',
      use_same_venue: false,
      use_same_vendors: false,
      rerun_recommendations: false,
    })

    const response = await applyTemplate(request, { params: { id: TEMPLATE_ID } })
    expect(response.status).toBe(200)

    expect(capturedInsertArg).not.toBeNull()
    const metadata = capturedInsertArg!.metadata as Record<string, unknown>
    expect(metadata.template_rebook_preferences).toBeUndefined()
  })
})
