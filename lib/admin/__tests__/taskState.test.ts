import {
  canMutateAdminTaskStatus,
  isTerminalAdminTaskStatus,
  transitionAdminTaskStatus,
} from '@/lib/admin/taskState'

describe('admin task state helpers', () => {
  it('starts pending and open tasks', () => {
    expect(transitionAdminTaskStatus('pending', 'start')).toEqual({
      ok: true,
      fromStatus: 'pending',
      toStatus: 'in_progress',
    })
    expect(transitionAdminTaskStatus('open', 'start')).toEqual({
      ok: true,
      fromStatus: 'open',
      toStatus: 'in_progress',
    })
  })

  it('completes only open or in-progress tasks', () => {
    expect(transitionAdminTaskStatus('open', 'complete')).toEqual({
      ok: true,
      fromStatus: 'open',
      toStatus: 'complete',
    })
    expect(transitionAdminTaskStatus('in_progress', 'complete')).toEqual({
      ok: true,
      fromStatus: 'in_progress',
      toStatus: 'complete',
    })
    expect(transitionAdminTaskStatus('pending', 'complete')).toEqual({
      ok: false,
      fromStatus: 'pending',
      reason: 'Cannot complete a pending admin task.',
    })
  })

  it('blocks status changes and assignment for terminal tasks', () => {
    expect(isTerminalAdminTaskStatus('complete')).toBe(true)
    expect(isTerminalAdminTaskStatus('cancelled')).toBe(true)
    expect(transitionAdminTaskStatus('complete', 'start')).toEqual({
      ok: false,
      fromStatus: 'complete',
      reason: 'Cannot start a complete admin task.',
    })
    expect(canMutateAdminTaskStatus('cancelled', 'assign')).toEqual({
      ok: false,
      reason: 'Cannot assign a cancelled admin task.',
    })
  })

  it('allows notes on terminal tasks for audit follow-up', () => {
    expect(canMutateAdminTaskStatus('complete', 'append_note')).toEqual({ ok: true })
    expect(canMutateAdminTaskStatus('cancelled', 'append_note')).toEqual({ ok: true })
  })
})
