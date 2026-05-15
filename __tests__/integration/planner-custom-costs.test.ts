/**
 * Integration tests for the custom costs API route.
 *
 * Verifies that PUT /api/planner/plans/[planId]/custom-costs stores the
 * custom_costs array inside plan metadata without overwriting other metadata
 * fields, and that validation rejects bad payloads.
 */

import type { NextRequest } from 'next/server'
import { PUT as putCustomCosts } from '@/app/api/planner/plans/[planId]/custom-costs/route'
import { createClient } from '@/lib/supabase/server'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
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

const mockCreateClient = createClient as jest.Mock

type Row = Record<string, any>

class MemoryDb {
  rows: Record<string, Row[]> = { plans: [] }
  private sequence = 0
  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }
  nextId(table: string) { this.sequence += 1; return `${table}-${this.sequence}` }
}

class MemoryQuery {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'select' | 'update' = 'select'
  private payload: unknown
  private columns = '*'

  constructor(private db: MemoryDb, private table: string) {}

  select(cols = '*') { this.columns = cols; return this }
  update(payload: unknown) { this.operation = 'update'; this.payload = payload; return this }
  eq(field: string, value: unknown) { this.filters.push((row) => row[field] === value); return this }

  async maybeSingle() {
    const rows = this.db.rows[this.table].filter((row) => this.filters.every((f) => f(row)))
    return { data: rows[0] ?? null, error: null }
  }

  then<TResult1 = { data: Row[]; error: null }>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
  ) {
    return this.execute().then(onfulfilled)
  }

  private async execute() {
    if (this.operation === 'update') {
      const updates = this.payload as Row
      const updated: Row[] = []
      this.db.rows[this.table] = this.db.rows[this.table].map((row) => {
        if (!this.filters.every((f) => f(row))) return row
        const next = { ...row, ...updates, updated_at: new Date().toISOString() }
        updated.push(next)
        return next
      })
      return { data: updated, error: null }
    }
    const selected = this.db.rows[this.table].filter((row) => this.filters.every((f) => f(row)))
    return { data: selected, error: null }
  }
}

function makeRequest(path: string, body: Row) {
  const url = `http://localhost${path}`
  const request = new Request(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
  Object.defineProperty(request, 'nextUrl', { value: new URL(url) })
  return request
}

async function readJson(response: Response) {
  const text = await response.text()
  return (text ? JSON.parse(text) : {}) as Row
}

describe('Custom costs API', () => {
  let db: MemoryDb

  beforeAll(() => {
    const responseWithJson = Response as typeof Response & { json?: (data: unknown, init?: ResponseInit) => Response }
    if (typeof responseWithJson.json !== 'function') {
      responseWithJson.json = (data: unknown, init?: ResponseInit) => {
        const headers = new Headers(init?.headers)
        headers.set('content-type', 'application/json')
        return new Response(JSON.stringify(data), { ...init, headers })
      }
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()
    db = new MemoryDb()
    db.rows.plans.push({
      id: 'plan-1',
      user_id: 'user-1',
      metadata: { ticket_price_target_cents: 5000 },
    })
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-1', user_metadata: { user_type: 'community_builder' } } },
          error: null,
        }),
      },
      from: (table: string) => db.from(table),
    })
  })

  it('stores custom costs in plan metadata and returns ok', async () => {
    const costs = [
      { id: '00000000-0000-0000-0000-000000000001', label: 'Permit fees', amount: 150, created_at: '2026-05-15T00:00:00.000Z' },
      { id: '00000000-0000-0000-0000-000000000002', label: 'Meta ads', amount: 250, created_at: '2026-05-15T00:01:00.000Z' },
    ]

    const response = await putCustomCosts(
      makeRequest('/api/planner/plans/plan-1/custom-costs', { custom_costs: costs }),
      { params: { planId: 'plan-1' } }
    )

    expect(response.status).toBe(200)
    const body = await readJson(response)
    expect(body.ok).toBe(true)

    const updatedPlan = db.rows.plans.find((p) => p.id === 'plan-1')
    expect(updatedPlan?.metadata.custom_costs).toHaveLength(2)
    expect(updatedPlan?.metadata.custom_costs[0].label).toBe('Permit fees')
    expect(updatedPlan?.metadata.custom_costs[1].amount).toBe(250)
    // Existing metadata fields must be preserved
    expect(updatedPlan?.metadata.ticket_price_target_cents).toBe(5000)
  })

  it('stores an empty array to clear all custom costs', async () => {
    // Seed existing costs
    db.rows.plans[0].metadata = { custom_costs: [{ id: '00000000-0000-0000-0000-000000000001', label: 'Old cost', amount: 100, created_at: '2026-05-14T00:00:00.000Z' }] }

    const response = await putCustomCosts(
      makeRequest('/api/planner/plans/plan-1/custom-costs', { custom_costs: [] }),
      { params: { planId: 'plan-1' } }
    )

    expect(response.status).toBe(200)
    const updatedPlan = db.rows.plans.find((p) => p.id === 'plan-1')
    expect(updatedPlan?.metadata.custom_costs).toHaveLength(0)
  })

  it('returns 400 for a cost entry with a zero amount', async () => {
    const response = await putCustomCosts(
      makeRequest('/api/planner/plans/plan-1/custom-costs', {
        custom_costs: [{ id: '00000000-0000-0000-0000-000000000001', label: 'Bad cost', amount: 0, created_at: '2026-05-15T00:00:00.000Z' }],
      }),
      { params: { planId: 'plan-1' } }
    )

    expect(response.status).toBe(400)
  })

  it('returns 400 for a cost entry with an empty label', async () => {
    const response = await putCustomCosts(
      makeRequest('/api/planner/plans/plan-1/custom-costs', {
        custom_costs: [{ id: '00000000-0000-0000-0000-000000000001', label: '   ', amount: 100, created_at: '2026-05-15T00:00:00.000Z' }],
      }),
      { params: { planId: 'plan-1' } }
    )

    expect(response.status).toBe(400)
  })

  it('returns 400 for a cost entry with an invalid UUID', async () => {
    const response = await putCustomCosts(
      makeRequest('/api/planner/plans/plan-1/custom-costs', {
        custom_costs: [{ id: 'not-a-uuid', label: 'Permit', amount: 150, created_at: '2026-05-15T00:00:00.000Z' }],
      }),
      { params: { planId: 'plan-1' } }
    )

    expect(response.status).toBe(400)
  })

  it('returns 404 when the plan does not belong to the user', async () => {
    const response = await putCustomCosts(
      makeRequest('/api/planner/plans/other-plan/custom-costs', {
        custom_costs: [],
      }),
      { params: { planId: 'other-plan' } }
    )

    expect(response.status).toBe(404)
  })
})
