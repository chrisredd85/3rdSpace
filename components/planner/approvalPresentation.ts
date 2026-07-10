import {
  deriveApprovalUiState,
  type ApprovalUiAction,
  type ApprovalUiState,
  type ApprovalUiStatus,
} from '@/lib/planner/approvalUiState'

export type ApprovalPresentationTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export interface ApprovalPresentation {
  label: string
  description: string
  tone: ApprovalPresentationTone
}

const presentationByStatus = {
  pending: {
    label: 'Pending review',
    description: 'Review or edit this proposal before authorizing it.',
    tone: 'info',
  },
  authorized: {
    label: 'Authorized',
    description: 'The exact snapshot was authorized. Execution has not been confirmed yet.',
    tone: 'success',
  },
  executing: {
    label: 'Executing',
    description: '3rdPlace is executing the authorized snapshot.',
    tone: 'warning',
  },
  succeeded: {
    label: 'Succeeded',
    description: 'The authorized action completed successfully.',
    tone: 'success',
  },
  failed: {
    label: 'Failed',
    description: 'Execution failed. Retry uses the same authorized snapshot and an idempotency key.',
    tone: 'danger',
  },
  expired: {
    label: 'Expired',
    description: 'This proposal expired before authorization and cannot execute.',
    tone: 'warning',
  },
  reapproval_required: {
    label: 'Re-approval required',
    description: 'Material terms changed. Review a fresh version before authorizing.',
    tone: 'warning',
  },
  rejected: {
    label: 'Rejected',
    description: 'This proposal was rejected and will not execute.',
    tone: 'neutral',
  },
  cancelled: {
    label: 'Cancelled',
    description: 'This approval was cancelled. No action will execute from it.',
    tone: 'neutral',
  },
  superseded: {
    label: 'Superseded',
    description: 'A newer approval version replaced this one. It is no longer actionable.',
    tone: 'neutral',
  },
} as const satisfies Record<ApprovalUiStatus, ApprovalPresentation>

const statusValues = Object.keys(presentationByStatus) as ApprovalUiStatus[]
const actionValues: ApprovalUiAction[] = ['edit', 'authorize', 'cancel', 'request_reapproval', 'retry']

export function getApprovalPresentation(status: ApprovalUiStatus): ApprovalPresentation {
  return presentationByStatus[status]
}

/**
 * Normalizes a route/read-model approval into the shared lifecycle, honoring
 * canonical response fields when they are already present.
 */
export function readApprovalUiState(record: Record<string, unknown>, now = new Date()): ApprovalUiState {
  const explicitStatus = readStatus(record.uiStatus ?? record.ui_status)
  const derived = explicitStatus
    ? deriveApprovalUiState({ approvalStatus: explicitStatus, now })
    : deriveApprovalUiState({
        approvalStatus: readString(record.status) ?? 'pending',
        actionStatus: readString(record.actionStatus ?? record.action_status),
        expiresAt: readString(record.expiresAt ?? record.expires_at),
        supersededAt: readString(record.supersededAt ?? record.superseded_at),
        now,
      })
  const serverActions = readActions(record.availableActions ?? record.available_actions)

  if (!explicitStatus && serverActions === null) return derived

  return {
    status: explicitStatus ?? derived.status,
    availableActions: serverActions ?? canonicalActions(explicitStatus ?? derived.status),
    isTerminal: isTerminalStatus(explicitStatus ?? derived.status),
  }
}

export function approvalActionLabel(action: ApprovalUiAction): string {
  if (action === 'authorize') return 'Review authorization'
  if (action === 'request_reapproval') return 'Request re-approval'
  if (action === 'retry') return 'Retry'
  if (action === 'edit') return 'Edit'
  return 'Cancel'
}

function canonicalActions(status: ApprovalUiStatus): ApprovalUiAction[] {
  if (status === 'pending') return ['edit', 'authorize', 'cancel']
  if (status === 'failed') return ['retry']
  if (status === 'expired' || status === 'reapproval_required') return ['request_reapproval']
  return []
}

function isTerminalStatus(status: ApprovalUiStatus): boolean {
  return status === 'succeeded' || status === 'rejected' || status === 'cancelled' || status === 'superseded'
}

function readStatus(value: unknown): ApprovalUiStatus | null {
  if (value === 're_approval_required') return 'reapproval_required'
  return typeof value === 'string' && statusValues.includes(value as ApprovalUiStatus)
    ? value as ApprovalUiStatus
    : null
}

function readActions(value: unknown): ApprovalUiAction[] | null {
  if (!Array.isArray(value)) return null
  const actions = value.filter((action): action is ApprovalUiAction => (
    typeof action === 'string' && actionValues.includes(action as ApprovalUiAction)
  ))
  return actions.length === value.length ? actions : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}
