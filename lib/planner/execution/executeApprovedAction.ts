import type { AgentAction, Approval, Json } from '@/lib/types'
import {
  isApprovalExecutable,
  TERMINAL_ACTION_STATUSES,
  transitionAgentActionStatus,
  type AgentActionTransitionEvent,
} from './approvalState'

export type ApprovedActionExecutionKind =
  | 'no_execution'
  | 'send_gmail_outreach'
  | 'prepare_outreach_drafts'
  | 'await_explicit_payment_confirmation'
  | 'await_external_checkout'
  | 'await_concierge_queue'

export interface ApprovedActionExecutionPlan {
  kind: ApprovedActionExecutionKind
  canStart: boolean
  terminalActionStatus: 'approved' | 'executing' | 'complete'
  reason: string
}

export interface ApprovedActionExecutionContext {
  action: AgentAction
  approval: Approval
}

export interface ApprovedActionExecutionResult<Result = unknown> {
  plan: ApprovedActionExecutionPlan
  started: boolean
  result: Result | null
}

export type ApprovedActionExecutionHandler<Result = unknown> = (
  context: ApprovedActionExecutionContext
) => Promise<Result>

export type ApprovedActionExecutorRegistry = Partial<Record<
  Exclude<ApprovedActionExecutionKind, 'no_execution'>,
  ApprovedActionExecutionHandler
>>

type PlannerExecutionDb = { from: (table: string) => any }

export function planApprovedActionExecution(input: {
  action: Pick<AgentAction, 'action_type' | 'payload_json' | 'result_metadata'>
  approval: Pick<Approval, 'status'>
}): ApprovedActionExecutionPlan {
  if (!isApprovalExecutable(input.approval.status)) {
    return {
      kind: 'no_execution',
      canStart: false,
      terminalActionStatus: 'approved',
      reason: 'Approval is not executable',
    }
  }

  if (isApprovedGmailOutreachAction(input.action)) {
    return {
      kind: 'send_gmail_outreach',
      canStart: true,
      terminalActionStatus: 'complete',
      reason: 'Approval sends reviewed outreach through the connected Gmail account',
    }
  }

  if (isOutreachPreparationAction(input.action)) {
    return {
      kind: 'prepare_outreach_drafts',
      canStart: true,
      terminalActionStatus: 'complete',
      reason: 'Approval prepares outreach drafts but does not send outbound messages',
    }
  }

  if (input.action.action_type === 'payment') {
    return {
      kind: 'await_explicit_payment_confirmation',
      canStart: false,
      terminalActionStatus: 'approved',
      reason: 'Payment authorization and capture require explicit follow-up confirmation',
    }
  }

  if (input.action.action_type === 'external_checkout') {
    return {
      kind: 'await_external_checkout',
      canStart: true,
      terminalActionStatus: 'executing',
      reason: 'Approval unlocks a host-controlled external checkout handoff',
    }
  }

  if (input.action.action_type === 'concierge_queue') {
    return {
      kind: 'await_concierge_queue',
      canStart: false,
      terminalActionStatus: 'approved',
      reason: 'Concierge execution requires an admin task handoff',
    }
  }

  return {
    kind: 'no_execution',
    canStart: false,
    terminalActionStatus: 'approved',
    reason: 'Approval recorded; no automatic execution is defined for this action',
  }
}

/**
 * The sole action-kind dispatch point for approval-backed planner execution.
 *
 * Routes own authentication and pass narrowly scoped handlers for provider or
 * service work. This registry owns kind selection so a new execution mode
 * cannot quietly fork its own action-type switch inside a route.
 */
export async function executeApprovedAction<Result = unknown>(input: {
  action: AgentAction
  approval: Approval
  registry: ApprovedActionExecutorRegistry
}): Promise<ApprovedActionExecutionResult<Result>> {
  const plan = planApprovedActionExecution({
    action: input.action,
    approval: input.approval,
  })

  if (!plan.canStart || plan.kind === 'no_execution') {
    return { plan, started: false, result: null }
  }

  const handler = input.registry[plan.kind]
  if (!handler) {
    throw new Error(`No approved-action executor is registered for ${plan.kind}`)
  }

  return {
    plan,
    started: true,
    result: await handler({ action: input.action, approval: input.approval }) as Result,
  }
}

export function isApprovedGmailOutreachAction(
  action: Pick<AgentAction, 'action_type' | 'payload_json'>
): boolean {
  const payload = readRecord(action.payload_json)
  return action.action_type === 'email' && readString(payload?.kind) === 'gmail_approved_outreach'
}

export function isOutreachPreparationAction(
  action: Pick<AgentAction, 'action_type' | 'payload_json' | 'result_metadata'>
): boolean {
  if (action.action_type === 'opportunity_send_venues' || action.action_type === 'opportunity_send_vendors') {
    return true
  }

  const payload = readRecord(action.payload_json)
  const metadata = readRecord(action.result_metadata)
  return action.action_type === 'email' &&
    (readString(payload?.kind) === 'venue_outreach' || readString(payload?.kind) === 'vendor_outreach') &&
    (
      readString(metadata?.action_type_fallback) === 'opportunity_send_venues' ||
      readString(metadata?.action_type_fallback) === 'opportunity_send_vendors'
    )
}

export function paymentAuthorizationTransitionEvents(
  currentStatus: AgentAction['status']
): AgentActionTransitionEvent[] {
  if (currentStatus === 'pending' || currentStatus === 'proposed') {
    return ['approval_granted', 'execution_started']
  }

  if (currentStatus === 'approved') return ['execution_started']
  if (currentStatus === 'executing' || currentStatus === 'complete') return []

  if (TERMINAL_ACTION_STATUSES.includes(currentStatus)) {
    throw new Error(`Cannot authorize payment for a ${currentStatus} action`)
  }

  return []
}

export function paymentCaptureTransitionEvents(
  currentStatus: AgentAction['status']
): AgentActionTransitionEvent[] {
  if (currentStatus === 'pending' || currentStatus === 'proposed') {
    return ['approval_granted', 'execution_started', 'execution_completed']
  }

  if (currentStatus === 'approved') return ['execution_started', 'execution_completed']
  if (currentStatus === 'executing') return ['execution_completed']
  if (currentStatus === 'complete') return []

  if (TERMINAL_ACTION_STATUSES.includes(currentStatus)) {
    throw new Error(`Cannot capture payment for a ${currentStatus} action`)
  }

  return []
}

export async function persistAgentActionTransitionEvents(
  db: PlannerExecutionDb,
  input: {
    action: AgentAction
    actorId: string | null
    actorRole?: 'user' | 'system'
    events: AgentActionTransitionEvent[]
    reason: string
    metadata: Record<string, unknown>
  }
): Promise<AgentAction> {
  let action = input.action
  for (const event of input.events) {
    const transition = transitionAgentActionStatus(action.status, event)
    if (!transition.ok) throw new Error(transition.reason)
    if (!transition.changed) continue

    const nextMetadata = {
      ...(readRecord(action.result_metadata) ?? {}),
      ...input.metadata,
      payment_transition_event: event,
    } as Json
    const updates: Record<string, unknown> = {
      status: transition.to,
      result_metadata: nextMetadata,
    }
    if (transition.to === 'complete') updates.executed_at = new Date().toISOString()

    const { data, error } = await db
      .from('agent_actions')
      .update(updates)
      .eq('id', action.id)
      .eq('status', action.status)
      .select(AGENT_ACTION_EXECUTION_SELECT_COLUMNS)
      .maybeSingle()

    if (error) throw new Error(error.message ?? 'Failed to update agent action state')
    if (!data) {
      const current = await loadAgentActionForTransition(db, action.id)
      if (!current || !hasReachedAgentActionStatus(current.status, transition.to)) {
        throw new Error('Agent action state changed during transition; retry from current state')
      }
      action = current
      continue
    }

    const { error: auditError } = await db.from('agent_action_audit_log').insert({
      action_id: action.id,
      plan_id: action.plan_id,
      from_status: transition.from,
      to_status: transition.to,
      actor_id: input.actorId,
      actor_role: input.actorRole ?? 'user',
      reason: input.reason,
      metadata: nextMetadata,
    })
    if (auditError) throw new Error(auditError.message ?? 'Failed to append agent action audit log')

    action = data as AgentAction
  }

  return action
}

export const AGENT_ACTION_EXECUTION_SELECT_COLUMNS = `
  id,
  plan_id,
  action_type,
  description,
  provider,
  target_type,
  target_id,
  payload_json,
  amount_cents,
  currency,
  status,
  approval_id,
  executed_at,
  result_metadata,
  created_at,
  updated_at
`

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

async function loadAgentActionForTransition(
  db: PlannerExecutionDb,
  actionId: string
): Promise<AgentAction | null> {
  const { data, error } = await db
    .from('agent_actions')
    .select(AGENT_ACTION_EXECUTION_SELECT_COLUMNS)
    .eq('id', actionId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to reload agent action state')
  return (data as AgentAction | null) ?? null
}

function hasReachedAgentActionStatus(
  currentStatus: AgentAction['status'],
  targetStatus: AgentAction['status']
) {
  if (currentStatus === targetStatus) return true
  const forwardOrder: AgentAction['status'][] = ['pending', 'proposed', 'approved', 'executing', 'complete']
  const currentIndex = forwardOrder.indexOf(currentStatus)
  const targetIndex = forwardOrder.indexOf(targetStatus)
  return currentIndex >= 0 && targetIndex >= 0 && currentIndex > targetIndex
}
