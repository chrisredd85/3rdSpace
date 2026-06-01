jest.mock('server-only', () => ({}))

jest.mock('@/lib/outreach/gmail', () => ({
  getUsableGmailAccessToken: jest.fn(),
  sendGmailMessage: jest.fn(),
}))

jest.mock('@/lib/server/agent-runs', () => ({
  logAgentRun: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: jest.fn(() => ({
      insert: jest.fn(() => Promise.resolve({ error: null })),
    })),
  })),
}))

import { sendGmailMessage } from '@/lib/outreach/gmail'
import { OutreachSendError, sendOutreachDraft } from '@/lib/outreach/send'

const rows = {
  outreach_threads: [
    {
      id: 'thread-1',
      plan_id: 'plan-1',
      user_id: 'user-1',
      target_type: 'venue',
      target_id: 'venue-1',
      target_name: 'Mission Hall',
      target_email: 'events@missionhall.example',
      channel: 'email',
      state: 'draft',
      source_agent_action_id: 'action-1',
      needs_attention: false,
      follow_up_count: 0,
      last_event_at: '2026-06-01T00:00:00.000Z',
      last_outbound_at: null,
      last_inbound_at: null,
      next_action_at: null,
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
    },
  ],
  outreach_messages: [
    {
      id: 'draft-1',
      thread_id: 'thread-1',
      agent_action_id: 'action-1',
      approval_id: null,
      direction: 'outbound',
      gmail_message_id: null,
      gmail_thread_id: null,
      subject: 'Founder dinner availability',
      body_text: 'Can you confirm availability?',
      body_html: null,
      headers_json: {},
      sent_at: null,
      received_at: null,
      classification_json: null,
      created_at: '2026-06-01T00:00:00.000Z',
    },
  ],
  plans: [{ id: 'plan-1', user_id: 'user-1' }],
  approvals: [],
}

describe('sendOutreachDraft', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects sending when the parent action is not approved', async () => {
    const db = makeDb(rows)

    await expect(sendOutreachDraft({
      db,
      threadId: 'thread-1',
      draftMessageId: 'draft-1',
      userId: 'user-1',
    })).rejects.toThrow(OutreachSendError)

    expect(sendGmailMessage).not.toHaveBeenCalled()
  })
})

function makeDb(seed: Record<string, Array<Record<string, any>>>) {
  return {
    from(table: string) {
      return makeQuery(table, seed)
    },
  }
}

function makeQuery(table: string, seed: Record<string, Array<Record<string, any>>>) {
  const filters: Array<(row: Record<string, any>) => boolean> = []

  const query: any = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value)
      return query
    },
    in: (column: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[column]))
      return query
    },
    is: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value)
      return query
    },
    order: () => query,
    limit: () => query,
    maybeSingle: () => Promise.resolve({
      data: (seed[table] ?? []).find((row) => filters.every((filter) => filter(row))) ?? null,
      error: null,
    }),
  }

  return query
}
