/** @jest-environment node */
jest.mock('server-only', () => ({}))
jest.mock('next/server', () => ({
  NextResponse: {
    json: (value: unknown, init?: ResponseInit) => new Response(JSON.stringify(value), {
      ...init,
      headers: { 'content-type': 'application/json' },
    }),
  },
}))
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn(), createServiceRoleClient: jest.fn() }))
jest.mock('@/lib/planner/planAgentSummaries', () => ({
  loadPlanAgentFields: async ({ plan }: { plan: unknown }) => ({ plan, workspace_summary: null, timeline: null }),
}))
jest.mock('@/lib/planner/planVendorSelections', () => ({
  enrichPlanSelectedVendors: async (_db: unknown, plan: unknown) => plan,
}))
jest.mock('@/lib/planner/pendingApprovals', () => ({
  enrichApprovalsWithActionState: async (_db: unknown, rows: unknown) => rows,
  loadPendingApprovalsForPlan: async () => [],
}))
jest.mock('@/lib/planner/baselines', () => ({
  lookupBaseline: async () => ({ source: 'default', nEvents: 0, avgSellThrough: 0.85, basisLabel: 'Fixture baseline' }),
}))
jest.mock('@/lib/server/logger', () => ({ rootLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }))

import type { NextRequest } from 'next/server'
import { GET as fullPlanGet } from '@/app/api/planner/plans/[planId]/route'
import { GET as recommendationsGet } from '@/app/api/planner/plans/[planId]/recommendations/route'
import { GET as mobileHomeGet } from '@/app/api/planner/plans/[planId]/mobile-home/route'
import { recomputePlanDerivedState } from '@/lib/planner/recomputeDerivedState'
import { createClient } from '@/lib/supabase/server'

type Row = Record<string, unknown>
type Result = { data: Row[] | Row | null; error: null }
const marker = { venue_content_unavailable: true, unavailable_code: 'legacy_discovery_evidence_missing' }
const context = { params: Promise.resolve({ planId: 'plan-1' }) }
const request = {} as NextRequest
const plan: Row = {
  id: 'plan-1', user_id: 'host-1', title: 'Host dinner', status: 'ready', guest_count: 30,
  budget_cap_cents: 200000, neighborhood: 'Oakland', event_type: 'dinner', ticketed: false,
  committed_venue_id: null, committed_venue_quoted_price_cents: null, committed_vendors: [],
  brief_render_version: 0, metadata: {},
}

function recommendation(id: string, metadata: unknown = {}): Row {
  return {
    id, plan_id: 'plan-1', type: 'venue', reference_id: null, external_name: id,
    price_cents: 70000, notes: `Notes for ${id}`, rank: 1, is_best_fit: true,
    status: 'pending', metadata, created_at: '2026-11-11T00:00:00Z',
  }
}

/** Returns only selected columns: a forgotten metadata projection must fail the regression. */
class ReadDb {
  rows: Record<string, Row[]>
  selections: Array<{ table: string; columns: string }> = []
  writes: Array<{ table: string; value: Row }> = []
  auth = { getUser: jest.fn().mockResolvedValue({ data: {
    user: { id: 'host-1', user_metadata: { user_type: 'community_builder' } },
  }, error: null }) }

  constructor(recommendations: Row[]) {
    this.rows = { plans: [{ ...plan }], recommendations }
  }
  from(table: string) { return new ReadQuery(this, table) }
}

class ReadQuery {
  private columns = '*'
  private predicates: Array<(row: Row) => boolean> = []
  private single = false
  private cap = Infinity
  private ordering?: { key: string; ascending: boolean }
  private mutation?: Row
  constructor(private db: ReadDb, private table: string) {}
  select(columns = '*') {
    this.columns = columns
    this.db.selections.push({ table: this.table, columns })
    return this
  }
  eq(key: string, value: unknown) { this.predicates.push(row => row[key] === value); return this }
  in(key: string, values: unknown[]) { this.predicates.push(row => values.includes(row[key])); return this }
  order(key: string, options: { ascending: boolean }) { this.ordering = { key, ascending: options.ascending }; return this }
  limit(value: number) { this.cap = value; return this }
  maybeSingle() { this.single = true; return this }
  upsert(value: Row) { this.mutation = value; return this }
  update(value: Row) { this.mutation = value; return this }
  then(resolve: (result: Result) => unknown, reject?: (error: unknown) => unknown) {
    return Promise.resolve().then(() => {
      if (this.mutation) {
        this.db.writes.push({ table: this.table, value: this.mutation })
        return { data: null, error: null } satisfies Result
      }
      let rows = (this.db.rows[this.table] ?? []).filter(row => this.predicates.every(predicate => predicate(row)))
      if (this.ordering) {
        const { key, ascending } = this.ordering
        rows = [...rows].sort((a, b) => (Number(a[key]) - Number(b[key])) * (ascending ? 1 : -1))
      }
      rows = rows.slice(0, this.cap).map(row => this.columns === '*' ? { ...row } : Object.fromEntries(
        this.columns.split(',').map(key => key.trim()).filter(key => key in row).map(key => [key, row[key]])
      ))
      return { data: this.single ? rows[0] ?? null : rows, error: null } satisfies Result
    }).then(resolve, reject)
  }
}

function assertMetadataSelected(db: ReadDb) {
  const reads = db.selections.filter(selection => selection.table === 'recommendations')
  expect(reads).toHaveLength(1)
  expect(reads[0].columns.split(',').map(column => column.trim())).toContain('metadata')
}

const readers = [
  ['full-plan GET', fullPlanGet],
  ['dedicated recommendations GET', recommendationsGet],
] as const

beforeEach(() => jest.clearAllMocks())

describe.each(readers)('%s', (_label, get) => {
  it('omits the exact marked row while preserving unmarked and partial-marker recommendations', async () => {
    const unaffected = [
      recommendation('ordinary'),
      recommendation('null-metadata', null),
      recommendation('partial-marker', { venue_content_unavailable: true }),
      recommendation('different-code', { ...marker, unavailable_code: 'another_reason' }),
      recommendation('string-boolean', { ...marker, venue_content_unavailable: 'true' }),
    ]
    const db = new ReadDb([recommendation('retired', marker), ...unaffected])
    ;(createClient as jest.Mock).mockReturnValue(db)

    const response = await get(request, context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.recommendations.map((row: Row) => row.id)).toEqual(unaffected.map(row => row.id))
    body.recommendations.forEach((row: Row, index: number) => expect(row).toMatchObject(unaffected[index]))
    assertMetadataSelected(db)
    expect(db.writes).toEqual([])
  })

  it('continues returning the pre-162 unmarked shape without suppressing its UUID identity', async () => {
    const original = { ...recommendation('ordinary'), reference_id: '550e8400-e29b-41d4-a716-446655440101' }
    const db = new ReadDb([original])
    ;(createClient as jest.Mock).mockReturnValue(db)

    const response = await get(request, context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.recommendations).toHaveLength(1)
    expect(body.recommendations[0]).toMatchObject(original)
    assertMetadataSelected(db)
  })

  it('preserves ownership checks before any recommendation read', async () => {
    const db = new ReadDb([recommendation('retired', marker)])
    db.rows.plans[0].user_id = 'different-host'
    ;(createClient as jest.Mock).mockReturnValue(db)
    expect((await get(request, context)).status).toBe(404)
    expect(db.selections.some(selection => selection.table === 'recommendations')).toBe(false)
  })
})

it.each([
  ['only marked', [recommendation('retired', marker)], 'No venue recommendations yet', 'Empty'],
  ['marked and unmarked', [recommendation('retired', marker), recommendation('ordinary')], '1 recommendation available', 'In review'],
  ['pre-162', [recommendation('ordinary')], '1 recommendation available', 'In review'],
] as const)('mobile-home GET uses the real read model: %s', async (_label, rows, detail, status) => {
  const db = new ReadDb([...rows])
  ;(createClient as jest.Mock).mockReturnValue(db)
  const response = await mobileHomeGet(request, context)
  const body = await response.json()
  expect(response.status).toBe(200)
  expect(body.progress.find((item: Row) => item.id === 'venues')).toMatchObject({ detail, status })
  assertMetadataSelected(db)
  expect(db.writes).toEqual([])
})

it('derived-state input excludes marked pending recommendations even before 162 retires their status', async () => {
  const retired = { ...recommendation('retired', marker), price_cents: 999999 }
  const ordinary = recommendation('ordinary')
  const db = new ReadDb([retired, ordinary])
  await recomputePlanDerivedState({ supabase: db, writeSupabase: db, planId: 'plan-1', trigger: 'discovery_change' })

  const derived = db.writes.find(write => write.table === 'plan_derived_state')?.value
  expect(derived?.shopping_list).toEqual([expect.objectContaining({ recommendation_id: 'ordinary', price_cents: 70000 })])
  expect(derived?.profit_assumptions).toMatchObject({ venue_cost_cents: 70000, venue_cost_source: 'active_recommendation' })
  expect(db.rows.recommendations).toEqual([retired, ordinary])
  assertMetadataSelected(db)
})
