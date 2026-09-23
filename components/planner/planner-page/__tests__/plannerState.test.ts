import { persistStoredPlannerConversation, publishLivePlan, readStoredPlannerConversation, reconcileApprovalMessages } from '../plannerState'
import { updatePlannerLivePlanPayload } from '../../plannerLivePlanStorage'
import type { Plan, PlanMessage } from '@/lib/types'

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

describe('planner browser photo copy boundary', () => {
  const legacyName = 'places/fixture/photos/old-photo'
  const independentImage = 'https://partner.example/upload.jpg'
  const plan = {
    id: 'plan-photo-copy', title: 'Independent event title', status: 'drafting',
    metadata: { photos: [{ name: legacyName }], independent_image: independentImage },
  } as unknown as Plan
  const messages = [{
    id: 'message-photo', plan_id: plan.id, role: 'agent', content: `Previously supplied ${legacyName}`,
    message_type: 'recommendation', metadata: { recommendation_response: { photos: [{ name: legacyName }] } },
  }] as PlanMessage[]

  beforeEach(() => window.localStorage.clear())

  it('filters new writes to both planner keys without mutating the inputs', () => {
    persistStoredPlannerConversation(plan, messages, true)
    publishLivePlan(plan, messages)
    for (const key of ['planner-active-conversation', 'planner-live-plan']) {
      expect(window.localStorage.getItem(key)).not.toContain(legacyName)
      expect(window.localStorage.getItem(key)).toContain('Independent event title')
    }
    expect(window.localStorage.getItem('planner-active-conversation')).toContain(independentImage)
    expect(JSON.stringify(plan)).toContain(legacyName)
    expect(JSON.stringify(messages)).toContain(legacyName)
  })

  it('does not rewrite a legacy cache just by loading a stored conversation', () => {
    const legacy = JSON.stringify({ plan, messages })
    window.localStorage.setItem('planner-active-conversation', legacy)
    expect(readStoredPlannerConversation()?.plan.id).toBe(plan.id)
    expect(window.localStorage.getItem('planner-active-conversation')).toBe(legacy)
  })

  it('filters existing nested photos during a new partial update and preserves independent images', () => {
    window.localStorage.setItem('planner-live-plan', JSON.stringify({ plan, messages }))
    updatePlannerLivePlanPayload({ title: 'Updated event' })
    const stored = window.localStorage.getItem('planner-live-plan')!
    expect(stored).not.toContain(legacyName)
    expect(stored).toContain(independentImage)
    expect(stored).toContain('Updated event')
    expect(JSON.parse(stored).messages).toHaveLength(1)
  })
})
