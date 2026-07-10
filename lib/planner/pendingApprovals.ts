import {
  APPROVAL_SELECT_COLUMNS,
  PLAN_SELECT_COLUMNS,
} from '@/lib/planner/dbSelects'
import { deriveApprovalUiState } from '@/lib/planner/approvalUiState'
import type { Approval, Json, Plan } from '@/lib/types'

export type PlannerDb = { from: (table: string) => any }

export type PendingApprovalPlanContext = Pick<
  Plan,
  | 'id'
  | 'title'
  | 'event_type'
  | 'guest_count'
  | 'neighborhood'
  | 'date_window_start'
  | 'date_window_end'
  | 'status'
  | 'updated_at'
>

export type PendingApprovalWithPlan = Approval & {
  plan: PendingApprovalPlanContext | null
  action_status?: string | null
  action_result?: Json | null
  ui_status?: string
  available_actions?: string[]
}

export type CurrentApproval = Approval & {
  action_status: string | null
  action_result: Json | null
  ui_status: string
  available_actions: string[]
}

export async function loadOwnedPlannerPlansForApprovalQueue(
  db: PlannerDb,
  userId: string,
  limit = 10
): Promise<Plan[]> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[planner.approvals] Plan queue lookup failed', error)
    return []
  }

  return (data ?? []) as Plan[]
}

export async function loadPendingApprovalsForPlan(
  db: PlannerDb,
  planId: string
): Promise<CurrentApproval[]> {
  const { data, error } = await db
    .from('approvals')
    .select(APPROVAL_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .in('status', ['pending', 'expired', 're_approval_required', 'authorized', 'approved'])
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[planner.approvals] Pending approvals lookup failed', error)
    return []
  }

  const approvals = await enrichApprovalsWithActionState(db, (data ?? []) as Approval[])
  return approvals.filter((approval) => (
    !(
      (approval.status === 'authorized' || approval.status === 'approved') &&
      approval.action_status !== 'failed'
    )
  ))
}

/** Adds the canonical action/result/UI truth to approval rows without changing scope. */
export async function enrichApprovalsWithActionState(
  db: PlannerDb,
  approvals: Approval[]
): Promise<CurrentApproval[]> {
  const actionIds = [...new Set(approvals.map((approval) => approval.agent_action_id).filter(Boolean))]
  const actionsById = new Map<string, { status: string; result_metadata: Json | null; last_retry_result?: Json | null }>()
  if (actionIds.length > 0) {
    const { data: actions, error: actionError } = await db
      .from('agent_actions')
      .select('id,status,result_metadata,last_retry_result')
      .in('id', actionIds)
    if (actionError) {
      console.error('[planner.approvals] Approval action-state lookup failed', actionError)
    } else {
      for (const action of actions ?? []) actionsById.set(String(action.id), action)
    }
  }

  return approvals.map((approval) => {
    const action = actionsById.get(approval.agent_action_id)
    const ui = deriveApprovalUiState({
      approvalStatus: approval.status,
      actionStatus: action?.status ?? null,
      expiresAt: approval.expires_at,
      supersededAt: approval.superseded_at,
    })
    return {
      ...approval,
      action_status: action?.status ?? null,
      action_result: action?.last_retry_result ?? action?.result_metadata ?? null,
      ui_status: ui.status,
      available_actions: [...ui.availableActions],
    }
  })
}

export function attachPendingApprovalPlanContext(
  approvals: Array<Approval | CurrentApproval>,
  plans: Plan[]
): PendingApprovalWithPlan[] {
  const plansById = new Map(plans.map((plan) => [plan.id, toPendingApprovalPlanContext(plan)]))

  return approvals.map((approval) => ({
    ...approval,
    plan: plansById.get(approval.plan_id) ?? null,
  }))
}

function toPendingApprovalPlanContext(plan: Plan): PendingApprovalPlanContext {
  return {
    id: plan.id,
    title: plan.title,
    event_type: plan.event_type,
    guest_count: plan.guest_count,
    neighborhood: plan.neighborhood,
    date_window_start: plan.date_window_start,
    date_window_end: plan.date_window_end,
    status: plan.status,
    updated_at: plan.updated_at,
  }
}
