import type { NextRequest } from 'next/server'
import { GET as getPlan, PATCH as patchPlan } from '@/app/api/planner/plans/[planId]/route'
import { GET as listPlans, POST as createPlan } from '@/app/api/planner/plans/route'
import { POST as postMessage } from '@/app/api/planner/plans/[planId]/messages/route'
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
  rows: Record<string, Row[]> = {
    plans: [],
    plan_messages: [],
    recommendations: [],
    approvals: [],
    planner_plan_updates: [],
    audit_logs: [],
    event_type_candidates: [],
  }

  private sequence = 0

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }

  nextId(table: string) {
    this.sequence += 1
    return `${table}-${this.sequence}`
  }
}

class MemoryQuery {
  private filters: Array<[string, unknown]> = []
  private operation: 'select' | 'insert' | 'update' = 'select'
  private payload: unknown
  private orderBy: { field: string; ascending: boolean } | null = null
  private rangeBy: { start: number; end: number } | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select() {
    return this
  }

  insert(payload: unknown) {
    this.operation = 'insert'
    this.payload = payload
    return this
  }

  update(payload: unknown) {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push([field, value])
    return this
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderBy = { field, ascending: options?.ascending ?? true }
    return this
  }

  range(start: number, end: number) {
    this.rangeBy = { start, end }
    return this
  }

  async single() {
    const result = await this.execute()
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: row ? null : { message: 'No row' } }
  }

  async maybeSingle() {
    const result = await this.execute()
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: null }
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected)
  }

  private async execute() {
    if (this.operation === 'insert') {
      const values = Array.isArray(this.payload) ? this.payload : [this.payload]
      const inserted = values.map((value) => this.withDefaults(value as Row))
      this.db.rows[this.table].push(...inserted)
      return { data: Array.isArray(this.payload) ? inserted : inserted[0], error: null }
    }

    if (this.operation === 'update') {
      const updates = this.payload as Row
      const updated: Row[] = []
      this.db.rows[this.table] = this.db.rows[this.table].map((row) => {
        if (!this.matches(row)) return row
        const next = { ...row, ...updates, updated_at: new Date().toISOString() }
        updated.push(next)
        return next
      })
      return { data: updated, error: null }
    }

    let selected = this.db.rows[this.table].filter((row) => this.matches(row))
    if (this.orderBy) {
      const { field, ascending } = this.orderBy
      selected = [...selected].sort((a, b) =>
        String(a[field] ?? '').localeCompare(String(b[field] ?? '')) * (ascending ? 1 : -1)
      )
    }
    if (this.rangeBy) selected = selected.slice(this.rangeBy.start, this.rangeBy.end + 1)

    return { data: selected, error: null }
  }

  private matches(row: Row) {
    return this.filters.every(([field, value]) => row[field] === value)
  }

  private withDefaults(row: Row) {
    const now = new Date().toISOString()
    const id = row.id ?? this.db.nextId(this.table)

    if (this.table === 'plans') {
      return {
        status: 'drafting',
        guest_count: null,
        budget_cap_cents: null,
        neighborhood: null,
        date_window_start: null,
        date_window_end: null,
        ticketed: false,
        profit_goal_cents: null,
        notes: null,
        created_at: now,
        updated_at: now,
        ...row,
        id,
      }
    }

    return { created_at: now, updated_at: now, ...row, id }
  }
}

function makeRequest(path: string, body?: Row, method = body ? 'POST' : 'GET') {
  const url = `http://localhost${path}`
  const request = new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as NextRequest

  Object.defineProperty(request, 'nextUrl', {
    value: new URL(url),
  })

  return request
}

async function readJson(response: Response) {
  const text = await response.text()
  return (text ? JSON.parse(text) : {}) as Row
}

describe('Planner persistence integration', () => {
  let db: MemoryDb

  beforeAll(() => {
    const responseWithJson = Response as typeof Response & {
      json?: (data: unknown, init?: ResponseInit) => Response
    }

    if (typeof responseWithJson.json !== 'function') {
      responseWithJson.json = (data: unknown, init?: ResponseInit) => {
        const headers = new Headers(init?.headers)
        headers.set('content-type', 'application/json')

        return new Response(JSON.stringify(data), { ...init, headers })
      }
    }
  })

  beforeEach(() => {
    db = new MemoryDb()
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: {
            user: {
              id: 'user-1',
              user_metadata: { user_type: 'community_builder' },
            },
          },
          error: null,
        }),
      },
      from: (table: string) => db.from(table),
    })
  })

  it('creates a plan, appends messages, transitions status, and reloads persisted state', async () => {
    const createResponse = await createPlan(makeRequest('/api/planner/plans', {
      message: 'I want to plan an event',
    }))
    const created = await readJson(createResponse)
    const planId = created.plan.id as string

    expect(createResponse.status).toBe(200)
    expect(created.messages).toHaveLength(2)

    for (const message of ['Event type: mixer', 'Date: June 12', '40 people']) {
      const response = await postMessage(makeRequest(`/api/planner/plans/${planId}/messages`, { message }), {
        params: { planId },
      })
      expect(response.status).toBe(200)
    }

    const readyResponse = await patchPlan(makeRequest(`/api/planner/plans/${planId}`, { status: 'ready' }, 'PATCH'), {
      params: { planId },
    })
    expect(readyResponse.status).toBe(200)

    const approvedResponse = await patchPlan(makeRequest(`/api/planner/plans/${planId}`, { status: 'approved' }, 'PATCH'), {
      params: { planId },
    })
    expect(approvedResponse.status).toBe(200)

    const listResponse = await listPlans(makeRequest('/api/planner/plans?limit=10'))
    const list = await readJson(listResponse)
    expect(list.plans[0].id).toBe(planId)
    expect(list.plans[0].status).toBe('approved')

    const reloadResponse = await getPlan(makeRequest(`/api/planner/plans/${planId}`), {
      params: { planId },
    })
    const reloaded = await readJson(reloadResponse)

    expect(reloadResponse.status).toBe(200)
    expect(reloaded.plan.status).toBe('approved')
    expect(reloaded.workspace_summary).toEqual(expect.objectContaining({
      current_status: 'on_track',
      blockers: [],
    }))
    expect(reloaded.timeline).toEqual(expect.objectContaining({
      impossible_timeline: expect.any(Boolean),
      planning_milestones: expect.any(Array),
    }))
    expect(reloaded.messages).toHaveLength(8)
    expect(db.rows.planner_plan_updates.filter((row) => row.field === 'status')).toHaveLength(2)
  })
})
