export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readExternalCheckoutHandoffEvidence } from '@/lib/planner/execution/externalCheckout'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { AgentAction, Approval, Json, Plan, PlanMessage } from '@/lib/types'

type PlannerDb = {
  from: (table: string) => any
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown
    error: { code?: string; message?: string; details?: string; hint?: string } | null
  }>
}

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

    const isExistingCompletion = action.status === 'complete' && existingEvidence.status === 'completed'
    const isReadyCompletion = action.status === 'executing' && existingEvidence.status === 'ready'
    if (!isExistingCompletion && !isReadyCompletion) {
      return NextResponse.json(
        { error: 'Only a ready external checkout can be confirmed complete' },
        { status: 409 }
      )
    }

    const writeDb = createServiceRoleClient() as unknown as PlannerDb
    if (!writeDb.rpc) {
      return NextResponse.json({ error: 'Checkout confirmation is unavailable' }, { status: 500 })
    }
    const { data, error } = await writeDb.rpc('confirm_external_checkout_handoff', {
      p_plan_id: plan.id,
      p_action_id: action.id,
      p_approval_id: approval.id,
      p_expected_snapshot_hash: body.data.expectedSnapshotHash,
      p_actor_id: user.id,
    })
    if (error) return mapConfirmationError(error)

    const command = readRecord(data)
    const updatedAction = readRecord(command?.agent_action) as unknown as AgentAction | null
    const planMessage = readRecord(command?.plan_message) as unknown as PlanMessage | null
    if (!updatedAction || updatedAction.id !== action.id || updatedAction.status !== 'complete') {
      throw new Error('Checkout confirmation returned incomplete action evidence')
    }
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

function mapConfirmationError(error: { code?: string; message?: string; details?: string; hint?: string }) {
  const text = [error.message, error.details, error.hint].filter(Boolean).join(' ')
  if (error.code === '42501' || /unauthorized|approval_mismatch/i.test(text)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  if (error.code === 'P0002' || /_not_found/i.test(text)) {
    return NextResponse.json({ error: 'Checkout handoff not found' }, { status: 404 })
  }
  if (error.code === '23514' || error.code === '40001' || /not_confirmable|_race/i.test(text)) {
    return NextResponse.json(
      { error: 'Checkout confirmation changed. Refresh and try again.' },
      { status: 409 }
    )
  }
  return NextResponse.json({ error: 'Unable to confirm checkout completion' }, { status: 500 })
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
