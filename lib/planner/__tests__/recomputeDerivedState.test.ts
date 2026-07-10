jest.mock('server-only', () => ({}))

const lookupBaselineMock = jest.fn()
const loggerInfoMock = jest.fn()

jest.mock('@/lib/planner/baselines', () => ({
  lookupBaseline: (...args: unknown[]) => lookupBaselineMock(...args),
}))

jest.mock('@/lib/server/logger', () => ({
  rootLogger: {
    info: (...args: unknown[]) => loggerInfoMock(...args),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import { recomputePlanDerivedState } from '@/lib/planner/recomputeDerivedState'

type Row = Record<string, any>

const defaultBaseline = {
  source: 'default',
  avgSellThrough: 0.85,
  avgNoShowRate: 0.15,
  avgAttendanceRate: 0.85,
  avgMarginCents: null,
  stddevMarginCents: null,
  nEvents: 0,
  basisLabel: 'Industry default',
}

describe('recomputePlanDerivedState', () => {
  beforeEach(() => {
    lookupBaselineMock.mockReset().mockResolvedValue(defaultBaseline)
    loggerInfoMock.mockReset()
  })

  it('uses committed venue price ahead of active recommendation price', async () => {
    const db = createDerivedStateDb({
      plans: [planRow({
        committed_venue_id: 'venue-1',
        committed_venue_quoted_price_cents: 180000,
        brief_render_version: 5,
      })],
      recommendations: [
        recommendationRow({ id: 'rec-venue', type: 'venue', price_cents: 240000 }),
      ],
      approvals: [],
      plan_derived_state: [],
    })

    const result = await recomputePlanDerivedState({
      supabase: db as any,
      writeSupabase: db as any,
      planId: 'plan-1',
      trigger: 'commit_changed',
    })

    expect(result.new_brief_render_version).toBe(6)
    expect(db.rows.plans[0].brief_render_version).toBe(6)
    expect(db.rows.plan_derived_state[0].profit_assumptions).toEqual(expect.objectContaining({
      venue_cost_cents: 180000,
      venue_cost_source: 'committed_quote',
    }))
  })

  it('reverts profit assumptions to active recommendation after commit cancellation', async () => {
    const db = createDerivedStateDb({
      plans: [planRow({ brief_render_version: 1 })],
      recommendations: [
        recommendationRow({ id: 'rec-venue', type: 'venue', price_cents: 240000 }),
      ],
      approvals: [],
      plan_derived_state: [
        {
          plan_id: 'plan-1',
          profit_assumptions: { venue_cost_cents: 180000, venue_cost_source: 'committed_quote' },
          shopping_list: [],
          authorization_cards: [],
          baseline_source: 'default',
          baseline_n_events: 0,
          brief_render_version: 1,
        },
      ],
    })

    const result = await recomputePlanDerivedState({
      supabase: db as any,
      writeSupabase: db as any,
      planId: 'plan-1',
      trigger: 'cancel_commit',
    })

    expect(result.profit_assumptions_changed).toBe(true)
    expect(db.rows.plan_derived_state[0].profit_assumptions).toEqual(expect.objectContaining({
      venue_cost_cents: 240000,
      venue_cost_source: 'active_recommendation',
    }))
  })

  it('reports baseline source changes when a revision changes the matching baseline', async () => {
    lookupBaselineMock.mockResolvedValue({
      ...defaultBaseline,
      source: 'archetype',
      nEvents: 7,
      basisLabel: 'Based on 7 similar events',
    })
    const db = createDerivedStateDb({
      plans: [planRow()],
      recommendations: [],
      approvals: [],
      plan_derived_state: [
        {
          plan_id: 'plan-1',
          profit_assumptions: {},
          shopping_list: [],
          authorization_cards: [],
          baseline_source: 'personal',
          baseline_n_events: 4,
          brief_render_version: 0,
        },
      ],
    })

    const result = await recomputePlanDerivedState({
      supabase: db as any,
      writeSupabase: db as any,
      planId: 'plan-1',
      trigger: 'plan_revision',
      revisionId: 'revision-1',
    })

    expect(result.baseline_source_changed).toBe(true)
    expect(db.rows.plan_derived_state[0]).toEqual(expect.objectContaining({
      baseline_source: 'archetype',
      baseline_n_events: 7,
    }))
  })

  it('reads protected organizer baselines through the separately authorized client', async () => {
    const db = createDerivedStateDb({
      plans: [planRow()],
      recommendations: [],
      approvals: [],
      plan_derived_state: [],
    })
    const baselineDb = { from: jest.fn() }

    await recomputePlanDerivedState({
      supabase: db as any,
      writeSupabase: db as any,
      baselineSupabase: baselineDb as any,
      planId: 'plan-1',
      trigger: 'plan_revision',
    })

    expect(lookupBaselineMock).toHaveBeenCalledWith(
      baselineDb,
      expect.objectContaining({ organizerId: 'user-1' })
    )
  })

  it('omits stale discovery recommendations from the shopping list', async () => {
    const db = createDerivedStateDb({
      plans: [planRow()],
      recommendations: [
        recommendationRow({ id: 'rec-active', type: 'venue', status: 'pending', price_cents: 240000 }),
        recommendationRow({ id: 'rec-stale', type: 'venue', status: 'invalidated_entity_closed', price_cents: 100000 }),
      ],
      approvals: [],
      plan_derived_state: [],
    })

    await recomputePlanDerivedState({
      supabase: db as any,
      writeSupabase: db as any,
      planId: 'plan-1',
      trigger: 'discovery_change',
      discoveryChangeId: 'discovery_venue:venue-1:business_status',
    })

    expect(db.rows.plan_derived_state[0].shopping_list).toEqual([
      expect.objectContaining({ recommendation_id: 'rec-active' }),
    ])
  })

  it('increments brief_render_version monotonically across trigger types', async () => {
    const db = createDerivedStateDb({
      plans: [planRow({ brief_render_version: 0 })],
      recommendations: [],
      approvals: [],
      plan_derived_state: [],
    })

    await recomputePlanDerivedState({ supabase: db as any, writeSupabase: db as any, planId: 'plan-1', trigger: 'plan_revision' })
    await recomputePlanDerivedState({ supabase: db as any, writeSupabase: db as any, planId: 'plan-1', trigger: 'discovery_change' })
    await recomputePlanDerivedState({ supabase: db as any, writeSupabase: db as any, planId: 'plan-1', trigger: 'commit_changed' })

    expect(db.rows.plans[0].brief_render_version).toBe(3)
    expect(db.rows.plan_derived_state[0].brief_render_version).toBe(3)
  })
})

function planRow(overrides: Row = {}): Row {
  return {
    id: 'plan-1',
    user_id: 'user-1',
    title: 'Planner test plan',
    event_type: 'happy_hour',
    status: 'ready',
    guest_count: 40,
    budget_cap_cents: 500000,
    neighborhood: 'Downtown Oakland',
    event_city: 'oakland',
    date_window_start: '2026-07-10',
    date_window_end: '2026-07-10',
    ticketed: true,
    ticketing_model: 'Ticketed',
    food_responsibility: null,
    venue_terms: null,
    agent_action: null,
    profit_goal_cents: null,
    notes: null,
    excluded_cuisines: [],
    excluded_vendor_attributes: {},
    preferred_vendor_attributes: {},
    vendor_same_city_required: true,
    vendor_out_of_city_approved: false,
    vendor_approved_adjacent_cities: [],
    special_supply_radius_miles: null,
    plan_revision_count: 0,
    brief_render_version: 0,
    derived_state_recomputed_at: null,
    committed_venue_id: null,
    committed_venue_quoted_price_cents: null,
    committed_venue_quoted_deal_model: null,
    committed_venue_quoted_terms: null,
    committed_venue_at: null,
    committed_vendors: [],
    metadata: { ticket_price_target_cents: 4500 },
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function recommendationRow(overrides: Row = {}): Row {
  return {
    id: 'rec-1',
    plan_id: 'plan-1',
    type: 'venue',
    reference_id: 'venue-1',
    external_name: 'Moongate Lounge',
    price_cents: 200000,
    notes: null,
    rank: 1,
    is_best_fit: true,
    status: 'pending',
    metadata: {},
    created_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function createDerivedStateDb(rows: Record<string, Row[]>) {
  return {
    rows,
    from(table: string) {
      return new DerivedStateQuery(rows, table)
    },
  }
}

class DerivedStateQuery {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'select' | 'upsert' | 'update' = 'select'
  private payload: Row | null = null

  constructor(private rows: Record<string, Row[]>, private table: string) {}

  select() {
    this.operation = 'select'
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]))
    return this
  }

  order() {
    return this
  }

  update(payload: Row) {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  upsert(payload: Row) {
    this.operation = 'upsert'
    this.payload = payload
    return this
  }

  maybeSingle() {
    const result = this.execute()
    return Promise.resolve({
      data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
      error: result.error,
    })
  }

  then(resolve: (value: { data: Row[] | null; error: null }) => void) {
    resolve(this.execute())
  }

  private execute() {
    const tableRows = this.rows[this.table] ?? []
    if (this.operation === 'update' && this.payload) {
      for (const row of tableRows.filter((item) => this.filters.every((filter) => filter(item)))) {
        Object.assign(row, this.payload)
      }
      return { data: tableRows, error: null }
    }

    if (this.operation === 'upsert' && this.payload) {
      const planId = this.payload.plan_id
      const existing = tableRows.find((row) => row.plan_id === planId)
      if (existing) Object.assign(existing, this.payload)
      else tableRows.push(this.payload)
      this.rows[this.table] = tableRows
      return { data: [this.payload], error: null }
    }

    return {
      data: tableRows.filter((row) => this.filters.every((filter) => filter(row))),
      error: null,
    }
  }
}
