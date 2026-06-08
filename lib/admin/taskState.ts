import type { AdminTaskPriority, AdminTaskStatus, AdminTaskType } from '@/lib/types/planner'

export type AdminTaskStatusTransitionEvent = 'start' | 'complete' | 'cancel'
export type AdminTaskMutationAction = AdminTaskStatusTransitionEvent | 'assign' | 'append_note'

export const ADMIN_TASK_STATUSES = ['pending', 'open', 'in_progress', 'complete', 'cancelled'] as const satisfies readonly AdminTaskStatus[]
export const ADMIN_TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const satisfies readonly AdminTaskPriority[]
export const ADMIN_TASK_TYPES = [
  'concierge_booking',
  'receipt_upload',
  'vendor_confirm',
  'coi_collect',
  'catalog_gap',
] as const satisfies readonly AdminTaskType[]

export type AdminTaskStatusTransitionResult =
  | {
      ok: true
      fromStatus: AdminTaskStatus
      toStatus: AdminTaskStatus
    }
  | {
      ok: false
      fromStatus: AdminTaskStatus
      reason: string
    }

const TERMINAL_ADMIN_TASK_STATUSES = new Set<AdminTaskStatus>(['complete', 'cancelled'])

export function isTerminalAdminTaskStatus(status: AdminTaskStatus) {
  return TERMINAL_ADMIN_TASK_STATUSES.has(status)
}

export function transitionAdminTaskStatus(
  currentStatus: AdminTaskStatus,
  event: AdminTaskStatusTransitionEvent
): AdminTaskStatusTransitionResult {
  // Concierge/Admin Queue work is a human handoff. Once terminal, a task cannot
  // be restarted by an incidental UI action; a new task should document new scope.
  if (isTerminalAdminTaskStatus(currentStatus)) {
    return {
      ok: false,
      fromStatus: currentStatus,
      reason: `Cannot ${event} a ${currentStatus} admin task.`,
    }
  }

  if (event === 'start') {
    if (currentStatus === 'pending' || currentStatus === 'open') {
      return { ok: true, fromStatus: currentStatus, toStatus: 'in_progress' }
    }

    return {
      ok: false,
      fromStatus: currentStatus,
      reason: `Cannot start a ${currentStatus} admin task.`,
    }
  }

  if (event === 'complete') {
    if (currentStatus === 'open' || currentStatus === 'in_progress') {
      return { ok: true, fromStatus: currentStatus, toStatus: 'complete' }
    }

    return {
      ok: false,
      fromStatus: currentStatus,
      reason: `Cannot complete a ${currentStatus} admin task.`,
    }
  }

  return { ok: true, fromStatus: currentStatus, toStatus: 'cancelled' }
}

export function canMutateAdminTaskStatus(status: AdminTaskStatus, action: AdminTaskMutationAction) {
  if (action === 'append_note') return { ok: true as const }

  if (action === 'assign') {
    return isTerminalAdminTaskStatus(status)
      ? { ok: false as const, reason: `Cannot assign a ${status} admin task.` }
      : { ok: true as const }
  }

  const transition = transitionAdminTaskStatus(status, action)
  return transition.ok ? { ok: true as const } : { ok: false as const, reason: transition.reason }
}
