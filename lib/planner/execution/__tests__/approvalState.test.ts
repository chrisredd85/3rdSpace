import {
  assertIntegerCents,
  transitionAgentActionStatus,
  transitionApprovalStatus,
} from '../approvalState'

describe('approval execution state machine', () => {
  it('authorizes pending approvals and moves approved actions through execution', () => {
    expect(transitionApprovalStatus('pending', 'authorize')).toEqual({
      ok: true,
      from: 'pending',
      to: 'authorized',
      changed: true,
    })

    expect(transitionAgentActionStatus('pending', 'approval_granted')).toEqual({
      ok: true,
      from: 'pending',
      to: 'approved',
      changed: true,
    })
    expect(transitionAgentActionStatus('approved', 'execution_started')).toEqual({
      ok: true,
      from: 'approved',
      to: 'executing',
      changed: true,
    })
    expect(transitionAgentActionStatus('executing', 'execution_completed')).toEqual({
      ok: true,
      from: 'executing',
      to: 'complete',
      changed: true,
    })
  })

  it('does not allow rejected or cancelled actions to execute', () => {
    expect(transitionAgentActionStatus('cancelled', 'execution_started')).toEqual({
      ok: false,
      from: 'cancelled',
      event: 'execution_started',
      reason: 'Cannot transition a terminal cancelled action',
    })
    expect(transitionAgentActionStatus('failed', 'execution_started')).toEqual({
      ok: false,
      from: 'failed',
      event: 'execution_started',
      reason: 'Cannot transition a terminal failed action',
    })
  })

  it('rejects unsafe cents values', () => {
    expect(assertIntegerCents(9500, 'amountCents', 50)).toBe(9500)
    expect(() => assertIntegerCents(12.34, 'amountCents')).toThrow(/safe integer/)
    expect(() => assertIntegerCents(Number.MAX_SAFE_INTEGER + 1, 'amountCents')).toThrow(/safe integer/)
    expect(() => assertIntegerCents(49, 'amountCents', 50)).toThrow(/at least 50/)
  })
})
