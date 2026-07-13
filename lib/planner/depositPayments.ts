import 'server-only'

import { randomUUID } from 'crypto'
import * as Sentry from '@sentry/nextjs'
import type Stripe from 'stripe'
import { assertIntegerCents } from '@/lib/planner/execution/approvalState'
import { recordPlannerPaymentAuthenticationState } from '@/lib/planner/paymentAuthenticationState'
import { getStripeClient } from '@/lib/stripe/connect'
import type { AgentAction, Approval, Json, Plan } from '@/lib/types'

type PlannerDb = {
  from: (table: string) => any
  rpc?: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
}

export interface PlannerPaymentIntentRow {
  id: string
  plan_id: string
  approval_id: string
  partner_kind: 'venue' | 'vendor'
  partner_id: string
  amount_cents: number
  currency: string
  status: 'pending' | 'requested' | 'authorized' | 'capturing' | 'captured' | 'refunded' | 'refund_reconciliation_required' | 'failed' | 'blocked_by_account_state'
  stripe_payment_intent_id: string | null
  stripe_payment_method_id?: string | null
  refunded_amount_cents?: number
  refund_updated_at?: string | null
  last_refund_event_id?: string | null
  account_state_blocked_previous_status?: 'pending' | 'requested' | 'authorized' | null
  account_state_blocked_stripe_account_id?: string | null
  authorized_at: string | null
  captured_at: string | null
  refund_terms: string
  platform_fee_cents: number
  failure_reason: string | null
  capture_attempt_id: string | null
  capture_started_at: string | null
  capture_effects_started_at: string | null
  capture_effects_completed_at: string | null
  created_at: string
  updated_at: string
}

export const PAYMENT_INTENT_SELECT_COLUMNS = `
  id,
  plan_id,
  approval_id,
  partner_kind,
  partner_id,
  amount_cents,
  currency,
  status,
  stripe_payment_intent_id,
  stripe_payment_method_id,
  refunded_amount_cents,
  refund_updated_at,
  last_refund_event_id,
  account_state_blocked_previous_status,
  account_state_blocked_stripe_account_id,
  authorized_at,
  captured_at,
  refund_terms,
  platform_fee_cents,
  failure_reason,
  capture_attempt_id,
  capture_started_at,
  capture_effects_started_at,
  capture_effects_completed_at,
  created_at,
  updated_at
`

const ACTIVE_PAYMENT_INTENT_STATUSES = [
  'pending',
  'requested',
  'authorized',
  'capturing',
  'captured',
  'refunded',
  'refund_reconciliation_required',
  'blocked_by_account_state',
] as const
const DEFAULT_REFUND_TERMS = 'Refundable up to 7 days before the event unless partner terms override.'
export const STALE_PAYMENT_CAPTURE_TIMEOUT_MS = 5 * 60 * 1000
export const CAPTURE_EFFECTS_LEASE_TIMEOUT_MS = 5 * 60 * 1000

type StripePaymentIntentTruth = {
  id: string
  status: string
  amount?: number
  currency?: string
  capture_method?: string
  client_secret?: string | null
  next_action?: Stripe.PaymentIntent['next_action']
  metadata?: Record<string, string>
  last_payment_error?: { message?: string | null } | null
}

export type PlannerDepositCaptureReconciliationOutcome =
  | 'captured'
  | 'failed'
  | 'pending'
  | 'skipped'

export interface PlannerDepositCaptureReconciliationResult {
  paymentIntent: PlannerPaymentIntentRow
  outcome: PlannerDepositCaptureReconciliationOutcome
  stripeStatus: string | null
}

export class PaymentCaptureAlreadyInProgressError extends Error {
  code = 'payment_capture_in_progress'

  constructor(message = 'Payment capture is already in progress. Refresh and try again.') {
    super(message)
    this.name = 'PaymentCaptureAlreadyInProgressError'
  }
}

export class PlannerDepositCaptureFailedError extends Error {
  code = 'payment_capture_failed'

  constructor(public paymentIntent: PlannerPaymentIntentRow, options?: ErrorOptions) {
    super(
      paymentIntent.failure_reason ?? 'Stripe could not capture this payment.',
      options
    )
    this.name = 'PlannerDepositCaptureFailedError'
  }
}

export class PlannerDepositNotFundedError extends Error {
  code = 'payment_capture_not_funded'

  constructor(message = 'A Stripe payment authorization is required before capture.') {
    super(message)
    this.name = 'PlannerDepositNotFundedError'
  }
}

export class PlannerDepositPaymentMethodRequiredError extends Error {
  code = 'payment_method_required'

  constructor(message = 'A payment method is required to authorize this deposit.') {
    super(message)
    this.name = 'PlannerDepositPaymentMethodRequiredError'
  }
}

export class PlannerDepositAuthorizationFailedError extends Error {
  code = 'payment_authorization_failed'

  constructor(message = 'Stripe could not authorize this deposit.') {
    super(message)
    this.name = 'PlannerDepositAuthorizationFailedError'
  }
}

export class PlannerDepositAuthorizationPendingError extends Error {
  code = 'payment_authorization_pending'

  constructor(message = 'Stripe authorization is still uncertain. Retry this same request safely.') {
    super(message)
    this.name = 'PlannerDepositAuthorizationPendingError'
  }
}

export class PlannerDepositCustomerActionRequiredError extends Error {
  code = 'payment_authorization_action_required'

  constructor(
    public paymentIntent: PlannerPaymentIntentRow,
    public stripeStatus: 'requires_action' | 'requires_confirmation',
    public clientSecret: string,
    public nextAction: Stripe.PaymentIntent['next_action']
  ) {
    super('Complete the Stripe authentication step to authorize this deposit.')
    this.name = 'PlannerDepositCustomerActionRequiredError'
  }
}

export class PlannerDepositStripeInvariantError extends Error {
  code = 'payment_stripe_invariant_mismatch'

  constructor(message = 'Stripe PaymentIntent details do not match the approved planner payment.') {
    super(message)
    this.name = 'PlannerDepositStripeInvariantError'
  }
}

export class PlannerDepositReservationConflictError extends Error {
  code = 'payment_authorization_conflict'

  constructor(message: string) {
    super(message)
    this.name = 'PlannerDepositReservationConflictError'
  }
}

export class PlannerDepositAccountBlockedError extends Error {
  code = 'payment_account_blocked'

  constructor(message = 'This payment is blocked while the partner Stripe account is restricted.') {
    super(message)
    this.name = 'PlannerDepositAccountBlockedError'
  }
}

/**
 * Creates or returns a planner deposit payment authorization record.
 *
 * Reserves an approval-backed authorization row before calling Stripe. That
 * makes the database, not Stripe, the first concurrency gate for same-approval
 * authorization races.
 */
export async function authorizePlannerDeposit(input: {
  db: PlannerDb
  plan: Plan
  approval: Approval
  userId: string
  customerId: string
  partnerKind: 'venue' | 'vendor'
  partnerId: string
  amountCents: number
  paymentMethodId: string
  refundTerms?: string | null
  platformFeeCents?: number | null
}) {
  if (input.approval.status !== 'authorized' && input.approval.status !== 'approved') {
    throw new Error('Approval must be authorized before deposit authorization')
  }
  const amountCents = assertIntegerCents(input.amountCents, 'amountCents', 50)
  const paymentMethodId = input.paymentMethodId.trim()
  if (!paymentMethodId) throw new PlannerDepositPaymentMethodRequiredError()
  const customerId = input.customerId.trim()
  if (!customerId) {
    throw new PlannerDepositPaymentMethodRequiredError(
      'The organizer Stripe Customer is required for this payment method.'
    )
  }
  const platformFeeCents = assertIntegerCents(input.platformFeeCents ?? 0, 'platformFeeCents')
  const refundTerms = input.refundTerms ?? DEFAULT_REFUND_TERMS
  const reservationIdentity = {
    amountCents,
    partnerKind: input.partnerKind,
    partnerId: input.partnerId,
    platformFeeCents,
    refundTerms,
    paymentMethodId,
  }
  const existing = await loadExistingActivePaymentIntent(input.db, input.approval.id)

  let reserved: PlannerPaymentIntentRow
  if (existing) {
    if (existing.status === 'blocked_by_account_state') {
      throw new PlannerDepositAccountBlockedError()
    }
    if (existing.status === 'refunded') {
      throw new PlannerDepositReservationConflictError(
        'This payment was fully refunded. Create and approve a new payment action before charging again.'
      )
    }
    if (existing.status === 'refund_reconciliation_required') {
      throw new PlannerDepositReservationConflictError(
        'This payment has a refund awaiting Stripe reconciliation. It cannot be charged again.'
      )
    }
    reserved = assertMatchingPlannerPaymentReservation(existing, reservationIdentity)
    if (!canResumePlannerDepositAuthorization(reserved)) return reserved
  } else {
    reserved = (await reservePlannerPaymentIntent({
      db: input.db,
      plan: input.plan,
      approval: input.approval,
      amountCents,
      partnerKind: input.partnerKind,
      partnerId: input.partnerId,
      refundTerms,
      platformFeeCents,
      paymentMethodId,
    })).row
    if (reserved.status === 'blocked_by_account_state') {
      throw new PlannerDepositAccountBlockedError()
    }
    if (reserved.status === 'refunded') {
      throw new PlannerDepositReservationConflictError(
        'This payment was fully refunded. Create and approve a new payment action before charging again.'
      )
    }
    if (reserved.status === 'refund_reconciliation_required') {
      throw new PlannerDepositReservationConflictError(
        'This payment has a refund awaiting Stripe reconciliation. It cannot be charged again.'
      )
    }
    reserved = assertMatchingPlannerPaymentReservation(reserved, reservationIdentity)
    if (!canResumePlannerDepositAuthorization(reserved)) return reserved
  }

  reserved = {
    ...(await bindLegacyPlannerDepositPaymentMethod(
      input.db,
      reserved,
      reservationIdentity
    )),
  }
  if (!canResumePlannerDepositAuthorization(reserved)) return reserved

  let stripePaymentIntent: StripePaymentIntentTruth
  if (reserved.stripe_payment_intent_id) {
    try {
      stripePaymentIntent = await retrieveStripePaymentIntentTruth(
        reserved.stripe_payment_intent_id
      )
    } catch (error) {
      recordUncertainPlannerDepositAuthorization(reserved, error)
      throw new PlannerDepositAuthorizationPendingError(
        'Stripe authorization could not be refreshed. Retry this same request safely.'
      )
    }
  } else {
    try {
      stripePaymentIntent = await maybeCreateStripeManualPaymentIntent({
        plan: input.plan,
        approval: input.approval,
        plannerPaymentIntentId: reserved.id,
        userId: input.userId,
        customerId,
        partnerKind: reserved.partner_kind,
        partnerId: reserved.partner_id,
        amountCents: reserved.amount_cents,
        paymentMethodId: reserved.stripe_payment_method_id!,
        platformFeeCents: reserved.platform_fee_cents,
      })
    } catch (error) {
      const stripePaymentIntentId = getStripePaymentIntentIdFromError(error)
      if (!stripePaymentIntentId) {
        recordUncertainPlannerDepositAuthorization(reserved, error)
        throw error
      }

      try {
        stripePaymentIntent = await retrieveStripePaymentIntentTruth(stripePaymentIntentId)
      } catch (retrieveError) {
        recordUncertainPlannerDepositAuthorization(reserved, error, retrieveError)
        throw new PlannerDepositAuthorizationPendingError(
          'Stripe created an authorization, but its state could not be refreshed. Retry this same request safely.'
        )
      }
    }
  }

  if (!stripePaymentIntent.id) {
    recordUncertainPlannerDepositAuthorization(reserved, stripePaymentIntent)
    throw new PlannerDepositAuthorizationPendingError()
  }
  if (
    reserved.stripe_payment_intent_id &&
    reserved.stripe_payment_intent_id !== stripePaymentIntent.id
  ) {
    throw new PlannerDepositReservationConflictError(
      'Deposit authorization is bound to a different Stripe PaymentIntent.'
    )
  }
  assertPlannerStripePaymentIntentTruth(reserved, stripePaymentIntent)
  if (isTerminalStripePaymentFailure(stripePaymentIntent.status)) {
    const failureReason = stripePaymentIntent.last_payment_error?.message ??
      `Stripe PaymentIntent is ${stripePaymentIntent.status}`
    await markReservedPaymentIntentFailed(
      input.db,
      reserved.id,
      failureReason,
      stripePaymentIntent.id || null
    )
    throw new PlannerDepositAuthorizationFailedError(failureReason)
  }

  reserved = await persistPlannerStripeAuthorizationState(
    input.db,
    reserved,
    stripePaymentIntent
  )

  if (stripePaymentIntent.status === 'requires_capture') return reserved

  if (
    stripePaymentIntent.status === 'requires_action' ||
    stripePaymentIntent.status === 'requires_confirmation'
  ) {
    if (!stripePaymentIntent.client_secret) {
      recordUncertainPlannerDepositAuthorization(reserved, stripePaymentIntent)
      throw new PlannerDepositAuthorizationPendingError(
        `Stripe PaymentIntent is ${stripePaymentIntent.status}, but no client secret was returned. Retry this same authorization safely.`
      )
    }
    throw new PlannerDepositCustomerActionRequiredError(
      reserved,
      stripePaymentIntent.status,
      stripePaymentIntent.client_secret,
      stripePaymentIntent.next_action ?? null
    )
  }

  recordUncertainPlannerDepositAuthorization(reserved, stripePaymentIntent)
  throw new PlannerDepositAuthorizationPendingError(
    `Stripe PaymentIntent is ${stripePaymentIntent.status}; retry this same authorization safely.`
  )
}

/**
 * Captures an authorized planner deposit after explicit user confirmation.
 */
export async function capturePlannerDeposit(input: {
  db: PlannerDb
  paymentIntent: PlannerPaymentIntentRow
  approval: Approval
  explicitUserConfirmation: boolean
}) {
  if (!input.explicitUserConfirmation) {
    throw new Error('Explicit user confirmation is required before capture')
  }
  if (input.approval.status !== 'authorized' && input.approval.status !== 'approved') {
    throw new Error('Approval must be authorized before capture')
  }
  const paymentIntent = { ...input.paymentIntent }
  if (paymentIntent.status === 'captured') {
    return paymentIntent
  }
  if (paymentIntent.status === 'capturing') {
    if (!isPaymentCaptureStale(paymentIntent)) {
      throw new PaymentCaptureAlreadyInProgressError()
    }

    const reconciled = await reconcilePlannerDepositCapture({
      db: input.db,
      paymentIntent,
    })
    return captureResultOrThrow(reconciled)
  }
  if (paymentIntent.status !== 'authorized' && paymentIntent.status !== 'requested') {
    throw new Error(`Cannot capture a ${paymentIntent.status} deposit`)
  }
  if (!paymentIntent.stripe_payment_intent_id) {
    throw new PlannerDepositNotFundedError()
  }

  const preCaptureTruth = await retrieveStripePaymentIntent(paymentIntent)
  assertPlannerStripePaymentIntentTruth(paymentIntent, preCaptureTruth)
  const capturing = await reservePlannerPaymentIntentCapture(
    input.db,
    paymentIntent,
    input.approval
  )

  if (preCaptureTruth.status !== 'requires_capture') {
    return captureResultOrThrow(
      await applyStripeCaptureTruth(input.db, capturing, preCaptureTruth, false)
    )
  }

  let stripeTruth: StripePaymentIntentTruth
  try {
    stripeTruth = await captureStripePaymentIntent(capturing)
  } catch (error) {
    const recoveredTruth = await retrieveStripePaymentIntentAfterCaptureError(capturing, error)
    const reconciled = await applyStripeCaptureTruth(input.db, capturing, recoveredTruth, true)
    return captureResultOrThrow(reconciled, error)
  }

  return captureResultOrThrow(
    await applyStripeCaptureTruth(input.db, capturing, stripeTruth, false)
  )
}

/**
 * Reconciles one stale capture reservation using Stripe as the source of truth.
 *
 * The updated_at equality is a renewable compare-and-swap lease. A crashed
 * worker makes the row eligible again after the stale timeout, while concurrent
 * workers cannot both retrieve/capture for the same lease version.
 */
export async function reconcilePlannerDepositCapture(input: {
  db: PlannerDb
  paymentIntent: PlannerPaymentIntentRow
}): Promise<PlannerDepositCaptureReconciliationResult> {
  if (input.paymentIntent.status === 'captured') {
    return {
      paymentIntent: input.paymentIntent,
      outcome: 'captured',
      stripeStatus: 'succeeded',
    }
  }
  if (input.paymentIntent.status === 'failed') {
    return {
      paymentIntent: input.paymentIntent,
      outcome: 'failed',
      stripeStatus: null,
    }
  }
  if (input.paymentIntent.status !== 'capturing') {
    return {
      paymentIntent: input.paymentIntent,
      outcome: 'skipped',
      stripeStatus: null,
    }
  }

  const claimed = await claimPlannerDepositCaptureReconciliation(input.db, input.paymentIntent)
  if (!claimed) {
    const current = await loadPlannerPaymentIntentById(input.db, input.paymentIntent.id)
    if (!current) throw new Error('Planner deposit disappeared during capture reconciliation')
    return {
      paymentIntent: current,
      outcome: current.status === 'captured'
        ? 'captured'
        : current.status === 'failed'
          ? 'failed'
          : 'skipped',
      stripeStatus: null,
    }
  }

  Sentry.captureMessage('stale_payment_capture_detected', {
    level: 'warning',
    tags: {
      action: 'stale_payment_capture_detected',
      plan_id: claimed.plan_id,
      payment_intent_id: claimed.id,
      capture_attempt_id: claimed.capture_attempt_id ?? 'missing',
    },
    extra: {
      capture_started_at: claimed.capture_started_at,
      previous_updated_at: input.paymentIntent.updated_at,
      stale_timeout_ms: STALE_PAYMENT_CAPTURE_TIMEOUT_MS,
    },
  })

  if (!claimed.stripe_payment_intent_id) throw new PlannerDepositNotFundedError()

  const stripeTruth = await retrieveStripePaymentIntent(claimed)
  return applyStripeCaptureTruth(input.db, claimed, stripeTruth, true)
}

export function isPaymentCaptureStale(
  paymentIntent: Pick<PlannerPaymentIntentRow, 'status' | 'updated_at'>,
  nowMs = Date.now()
) {
  if (paymentIntent.status !== 'capturing') return false
  const leaseUpdatedAtMs = Date.parse(paymentIntent.updated_at)
  return Number.isFinite(leaseUpdatedAtMs) &&
    nowMs - leaseUpdatedAtMs >= STALE_PAYMENT_CAPTURE_TIMEOUT_MS
}

export async function ensurePlannerDepositPayout(
  db: PlannerDb,
  captured: PlannerPaymentIntentRow
) {
  if (captured.status !== 'captured' && captured.status !== 'refunded') {
    throw new Error(`Cannot create a payout for a ${captured.status} planner deposit`)
  }
  if (!captured.stripe_payment_intent_id) throw new PlannerDepositNotFundedError()
  if (typeof db.rpc !== 'function') {
    throw new Error('Planner payout reconciliation RPC is unavailable')
  }

  const { data, error } = await db.rpc('ensure_planner_deposit_payout', {
    p_payment_intent_id: captured.id,
  })
  if (error) throw new Error(error.message ?? 'Failed to reconcile planner payout')
  return Boolean((data as { created?: boolean } | null)?.created)
}

export async function markPlannerDepositCaptureEffectsCompleted(
  db: PlannerDb,
  paymentIntent: PlannerPaymentIntentRow
) {
  if (
    paymentIntent.status !== 'captured' &&
    paymentIntent.status !== 'refunded' &&
    paymentIntent.status !== 'failed'
  ) {
    throw new Error(`Cannot complete capture effects for a ${paymentIntent.status} planner deposit`)
  }
  if (!paymentIntent.capture_effects_started_at) {
    throw new Error('Capture effects lease is required before completion')
  }

  const { data, error } = await db
    .from('payment_intents')
    .update({
      capture_effects_completed_at: new Date().toISOString(),
      ...(paymentIntent.status !== 'failed' ? { failure_reason: null } : {}),
    })
    .eq('id', paymentIntent.id)
    .eq('status', paymentIntent.status)
    .eq('capture_effects_started_at', paymentIntent.capture_effects_started_at)
    .is('capture_effects_completed_at', null)
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to mark planner deposit capture effects complete')
  if (!data) {
    const current = await loadPlannerPaymentIntentById(db, paymentIntent.id)
    if (current?.capture_effects_completed_at) return current
    throw new PaymentCaptureAlreadyInProgressError('Planner deposit capture effects lease was lost.')
  }
  return data as PlannerPaymentIntentRow
}

export function plannerDepositCaptureIdempotencyKey(
  paymentIntent: Pick<PlannerPaymentIntentRow, 'id' | 'stripe_payment_intent_id' | 'capture_attempt_id'>
) {
  if (!paymentIntent.stripe_payment_intent_id) {
    throw new Error('Stripe PaymentIntent id is required for capture')
  }
  if (!paymentIntent.capture_attempt_id) {
    throw new Error('Capture attempt identity is required for idempotent Stripe capture')
  }
  return `planner_deposit_capture_${paymentIntent.stripe_payment_intent_id}_${paymentIntent.capture_attempt_id}`
}

async function finalizePlannerDepositCaptured(
  db: PlannerDb,
  capturing: PlannerPaymentIntentRow
): Promise<PlannerPaymentIntentRow> {
  const capturedAt = new Date().toISOString()
  const { data, error } = await db
    .from('payment_intents')
    .update({
      status: 'captured',
      captured_at: capturedAt,
      failure_reason: null,
    })
    .eq('id', capturing.id)
    .eq('status', 'capturing')
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to capture planner deposit')
  if (!data) {
    const existing = await loadPlannerPaymentIntentById(db, capturing.id)
    if (existing?.status === 'captured') {
      return existing
    }
    throw new PaymentCaptureAlreadyInProgressError()
  }

  const captured = data as PlannerPaymentIntentRow
  return captured
}

async function reservePlannerPaymentIntentCapture(
  db: PlannerDb,
  paymentIntent: PlannerPaymentIntentRow,
  approval: Approval
): Promise<PlannerPaymentIntentRow> {
  if (typeof db.rpc !== 'function') {
    throw new Error('Planner capture reservation RPC is unavailable')
  }
  const { data, error } = await db.rpc('reserve_planner_deposit_capture', {
    p_payment_intent_id: paymentIntent.id,
    p_plan_id: paymentIntent.plan_id,
    p_approval_id: paymentIntent.approval_id,
    p_expected_snapshot_hash: approval.snapshot_hash ?? null,
    p_expected_amount_cents: paymentIntent.amount_cents,
    p_expected_partner_kind: paymentIntent.partner_kind,
    p_expected_partner_id: paymentIntent.partner_id,
    p_capture_attempt_id: randomUUID(),
  })

  if (error) throw new Error(error.message ?? 'Failed to reserve planner deposit capture')
  const reserved = Array.isArray(data) ? data[0] : data
  if (!reserved) {
    throw new PaymentCaptureAlreadyInProgressError()
  }
  return reserved as PlannerPaymentIntentRow
}

async function claimPlannerDepositCaptureReconciliation(
  db: PlannerDb,
  paymentIntent: PlannerPaymentIntentRow
): Promise<PlannerPaymentIntentRow | null> {
  const { data, error } = await db
    .from('payment_intents')
    .update({
      failure_reason: null,
    })
    .eq('id', paymentIntent.id)
    .eq('status', 'capturing')
    .eq('updated_at', paymentIntent.updated_at)
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to claim stale planner deposit capture')
  return (data as PlannerPaymentIntentRow | null) ?? null
}

async function captureStripePaymentIntent(
  paymentIntent: PlannerPaymentIntentRow
): Promise<StripePaymentIntentTruth> {
  const stripe = getStripeClient()
  return stripe.paymentIntents.capture(
    paymentIntent.stripe_payment_intent_id!,
    {},
    { idempotencyKey: plannerDepositCaptureIdempotencyKey(paymentIntent) }
  ) as Promise<StripePaymentIntentTruth>
}

async function retrieveStripePaymentIntent(
  paymentIntent: PlannerPaymentIntentRow
): Promise<StripePaymentIntentTruth> {
  return retrieveStripePaymentIntentTruth(paymentIntent.stripe_payment_intent_id!)
}

async function retrieveStripePaymentIntentTruth(
  stripePaymentIntentId: string
): Promise<StripePaymentIntentTruth> {
  const stripe = getStripeClient()
  return stripe.paymentIntents.retrieve(
    stripePaymentIntentId
  ) as Promise<StripePaymentIntentTruth>
}

async function retrieveStripePaymentIntentAfterCaptureError(
  paymentIntent: PlannerPaymentIntentRow,
  captureError: unknown
) {
  try {
    return await retrieveStripePaymentIntent(paymentIntent)
  } catch (retrieveError) {
    await recordUncertainPlannerDepositCapture(
      paymentIntent,
      captureError,
      retrieveError
    )
    throw retrieveError
  }
}

async function applyStripeCaptureTruth(
  db: PlannerDb,
  paymentIntent: PlannerPaymentIntentRow,
  stripeTruth: StripePaymentIntentTruth,
  captureWhenRequiresCapture: boolean
): Promise<PlannerDepositCaptureReconciliationResult> {
  assertPlannerStripePaymentIntentTruth(paymentIntent, stripeTruth)
  if (stripeTruth.status === 'succeeded') {
    const captured = await finalizePlannerDepositCaptured(db, paymentIntent)
    return {
      paymentIntent: captured,
      outcome: 'captured',
      stripeStatus: stripeTruth.status,
    }
  }

  if (isTerminalStripePaymentFailure(stripeTruth.status)) {
    const failed = await failPlannerDepositCapture(
      db,
      paymentIntent,
      stripeTruth.last_payment_error?.message ?? `Stripe PaymentIntent is ${stripeTruth.status}`
    )
    return {
      paymentIntent: failed,
      outcome: 'failed',
      stripeStatus: stripeTruth.status,
    }
  }

  if (stripeTruth.status === 'requires_capture' && captureWhenRequiresCapture) {
    try {
      const capturedTruth = await captureStripePaymentIntent(paymentIntent)
      return applyStripeCaptureTruth(db, paymentIntent, capturedTruth, false)
    } catch (captureError) {
      const postErrorTruth = await retrieveStripePaymentIntentAfterCaptureError(
        paymentIntent,
        captureError
      )
      return applyStripeCaptureTruth(db, paymentIntent, postErrorTruth, false)
    }
  }

  const pending = await recordPendingPlannerDepositCapture(
    db,
    paymentIntent,
    `Stripe PaymentIntent is ${stripeTruth.status}; reconciliation will retry after the stale timeout.`
  )
  return {
    paymentIntent: pending,
    outcome: 'pending',
    stripeStatus: stripeTruth.status,
  }
}

async function failPlannerDepositCapture(
  db: PlannerDb,
  paymentIntent: PlannerPaymentIntentRow,
  failureReason: string
) {
  const { data, error } = await db
    .from('payment_intents')
    .update({
      status: 'failed',
      failure_reason: failureReason,
    })
    .eq('id', paymentIntent.id)
    .eq('status', 'capturing')
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to record failed planner deposit capture')
  if (data) return data as PlannerPaymentIntentRow

  const current = await loadPlannerPaymentIntentById(db, paymentIntent.id)
  if (!current) throw new Error('Planner deposit disappeared while recording capture failure')
  return current
}

async function recordPendingPlannerDepositCapture(
  db: PlannerDb,
  paymentIntent: PlannerPaymentIntentRow,
  failureReason: string
) {
  const { data, error } = await db
    .from('payment_intents')
    .update({ failure_reason: failureReason })
    .eq('id', paymentIntent.id)
    .eq('status', 'capturing')
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to preserve pending planner deposit capture')
  if (data) return data as PlannerPaymentIntentRow

  const current = await loadPlannerPaymentIntentById(db, paymentIntent.id)
  if (!current) throw new Error('Planner deposit disappeared while preserving capture state')
  return current
}

async function recordUncertainPlannerDepositCapture(
  paymentIntent: PlannerPaymentIntentRow,
  captureError: unknown,
  retrieveError: unknown
) {
  Sentry.captureException(retrieveError, {
    tags: {
      action: 'payment_capture_stripe_truth_unavailable',
      plan_id: paymentIntent.plan_id,
      payment_intent_id: paymentIntent.id,
      stripe_payment_intent_id: paymentIntent.stripe_payment_intent_id ?? 'missing',
      capture_attempt_id: paymentIntent.capture_attempt_id ?? 'missing',
    },
    extra: {
      capture_error: getErrorMessage(captureError),
      retrieve_error: getErrorMessage(retrieveError),
    },
  })
}

function captureResultOrThrow(
  result: PlannerDepositCaptureReconciliationResult,
  cause?: unknown
) {
  if (result.outcome === 'captured') return result.paymentIntent
  if (result.outcome === 'failed') {
    throw new PlannerDepositCaptureFailedError(
      result.paymentIntent,
      cause === undefined ? undefined : { cause }
    )
  }
  throw new PaymentCaptureAlreadyInProgressError(
    result.outcome === 'pending'
      ? 'Payment capture is still pending at Stripe. Reconciliation will retry safely.'
      : undefined
  )
}

/**
 * Records Stripe webhook state for planner deposit PaymentIntents.
 */
export async function applyPlannerStripePaymentIntentWebhook(db: PlannerDb, stripePaymentIntent: {
  id: string
  status: string
  amount?: number
  currency?: string
  metadata?: Record<string, string>
  last_payment_error?: { message?: string | null } | null
}) {
  if (stripePaymentIntent.metadata?.payment_kind !== 'planner_deposit') return false

  const current = await loadPlannerPaymentIntentForStripeWebhook(
    db,
    stripePaymentIntent
  )
  if (!current) {
    throw new Error('Planner deposit webhook has no matching local payment; retry the event')
  }

  const stripeTruth = isTerminalStripePaymentFailure(stripePaymentIntent.status)
    ? await retrieveStripePaymentIntentTruth(stripePaymentIntent.id)
    : stripePaymentIntent
  assertPlannerStripePaymentIntentTruth(current, stripeTruth)
  const status = stripeTruth.status === 'succeeded'
    ? 'captured'
    : stripeTruth.status === 'requires_capture'
      ? 'authorized'
      : isTerminalStripePaymentFailure(stripeTruth.status)
        ? 'failed'
        : null

  if (!status) return true
  if (current.status === 'refunded' || current.status === 'refund_reconciliation_required') {
    return true
  }
  if (current.status === 'captured') return true
  if (status === 'authorized' && !['pending', 'requested', 'authorized'].includes(current.status)) {
    return true
  }
  if (current.status === status) {
    if (status === 'authorized') {
      await recordWebhookAuthenticationComplete(db, current, stripeTruth.status)
    }
    return true
  }

  const updates: Record<string, unknown> = { status }
  if (status === 'captured') {
    updates.captured_at = current.captured_at ?? new Date().toISOString()
    updates.failure_reason = null
    updates.capture_effects_started_at = null
    updates.capture_effects_completed_at = null
  }
  if (status === 'authorized') {
    updates.authorized_at = current.authorized_at ?? new Date().toISOString()
    updates.failure_reason = null
  }
  if (status === 'failed') {
    updates.failure_reason = stripeTruth.last_payment_error?.message ?? `Stripe PaymentIntent is ${stripeTruth.status}`
    updates.capture_effects_started_at = null
    updates.capture_effects_completed_at = null
  }
  if (!current.stripe_payment_intent_id) {
    updates.stripe_payment_intent_id = stripePaymentIntent.id
  }

  let updateQuery = db
    .from('payment_intents')
    .update(updates)
    .eq('id', current.id)
    .eq('status', current.status)

  updateQuery = current.stripe_payment_intent_id
    ? updateQuery.eq('stripe_payment_intent_id', current.stripe_payment_intent_id)
    : updateQuery.is('stripe_payment_intent_id', null)

  const { data, error } = await updateQuery
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to apply planner deposit Stripe webhook')
  if (!data) {
    const latest = await loadPlannerPaymentIntentById(db, current.id)
    if (
      latest?.stripe_payment_intent_id &&
      latest.stripe_payment_intent_id !== stripePaymentIntent.id
    ) {
      throw new Error('Planner deposit was concurrently bound to a different Stripe PaymentIntent')
    }
    if (latest && isPlannerStripeWebhookOutcomeSatisfied(latest, status)) return true
    throw new Error('Planner deposit changed during Stripe webhook processing; retry the event')
  }

  if (status === 'authorized') {
    await recordWebhookAuthenticationComplete(
      db,
      data as PlannerPaymentIntentRow,
      stripeTruth.status
    )
  }

  return true
}

async function recordWebhookAuthenticationComplete(
  db: PlannerDb,
  paymentIntent: PlannerPaymentIntentRow,
  stripeStatus: string
) {
  const { data: approval, error: approvalError } = await db
    .from('approvals')
    .select('id, agent_action_id')
    .eq('id', paymentIntent.approval_id)
    .eq('plan_id', paymentIntent.plan_id)
    .maybeSingle()
  if (approvalError) throw new Error(approvalError.message ?? 'Failed to load planner payment approval')
  if (!approval?.agent_action_id) {
    Sentry.captureMessage('planner_payment_authentication_action_missing', {
      level: 'error',
      tags: { action: 'planner_payment_authentication_action_missing' },
      extra: {
        payment_intent_id: paymentIntent.id,
        plan_id: paymentIntent.plan_id,
        approval_id: paymentIntent.approval_id,
      },
    })
    return
  }

  const { data: action, error: actionError } = await db
    .from('agent_actions')
    .select('id, plan_id, status, result_metadata')
    .eq('id', approval.agent_action_id)
    .eq('plan_id', paymentIntent.plan_id)
    .maybeSingle()
  if (actionError) throw new Error(actionError.message ?? 'Failed to load planner payment action')
  if (!action) {
    Sentry.captureMessage('planner_payment_authentication_action_missing', {
      level: 'error',
      tags: { action: 'planner_payment_authentication_action_missing' },
      extra: {
        payment_intent_id: paymentIntent.id,
        plan_id: paymentIntent.plan_id,
        approval_id: paymentIntent.approval_id,
        agent_action_id: approval.agent_action_id,
      },
    })
    return
  }

  await recordPlannerPaymentAuthenticationState({
    db,
    action: action as AgentAction,
    actorId: null,
    actorRole: 'stripe_webhook',
    state: 'authenticated',
    paymentIntentId: paymentIntent.id,
    stripeStatus,
    outcome: 'succeeded',
  })
}

function isTerminalStripePaymentFailure(status: string) {
  return status === 'requires_payment_method' ||
    status === 'canceled'
}

async function loadPlannerPaymentIntentForStripeWebhook(
  db: PlannerDb,
  stripePaymentIntent: StripePaymentIntentTruth
): Promise<PlannerPaymentIntentRow | null> {
  const plannerPaymentIntentId = stripePaymentIntent.metadata?.planner_payment_intent_id
  const stripePaymentIntentId = stripePaymentIntent.id
  if (plannerPaymentIntentId) {
    const paymentIntent = await loadPlannerPaymentIntentById(db, plannerPaymentIntentId)
    if (!paymentIntent) return null
    if (
      paymentIntent.stripe_payment_intent_id &&
      paymentIntent.stripe_payment_intent_id !== stripePaymentIntentId
    ) {
      Sentry.captureMessage('planner_payment_webhook_identity_mismatch', {
        level: 'error',
        tags: {
          action: 'planner_payment_webhook_identity_mismatch',
          payment_intent_id: paymentIntent.id,
        },
        extra: {
          expected_stripe_payment_intent_id: paymentIntent.stripe_payment_intent_id,
          received_stripe_payment_intent_id: stripePaymentIntentId,
        },
      })
      throw new Error('Planner deposit Stripe identity mismatch; retry the event after review')
    }
    if (
      !paymentIntent.stripe_payment_intent_id &&
      !['pending', 'requested'].includes(paymentIntent.status)
    ) {
      throw new Error('Planner deposit is not eligible to bind a Stripe webhook identity')
    }
    return paymentIntent
  }

  const { data, error } = await db
    .from('payment_intents')
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .eq('stripe_payment_intent_id', stripePaymentIntentId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load planner deposit for Stripe webhook')
  return (data as PlannerPaymentIntentRow | null) ?? null
}

function assertPlannerStripePaymentIntentTruth(
  paymentIntent: PlannerPaymentIntentRow,
  stripePaymentIntent: StripePaymentIntentTruth
) {
  const metadata = stripePaymentIntent.metadata ?? {}
  const platformFeeText = metadata.platform_fee_cents
  const platformFeeCents = platformFeeText != null && /^\d+$/.test(platformFeeText)
    ? Number(platformFeeText)
    : null
  const matches =
    (!paymentIntent.stripe_payment_intent_id ||
      stripePaymentIntent.id === paymentIntent.stripe_payment_intent_id) &&
    stripePaymentIntent.amount === paymentIntent.amount_cents &&
    stripePaymentIntent.currency?.toLowerCase() === paymentIntent.currency.toLowerCase() &&
    stripePaymentIntent.capture_method === 'manual' &&
    metadata.payment_kind === 'planner_deposit' &&
    metadata.planner_payment_intent_id === paymentIntent.id &&
    metadata.plan_id === paymentIntent.plan_id &&
    metadata.approval_id === paymentIntent.approval_id &&
    metadata.partner_kind === paymentIntent.partner_kind &&
    metadata.partner_id === paymentIntent.partner_id &&
    platformFeeCents !== null &&
    Number.isSafeInteger(platformFeeCents) &&
    platformFeeCents === paymentIntent.platform_fee_cents

  if (!matches) {
    Sentry.captureMessage('planner_payment_stripe_invariant_mismatch', {
      level: 'error',
      tags: {
        action: 'planner_payment_stripe_invariant_mismatch',
        payment_intent_id: paymentIntent.id,
      },
      extra: {
        stripe_payment_intent_id: stripePaymentIntent.id,
        expected_stripe_payment_intent_id: paymentIntent.stripe_payment_intent_id,
        received_capture_method: stripePaymentIntent.capture_method ?? null,
        expected_amount_cents: paymentIntent.amount_cents,
        received_amount_cents: stripePaymentIntent.amount ?? null,
        expected_currency: paymentIntent.currency,
        received_currency: stripePaymentIntent.currency ?? null,
        expected_plan_id: paymentIntent.plan_id,
        received_plan_id: metadata.plan_id ?? null,
        expected_approval_id: paymentIntent.approval_id,
        received_approval_id: metadata.approval_id ?? null,
        expected_partner_kind: paymentIntent.partner_kind,
        received_partner_kind: metadata.partner_kind ?? null,
        expected_partner_id: paymentIntent.partner_id,
        received_partner_id: metadata.partner_id ?? null,
        expected_platform_fee_cents: paymentIntent.platform_fee_cents,
        received_platform_fee_cents: platformFeeText ?? null,
      },
    })
    throw new PlannerDepositStripeInvariantError()
  }
}

function isPlannerStripeWebhookOutcomeSatisfied(
  paymentIntent: PlannerPaymentIntentRow,
  desiredStatus: 'authorized' | 'captured' | 'failed'
) {
  if (
    paymentIntent.status === 'refunded' ||
    paymentIntent.status === 'refund_reconciliation_required'
  ) return true
  if (paymentIntent.status === 'captured') return desiredStatus !== 'authorized'
  return paymentIntent.status === desiredStatus
}

/**
 * Marks a planner deposit as refunded from a Stripe charge webhook.
 */
export async function applyPlannerStripeRefundWebhook(
  db: PlannerDb,
  stripePaymentIntentId: string | null,
  refund: {
    chargeAmountCapturedCents: number
    refundedAmountCents: number
    currency: string
    eventId: string
    fullyRefunded: boolean
  },
  expectPlannerDeposit = false
) {
  if (!stripePaymentIntentId) return false
  if (typeof db.rpc !== 'function') {
    throw new Error('Planner refund reconciliation RPC is unavailable')
  }

  const chargeAmountCapturedCents = assertIntegerCents(
    refund.chargeAmountCapturedCents,
    'chargeAmountCapturedCents'
  )
  const refundedAmountCents = assertIntegerCents(
    refund.refundedAmountCents,
    'refundedAmountCents'
  )
  const { data, error } = await db.rpc('apply_planner_deposit_refund', {
    p_stripe_payment_intent_id: stripePaymentIntentId,
    p_charge_amount_captured_cents: chargeAmountCapturedCents,
    p_refunded_amount_cents: refundedAmountCents,
    p_currency: refund.currency,
    p_event_id: refund.eventId,
    p_charge_refunded: refund.fullyRefunded,
  })

  if (error) throw new Error(error.message ?? 'Failed to apply planner deposit refund webhook')
  const matched = (data as { matched?: boolean } | null)?.matched === true
  if (!matched && expectPlannerDeposit) {
    throw new Error('Planner deposit refund has no matching local payment; retry the event')
  }
  return matched
}

export type PlannerDepositRefundTruthReconciliationOutcome = 'reconciled' | 'skipped'

export interface PlannerDepositRefundTruthReconciliationResult {
  paymentIntent: PlannerPaymentIntentRow
  outcome: PlannerDepositRefundTruthReconciliationOutcome
}

/**
 * Resolves a legacy status-only refund only after retrieving Stripe's exact
 * cumulative charge snapshot. The database trigger deliberately leaves these
 * rows in refund_reconciliation_required, so no payout mutation is attempted
 * before this retrieval succeeds. RPC locking then makes concurrent retries
 * monotonic and idempotent.
 */
export async function reconcilePlannerDepositRefundTruth(input: {
  db: PlannerDb
  paymentIntent: PlannerPaymentIntentRow
}): Promise<PlannerDepositRefundTruthReconciliationResult> {
  if (input.paymentIntent.status !== 'refund_reconciliation_required') {
    return { paymentIntent: input.paymentIntent, outcome: 'skipped' }
  }
  if (!input.paymentIntent.stripe_payment_intent_id) {
    throw new Error('Refund reconciliation requires a Stripe PaymentIntent id')
  }

  const stripe = getStripeClient()
  const stripePaymentIntent = await stripe.paymentIntents.retrieve(
    input.paymentIntent.stripe_payment_intent_id,
    { expand: ['latest_charge'] }
  ) as Stripe.PaymentIntent
  assertPlannerStripePaymentIntentTruth(input.paymentIntent, stripePaymentIntent)
  const latestCharge = stripePaymentIntent.latest_charge
  if (!latestCharge) {
    throw new Error('Refund reconciliation could not find the Stripe charge')
  }

  const charge = typeof latestCharge === 'string'
    ? await stripe.charges.retrieve(latestCharge)
    : latestCharge
  const chargePaymentIntentId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id ?? null

  if (chargePaymentIntentId !== input.paymentIntent.stripe_payment_intent_id) {
    throw new Error('Refund reconciliation Stripe charge identity mismatch')
  }
  if (charge.amount_refunded <= 0) {
    throw new Error('Refund reconciliation found no refunded Stripe amount')
  }

  await applyPlannerStripeRefundWebhook(
    input.db,
    input.paymentIntent.stripe_payment_intent_id,
    {
      chargeAmountCapturedCents: charge.amount_captured,
      refundedAmountCents: charge.amount_refunded,
      currency: charge.currency,
      eventId: `refund_reconcile:${charge.id}:${charge.amount_refunded}`,
      fullyRefunded: charge.refunded,
    },
    true
  )

  const reconciled = await loadPlannerPaymentIntentById(
    input.db,
    input.paymentIntent.id
  )
  if (!reconciled) {
    throw new Error('Planner deposit disappeared during refund reconciliation')
  }
  if (reconciled.status === 'refund_reconciliation_required') {
    throw new Error('Planner deposit refund reconciliation did not resolve unknown truth')
  }

  return { paymentIntent: reconciled, outcome: 'reconciled' }
}

async function loadExistingActivePaymentIntent(db: PlannerDb, approvalId: string) {
  const { data, error } = await db
    .from('payment_intents')
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .eq('approval_id', approvalId)
    .in('status', [...ACTIVE_PAYMENT_INTENT_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as PlannerPaymentIntentRow | null) ?? null
}

export async function loadPlannerPaymentIntentById(db: PlannerDb, paymentIntentId: string) {
  const { data, error } = await db
    .from('payment_intents')
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .eq('id', paymentIntentId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as PlannerPaymentIntentRow | null) ?? null
}

type PlannerPaymentReservationIdentity = {
  amountCents: number
  partnerKind: 'venue' | 'vendor'
  partnerId: string
  platformFeeCents: number
  refundTerms: string
  paymentMethodId: string
}

function assertMatchingPlannerPaymentReservation(
  existing: PlannerPaymentIntentRow,
  expected: PlannerPaymentReservationIdentity
) {
  if (existing.amount_cents !== expected.amountCents) {
    throw new PlannerDepositReservationConflictError(
      `Deposit authorization amount conflicts with the active reservation (existing: $${formatCentsForError(existing.amount_cents)}, requested: $${formatCentsForError(expected.amountCents)}). Refresh and review the approved payment.`
    )
  }
  if (existing.partner_kind !== expected.partnerKind || existing.partner_id !== expected.partnerId) {
    throw new PlannerDepositReservationConflictError(
      'Deposit authorization partner conflicts with the active reservation. Refresh and review the approved payment.'
    )
  }
  if (existing.platform_fee_cents !== expected.platformFeeCents) {
    throw new PlannerDepositReservationConflictError(
      'Deposit authorization fee conflicts with the active reservation. Refresh and review the approved payment.'
    )
  }
  if (existing.refund_terms !== expected.refundTerms) {
    throw new PlannerDepositReservationConflictError(
      'Deposit authorization refund terms conflict with the active reservation. Refresh and review the approved payment.'
    )
  }
  if (
    existing.stripe_payment_method_id &&
    existing.stripe_payment_method_id !== expected.paymentMethodId
  ) {
    throw new PlannerDepositReservationConflictError(
      'Deposit authorization payment method conflicts with the active reservation. Refresh and review the approved payment.'
    )
  }

  return existing
}

function canResumePlannerDepositAuthorization(paymentIntent: PlannerPaymentIntentRow) {
  return paymentIntent.status === 'pending' || paymentIntent.status === 'requested'
}

async function persistPlannerStripeAuthorizationState(
  db: PlannerDb,
  paymentIntent: PlannerPaymentIntentRow,
  stripePaymentIntent: StripePaymentIntentTruth
): Promise<PlannerPaymentIntentRow> {
  if (paymentIntent.status !== 'pending' && paymentIntent.status !== 'requested') {
    throw new Error(`Cannot persist Stripe authorization from ${paymentIntent.status}`)
  }
  const authorized = stripePaymentIntent.status === 'requires_capture'
  const desiredStatus: 'pending' | 'requested' | 'authorized' = authorized
    ? 'authorized'
    : paymentIntent.status
  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {
    status: desiredStatus,
    stripe_payment_intent_id: stripePaymentIntent.id,
    failure_reason: null,
  }
  if (authorized) updates.authorized_at = now

  const attemptPersist = async (current: PlannerPaymentIntentRow) => {
    let query = db
      .from('payment_intents')
      .update(updates)
      .eq('id', current.id)
      .in('status', ['pending', 'requested'])

    query = current.stripe_payment_intent_id
      ? query.eq('stripe_payment_intent_id', stripePaymentIntent.id)
      : query.is('stripe_payment_intent_id', null)

    const { data, error } = await query
      .select(PAYMENT_INTENT_SELECT_COLUMNS)
      .maybeSingle()

    if (error) {
      throw new Error(error.message ?? 'Failed to persist planner Stripe authorization')
    }
    return (data as PlannerPaymentIntentRow | null) ?? null
  }

  let persisted = await attemptPersist(paymentIntent)
  if (persisted) return persisted

  let latest = await loadPlannerPaymentIntentById(db, paymentIntent.id)
  if (!latest) throw new Error('Planner deposit disappeared during Stripe authorization')

  if (latest.status === 'blocked_by_account_state') {
    if (
      latest.stripe_payment_intent_id &&
      latest.stripe_payment_intent_id !== stripePaymentIntent.id
    ) {
      throw new Error('Blocked planner authorization is bound to a different Stripe PaymentIntent')
    }

    const blockedUpdates: Record<string, unknown> = {
      stripe_payment_intent_id: stripePaymentIntent.id,
      account_state_blocked_previous_status: desiredStatus,
    }
    if (authorized) blockedUpdates.authorized_at = now

    let blockedQuery = db
      .from('payment_intents')
      .update(blockedUpdates)
      .eq('id', paymentIntent.id)
      .eq('status', 'blocked_by_account_state')
    blockedQuery = latest.stripe_payment_intent_id
      ? blockedQuery.eq('stripe_payment_intent_id', stripePaymentIntent.id)
      : blockedQuery.is('stripe_payment_intent_id', null)

    const { data: blocked, error: blockedError } = await blockedQuery
      .select(PAYMENT_INTENT_SELECT_COLUMNS)
      .maybeSingle()
    if (blockedError) {
      throw new Error(blockedError.message ?? 'Failed to bind blocked planner authorization')
    }
    latest = (blocked as PlannerPaymentIntentRow | null) ??
      await loadPlannerPaymentIntentById(db, paymentIntent.id)
    if (latest?.stripe_payment_intent_id !== stripePaymentIntent.id) {
      throw new Error('Blocked planner authorization is bound to a different Stripe PaymentIntent')
    }
    throw new PlannerDepositAccountBlockedError()
  }

  if (
    (latest.status === 'pending' || latest.status === 'requested') &&
    latest.stripe_payment_intent_id === stripePaymentIntent.id
  ) {
    persisted = await attemptPersist(latest)
    if (persisted) return persisted
    latest = await loadPlannerPaymentIntentById(db, paymentIntent.id)
    if (!latest) throw new Error('Planner deposit disappeared during Stripe authorization')
  }

  if (
    latest.stripe_payment_intent_id === stripePaymentIntent.id &&
    latest.status === desiredStatus
  ) {
    return latest
  }

  throw new Error('Planner deposit changed during authorization; retry the request')
}

async function bindLegacyPlannerDepositPaymentMethod(
  db: PlannerDb,
  paymentIntent: PlannerPaymentIntentRow,
  expected: PlannerPaymentReservationIdentity
) {
  if (paymentIntent.stripe_payment_method_id) return paymentIntent

  const { data, error } = await db
    .from('payment_intents')
    .update({ stripe_payment_method_id: expected.paymentMethodId })
    .eq('id', paymentIntent.id)
    .in('status', ['pending', 'requested'])
    .is('stripe_payment_intent_id', null)
    .is('stripe_payment_method_id', null)
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to bind planner deposit payment method')
  if (data) return assertMatchingPlannerPaymentReservation(data as PlannerPaymentIntentRow, expected)

  const latest = await loadPlannerPaymentIntentById(db, paymentIntent.id)
  if (!latest) throw new Error('Planner deposit disappeared during payment method binding')
  return assertMatchingPlannerPaymentReservation(latest, expected)
}

async function reservePlannerPaymentIntent(input: {
  db: PlannerDb
  plan: Plan
  approval: Approval
  amountCents: number
  partnerKind: 'venue' | 'vendor'
  partnerId: string
  refundTerms: string
  platformFeeCents: number
  paymentMethodId: string
}): Promise<{ row: PlannerPaymentIntentRow; wonReservation: boolean }> {
  const { data, error } = await input.db
    .from('payment_intents')
    .insert({
      plan_id: input.plan.id,
      approval_id: input.approval.id,
      partner_kind: input.partnerKind,
      partner_id: input.partnerId,
      amount_cents: input.amountCents,
      currency: 'usd',
      status: 'pending',
      stripe_payment_intent_id: null,
      stripe_payment_method_id: input.paymentMethodId,
      authorized_at: null,
      refund_terms: input.refundTerms,
      platform_fee_cents: input.platformFeeCents,
      failure_reason: null,
      capture_attempt_id: null,
      capture_started_at: null,
      capture_effects_started_at: null,
      capture_effects_completed_at: null,
    })
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    if (isUniqueViolation(error)) {
      const winner = await loadExistingActivePaymentIntent(input.db, input.approval.id)
      if (winner) {
        if (winner.status === 'blocked_by_account_state') {
          return { row: winner, wonReservation: false }
        }
        return {
          row: assertMatchingPlannerPaymentReservation(winner, {
            amountCents: input.amountCents,
            partnerKind: input.partnerKind,
            partnerId: input.partnerId,
            platformFeeCents: input.platformFeeCents,
            refundTerms: input.refundTerms,
            paymentMethodId: input.paymentMethodId,
          }),
          wonReservation: false,
        }
      }
    }
    throw new Error(error?.message ?? 'Failed to reserve planner deposit')
  }

  return { row: data as PlannerPaymentIntentRow, wonReservation: true }
}

async function markReservedPaymentIntentFailed(
  db: PlannerDb,
  paymentIntentId: string,
  reason: string,
  stripePaymentIntentId: string | null = null
) {
  const updates = {
    status: 'failed',
    failure_reason: reason,
    stripe_payment_intent_id: stripePaymentIntentId,
  }
  const attemptUpdate = async (bound: boolean) => {
    let query = db
      .from('payment_intents')
      .update(updates)
      .eq('id', paymentIntentId)
      .in('status', ['pending', 'requested'])
    query = bound && stripePaymentIntentId
      ? query.eq('stripe_payment_intent_id', stripePaymentIntentId)
      : query.is('stripe_payment_intent_id', null)
    return query.select(PAYMENT_INTENT_SELECT_COLUMNS).maybeSingle()
  }

  if (stripePaymentIntentId) {
    const boundResult = await attemptUpdate(true)
    if (boundResult.error) {
      throw new Error(
        boundResult.error.message ?? 'Failed to record planner deposit authorization failure'
      )
    }
    if (boundResult.data) return
  }

  const unboundResult = await attemptUpdate(false)
  if (unboundResult.error) {
    throw new Error(
      unboundResult.error.message ?? 'Failed to record planner deposit authorization failure'
    )
  }
}

function formatCentsForError(cents: number) {
  return (cents / 100).toFixed(2)
}

function isUniqueViolation(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const maybeError = error as { code?: string; message?: string; details?: string }
  return (
    maybeError.code === '23505' ||
    /duplicate key|unique constraint/i.test([maybeError.message, maybeError.details].filter(Boolean).join(' '))
  )
}

async function maybeCreateStripeManualPaymentIntent(input: {
  plan: Plan
  approval: Approval
  plannerPaymentIntentId: string
  userId: string
  customerId: string
  partnerKind: 'venue' | 'vendor'
  partnerId: string
  amountCents: number
  paymentMethodId: string
  platformFeeCents: number
}) {
  const stripe = getStripeClient()
  return stripe.paymentIntents.create(
    {
      amount: input.amountCents,
      currency: 'usd',
      capture_method: 'manual',
      confirm: true,
      customer: input.customerId,
      payment_method: input.paymentMethodId,
      payment_method_types: ['card'],
      use_stripe_sdk: true,
      metadata: {
        payment_kind: 'planner_deposit',
        planner_payment_intent_id: input.plannerPaymentIntentId,
        plan_id: input.plan.id,
        approval_id: input.approval.id,
        user_id: input.userId,
        partner_kind: input.partnerKind,
        partner_id: input.partnerId,
        platform_fee_cents: String(input.platformFeeCents),
      },
    },
    {
      idempotencyKey: `planner_deposit_${input.approval.id}_${input.plannerPaymentIntentId}_${input.amountCents}`,
    }
  ) as Promise<StripePaymentIntentTruth>
}

function getStripePaymentIntentIdFromError(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const record = error as Record<string, unknown>
  const raw = record.raw && typeof record.raw === 'object'
    ? record.raw as Record<string, unknown>
    : null
  const candidate = record.payment_intent ?? raw?.payment_intent ?? (
    typeof record.id === 'string' ? record : null
  )
  if (typeof candidate === 'string' && candidate) return candidate
  if (candidate && typeof candidate === 'object') {
    const id = (candidate as Record<string, unknown>).id
    if (typeof id === 'string' && id) return id
  }
  return null
}

function recordUncertainPlannerDepositAuthorization(
  paymentIntent: PlannerPaymentIntentRow,
  authorizationError: unknown,
  retrieveError?: unknown
) {
  Sentry.captureException(retrieveError ?? authorizationError, {
    tags: {
      action: 'payment_authorization_stripe_truth_uncertain',
      plan_id: paymentIntent.plan_id,
      payment_intent_id: paymentIntent.id,
    },
    extra: {
      authorization_error: getErrorMessage(authorizationError),
      retrieve_error: retrieveError === undefined ? null : getErrorMessage(retrieveError),
      stripe_payment_intent_id: getStripePaymentIntentIdFromError(authorizationError),
    },
  })
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Stripe payment authorization failed'
}
