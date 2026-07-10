export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  completeExternalCheckoutHandoff,
  readExternalCheckoutHandoffEvidence,
} from '@/lib/planner/execution/externalCheckout'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { AgentAction, Approval, Json, Plan, PlanMessage } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }

const paramsSchema = z.object({
  planId: z.string().uuid(),
  actionId: z.string().uuid(),
}).strict()

const confirmSchema = z.object({
  approvalId: z.string().uuid(),
  expectedSnapshotHash: z.string().trim().regex(/^[a-f0-9]{64}$/i),
  outcome: z.literal('completed'),
}).strict()

const ACTION_SELECT_COLUMNS = `
  id,plan_id,action_type,description,provider,target_type,target_id,payload_json,
  amount_cents,currency,status,approval_id,executed_at,result_metadata,created_at,updated_at
`

const APPROVAL_SELECT_COLUMNS = `
  id,plan_id,agent_action_id,status,snapshot_hash,snapshot_schema_version,expires_at
`

interface RouteContext {
  params: Promise<{ planId: string; actionId: string }>
}

/**
 * Records the host's confirmation that an approved external checkout completed.
 * The route never opens the link, calls its provider, or initiates payment.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const params = paramsSchema.safeParse(await context.params)
    if (!params.success) return NextResponse.json({ error: 'Invalid plan or action id' }, { status: 400 })

    const body = confirmSchema.safeParse(await request.json())
    if (!body.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: body.error.flatten() as Json },
        { status: 400 }
      )
    }

    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    if (user.user_metadata?.user_type !== 'community_builder') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const readDb = supabase as unknown as PlannerDb
    const plan = await loadOwnedPlan(readDb, params.data.planId, user.id)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const [action, approval] = await Promise.all([
      loadAction(readDb, params.data.planId, params.data.actionId),
      loadApproval(readDb, params.data.planId, body.data.approvalId),
    ])
    if (!action) return NextResponse.json({ error: 'Agent action not found' }, { status: 404 })
    if (!approval) return NextResponse.json({ error: 'Approval not found' }, { status: 404 })

    const contractError = validateConfirmationContract({
      action,
      approval,
      expectedSnapshotHash: body.data.expectedSnapshotHash,
    })
    if (contractError) return contractError

    const existingEvidence = readExternalCheckoutHandoffEvidence(action.result_metadata)
    if (!existingEvidence) {
      return NextResponse.json(
        { error: 'External checkout is not ready for completion confirmation' },
        { status: 409 }
      )
    }
    if (
      existingEvidence.approval_id !== approval.id ||
      existingEvidence.snapshot_hash !== body.data.expectedSnapshotHash
    ) {
      return NextResponse.json(
        { error: 'Checkout evidence does not match the approved snapshot' },
        { status: 409 }
      )
    }

    if (action.status === 'complete' && existingEvidence.status === 'completed') {
      return confirmationResponse(action, null)
    }
    if (action.status !== 'executing' || existingEvidence.status !== 'ready') {
      return NextResponse.json(
        { error: 'Only a ready external checkout can be confirmed complete' },
        { status: 409 }
      )
    }

    const completed = completeExternalCheckoutHandoff({
      resultMetadata: action.result_metadata,
      confirmedBy: user.id,
    })
    const writeDb = createServiceRoleClient() as unknown as PlannerDb
    const { data: updatedData, error: updateError } = await writeDb
      .from('agent_actions')
      .update({
        status: 'complete',
        executed_at: completed.evidence.completed_at,
        result_metadata: completed.resultMetadata,
      })
      .eq('id', action.id)
      .eq('plan_id', plan.id)
      .eq('status', 'executing')
      .select(ACTION_SELECT_COLUMNS)
      .maybeSingle()

    if (updateError) throw new Error(updateError.message)
    if (!updatedData) {
      const racedAction = await loadAction(writeDb, plan.id, action.id)
      const racedEvidence = readExternalCheckoutHandoffEvidence(racedAction?.result_metadata)
      if (racedAction?.status === 'complete' && racedEvidence?.status === 'completed') {
        return confirmationResponse(racedAction, null)
      }
      return NextResponse.json(
        { error: 'Checkout confirmation was updated by another request' },
        { status: 409 }
      )
    }

    const updatedAction = updatedData as AgentAction
    await insertAuditLog(writeDb, updatedAction, user.id)
    const planMessage = await insertCompletionMessage(writeDb, plan.id, updatedAction, approval.id)
    return confirmationResponse(updatedAction, planMessage)
  } catch (error) {
    console.error('[planner.external-checkout.confirm] Failed to confirm checkout', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to confirm checkout completion' },
      { status: 500 }
    )
  }
}

function validateConfirmationContract(input: {
  action: AgentAction
  approval: Approval
  expectedSnapshotHash: string
}): NextResponse | null {
  if (input.action.action_type !== 'external_checkout') {
    return NextResponse.json({ error: 'Action is not an external checkout' }, { status: 409 })
  }
  if (
    input.action.approval_id !== input.approval.id ||
    input.approval.agent_action_id !== input.action.id
  ) {
    return NextResponse.json({ error: 'Approval does not match this action' }, { status: 409 })
  }
  if (input.approval.status !== 'authorized' && input.approval.status !== 'approved') {
    return NextResponse.json({ error: 'Approval is not authorized' }, { status: 409 })
  }
  if (
    input.approval.snapshot_schema_version !== 2 ||
    input.approval.snapshot_hash !== input.expectedSnapshotHash
  ) {
    return NextResponse.json(
      { error: 'Approval snapshot changed. Refresh before confirming completion.' },
      { status: 409 }
    )
  }
  return null
}

async function loadOwnedPlan(db: PlannerDb, planId: string, userId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select('id,user_id')
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as Plan | null
}

async function loadAction(db: PlannerDb, planId: string, actionId: string): Promise<AgentAction | null> {
  const { data, error } = await db
    .from('agent_actions')
    .select(ACTION_SELECT_COLUMNS)
    .eq('id', actionId)
    .eq('plan_id', planId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as AgentAction | null
}

async function loadApproval(db: PlannerDb, planId: string, approvalId: string): Promise<Approval | null> {
  const { data, error } = await db
    .from('approvals')
    .select(APPROVAL_SELECT_COLUMNS)
    .eq('id', approvalId)
    .eq('plan_id', planId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as Approval | null
}

async function insertAuditLog(db: PlannerDb, action: AgentAction, actorId: string) {
  const { error } = await db.from('agent_action_audit_log').insert({
    action_id: action.id,
    plan_id: action.plan_id,
    from_status: 'executing',
    to_status: 'complete',
    actor_id: actorId,
    actor_role: 'user',
    reason: 'external_checkout.host_confirmed',
    metadata: {
      approval_id: action.approval_id,
      confirmation_source: 'host',
    },
  })
  if (error) console.error('[planner.external-checkout.confirm] Audit insert failed', error)
}

async function insertCompletionMessage(
  db: PlannerDb,
  planId: string,
  action: AgentAction,
  approvalId: string
): Promise<PlanMessage | null> {
  const provider = action.provider?.trim() || 'the external provider'
  const { data, error } = await db.from('plan_messages').insert({
    plan_id: planId,
    role: 'agent',
    content: `You confirmed the external checkout with ${provider} was completed.`,
    message_type: 'status_update',
    metadata: {
      state: 'external_checkout_completed',
      action_status: 'complete',
      agent_action_id: action.id,
      approval_id: approvalId,
      action_result: action.result_metadata,
    } as Json,
  }).select('*').single()

  if (error) {
    console.error('[planner.external-checkout.confirm] Plan message insert failed', error)
    return null
  }
  return data as PlanMessage
}

function confirmationResponse(action: AgentAction, planMessage: PlanMessage | null) {
  return NextResponse.json({
    agentAction: action,
    actionStatus: action.status,
    actionResult: action.result_metadata,
    uiStatus: 'succeeded',
    availableActions: [],
    planMessage,
  })
}
