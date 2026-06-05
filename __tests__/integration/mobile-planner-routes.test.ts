import type { NextRequest } from 'next/server'

jest.mock('server-only', () => ({}))

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

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

jest.mock('@/lib/supabase/server-helpers', () => ({
  getBuilderProfileId: jest.fn(),
}))

jest.mock('@/lib/planner/mobileReadModels', () => ({
  buildMobileActivityReadModel: jest.fn(),
  buildMobileAnalyticsReadModel: jest.fn(),
  buildMobileBudgetReadModel: jest.fn(),
  buildMobileHomeReadModel: jest.fn(),
  loadOwnedMobilePlan: jest.fn(),
}))

import { GET as getMobileActivity } from '@/app/api/planner/plans/[planId]/activity/route'
import { GET as getMobileAnalytics } from '@/app/api/planner/analytics/route'
import { GET as getMobileBudget } from '@/app/api/planner/plans/[planId]/budget/route'
import { GET as getMobileHome } from '@/app/api/planner/plans/[planId]/mobile-home/route'
import { buildMobileActivityReadModel, buildMobileAnalyticsReadModel, buildMobileBudgetReadModel, buildMobileHomeReadModel, loadOwnedMobilePlan } from '@/lib/planner/mobileReadModels'
import { createClient } from '@/lib/supabase/server'
import { getBuilderProfileId } from '@/lib/supabase/server-helpers'

const mockCreateClient = createClient as jest.Mock
const mockGetBuilderProfileId = getBuilderProfileId as jest.Mock
const mockLoadOwnedMobilePlan = loadOwnedMobilePlan as jest.Mock
const mockBuildMobileHomeReadModel = buildMobileHomeReadModel as jest.Mock
const mockBuildMobileBudgetReadModel = buildMobileBudgetReadModel as jest.Mock
const mockBuildMobileActivityReadModel = buildMobileActivityReadModel as jest.Mock
const mockBuildMobileAnalyticsReadModel = buildMobileAnalyticsReadModel as jest.Mock

const user = {
  id: 'user-1',
  user_metadata: { user_type: 'community_builder' },
}

const plan = {
  id: 'plan-1',
  user_id: 'user-1',
  title: 'Member dinner',
}

function mockAuth(authUser: typeof user | null) {
  mockCreateClient.mockReturnValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: authUser },
        error: null,
      }),
    },
  })
}

function request(url = 'http://localhost/api/test') {
  return {
    nextUrl: new URL(url),
  } as NextRequest
}

describe('mobile planner routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects unauthenticated mobile home reads', async () => {
    mockAuth(null)

    const response = await getMobileHome(request(), { params: { planId: 'plan-1' } })

    expect(response.status).toBe(401)
  })

  it('returns the mobile home read model for an owned plan', async () => {
    mockAuth(user)
    mockLoadOwnedMobilePlan.mockResolvedValue(plan)
    mockBuildMobileHomeReadModel.mockResolvedValue({ plan, pending_approval_count: 0 })

    const response = await getMobileHome(request(), { params: { planId: 'plan-1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.pending_approval_count).toBe(0)
    expect(mockLoadOwnedMobilePlan).toHaveBeenCalledWith(expect.anything(), 'plan-1', 'user-1')
  })

  it('returns the mobile budget read model for an owned plan', async () => {
    mockAuth(user)
    mockLoadOwnedMobilePlan.mockResolvedValue(plan)
    mockBuildMobileBudgetReadModel.mockResolvedValue({ target_cents: 100000, lines: [] })

    const response = await getMobileBudget(
      request('http://localhost/api/planner/plans/plan-1/budget?actionAmountCents=5000'),
      { params: { planId: 'plan-1' } }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.target_cents).toBe(100000)
    expect(mockBuildMobileBudgetReadModel).toHaveBeenCalledWith(expect.anything(), plan, 5000)
  })

  it('returns mobile activity for an owned plan', async () => {
    mockAuth(user)
    mockLoadOwnedMobilePlan.mockResolvedValue(plan)
    mockBuildMobileActivityReadModel.mockResolvedValue({ activities: [] })

    const response = await getMobileActivity(request(), { params: { planId: 'plan-1' } })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.activities).toEqual([])
  })

  it('returns deterministic mobile analytics for the authenticated builder', async () => {
    mockAuth(user)
    mockGetBuilderProfileId.mockResolvedValue({ builderProfileId: 'builder-1', error: null })
    mockBuildMobileAnalyticsReadModel.mockResolvedValue({
      events_per_year: 1,
      average_margin_percent: 20,
      rebook_rate_percent: null,
      best_format: 'dinner',
      recommendation: 'Use completed event reports.',
      recent_events: [],
    })

    const response = await getMobileAnalytics()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.best_format).toBe('dinner')
    expect(mockBuildMobileAnalyticsReadModel).toHaveBeenCalledWith(expect.anything(), 'builder-1')
  })
})
