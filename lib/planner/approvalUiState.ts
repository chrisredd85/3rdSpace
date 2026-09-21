import type { AgentActionStatus, ApprovalStatus } from '@/lib/types'

export type ApprovalUiStatus =
  | 'pending'
  | 'authorized'
  | 'executing'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'reapproval_required'
  | 'rejected'
  | 'cancelled'
  | 'superseded'

export type ApprovalUiAction =
  | 'edit'
  | 'authorize'
  | 'cancel'
  | 'cancel_execution'
  | 'request_reapproval'
  | 'retry'

export interface ApprovalUiStateInput {
  approvalStatus: ApprovalStatus | string
  actionStatus?: AgentActionStatus | string | null
  expiresAt?: string | null
  supersededAt?: string | null
  executionCancellable?: boolean
  executionRetryable?: boolean
  now?: Date
}

export interface ApprovalUiState {
  status: ApprovalUiStatus
  availableActions: ApprovalUiAction[]
  isTerminal: boolean
}

const NO_ACTIONS: ApprovalUiAction[] = []

/**
 * Produces the single truthful approval state shared by API and UI surfaces.
 * Expiry outranks a failed action so an old authorization cannot be retried.
 */
export function deriveApprovalUiState(input: ApprovalUiStateInput): ApprovalUiState {
  const approvalStatus = normalizeStatus(input.approvalStatus)
  const actionStatus = normalizeStatus(input.actionStatus)

  if (approvalStatus === 'superseded' || Boolean(input.supersededAt)) {
    return state('superseded', NO_ACTIONS, true)
  }
  if (approvalStatus === 'rejected') return state('rejected', NO_ACTIONS, true)
  if (approvalStatus === 'cancelled') return state('cancelled', NO_ACTIONS, true)
  if (actionStatus === 'cancelled') return state('cancelled', NO_ACTIONS, true)
  if (actionStatus === 'complete') return state('succeeded', NO_ACTIONS, true)
  if (approvalStatus === 're_approval_required') {
    return state('reapproval_required', ['request_reapproval'], false)
  }
  // Expiry prevents a new execution or retry, but it does not erase work that
  // already started under a valid immutable authorization.
  if (actionStatus === 'executing') {
    return state('executing', input.executionCancellable ? ['cancel_execution'] : NO_ACTIONS, false)
  }
  if (approvalStatus === 'expired' || isExpired(input.expiresAt, input.now ?? new Date())) {
    return state('expired', ['request_reapproval'], false)
  }
  if (actionStatus === 'failed' && isExecutableApprovalStatus(approvalStatus)) {
    return state('failed', input.executionRetryable === false ? NO_ACTIONS : ['retry'], false)
  }
  if (isExecutableApprovalStatus(approvalStatus)) {
    return state('authorized', NO_ACTIONS, false)
  }

  return state('pending', ['edit', 'authorize', 'cancel'], false)
}

function normalizeStatus(status: string | null | undefined): string {
  return typeof status === 'string' ? status.trim().toLowerCase() : ''
}

function isExecutableApprovalStatus(status: string): boolean {
  return status === 'approved' || status === 'authorized'
}

function isExpired(expiresAt: string | null | undefined, now: Date): boolean {
  if (!expiresAt) return false
  const timestamp = Date.parse(expiresAt)
  return Number.isFinite(timestamp) && timestamp <= now.getTime()
}

function state(
  status: ApprovalUiStatus,
  availableActions: ApprovalUiAction[],
  isTerminal: boolean,
): ApprovalUiState {
  return { status, availableActions, isTerminal }
}
