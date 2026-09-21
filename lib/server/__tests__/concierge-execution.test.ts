import {
  cancelConciergeHandoff,
  ConciergeExecutionError,
  executeOpportunityConciergeHandoff,
  executeVendorContactHandoff,
  executeVenueHoldConciergeHandoff,
  type ConciergeExecutionDb,
  type ConciergeExecutionInput,
} from '@/lib/server/concierge-execution'
import type { AgentAction, Approval, Plan } from '@/lib/types'

const PLAN_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const ACTION_ID = '33333333-3333-4333-8333-333333333333'
const APPROVAL_ID = '44444444-4444-4444-8444-444444444444'
const TARGET_ID = '55555555-5555-4555-8555-555555555555'
const TASK_ID = '66666666-6666-4666-8666-666666666666'

describe('concierge execution handlers', () => {
  it('queues an approved venue hold without claiming it was booked, paid, or sent', async () => {
    const db = makeDb({
      rpcResult: { data: [{ id: TASK_ID, event_id: null }], error: null },
    })
    const input = makeInput(db.client, {
      action_type: 'hold_request',
      status: 'approved',
      target_type: 'venue',
      target_id: TARGET_ID,
      provider: 'The Valencia Room',
      payload_json: { hold_duration_hours: 24 },
    })

    const result = await executeVenueHoldConciergeHandoff(input)

    expect(result).toEqual({
      handled: true,
      disposition: 'executing',
      metadata: expect.objectContaining({
        execution_mode: 'concierge_admin_queue',
        handoff_status: 'queued',
        admin_task_id: TASK_ID,
        outbound_message_sent: false,
      }),
    })
    expect(db.rpc).toHaveBeenCalledWith('enqueue_approved_admin_task', expect.objectContaining({
      p_plan_id: PLAN_ID,
      p_action_id: ACTION_ID,
      p_approval_id: APPROVAL_ID,
      p_actor_id: USER_ID,
      p_task_type: 'concierge_booking',
      p_host_message: expect.stringMatching(/Nothing has been booked or paid/),
    }))
  })

  it('re-dispatches a venue hold through the same idempotent queue command', async () => {
    const db = makeDb({
      rpcResult: { data: [{ id: TASK_ID, event_id: null }], error: null },
    })
    const input = makeInput(db.client, {
      action_type: 'hold_request',
      target_type: 'venue',
      target_id: TARGET_ID,
    })

    const first = await executeVenueHoldConciergeHandoff(input)
    const replay = await executeVenueHoldConciergeHandoff(input)

    expect(replay).toEqual(first)
    expect(db.rpc).toHaveBeenCalledTimes(2)
    expect(db.rpc.mock.calls[0]).toEqual(db.rpc.mock.calls[1])
  })

  it('cancels post-authorization work by action identity without needing a task id', async () => {
    const db = makeDb({
      rpcResult: { data: { id: TASK_ID, event_id: null, status: 'cancelled' }, error: null },
    })
    const input = makeInput(db.client, {
      action_type: 'hold_request',
      status: 'cancelled',
    })

    const result = await cancelConciergeHandoff(input, 'Host withdrew authorization.')

    expect(result).toEqual({
      cancelled: true,
      metadata: expect.objectContaining({
        handoff_status: 'cancelled',
        admin_task_id: TASK_ID,
        outbound_message_sent: false,
      }),
    })
    expect(db.rpc).toHaveBeenCalledWith('cancel_approved_admin_task', {
      p_plan_id: PLAN_ID,
      p_action_id: ACTION_ID,
      p_approval_id: APPROVAL_ID,
      p_actor_id: USER_ID,
      p_reason: 'Host withdrew authorization.',
      p_host_message: null,
    })
  })

  it('creates an unsent outreach draft when the vendor has a usable email', async () => {
    const db = makeDb({
      vendor: {
        id: TARGET_ID,
        name: 'Bay Area Audio',
        contact_email: 'BOOKINGS@EXAMPLE.COM',
        portfolio_url: 'https://example.com',
        discovery_vendor_id: null,
      },
      rpcResult: {
        data: {
          disposition: 'complete',
          outreach_thread_id: '77777777-7777-4777-8777-777777777777',
          outreach_message_id: '88888888-8888-4888-8888-888888888888',
          outbound_message_sent: false,
        },
        error: null,
      },
    })
    const input = makeInput(db.client, {
      action_type: 'vendor_contact',
      target_type: 'vendor',
      target_id: TARGET_ID,
      provider: 'Bay Area Audio',
    })

    const result = await executeVendorContactHandoff(input)

    expect(result).toEqual({
      handled: true,
      disposition: 'complete',
      metadata: expect.objectContaining({
        handoff_status: 'draft_ready',
        outbound_message_sent: false,
        send_requires_separate_approval: true,
      }),
    })
    expect(db.rpc).toHaveBeenCalledTimes(1)
    expect(db.rpc).toHaveBeenCalledWith('prepare_approved_vendor_contact_draft', {
      p_plan_id: PLAN_ID,
      p_action_id: ACTION_ID,
      p_approval_id: APPROVAL_ID,
      p_actor_id: USER_ID,
    })
  })

  it('queues contact verification when a vendor email is missing', async () => {
    const db = makeDb({
      vendor: {
        id: TARGET_ID,
        name: 'Bay Area Audio',
        contact_email: null,
        portfolio_url: 'https://example.com',
        discovery_vendor_id: null,
      },
      rpcResult: { data: [{ id: TASK_ID, event_id: null }], error: null },
    })
    const input = makeInput(db.client, {
      action_type: 'vendor_contact',
      target_type: 'vendor',
      target_id: TARGET_ID,
      provider: 'Bay Area Audio',
    })

    const result = await executeVendorContactHandoff(input)

    expect(result).toEqual({
      handled: true,
      disposition: 'executing',
      metadata: expect.objectContaining({
        handoff_status: 'queued',
        admin_task_id: TASK_ID,
        outbound_message_sent: false,
      }),
    })
    expect(db.rpc).toHaveBeenCalledWith('enqueue_approved_admin_task', expect.objectContaining({
      p_task_type: 'vendor_confirm',
      p_host_message: expect.stringMatching(/No outreach has been sent/),
    }))
  })

  it('fails closed for vendor reply capture instead of treating it as outbound contact', async () => {
    const db = makeDb()
    const input = makeInput(db.client, {
      action_type: 'vendor_contact',
      target_type: 'vendor_reply_capture',
      payload_json: { kind: 'vendor_reply_capture' },
    })

    await expect(executeVendorContactHandoff(input)).resolves.toEqual({
      handled: false,
      reason: 'vendor_reply_capture_is_not_outbound_contact',
    })
    expect(db.from).not.toHaveBeenCalled()
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('queues only approved opportunity targets that require concierge follow-up', async () => {
    const db = makeDb({
      rpcResult: { data: [{ id: TASK_ID, event_id: null }], error: null },
    })
    const input = makeInput(db.client, {
      action_type: 'opportunity_send_vendors',
      payload_json: {
        opportunity_brief_id: 'brief-1',
        invite_ids: ['claimed-direct-invite'],
        concierge_invite_ids: ['concierge-invite-1'],
        targets: [
          { id: TARGET_ID, route_to_concierge: true },
          { id: 'already-reachable', route_to_concierge: false },
        ],
      },
    })

    const result = await executeOpportunityConciergeHandoff(input)

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      disposition: 'executing',
    }))
    expect(db.rpc).toHaveBeenCalledWith('enqueue_approved_admin_task', expect.objectContaining({
      p_task_type: 'concierge_booking',
      p_metadata: expect.objectContaining({
        invite_ids: ['concierge-invite-1'],
        targets: [{ id: TARGET_ID, route_to_concierge: true }],
      }),
    }))
  })

  it('does not queue claimed opportunity invites from the general invite list', async () => {
    const db = makeDb()
    const input = makeInput(db.client, {
      action_type: 'opportunity_send_venues',
      payload_json: {
        invite_ids: ['claimed-direct-invite'],
        targets: [{ id: TARGET_ID, route_to_concierge: false }],
      },
    })

    await expect(executeOpportunityConciergeHandoff(input)).resolves.toEqual({
      handled: false,
      reason: 'no_concierge_targets',
    })
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('rejects mismatched action, approval, and plan identity before side effects', async () => {
    const db = makeDb()
    const input = makeInput(db.client, {
      action_type: 'hold_request',
      plan_id: '99999999-9999-4999-8999-999999999999',
    })

    await expect(executeVenueHoldConciergeHandoff(input)).rejects.toMatchObject<Partial<ConciergeExecutionError>>({
      code: 'concierge_identity_mismatch',
    })
    expect(db.rpc).not.toHaveBeenCalled()
  })
})

function makeInput(
  db: ConciergeExecutionDb,
  actionOverrides: Partial<AgentAction> = {}
): ConciergeExecutionInput {
  const plan = {
    id: PLAN_ID,
    user_id: USER_ID,
    title: 'Founder dinner',
    event_type: 'dinner',
    status: 'approved',
    guest_count: 80,
    budget_cap_cents: 800_000,
    neighborhood: 'Mission',
    date_window_start: '2026-08-01',
    date_window_end: '2026-08-01',
    ticketed: false,
    profit_goal_cents: null,
    notes: null,
    created_at: '2026-07-09T00:00:00.000Z',
    updated_at: '2026-07-09T00:00:00.000Z',
  } satisfies Plan
  const action = {
    id: ACTION_ID,
    plan_id: PLAN_ID,
    action_type: 'hold_request',
    description: 'Request venue hold',
    provider: 'The Valencia Room',
    target_type: 'venue',
    target_id: TARGET_ID,
    payload_json: {},
    amount_cents: 0,
    currency: 'usd',
    status: 'executing',
    approval_id: APPROVAL_ID,
    executed_at: null,
    result_metadata: {},
    created_at: '2026-07-09T00:00:00.000Z',
    updated_at: '2026-07-09T00:00:00.000Z',
    ...actionOverrides,
  } satisfies AgentAction
  const approval = {
    id: APPROVAL_ID,
    plan_id: PLAN_ID,
    agent_action_id: ACTION_ID,
    action_label: 'Approve action',
    provider: action.provider,
    event_date: '2026-08-01',
    price_cents: action.amount_cents,
    fees_cents: 0,
    refund_terms: null,
    cancellation_terms: null,
    package_details: null,
    delivery_email: null,
    payment_method_id: null,
    status: 'authorized',
    requested_amount_cents: action.amount_cents ?? 0,
    authorized_amount_cents: action.amount_cents,
    authorized_by: USER_ID,
    authorized_at: '2026-07-09T00:01:00.000Z',
    approved_by: null,
    approved_at: null,
    expires_at: null,
    snapshot_hash: 'snapshot-hash',
    created_at: '2026-07-09T00:00:00.000Z',
    updated_at: '2026-07-09T00:01:00.000Z',
  } satisfies Approval

  return { db, plan, action, approval, actorId: USER_ID }
}

type Vendor = {
  id: string
  name: string
  contact_email: string | null
  portfolio_url: string | null
  discovery_vendor_id: string | null
}

function makeDb(options: {
  vendor?: Vendor | null
  vendorError?: { message?: string; code?: string } | null
  rpcResult?: {
    data: unknown
    error: { message?: string; code?: string } | null
  }
} = {}) {
  const maybeSingle = jest.fn().mockResolvedValue({
    data: options.vendor ?? null,
    error: options.vendorError ?? null,
  })
  const from = jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({ maybeSingle })),
    })),
  }))
  const rpc = jest.fn().mockResolvedValue(
    options.rpcResult ?? { data: null, error: null }
  )

  return {
    client: { from, rpc } as unknown as ConciergeExecutionDb,
    from,
    rpc,
  }
}
