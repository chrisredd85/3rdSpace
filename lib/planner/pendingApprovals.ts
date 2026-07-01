import {
  APPROVAL_SELECT_COLUMNS,
  PLAN_SELECT_COLUMNS,
} from '@/lib/planner/dbSelects'
import type { Approval, Plan } from '@/lib/types'

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
): Promise<Approval[]> {
  const { data, error } = await db
    .from('approvals')
    .select(APPROVAL_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[planner.approvals] Pending approvals lookup failed', error)
    return []
  }

  return (data ?? []) as Approval[]
}

export function attachPendingApprovalPlanContext(
  approvals: Approval[],
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
