import 'server-only'

import type { AgentAction, Json } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }

export type PlannerPaymentAuthenticationState =
  | 'awaiting_authentication'
  | 'authenticated'
  | 'retry_allowed'

export type PlannerPaymentExecutionState =
  | 'idle'
  | 'awaiting_authentication'
  | 'authorized'
  | 'capturing'
  | 'captured'
  | 'retry_allowed'
  | 'failed'

type PlannerPaymentStateRow = {
  id: string
  status: string
  stripe_payment_method_id?: string | null
}

export type PlannerPaymentAuthenticationSnapshot = {
  state: PlannerPaymentExecutionState
  paymentIntentId: string | null
  paymentMethodId: string | null
}

export class PlannerPaymentAuthenticationConflictError extends Error {
  constructor(message = 'Payment authentication state changed. Refresh before retrying.') {
    super(message)
    this.name = 'PlannerPaymentAuthenticationConflictError'
  }
}

/**
 * Persists the organizer-visible SCA lifecycle without inventing a new agent
 * action status. The approval action remains approved while its result metadata
 * and append-only audit trail explain whether authentication is waiting,
 * complete, or retryable.
 */
export async function recordPlannerPaymentAuthenticationState(input: {
  db: PlannerDb
  action: AgentAction
  actorId: string | null
  actorRole?: 'user' | 'system' | 'stripe_webhook'
  state: PlannerPaymentAuthenticationState
  paymentIntentId?: string | null
  stripeStatus?: string | null
  outcome?: 'succeeded' | 'failed' | 'abandoned' | null
  expectedAuthentication?: {
    state: PlannerPaymentAuthenticationState
    paymentIntentId: string
  }
}) {
  const currentMetadata = readRecord(input.action.result_metadata) ?? {}
  const currentAuthentication = readRecord(currentMetadata.payment_authentication)
  const nextPaymentIntentId = input.paymentIntentId ?? null
  const nextStripeStatus = input.stripeStatus ?? null
  const nextOutcome = input.outcome ?? null
  if (
    input.expectedAuthentication &&
    (
      currentAuthentication?.status !== input.expectedAuthentication.state ||
      currentAuthentication?.payment_intent_id !== input.expectedAuthentication.paymentIntentId
    )
  ) {
    throw new PlannerPaymentAuthenticationConflictError()
  }
  if (
    currentAuthentication?.status === input.state &&
    (currentAuthentication.payment_intent_id ?? null) === nextPaymentIntentId &&
    (currentAuthentication.stripe_status ?? null) === nextStripeStatus &&
    (currentAuthentication.outcome ?? null) === nextOutcome
  ) {
    return { changed: false }
  }

  const now = new Date().toISOString()
  const paymentAuthentication = {
    status: input.state,
    payment_intent_id: nextPaymentIntentId,
    stripe_status: nextStripeStatus,
    outcome: nextOutcome,
    updated_at: now,
  }
  const nextMetadata = {
    ...currentMetadata,
    payment_authentication: paymentAuthentication,
  } as Json

  let updateQuery = input.db
    .from('agent_actions')
    .update({ result_metadata: nextMetadata })
    .eq('id', input.action.id)
    .eq('plan_id', input.action.plan_id)
    .eq('status', input.action.status)
  if (input.expectedAuthentication) {
    updateQuery = updateQuery.contains('result_metadata', {
      payment_authentication: {
        status: input.expectedAuthentication.state,
        payment_intent_id: input.expectedAuthentication.paymentIntentId,
      },
    })
  }
  const { data, error } = await updateQuery.select('id')
    .maybeSingle()

  if (error) throw new Error(`Failed to persist payment authentication state: ${error.message}`)
  if (!data) {
    if (input.expectedAuthentication) throw new PlannerPaymentAuthenticationConflictError()
    throw new Error('Payment action changed while authentication state was being saved')
  }

  const { error: auditError } = await input.db.from('agent_action_audit_log').insert({
    action_id: input.action.id,
    plan_id: input.action.plan_id,
    from_status: input.action.status,
    to_status: input.action.status,
    actor_id: input.actorId,
    actor_role: input.actorRole ?? 'user',
    reason: `payment.authentication.${input.state}`,
    metadata: paymentAuthentication,
  })
  if (auditError) throw new Error(`Failed to audit payment authentication state: ${auditError.message}`)

  return { changed: true }
}

/**
 * Derives the organizer-visible payment state from durable local money truth.
 * Agent-action metadata explains an in-progress SCA attempt, while a terminal
 * or capturable local PaymentIntent always takes precedence after refresh.
 */
export function derivePlannerPaymentAuthenticationSnapshot(input: {
  action: Pick<AgentAction, 'result_metadata'>
  paymentIntent?: PlannerPaymentStateRow | null
}): PlannerPaymentAuthenticationSnapshot {
  const paymentIntent = input.paymentIntent ?? null
  const metadata = readRecord(input.action.result_metadata)
  const authentication = readRecord(metadata?.payment_authentication)
  const authenticationStatus = readString(authentication?.status)

  if (paymentIntent?.status === 'captured' || paymentIntent?.status === 'refunded') {
    return snapshot('captured', paymentIntent)
  }
  if (paymentIntent?.status === 'capturing') {
    return snapshot('capturing', paymentIntent)
  }
  if (paymentIntent?.status === 'authorized') {
    return snapshot('authorized', paymentIntent)
  }
  if (paymentIntent?.status === 'failed' || paymentIntent?.status === 'refund_reconciliation_required') {
    return snapshot('failed', paymentIntent)
  }
  if (authenticationStatus === 'awaiting_authentication') {
    return snapshot('awaiting_authentication', paymentIntent, authentication)
  }
  if (authenticationStatus === 'retry_allowed') {
    return snapshot('retry_allowed', paymentIntent, authentication)
  }
  if (authenticationStatus === 'authenticated') {
    return snapshot('authorized', paymentIntent, authentication)
  }

  return snapshot('idle', paymentIntent, authentication)
}

function snapshot(
  state: PlannerPaymentExecutionState,
  paymentIntent: PlannerPaymentStateRow | null,
  authentication?: Record<string, Json | undefined> | null
): PlannerPaymentAuthenticationSnapshot {
  return {
    state,
    paymentIntentId: paymentIntent?.id ?? readString(authentication?.payment_intent_id),
    paymentMethodId: paymentIntent?.stripe_payment_method_id ?? null,
  }
}

function readRecord(value: Json | null | undefined): Record<string, Json | undefined> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, Json | undefined>
}

function readString(value: Json | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
