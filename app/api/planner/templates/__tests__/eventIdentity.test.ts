import { buildTemplateInsert, normalizeTemplateRow } from '@/lib/planner/templateIdentity'
import type { Plan } from '@/lib/types'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))

describe('planner template canonical event identity', () => {
  it('stores the materialized event on the template row and normalized snapshot', () => {
    const sourceEventId = '33333333-3333-4333-8333-333333333333'
    const insert = buildTemplateInsert({
      userId: '22222222-2222-4222-8222-222222222222',
      plan: {
        id: '11111111-1111-4111-8111-111111111111',
        user_id: '22222222-2222-4222-8222-222222222222',
        title: 'Oakland community dinner',
        event_type: 'community_meetup',
        status: 'complete',
        guest_count: 60,
        budget_cap_cents: 500000,
        neighborhood: 'Oakland',
        date_window_start: '2026-08-20',
        date_window_end: '2026-08-20',
        ticketed: false,
        profit_goal_cents: null,
        notes: null,
        materialized_event_id: sourceEventId,
        metadata: {},
        created_at: '2026-07-09T12:00:00.000Z',
        updated_at: '2026-07-09T12:00:00.000Z',
      } as Plan,
      recommendations: [],
      attendanceSummary: null,
    })

    expect(insert).toEqual(expect.objectContaining({
      source_plan_id: '11111111-1111-4111-8111-111111111111',
      source_event_id: sourceEventId,
    }))

    const normalized = normalizeTemplateRow({
      id: 'template-1',
      ...insert,
      created_at: '2026-07-09T12:00:00.000Z',
    } as Parameters<typeof normalizeTemplateRow>[0])
    expect(normalized.source_event_id).toBe(sourceEventId)
    expect(normalized.snapshot).toEqual(expect.objectContaining({
      source_event_id: sourceEventId,
    }))
  })

  it('leaves legacy template event identity null instead of guessing', () => {
    const normalized = normalizeTemplateRow({
      id: 'legacy-template',
      name: 'Legacy template',
      source_event_id: null,
      event_type: 'networking',
      target_audience: null,
      guest_count_min: null,
      guest_count_max: null,
      budget_model: {},
      ticket_price_model: {},
      profit_assumptions: {},
      kickback_model: {},
      run_of_show: {},
      shopping_list: {},
      email_copy: null,
      export_copy: null,
      approval_checklist: {},
      historical_performance: {},
      created_at: '2025-01-01T12:00:00.000Z',
    })

    expect(normalized.source_event_id).toBeNull()
    expect(normalized.snapshot).toEqual(expect.objectContaining({ source_event_id: null }))
  })
})
