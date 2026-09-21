import { reconcileApprovalMessages } from '../plannerState'
import type { PlanMessage } from '@/lib/types'

describe('planner approval reload reconciliation', () => {
  it('restores enriched action status and result evidence onto message-backed cards', () => {
    const approvalId = '11111111-1111-4111-8111-111111111111'
    const messages: PlanMessage[] = [{
      id: 'message-1',
      plan_id: 'plan-1',
      role: 'agent',
      content: 'Review external checkout.',
      message_type: 'approval_request',
      metadata: {
        status: 'pending',
        approval: {
          id: approvalId,
          status: 'pending',
        },
      },
      created_at: '2026-07-09T20:00:00.000Z',
    }]
    const actionResult = {
      external_checkout: {
        status: 'ready',
        external_url: 'https://tickets.example/checkout',
      },
    }

    const reconciled = reconcileApprovalMessages(messages, [{
      id: approvalId,
      status: 'authorized',
      ui_status: 'executing',
      action_status: 'executing',
      action_result: actionResult,
      available_actions: [],
      snapshot_json: { schema_version: 2 },
    } as any])

    expect(reconciled[0].metadata).toEqual(expect.objectContaining({
      status: 'authorized',
      ui_status: 'executing',
      action_status: 'executing',
      action_result: actionResult,
      available_actions: [],
      confirmation_snapshot: { schema_version: 2 },
      approval: expect.objectContaining({
        id: approvalId,
        status: 'authorized',
        action_status: 'executing',
        action_result: actionResult,
      }),
    }))
  })

  it('preserves the original message array when no approval ids match', () => {
    const messages = [{
      id: 'message-1',
      plan_id: 'plan-1',
      role: 'agent',
      content: 'No approval here.',
      message_type: 'status_update',
      metadata: {},
      created_at: '2026-07-09T20:00:00.000Z',
    }] as PlanMessage[]

    expect(reconcileApprovalMessages(messages, [])).toBe(messages)
  })
})
