import 'server-only'

import {
  CAPTURE_EFFECTS_LEASE_TIMEOUT_MS,
  ensurePlannerDepositPayout,
  loadPlannerPaymentIntentById,
  markPlannerDepositCaptureEffectsCompleted,
  PAYMENT_INTENT_SELECT_COLUMNS,
  type PlannerPaymentIntentRow,
} from '@/lib/planner/depositPayments'
import {
  AGENT_ACTION_EXECUTION_SELECT_COLUMNS,
  paymentCaptureTransitionEvents,
  persistAgentActionTransitionEvents,
} from '@/lib/planner/execution/executeApprovedAction'
import type { AgentAction } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }

export type PlannerDepositTerminalEffectsOutcome = 'completed' | 'skipped'

export interface PlannerDepositTerminalEffectsResult {
  paymentIntent: PlannerPaymentIntentRow
  outcome: PlannerDepositTerminalEffectsOutcome
}

/**
 * Claims and completes the durable local effects of a terminal capture outcome.
 *
 * The lease makes payout/action finalization reclaimable after a worker crash,
 * while the payment-row CAS and action-status CAS prevent staggered workers from
 * applying the same effects concurrently.
 */
export async function reconcilePlannerDepositTerminalEffects(input: {
  db: PlannerDb
  paymentIntent: PlannerPaymentIntentRow
  actorId: string | null
  actorRole: 'user' | 'system'
  reason: string
  metadata?: Record<string, unknown>
  now?: Date
}): Promise<PlannerDepositTerminalEffectsResult> {
  if (
    input.paymentIntent.status !== 'captured' &&
    input.paymentIntent.status !== 'refunded' &&
    input.paymentIntent.status !== 'failed'
  ) {
    return { paymentIntent: input.paymentIntent, outcome: 'skipped' }
  }
  if (input.paymentIntent.capture_effects_completed_at) {
    return { paymentIntent: input.paymentIntent, outcome: 'completed' }
  }
  if (input.paymentIntent.status === 'failed' && !input.paymentIntent.capture_attempt_id) {
    return { paymentIntent: input.paymentIntent, outcome: 'skipped' }
  }

  const claimed = await claimPlannerDepositTerminalEffects(
    input.db,
    input.paymentIntent,
    input.now ?? new Date()
  )
  if (!claimed) {
    const current = await loadPlannerPaymentIntentById(input.db, input.paymentIntent.id)
    if (!current) throw new Error('Planner deposit disappeared during terminal-effects reconciliation')
    return {
      paymentIntent: current,
      outcome: current.capture_effects_completed_at ? 'completed' : 'skipped',
    }
  }

  if (claimed.status === 'captured' || claimed.status === 'refunded') {
    if (claimed.status === 'captured') {
      await ensurePlannerDepositPayout(input.db, claimed)
    }
    await completeLinkedPaymentAction(input.db, claimed, input)
  } else {
    await failLinkedPaymentAction(input.db, claimed, input)
  }

  const completed = await markPlannerDepositCaptureEffectsCompleted(input.db, claimed)
  return { paymentIntent: completed, outcome: 'completed' }
}

export function isPlannerDepositTerminalEffectsLeaseAvailable(
  paymentIntent: Pick<
    PlannerPaymentIntentRow,
    'capture_effects_started_at' | 'capture_effects_completed_at'
  >,
  nowMs = Date.now()
) {
  if (paymentIntent.capture_effects_completed_at) return false
  if (!paymentIntent.capture_effects_started_at) return true
  const startedAtMs = Date.parse(paymentIntent.capture_effects_started_at)
  return Number.isFinite(startedAtMs) &&
    nowMs - startedAtMs >= CAPTURE_EFFECTS_LEASE_TIMEOUT_MS
}

async function claimPlannerDepositTerminalEffects(
  db: PlannerDb,
  paymentIntent: PlannerPaymentIntentRow,
  now: Date
): Promise<PlannerPaymentIntentRow | null> {
  if (!isPlannerDepositTerminalEffectsLeaseAvailable(paymentIntent, now.getTime())) return null

  const leaseStartedAt = now.toISOString()
  let query = db
    .from('payment_intents')
    .update({ capture_effects_started_at: leaseStartedAt })
    .eq('id', paymentIntent.id)
    .eq('status', paymentIntent.status)
    .eq('updated_at', paymentIntent.updated_at)
    .is('capture_effects_completed_at', null)

  query = paymentIntent.capture_effects_started_at
    ? query.eq('capture_effects_started_at', paymentIntent.capture_effects_started_at)
    : query.is('capture_effects_started_at', null)

  const { data, error } = await query
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to claim planner deposit terminal effects')
  return (data as PlannerPaymentIntentRow | null) ?? null
}

async function completeLinkedPaymentAction(
  db: PlannerDb,
  paymentIntent: PlannerPaymentIntentRow,
  context: Pick<
    Parameters<typeof reconcilePlannerDepositTerminalEffects>[0],
    'actorId' | 'actorRole' | 'reason' | 'metadata'
  >
) {
  const action = await loadLinkedPaymentAction(db, paymentIntent)
  if (action.status === 'failed' || action.status === 'cancelled') {
    throw new Error(`Captured payment is linked to a terminal ${action.status} action`)
  }

  const events = paymentCaptureTransitionEvents(action.status)
  await persistAgentActionTransitionEvents(db, {
    action,
    actorId: context.actorId,
    actorRole: context.actorRole,
    events,
    reason: context.reason,
    metadata: terminalEffectsMetadata(paymentIntent, context),
  })
}

async function failLinkedPaymentAction(
  db: PlannerDb,
  paymentIntent: PlannerPaymentIntentRow,
  context: Pick<
    Parameters<typeof reconcilePlannerDepositTerminalEffects>[0],
    'actorId' | 'actorRole' | 'reason' | 'metadata'
  >
) {
  const action = await loadLinkedPaymentAction(db, paymentIntent)
  if (action.status === 'failed') return
  if (action.status === 'cancelled' || action.status === 'complete') {
    throw new Error(`Failed payment is linked to a terminal ${action.status} action`)
  }
  if (action.status !== 'approved' && action.status !== 'executing') {
    throw new Error(`Cannot fail linked payment action from ${action.status}`)
  }

  await persistAgentActionTransitionEvents(db, {
    action,
    actorId: context.actorId,
    actorRole: context.actorRole,
    events: ['execution_failed'],
    reason: context.reason,
    metadata: terminalEffectsMetadata(paymentIntent, context),
  })
}

async function loadLinkedPaymentAction(
  db: PlannerDb,
  paymentIntent: PlannerPaymentIntentRow
): Promise<AgentAction> {
  const { data: approval, error: approvalError } = await db
    .from('approvals')
    .select('agent_action_id')
    .eq('id', paymentIntent.approval_id)
    .eq('plan_id', paymentIntent.plan_id)
    .maybeSingle()

  if (approvalError) throw new Error(approvalError.message ?? 'Failed to load payment approval')
  const actionId = (approval as { agent_action_id?: string } | null)?.agent_action_id
  if (!actionId) throw new Error('Terminal payment is missing its linked approval action')

  const { data: action, error: actionError } = await db
    .from('agent_actions')
    .select(AGENT_ACTION_EXECUTION_SELECT_COLUMNS)
    .eq('id', actionId)
    .eq('plan_id', paymentIntent.plan_id)
    .maybeSingle()

  if (actionError) throw new Error(actionError.message ?? 'Failed to load linked payment action')
  if (!action) throw new Error('Terminal payment linked action was not found')
  return action as AgentAction
}

function terminalEffectsMetadata(
  paymentIntent: PlannerPaymentIntentRow,
  context: Pick<
    Parameters<typeof reconcilePlannerDepositTerminalEffects>[0],
    'actorRole' | 'metadata'
  >
) {
  return {
    payment_intent_id: paymentIntent.id,
    payment_status: paymentIntent.status,
    capture_attempt_id: paymentIntent.capture_attempt_id,
    failure_reason: paymentIntent.failure_reason,
    reconciled: context.actorRole === 'system',
    ...(context.metadata ?? {}),
  }
}
