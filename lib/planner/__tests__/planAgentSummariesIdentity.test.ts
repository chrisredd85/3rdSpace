jest.mock('server-only', () => ({}))

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))

import { loadPlanAgentFields } from '@/lib/planner/planAgentSummaries'
import type { Plan } from '@/lib/types'

describe('plan agent summaries canonical event identity', () => {
  it('queries operating records with the canonical event instead of legacy metadata or plan id', async () => {
    const db = buildDb()

    await loadPlanAgentFields({
      db: db.client,
      plan: buildPlan({
        materialized_event_id: 'canonical-event',
        metadata: { event_id: 'legacy-event' },
      }),
      userId: 'user-1',
    })

    for (const table of ['event_tasks', 'venue_bookings', 'vendor_bookings', 'event_financial_summary']) {
      expect(db.eventFilters.get(table)).toEqual(['canonical-event'])
    }
    expect([...db.eventFilters.values()].flat()).not.toContain('plan-1')
    expect([...db.eventFilters.values()].flat()).not.toContain('legacy-event')
  })

  it('does not guess that the plan id is an event id when no lineage exists', async () => {
    const db = buildDb()

    await loadPlanAgentFields({
      db: db.client,
      plan: buildPlan({ materialized_event_id: null, metadata: {} }),
      userId: 'user-1',
    })

    expect(db.tables).not.toEqual(expect.arrayContaining([
      'event_tasks',
      'venue_bookings',
      'vendor_bookings',
      'event_financial_summary',
    ]))
  })
})

function buildPlan(overrides: Partial<Plan>): Plan {
  return {
    id: 'plan-1',
    user_id: 'user-1',
    title: 'Canonical event plan',
    event_type: 'community_meetup',
    status: 'executing',
    guest_count: 50,
    budget_cap_cents: 500000,
    neighborhood: 'Oakland',
    date_window_start: '2026-08-20',
    date_window_end: '2026-08-20',
    ticketed: false,
    profit_goal_cents: null,
    notes: null,
    metadata: {},
    created_at: '2026-07-09T12:00:00.000Z',
    updated_at: '2026-07-09T12:00:00.000Z',
    ...overrides,
  }
}

function buildDb() {
  const tables: string[] = []
  const eventFilters = new Map<string, string[]>()

  const client = {
    from: jest.fn((table: string) => {
      tables.push(table)
      const result = table === 'event_financial_summary'
        ? { data: null, error: null }
        : { data: [], error: null }
      const builder: Record<string, any> = {
        select: jest.fn(() => builder),
        update: jest.fn(() => builder),
        eq: jest.fn((column: string, value: unknown) => {
          if (column === 'event_id' && typeof value === 'string') {
            eventFilters.set(table, [...(eventFilters.get(table) ?? []), value])
          }
          return builder
        }),
        in: jest.fn(() => builder),
        order: jest.fn(() => builder),
        maybeSingle: jest.fn().mockResolvedValue(result),
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject),
      }
      return builder
    }),
  }

  return { client: client as never, tables, eventFilters }
}
