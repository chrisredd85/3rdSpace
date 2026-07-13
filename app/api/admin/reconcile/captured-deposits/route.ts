export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import {
  PAYMENT_INTENT_SELECT_COLUMNS,
  reconcilePlannerDepositCapture,
  reconcilePlannerDepositRefundTruth,
  STALE_PAYMENT_CAPTURE_TIMEOUT_MS,
  type PlannerPaymentIntentRow,
} from '@/lib/planner/depositPayments'
import { reconcilePlannerDepositTerminalEffects } from '@/lib/planner/depositCaptureEffects'
import { getWorkerOrAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

type PlannerDb = { from: (table: string) => any }

type CaptureReconciliationCounts = {
  stale: number
  claimed: number
  captured: number
  failed: number
  pending: number
  skipped: number
}

/**
 * Reconciles both Stripe truth and local post-capture effects.
 *
 * Phase 0 resolves legacy status-only refunds by retrieving exact Stripe charge
 * truth before the atomic refund RPC may adjust any payout. Phase 1 claims stale
 * `capturing` rows with an updated_at CAS lease, retrieves
 * Stripe before any retry, and either captures with the persisted idempotency
 * key, finalizes an already-succeeded charge, or records a terminal failure.
 * Phase 2 leases terminal local effects: captured rows get a refund-adjusted
 * payout + action completion, fully refunded rows complete the action without
 * a payout, and failed capture attempts get action failure. Only then is the
 * effects marker written.
 */
export async function POST(request: NextRequest) {
  const context = await getWorkerOrAdminContext(request)
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const admin = createServiceRoleClient() as unknown as PlannerDb
  const errors: Array<{ payment_intent_id: string; error: string }> = []
  let reconciled = 0
  const staleCounts: CaptureReconciliationCounts = {
    stale: 0,
    claimed: 0,
    captured: 0,
    failed: 0,
    pending: 0,
    skipped: 0,
  }

  const refundCandidates = await loadRefundReconciliationCandidates(admin)
  let refundsReconciled = 0

  for (const intent of refundCandidates) {
    try {
      const result = await reconcilePlannerDepositRefundTruth({
        db: admin,
        paymentIntent: intent,
      })
      if (result.outcome === 'reconciled') {
        refundsReconciled += 1
        reconciled += 1
      }
    } catch (error) {
      recordReconciliationError(errors, intent, error, 'refund_truth_reconcile_failed')
    }
  }

  const staleCandidates = await loadStaleCaptureCandidates(admin)
  staleCounts.stale = staleCandidates.length

  for (const intent of staleCandidates) {
    try {
      const result = await reconcilePlannerDepositCapture({
        db: admin,
        paymentIntent: intent,
      })
      if (result.outcome === 'skipped') {
        staleCounts.skipped += 1
        continue
      }

      staleCounts.claimed += 1
      staleCounts[result.outcome] += 1
    } catch (error) {
      recordReconciliationError(errors, intent, error, 'stale_capture_reconcile_failed')
    }
  }

  let skipped = 0
  const terminalCandidates = await loadIncompleteTerminalDepositCandidates(admin)

  for (const intent of terminalCandidates) {
    try {
      const result = await reconcilePlannerDepositTerminalEffects({
        db: admin,
        paymentIntent: intent,
        actorId: null,
        actorRole: 'system',
        reason: intent.status === 'failed'
          ? 'payment.capture_failed_reconciled'
          : intent.status === 'refunded'
            ? 'payment.refund_reconciled'
            : 'payment.capture_reconciled',
      })
      if (result.outcome === 'skipped') {
        skipped += 1
        continue
      }

      reconciled += 1

      Sentry.captureMessage('capture_reconciled', {
        level: 'info',
        tags: {
          action: 'capture_reconciled',
          plan_id: result.paymentIntent.plan_id,
          payment_intent_id: result.paymentIntent.id,
          amount_cents: String(result.paymentIntent.amount_cents),
        },
        extra: {
          terminal_status: result.paymentIntent.status,
          platform_fee_cents: result.paymentIntent.platform_fee_cents,
          payout_amount_cents: result.paymentIntent.status === 'captured'
            ? Math.max(
              0,
              result.paymentIntent.amount_cents -
                result.paymentIntent.platform_fee_cents -
                (result.paymentIntent.refunded_amount_cents ?? 0)
            )
            : null,
          capture_attempt_id: result.paymentIntent.capture_attempt_id,
        },
      })
    } catch (error) {
      recordReconciliationError(errors, intent, error, 'capture_reconcile_failed')
    }
  }

  Sentry.metrics.count('planner.stale_capturing.reconciled', staleCounts.claimed, {
    attributes: {
      stale_count: staleCounts.stale,
      claimed_count: staleCounts.claimed,
      failed_count: staleCounts.failed,
      pending_count: staleCounts.pending,
      skipped_count: staleCounts.skipped,
    },
  })
  Sentry.metrics.count('planner.refund_truth.reconciled', refundsReconciled, {
    attributes: {
      candidate_count: refundCandidates.length,
      error_count: errors.length,
    },
  })
  Sentry.captureMessage('stale_payment_capture_reconciliation_run', {
    level: staleCounts.stale > 0 ? 'warning' : 'info',
    tags: {
      action: 'stale_payment_capture_reconciliation_run',
    },
    extra: staleCounts,
  })

  return NextResponse.json({ reconciled, skipped, errors })
}

export async function GET(request: NextRequest) {
  return POST(request)
}

async function loadStaleCaptureCandidates(db: PlannerDb): Promise<PlannerPaymentIntentRow[]> {
  const cutoff = new Date(Date.now() - STALE_PAYMENT_CAPTURE_TIMEOUT_MS).toISOString()
  const { data, error } = await db
    .from('payment_intents')
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .eq('status', 'capturing')
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(100)

  if (error) throw new Error(error.message ?? 'Failed to load stale payment captures')
  return (data ?? []) as PlannerPaymentIntentRow[]
}

async function loadRefundReconciliationCandidates(
  db: PlannerDb
): Promise<PlannerPaymentIntentRow[]> {
  const { data, error } = await db
    .from('payment_intents')
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .eq('status', 'refund_reconciliation_required')
    .order('updated_at', { ascending: true })
    .limit(100)

  if (error) {
    throw new Error(error.message ?? 'Failed to load unknown planner deposit refunds')
  }
  return (data ?? []) as PlannerPaymentIntentRow[]
}

async function loadIncompleteTerminalDepositCandidates(
  db: PlannerDb
): Promise<PlannerPaymentIntentRow[]> {
  const { data: captured, error: capturedError } = await db
    .from('payment_intents')
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .eq('status', 'captured')
    .is('capture_effects_completed_at', null)
    .order('updated_at', { ascending: true })
    .limit(100)

  if (capturedError) {
    throw new Error(capturedError.message ?? 'Failed to load incomplete captured payment intents')
  }

  const { data: refunded, error: refundedError } = await db
    .from('payment_intents')
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .eq('status', 'refunded')
    .is('capture_effects_completed_at', null)
    .order('updated_at', { ascending: true })
    .limit(100)

  if (refundedError) {
    throw new Error(refundedError.message ?? 'Failed to load incomplete refunded payment intents')
  }

  const { data: failed, error: failedError } = await db
    .from('payment_intents')
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .eq('status', 'failed')
    .not('capture_attempt_id', 'is', null)
    .is('capture_effects_completed_at', null)
    .order('updated_at', { ascending: true })
    .limit(100)

  if (failedError) {
    throw new Error(failedError.message ?? 'Failed to load incomplete failed payment intents')
  }

  return ([...(captured ?? []), ...(refunded ?? []), ...(failed ?? [])] as PlannerPaymentIntentRow[])
    .sort((left, right) => Date.parse(left.updated_at) - Date.parse(right.updated_at))
    .slice(0, 100)
}

function recordReconciliationError(
  errors: Array<{ payment_intent_id: string; error: string }>,
  intent: PlannerPaymentIntentRow,
  error: unknown,
  action: string
) {
  const message = error instanceof Error ? error.message : 'Unknown reconciliation error'
  Sentry.captureException(error, {
    tags: {
      action,
      plan_id: intent.plan_id,
      payment_intent_id: intent.id,
      amount_cents: String(intent.amount_cents ?? 'unknown'),
      capture_attempt_id: intent.capture_attempt_id ?? 'missing',
    },
    extra: { error: message },
  })
  errors.push({ payment_intent_id: intent.id, error: message })
}
