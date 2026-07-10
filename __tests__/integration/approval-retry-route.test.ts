jest.mock('server-only', () => ({}))

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

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceRoleClient: jest.fn(),
}))

jest.mock('@/lib/planner/execution/reapproval', () => ({
  APPROVAL_SNAPSHOT_SCHEMA_VERSION: 2,
  buildApprovalSnapshotHashV2: jest.fn(),
}))

jest.mock('@/lib/planner/approvalUiState', () => ({
  deriveApprovalUiState: ({ approvalStatus, actionStatus }: { approvalStatus: string; actionStatus?: string | null }) => ({
    status: actionStatus === 'complete'
      ? 'succeeded'
      : actionStatus === 'failed'
        ? 'failed'
        : actionStatus === 'executing'
          ? 'executing'
          : approvalStatus === 'authorized'
            ? 'authorized'
            : 'pending',
    availableActions: actionStatus === 'failed' ? ['retry'] : [],
    isTerminal: actionStatus === 'complete',
  }),
}), { virtual: true })

jest.mock('@/lib/outreach/gmailApprovalFlow', () => ({
  executeApprovedGmailOutreach: jest.fn(),
  isGmailApprovedOutreachAction: jest.fn().mockReturnValue(true),
  GmailDispatchRecoveryPendingError: class GmailDispatchRecoveryPendingError extends Error {},
}))

import type { NextRequest } from 'next/server'
import { POST as retryApproval } from '@/app/api/planner/plans/[planId]/approvals/[approvalId]/retry/route'
import { buildApprovalSnapshotHashV2 } from '@/lib/planner/execution/reapproval'
import {
  executeApprovedGmailOutreach,
  GmailDispatchRecoveryPendingError,
} from '@/lib/outreach/gmailApprovalFlow'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const PLAN_ID = '550e8400-e29b-41d4-a716-446655440001'
const ACTION_ID = '550e8400-e29b-41d4-a716-446655440002'
const APPROVAL_ID = '550e8400-e29b-41d4-a716-446655440003'
const SNAPSHOT_HASH = 'a'.repeat(64)

const mockCreateClient = createClient as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock
const mockBuildSnapshotHash = buildApprovalSnapshotHashV2 as jest.Mock
const mockExecuteGmail = executeApprovedGmailOutreach as jest.Mock

type Row = Record<string, any>

class ReadDb {
  constructor(readonly rows: Record<string, Row[]>) {}

  from(table: string) {
    return new ReadQuery(this.rows[table] ?? [])
  }
}

class ReadQuery {
  private filters: Array<[string, unknown]> = []

  constructor(private readonly rows: Row[]) {}

  select() { return this }
  eq(field: string, value: unknown) {
    this.filters.push([field, value])
    return this
  }
  update() { return this }
  async maybeSingle() {
    return { data: this.matching()[0] ?? null, error: null }
  }
  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve({ data: this.matching(), error: null }).then(onfulfilled, onrejected)
  }
  private matching() {
    return this.rows.filter((row) => this.filters.every(([field, value]) => row[field] === value))
  }
}

function seed() {
  const plan = {
    id: PLAN_ID,
    user_id: USER_ID,
    title: 'Retry plan',
    event_type: 'Happy hour',
    status: 'ready',
    guest_count: 40,
    budget_cap_cents: 20_000,
    neighborhood: 'Mission',
    date_window_start: '2026-08-10',
    date_window_end: '2026-08-10',
    ticketed: false,
    ticketing_model: 'rsvp',
    food_responsibility: 'venue',
    venue_terms: null,
    agent_action: null,
    profit_goal_cents: null,
    notes: null,
    metadata: {},
    created_at: '2026-07-09T00:00:00.000Z',
    updated_at: '2026-07-09T00:00:00.000Z',
  }
  const approval = {
    id: APPROVAL_ID,
    plan_id: PLAN_ID,
    agent_action_id: ACTION_ID,
    action_label: 'Send Gmail outreach',
    provider: 'Gmail',
    event_date: '2026-08-10',
    price_cents: 0,
    fees_cents: 0,
    refund_terms: null,
    cancellation_terms: null,
    package_details: null,
    delivery_email: 'venue@example.com',
    payment_method_id: null,
    status: 'authorized',
    requested_amount_cents: 0,
    authorized_amount_cents: 0,
    authorized_by: USER_ID,
    authorized_at: '2026-07-09T00:00:00.000Z',
    approved_by: USER_ID,
    approved_at: '2026-07-09T00:00:00.000Z',
    expires_at: '2099-01-01T00:00:00.000Z',
    snapshot_hash: SNAPSHOT_HASH,
    snapshot_json: { schema_version: 2 },
    snapshot_schema_version: 2,
    superseded_at: null,
    created_at: '2026-07-09T00:00:00.000Z',
    updated_at: '2026-07-09T00:00:00.000Z',
  }
  const action = {
    id: ACTION_ID,
    plan_id: PLAN_ID,
    action_type: 'email',
    description: 'Send Gmail outreach',
    provider: 'Gmail',
    target_type: 'outreach',
    target_id: null,
    payload_json: { kind: 'gmail_approved_outreach', targets: [] },
    amount_cents: 0,
    currency: 'usd',
    status: 'failed',
    approval_id: APPROVAL_ID,
    executed_at: null,
    result_metadata: { error: 'initial failure' },
    last_retry_status: null,
    last_retry_result: null,
    created_at: '2026-07-09T00:00:00.000Z',
    updated_at: '2026-07-09T00:00:00.000Z',
  }
  const rows = { plans: [plan], approvals: [approval], agent_actions: [action], plan_messages: [] }
  const readDb = new ReadDb(rows)
  const rpc = jest.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'claim_failed_action_retry') {
      action.status = 'executing'
      action.last_retry_status = 'in_progress'
      return { data: [{ outcome: 'claimed', action_status: action.status, result_metadata: action.result_metadata }], error: null }
    }
    if (name === 'finalize_failed_action_retry') {
      const outcome = String(args.p_outcome)
      action.status = outcome === 'succeeded' ? 'complete' : 'failed'
      action.last_retry_status = outcome
      action.last_retry_result = args.p_result
      action.result_metadata = { ...action.result_metadata, ...(args.p_result as Row) }
      return { data: [{ outcome, action_status: action.status, result_metadata: action.result_metadata }], error: null }
    }
    return { data: null, error: { code: 'P0001', message: `Unexpected RPC ${name}` } }
  })
  const serviceDb = { from: (table: string) => readDb.from(table), rpc }

  mockCreateClient.mockReturnValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: USER_ID, user_metadata: { user_type: 'community_builder' } } }, error: null }) },
    from: (table: string) => readDb.from(table),
  })
  mockCreateServiceRoleClient.mockReturnValue(serviceDb)
  mockBuildSnapshotHash.mockReturnValue(SNAPSHOT_HASH)
  return { plan, approval, action, rpc }
}

function request(idempotencyKey: string, expectedSnapshotHash = SNAPSHOT_HASH) {
  return {
    url: `http://localhost/api/planner/plans/${PLAN_ID}/approvals/${APPROVAL_ID}/retry`,
    headers: new Headers({ 'idempotency-key': idempotencyKey }),
    json: jest.fn().mockResolvedValue({ expectedSnapshotHash }),
  } as unknown as NextRequest
}

async function body(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

describe('approval retry route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects a stale confirmation hash before creating a service writer', async () => {
    seed()
    const response = await retryApproval(request('retry-mismatch', 'b'.repeat(64)), {
      params: Promise.resolve({ planId: PLAN_ID, approvalId: APPROVAL_ID }),
    })

    expect(response.status).toBe(409)
    expect(await body(response)).toEqual(expect.objectContaining({ code: 'approval_snapshot_mismatch' }))
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
    expect(mockExecuteGmail).not.toHaveBeenCalled()
  })

  it('records a terminal failure, then succeeds under a fresh retry key', async () => {
    const { action, rpc } = seed()
    mockExecuteGmail
      .mockRejectedValueOnce(new Error('Gmail temporarily unavailable'))
      .mockResolvedValueOnce({ sent_count: 1, outbound_message_sent: true })

    const failed = await retryApproval(request('retry-failure-1'), {
      params: Promise.resolve({ planId: PLAN_ID, approvalId: APPROVAL_ID }),
    })
    expect(failed.status).toBe(502)
    expect(await body(failed)).toEqual(expect.objectContaining({ code: 'approval_retry_failed', retryable: true }))
    expect(action.status).toBe('failed')

    const succeeded = await retryApproval(request('retry-success-2'), {
      params: Promise.resolve({ planId: PLAN_ID, approvalId: APPROVAL_ID }),
    })
    expect(succeeded.status).toBe(200)
    expect(await body(succeeded)).toEqual(expect.objectContaining({ actionStatus: 'complete', uiStatus: 'succeeded' }))
    expect(mockExecuteGmail).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls.filter(([name]) => name === 'finalize_failed_action_retry').map(([, args]) => args.p_outcome)).toEqual([
      'failed',
      'succeeded',
    ])
  })

  it('returns in-progress for a duplicate concurrent key and runs one provider execution', async () => {
    const { action, rpc } = seed()
    let claims = 0
    rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'claim_failed_action_retry') {
        claims += 1
        action.status = 'executing'
        action.last_retry_status = 'in_progress'
        return {
          data: [{ outcome: claims === 1 ? 'claimed' : 'in_progress', action_status: action.status, result_metadata: null }],
          error: null,
        }
      }
      action.status = 'complete'
      action.last_retry_status = 'succeeded'
      return { data: [{ outcome: 'succeeded', action_status: 'complete', result_metadata: args.p_result }], error: null }
    })
    let release!: (value: Row) => void
    mockExecuteGmail.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))

    const firstPromise = retryApproval(request('retry-concurrent'), {
      params: Promise.resolve({ planId: PLAN_ID, approvalId: APPROVAL_ID }),
    })
    for (let index = 0; index < 20 && mockExecuteGmail.mock.calls.length === 0; index += 1) await Promise.resolve()
    const duplicate = await retryApproval(request('retry-concurrent'), {
      params: Promise.resolve({ planId: PLAN_ID, approvalId: APPROVAL_ID }),
    })
    expect(duplicate.status).toBe(202)
    expect(await body(duplicate)).toEqual(expect.objectContaining({ code: 'retry_in_progress' }))

    release({ sent_count: 1, outbound_message_sent: true })
    expect((await firstPromise).status).toBe(200)
    expect(mockExecuteGmail).toHaveBeenCalledTimes(1)
  })

  it('keeps one key resumable through finalize ambiguity and converges to prior success', async () => {
    const { action, rpc } = seed()
    mockExecuteGmail.mockResolvedValue({ sent_count: 1, outbound_message_sent: true })
    let claimCount = 0
    let finalizeCount = 0
    rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'claim_failed_action_retry') {
        claimCount += 1
        if (claimCount === 2) {
          return { data: [{ outcome: 'in_progress', action_status: 'executing', result_metadata: null }], error: null }
        }
        if (claimCount >= 4) {
          action.status = 'complete'
          action.last_retry_status = 'succeeded'
          return { data: [{ outcome: 'prior_success', action_status: 'complete', result_metadata: action.result_metadata }], error: null }
        }
        action.status = 'executing'
        action.last_retry_status = 'in_progress'
        return { data: [{ outcome: 'claimed', action_status: 'executing', result_metadata: null }], error: null }
      }
      finalizeCount += 1
      if (finalizeCount === 1) {
        return { data: null, error: { code: '08006', message: 'database connection lost after provider success' } }
      }
      action.status = 'complete'
      action.last_retry_status = 'succeeded'
      action.result_metadata = { ...(args.p_result as Row) }
      return { data: [{ outcome: 'succeeded', action_status: 'complete', result_metadata: action.result_metadata }], error: null }
    })

    const ambiguous = await retryApproval(request('retry-finalize-pending'), {
      params: Promise.resolve({ planId: PLAN_ID, approvalId: APPROVAL_ID }),
    })
    expect(ambiguous.status).toBe(202)
    expect((await body(ambiguous)).code).toBe('retry_finalize_pending')
    expect(action.status).toBe('executing')
    expect(action.last_retry_status).toBe('in_progress')

    const immediateDuplicate = await retryApproval(request('retry-finalize-pending'), {
      params: Promise.resolve({ planId: PLAN_ID, approvalId: APPROVAL_ID }),
    })
    expect(immediateDuplicate.status).toBe(202)
    expect((await body(immediateDuplicate)).code).toBe('retry_in_progress')
    expect(mockExecuteGmail).toHaveBeenCalledTimes(1)

    // The realized DB suite controls the 60-second timestamp threshold. Once
    // it returns `claimed`, the route resumes with the same key; the Gmail
    // executor reconciles the deterministic RFC Message-ID instead of sending.
    const resumed = await retryApproval(request('retry-finalize-pending'), {
      params: Promise.resolve({ planId: PLAN_ID, approvalId: APPROVAL_ID }),
    })
    expect(resumed.status).toBe(200)
    expect(await body(resumed)).toEqual(expect.objectContaining({ actionStatus: 'complete', uiStatus: 'succeeded' }))
    expect(mockExecuteGmail).toHaveBeenCalledTimes(2)

    const priorSuccess = await retryApproval(request('retry-finalize-pending'), {
      params: Promise.resolve({ planId: PLAN_ID, approvalId: APPROVAL_ID }),
    })
    expect(priorSuccess.status).toBe(200)
    expect((await body(priorSuccess)).actionStatus).toBe('complete')
    expect(mockExecuteGmail).toHaveBeenCalledTimes(2)
    expect(rpc).not.toHaveBeenCalledWith('finalize_failed_action_retry', expect.objectContaining({ p_outcome: 'failed' }))
  })

  it('keeps reconciliation uncertainty in progress instead of recording a failed side effect', async () => {
    const { action, rpc } = seed()
    mockExecuteGmail.mockRejectedValueOnce(new GmailDispatchRecoveryPendingError('provider reconciliation pending'))

    const response = await retryApproval(request('retry-reconcile-pending'), {
      params: Promise.resolve({ planId: PLAN_ID, approvalId: APPROVAL_ID }),
    })

    expect(response.status).toBe(202)
    expect(await body(response)).toEqual(expect.objectContaining({ code: 'retry_reconciliation_pending' }))
    expect(action.status).toBe('executing')
    expect(action.last_retry_status).toBe('in_progress')
    expect(rpc).not.toHaveBeenCalledWith('finalize_failed_action_retry', expect.objectContaining({ p_outcome: 'failed' }))
  })

  it('keeps the same key in progress when failure finalization is ambiguous', async () => {
    const { action, rpc } = seed()
    mockExecuteGmail.mockRejectedValueOnce(new Error('Gmail rejected the provider attempt'))
    rpc.mockImplementation(async (name: string) => {
      if (name === 'claim_failed_action_retry') {
        action.status = 'executing'
        action.last_retry_status = 'in_progress'
        return { data: [{ outcome: 'claimed', action_status: 'executing', result_metadata: null }], error: null }
      }
      return { data: null, error: { code: '08006', message: 'database connection lost before failure finalization' } }
    })

    const response = await retryApproval(request('retry-failure-finalize-pending'), {
      params: Promise.resolve({ planId: PLAN_ID, approvalId: APPROVAL_ID }),
    })

    expect(response.status).toBe(202)
    expect(await body(response)).toEqual(expect.objectContaining({ code: 'retry_failure_finalize_pending' }))
    expect(action.status).toBe('executing')
    expect(action.last_retry_status).toBe('in_progress')
  })
})
