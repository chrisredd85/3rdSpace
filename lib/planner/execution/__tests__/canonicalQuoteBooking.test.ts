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

  it('does not turn an unknown price into a zero-cent authorization', async () => {
    const rpc = jest.fn()
    const db = {
      from: jest.fn(() => trustedResponseQuery({
        id: RESPONSE_ID,
        plan_id: PLAN_ID,
        discovery_venue_id: DISCOVERY_ID,
        classification: 'quote_received',
        quoted_price_cents: null,
        quoted_deal_model: null,
        availability_confirmed: true,
        conditions: [],
        discovery_venues: { id: DISCOVERY_ID, name: 'Moongate Lounge' },
      })),
      rpc,
    }

    await expect(stageCanonicalQuoteBooking({
      db,
      plan: buildPlan(),
      actorId: USER_ID,
      quoteKind: 'venue',
      responseId: RESPONSE_ID,
    })).rejects.toThrow('canonical_quote_booking_price_required')
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(['free_space', 'CHI'])(
    'freezes zero cents only for the explicit zero-upfront venue deal model %s',
    async (dealModel) => {
    const plan = buildPlan()
    const rpc = jest.fn().mockImplementation(async (_name: string, args: Record<string, unknown>) => ({
      data: {
        existing: false,
        plan,
        agent_action: { id: args.p_action_id, plan_id: PLAN_ID, status: 'pending' },
        approval: { id: args.p_approval_id, plan_id: PLAN_ID, status: 'pending' },
        approval_message: { id: 'message-free' },
      },
      error: null,
    }))
    const db = {
      from: jest.fn(() => trustedResponseQuery({
        id: RESPONSE_ID,
        plan_id: PLAN_ID,
        discovery_venue_id: DISCOVERY_ID,
        classification: 'quote_received',
        quoted_price_cents: null,
        quoted_deal_model: dealModel,
        availability_confirmed: true,
        conditions: [],
        discovery_venues: { id: DISCOVERY_ID, name: 'Moongate Lounge' },
      })),
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
      p_action_payload: expect.objectContaining({ requested_amount_cents: 0, price_cents: 0 }),
      p_snapshot_json: expect.objectContaining({
        approval: expect.objectContaining({ requested_amount_cents: 0, price_cents: 0 }),
      }),
    }))
    },
  )

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

  it.each(['executing', 'booked'] as const)(
    'accepts a trusted quote after reciprocal event materialization while the plan is %s',
    async (status) => {
    const plan = buildPlan({
      status,
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
    },
  )

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

  it('classifies a stale current approval as re-approval instead of a transient execution error', async () => {
    const rpc = jest.fn()
    const result = await executeCanonicalQuoteBooking({
      db: { from: jest.fn(), rpc },
      action: buildAction({ status: 'approved' }),
      approval: buildApproval({ status: 're_approval_required' }),
      plan: buildPlan({ status: 'executing', materialized_event_id: EVENT_ID }),
      actorId: USER_ID,
    })

    expect(result).toEqual({
      disposition: 'waiting',
      metadata: expect.objectContaining({
        canonical_booking_status: 'reapproval_required',
        reapproval_required: true,
        reapproval_reason: 'approval_stale',
      }),
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('idempotently resumes the approved action after event materialization', async () => {
    const plan = buildPlan({ status: 'executing', materialized_event_id: EVENT_ID })
    const approvedAction = buildAction({ status: 'approved' })
    const executingAction = buildAction({
      status: 'executing',
      result_metadata: { canonical_booking_status: 'resuming_after_event_materialization' },
    })
    const approval = buildApproval()
    const actionUpdatePayloads: Array<Record<string, unknown>> = []
    const operationOrder: string[] = []

    const db = {
      from: jest.fn((table: string) => {
        if (table === 'plans') return singleRowSelect(plan)
        if (table === 'approvals') return listSelect([approval])
        if (table === 'agent_actions') {
          return {
            select: jest.fn(() => listSelect([approvedAction])),
            update: jest.fn((payload: Record<string, unknown>) => {
              operationOrder.push('action_update')
              actionUpdatePayloads.push(payload)
              return updateReturningSingle({
                ...executingAction,
                result_metadata: payload.result_metadata,
              })
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc: jest.fn().mockImplementation(async (name: string) => {
        if (name === 'claim_canonical_quote_booking_materialization_resume') {
          operationOrder.push('claim_rpc')
          return {
            data: { existing: false, transitioned: true, agent_action: executingAction },
            error: null,
          }
        }
        operationOrder.push('booking_rpc')
        return {
          data: {
            disposition: 'executing',
            existing: true,
            booking_kind: 'venue',
            booking_id: 'booking-1',
            booking_status: 'pending',
            event_id: EVENT_ID,
          },
          error: null,
        }
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
      result_metadata: expect.objectContaining({
        booking_id: 'booking-1',
        agent_action_id: approvedAction.id,
      }),
    }))
    expect(operationOrder).toEqual(['claim_rpc', 'booking_rpc', 'action_update'])
    expect(db.rpc).toHaveBeenNthCalledWith(1, 'claim_canonical_quote_booking_materialization_resume', {
      p_plan_id: PLAN_ID,
      p_agent_action_id: approvedAction.id,
      p_approval_id: approval.id,
      p_actor_id: USER_ID,
      p_expected_snapshot_hash: approval.snapshot_hash,
    })
    expect(db.rpc).toHaveBeenCalledTimes(2)
  })

  it('requires re-approval when authorization expired before materialization could start the booking', async () => {
    const plan = buildPlan({ status: 'executing', materialized_event_id: EVENT_ID })
    const action = buildAction({ status: 'approved' })
    const approval = buildApproval({
      status: 'authorized',
      expires_at: '2000-01-01T00:00:00.000Z',
    })
    const persistedApproval = buildApproval({
      status: 're_approval_required',
      expires_at: approval.expires_at,
    })
    const update = jest.fn()
    const rpc = jest.fn().mockResolvedValue({
      data: {
        existing: false,
        disposition: 'reapproval_required',
        reason: 'approval_expired',
        approval: persistedApproval,
        agent_action: action,
      },
      error: null,
    })
    const db = {
      from: jest.fn((table: string) => {
        if (table === 'plans') return singleRowSelect(plan)
        if (table === 'approvals') return listSelect([approval])
        if (table === 'agent_actions') {
          return {
            select: jest.fn(() => listSelect([action], action)),
            update,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    }

    await expect(resumeCanonicalQuoteBookingsAfterMaterialization({
      db,
      planId: PLAN_ID,
      actorId: USER_ID,
    })).resolves.toEqual([{
      disposition: 'waiting',
      metadata: expect.objectContaining({
        canonical_booking_status: 'reapproval_required',
        reapproval_required: true,
        reapproval_reason: 'approval_expired',
        approval_id: approval.id,
      }),
    }])

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('require_canonical_quote_booking_reapproval', {
      p_plan_id: PLAN_ID,
      p_agent_action_id: action.id,
      p_approval_id: approval.id,
      p_actor_id: USER_ID,
      p_expected_snapshot_hash: approval.snapshot_hash,
      p_reason: 'approval_expired',
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('preserves already-started booking evidence after approval expiry without recreating it', async () => {
    const plan = buildPlan({ status: 'executing', materialized_event_id: EVENT_ID })
    const action = buildAction({
      status: 'executing',
      result_metadata: {
        canonical_booking_status: 'pending_partner_confirmation',
        booking_id: 'booking-started',
        booking_kind: 'venue',
        booking_status: 'pending',
        event_id: EVENT_ID,
      },
    })
    const approval = buildApproval({
      status: 'authorized',
      expires_at: '2000-01-01T00:00:00.000Z',
    })
    const update = jest.fn()
    const rpc = jest.fn()
    const db = {
      from: jest.fn((table: string) => {
        if (table === 'plans') return singleRowSelect(plan)
        if (table === 'approvals') return listSelect([approval])
        if (table === 'agent_actions') {
          return {
            select: jest.fn(() => listSelect([action], action)),
            update,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    }

    await expect(resumeCanonicalQuoteBookingsAfterMaterialization({
      db,
      planId: PLAN_ID,
      actorId: USER_ID,
    })).resolves.toEqual([expect.objectContaining({
      disposition: 'executing',
      metadata: expect.objectContaining({
        existing: true,
        canonical_booking_status: 'pending_partner_confirmation',
        booking_id: 'booking-started',
        booking_kind: 'venue',
      }),
    })])

    expect(rpc).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('preserves an already-queued operator task after approval expiry', async () => {
    const plan = buildPlan({ status: 'executing', materialized_event_id: EVENT_ID })
    const action = buildAction({
      status: 'executing',
      result_metadata: {
        canonical_booking_status: 'requires_concierge',
        execution_mode: 'concierge_admin_queue',
        handoff_status: 'queued',
        admin_task_id: 'task-started',
        event_id: EVENT_ID,
        outbound_message_sent: false,
      },
    })
    const approval = buildApproval({ expires_at: '2000-01-01T00:00:00.000Z' })
    const update = jest.fn()
    const rpc = jest.fn()
    const db = {
      from: jest.fn((table: string) => {
        if (table === 'plans') return singleRowSelect(plan)
        if (table === 'approvals') return listSelect([approval])
        if (table === 'agent_actions') {
          return {
            select: jest.fn(() => listSelect([action], action)),
            update,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    }

    await expect(resumeCanonicalQuoteBookingsAfterMaterialization({
      db,
      planId: PLAN_ID,
      actorId: USER_ID,
    })).resolves.toEqual([expect.objectContaining({
      disposition: 'executing',
      metadata: expect.objectContaining({
        existing: true,
        canonical_booking_status: 'requires_concierge',
        admin_task_id: 'task-started',
      }),
    })])
    expect(rpc).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('moves an expired materialization wait to atomic re-approval without treating it as retryable', async () => {
    const plan = buildPlan({ status: 'executing', materialized_event_id: EVENT_ID })
    const waitingAction = buildAction({
      status: 'executing',
      result_metadata: {
        canonical_booking_status: 'waiting_for_event_materialization',
        outbound_message_sent: false,
      },
    })
    const expiredApproval = buildApproval({ expires_at: '2000-01-01T00:00:00.000Z' })
    const markedApproval = buildApproval({
      status: 're_approval_required',
      expires_at: expiredApproval.expires_at,
    })
    const resetAction = buildAction({
      status: 'approved',
      result_metadata: {
        canonical_booking_status: 'reapproval_required',
        reapproval_reason: 'approval_expired',
        outbound_message_sent: false,
      },
    })
    const rpc = jest.fn().mockImplementation(async (name: string) => {
      if (name === 'create_canonical_booking_from_approval') {
        return {
          data: null,
          error: { code: '23514', message: 'create_canonical_booking_requires_executable_approval' },
        }
      }
      if (name === 'require_canonical_quote_booking_reapproval') {
        return {
          data: {
            existing: false,
            disposition: 'reapproval_required',
            reason: 'approval_expired',
            approval: markedApproval,
            agent_action: resetAction,
          },
          error: null,
        }
      }
      throw new Error(`Unexpected RPC: ${name}`)
    })
    const update = jest.fn()
    const db = {
      from: jest.fn((table: string) => {
        if (table === 'plans') return singleRowSelect(plan)
        if (table === 'approvals') return listSelect([expiredApproval])
        if (table === 'agent_actions') {
          return {
            select: jest.fn(() => listSelect([waitingAction], waitingAction)),
            update,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    }

    const result = await resumeCanonicalQuoteBookingsAfterMaterialization({
      db,
      planId: PLAN_ID,
      actorId: USER_ID,
    })

    expect(result).toEqual([expect.objectContaining({
      disposition: 'waiting',
      metadata: expect.objectContaining({
        canonical_booking_status: 'reapproval_required',
        reapproval_reason: 'approval_expired',
        approval_id: markedApproval.id,
      }),
    })])
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'create_canonical_booking_from_approval',
      'require_canonical_quote_booking_reapproval',
    ])
    expect(update).not.toHaveBeenCalled()
  })

  it('binds each action to its current approval id instead of an older unordered version', async () => {
    const plan = buildPlan({ status: 'executing', materialized_event_id: EVENT_ID })
    const currentApproval = buildApproval({ id: 'approval-current' })
    const oldApproval = buildApproval({
      id: 'approval-old',
      snapshot_hash: 'b'.repeat(64),
      created_at: '2026-07-08T12:00:00.000Z',
    })
    const approvedAction = buildAction({ approval_id: currentApproval.id })
    const executingAction = buildAction({
      approval_id: currentApproval.id,
      status: 'executing',
      result_metadata: { canonical_booking_status: 'resuming_after_event_materialization' },
    })
    const update = jest.fn((payload: Record<string, unknown>) => updateReturningSingle({
      ...executingAction,
      result_metadata: payload.result_metadata,
    }))
    const rpc = jest.fn().mockImplementation(async (name: string) => name ===
      'claim_canonical_quote_booking_materialization_resume'
      ? { data: { existing: false, transitioned: true, agent_action: executingAction }, error: null }
      : {
          data: {
            disposition: 'executing',
            existing: true,
            booking_kind: 'venue',
            booking_id: 'booking-current',
            booking_status: 'pending',
            event_id: EVENT_ID,
          },
          error: null,
        })
    const db = {
      from: jest.fn((table: string) => {
        if (table === 'plans') return singleRowSelect(plan)
        // Deliberately return the obsolete row last. Mapping by agent_action_id
        // would select it; binding action.approval_id must select currentApproval.
        if (table === 'approvals') return listSelect([currentApproval, oldApproval])
        if (table === 'agent_actions') {
          return {
            select: jest.fn(() => listSelect([approvedAction], approvedAction)),
            update,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    }

    await resumeCanonicalQuoteBookingsAfterMaterialization({
      db,
      planId: PLAN_ID,
      actorId: USER_ID,
    })

    expect(rpc).toHaveBeenCalledWith('create_canonical_booking_from_approval', expect.objectContaining({
      p_agent_action_id: approvedAction.id,
      p_approval_id: currentApproval.id,
    }))
    expect(rpc).toHaveBeenCalledWith(
      'claim_canonical_quote_booking_materialization_resume',
      expect.objectContaining({ p_approval_id: currentApproval.id }),
    )
  })

  it('queues and persists one operator task when an approved quote still requires concierge', async () => {
    const plan = buildPlan({ status: 'executing', materialized_event_id: EVENT_ID })
    const approvedAction = buildAction({ status: 'approved' })
    const executingAction = buildAction({
      status: 'executing',
      result_metadata: { canonical_booking_status: 'resuming_after_event_materialization' },
    })
    const approval = buildApproval()
    const updatePayloads: Array<Record<string, unknown>> = []
    const update = jest.fn((payload: Record<string, unknown>) => {
      updatePayloads.push(payload)
      return updateReturningSingle({
        ...executingAction,
        result_metadata: payload.result_metadata,
      })
    })
    const rpc = jest.fn().mockImplementation(async (name: string) => {
      if (name === 'claim_canonical_quote_booking_materialization_resume') {
        return {
          data: { existing: false, transitioned: true, agent_action: executingAction },
          error: null,
        }
      }
      if (name === 'create_canonical_booking_from_approval') {
        return {
          data: {
            disposition: 'waiting',
            reason: 'requires_concierge',
            requires_concierge: true,
            quote_kind: 'venue',
            approval_id: approval.id,
            event_id: EVENT_ID,
          },
          error: null,
        }
      }
      if (name === 'enqueue_approved_admin_task') {
        return {
          data: { id: 'task-queued', event_id: EVENT_ID, status: 'open' },
          error: null,
        }
      }
      throw new Error(`Unexpected RPC: ${name}`)
    })
    const db = {
      from: jest.fn((table: string) => {
        if (table === 'plans') return singleRowSelect(plan)
        if (table === 'approvals') return listSelect([approval])
        if (table === 'agent_actions') {
          return {
            select: jest.fn(() => listSelect([approvedAction], approvedAction)),
            update,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    }

    const results = await resumeCanonicalQuoteBookingsAfterMaterialization({
      db,
      planId: PLAN_ID,
      actorId: USER_ID,
    })

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'claim_canonical_quote_booking_materialization_resume',
      'create_canonical_booking_from_approval',
      'enqueue_approved_admin_task',
    ])
    expect(results).toEqual([expect.objectContaining({
      disposition: 'executing',
      metadata: expect.objectContaining({
        canonical_booking_status: 'requires_concierge',
        execution_mode: 'concierge_admin_queue',
        handoff_status: 'queued',
        admin_task_id: 'task-queued',
        outbound_message_sent: false,
      }),
    })])
    expect(updatePayloads[0]).toEqual(expect.objectContaining({
      result_metadata: expect.objectContaining({
        admin_task_id: 'task-queued',
        handoff_status: 'queued',
      }),
    }))
  })

  it('returns a pre-existing failed canonical action as recovery evidence without replaying it', async () => {
    const plan = buildPlan({ status: 'executing', materialized_event_id: EVENT_ID })
    const failedAction = buildAction({
      status: 'failed',
      result_metadata: {
        canonical_booking_status: 'failed',
        failure_code: 'partner_handoff_interrupted',
      },
    })
    const actionQuery = listSelect([failedAction], failedAction)
    const rpc = jest.fn()
    const db = {
      from: jest.fn((table: string) => {
        if (table === 'plans') return singleRowSelect(plan)
        if (table === 'approvals') return listSelect([])
        if (table === 'agent_actions') return { select: jest.fn(() => actionQuery), update: jest.fn() }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    }

    await expect(resumeCanonicalQuoteBookingsAfterMaterialization({
      db,
      planId: PLAN_ID,
      actorId: USER_ID,
    })).resolves.toEqual([{
      disposition: 'waiting',
      metadata: expect.objectContaining({
        canonical_booking_status: 'failed',
        action_status: 'failed',
        agent_action_id: failedAction.id,
        failure_code: 'partner_handoff_interrupted',
      }),
    }])

    expect(actionQuery.in).toHaveBeenCalledWith('status', ['approved', 'executing', 'failed'])
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['completed', 'approved'],
    ['archived', 'executing'],
    ['approved', 'approved'],
  ] as const)(
    'returns non-mutating recovery evidence for a %s plan with an %s action',
    async (planStatus, actionStatus) => {
      const plan = buildPlan({ status: planStatus, materialized_event_id: EVENT_ID })
      const action = buildAction({
        status: actionStatus,
        result_metadata: { prior_evidence: 'preserved' },
      })
      const actionQuery = listSelect([action], action)
      const update = jest.fn()
      const rpc = jest.fn()
      const db = {
        from: jest.fn((table: string) => {
          if (table === 'plans') return singleRowSelect(plan)
          if (table === 'agent_actions') return { select: jest.fn(() => actionQuery), update }
          throw new Error(`Unexpected table: ${table}`)
        }),
        rpc,
      }

      await expect(resumeCanonicalQuoteBookingsAfterMaterialization({
        db,
        planId: PLAN_ID,
        actorId: USER_ID,
      })).resolves.toEqual([{
        disposition: 'waiting',
        metadata: expect.objectContaining({
          canonical_booking_status: 'resume_blocked_plan_status',
          resume_blocked: true,
          recovery_required: true,
          resume_blocked_reason: 'plan_status_not_executable',
          plan_status: planStatus,
          action_status: actionStatus,
          agent_action_id: action.id,
          prior_evidence: 'preserved',
        }),
      }])

      expect(actionQuery.in).toHaveBeenCalledWith('status', ['approved', 'executing', 'failed'])
      expect(db.from).not.toHaveBeenCalledWith('approvals')
      expect(update).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalled()
    },
  )

  it('preserves terminal truth won after the approved read but before the atomic claim', async () => {
    const plan = buildPlan({ status: 'executing', materialized_event_id: EVENT_ID })
    const approvedAction = buildAction({ status: 'approved' })
    const cancelledAction = buildAction({
      status: 'cancelled',
      result_metadata: {
        canonical_booking_status: 'cancelled',
        cancellation_reason: 'Host cancelled concurrently',
      },
    })
    const approval = buildApproval()
    const rpc = jest.fn().mockResolvedValue({
      data: {
        existing: true,
        transitioned: false,
        concurrent_execution: true,
        agent_action: cancelledAction,
      },
      error: null,
    })
    const db = {
      from: jest.fn((table: string) => {
        if (table === 'plans') return singleRowSelect(plan)
        if (table === 'approvals') return listSelect([approval])
        if (table === 'agent_actions') {
          return { select: jest.fn(() => listSelect([approvedAction], approvedAction)), update: jest.fn() }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    }

    await expect(resumeCanonicalQuoteBookingsAfterMaterialization({
      db,
      planId: PLAN_ID,
      actorId: USER_ID,
    })).resolves.toEqual([{
      disposition: 'waiting',
      metadata: expect.objectContaining({
        canonical_booking_status: 'cancelled',
        action_status: 'cancelled',
        cancellation_reason: 'Host cancelled concurrently',
      }),
    }])

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(db.from).not.toHaveBeenCalledWith('agent_action_audit_log')
  })

  it('converges through the idempotent booking command when another executor wins the claim race', async () => {
    const plan = buildPlan({ status: 'executing', materialized_event_id: EVENT_ID })
    const approvedAction = buildAction({ status: 'approved' })
    const concurrentAction = buildAction({ status: 'executing', result_metadata: {} })
    const approval = buildApproval()
    const update = jest.fn((payload: Record<string, unknown>) => updateReturningSingle({
      ...concurrentAction,
      result_metadata: payload.result_metadata,
    }))
    const rpc = jest.fn().mockImplementation(async (name: string) => {
      if (name === 'claim_canonical_quote_booking_materialization_resume') {
        return {
          data: {
            existing: true,
            transitioned: false,
            concurrent_execution: true,
            agent_action: concurrentAction,
          },
          error: null,
        }
      }
      return {
        data: {
          disposition: 'executing',
          existing: true,
          booking_kind: 'venue',
          booking_id: 'booking-concurrent',
          booking_status: 'pending',
          event_id: EVENT_ID,
        },
        error: null,
      }
    })
    const db = {
      from: jest.fn((table: string) => {
        if (table === 'plans') return singleRowSelect(plan)
        if (table === 'approvals') return listSelect([approval])
        if (table === 'agent_actions') {
          return { select: jest.fn(() => listSelect([approvedAction], approvedAction)), update }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
      rpc,
    }

    await expect(resumeCanonicalQuoteBookingsAfterMaterialization({
      db,
      planId: PLAN_ID,
      actorId: USER_ID,
    })).resolves.toEqual([expect.objectContaining({
      metadata: expect.objectContaining({ booking_id: 'booking-concurrent' }),
    })])

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'claim_canonical_quote_booking_materialization_resume',
      'create_canonical_booking_from_approval',
    ])
  })

  it.each([
    ['complete', 'confirmed'],
    ['cancelled', 'cancelled'],
    ['failed', 'failed'],
  ] as const)(
    'preserves concurrent %s evidence when resume metadata loses its status CAS',
    async (terminalStatus, canonicalStatus) => {
      const plan = buildPlan({ status: 'executing', materialized_event_id: EVENT_ID })
      const executingAction = buildAction({ status: 'executing' })
      const terminalAction = buildAction({
        status: terminalStatus,
        result_metadata: {
          canonical_booking_status: canonicalStatus,
          terminal_marker: 'must-survive',
        },
      })
      const approval = buildApproval()
      let currentAction = executingAction
      const updateQueries: ReturnType<typeof updateReturningSingle>[] = []
      const update = jest.fn(() => {
        const query = updateReturningSingle(null)
        updateQueries.push(query)
        return query
      })
      const rpc = jest.fn().mockImplementation(async () => {
        currentAction = terminalAction
        return {
          data: {
            disposition: 'executing',
            existing: true,
            booking_kind: 'venue',
            booking_id: 'booking-race',
            booking_status: 'pending',
            event_id: EVENT_ID,
          },
          error: null,
        }
      })
      const db = {
        from: jest.fn((table: string) => {
          if (table === 'plans') return singleRowSelect(plan)
          if (table === 'approvals') return listSelect([approval])
          if (table === 'agent_actions') {
            const select = jest.fn(() => {
              const query = listSelect([executingAction])
              query.maybeSingle.mockImplementation(async () => ({ data: currentAction, error: null }))
              return query
            })
            return { select, update }
          }
          throw new Error(`Unexpected table: ${table}`)
        }),
        rpc,
      }

      const results = await resumeCanonicalQuoteBookingsAfterMaterialization({
        db,
        planId: PLAN_ID,
        actorId: USER_ID,
      })

      expect(update).toHaveBeenCalledTimes(1)
      expect(updateQueries[0].eq).toHaveBeenCalledWith('status', 'executing')
      expect(results).toEqual([expect.objectContaining({
        disposition: terminalStatus === 'complete' ? 'complete' : 'waiting',
        metadata: expect.objectContaining({
          canonical_booking_status: canonicalStatus,
          terminal_marker: 'must-survive',
          action_status: terminalStatus,
        }),
      })])
    },
  )

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

  it('classifies a cancellation deadlock as a retryable conflict', async () => {
    const action = buildAction({ status: 'executing' })
    const approval = buildApproval({ status: 'authorized' })
    const plan = buildPlan({ status: 'executing', materialized_event_id: EVENT_ID })
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { code: '40P01', message: 'deadlock detected' },
    })

    await expect(cancelExecutingCanonicalQuoteBooking({
      db: { from: jest.fn(), rpc },
      action,
      approval,
      plan,
      actorId: USER_ID,
      reason: 'Host changed vendor strategy',
    })).rejects.toThrow(/cancel_retryable_conflict.*40P01/)
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

function listSelect(data: unknown[], singleData: unknown = data[0] ?? null) {
  const query = {
    data,
    error: null,
    select: jest.fn(),
    eq: jest.fn(),
    contains: jest.fn(),
    in: jest.fn(),
    order: jest.fn().mockResolvedValue({ data, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: singleData, error: null }),
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
    expires_at: '2099-07-10T12:00:00.000Z',
    created_at: '2026-07-09T12:00:00.000Z',
    updated_at: '2026-07-09T12:05:00.000Z',
    ...overrides,
  } as Approval
}
