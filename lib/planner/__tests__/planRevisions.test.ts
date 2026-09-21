jest.mock('server-only', () => ({}))

const recomputePlanDerivedStateMock = jest.fn()

jest.mock('@/lib/planner/recomputeDerivedState', () => ({
  recomputePlanDerivedState: (...args: unknown[]) => recomputePlanDerivedStateMock(...args),
}))

jest.mock('@/lib/server/logger', () => ({
  rootLogger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}))

import { applyPlanRevision, deriveEventBriefSections, detectPlanRevisionTrigger } from '@/lib/planner/planRevisions'

const materialPlan = {
  event_type: 'Networking mixer',
  guest_count: 40,
  budget_cap_cents: 500000,
  neighborhood: 'Downtown Oakland',
  date_window_start: '2026-07-10',
  date_window_end: '2026-07-10',
  status: 'ready',
}

describe('plan revision trigger detection', () => {
  beforeEach(() => {
    recomputePlanDerivedStateMock.mockReset().mockResolvedValue({
      profit_assumptions_changed: false,
      shopping_list_changed: false,
      auth_cards_changed: false,
      baseline_source_changed: false,
      new_brief_render_version: 1,
    })
  })

  it('detects negative food preferences after a plan has material state', () => {
    const trigger = detectPlanRevisionTrigger({
      plan: materialPlan,
      message: "Actually, no tacos. I don't want tacos for this event.",
    })

    expect(trigger).toEqual({
      type: 'negative_preference',
      field: 'excluded_cuisines',
      value: ['tacos'],
      source_message_excerpt: "Actually, no tacos. I don't want tacos for this event.",
    })
  })

  it('detects added vendor services that require rediscovery', () => {
    const trigger = detectPlanRevisionTrigger({
      plan: materialPlan,
      message: 'I also need flowers for the check-in table.',
    })

    expect(trigger).toEqual({
      type: 'vendor_stack_addition',
      field: 'service_type',
      value: 'florist',
      source_message_excerpt: 'I also need flowers for the check-in table.',
    })
  })

  it('detects removed vendor services', () => {
    const trigger = detectPlanRevisionTrigger({
      plan: materialPlan,
      message: 'We do not need a photographer anymore.',
    })

    expect(trigger).toEqual({
      type: 'vendor_stack_removal',
      field: 'service_type',
      value: 'photographer',
      source_message_excerpt: 'We do not need a photographer anymore.',
    })
  })

  it('detects positive vendor preferences', () => {
    const trigger = detectPlanRevisionTrigger({
      plan: materialPlan,
      message: 'Please prioritize local vendors that can deliver.',
    })

    expect(trigger).toEqual({
      type: 'positive_preference',
      field: 'vendor_attributes',
      value: 'Please prioritize local vendors that can deliver.',
      source_message_excerpt: 'Please prioritize local vendors that can deliver.',
    })
  })

  it('does not classify early intake as a revision before enough plan state exists', () => {
    const trigger = detectPlanRevisionTrigger({
      plan: {
        event_type: null,
        guest_count: null,
        budget_cap_cents: null,
        neighborhood: null,
        date_window_start: null,
        date_window_end: null,
        status: 'drafting',
      },
      message: 'I want tacos for 40 people.',
    })

    expect(trigger).toBeNull()
  })

  it('marks budget changes as event brief financial refreshes', () => {
    const sections = deriveEventBriefSections({
      type: 'budget_change',
      field: 'budget_cap_cents',
      value: 500000,
    })

    expect(sections).toEqual(expect.arrayContaining([
      'event_summary',
      'budget',
      'costs',
      'projections',
      'analytics',
      'recommendations',
      'approvals',
    ]))
  })

  it('marks vendor stack changes as event brief cost and projection refreshes', () => {
    const sections = deriveEventBriefSections({
      type: 'vendor_stack_addition',
      field: 'service_type',
      value: 'florist',
    })

    expect(sections).toEqual(expect.arrayContaining([
      'event_summary',
      'vendor_stack',
      'costs',
      'projections',
      'analytics',
      'recommendations',
      'approvals',
    ]))
  })
})

describe('applyPlanRevision atomic RPC wrapper', () => {
  beforeEach(() => {
    recomputePlanDerivedStateMock.mockReset().mockResolvedValue({
      profit_assumptions_changed: false,
      shopping_list_changed: false,
      auth_cards_changed: false,
      baseline_source_changed: false,
      new_brief_render_version: 2,
    })
  })

  it('applies plan revisions through one atomic RPC and recomputes derived state', async () => {
    const db = createRevisionDb({
      plan: {
        ...materialPlan,
        id: 'plan-1',
        user_id: 'user-1',
        title: 'Networking mixer plan',
        ticketed: false,
        profit_goal_cents: null,
        notes: null,
        excluded_cuisines: [],
        excluded_vendor_attributes: {},
        preferred_vendor_attributes: {},
        plan_revision_count: 3,
        metadata: {},
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      },
      recommendations: [{ id: 'rec-1', plan_id: 'plan-1', status: 'pending' }],
      approvals: [{ id: 'approval-1', plan_id: 'plan-1', status: 'pending' }],
      outreach_threads: [{ id: 'thread-1', plan_id: 'plan-1', state: 'draft' }],
      rpcResult: [{ revision_id: 'revision-1', impact: {}, new_revision_count: 4 }],
    })

    const baselineDb = { from: jest.fn() }
    const result = await applyPlanRevision({
      supabase: db as any,
      baselineSupabase: baselineDb as any,
      planId: 'plan-1',
      userId: 'user-1',
      trigger: {
        type: 'budget_change',
        field: 'budget_cap_cents',
        value: 650000,
      },
      sourceMessageId: 'message-1',
    })

    expect(result.revision_id).toBe('revision-1')
    expect(db.rpcCalls).toEqual([
      expect.objectContaining({
        fn: 'apply_plan_revision_atomic',
        args: expect.objectContaining({
          p_plan_id: 'plan-1',
          p_user_id: 'user-1',
          p_source_message_id: 'message-1',
          p_plan_updates: expect.objectContaining({
            budget_cap_cents: 650000,
            plan_revision_count: 4,
          }),
          p_impact: expect.objectContaining({
            invalidated_recommendation_ids: ['rec-1'],
            superseded_approval_ids: ['approval-1'],
            superseded_outreach_thread_ids: ['thread-1'],
          }),
        }),
      }),
    ])
    expect(recomputePlanDerivedStateMock).toHaveBeenCalledWith({
      supabase: db,
      baselineSupabase: baselineDb,
      planId: 'plan-1',
      trigger: 'plan_revision',
      revisionId: 'revision-1',
    })
  })

  it('does not enqueue rediscovery or recompute derived state when the RPC fails', async () => {
    const db = createRevisionDb({
      plan: {
        ...materialPlan,
        id: 'plan-1',
        user_id: 'user-1',
        title: 'Networking mixer plan',
        ticketed: false,
        profit_goal_cents: null,
        notes: null,
        excluded_cuisines: [],
        excluded_vendor_attributes: {},
        preferred_vendor_attributes: {},
        plan_revision_count: 0,
        metadata: {},
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      },
      recommendations: [],
      approvals: [],
      outreach_threads: [],
      rpcError: { message: 'transaction rolled back' },
    })

    await expect(applyPlanRevision({
      supabase: db as any,
      planId: 'plan-1',
      userId: 'user-1',
      trigger: {
        type: 'budget_change',
        field: 'budget_cap_cents',
        value: 650000,
      },
    })).rejects.toThrow('Revision failed: transaction rolled back')

    expect(recomputePlanDerivedStateMock).not.toHaveBeenCalled()
    expect(db.rows.plan_messages ?? []).toHaveLength(0)
  })

  it('keeps the revision successful when rediscovery status message insert fails', async () => {
    const db = createRevisionDb({
      plan: {
        ...materialPlan,
        id: 'plan-1',
        user_id: 'user-1',
        title: 'Networking mixer plan',
        ticketed: false,
        profit_goal_cents: null,
        notes: null,
        excluded_cuisines: [],
        excluded_vendor_attributes: {},
        preferred_vendor_attributes: {},
        plan_revision_count: 0,
        metadata: {},
        created_at: '2026-06-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      },
      recommendations: [],
      approvals: [],
      outreach_threads: [],
      rpcResult: [{ revision_id: 'revision-1', impact: {}, new_revision_count: 1 }],
      insertErrors: { plan_messages: { message: 'queue unavailable' } },
    })

    await expect(applyPlanRevision({
      supabase: db as any,
      planId: 'plan-1',
      userId: 'user-1',
      trigger: {
        type: 'vendor_stack_addition',
        field: 'service_type',
        value: 'florist',
      },
    })).resolves.toEqual(expect.objectContaining({ revision_id: 'revision-1' }))
    expect(recomputePlanDerivedStateMock).toHaveBeenCalled()
  })
})

function createRevisionDb(input: {
  plan: Record<string, unknown>
  recommendations: Array<Record<string, unknown>>
  approvals: Array<Record<string, unknown>>
  outreach_threads: Array<Record<string, unknown>>
  rpcResult?: unknown
  rpcError?: { message: string }
  insertErrors?: Record<string, { message: string }>
}) {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    plans: [input.plan],
    recommendations: input.recommendations,
    approvals: input.approvals,
    outreach_threads: input.outreach_threads,
    plan_revisions: [],
    plan_messages: [],
  }
  const rpcCalls: Array<{ fn: string; args?: Record<string, unknown> }> = []
  return {
    rows,
    rpcCalls,
    rpc(fn: string, args?: Record<string, unknown>) {
      rpcCalls.push({ fn, args })
      return Promise.resolve({
        data: input.rpcResult ?? null,
        error: input.rpcError ?? null,
      })
    },
    from(table: string) {
      return new RevisionQuery(rows, table, input.insertErrors?.[table] ?? null)
    },
  }
}

class RevisionQuery {
  private filters: Array<(row: Record<string, unknown>) => boolean> = []
  private insertPayload: Record<string, unknown> | Array<Record<string, unknown>> | null = null
  private limitCount: number | null = null
  private operation: 'select' | 'insert' = 'select'

  constructor(
    private rows: Record<string, Array<Record<string, unknown>>>,
    private table: string,
    private insertError: { message: string } | null
  ) {}

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

  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value)
    return this
  }

  gte(column: string, value: unknown) {
    this.filters.push((row) => String(row[column] ?? '') >= String(value))
    return this
  }

  not() {
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  insert(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
    this.operation = 'insert'
    this.insertPayload = payload
    return this
  }

  maybeSingle() {
    const result = this.execute()
    return Promise.resolve({
      data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
      error: result.error,
    })
  }

  then(resolve: (value: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }) => void) {
    resolve(this.execute())
  }

  private execute() {
    const tableRows = this.rows[this.table] ?? []
    if (this.operation === 'insert') {
      if (this.insertError) return { data: null, error: this.insertError }
      const inserts = Array.isArray(this.insertPayload)
        ? this.insertPayload
        : [this.insertPayload].filter(Boolean) as Array<Record<string, unknown>>
      tableRows.push(...inserts)
      this.rows[this.table] = tableRows
      return { data: inserts, error: null }
    }

    const matches = tableRows.filter((row) => this.filters.every((filter) => filter(row)))
    const data = this.limitCount === null ? matches : matches.slice(0, this.limitCount)
    return { data, error: null }
  }
}
