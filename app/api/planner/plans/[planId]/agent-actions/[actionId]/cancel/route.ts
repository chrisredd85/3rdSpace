export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  cancelApprovedActionExecution,
  planApprovedActionCancellation,
} from '@/lib/planner/execution/executeApprovedAction'
import { cancelExternalCheckoutHandoff } from '@/lib/planner/execution/externalCheckout'
import {
  cancelConciergeApprovedAction,
  requireApprovedHandoffDb,
} from '@/lib/planner/execution/approvedActionHandoffs'
import { deriveApprovalUiState } from '@/lib/planner/approvalUiState'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { AgentAction, Approval, Json, Plan } from '@/lib/types'

type PlannerDb = {
  from: (table: string) => any
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown
    error: { message?: string; code?: string } | null
  }>
}
const paramsSchema = z.object({
  planId: z.string().uuid(),
  actionId: z.string().uuid(),
}).strict()

const bodySchema = z.object({
  approvalId: z.string().uuid(),
  expectedSnapshotHash: z.string().trim().regex(/^[a-f0-9]{64}$/i),
  reason: z.string().trim().min(3).max(500),
}).strict()

const idempotencyKeySchema = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/)

const PLAN_COLUMNS = 'id,user_id,title,status,materialized_event_id'
const ACTION_COLUMNS = `
  id,plan_id,action_type,description,provider,target_type,target_id,payload_json,
  amount_cents,currency,status,approval_id,executed_at,result_metadata,created_at,updated_at
`
const APPROVAL_COLUMNS = `
  id,plan_id,agent_action_id,status,snapshot_hash,snapshot_schema_version,expires_at,
  authorized_by,authorized_at,approved_by,approved_at
`

interface RouteContext {
  params: Promise<{ planId: string; actionId: string }>
}

/** Cancels operational work while preserving the immutable authorization row. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const params = paramsSchema.safeParse(await context.params)
    if (!params.success) return NextResponse.json({ error: 'Invalid plan or action id' }, { status: 400 })
    const body = bodySchema.safeParse(await request.json().catch(() => null))
    if (!body.success) return NextResponse.json({ error: 'Invalid cancellation request' }, { status: 400 })
    const idempotencyKey = idempotencyKeySchema.safeParse(request.headers.get('idempotency-key'))
    if (!idempotencyKey.success) {
      return NextResponse.json(
        { error: 'A valid Idempotency-Key header is required', code: 'idempotency_key_required' },
        { status: 400 }
      )
    }

    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    if (user.user_metadata?.user_type !== 'community_builder') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const readDb = supabase as unknown as PlannerDb
    const plan = await loadOwnedPlan(readDb, params.data.planId, user.id)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    const [action, approval] = await Promise.all([
      loadAction(readDb, plan.id, params.data.actionId),
      loadApproval(readDb, plan.id, body.data.approvalId),
    ])
    if (!action || !approval) return NextResponse.json({ error: 'Action or approval not found' }, { status: 404 })

    if (
      action.approval_id !== approval.id ||
      approval.agent_action_id !== action.id ||
      approval.snapshot_schema_version !== 2 ||
      approval.snapshot_hash !== body.data.expectedSnapshotHash ||
      !['authorized', 'approved'].includes(approval.status)
    ) {
      return NextResponse.json(
        { error: 'Cancellation does not match the authorized snapshot', code: 'approval_snapshot_mismatch' },
        { status: 409 }
      )
    }

    if (action.status === 'cancelled') {
      return cancellationResponse(approval, action)
    }
    if (planApprovedActionCancellation({ action, approval }) === 'no_cancellation') {
      return NextResponse.json(
        { error: 'This action has no cancellable operational handoff', code: 'execution_cancel_not_allowed' },
        { status: 409 }
      )
    }

    const writeDb = createServiceRoleClient() as unknown as PlannerDb
    const cancellation = await cancelApprovedActionExecution({
      action,
      approval,
      registry: {
        cancel_external_checkout: async () => cancelExternalCheckoutHandoff({
          db: writeDb,
          action,
          approval,
          plan,
          actorId: user.id,
          idempotencyKey: idempotencyKey.data,
          reason: body.data.reason,
        }),
        cancel_concierge_handoff: async () => cancelConciergeApprovedAction({
          db: requireApprovedHandoffDb(writeDb),
          action,
          approval,
          plan,
          actorId: user.id,
          reason: body.data.reason,
        }),
      },
    })
    if (!cancellation.cancelled) {
      return NextResponse.json(
        { error: 'This action is no longer cancellable', code: 'execution_cancel_not_allowed' },
        { status: 409 }
      )
    }

    const updatedAction = await loadAction(writeDb, plan.id, action.id)
    if (!updatedAction || updatedAction.status !== 'cancelled') {
      return NextResponse.json(
        { error: 'Cancellation result could not be reconciled', code: 'execution_cancel_pending' },
        { status: 202 }
      )
    }
    return cancellationResponse(approval, updatedAction)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to cancel execution'
    const conflict = /not.cancell|mismatch|complete|confirmed|conflict|race|deadlock|40P01/i.test(message)
    console.error('[planner.approved-action.cancel] Failed to cancel execution', error)
    return NextResponse.json(
      { error: message, code: conflict ? 'execution_cancel_not_allowed' : 'execution_cancel_failed' },
      { status: conflict ? 409 : 500 }
    )
  }
}

async function loadOwnedPlan(db: PlannerDb, planId: string, userId: string): Promise<Plan | null> {
  const { data, error } = await db.from('plans').select(PLAN_COLUMNS).eq('id', planId).eq('user_id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Plan | null) ?? null
}

async function loadAction(db: PlannerDb, planId: string, actionId: string): Promise<AgentAction | null> {
  const { data, error } = await db.from('agent_actions').select(ACTION_COLUMNS).eq('id', actionId).eq('plan_id', planId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as AgentAction | null) ?? null
}

async function loadApproval(db: PlannerDb, planId: string, approvalId: string): Promise<Approval | null> {
  const { data, error } = await db.from('approvals').select(APPROVAL_COLUMNS).eq('id', approvalId).eq('plan_id', planId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Approval | null) ?? null
}

function cancellationResponse(approval: Approval, action: AgentAction) {
  const ui = deriveApprovalUiState({
    approvalStatus: approval.status,
    actionStatus: action.status,
    expiresAt: approval.expires_at,
  })
  return NextResponse.json({
    approval,
    actionStatus: action.status,
    actionResult: action.result_metadata as Json | null,
    uiStatus: ui.status,
    availableActions: [...ui.availableActions],
    message: 'Execution cancelled. The authorization remains in the audit history.',
  })
}
