import type { ApprovalStatus } from '@/lib/types'

export type PaymentApprovalErrorCode =
  | 'APPROVAL_MISSING'
  | 'APPROVAL_NOT_EXECUTABLE'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_AMOUNT_MISMATCH'
  | 'APPROVAL_PLAN_MISMATCH'
  | 'APPROVAL_COUNTERPARTY_MISMATCH'
  | 'APPROVAL_STALE_REAPPROVE_REQUIRED'
  | 'UNSAFE_CENTS_VALUE'

export type PaymentApprovalAgentActionRow = {
  id: string
  target_type?: string | null
  target_id?: string | null
  amount_cents?: number | null
  payload_json?: unknown
}

export type PaymentApprovalRow = {
  id: string
  plan_id: string | null
  agent_action_id?: string | null
  status: ApprovalStatus | string
  requested_amount_cents?: number | null
  authorized_amount_cents?: number | null
  price_cents?: number | null
  expires_at?: string | null
  snapshot_hash?: string | null
  provider?: string | null
  agent_action?: PaymentApprovalAgentActionRow | null
  agent_actions?: PaymentApprovalAgentActionRow | PaymentApprovalAgentActionRow[] | null
}

export type PaymentApprovalValidationResult =
  | { ok: true; approvedAmountCents: number }
  | { ok: false; status: 404 | 409 | 422; code: PaymentApprovalErrorCode; error: string }

export const PAYMENT_APPROVAL_SELECT_COLUMNS = `
  id,
  plan_id,
  agent_action_id,
  status,
  requested_amount_cents,
  authorized_amount_cents,
  price_cents,
  expires_at,
  snapshot_hash,
  provider
`

/**
 * Payment/refund execution must be tied to a current approval record. The
 * approval freezes the amount in cents so later price edits force re-approval.
 */
export function validatePaymentApprovalForExecution(input: {
  approval: PaymentApprovalRow | null
  expectedAmountCents: number
  expectedPlanId?: string | null
  expectedCounterparty?: {
    targetType: string
    targetId: string
    payloadKeys?: string[]
  }
  now?: Date
}): PaymentApprovalValidationResult {
  if (!input.approval) {
    return {
      ok: false,
      status: 422,
      code: 'APPROVAL_MISSING',
      error: 'Approval is required before executing this payment action.',
    }
  }

  if (input.expectedPlanId && input.approval.plan_id !== input.expectedPlanId) {
    return {
      ok: false,
      status: 404,
      code: 'APPROVAL_PLAN_MISMATCH',
      error: 'Approval does not belong to this plan.',
    }
  }

  if (input.approval.status !== 'authorized' && input.approval.status !== 'approved') {
    const stale = input.approval.status === 're_approval_required'
    return {
      ok: false,
      status: stale ? 409 : 422,
      code: stale ? 'APPROVAL_STALE_REAPPROVE_REQUIRED' : 'APPROVAL_NOT_EXECUTABLE',
      error: stale
        ? 'Approval is stale. Review the latest terms and approve again.'
        : 'Approval must be current and authorized before executing this payment action.',
    }
  }

  if (isPaymentApprovalExpired(input.approval.expires_at, input.now ?? new Date())) {
    return {
      ok: false,
      status: 409,
      code: 'APPROVAL_EXPIRED',
      error: 'Approval expired. Review the latest terms and approve again.',
    }
  }

  if (!Number.isSafeInteger(input.expectedAmountCents) || input.expectedAmountCents < 0) {
    return {
      ok: false,
      status: 422,
      code: 'UNSAFE_CENTS_VALUE',
      error: 'Payment amount must be an integer number of cents.',
    }
  }

  const approvedAmountCents = getApprovedAmountCents(input.approval)
  if (approvedAmountCents === null) {
    return {
      ok: false,
      status: 422,
      code: 'UNSAFE_CENTS_VALUE',
      error: 'Approval is missing an approved amount in cents.',
    }
  }

  if (approvedAmountCents !== input.expectedAmountCents) {
    return {
      ok: false,
      status: 409,
      code: 'APPROVAL_AMOUNT_MISMATCH',
      error: 'Payment amount changed after approval. Review and approve the updated amount before executing.',
    }
  }

  if (
    input.expectedCounterparty &&
    !approvalMatchesCounterparty(input.approval, input.expectedCounterparty)
  ) {
    return {
      ok: false,
      status: 409,
      code: 'APPROVAL_COUNTERPARTY_MISMATCH',
      error: 'Approval does not match the payment counterparty. Review and approve the correct action.',
    }
  }

  return { ok: true, approvedAmountCents }
}

export function getApprovedAmountCents(approval: PaymentApprovalRow) {
  for (const value of [
    approval.authorized_amount_cents,
    approval.requested_amount_cents,
    approval.price_cents,
  ]) {
    if (Number.isSafeInteger(value) && Number(value) >= 0) return Number(value)
  }
  return null
}

export function isPaymentApprovalExpired(
  expiresAt: string | null | undefined,
  now = new Date()
) {
  if (!expiresAt) return false
  const timestamp = Date.parse(expiresAt)
  return Number.isFinite(timestamp) && timestamp <= now.getTime()
}

function approvalMatchesCounterparty(
  approval: PaymentApprovalRow,
  expected: NonNullable<Parameters<typeof validatePaymentApprovalForExecution>[0]['expectedCounterparty']>
) {
  const action = readAgentAction(approval)
  if (!action) return false

  if (action.target_type === expected.targetType && action.target_id === expected.targetId) {
    return true
  }

  const payload = readRecord(action.payload_json)
  if (!payload) return false

  const keys = expected.payloadKeys ?? [
    'target_id',
    'booking_id',
    'bookingId',
    'transaction_id',
    'transactionId',
    'platform_fee_transaction_id',
    'vendor_transaction_id',
  ]

  return keys.some((key) => payload[key] === expected.targetId)
}

function readAgentAction(approval: PaymentApprovalRow): PaymentApprovalAgentActionRow | null {
  if (approval.agent_action) return approval.agent_action
  if (Array.isArray(approval.agent_actions)) return approval.agent_actions[0] ?? null
  return approval.agent_actions ?? null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
