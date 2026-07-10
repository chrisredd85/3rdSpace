import {
  buildMobileAnalyticsReadModel,
  buildMobileBudgetReadModel,
  buildMobileHomeReadModel,
  type PlannerDb,
} from '@/lib/planner/mobileReadModels'
import type { Plan } from '@/lib/types'

type TableRows = Record<string, Array<Record<string, unknown>>>

class Query {
  private filters: Array<(row: Record<string, unknown>) => boolean> = []
  private limitCount: number | null = null
  private orderColumn: string | null = null
  private ascending = true

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  select() {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  in(column: string, values: unknown[]) {
    const allowed = new Set(values)
    this.filters.push((row) => allowed.has(row[column]))
    return this
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderColumn = column
    this.ascending = options?.ascending ?? true
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  maybeSingle() {
    const data = this.resultRows()[0] ?? null
    return Promise.resolve({ data, error: null })
  }

  then<TResult1 = { data: Record<string, unknown>[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Record<string, unknown>[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve({ data: this.resultRows(), error: null }).then(onfulfilled, onrejected)
  }

  private resultRows() {
    let rows = this.rows.filter((row) => this.filters.every((filter) => filter(row)))
    if (this.orderColumn) {
      rows = [...rows].sort((a, b) => {
        const left = String(a[this.orderColumn!] ?? '')
        const right = String(b[this.orderColumn!] ?? '')
        return this.ascending ? left.localeCompare(right) : right.localeCompare(left)
      })
    }
    return this.limitCount == null ? rows : rows.slice(0, this.limitCount)
  }
}

function createDb(rows: TableRows): PlannerDb {
  return {
    from(table: string) {
      return new Query(rows[table] ?? [])
    },
  }
}

const basePlan: Plan = {
  id: 'plan-1',
  user_id: 'user-1',
  title: 'Member dinner',
  event_type: 'dinner',
  status: 'ready',
  guest_count: 80,
  budget_cap_cents: 1200000,
  neighborhood: 'Mission',
  date_window_start: '2026-07-10',
  date_window_end: '2026-07-10',
  ticketed: true,
  ticketing_model: 'ticketed',
  food_responsibility: null,
  venue_terms: null,
  agent_action: null,
  profit_goal_cents: 200000,
  notes: null,
  metadata: {},
  created_at: '2026-06-04T00:00:00.000Z',
  updated_at: '2026-06-04T00:00:00.000Z',
}

describe('mobile planner read models', () => {
  it('builds budget totals from plan budget lines and cost commitments', async () => {
    const db = createDb({
      plan_budget: [{ plan_id: basePlan.id, target_cents: 1500000, buffer_target_cents: 150000 }],
      plan_budget_lines: [
        {
          id: 'line-1',
          plan_id: basePlan.id,
          category: 'venue',
          label: 'Venue',
          low_cents: 500000,
          high_cents: 700000,
          status: 'planned',
          source: 'manual',
          created_at: '2026-06-04T00:00:00.000Z',
        },
      ],
      event_cost_commitments: [
        {
          id: 'commitment-1',
          plan_id: basePlan.id,
          category: 'vendor',
          party_name: 'Catering',
          amount_cents: 300000,
          state: 'accepted',
          source: 'manual',
          created_at: '2026-06-04T00:01:00.000Z',
        },
      ],
    })

    const budget = await buildMobileBudgetReadModel(db, basePlan, 50000)

    expect(budget.target_cents).toBe(1500000)
    expect(budget.high_total_cents).toBe(1000000)
    expect(budget.committed_total_cents).toBe(300000)
    expect(budget.projected_buffer_high_cents).toBe(450000)
    expect(budget.lines).toHaveLength(2)
  })

  it('builds the mobile home aggregate from pending approvals and activity', async () => {
    const db = createDb({
      approvals: [
        {
          id: 'approval-1',
          plan_id: basePlan.id,
          action_label: 'Authorize venue hold',
          provider: 'Venue',
          price_cents: 0,
          status: 'pending',
          created_at: '2026-06-04T00:00:00.000Z',
          updated_at: '2026-06-04T00:00:00.000Z',
        },
        ...['2', '3', '4'].map((suffix) => ({
          id: `approval-${suffix}`,
          plan_id: basePlan.id,
          action_label: `Approval ${suffix}`,
          provider: 'Venue',
          price_cents: 0,
          status: 'pending',
          created_at: `2026-06-04T00:0${suffix}:00.000Z`,
          updated_at: `2026-06-04T00:0${suffix}:00.000Z`,
        })),
      ],
      recommendations: [
        {
          id: 'recommendation-1',
          plan_id: basePlan.id,
          type: 'venue',
          external_name: 'Venue option',
          rank: 1,
          status: 'pending',
          created_at: '2026-06-04T00:00:00.000Z',
        },
      ],
      plan_activity: [
        {
          id: 'activity-1',
          plan_id: basePlan.id,
          kind: 'problem',
          summary: 'Venue declined',
          payload: { detail: 'Replacement needed.' },
          occurred_at: '2026-06-04T00:02:00.000Z',
        },
      ],
      plan_messages: [
        {
          id: 'message-1',
          plan_id: basePlan.id,
          role: 'system',
          content: 'Budget refreshed',
          message_type: 'status_update',
          metadata: {},
          created_at: '2026-06-04T00:01:00.000Z',
        },
      ],
    })

    const home = await buildMobileHomeReadModel(db, basePlan)

    expect(home.pending_approval_count).toBe(4)
    expect(home.pending_approvals).toHaveLength(4)
    expect(home.problem?.summary).toBe('Venue declined')
    expect(home.progress.find((item) => item.id === 'venues')?.status).toBe('In review')
    expect(home.updates[0]?.summary).toBe('Budget refreshed')
  })

  it('builds deterministic analytics without requiring an LLM result', async () => {
    const db = createDb({
      events: [
        {
          id: 'event-1',
          builder_id: 'builder-1',
          event_name: 'Member dinner',
          event_type: 'dinner',
          event_date: '2026-07-10',
          status: 'completed',
        },
      ],
      event_financial_summary: [
        {
          event_id: 'event-1',
          net_revenue: 5000,
          total_costs: 3000,
          expected_profit: 2000,
          profit_margin: 40,
        },
      ],
    })

    const analytics = await buildMobileAnalyticsReadModel(db, 'builder-1')

    expect(analytics.events_per_year).toBe(1)
    expect(analytics.average_margin_percent).toBe(40)
    expect(analytics.best_format).toBe('dinner')
    expect(analytics.recommendation).toContain('Dinner')
  })
})
