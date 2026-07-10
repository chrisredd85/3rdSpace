export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { deriveApprovalUiState } from '@/lib/planner/approvalUiState'
import {
  APPROVAL_SNAPSHOT_SCHEMA_VERSION,
  buildApprovalSnapshotHashV2,
} from '@/lib/planner/execution/reapproval'
import {
  executeApprovedGmailOutreach,
  GmailDispatchRecoveryPendingError,
  isGmailApprovedOutreachAction,
} from '@/lib/outreach/gmailApprovalFlow'
import { getRequestLogger } from '@/lib/server/logger'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { AgentAction, Approval, Json, Plan } from '@/lib/types'

type PlannerDb = {
  from: (table: string) => any
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown
    error: { message?: string; code?: string } | null
  }>
}

type VersionedApproval = Approval & {
  snapshot_json?: Json | null
  snapshot_schema_version?: number | null
}

type RetryableAgentAction = AgentAction & {
  last_retry_status?: string | null
  last_retry_result?: Json | null
  last_retry_started_at?: string | null
}

const idempotencyKeySchema = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/)
const retryBodySchema = z.object({
  expectedSnapshotHash: z.string().trim().regex(/^[a-f0-9]{64}$/i),
}).strict()

const PLAN_SELECT_COLUMNS = `
  id,user_id,title,event_type,status,guest_count,budget_cap_cents,neighborhood,
  date_window_start,date_window_end,ticketed,ticketing_model,food_responsibility,
  venue_terms,agent_action,profit_goal_cents,notes,metadata,created_at,updated_at
`
const APPROVAL_SELECT_COLUMNS = `
  id,plan_id,agent_action_id,action_label,provider,event_date,price_cents,fees_cents,
  refund_terms,cancellation_terms,package_details,delivery_email,payment_method_id,status,
  requested_amount_cents,authorized_amount_cents,authorized_by,authorized_at,approved_by,
  approved_at,expires_at,snapshot_hash,notes,root_approval_id,version_number,
  supersedes_approval_id,superseded_by_approval_id,version_created_by,version_reason,
  snapshot_json,snapshot_schema_version,superseded_at,superseded_by_revision_id,
  superseded_reason,created_at,updated_at
`
const ACTION_SELECT_COLUMNS = `
  id,plan_id,action_type,description,provider,target_type,target_id,payload_json,amount_cents,
  currency,status,approval_id,executed_at,result_metadata,last_retry_idempotency_key,
  last_retry_status,last_retry_started_at,last_retry_completed_at,last_retry_result,
  created_at,updated_at
`

interface RouteContext {
  params: Promise<{ planId: string; approvalId: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { planId, approvalId } = await context.params
  const logger = getRequestLogger(request).child({ plan_id: planId, approval_id: approvalId })
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    if (user.user_metadata?.user_type !== 'community_builder') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const key = idempotencyKeySchema.safeParse(request.headers.get('idempotency-key'))
    if (!key.success) {
      return NextResponse.json(
        { error: 'A valid Idempotency-Key header is required', code: 'idempotency_key_required' },
        { status: 400 }
      )
    }
    const body = retryBodySchema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json(
        { error: 'expectedSnapshotHash is required', code: 'approval_snapshot_required' },
        { status: 400 }
      )
    }

    const db = supabase as unknown as PlannerDb
    const [plan, approval] = await Promise.all([
      loadOwnedPlan(db, planId, user.id),
      loadApproval(db, planId, approvalId),
    ])
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    if (!approval) return NextResponse.json({ error: 'Approval not found' }, { status: 404 })
    const action = await loadAction(db, planId, approval.agent_action_id)
    if (!action) return NextResponse.json({ error: 'Linked approval action not found' }, { status: 409 })

    const actionAlreadyComplete = action.status === 'complete'
    if (!actionAlreadyComplete && approval.status !== 'authorized' && approval.status !== 'approved') {
      return NextResponse.json(
        { error: 'Only an authorized failed outreach action can be retried', code: 'retry_not_allowed' },
        { status: 409 }
      )
    }
    if (!isGmailApprovedOutreachAction(action)) {
      return NextResponse.json(
        { error: 'Only failed Gmail outreach can be retried here', code: 'retry_not_allowed' },
        { status: 409 }
      )
    }

    const freshHash = buildApprovalSnapshotHashV2({
      plan,
      approval,
      action,
      payload: readRecord(action.payload_json),
    })
    if (
      !approval.snapshot_hash ||
      approval.snapshot_schema_version !== APPROVAL_SNAPSHOT_SCHEMA_VERSION ||
      body.data.expectedSnapshotHash !== approval.snapshot_hash ||
      (!actionAlreadyComplete && approval.snapshot_hash !== freshHash)
    ) {
      return NextResponse.json(
        { error: 'Approval details changed. Review and authorize a current version before retrying.', code: 'approval_snapshot_mismatch' },
        { status: 409 }
      )
    }

    const writeDb = createServiceRoleClient() as unknown as PlannerDb
    if (!writeDb.rpc) return NextResponse.json({ error: 'Retry control is unavailable' }, { status: 500 })
    const claim = await writeDb.rpc('claim_failed_action_retry', {
      p_plan_id: planId,
      p_action_id: action.id,
      p_approval_id: approval.id,
      p_expected_snapshot_hash: approval.snapshot_hash,
      p_idempotency_key: key.data,
      p_actor_id: user.id,
    })
    if (claim.error) {
      logger.error('Approval retry claim failed', claim.error)
      const conflict = ['40001', '23514', 'P0001', 'P0002'].includes(claim.error.code ?? '')
      const invalid = claim.error.code === '22023'
      return NextResponse.json(
        {
          error: invalid ? 'Retry request is invalid' : 'Failed to claim retry',
          code: invalid ? 'retry_request_invalid' : 'retry_claim_failed',
        },
        { status: conflict ? 409 : invalid ? 400 : 500 }
      )
    }

    const claimed = readRpcRow(claim.data)
    const outcome = readString(claimed?.outcome)
    if (outcome === 'prior_success') {
      return NextResponse.json(await buildResponse(writeDb, approval))
    }
    if (outcome === 'in_progress') {
      return NextResponse.json(
        { ...(await buildResponse(writeDb, approval)), message: 'This retry is already in progress.', code: 'retry_in_progress' },
        { status: 202 }
      )
    }
    if (outcome === 'prior_failure') {
      return NextResponse.json(
        { ...(await buildResponse(writeDb, approval)), error: 'This retry key already completed with a failure.', code: 'retry_prior_failure' },
        { status: 409 }
      )
    }
    if (outcome !== 'claimed') {
      return NextResponse.json({ error: 'Retry was not claimed', code: 'retry_claim_failed' }, { status: 409 })
    }

    let execution: Awaited<ReturnType<typeof executeApprovedGmailOutreach>>
    try {
      execution = await executeApprovedGmailOutreach(db, {
        userId: user.id,
        plan,
        action,
        approval,
      })
    } catch (executionError) {
      if (executionError instanceof GmailDispatchRecoveryPendingError) {
        const recovery = {
          error: executionError.message,
          retryable: true,
          recovery_pending: true,
        }
        await syncApprovalMessageResult(db, writeDb, planId, approval.id, 'executing', recovery)
        return NextResponse.json(
          {
            ...(await buildResponse(writeDb, approval)),
            message: executionError.message,
            code: 'retry_reconciliation_pending',
          },
          { status: 202 }
        )
      }

      const result = {
        error: executionError instanceof Error ? executionError.message : 'Unknown outreach retry error',
        retryable: true,
      }
      const finalized = await writeDb.rpc('finalize_failed_action_retry', {
        p_plan_id: planId,
        p_action_id: action.id,
        p_idempotency_key: key.data,
        p_outcome: 'failed',
        p_result: result,
        p_actor_id: user.id,
      })
      if (finalized.error) {
        logger.error('Approval retry failure finalization is pending', finalized.error)
        const pending = {
          ...result,
          recovery_pending: true,
        }
        await syncApprovalMessageResult(db, writeDb, planId, approval.id, 'executing', pending)
        return NextResponse.json(
          {
            ...(await buildResponse(writeDb, approval)),
            message: 'The provider attempt failed; local retry finalization is still pending.',
            code: 'retry_failure_finalize_pending',
          },
          { status: 202 }
        )
      }
      await syncApprovalMessageResult(db, writeDb, planId, approval.id, 'failed', result)
      return NextResponse.json(
        { ...(await buildResponse(writeDb, approval)), ...result, code: 'approval_retry_failed' },
        { status: 502 }
      )
    }

    const finalized = await writeDb.rpc('finalize_failed_action_retry', {
      p_plan_id: planId,
      p_action_id: action.id,
      p_idempotency_key: key.data,
      p_outcome: 'succeeded',
      p_result: execution,
      p_actor_id: user.id,
    })
    if (finalized.error) {
      logger.error('Approval retry success finalization is pending', finalized.error)
      const pending = {
        result: execution,
        retryable: true,
        recovery_pending: true,
      }
      await syncApprovalMessageResult(db, writeDb, planId, approval.id, 'executing', pending)
      return NextResponse.json(
        {
          ...(await buildResponse(writeDb, approval)),
          message: 'Gmail completed the side effect; local retry finalization is still pending.',
          code: 'retry_finalize_pending',
        },
        { status: 202 }
      )
    }
    await syncApprovalMessageResult(db, writeDb, planId, approval.id, 'complete', execution)
    return NextResponse.json(await buildResponse(writeDb, approval))
  } catch (error) {
    logger.error('Planner approval retry failed', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

async function loadOwnedPlan(db: PlannerDb, planId: string, userId: string): Promise<Plan | null> {
  const { data, error } = await db.from('plans').select(PLAN_SELECT_COLUMNS).eq('id', planId).eq('user_id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Plan | null) ?? null
}

async function loadApproval(db: PlannerDb, planId: string, approvalId: string): Promise<VersionedApproval | null> {
  const { data, error } = await db.from('approvals').select(APPROVAL_SELECT_COLUMNS).eq('id', approvalId).eq('plan_id', planId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as VersionedApproval | null) ?? null
}

async function loadAction(db: PlannerDb, planId: string, actionId: string): Promise<RetryableAgentAction | null> {
  const { data, error } = await db.from('agent_actions').select(ACTION_SELECT_COLUMNS).eq('id', actionId).eq('plan_id', planId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as RetryableAgentAction | null) ?? null
}

async function buildResponse(db: PlannerDb, approval: VersionedApproval) {
  const action = await loadAction(db, approval.plan_id, approval.agent_action_id)
  const ui = deriveApprovalUiState({
    approvalStatus: approval.status,
    actionStatus: action?.status ?? null,
    expiresAt: approval.expires_at,
    supersededAt: approval.superseded_at,
  })
  return {
    approval,
    actionStatus: action?.status ?? 'unknown',
    actionResult: action?.last_retry_result ?? action?.result_metadata ?? null,
    confirmationSnapshot: approval.snapshot_json ?? null,
    uiStatus: ui.status,
    availableActions: [...ui.availableActions],
  }
}

async function syncApprovalMessageResult(
  readDb: PlannerDb,
  writeDb: PlannerDb,
  planId: string,
  approvalId: string,
  actionStatus: string,
  result: unknown
) {
  const { data, error } = await readDb
    .from('plan_messages')
    .select('id,metadata')
    .eq('plan_id', planId)
    .eq('message_type', 'approval_request')
  if (error) return
  await Promise.all((Array.isArray(data) ? data : []).map(async (row) => {
    const metadata = readRecord(row.metadata)
    if (readString(readRecord(metadata?.approval)?.id) !== approvalId) return
    await writeDb.from('plan_messages').update({
      metadata: {
        ...metadata,
        action_status: actionStatus,
        action_result: result,
      } as Json,
    }).eq('id', row.id)
  }))
}

function readRpcRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return readRecord(value[0])
  return readRecord(value)
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
