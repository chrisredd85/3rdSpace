import {
  cancelExecutingCanonicalQuoteBooking,
  cancelStagedCanonicalQuoteBooking,
  executeCanonicalQuoteBooking,
  isCanonicalQuoteBookingAction,
  resumeCanonicalQuoteBookingsAfterMaterialization,
  stageCanonicalQuoteBooking,
} from '../canonicalQuoteBooking'
import type { AgentAction, Approval, Plan } from '@/lib/types'

const PLAN_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const RESPONSE_ID = '33333333-3333-4333-8333-333333333333'
const DISCOVERY_ID = '44444444-4444-4444-8444-444444444444'
const EVENT_ID = '55555555-5555-4555-8555-555555555555'

describe('canonical quote booking execution', () => {
  it('loads the trusted response and stages an immutable approval snapshot by response id', async () => {
    const plan = buildPlan()
    const rpc = jest.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe('stage_plan_quote_booking')
      return {
        data: {
          existing: false,
          plan,
          agent_action: { id: args.p_action_id, plan_id: PLAN_ID, status: 'pending' },
          approval: { id: args.p_approval_id, plan_id: PLAN_ID, status: 'pending' },
          approval_message: { id: 'message-1' },
        },
        error: null,
      }
    })
    const db = {
      from: jest.fn((table: string) => {
        expect(table).toBe('venue_outreach_responses')
        return trustedResponseQuery({
          id: RESPONSE_ID,
          plan_id: PLAN_ID,
          discovery_venue_id: DISCOVERY_ID,
          classification: 'quote_received',
          classification_confidence: 0.94,
          quoted_price_cents: 175_000,
          quoted_deal_model: 'flat_rental',
          availability_confirmed: true,
          capacity_confirmed: 80,
          conditions: ['72-hour cancellation'],
          raw_response_excerpt: 'Available for $1,750.',
          extracted_at: '2026-07-09T19:00:00.000Z',
          discovery_venues: {
            id: DISCOVERY_ID,
            name: 'Moongate Lounge',
            claimed_venue_id: null,
          },
        })
      }),
      rpc,
    }

    const result = await stageCanonicalQuoteBooking({
      db,
      plan,
      actorId: USER_ID,
      quoteKind: 'venue',
      responseId: RESPONSE_ID,
    })

    expect(result.existing).toBe(false)
    expect(rpc).toHaveBeenCalledWith('stage_plan_quote_booking', expect.objectContaining({
      p_plan_id: PLAN_ID,
      p_actor_id: USER_ID,
      p_quote_kind: 'venue',
      p_response_id: RESPONSE_ID,
      p_action_payload: expect.objectContaining({
        kind: 'canonical_quote_booking',
        quote_response_id: RESPONSE_ID,
        target_id: DISCOVERY_ID,
        target_name: 'Moongate Lounge',
        requested_amount_cents: 175_000,
        outbound_message_sent: false,
      }),
      p_snapshot_json: expect.objectContaining({ schema_version: 2 }),
      p_snapshot_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
  })

  it('cancels the staged action and approval through one service-only RPC', async () => {
    const plan = buildPlan()
    const rpc = jest.fn().mockResolvedValue({
      data: {
        existing: false,
        plan,
        agent_action: { id: 'action-1', plan_id: PLAN_ID, status: 'cancelled' },
        approval: { id: 'approval-1', plan_id: PLAN_ID, status: 'cancelled' },
      },
      error: null,
    })

    const result = await cancelStagedCanonicalQuoteBooking({
      db: { from: jest.fn(), rpc },
      planId: PLAN_ID,
      actorId: USER_ID,
      quoteKind: 'venue',
      responseId: RESPONSE_ID,
    })

    expect(result.agent_action.status).toBe('cancelled')
    expect(result.approval.status).toBe('cancelled')
    expect(rpc).toHaveBeenCalledWith('cancel_staged_plan_quote_booking', {
      p_plan_id: PLAN_ID,
      p_actor_id: USER_ID,
      p_quote_kind: 'venue',
      p_response_id: RESPONSE_ID,
    })
  })

  it('accepts a trusted quote after reciprocal event materialization using the event date', async () => {
    const plan = buildPlan({
      status: 'executing',
      materialized_event_id: EVENT_ID,
      date_window_start: '2026-08-18',
      date_window_end: '2026-08-22',
    })
    const rpc = jest.fn().mockImplementation(async (_name: string, args: Record<string, unknown>) => ({
      data: {
        existing: false,
        plan,
        agent_action: { id: args.p_action_id, plan_id: PLAN_ID, status: 'pending' },
        approval: { id: args.p_approval_id, plan_id: PLAN_ID, status: 'pending' },
        approval_message: { id: 'message-1' },
      },
      error: null,
    }))
    const db = {
      from: jest.fn((table: string) => {
        if (table === 'events') {
          return singleRowSelect({ id: EVENT_ID, plan_id: PLAN_ID, event_date: '2026-08-20' })
        }
        return trustedResponseQuery({
          id: RESPONSE_ID,
          plan_id: PLAN_ID,
          discovery_venue_id: DISCOVERY_ID,
          classification: 'quote_received',
          quoted_price_cents: 175_000,
          availability_confirmed: true,
          conditions: [],
          discovery_venues: { id: DISCOVERY_ID, name: 'Moongate Lounge' },
        })
      }),
      rpc,
    }

    await stageCanonicalQuoteBooking({
      db,
      plan,
      actorId: USER_ID,
      quoteKind: 'venue',
      responseId: RESPONSE_ID,
    })

    expect(rpc).toHaveBeenCalledWith('stage_plan_quote_booking', expect.objectContaining({
      p_action_payload: expect.objectContaining({ event_date: '2026-08-20' }),
      p_snapshot_json: expect.objectContaining({
        approval: expect.objectContaining({ event_date: '2026-08-20' }),
      }),
    }))
  })

  it('waits truthfully until exact canonical event materialization', async () => {
    const action = buildAction()
    const approval = buildApproval()
    const rpc = jest.fn().mockResolvedValue({ data: buildPlan({ status: 'approved' }), error: null })

    const result = await executeCanonicalQuoteBooking({
      db: { from: jest.fn(), rpc },
      action,
      approval,
      plan: buildPlan({ status: 'ready' }),
      actorId: USER_ID,
    })

    expect(result).toEqual({
      disposition: 'waiting',
      metadata: expect.objectContaining({
        canonical_booking_status: 'waiting_for_event_materialization',
        requires_event_materialization: true,
        outbound_message_sent: false,
      }),
    })
    expect(rpc).toHaveBeenCalledWith('transition_plan_status', expect.objectContaining({
      p_expected_status: 'ready',
      p_to_status: 'approved',
      p_trigger: 'approval_authorized',
    }))
  })

  it('creates one pending canonical booking after materialization and preserves concierge waits', async () => {
    const action = buildAction({ status: 'executing' })
    const approval = buildApproval()
    const plan = buildPlan({ status: 'executing', materialized_event_id: EVENT_ID })
    const rpc = jest.fn()
      .mockResolvedValueOnce({
        data: {
          disposition: 'executing',
          existing: false,
          booking_kind: 'venue',
          booking_id: 'booking-1',
          booking_status: 'pending',
          event_id: EVENT_ID,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          disposition: 'waiting',
          reason: 'requires_concierge',
          requires_concierge: true,
          event_id: EVENT_ID,
        },
        error: null,
      })
    const db = { from: jest.fn(), rpc }

    await expect(executeCanonicalQuoteBooking({ db, action, approval, plan, actorId: USER_ID }))
      .resolves.toEqual(expect.objectContaining({
        disposition: 'executing',
        metadata: expect.objectContaining({
          canonical_booking_status: 'pending_partner_confirmation',
          booking_id: 'booking-1',
        }),
      }))

    await expect(executeCanonicalQuoteBooking({ db, action, approval, plan, actorId: USER_ID }))
      .resolves.toEqual(expect.objectContaining({
        disposition: 'waiting',
        metadata: expect.objectContaining({
          canonical_booking_status: 'requires_concierge',
          outbound_message_sent: false,
        }),
      }))

    expect(rpc).toHaveBeenNthCalledWith(1, 'create_canonical_booking_from_approval', {
      p_plan_id: PLAN_ID,
      p_agent_action_id: action.id,
      p_approval_id: approval.id,
      p_actor_id: USER_ID,
    })
  })

  it('idempotently resumes the approved action after event materialization', async () => {
    const plan = buildPlan({ status: 'executing', materialized_event_id: EVENT_ID })
    const approvedAction = buildAction({ status: 'approved' })
    const executingAction = buildAction({ status: 'executing' })
    const approval = buildApproval()
    const actionUpdatePayloads: Array<Record<string, unknown>> = []

    const db = {
      from: jest.fn((table: string) => {
        if (table === 'plans') return singleRowSelect(plan)
        if (table === 'approvals') return listSelect([approval])
        if (table === 'agent_action_audit_log') {
          return { insert: jest.fn().mockResolvedValue({ error: null }) }
        }
        if (table === 'agent_actions') {
          return {
            select: jest.fn(() => listSelect([approvedAction])),
            update: jest.fn((payload: Record<string, unknown>) => {
              actionUpdatePayloads.push(payload)
              return actionUpdatePayloads.length === 1
                ? updateReturningSingle(executingAction)
                : updateWithoutReturn()
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: jest.fn().mockResolvedValue({
        data: {
          disposition: 'executing',
          existing: true,
          booking_kind: 'venue',
          booking_id: 'booking-1',
          booking_status: 'pending',
          event_id: EVENT_ID,
        },
        error: null,
      }),
    }

    const result = await resumeCanonicalQuoteBookingsAfterMaterialization({
      db,
      planId: PLAN_ID,
      actorId: USER_ID,
    })

    expect(result).toEqual([
      expect.objectContaining({
        disposition: 'executing',
        metadata: expect.objectContaining({
          existing: true,
          booking_id: 'booking-1',
          canonical_booking_status: 'pending_partner_confirmation',
        }),
      }),
    ])
    expect(actionUpdatePayloads[0]).toEqual(expect.objectContaining({
      status: 'executing',
      result_metadata: expect.objectContaining({
        canonical_booking_status: 'resuming_after_event_materialization',
      }),
    }))
    expect(actionUpdatePayloads[1]).toEqual(expect.objectContaining({
      result_metadata: expect.objectContaining({
        booking_id: 'booking-1',
        agent_action_id: approvedAction.id,
      }),
    }))
    expect(db.rpc).toHaveBeenCalledTimes(1)
  })

  it('cancels an executing pending booking without rewriting the authorized approval', async () => {
    const action = buildAction({ status: 'executing' })
    const approval = buildApproval({ status: 'authorized' })
    const plan = buildPlan({ status: 'executing', materialized_event_id: EVENT_ID })
    const rpc = jest.fn().mockResolvedValue({
      data: {
        existing: false,
        disposition: 'waiting',
        booking_id: 'booking-1',
        booking_status: 'cancelled',
        action_status: 'cancelled',
        approval_status: 'authorized',
        plan_status: 'executing',
      },
      error: null,
    })

    const result = await cancelExecutingCanonicalQuoteBooking({
      db: { from: jest.fn(), rpc },
      action,
      approval,
      plan,
      actorId: USER_ID,
      reason: 'Host changed vendor strategy',
    })

    expect(result).toEqual({
      disposition: 'waiting',
      metadata: expect.objectContaining({
        canonical_booking_status: 'cancelled',
        booking_status: 'cancelled',
        action_status: 'cancelled',
        approval_status: 'authorized',
        approval_status_preserved: 'authorized',
        outbound_message_sent: false,
      }),
    })
    expect(rpc).toHaveBeenCalledWith('cancel_executing_canonical_quote_booking', {
      p_plan_id: PLAN_ID,
      p_agent_action_id: action.id,
      p_approval_id: approval.id,
      p_actor_id: USER_ID,
      p_reason: 'Host changed vendor strategy',
    })
  })

  it('recognizes only the payload-tagged concierge action', () => {
    expect(isCanonicalQuoteBookingAction(buildAction())).toBe(true)
    expect(isCanonicalQuoteBookingAction(buildAction({ payload_json: { kind: 'venue_hold' } }))).toBe(false)
    expect(isCanonicalQuoteBookingAction(buildAction({ action_type: 'payment' }))).toBe(false)
  })
})

function trustedResponseQuery(data: Record<string, unknown>) {
  const query = {
    select: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn().mockResolvedValue({ data, error: null }),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  return query
}

function singleRowSelect(data: unknown) {
  const query = {
    select: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn().mockResolvedValue({ data, error: null }),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  return query
}

function listSelect(data: unknown[]) {
  const query = {
    data,
    error: null,
    select: jest.fn(),
    eq: jest.fn(),
    contains: jest.fn(),
    in: jest.fn(),
    order: jest.fn().mockResolvedValue({ data, error: null }),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.contains.mockReturnValue(query)
  query.in.mockReturnValue(query)
  return query
}

function updateReturningSingle(data: unknown) {
  const query = {
    eq: jest.fn(),
    select: jest.fn(),
    maybeSingle: jest.fn().mockResolvedValue({ data, error: null }),
  }
  query.eq.mockReturnValue(query)
  query.select.mockReturnValue(query)
  return query
}

function updateWithoutReturn() {
  const query = { error: null, eq: jest.fn() }
  query.eq.mockReturnValue(query)
  return query
}

function buildPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: PLAN_ID,
    user_id: USER_ID,
    title: 'Community dinner',
    event_type: 'community_meetup',
    status: 'ready',
    guest_count: 60,
    budget_cap_cents: 500_000,
    neighborhood: 'Oakland',
    date_window_start: '2026-08-20',
    date_window_end: '2026-08-20',
    ticketed: false,
    ticketing_model: null,
    food_responsibility: null,
    profit_goal_cents: null,
    notes: null,
    metadata: {},
    materialized_event_id: null,
    created_at: '2026-07-09T12:00:00.000Z',
    updated_at: '2026-07-09T12:00:00.000Z',
    ...overrides,
  } as Plan
}

function buildAction(overrides: Partial<AgentAction> = {}): AgentAction {
  return {
    id: 'action-1',
    plan_id: PLAN_ID,
    action_type: 'concierge_queue',
    description: 'Prepare quote booking',
    provider: 'Moongate Lounge',
    target_type: 'discovery_venue',
    target_id: DISCOVERY_ID,
    payload_json: {
      kind: 'canonical_quote_booking',
      quote_kind: 'venue',
      quote_response_id: RESPONSE_ID,
    },
    amount_cents: 175_000,
    currency: 'usd',
    status: 'approved',
    approval_id: 'approval-1',
    executed_at: null,
    result_metadata: {},
    created_at: '2026-07-09T12:00:00.000Z',
    updated_at: '2026-07-09T12:00:00.000Z',
    ...overrides,
  } as AgentAction
}

function buildApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 'approval-1',
    plan_id: PLAN_ID,
    agent_action_id: 'action-1',
    action_label: 'Approve booking request with Moongate Lounge',
    provider: 'Moongate Lounge',
    event_date: '2026-08-20',
    price_cents: 175_000,
    fees_cents: 0,
    requested_amount_cents: 175_000,
    status: 'authorized',
    authorized_by: USER_ID,
    authorized_at: '2026-07-09T12:05:00.000Z',
    snapshot_hash: 'a'.repeat(64),
    expires_at: '2026-07-10T12:00:00.000Z',
    created_at: '2026-07-09T12:00:00.000Z',
    updated_at: '2026-07-09T12:05:00.000Z',
    ...overrides,
  } as Approval
}
