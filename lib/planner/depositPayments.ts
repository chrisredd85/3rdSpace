import 'server-only'

import * as Sentry from '@sentry/nextjs'
import { assertIntegerCents } from '@/lib/planner/execution/approvalState'
import { getStripeClient } from '@/lib/stripe/connect'
import type { Approval, Json, Plan } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }

export interface PlannerPaymentIntentRow {
  id: string
  plan_id: string
  approval_id: string
  partner_kind: 'venue' | 'vendor'
  partner_id: string
  amount_cents: number
  currency: string
  status: 'pending' | 'requested' | 'authorized' | 'capturing' | 'captured' | 'refunded' | 'failed' | 'blocked_by_account_state'
  stripe_payment_intent_id: string | null
  authorized_at: string | null
  captured_at: string | null
  refund_terms: string
  platform_fee_cents: number
  failure_reason: string | null
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
  authorized_at,
  captured_at,
  refund_terms,
  platform_fee_cents,
  failure_reason,
  created_at,
  updated_at
`

const ACTIVE_PAYMENT_INTENT_STATUSES = ['pending', 'requested', 'authorized', 'capturing', 'captured'] as const

export class PaymentCaptureAlreadyInProgressError extends Error {
  code = 'payment_capture_in_progress'

  constructor(message = 'Payment capture is already in progress. Refresh and try again.') {
    super(message)
    this.name = 'PaymentCaptureAlreadyInProgressError'
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
  partnerKind: 'venue' | 'vendor'
  partnerId: string
  amountCents: number
  paymentMethodId?: string | null
  refundTerms?: string | null
  platformFeeCents?: number | null
}) {
  if (input.approval.status !== 'authorized' && input.approval.status !== 'approved') {
    throw new Error('Approval must be authorized before deposit authorization')
  }
  const amountCents = assertIntegerCents(input.amountCents, 'amountCents', 50)

  const existing = await loadExistingActivePaymentIntent(input.db, input.approval.id)
  if (existing) return returnExistingActivePaymentIntentOrThrow(existing, amountCents)

  const platformFeeCents = assertIntegerCents(input.platformFeeCents ?? 0, 'platformFeeCents')

  const reservation = await reservePlannerPaymentIntent({
    db: input.db,
    plan: input.plan,
    approval: input.approval,
    amountCents,
    partnerKind: input.partnerKind,
    partnerId: input.partnerId,
    refundTerms: input.refundTerms ?? null,
    platformFeeCents,
  })
  if (!reservation.wonReservation) return reservation.row

  const reserved = reservation.row

  let stripePaymentIntent: { id: string | null; status: string }
  try {
    stripePaymentIntent = await maybeCreateStripeManualPaymentIntent({
      plan: input.plan,
      approval: input.approval,
      plannerPaymentIntentId: reserved.id,
      userId: input.userId,
      partnerKind: input.partnerKind,
      partnerId: input.partnerId,
      amountCents,
      paymentMethodId: input.paymentMethodId ?? null,
      platformFeeCents,
    })
  } catch (error) {
    await markReservedPaymentIntentFailed(input.db, reserved.id, getErrorMessage(error))
    throw error
  }

  const now = new Date().toISOString()
  const status = stripePaymentIntent.status === 'requires_capture' ? 'authorized' : 'requested'
  const { data, error } = await input.db
    .from('payment_intents')
    .update({
      status,
      stripe_payment_intent_id: stripePaymentIntent.id,
      authorized_at: status === 'authorized' ? now : null,
      failure_reason: null,
    })
    .eq('id', reserved.id)
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to create planner deposit')
  return data as PlannerPaymentIntentRow
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
  if (input.paymentIntent.status === 'capturing') {
    throw new PaymentCaptureAlreadyInProgressError()
  }
  if (input.paymentIntent.status !== 'authorized' && input.paymentIntent.status !== 'requested') {
    throw new Error(`Cannot capture a ${input.paymentIntent.status} deposit`)
  }

  const capturing = await reservePlannerPaymentIntentCapture(input.db, input.paymentIntent)

  try {
    if (capturing.stripe_payment_intent_id) {
      const stripe = getStripeClient()
      await stripe.paymentIntents.capture(capturing.stripe_payment_intent_id)
    }
  } catch (error) {
    await releasePlannerPaymentIntentCapture(input.db, capturing.id, input.paymentIntent.status, getErrorMessage(error))
    throw error
  }

  const capturedAt = new Date().toISOString()
  const { data, error } = await input.db
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
    const existing = await loadPaymentIntentById(input.db, capturing.id)
    if (existing?.status === 'captured') return existing
    throw new PaymentCaptureAlreadyInProgressError()
  }

  const captured = data as PlannerPaymentIntentRow
  const payoutAmountCents = Math.max(0, captured.amount_cents - captured.platform_fee_cents)
  const { error: payoutError } = await input.db.from('payouts').insert({
    payment_intent_id: captured.id,
    partner_kind: captured.partner_kind,
    partner_id: captured.partner_id,
    amount_cents: payoutAmountCents,
    currency: captured.currency,
    status: 'pending',
  })

  if (isUniqueViolation(payoutError)) {
    Sentry.captureMessage('capture_payout_already_exists', {
      level: 'info',
      tags: {
        action: 'capture_payout_already_exists',
        payment_intent_id: captured.id,
        partner_kind: captured.partner_kind,
      },
      extra: {
        payout_amount_cents: payoutAmountCents,
      },
    })
  } else if (payoutError) {
    throw new Error(payoutError.message ?? 'Failed to create planner payout')
  }

  return captured
}

async function reservePlannerPaymentIntentCapture(
  db: PlannerDb,
  paymentIntent: PlannerPaymentIntentRow
): Promise<PlannerPaymentIntentRow> {
  const { data, error } = await db
    .from('payment_intents')
    .update({
      status: 'capturing',
      failure_reason: null,
    })
    .eq('id', paymentIntent.id)
    .eq('status', paymentIntent.status)
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to reserve planner deposit capture')
  if (!data) throw new PaymentCaptureAlreadyInProgressError()
  return data as PlannerPaymentIntentRow
}

async function releasePlannerPaymentIntentCapture(
  db: PlannerDb,
  paymentIntentId: string,
  previousStatus: PlannerPaymentIntentRow['status'],
  failureReason: string
) {
  const { error } = await db
    .from('payment_intents')
    .update({
      status: previousStatus,
      failure_reason: failureReason,
    })
    .eq('id', paymentIntentId)
    .eq('status', 'capturing')

  if (error) {
    Sentry.captureException(new Error(error.message ?? 'Failed to release planner deposit capture reservation'), {
      tags: {
        action: 'payment_capture_reservation_release_failed',
        payment_intent_id: paymentIntentId,
      },
      extra: {
        previous_status: previousStatus,
        failure_reason: failureReason,
      },
    })
  }
}

/**
 * Records Stripe webhook state for planner deposit PaymentIntents.
 */
export async function applyPlannerStripePaymentIntentWebhook(db: PlannerDb, stripePaymentIntent: {
  id: string
  status: string
  metadata?: Record<string, string>
  last_payment_error?: { message?: string | null } | null
}) {
  if (stripePaymentIntent.metadata?.payment_kind !== 'planner_deposit') return false

  const plannerPaymentIntentId = stripePaymentIntent.metadata.planner_payment_intent_id
  const status = stripePaymentIntent.status === 'succeeded'
    ? 'captured'
    : stripePaymentIntent.status === 'requires_capture'
      ? 'authorized'
      : stripePaymentIntent.status === 'requires_payment_method' || stripePaymentIntent.status === 'canceled'
        ? 'failed'
        : null

  if (!status) return true

  const updates: Record<string, unknown> = { status }
  if (status === 'captured') updates.captured_at = new Date().toISOString()
  if (status === 'authorized') updates.authorized_at = new Date().toISOString()

  const query = db.from('payment_intents').update(updates)
  if (plannerPaymentIntentId) {
    await query.eq('id', plannerPaymentIntentId)
  } else {
    await query.eq('stripe_payment_intent_id', stripePaymentIntent.id)
  }

  return true
}

/**
 * Marks a planner deposit as refunded from a Stripe charge webhook.
 */
export async function applyPlannerStripeRefundWebhook(db: PlannerDb, stripePaymentIntentId: string | null) {
  if (!stripePaymentIntentId) return false

  await db
    .from('payment_intents')
    .update({ status: 'refunded' })
    .eq('stripe_payment_intent_id', stripePaymentIntentId)

  return true
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

async function loadPaymentIntentById(db: PlannerDb, paymentIntentId: string) {
  const { data, error } = await db
    .from('payment_intents')
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .eq('id', paymentIntentId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as PlannerPaymentIntentRow | null) ?? null
}

function returnExistingActivePaymentIntentOrThrow(
  existing: PlannerPaymentIntentRow,
  requestedAmountCents: number
) {
  if (
    existing.amount_cents !== requestedAmountCents &&
    wasCreatedWithinLastSeconds(existing.created_at, 60)
  ) {
    throw new Error(
      `Concurrent deposit authorization attempted with different amount (existing: $${formatCentsForError(existing.amount_cents)}, requested: $${formatCentsForError(requestedAmountCents)}). Refresh and try again.`
    )
  }

  return existing
}

async function reservePlannerPaymentIntent(input: {
  db: PlannerDb
  plan: Plan
  approval: Approval
  amountCents: number
  partnerKind: 'venue' | 'vendor'
  partnerId: string
  refundTerms: string | null
  platformFeeCents: number
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
      authorized_at: null,
      refund_terms: input.refundTerms ?? 'Refundable up to 7 days before the event unless partner terms override.',
      platform_fee_cents: input.platformFeeCents,
      failure_reason: null,
    })
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    if (isUniqueViolation(error)) {
      const winner = await loadExistingActivePaymentIntent(input.db, input.approval.id)
      if (winner) {
        return {
          row: returnExistingActivePaymentIntentOrThrow(winner, input.amountCents),
          wonReservation: false,
        }
      }
    }
    throw new Error(error?.message ?? 'Failed to reserve planner deposit')
  }

  return { row: data as PlannerPaymentIntentRow, wonReservation: true }
}

async function markReservedPaymentIntentFailed(db: PlannerDb, paymentIntentId: string, reason: string) {
  await db
    .from('payment_intents')
    .update({
      status: 'failed',
      failure_reason: reason,
    })
    .eq('id', paymentIntentId)
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .single()
}

function formatCentsForError(cents: number) {
  return (cents / 100).toFixed(2)
}

function wasCreatedWithinLastSeconds(value: string, seconds: number) {
  const createdAtMs = Date.parse(value)
  if (!Number.isFinite(createdAtMs)) return false
  return Date.now() - createdAtMs <= seconds * 1000
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
  partnerKind: 'venue' | 'vendor'
  partnerId: string
  amountCents: number
  paymentMethodId: string | null
  platformFeeCents: number
}) {
  if (!input.paymentMethodId) {
    return { id: null, status: 'requires_payment_method' }
  }

  const stripe = getStripeClient()
  return stripe.paymentIntents.create(
    {
      amount: input.amountCents,
      currency: 'usd',
      capture_method: 'manual',
      confirm: true,
      payment_method: input.paymentMethodId,
      automatic_payment_methods: { enabled: true },
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
      idempotencyKey: `planner_deposit_${input.approval.id}_${input.amountCents}`,
    }
  )
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Stripe payment authorization failed'
}
