jest.mock('server-only', () => ({}))

const applyPlanRevisionMock = jest.fn()
const recomputePlanDerivedStateMock = jest.fn()

jest.mock('@/lib/planner/planRevisions', () => ({
  applyPlanRevision: (...args: unknown[]) => applyPlanRevisionMock(...args),
}))

jest.mock('@/lib/planner/recomputeDerivedState', () => ({
  recomputePlanDerivedState: (...args: unknown[]) => recomputePlanDerivedStateMock(...args),
}))

import { cascadeInvalidationForEntityChange } from '@/lib/discovery/cascadeInvalidation'

type Row = Record<string, any>

describe('discovery cascade invalidation', () => {
  beforeEach(() => {
    applyPlanRevisionMock.mockReset().mockResolvedValue({
      revision_id: 'revision-1',
      impact: {
        invalidated_recommendation_ids: [],
        superseded_approval_ids: [],
        superseded_outreach_thread_ids: [],
        flagged_committed_ids: [],
        triggers_rediscovery: ['venue', 'vendor'],
        event_brief_sections: ['recommendations'],
      },
    })
    recomputePlanDerivedStateMock.mockReset().mockResolvedValue({
      profit_assumptions_changed: false,
      shopping_list_changed: true,
      auth_cards_changed: false,
      baseline_source_changed: false,
      new_brief_render_version: 2,
    })
  })

  it('supersedes discovery candidates, marks outreach stale, and applies a plan revision', async () => {
    const db = createFakeSupabase({
      recommendations: [
        { id: 'rec-1', plan_id: 'plan-1', type: 'venue', reference_id: 'venue-1', status: 'pending' },
      ],
      plan_discovery_venue_candidates: [
        { id: 'candidate-1', plan_id: 'plan-1', discovery_venue_id: 'venue-1', status: 'candidate' },
      ],
      outreach_threads: [
        { id: 'thread-1', plan_id: 'plan-1', user_id: 'user-1', discovery_venue_id: 'venue-1', state: 'awaiting_reply' },
      ],
      plans: [
        { id: 'plan-1', user_id: 'user-1', committed_venue_id: null, committed_vendors: [] },
      ],
      outreach_notifications: [],
    })

    const impact = await cascadeInvalidationForEntityChange({
      supabase: db as any,
      entityType: 'discovery_venue',
      entityId: 'venue-1',
      changedField: 'business_status',
      newValue: 'CLOSED_PERMANENTLY',
    })

    expect(impact.invalidated_recommendation_ids).toEqual(['rec-1'])
    expect(impact.superseded_outreach_thread_ids).toEqual(['thread-1'])
    expect(db.rows.plan_discovery_venue_candidates[0].status).toBe('superseded')
    expect(db.rows.outreach_threads[0]).toEqual(expect.objectContaining({
      state: 'stale',
      needs_attention: true,
    }))
    expect(db.rows.outreach_notifications).toHaveLength(1)
    expect(applyPlanRevisionMock).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'plan-1',
      userId: 'user-1',
      trigger: expect.objectContaining({
        type: 'discovery_data_changed',
        field: 'business_status',
      }),
    }))
    expect(recomputePlanDerivedStateMock).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'plan-1',
      trigger: 'discovery_change',
      discoveryChangeId: 'discovery_venue:venue-1:business_status',
    }))
  })

  it('flags committed vendor snapshots without auto-removing them', async () => {
    const db = createFakeSupabase({
      recommendations: [],
      plan_discovery_vendor_candidates: [
        { id: 'candidate-1', plan_id: 'plan-2', discovery_vendor_id: 'vendor-1', status: 'approval_created' },
      ],
      outreach_threads: [],
      plans: [
        { id: 'plan-2', user_id: 'user-2', committed_vendors: [{ vendor_id: 'vendor-1', quoted_package_cents: 80000 }] },
      ],
      outreach_notifications: [],
    })

    const impact = await cascadeInvalidationForEntityChange({
      supabase: db as any,
      entityType: 'discovery_vendor',
      entityId: 'vendor-1',
      changedField: 'website',
      newValue: 'https://updated.example',
    })

    expect(impact.flagged_commitment_ids).toEqual(['discovery_vendor:vendor-1:plan-2'])
    expect(db.rows.plans[0].committed_vendors).toEqual([{ vendor_id: 'vendor-1', quoted_package_cents: 80000 }])
    expect(applyPlanRevisionMock).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'plan-2',
      userId: 'user-2',
    }))
  })
})

function createFakeSupabase(rows: Record<string, Row[]>) {
  return {
    rows,
    from(table: string) {
      return new FakeQuery(rows, table)
    },
  }
}

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = []
  private updatePayload: Row | null = null
  private insertPayload: Row | Row[] | null = null
  private limitCount: number | null = null
  private operation: 'select' | 'update' | 'insert' = 'select'

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

  not(column: string, operator: string, value: unknown) {
    if (operator === 'is' && value === null) {
      this.filters.push((row) => row[column] !== null && row[column] !== undefined)
    }
    return this
  }

  gt(column: string, value: unknown) {
    this.filters.push((row) => row[column] > value)
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  update(payload: Row) {
    this.operation = 'update'
    this.updatePayload = payload
    return this
  }

  insert(payload: Row | Row[]) {
    this.operation = 'insert'
    this.insertPayload = payload
    return this
  }

  then(resolve: (value: { data: Row[] | null; error: null }) => void) {
    resolve(this.execute())
  }

  private execute() {
    const tableRows = this.rows[this.table] ?? []
    if (this.operation === 'insert') {
      const inserts = Array.isArray(this.insertPayload) ? this.insertPayload : [this.insertPayload].filter(Boolean) as Row[]
      tableRows.push(...inserts)
      this.rows[this.table] = tableRows
      return { data: inserts, error: null }
    }

    const matches = tableRows.filter((row) => this.filters.every((filter) => filter(row)))
    if (this.operation === 'update' && this.updatePayload) {
      for (const row of matches) Object.assign(row, this.updatePayload)
    }
    const data = this.limitCount === null ? matches : matches.slice(0, this.limitCount)
    return { data, error: null }
  }
}
