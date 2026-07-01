export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import {
  attachPendingApprovalPlanContext,
  loadOwnedPlannerPlansForApprovalQueue,
  loadPendingApprovalsForPlan,
  type PendingApprovalWithPlan,
  type PlannerDb,
} from '@/lib/planner/pendingApprovals'
import { createClient } from '@/lib/supabase/server'
import type { PlannerApiErrorResponse, Plan } from '@/lib/types'

type PendingApprovalsResponse = {
  active_plan: Plan | null
  approvals: PendingApprovalWithPlan[]
}

type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

export async function GET(
  request: NextRequest
): Promise<NextResponse<PendingApprovalsResponse | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const requestedPlanId = request.nextUrl.searchParams.get('plan_id')
    const plans = await loadOwnedPlannerPlansForApprovalQueue(auth.db, auth.userId)
    const activePlan = requestedPlanId
      ? plans.find((plan) => plan.id === requestedPlanId) ?? null
      : plans.find((plan) => plan.status !== 'archived') ?? null

    if (!activePlan) return NextResponse.json({ active_plan: null, approvals: [] })

    const approvals = await loadPendingApprovalsForPlan(auth.db, activePlan.id)

    return NextResponse.json({
      active_plan: activePlan,
      approvals: attachPendingApprovalPlanContext(approvals, [activePlan]),
    })
  } catch (error) {
    console.error('[planner.approvals.pending] GET failed', error)
    return NextResponse.json({ error: 'Unable to load pending approvals' }, { status: 500 })
  }
}

async function getPlannerAuth(): Promise<PlannerAuth> {
  const supabase = createClient()
  const db = supabase as unknown as PlannerDb
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  return { db, userId: user.id }
}
