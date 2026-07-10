import {
  PlanStatusTransitionError,
  transitionPlanStatus,
  type PlanStatusRpcClient,
} from '@/lib/planner/planStatusTransitions'

describe('transitionPlanStatus', () => {
  it('passes the exact compare-and-swap command and returns the updated plan', async () => {
    const plan = { id: 'plan-1', status: 'ready' }
    const rpc = jest.fn().mockResolvedValue({ data: [plan], error: null })

    await expect(transitionPlanStatus({ rpc } as PlanStatusRpcClient, {
      planId: 'plan-1',
      expectedStatus: 'drafting',
      toStatus: 'ready',
      trigger: 'intake_completed',
      actorId: 'user-1',
      context: { source: 'planner_chat' },
    })).resolves.toEqual(plan)

    expect(rpc).toHaveBeenCalledWith('transition_plan_status', {
      p_plan_id: 'plan-1',
      p_expected_status: 'drafting',
      p_to_status: 'ready',
      p_trigger: 'intake_completed',
      p_actor_id: 'user-1',
      p_context: { source: 'planner_chat' },
    })
  })

  it('accepts a named plan_record response', async () => {
    const plan = { id: 'plan-1', status: 'archived' }
    const rpc = jest.fn().mockResolvedValue({ data: { plan_record: plan }, error: null })

    await expect(transitionPlanStatus({ rpc } as PlanStatusRpcClient, {
      planId: 'plan-1',
      expectedStatus: 'ready',
      toStatus: 'archived',
      trigger: 'plan_archived',
      actorId: 'user-1',
    })).resolves.toEqual(plan)
  })

  it('fails closed when the database rejects or omits the transition result', async () => {
    const rejected = { rpc: jest.fn().mockResolvedValue({ data: null, error: { code: '23514', message: 'invalid transition' } }) }
    await expect(transitionPlanStatus(rejected as PlanStatusRpcClient, {
      planId: 'plan-1',
      expectedStatus: 'ready',
      toStatus: 'approved',
      trigger: 'approval_authorized',
      actorId: 'user-1',
    })).rejects.toEqual(expect.objectContaining<Partial<PlanStatusTransitionError>>({
      code: '23514',
      message: 'invalid transition',
    }))

    const empty = { rpc: jest.fn().mockResolvedValue({ data: null, error: null }) }
    await expect(transitionPlanStatus(empty as PlanStatusRpcClient, {
      planId: 'plan-1',
      expectedStatus: 'ready',
      toStatus: 'archived',
      trigger: 'plan_archived',
      actorId: 'user-1',
    })).rejects.toMatchObject({ code: 'invalid_transition_response' })
  })
})
