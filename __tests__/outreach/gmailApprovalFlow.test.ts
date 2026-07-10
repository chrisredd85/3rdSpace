jest.mock('server-only', () => ({}))

jest.mock('@/lib/outreach/gmail', () => ({
  getUsableGmailAccessToken: jest.fn().mockResolvedValue('gmail-access-token'),
  sendGmailMessage: jest.fn(),
  reconcileGmailMessageByRfcMessageId: jest.fn(),
  listGmailThreadMessages: jest.fn(),
  modifyGmailThreadLabels: jest.fn().mockResolvedValue({ id: 'gmail-thread-1' }),
}))

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(),
}))

import {
  createOrReuseGmailOutreachApproval,
  executeApprovedGmailOutreach,
  markGmailOutreachThreadHandled,
  renderBodyForTarget,
  syncGmailOutreachThread,
} from '@/lib/outreach/gmailApprovalFlow'
import {
  buildApprovalSnapshotHashV2,
  buildApprovalSnapshotV2,
} from '@/lib/planner/execution/reapproval'
import {
  listGmailThreadMessages,
  modifyGmailThreadLabels,
  reconcileGmailMessageByRfcMessageId,
  sendGmailMessage,
} from '@/lib/outreach/gmail'
import { createServiceRoleClient } from '@/lib/supabase/server'

const mockSendGmailMessage = sendGmailMessage as jest.Mock
const mockReconcileGmailMessage = reconcileGmailMessageByRfcMessageId as jest.Mock
const mockListGmailThreadMessages = listGmailThreadMessages as jest.Mock
const mockModifyGmailThreadLabels = modifyGmailThreadLabels as jest.Mock
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock

type Row = Record<string, any>

class MemoryDb {
  rows: Record<string, Row[]> = {
    creator_email_accounts: [{
      id: 'gmail-account-1',
      user_id: 'user-1',
      provider: 'gmail',
      email_address: 'creator@example.com',
      oauth_access_token: 'encrypted-access',
      oauth_refresh_token: 'encrypted-refresh',
      token_expires_at: '2099-01-01T00:00:00.000Z',
      history_id: null,
      label_id: null,
      revoked_at: null,
      created_at: '2026-06-10T00:00:00.000Z',
    }],
    outreach_threads: [],
    outreach_messages: [],
    agent_actions: [],
    agent_action_audit_log: [],
    approvals: [],
    plan_messages: [],
    plans: [],
  }
  private sequence = 0
  rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = []

  from(table: string) {
    if (!this.rows[table]) this.rows[table] = []
    return new MemoryQuery(this, table)
  }

  nextId(table: string) {
    this.sequence += 1
    return `${table}-${this.sequence}`
  }

  async rpc(name: string, params: Record<string, unknown>) {
    this.rpcCalls.push({ name, params })
    if (name !== 'supersede_approval_version') {
      return { data: null, error: { message: `Unsupported RPC: ${name}` } }
    }

    const previous = this.rows.approvals.find((row) => row.id === params.p_approval_id)
    if (!previous) return { data: null, error: { message: 'Approval not found' } }
    const action = this.rows.agent_actions.find((row) => row.id === previous.agent_action_id)
    if (!action) return { data: null, error: { message: 'Action not found' } }

    const now = new Date().toISOString()
    const replacement = {
      ...previous,
      id: this.nextId('approvals'),
      status: 'pending',
      price_cents: params.p_requested_amount_cents,
      requested_amount_cents: params.p_requested_amount_cents,
      authorized_amount_cents: null,
      authorized_by: null,
      authorized_at: null,
      approved_by: null,
      approved_at: null,
      event_date: params.p_event_date,
      notes: params.p_notes,
      expires_at: params.p_expires_at,
      snapshot_json: params.p_snapshot_json,
      snapshot_hash: params.p_snapshot_hash,
      snapshot_schema_version: 2,
      supersedes_approval_id: previous.id,
      superseded_by_approval_id: null,
      created_at: now,
      updated_at: now,
    }
    previous.status = 'superseded'
    previous.superseded_by_approval_id = replacement.id
    previous.superseded_at = now
    this.rows.approvals.push(replacement)
    Object.assign(action, {
      approval_id: replacement.id,
      amount_cents: params.p_requested_amount_cents,
      payload_json: params.p_action_payload_json,
      status: 'pending',
      executed_at: null,
      updated_at: now,
    })
    return { data: replacement, error: null }
  }
}

class MemoryQuery {
  private filters: Array<[string, unknown]> = []
  private inFilters: Array<[string, unknown[]]> = []
  private nullFilters: string[] = []
  private operation: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private payload: unknown
  private orderBy: { field: string; ascending: boolean } | null = null
  private limitCount: number | null = null

  constructor(private db: MemoryDb, private table: string) {}

  select() { return this }
  eq(field: string, value: unknown) {
    this.filters.push([field, value])
    return this
  }
  in(field: string, values: unknown[]) {
    this.inFilters.push([field, values])
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
  delete() {
    this.operation = 'delete'
    return this
  }
  async single() {
    const result = await this.execute()
    if (result.error) return { data: null, error: result.error }
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    return { data: row ?? null, error: row ? null : { message: 'No row' } }
  }
  async maybeSingle() {
    const result = await this.execute()
    if (result.error) return { data: null, error: result.error }
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
      if (this.table === 'outreach_messages') {
        const duplicate = values.find((value) => this.db.rows.outreach_messages.some((row) => (
          row.agent_action_id === (value as Row).agent_action_id &&
          row.dispatch_idempotency_key === (value as Row).dispatch_idempotency_key
        )))
        if (duplicate) {
          return { data: null, error: { code: '23505', message: 'duplicate dispatch' } }
        }
      }
      const inserted = values.map((value) => ({
        id: (value as Row).id ?? this.db.nextId(this.table),
        created_at: (value as Row).created_at ?? new Date().toISOString(),
        updated_at: (value as Row).updated_at ?? new Date().toISOString(),
        ...(value as Row),
      }))
      this.db.rows[this.table].push(...inserted)
      return { data: Array.isArray(this.payload) ? inserted : inserted[0], error: null }
    }
    if (this.operation === 'delete') {
      const deleted = this.db.rows[this.table].filter((row) => this.matches(row))
      this.db.rows[this.table] = this.db.rows[this.table].filter((row) => !this.matches(row))
      return { data: deleted, error: null }
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
      this.inFilters.every(([field, values]) => values.includes(row[field])) &&
      this.nullFilters.every((field) => row[field] == null)
    )
  }
}

describe('Gmail approval flow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockReconcileGmailMessage.mockResolvedValue(null)
    mockSendGmailMessage
      .mockResolvedValueOnce({ gmailMessageId: 'gmail-message-1', gmailThreadId: 'gmail-thread-1', labelIds: ['SENT'] })
      .mockResolvedValueOnce({ gmailMessageId: 'gmail-message-2', gmailThreadId: 'gmail-thread-2', labelIds: ['SENT'] })
  })

  it('sends Gmail only after approved execution and records outreach threads', async () => {
    const db = new MemoryDb()
    db.rows.plans.push({ id: 'plan-1', user_id: 'user-1' })
    mockCreateServiceRoleClient.mockReturnValue({ from: (table: string) => db.from(table) })

    const result = await executeApprovedGmailOutreach(db, {
      userId: 'user-1',
      plan: {
        id: 'plan-1',
        user_id: 'user-1',
        title: 'Happy hour plan',
        event_type: 'Happy hour',
        status: 'ready',
        guest_count: 40,
        budget_cap_cents: null,
        neighborhood: 'San Francisco',
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
        created_at: '2026-06-10T00:00:00.000Z',
        updated_at: '2026-06-10T00:00:00.000Z',
      },
      action: {
        id: 'action-1',
        plan_id: 'plan-1',
        action_type: 'email',
        description: 'Send approved Gmail outreach',
        provider: 'Gmail',
        target_type: 'outreach',
        target_id: null,
        payload_json: {
          kind: 'gmail_approved_outreach',
          targets: [
            { kind: 'venue', name: 'Moongate Lounge', email: 'moongate@example.com' },
            { kind: 'vendor', name: 'Mission Photo Co.', email: 'photo@example.com' },
          ],
          subject: 'Happy hour partnership inquiry',
          body_text: 'Hi {{place_name}},\n\nCan you support this event?\n\nThanks,\n{{sender_email}}',
        },
        amount_cents: 0,
        currency: 'usd',
        status: 'executing',
        approval_id: 'approval-1',
        executed_at: null,
        result_metadata: {},
        created_at: '2026-06-10T00:00:00.000Z',
        updated_at: '2026-06-10T00:00:00.000Z',
      },
      approval: {
        id: 'approval-1',
        plan_id: 'plan-1',
        agent_action_id: 'action-1',
        action_label: 'Send outreach to 1 venue and 1 vendor',
        provider: 'Gmail',
        event_date: null,
        price_cents: 0,
        fees_cents: 0,
        refund_terms: null,
        cancellation_terms: null,
        package_details: null,
        delivery_email: null,
        payment_method_id: null,
        status: 'approved',
        requested_amount_cents: 0,
        authorized_amount_cents: null,
        authorized_by: 'user-1',
        authorized_at: '2026-06-10T00:00:00.000Z',
        approved_by: 'user-1',
        approved_at: '2026-06-10T00:00:00.000Z',
        expires_at: null,
        snapshot_hash: null,
        created_at: '2026-06-10T00:00:00.000Z',
        updated_at: '2026-06-10T00:00:00.000Z',
      },
    } as any)

    expect(result).toEqual(expect.objectContaining({
      outbound_message_sent: true,
      sent_count: 2,
    }))
    expect(mockSendGmailMessage).toHaveBeenCalledTimes(2)
    expect(db.rows.outreach_threads).toHaveLength(2)
    expect(db.rows.outreach_messages).toHaveLength(2)
    expect(mockSendGmailMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      to: 'moongate@example.com',
      bodyText: 'Hi Moongate Lounge,\n\nCan you support this event?\n\nThanks,\ncreator@example.com',
      bodyHtml: 'Hi Moongate Lounge,<br /><br />Can you support this event?<br /><br />Thanks,<br />creator@example.com',
    }))
    expect(mockSendGmailMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      to: 'photo@example.com',
      bodyText: 'Hi Mission Photo Co.,\n\nCan you support this event?\n\nThanks,\ncreator@example.com',
    }))
    expect(mockSendGmailMessage.mock.calls[0][0].bodyText).not.toContain('{{')
    expect(mockSendGmailMessage.mock.calls[1][0].bodyText).not.toContain('{{')
    expect(db.rows.outreach_messages[0].body_text).toContain('Moongate Lounge')
    expect(db.rows.outreach_messages[0].body_text).not.toContain('{{venue_name}}')
    expect(db.rows.outreach_messages[1].body_text).toContain('Mission Photo Co.')
    expect(db.rows.outreach_messages[1].body_text).not.toContain('{{sender_email}}')
    expect(db.rows.outreach_threads.map((thread) => thread.target_type)).toEqual(['venue', 'vendor'])
    expect(db.rows.plan_messages[0]).toEqual(expect.objectContaining({
      content: expect.stringContaining('partners'),
      message_type: 'status_update',
      metadata: expect.objectContaining({ outbound_message_sent: true }),
    }))
  })

  it('persists an exactly recomputable V2 snapshot for a new Gmail approval', async () => {
    const db = new MemoryDb()
    const plan = buildExecutionInput([]).plan
    db.rows.plans.push(plan)
    mockCreateServiceRoleClient.mockReturnValue({ from: (table: string) => db.from(table) })

    const created = await createOrReuseGmailOutreachApproval(db, {
      userId: 'user-1',
      planId: 'plan-1',
      reuseExisting: false,
      targets: [{ kind: 'venue', name: 'Moongate Lounge', email: 'moongate@example.com' }],
      subject: 'Event partnership',
      bodyText: 'Hi {{place_name}}, can you host us?',
    })

    const approval = db.rows.approvals[0]
    const action = db.rows.agent_actions[0]
    const snapshotInput = {
      plan,
      approval,
      action,
      payload: action.payload_json,
    }
    expect(created.approval.id).toBe(approval.id)
    expect(approval).toEqual(expect.objectContaining({
      snapshot_schema_version: 2,
      price_cents: 0,
      requested_amount_cents: 0,
      action_label: 'Send outreach to 1 venue',
      delivery_email: 'moongate@example.com',
      expires_at: expect.any(String),
      snapshot_hash: buildApprovalSnapshotHashV2(snapshotInput as any),
      snapshot_json: buildApprovalSnapshotV2(snapshotInput as any),
    }))
    expect(action).toEqual(expect.objectContaining({
      amount_cents: 0,
      payload_json: expect.objectContaining({
        amount_cents: 0,
        price_cents: 0,
        requested_amount_cents: 0,
        requestedAmountCents: 0,
      }),
    }))
    expect(approval.snapshot_json).toEqual(expect.objectContaining({
      approval: expect.objectContaining({ price_cents: 0, requested_amount_cents: 0 }),
      action: expect.objectContaining({
        amount_cents: 0,
        payload_json: expect.objectContaining({
          amount_cents: 0,
          price_cents: 0,
          requested_amount_cents: 0,
          requestedAmountCents: 0,
        }),
      }),
    }))
  })

  it('keeps zero-cent money fields consistent when replacing a reusable Gmail approval', async () => {
    const db = new MemoryDb()
    const plan = {
      ...buildExecutionInput([]).plan,
      metadata: { gmail_approval_flow: true },
    }
    db.rows.plans.push(plan)
    mockCreateServiceRoleClient.mockReturnValue(db)

    const first = await createOrReuseGmailOutreachApproval(db, {
      userId: 'user-1',
      planId: 'plan-1',
      reuseExisting: false,
      targets: [{ kind: 'venue', name: 'Moongate Lounge', email: 'moongate@example.com' }],
      subject: 'First event partnership',
      bodyText: 'First approved body',
    })
    const replacement = await createOrReuseGmailOutreachApproval(db, {
      userId: 'user-1',
      targets: [{ kind: 'vendor', name: 'Mission Photo Co.', email: 'photo@example.com' }],
      subject: 'Updated event partnership',
      bodyText: 'Updated approved body',
    })

    expect(db.rpcCalls).toHaveLength(1)
    const rpc = db.rpcCalls[0]
    expect(rpc).toEqual(expect.objectContaining({ name: 'supersede_approval_version' }))
    expect(rpc.params).toEqual(expect.objectContaining({
      p_approval_id: first.approval.id,
      p_requested_amount_cents: 0,
      p_action_payload_json: expect.objectContaining({
        amount_cents: 0,
        price_cents: 0,
        requested_amount_cents: 0,
        requestedAmountCents: 0,
      }),
      p_snapshot_json: expect.objectContaining({
        approval: expect.objectContaining({ price_cents: 0, requested_amount_cents: 0 }),
        action: expect.objectContaining({
          amount_cents: 0,
          payload_json: expect.objectContaining({
            amount_cents: 0,
            price_cents: 0,
            requested_amount_cents: 0,
            requestedAmountCents: 0,
          }),
        }),
      }),
    }))
    expect(replacement.approval).toEqual(expect.objectContaining({
      status: 'pending',
      price_cents: 0,
      requested_amount_cents: 0,
      supersedes_approval_id: first.approval.id,
    }))
    expect(replacement.agentAction).toEqual(expect.objectContaining({
      approval_id: replacement.approval.id,
      amount_cents: 0,
      payload_json: expect.objectContaining({ price_cents: 0, requested_amount_cents: 0 }),
    }))
  })

  it('retries only unsent recipients after a partial batch failure', async () => {
    const db = new MemoryDb()
    mockCreateServiceRoleClient.mockReturnValue({ from: (table: string) => db.from(table) })
    mockSendGmailMessage.mockReset()
    mockSendGmailMessage
      .mockResolvedValueOnce({ gmailMessageId: 'gmail-message-1', gmailThreadId: 'gmail-thread-1', labelIds: ['SENT'] })
      .mockRejectedValueOnce(new Error('temporary Gmail transport failure'))
      .mockResolvedValueOnce({ gmailMessageId: 'gmail-message-2', gmailThreadId: 'gmail-thread-2', labelIds: ['SENT'] })

    const input = buildExecutionInput([
      { kind: 'venue', name: 'Moongate Lounge', email: 'moongate@example.com' },
      { kind: 'vendor', name: 'Mission Photo Co.', email: 'photo@example.com' },
    ])
    db.rows.plans.push(input.plan)

    await expect(executeApprovedGmailOutreach(db, input)).rejects.toThrow('temporary Gmail transport failure')
    expect(db.rows.outreach_messages.map((row) => row.delivery_status)).toEqual(['sent', 'ambiguous'])

    const result = await executeApprovedGmailOutreach(db, input)

    expect(result).toEqual(expect.objectContaining({ sent_count: 2, outbound_message_sent: true }))
    expect(mockSendGmailMessage).toHaveBeenCalledTimes(3)
    expect(mockSendGmailMessage.mock.calls.map((call) => call[0].to)).toEqual([
      'moongate@example.com',
      'photo@example.com',
      'photo@example.com',
    ])
    expect(db.rows.outreach_messages).toHaveLength(2)
    expect(db.rows.outreach_messages.every((row) => row.delivery_status === 'sent')).toBe(true)
    expect(db.rows.outreach_threads).toHaveLength(2)

    const exactReplay = await executeApprovedGmailOutreach(db, input)
    expect(exactReplay).toEqual(expect.objectContaining({ sent_count: 2, outbound_message_sent: true }))
    expect(mockSendGmailMessage).toHaveBeenCalledTimes(3)
    expect(db.rows.plan_messages).toHaveLength(1)
    expect(db.rows.plan_messages[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reserves one provider side effect when identical executions overlap', async () => {
    const db = new MemoryDb()
    mockCreateServiceRoleClient.mockReturnValue({ from: (table: string) => db.from(table) })
    mockSendGmailMessage.mockReset()
    let releaseSend!: (value: { gmailMessageId: string; gmailThreadId: string; labelIds: string[] }) => void
    mockSendGmailMessage.mockImplementationOnce(() => new Promise((resolve) => {
      releaseSend = resolve
    }))
    const input = buildExecutionInput([
      { kind: 'venue', name: 'Moongate Lounge', email: 'moongate@example.com' },
    ])
    db.rows.plans.push(input.plan)

    const first = executeApprovedGmailOutreach(db, input)
    for (let index = 0; index < 20 && mockSendGmailMessage.mock.calls.length === 0; index += 1) {
      await Promise.resolve()
    }
    expect(mockSendGmailMessage).toHaveBeenCalledTimes(1)

    const second = executeApprovedGmailOutreach(db, input)
    await Promise.resolve()
    releaseSend({ gmailMessageId: 'gmail-message-1', gmailThreadId: 'gmail-thread-1', labelIds: ['SENT'] })
    const outcomes = await Promise.allSettled([first, second])

    expect(mockSendGmailMessage).toHaveBeenCalledTimes(1)
    expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true)
    expect(db.rows.outreach_messages).toHaveLength(1)
    expect(db.rows.outreach_messages[0]).toEqual(expect.objectContaining({ delivery_status: 'sent' }))
    expect(db.rows.outreach_threads).toHaveLength(1)
  })

  it('reconciles a stale sending dispatch by RFC Message-ID without another Gmail send', async () => {
    const db = new MemoryDb()
    mockCreateServiceRoleClient.mockReturnValue({ from: (table: string) => db.from(table) })
    mockSendGmailMessage.mockReset()
    const target = { kind: 'venue' as const, name: 'Moongate Lounge', email: 'moongate@example.com' }
    const input = buildExecutionInput([target])
    db.rows.plans.push(input.plan)
    db.rows.outreach_threads.push({
      id: 'thread-reserved',
      user_id: 'user-1',
      plan_id: 'plan-1',
      target_name: target.name,
      target_type: target.kind,
      target_email: target.email,
      target_source: 'discovery',
      channel_strategy: { source: 'gmail_approved_outreach', approval_required: true },
      state: 'draft',
      needs_attention: false,
      last_event_at: '2026-07-09T00:00:00.000Z',
      last_outbound_at: null,
    })
    db.rows.outreach_messages.push({
      id: 'dispatch-reserved',
      thread_id: 'thread-reserved',
      direction: 'outbound',
      subject: 'Happy hour partnership inquiry',
      body_text: 'Approved body',
      headers_json: { to: target.email },
      provider_metadata_json: { provider: 'gmail' },
      attachments_json: [],
      agent_action_id: 'action-1',
      approval_id: 'approval-1',
      dispatch_idempotency_key: 'gmail:action-1:recipient:10d1f2a312aa9fdf1c955ccc',
      rfc_message_id: '<approval.action-1.10d1f2a312aa9fdf1c955ccc@mail.3rdplace.app>',
      delivery_status: 'sending',
      send_started_at: '2026-07-09T00:00:00.000Z',
      gmail_message_id: null,
      gmail_thread_id: null,
      sent_at: null,
    })
    mockReconcileGmailMessage.mockResolvedValueOnce({
      gmailMessageId: 'gmail-provider-message',
      gmailThreadId: 'gmail-provider-thread',
    })

    const result = await executeApprovedGmailOutreach(db, input)

    expect(result).toEqual(expect.objectContaining({ sent_count: 1, outbound_message_sent: true }))
    expect(mockReconcileGmailMessage).toHaveBeenCalledTimes(1)
    expect(mockSendGmailMessage).not.toHaveBeenCalled()
    expect(db.rows.outreach_messages[0]).toEqual(expect.objectContaining({
      delivery_status: 'sent',
      gmail_message_id: 'gmail-provider-message',
      gmail_thread_id: 'gmail-provider-thread',
    }))
  })

  it('renders approved outreach templates with the target place name and strips unresolved tokens', () => {
    const rendered = renderBodyForTarget(
      'Hi {{ venue_name }},\n\nProposal: {{event_name}}\n\nFrom {{sender_email}}',
      { name: 'Moongate Lounge', email: 'chrisredd85@gmail.com' },
      'julianta1985@gmail.com'
    )

    expect(rendered).toBe('Hi Moongate Lounge,\n\nProposal: \n\nFrom julianta1985@gmail.com')
    expect(rendered).not.toContain('{{')
  })

  it('syncs Gmail replies and marks the thread handled using modify', async () => {
    const db = new MemoryDb()
    mockCreateServiceRoleClient.mockReturnValue({ from: (table: string) => db.from(table) })
    db.rows.outreach_threads.push({
      id: 'thread-1',
      user_id: 'user-1',
      plan_id: 'plan-1',
      target_name: 'Stable Cafe',
      target_email: 'stable@example.com',
      target_source: 'discovery',
      channel_strategy: { source: 'gmail_approved_outreach', approval_required: true },
      target_type: 'venue',
      state: 'awaiting_reply',
      needs_attention: false,
      last_event_at: '2026-06-10T00:00:00.000Z',
      last_outbound_at: '2026-06-10T00:00:00.000Z',
      last_inbound_at: null,
    })
    db.rows.outreach_messages.push({
      id: 'message-1',
      thread_id: 'thread-1',
      direction: 'outbound',
      subject: 'Happy hour partnership inquiry',
      body_text: 'Sent message',
      headers_json: { from: 'creator@example.com' },
      provider_metadata_json: {},
      attachments_json: [],
      gmail_message_id: 'sent-message',
      gmail_thread_id: 'gmail-thread-1',
      sent_at: '2026-06-10T00:00:00.000Z',
      received_at: null,
    })
    mockListGmailThreadMessages.mockResolvedValueOnce([
      {
        gmailMessageId: 'reply-message',
        gmailThreadId: 'gmail-thread-1',
        subject: 'Re: Happy hour partnership inquiry',
        bodyText: 'Yes, we are interested.',
        bodyHtml: null,
        headers: { from: 'Stable <stable@example.com>' },
        receivedAt: '2026-06-10T01:00:00.000Z',
        from: 'Stable <stable@example.com>',
      },
    ])

    const syncResult = await syncGmailOutreachThread(db, { userId: 'user-1', threadId: 'thread-1' })
    expect(syncResult.inserted_count).toBe(1)
    expect(db.rows.outreach_threads[0]).toEqual(expect.objectContaining({
      state: 'in_negotiation',
      needs_attention: true,
    }))

    await markGmailOutreachThreadHandled(db, { userId: 'user-1', threadId: 'thread-1' })
    expect(mockModifyGmailThreadLabels).toHaveBeenCalledWith(expect.objectContaining({
      gmailThreadId: 'gmail-thread-1',
      removeLabelIds: ['UNREAD', 'INBOX'],
    }))
    expect(db.rows.outreach_threads[0]).toEqual(expect.objectContaining({
      state: 'confirmed',
      needs_attention: false,
    }))
  })
})

function buildExecutionInput(targets: Array<{ kind: 'venue' | 'vendor'; name: string; email: string }>) {
  return {
    userId: 'user-1',
    plan: {
      id: 'plan-1', user_id: 'user-1', title: 'Happy hour plan', event_type: 'Happy hour',
      status: 'ready', guest_count: 40, budget_cap_cents: null, neighborhood: 'San Francisco',
      date_window_start: null, date_window_end: null, ticketed: false, ticketing_model: 'rsvp',
      food_responsibility: 'venue', venue_terms: null, agent_action: null, profit_goal_cents: null,
      notes: null, metadata: {}, created_at: '2026-06-10T00:00:00.000Z', updated_at: '2026-06-10T00:00:00.000Z',
    },
    action: {
      id: 'action-1', plan_id: 'plan-1', action_type: 'email', description: 'Send approved Gmail outreach',
      provider: 'Gmail', target_type: 'outreach', target_id: null,
      payload_json: {
        kind: 'gmail_approved_outreach', targets, subject: 'Happy hour partnership inquiry',
        body_text: 'Hi {{place_name}},\n\nCan you support this event?\n\nThanks,\n{{sender_email}}',
      },
      amount_cents: 0, currency: 'usd', status: 'executing', approval_id: 'approval-1',
      executed_at: null, result_metadata: {}, created_at: '2026-06-10T00:00:00.000Z', updated_at: '2026-06-10T00:00:00.000Z',
    },
    approval: {
      id: 'approval-1', plan_id: 'plan-1', agent_action_id: 'action-1', action_label: 'Send outreach',
      provider: 'Gmail', event_date: null, price_cents: 0, fees_cents: 0, refund_terms: null,
      cancellation_terms: null, package_details: null, delivery_email: null, payment_method_id: null,
      status: 'approved', requested_amount_cents: 0, authorized_amount_cents: 0, authorized_by: 'user-1',
      authorized_at: '2026-06-10T00:00:00.000Z', approved_by: 'user-1', approved_at: '2026-06-10T00:00:00.000Z',
      expires_at: null, snapshot_hash: null, created_at: '2026-06-10T00:00:00.000Z', updated_at: '2026-06-10T00:00:00.000Z',
    },
  } as any
}
