import type { AgentAction, Approval, Json } from '@/lib/types'
import {
  isApprovalExecutable,
  TERMINAL_ACTION_STATUSES,
  transitionAgentActionStatus,
  type AgentActionTransitionEvent,
} from './approvalState'

export type ApprovedActionExecutionKind =
  | 'no_execution'
  | 'prepare_outreach_drafts'
  | 'await_explicit_payment_confirmation'
  | 'await_external_checkout'
  | 'await_concierge_queue'

export interface ApprovedActionExecutionPlan {
  kind: ApprovedActionExecutionKind
  canStart: boolean
  terminalActionStatus: 'approved' | 'complete'
  reason: string
}

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
      canStart: false,
      terminalActionStatus: 'approved',
      reason: 'External checkout approval only unlocks a handoff link',
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
    actorId: string
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
      .select(AGENT_ACTION_EXECUTION_SELECT_COLUMNS)
      .single()

    if (error || !data) throw new Error(error?.message ?? 'Failed to update agent action state')

    await db.from('agent_action_audit_log').insert({
      action_id: action.id,
      plan_id: action.plan_id,
      from_status: transition.from,
      to_status: transition.to,
      actor_id: input.actorId,
      actor_role: 'user',
      reason: input.reason,
      metadata: nextMetadata,
    })

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
