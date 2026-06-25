jest.mock('server-only', () => ({}))

jest.mock('@/lib/outreach/gmailApprovalFlow', () => ({
  GmailConnectionRequiredError: class GmailConnectionRequiredError extends Error {
    constructor() {
      super('Connect Gmail before creating outreach approvals.')
      this.name = 'GmailConnectionRequiredError'
    }
  },
  createOrReuseGmailOutreachApproval: jest.fn(),
}))

import {
  createDateChangeOutreachApproval,
  DateChangeNoTargetsError,
} from '@/lib/planner/dateChangeOutreach'
import { createOrReuseGmailOutreachApproval } from '@/lib/outreach/gmailApprovalFlow'

const mockCreateApproval = createOrReuseGmailOutreachApproval as jest.Mock

type Row = Record<string, any>

class MemoryDb {
  rows: Record<string, Row[]> = {
    plans: [{
      id: 'plan-1',
      user_id: 'user-1',
      title: 'Founder Dinner',
      event_type: 'dinner',
      status: 'ready',
      guest_count: 72,
      budget_cap_cents: 1000000,
      neighborhood: 'Mission',
      date_window_start: '2026-06-28',
      date_window_end: '2026-06-28',
      ticketed: true,
      ticketing_model: 'paid',
      food_responsibility: 'venue',
      venue_terms: null,
      agent_action: null,
      profit_goal_cents: null,
      notes: null,
      metadata: { existing: true },
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
    }],
    creator_email_accounts: [{
      id: 'gmail-1',
      user_id: 'user-1',
      provider: 'gmail',
      revoked_at: null,
      created_at: '2026-06-01T00:00:00.000Z',
    }],
    outreach_threads: [{
      id: 'thread-1',
      user_id: 'user-1',
      plan_id: 'plan-1',
      target_name: 'Moongate Lounge',
      target_type: 'venue',
      target_email: 'events@moongate.example',
      updated_at: '2026-06-02T00:00:00.000Z',
    }],
    plan_messages: [],
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
  private nullFilters: string[] = []
  private operation: 'select' | 'insert' | 'update' = 'select'
  private payload: unknown
  private orderBy: { field: string; ascending: boolean } | null = null
  private limitCount: number | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select() { return this }
  eq(field: string, value: unknown) {
    this.filters.push([field, value])
    return this
  }
  is(field: string, value: unknown) {
    if (value === null) this.nullFilters.push(field)
    return this
  }
  order(field: string, options?: { ascending?: boolean }) {
    this.orderBy = { field, ascending: options?.ascending ?? true }
    return this
  }
  limit(count: number) {
    this.limitCount = count
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
      const inserted = values.map((value) => ({
        id: (value as Row).id ?? this.db.nextId(this.table),
        created_at: (value as Row).created_at ?? new Date().toISOString(),
        updated_at: (value as Row).updated_at ?? new Date().toISOString(),
        ...(value as Row),
      }))
      this.db.rows[this.table].push(...inserted)
      return { data: Array.isArray(this.payload) ? inserted : inserted[0], error: null }
    }
    if (this.operation === 'update') {
      const updated: Row[] = []
      this.db.rows[this.table] = this.db.rows[this.table].map((row) => {
        if (!this.matches(row)) return row
        const next = { ...row, ...(this.payload as Row), updated_at: new Date().toISOString() }
        updated.push(next)
        return next
      })
      return { data: updated, error: null }
    }
    let rows = this.db.rows[this.table].filter((row) => this.matches(row))
    if (this.orderBy) {
      rows = [...rows].sort((a, b) => {
        const compare = String(a[this.orderBy!.field] ?? '').localeCompare(String(b[this.orderBy!.field] ?? ''))
        return this.orderBy!.ascending ? compare : -compare
      })
    }
    if (this.limitCount != null) rows = rows.slice(0, this.limitCount)
    return { data: rows, error: null }
  }
  private matches(row: Row) {
    return (
      this.filters.every(([field, value]) => row[field] === value) &&
      this.nullFilters.every((field) => row[field] == null)
    )
  }
}

describe('date-change outreach helper', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateApproval.mockResolvedValue({
      approval: { id: 'approval-1' },
      approvalMessageId: 'approval-message-1',
      redirectUrl: '/planner?plan=plan-1&tab=approvals&msg=approval-message-1',
    })
  })

  it('updates the event brief as a proposed date change and creates a Gmail approval from existing outreach contacts', async () => {
    const db = new MemoryDb()

    const result = await createDateChangeOutreachApproval(db, {
      userId: 'user-1',
      planId: 'plan-1',
      dateWindowStart: '2026-07-12',
      note: 'Venue hold moved one week later.',
    })

    expect(result.plan.date_window_start).toBe('2026-07-12')
    expect(result.plan.date_window_end).toBe('2026-07-12')
    expect(result.plan.metadata).toEqual(expect.objectContaining({
      existing: true,
      date_change_request: expect.objectContaining({
        status: 'pending_outreach_approval',
        previous_date_window_start: '2026-06-28',
        proposed_date_window_start: '2026-07-12',
        approval_id: 'approval-1',
        approval_message_id: 'approval-message-1',
      }),
    }))
    expect(mockCreateApproval).toHaveBeenCalledWith(db, expect.objectContaining({
      userId: 'user-1',
      planId: 'plan-1',
      reuseExisting: false,
      subject: 'Date check for Founder Dinner',
      targets: [{ kind: 'venue', name: 'Moongate Lounge', email: 'events@moongate.example' }],
      bodyText: expect.stringContaining('Proposed date/window: Jul 12, 2026'),
    }))
    expect(mockCreateApproval.mock.calls[0][1].bodyText).toContain('No booking or payment changes are made')
    expect(db.rows.plan_messages[0]).toEqual(expect.objectContaining({
      message_type: 'status_update',
      content: expect.stringContaining('Review the Gmail approval before partner emails send'),
      metadata: expect.objectContaining({
        kind: 'date_change_request',
        approval_id: 'approval-1',
      }),
    }))
  })

  it('runs product access consumption before creating a date-change approval', async () => {
    const db = new MemoryDb()
    const ensureProductAccess = jest.fn(async (plan) => ({
      ...plan,
      metadata: {
        ...(plan.metadata ?? {}),
        product_gate: {
          event_access_source: 'free_trial',
          event_access_reason: 'date_change_started',
        },
      },
    }))

    const result = await createDateChangeOutreachApproval(db, {
      userId: 'user-1',
      planId: 'plan-1',
      dateWindowStart: '2026-07-12',
      ensureProductAccess,
    })

    expect(ensureProductAccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'plan-1' }))
    expect(result.plan.metadata).toEqual(expect.objectContaining({
      product_gate: expect.objectContaining({
        event_access_source: 'free_trial',
        event_access_reason: 'date_change_started',
      }),
      date_change_request: expect.objectContaining({
        status: 'pending_outreach_approval',
      }),
    }))
    expect(mockCreateApproval).toHaveBeenCalledTimes(1)
  })

  it('uses an organizer-provided target before falling back to existing outreach threads', async () => {
    const db = new MemoryDb()

    await createDateChangeOutreachApproval(db, {
      userId: 'user-1',
      planId: 'plan-1',
      dateWindowStart: '2026-07-12',
      targets: [{ kind: 'vendor', name: 'Mission Photo Co.', email: 'Photo@Example.com' }],
    })

    expect(mockCreateApproval).toHaveBeenCalledWith(db, expect.objectContaining({
      targets: [{ kind: 'vendor', name: 'Mission Photo Co.', email: 'photo@example.com' }],
    }))
  })

  it('requires at least one known or manually provided partner contact', async () => {
    const db = new MemoryDb()
    db.rows.outreach_threads = []
    const ensureProductAccess = jest.fn(async (plan) => plan)

    await expect(createDateChangeOutreachApproval(db, {
      userId: 'user-1',
      planId: 'plan-1',
      dateWindowStart: '2026-07-12',
      ensureProductAccess,
    })).rejects.toBeInstanceOf(DateChangeNoTargetsError)

    expect(ensureProductAccess).not.toHaveBeenCalled()
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })
})
