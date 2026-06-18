jest.mock('server-only', () => ({}))

import type { NextRequest } from 'next/server'
import { POST as approveBatch } from '@/app/api/planner/plans/[planId]/outreach/approve-batch/route'
import { createOrReuseGmailOutreachApproval } from '@/lib/outreach/gmailApprovalFlow'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

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

jest.mock('@/lib/outreach/gmailApprovalFlow', () => ({
  GmailConnectionRequiredError: class GmailConnectionRequiredError extends Error {},
  createOrReuseGmailOutreachApproval: jest.fn(),
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock
const mockCreateApproval = createOrReuseGmailOutreachApproval as jest.Mock

type Row = Record<string, any>

class MemoryDb {
  rows: Record<string, Row[]>

  constructor(rows: Record<string, Row[]>) {
    this.rows = rows
  }

  auth = {
    getUser: jest.fn().mockResolvedValue({
      data: { user: { id: 'user-1', user_metadata: { user_type: 'community_builder' } } },
      error: null,
    }),
  }

  from(table: string) {
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery {
  private filters: Array<(row: Row) => boolean> = []
  private operation: 'select' | 'update' = 'select'
  private payload: Row | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select(_columns = '*') {
    return this
  }

  update(payload: Row) {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value)
    return this
  }

  in(field: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[field]))
    return this
  }

  is(field: string, value: unknown) {
    if (value === null) this.filters.push((row) => row[field] == null)
    return this
  }

  async maybeSingle() {
    const result = await this.execute()
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: null }
  }

  async returns<T>() {
    const result = await this.execute()
    return { data: result.data as T, error: null }
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected)
  }

  private async execute() {
    if (!this.db.rows[this.table]) this.db.rows[this.table] = []

    if (this.operation === 'update') {
      const updated: Row[] = []
      this.db.rows[this.table] = this.db.rows[this.table].map((row) => {
        if (!this.filters.every((filter) => filter(row))) return row
        const next = { ...row, ...this.payload, updated_at: new Date().toISOString() }
        updated.push(next)
        return next
      })
      return { data: updated, error: null }
    }

    return {
      data: this.db.rows[this.table].filter((row) => this.filters.every((filter) => filter(row))),
      error: null,
    }
  }
}

function makeRequest(body: Row) {
  return new Request('http://localhost/api/planner/plans/plan-1/outreach/approve-batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest
}

function makeDb() {
  return new MemoryDb({
    plans: [{
      id: 'plan-1',
      user_id: 'user-1',
      title: 'Happy hour plan',
      event_type: 'happy_hour',
      status: 'ready',
      guest_count: 40,
      budget_cap_cents: null,
      neighborhood: 'Mission',
      date_window_start: null,
      date_window_end: null,
      ticketed: false,
      ticketing_model: 'rsvp',
      food_responsibility: 'venue',
      venue_terms: null,
      agent_action: null,
      profit_goal_cents: null,
      notes: null,
      metadata: {},
      created_at: '2026-06-18T00:00:00.000Z',
      updated_at: '2026-06-18T00:00:00.000Z',
    }],
    plan_discovery_venue_candidates: [
      {
        id: 'candidate-ready',
        plan_id: 'plan-1',
        discovery_venue_id: '11111111-1111-4111-8111-111111111111',
        dismissed_at: null,
        fit_score: 91,
      },
      {
        id: 'candidate-pending',
        plan_id: 'plan-1',
        discovery_venue_id: '22222222-2222-4222-8222-222222222222',
        dismissed_at: null,
        fit_score: 82,
      },
    ],
    discovery_venues: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Moongate Lounge',
        contact_email: null,
        organizer_provided_emails: [{ email: 'booking@moongate.example' }],
        extracted_emails: [],
        website: 'https://moongate.example',
        metadata: {},
        photos: [],
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Stable Cafe',
        contact_email: null,
        organizer_provided_emails: [],
        extracted_emails: [],
        website: 'https://stable.example',
        metadata: {},
        photos: [],
      },
    ],
  })
}

describe('POST /api/planner/plans/[planId]/outreach/approve-batch', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const db = makeDb()
    mockCreateClient.mockReturnValue(db)
    mockCreateServiceRoleClient.mockReturnValue(db)
    mockCreateApproval.mockResolvedValue({
      approval: { id: 'approval-1' },
      approvalMessageId: 'message-1',
      redirectUrl: '/planner?plan=plan-1&tab=approvals',
    })
  })

  it('rejects batches containing venues without a ready contact', async () => {
    const response = await approveBatch(makeRequest({
      discovery_venue_ids: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
    }), { params: { planId: 'plan-1' } })
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.venue_errors).toEqual([expect.objectContaining({
      discovery_venue_id: '22222222-2222-4222-8222-222222222222',
      error: 'contact_not_ready',
    })])
    expect(mockCreateApproval).not.toHaveBeenCalled()
  })

  it('creates approval records with discovered venue target metadata for ready venues', async () => {
    const response = await approveBatch(makeRequest({
      discovery_venue_ids: ['11111111-1111-4111-8111-111111111111'],
    }), { params: { planId: 'plan-1' } })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.created_count).toBe(1)
    expect(mockCreateApproval).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: 'user-1',
      planId: 'plan-1',
      reuseExisting: false,
      targets: [{
        kind: 'venue',
        name: 'Moongate Lounge',
        email: 'booking@moongate.example',
        discoveryVenueId: '11111111-1111-4111-8111-111111111111',
      }],
    }))
  })
})
