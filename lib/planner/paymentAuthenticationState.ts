import 'server-only'

import type { AgentAction, Json } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }

export type PlannerPaymentAuthenticationState =
  | 'awaiting_authentication'
  | 'authenticated'
  | 'retry_allowed'

/**
 * Persists the organizer-visible SCA lifecycle without inventing a new agent
 * action status. The approval action remains approved while its result metadata
 * and append-only audit trail explain whether authentication is waiting,
 * complete, or retryable.
 */
export async function recordPlannerPaymentAuthenticationState(input: {
  db: PlannerDb
  action: AgentAction
  actorId: string
  state: PlannerPaymentAuthenticationState
  paymentIntentId?: string | null
  stripeStatus?: string | null
  outcome?: 'succeeded' | 'failed' | 'abandoned' | null
}) {
  const currentMetadata = readRecord(input.action.result_metadata) ?? {}
  const now = new Date().toISOString()
  const paymentAuthentication = {
    status: input.state,
    payment_intent_id: input.paymentIntentId ?? null,
    stripe_status: input.stripeStatus ?? null,
    outcome: input.outcome ?? null,
    updated_at: now,
  }
  const nextMetadata = {
    ...currentMetadata,
    payment_authentication: paymentAuthentication,
  } as Json

  const { data, error } = await input.db
    .from('agent_actions')
    .update({ result_metadata: nextMetadata })
    .eq('id', input.action.id)
    .eq('plan_id', input.action.plan_id)
    .eq('status', input.action.status)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Failed to persist payment authentication state: ${error.message}`)
  if (!data) throw new Error('Payment action changed while authentication state was being saved')

  const { error: auditError } = await input.db.from('agent_action_audit_log').insert({
    action_id: input.action.id,
    plan_id: input.action.plan_id,
    from_status: input.action.status,
    to_status: input.action.status,
    actor_id: input.actorId,
    actor_role: 'user',
    reason: `payment.authentication.${input.state}`,
    metadata: paymentAuthentication,
  })
  if (auditError) throw new Error(`Failed to audit payment authentication state: ${auditError.message}`)
}

function readRecord(value: Json | null | undefined): Record<string, Json | undefined> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, Json | undefined>
}
