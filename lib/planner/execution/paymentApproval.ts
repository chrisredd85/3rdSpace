import type { ApprovalStatus } from '@/lib/types'

export type PaymentApprovalRow = {
  id: string
  plan_id: string | null
  status: ApprovalStatus | string
  requested_amount_cents?: number | null
  authorized_amount_cents?: number | null
  price_cents?: number | null
  expires_at?: string | null
}

export type PaymentApprovalValidationResult =
  | { ok: true; approvedAmountCents: number }
  | { ok: false; status: 404 | 409 | 422; error: string }

export const PAYMENT_APPROVAL_SELECT_COLUMNS = `
  id,
  plan_id,
  status,
  requested_amount_cents,
  authorized_amount_cents,
  price_cents,
  expires_at
`

/**
 * Payment/refund execution must be tied to a current approval record. The
 * approval freezes the amount in cents so later price edits force re-approval.
 */
export function validatePaymentApprovalForExecution(input: {
  approval: PaymentApprovalRow | null
  expectedAmountCents: number
  expectedPlanId?: string | null
  now?: Date
}): PaymentApprovalValidationResult {
  if (!input.approval) {
    return { ok: false, status: 422, error: 'Approval is required before executing this payment action.' }
  }

  if (input.expectedPlanId && input.approval.plan_id !== input.expectedPlanId) {
    return { ok: false, status: 404, error: 'Approval does not belong to this plan.' }
  }

  if (input.approval.status !== 'authorized' && input.approval.status !== 'approved') {
    return {
      ok: false,
      status: input.approval.status === 're_approval_required' ? 409 : 422,
      error: 'Approval must be current and authorized before executing this payment action.',
    }
  }

  if (isExpired(input.approval.expires_at, input.now ?? new Date())) {
    return { ok: false, status: 409, error: 'Approval expired. Review the latest terms and approve again.' }
  }

  if (!Number.isSafeInteger(input.expectedAmountCents) || input.expectedAmountCents < 0) {
    return { ok: false, status: 422, error: 'Payment amount must be an integer number of cents.' }
  }

  const approvedAmountCents = getApprovedAmountCents(input.approval)
  if (approvedAmountCents === null) {
    return { ok: false, status: 422, error: 'Approval is missing an approved amount in cents.' }
  }

  if (approvedAmountCents !== input.expectedAmountCents) {
    return {
      ok: false,
      status: 409,
      error: 'Payment amount changed after approval. Review and approve the updated amount before executing.',
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

function isExpired(expiresAt: string | null | undefined, now: Date) {
  if (!expiresAt) return false
  const timestamp = Date.parse(expiresAt)
  return Number.isFinite(timestamp) && timestamp <= now.getTime()
}
