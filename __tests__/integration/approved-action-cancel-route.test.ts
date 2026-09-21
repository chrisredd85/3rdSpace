jest.mock('server-only', () => ({}))

jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data), {
      ...init,
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    }),
  },
}))

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/planner/execution/externalCheckout', () => ({
  cancelExternalCheckoutHandoff: jest.fn(),
}))

jest.mock('@/lib/planner/execution/approvedActionHandoffs', () => ({
  cancelConciergeApprovedAction: jest.fn(),
  requireApprovedHandoffDb: (db: unknown) => db,
}))

import type { NextRequest } from 'next/server'
import { POST as cancelExecution } from '@/app/api/planner/plans/[planId]/agent-actions/[actionId]/cancel/route'
import { cancelExternalCheckoutHandoff } from '@/lib/planner/execution/externalCheckout'
import { cancelConciergeApprovedAction } from '@/lib/planner/execution/approvedActionHandoffs'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const PLAN_ID = '550e8400-e29b-41d4-a716-446655440001'
const ACTION_ID = '550e8400-e29b-41d4-a716-446655440002'
const APPROVAL_ID = '550e8400-e29b-41d4-a716-446655440003'
const SNAPSHOT_HASH = 'a'.repeat(64)

const mockCreateClient = createClient as jest.Mock
const mockCreateService = createServiceRoleClient as jest.Mock
const mockCancelExternal = cancelExternalCheckoutHandoff as jest.Mock
const mockCancelConcierge = cancelConciergeApprovedAction as jest.Mock

type Row = Record<string, unknown>

class Db {
  constructor(readonly rows: Record<string, Row[]>) {}
  from(table: string) { return new Query(this.rows[table] ?? []) }
  rpc = jest.fn()
}

class Query {
  private filters: Array<[string, unknown]> = []
  constructor(private readonly rows: Row[]) {}
  select() { return this }
  eq(field: string, value: unknown) { this.filters.push([field, value]); return this }
  async maybeSingle() {
    return {
      data: this.rows.find((row) => this.filters.every(([field, value]) => row[field] === value)) ?? null,
      error: null,
    }
  }
}

function seed(actionOverrides: Row = {}) {
  const plan = { id: PLAN_ID, user_id: USER_ID, title: 'Cancel plan', status: 'executing' }
  const approval = {
    id: APPROVAL_ID,
    plan_id: PLAN_ID,
    agent_action_id: ACTION_ID,
    status: 'authorized',
    snapshot_hash: SNAPSHOT_HASH,
    snapshot_schema_version: 2,
    expires_at: '2099-01-01T00:00:00.000Z',
  }
  const action = {
    id: ACTION_ID,
    plan_id: PLAN_ID,
    action_type: 'external_checkout',
    payload_json: { kind: 'external_checkout' },
    result_metadata: {
      execution_mode: 'external_checkout',
      external_checkout: { status: 'ready' },
    },
    status: 'executing',
    approval_id: APPROVAL_ID,
    ...actionOverrides,
  }
  const db = new Db({ plans: [plan], approvals: [approval], agent_actions: [action] })
  mockCreateClient.mockReturnValue({
    auth: { getUser: jest.fn().mockResolvedValue({
      data: { user: { id: USER_ID, user_metadata: { user_type: 'community_builder' } } },
      error: null,
    }) },
    from: db.from.bind(db),
  })
  mockCreateService.mockReturnValue({ from: db.from.bind(db), rpc: db.rpc })
  return { plan, approval, action, db }
}

function request(snapshotHash = SNAPSHOT_HASH) {
  return {
    headers: new Headers({ 'idempotency-key': 'execution-cancel-test-1' }),
    json: jest.fn().mockResolvedValue({
      approvalId: APPROVAL_ID,
      expectedSnapshotHash: snapshotHash,
      reason: 'Host changed plans.',
    }),
  } as unknown as NextRequest
}

async function responseBody(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe('approved action cancellation route', () => {
  beforeEach(() => jest.clearAllMocks())

  it('cancels an external handoff, preserves authorization, and replays idempotently', async () => {
    const { action, approval } = seed()
    mockCancelExternal.mockImplementation(async () => {
      action.status = 'cancelled'
      action.result_metadata = {
        execution_mode: 'external_checkout',
        external_checkout: { status: 'cancelled' },
      }
      return { cancelled: true, metadata: action.result_metadata }
    })

    const first = await cancelExecution(request(), {
      params: Promise.resolve({ planId: PLAN_ID, actionId: ACTION_ID }),
    })
    const replay = await cancelExecution(request(), {
      params: Promise.resolve({ planId: PLAN_ID, actionId: ACTION_ID }),
    })

    expect(first.status).toBe(200)
    expect(replay.status).toBe(200)
    expect(await responseBody(first)).toEqual(expect.objectContaining({
      actionStatus: 'cancelled',
      uiStatus: 'cancelled',
      availableActions: [],
    }))
    expect(approval.status).toBe('authorized')
    expect(mockCancelExternal).toHaveBeenCalledTimes(1)
  })

  it('dispatches a queued concierge cancellation without mutating approval history', async () => {
    const { action, approval } = seed({
      action_type: 'hold_request',
      payload_json: { kind: 'venue_hold' },
      result_metadata: {
        execution_mode: 'concierge_admin_queue',
        admin_task_id: 'task-1',
      },
    })
    mockCancelConcierge.mockImplementation(async () => {
      action.status = 'cancelled'
      action.result_metadata = { execution_mode: 'concierge_admin_queue', handoff_status: 'cancelled' }
      return { cancelled: true, metadata: action.result_metadata }
    })

    const response = await cancelExecution(request(), {
      params: Promise.resolve({ planId: PLAN_ID, actionId: ACTION_ID }),
    })

    expect(response.status).toBe(200)
    expect((await responseBody(response)).actionStatus).toBe('cancelled')
    expect(approval.status).toBe('authorized')
    expect(mockCancelConcierge).toHaveBeenCalledTimes(1)
  })

  it('rejects stale snapshots and controlled-payment execution cancellation', async () => {
    seed()
    const stale = await cancelExecution(request('b'.repeat(64)), {
      params: Promise.resolve({ planId: PLAN_ID, actionId: ACTION_ID }),
    })
    expect(stale.status).toBe(409)
    expect(mockCreateService).not.toHaveBeenCalled()

    jest.clearAllMocks()
    seed({
      action_type: 'payment',
      payload_json: { kind: 'venue_deposit' },
      status: 'approved',
      result_metadata: {},
    })
    const payment = await cancelExecution(request(), {
      params: Promise.resolve({ planId: PLAN_ID, actionId: ACTION_ID }),
    })
    expect(payment.status).toBe(409)
    expect(await responseBody(payment)).toEqual(expect.objectContaining({
      code: 'execution_cancel_not_allowed',
    }))
  })
})
