import type { AgentActionStatus, ApprovalStatus } from '@/lib/types'

export type ApprovalDecision = 'authorize' | 'approve' | 'reject' | 'cancel'

export type AgentActionTransitionEvent =
  | 'approval_granted'
  | 'execution_started'
  | 'execution_completed'
  | 'execution_failed'
  | 'cancelled'

export interface StateTransitionResult<Status extends string> {
  ok: true
  from: Status
  to: Status
  changed: boolean
}

export interface StateTransitionError<Status extends string, EventName extends string> {
  ok: false
  from: Status
  event: EventName
  reason: string
}

export type ApprovalTransitionResult =
  | StateTransitionResult<ApprovalStatus>
  | StateTransitionError<ApprovalStatus, ApprovalDecision>

export type AgentActionTransitionResult =
  | StateTransitionResult<AgentActionStatus>
  | StateTransitionError<AgentActionStatus, AgentActionTransitionEvent>

export const APPROVAL_EXECUTION_STATUSES = ['authorized', 'approved'] as const satisfies readonly ApprovalStatus[]
export const APPROVAL_REJECTION_STATUSES = ['rejected', 'cancelled'] as const satisfies readonly ApprovalStatus[]
export const TERMINAL_ACTION_STATUSES = ['complete', 'cancelled', 'failed'] as const satisfies readonly AgentActionStatus[]

export function isApprovalExecutable(status: ApprovalStatus): boolean {
  return status === 'authorized' || status === 'approved'
}

export function isApprovalRejectedOrCancelled(status: ApprovalStatus): boolean {
  return status === 'rejected' || status === 'cancelled'
}

export function transitionApprovalStatus(
  currentStatus: ApprovalStatus,
  decision: ApprovalDecision
): ApprovalTransitionResult {
  if (decision === 'authorize') {
    return transitionApproval(currentStatus, decision, 'authorized')
  }

  if (decision === 'approve') {
    return transitionApproval(currentStatus, decision, 'approved')
  }

  if (decision === 'reject') {
    return transitionApproval(currentStatus, decision, 'rejected')
  }

  return transitionApproval(currentStatus, decision, 'cancelled')
}

export function transitionAgentActionStatus(
  currentStatus: AgentActionStatus,
  event: AgentActionTransitionEvent
): AgentActionTransitionResult {
  const nextStatus = nextAgentActionStatus(event)

  if (currentStatus === nextStatus) {
    return { ok: true, from: currentStatus, to: nextStatus, changed: false }
  }

  if (isTerminalActionStatus(currentStatus)) {
    return {
      ok: false,
      from: currentStatus,
      event,
      reason: `Cannot transition a terminal ${currentStatus} action`,
    }
  }

  if (event === 'approval_granted' && !['pending', 'proposed'].includes(currentStatus)) {
    return invalidActionTransition(currentStatus, event, 'Only pending or proposed actions can be approved')
  }

  if (event === 'execution_started' && currentStatus !== 'approved') {
    return invalidActionTransition(currentStatus, event, 'Execution can only start from approved')
  }

  if (event === 'execution_completed' && currentStatus !== 'executing') {
    return invalidActionTransition(currentStatus, event, 'Execution can only complete from executing')
  }

  if (event === 'execution_failed' && !['approved', 'executing'].includes(currentStatus)) {
    return invalidActionTransition(currentStatus, event, 'Only approved or executing actions can fail')
  }

  if (event === 'cancelled' && !['pending', 'proposed', 'approved', 'executing'].includes(currentStatus)) {
    return invalidActionTransition(currentStatus, event, 'Only active actions can be cancelled')
  }

  return { ok: true, from: currentStatus, to: nextStatus, changed: true }
}

export function agentActionStatusForApprovalStatus(
  approvalStatus: ApprovalStatus,
  currentActionStatus: AgentActionStatus
): AgentActionTransitionResult | null {
  if (isApprovalExecutable(approvalStatus)) {
    return transitionAgentActionStatus(currentActionStatus, 'approval_granted')
  }

  if (isApprovalRejectedOrCancelled(approvalStatus)) {
    return transitionAgentActionStatus(currentActionStatus, 'cancelled')
  }

  return null
}

export function assertIntegerCents(value: number, fieldName: string, minValue = 0): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${fieldName} must be a safe integer number of cents`)
  }

  if (value < minValue) {
    throw new Error(`${fieldName} must be at least ${minValue} cents`)
  }

  return value
}

export function readIntegerCents(value: unknown, fieldName: string, minValue = 0): number | null {
  if (value == null) return null
  if (typeof value !== 'number') {
    throw new Error(`${fieldName} must be a number of cents`)
  }

  return assertIntegerCents(value, fieldName, minValue)
}

function transitionApproval(
  currentStatus: ApprovalStatus,
  decision: ApprovalDecision,
  nextStatus: ApprovalStatus
): ApprovalTransitionResult {
  if (currentStatus === nextStatus) {
    return { ok: true, from: currentStatus, to: nextStatus, changed: false }
  }

  if (currentStatus !== 'pending') {
    return {
      ok: false,
      from: currentStatus,
      event: decision,
      reason: `Cannot ${decision} a ${currentStatus} approval`,
    }
  }

  return { ok: true, from: currentStatus, to: nextStatus, changed: true }
}

function nextAgentActionStatus(event: AgentActionTransitionEvent): AgentActionStatus {
  if (event === 'approval_granted') return 'approved'
  if (event === 'execution_started') return 'executing'
  if (event === 'execution_completed') return 'complete'
  if (event === 'execution_failed') return 'failed'
  return 'cancelled'
}

function isTerminalActionStatus(status: AgentActionStatus): boolean {
  return TERMINAL_ACTION_STATUSES.some((terminalStatus) => terminalStatus === status)
}

function invalidActionTransition(
  currentStatus: AgentActionStatus,
  event: AgentActionTransitionEvent,
  reason: string
): AgentActionTransitionResult {
  return { ok: false, from: currentStatus, event, reason }
}
