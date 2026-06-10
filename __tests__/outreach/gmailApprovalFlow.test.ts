jest.mock('server-only', () => ({}))

jest.mock('@/lib/outreach/gmail', () => ({
  getUsableGmailAccessToken: jest.fn().mockResolvedValue('gmail-access-token'),
  sendGmailMessage: jest.fn(),
  listGmailThreadMessages: jest.fn(),
  modifyGmailThreadLabels: jest.fn().mockResolvedValue({ id: 'gmail-thread-1' }),
}))

import {
  executeApprovedGmailOutreach,
  markGmailOutreachThreadHandled,
  syncGmailOutreachThread,
} from '@/lib/outreach/gmailApprovalFlow'
import {
  listGmailThreadMessages,
  modifyGmailThreadLabels,
  sendGmailMessage,
} from '@/lib/outreach/gmail'

const mockSendGmailMessage = sendGmailMessage as jest.Mock
const mockListGmailThreadMessages = listGmailThreadMessages as jest.Mock
const mockModifyGmailThreadLabels = modifyGmailThreadLabels as jest.Mock

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
  private inFilters: Array<[string, unknown[]]> = []
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
      this.inFilters.every(([field, values]) => values.includes(row[field])) &&
      this.nullFilters.every((field) => row[field] == null)
    )
  }
}

describe('Gmail approval flow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSendGmailMessage
      .mockResolvedValueOnce({ gmailMessageId: 'gmail-message-1', gmailThreadId: 'gmail-thread-1', labelIds: ['SENT'] })
      .mockResolvedValueOnce({ gmailMessageId: 'gmail-message-2', gmailThreadId: 'gmail-thread-2', labelIds: ['SENT'] })
  })

  it('sends Gmail only after approved execution and records outreach threads', async () => {
    const db = new MemoryDb()

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
        target_type: 'venue',
        target_id: null,
        payload_json: {
          kind: 'gmail_approved_outreach',
          targets: [
            { name: 'Stable Cafe', email: 'stable@example.com' },
            { name: 'Mission Social Hall', email: 'mission@example.com' },
          ],
          subject: 'Happy hour partnership inquiry',
          body_text: 'Hi {{venue_name}},\n\nCan you host this event?\n\nThanks,\n{{sender_email}}',
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
        action_label: 'Send outreach to 2 venues',
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
    expect(mockSendGmailMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      to: 'stable@example.com',
      bodyText: expect.stringContaining('Stable Cafe'),
    }))
    expect(db.rows.outreach_threads).toHaveLength(2)
    expect(db.rows.outreach_messages).toHaveLength(2)
    expect(db.rows.plan_messages[0]).toEqual(expect.objectContaining({
      message_type: 'status_update',
      metadata: expect.objectContaining({ outbound_message_sent: true }),
    }))
  })

  it('syncs Gmail replies and marks the thread handled using modify', async () => {
    const db = new MemoryDb()
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
