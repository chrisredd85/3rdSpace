import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OutreachCommandCenter } from '@/components/planner/OutreachCommandCenter'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  )
}

const connectedState = {
  account: {
    id: 'gmail-1',
    provider: 'gmail',
    email_address: 'organizer@example.com',
    created_at: '2026-06-24T10:00:00.000Z',
    token_expires_at: null,
  },
  approval: { id: 'approval-1', status: 'pending' },
  approvalMessageId: 'message-1',
  planId: 'plan-1',
  threads: [
    {
      id: 'thread-1',
      plan_id: 'plan-1',
      target_name: 'Moongate Lounge',
      target_type: 'venue',
      target_email: 'events@moongate.example',
      state: 'waiting_for_reply',
      needs_attention: false,
      last_event_at: '2026-06-24T10:00:00.000Z',
      last_inbound_at: null,
      last_outbound_at: '2026-06-24T10:00:00.000Z',
      messages: [
        {
          id: 'message-1',
          direction: 'outbound',
          subject: 'Happy hour partnership inquiry',
          body_text: 'Can you host a 40-person happy hour?',
          from: 'organizer@example.com',
          gmail_message_id: 'gmail-message-1',
          gmail_thread_id: 'gmail-thread-1',
          sent_at: '2026-06-24T10:00:00.000Z',
          received_at: null,
        },
      ],
    },
    {
      id: 'thread-2',
      plan_id: 'plan-1',
      target_name: 'Stable Cafe',
      target_type: 'venue',
      target_email: 'events@stable.example',
      state: 'reply_received',
      needs_attention: true,
      last_event_at: '2026-06-24T11:00:00.000Z',
      last_inbound_at: '2026-06-24T11:00:00.000Z',
      last_outbound_at: '2026-06-24T10:00:00.000Z',
      messages: [
        {
          id: 'message-2',
          direction: 'inbound',
          subject: 'Re: Happy hour partnership inquiry',
          body_text: 'We can host that date with a $2,000 minimum spend.',
          from: 'events@stable.example',
          gmail_message_id: 'gmail-message-2',
          gmail_thread_id: 'gmail-thread-2',
          sent_at: null,
          received_at: '2026-06-24T11:00:00.000Z',
        },
      ],
    },
  ],
}

describe('OutreachCommandCenter', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.clearAllMocks()
  })

  it('renders outreach as a command center, not a manual composer first', async () => {
    global.fetch = jest.fn(() => jsonResponse(connectedState)) as jest.Mock

    render(<OutreachCommandCenter />)

    expect(await screen.findByRole('heading', { name: /^Outreach$/i })).toBeInTheDocument()
    expect(await screen.findByText('Agent proposal · awaiting you')).toBeInTheDocument()
    expect(screen.getByText('Agent-tracked partners')).toBeInTheDocument()
    expect(screen.getByText('Proposed outreach batch')).toBeInTheDocument()
    expect(screen.getByText('Agent recommendation')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Find partners/i })).toHaveAttribute('href', '/planner/outreach-search?plan=plan-1')
    expect(screen.getByText('Already sent · synced from Gmail')).toBeInTheDocument()
    expect(screen.queryByLabelText('Subject')).not.toBeInTheDocument()
  })

  it('keeps the custom composer behind the advanced panel', async () => {
    const user = userEvent.setup()
    global.fetch = jest.fn(() => jsonResponse(connectedState)) as jest.Mock

    render(<OutreachCommandCenter />)

    await screen.findByRole('heading', { name: /^Outreach$/i })
    await user.click(await screen.findByRole('button', { name: /Open custom composer/i }))

    expect(screen.getByText('Build a partner outreach batch')).toBeInTheDocument()
    expect(screen.getByLabelText('Subject')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create planner approval/i })).toBeInTheDocument()
  })

  it('prompts the organizer to connect Gmail before using outreach execution', async () => {
    global.fetch = jest.fn(() => jsonResponse({
      account: null,
      approval: null,
      approvalMessageId: null,
      planId: null,
      threads: [],
    })) as jest.Mock

    render(<OutreachCommandCenter />)

    expect(await screen.findByText('Connect Gmail first')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Connect Gmail/i })).toHaveAttribute('href', '/api/integrations/gmail/connect?returnTo=/planner/outreach')
  })

  it('syncs Gmail replies from a sent thread', async () => {
    const user = userEvent.setup()
    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/planner/outreach/gmail-approval' && !init?.method) return jsonResponse(connectedState)
      if (url === '/api/planner/outreach/gmail-approval/threads/thread-1/sync' && init?.method === 'POST') return jsonResponse({ ok: true })
      return jsonResponse({ error: `Unexpected request: ${url}` }, 500)
    })
    global.fetch = fetchMock as jest.Mock

    render(<OutreachCommandCenter />)

    expect((await screen.findAllByText('Moongate Lounge')).length).toBeGreaterThan(0)
    await user.click(screen.getAllByRole('button', { name: /Sync replies/i })[0])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/planner/outreach/gmail-approval/threads/thread-1/sync',
        expect.objectContaining({ method: 'POST' })
      )
    })
  })
})
