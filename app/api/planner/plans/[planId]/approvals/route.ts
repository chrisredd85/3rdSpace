/**
 * API route for reading and updating planner approval records.
 *
 * Approval creation now happens through the linked `agent-actions` route, so
 * PATCH is intentionally focused on authorizing, rejecting, or cancelling an
 * existing approval that belongs to the authenticated builder's plan.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'
import {
  createVenueOpportunityBrief,
  ensureVenueOpportunityInviteTokens,
} from '@/lib/planner/venueOpportunityBriefs'
import {
  createVendorOpportunityBrief,
  ensureVendorOpportunityInviteTokens,
} from '@/lib/planner/vendorOpportunityBriefs'
import {
  TERMINAL_ACTION_STATUSES,
  agentActionStatusForApprovalStatus,
  assertIntegerCents,
  isApprovalExecutable,
  transitionAgentActionStatus,
  transitionApprovalStatus,
  type AgentActionTransitionEvent,
} from '@/lib/planner/execution/approvalState'
import {
  executeApprovedAction as dispatchApprovedAction,
  type ApprovedActionExecutionKind,
} from '@/lib/planner/execution/executeApprovedAction'
import { executeExternalCheckoutHandoff } from '@/lib/planner/execution/externalCheckout'
import { deriveApprovalUiState } from '@/lib/planner/approvalUiState'
import {
  APPROVAL_SNAPSHOT_SCHEMA_VERSION,
  buildApprovalSnapshotHashV2,
  buildApprovalSnapshotV2,
} from '@/lib/planner/execution/reapproval'
import { executeApprovedGmailOutreach } from '@/lib/outreach/gmailApprovalFlow'
import { enqueueDraftsAfterVenueApproval } from '@/lib/planner/discoveryOutreachDrafts'
import {
  checkAuthorizationActionStripeGate,
  getStripeGateErrorMessage,
} from '@/lib/planner/stripeReadinessGate'
import {
  ensurePlannerEventAccess,
  PlannerProductAccessActivationError,
  PlannerProductAccessRequiredError,
  productAccessErrorResponse,
} from '@/lib/planner/productAccess'
import { getRequestLogger } from '@/lib/server/logger'
import { notifyEntityStripeSetup } from '@/lib/server/notifyEntityStripeSetup'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type {
  AgentAction,
  Approval,
  ApprovalStatus,
  Json,
  PlannerApiErrorResponse,
  PlannerApprovalsResponse,
  Plan,
} from '@/lib/types'

type PlannerDb = {
  from: (table: string) => any
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>
}
type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const approvalIdSchema = z.string().uuid()
const snapshotHashSchema = z.string().trim().regex(/^[a-f0-9]{64}$/i)
const centsSchema = z.number().int().nonnegative().refine(Number.isSafeInteger)
const eventDateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()

const patchApprovalCommandSchema = z.discriminatedUnion('command', [
  z.object({
    approvalId: approvalIdSchema,
    command: z.literal('edit'),
    expectedSnapshotHash: snapshotHashSchema,
    changes: z.object({
      requestedAmountCents: centsSchema,
      eventDate: eventDateSchema,
      notes: z.string().trim().max(4000).nullable(),
    }).strict(),
  }).strict(),
  z.object({
    approvalId: approvalIdSchema,
    command: z.literal('authorize'),
    expectedSnapshotHash: snapshotHashSchema,
  }).strict(),
  z.object({
    approvalId: approvalIdSchema,
    command: z.literal('request_reapproval'),
    expectedSnapshotHash: snapshotHashSchema.nullable(),
  }).strict(),
  z.object({
    approvalId: approvalIdSchema,
    command: z.literal('cancel'),
  }).strict(),
])

const legacyTerminalApprovalCommandSchema = z.object({
  approvalId: approvalIdSchema,
  action: z.enum(['reject', 'cancel']),
}).strict()

type PatchApprovalCommand = z.infer<typeof patchApprovalCommandSchema>

type VersionedApproval = Approval & {
  notes?: string | null
  root_approval_id?: string | null
  version_number?: number | null
  supersedes_approval_id?: string | null
  superseded_by_approval_id?: string | null
  version_created_by?: string | null
  version_reason?: string | null
  snapshot_json?: Json | null
  snapshot_schema_version?: number | null
}

type RetryableAgentAction = AgentAction & {
  last_retry_idempotency_key?: string | null
  last_retry_status?: string | null
  last_retry_started_at?: string | null
  last_retry_completed_at?: string | null
  last_retry_result?: Json | null
}

type ApprovalCommandResponse = {
  approval: VersionedApproval
  actionStatus: string
  actionResult: Json | null
  confirmationSnapshot: Json | null
  uiStatus: string
  availableActions: string[]
}

const PLAN_SELECT_COLUMNS = `
  id,
  user_id,
  title,
  event_type,
  status,
  guest_count,
  budget_cap_cents,
  neighborhood,
  date_window_start,
  date_window_end,
  ticketed,
  ticketing_model,
  food_responsibility,
  venue_terms,
  agent_action,
  profit_goal_cents,
  notes,
  metadata,
  created_at,
  updated_at
`

const APPROVAL_SELECT_COLUMNS = `
  id,
  plan_id,
  agent_action_id,
  action_label,
  provider,
  event_date,
  price_cents,
  fees_cents,
  refund_terms,
  cancellation_terms,
  package_details,
  delivery_email,
  payment_method_id,
  status,
  requested_amount_cents,
  authorized_amount_cents,
  authorized_by,
  authorized_at,
  approved_by,
  approved_at,
  expires_at,
  snapshot_hash,
  notes,
  root_approval_id,
  version_number,
  supersedes_approval_id,
  superseded_by_approval_id,
  version_created_by,
  version_reason,
  snapshot_json,
  snapshot_schema_version,
  superseded_at,
  superseded_by_revision_id,
  superseded_reason,
  created_at,
  updated_at
`

const AGENT_ACTION_STATUS_SELECT_COLUMNS = `
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
  last_retry_idempotency_key,
  last_retry_status,
  last_retry_started_at,
  last_retry_completed_at,
  last_retry_result,
  created_at,
  updated_at
`

const AGENT_ACTION_OPPORTUNITY_SELECT_COLUMNS = 'id, action_type, payload_json, result_metadata'

const PLAN_MESSAGE_METADATA_SELECT_COLUMNS = 'id, metadata'

interface RouteContext {
  params: Promise<{
    planId: string
  }>
}

/**
 * Returns pending approvals for the authenticated builder's plan.
 *
 * @param request - Authenticated builder request.
 * @param context - Route params containing the planner plan id.
 * @returns Pending approvals for the plan.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<PlannerApprovalsResponse | PlannerApiErrorResponse>> {
  const logger = getRequestLogger(request).child({ plan_id: (await context.params).planId })
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, (await context.params).planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const approvals = await loadCurrentApprovalsForPlan(auth.db, plan.id)

    return NextResponse.json({ approvals })
  } catch (error) {
    logger.error('Planner approvals GET failed', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

/**
 * Authorizes, rejects, or cancels a planner approval.
 *
 * @param request - Authenticated builder request containing approval action.
 * @param context - Route params containing the planner plan id.
 * @returns Updated approval row.
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<ApprovalCommandResponse | PlannerApiErrorResponse>> {
  const planId = (await context.params).planId
  const logger = getRequestLogger(request).child({ plan_id: planId })
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const rawBody: unknown = await request.json()
    const parsed = patchApprovalCommandSchema.safeParse(rawBody)
    const legacyParsed = parsed.success ? null : legacyTerminalApprovalCommandSchema.safeParse(rawBody)
    if (!parsed.success && !legacyParsed?.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }
    const legacyCommand = legacyParsed?.success
      ? {
        approvalId: legacyParsed.data.approvalId,
        command: legacyParsed.data.action === 'reject' ? 'reject' as const : 'cancel' as const,
      }
      : null
    const command: PatchApprovalCommand | { approvalId: string; command: 'reject' | 'cancel' } = parsed.success
      ? parsed.data
      : legacyCommand!

    let plan = await loadOwnedPlan(auth.db, planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const existingApproval = await loadApproval(auth.db, planId, command.approvalId) as VersionedApproval | null
    if (!existingApproval) return NextResponse.json({ error: 'Approval not found' }, { status: 404 })

    if (existingApproval.status === 'superseded' || existingApproval.superseded_at) {
      return NextResponse.json(
        {
          error: buildSupersededApprovalMessage(existingApproval),
          code: 'approval_superseded',
        },
        { status: 409 }
      )
    }

    const linkedAction = await loadAgentAction(auth.db, existingApproval.agent_action_id) as RetryableAgentAction | null
    if (!linkedAction || linkedAction.plan_id !== planId) {
      return NextResponse.json({ error: 'Linked approval action not found' }, { status: 409 })
    }

    if (command.command === 'edit' || command.command === 'request_reapproval') {
      const snapshotConflict = command.command === 'request_reapproval'
        ? validateReapprovalVersion(existingApproval, command.expectedSnapshotHash)
        : validateExpectedSnapshot({
          plan,
          approval: existingApproval,
          action: linkedAction,
          expectedSnapshotHash: command.expectedSnapshotHash,
        })
      if (snapshotConflict) {
        if (snapshotConflict.persistedSnapshotIsStale) {
          await markApprovalReapprovalRequired(auth.db, planId, existingApproval)
        }
        return snapshotConflict.response
      }

      const writeDb = createServiceRoleClient() as unknown as PlannerDb
      const replacement = await supersedeApprovalVersion(writeDb, {
        plan,
        approval: existingApproval,
        action: linkedAction,
        actorId: auth.userId,
        expectedSnapshotHash: command.command === 'request_reapproval'
          ? existingApproval.snapshot_hash ?? 'legacy-missing'
          : command.expectedSnapshotHash,
        changes: command.command === 'edit' ? command.changes : null,
        reason: command.command === 'edit' ? 'host_edit' : 'host_requested_reapproval',
      })
      if ('response' in replacement) return replacement.response

      const superseded = await loadApproval(writeDb, planId, existingApproval.id) as VersionedApproval | null
      if (superseded) await syncApprovalMessageMetadata(auth.db, writeDb, planId, superseded)
      await insertSupersedingApprovalMessage(auth.db, writeDb, {
        planId,
        oldApprovalId: existingApproval.id,
        approval: replacement.approval,
      })
      return NextResponse.json(await buildApprovalCommandResponse(writeDb, replacement.approval))
    }

    if (command.command === 'authorize') {
      const snapshotConflict = validateExpectedSnapshot({
        plan,
        approval: existingApproval,
        action: linkedAction,
        expectedSnapshotHash: command.expectedSnapshotHash,
      })
      if (snapshotConflict) {
        if (snapshotConflict.persistedSnapshotIsStale) {
          await markApprovalReapprovalRequired(auth.db, planId, existingApproval)
        }
        return snapshotConflict.response
      }
    }

    const decision = command.command === 'reject' ? 'reject' : command.command
    const approvalTransition = transitionApprovalStatus(existingApproval.status, decision)
    if (!approvalTransition.ok) {
      return NextResponse.json({ error: approvalTransition.reason }, { status: 409 })
    }

    if (!approvalTransition.changed) {
      return NextResponse.json(await buildApprovalCommandResponse(auth.db, existingApproval))
    }

    const writeDb = createServiceRoleClient() as unknown as PlannerDb

    if (command.command === 'authorize') {
      const stripeGate = await checkApprovalStripeGate({
        db: writeDb,
        approval: existingApproval,
        planId,
        organizerId: auth.userId,
      })
      if (stripeGate) return stripeGate
    }

    const updates = buildApprovalUpdates(
      approvalTransition.to,
      auth.userId,
      command.command === 'authorize' ? existingApproval.requested_amount_cents : undefined
    )
    const { data, error } = await writeDb
      .from('approvals')
      .update(updates)
      .eq('id', command.approvalId)
      .eq('plan_id', planId)
      .eq('status', existingApproval.status)
      .select(APPROVAL_SELECT_COLUMNS)
      .maybeSingle()

    if (error) {
      logger.error('Planner approval update failed', error, {
        user_id: auth.userId,
        approval_id: command.approvalId,
        previous_status: existingApproval.status,
        attempted_status: approvalTransition.to,
      })
      return NextResponse.json({ error: 'Failed to update approval' }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json(
        {
          error: 'Approval was updated by another request. Refresh and try again.',
          code: 'approval_stale',
        },
        { status: 409 }
      )
    }

    const approval = data as VersionedApproval
    if (command.command === 'authorize') {
      try {
        plan = await ensurePlannerEventAccess({
          plan,
          userId: auth.userId,
          reason: 'approval',
        })
      } catch (accessError) {
        await rollbackApprovalAfterAccessFailure(auth.db, writeDb, {
          planId,
          approval,
          originalStatus: existingApproval.status,
          actorId: auth.userId,
        })
        if (accessError instanceof PlannerProductAccessRequiredError) {
          return NextResponse.json(productAccessErrorResponse(accessError), { status: accessError.status })
        }
        if (accessError instanceof PlannerProductAccessActivationError) {
          return NextResponse.json({ error: accessError.message }, { status: accessError.status })
        }
        return NextResponse.json({ error: 'Failed to activate planner access' }, { status: 500 })
      }
    }

    await syncAgentActionStatusForApproval(auth.db, writeDb, {
      actionId: approval.agent_action_id,
      planId,
      actorId: auth.userId,
      approvalStatus: approval.status,
    })
    if (isApprovalExecutable(approval.status)) {
      try {
        await executeApprovedAction(auth.db, writeDb, {
          actionId: approval.agent_action_id,
          planId,
          actorId: auth.userId,
          plan,
          approval,
        })
      } catch (executionError) {
        await syncApprovalMessageMetadata(auth.db, writeDb, planId, approval)
        const failedResponse = await buildApprovalCommandResponse(writeDb, approval)
        logger.error('Planner approval execution failed', executionError, {
          approval_id: approval.id,
          action_id: approval.agent_action_id,
        })
        return NextResponse.json(
          {
            ...failedResponse,
            error: executionError instanceof Error ? executionError.message : 'Approved action failed',
            code: 'approval_execution_failed',
            retryable: failedResponse.availableActions.includes('retry'),
          } as ApprovalCommandResponse & PlannerApiErrorResponse,
          { status: 502 }
        )
      }
    } else if (approval.status === 'cancelled' || approval.status === 'rejected') {
      await syncOpportunityInviteStatuses(auth.db, writeDb, plan, auth.userId, approval)
    }
    await syncApprovalMessageMetadata(auth.db, writeDb, planId, approval)

    return NextResponse.json(await buildApprovalCommandResponse(writeDb, approval))
  } catch (error) {
    logger.error('Planner approvals PATCH failed', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
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

async function loadOwnedPlan(db: PlannerDb, planId: string, userId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('Planner approval plan lookup error:', error)
    return null
  }

  return (data as Plan | null) ?? null
}

async function loadApproval(db: PlannerDb, planId: string, approvalId: string): Promise<Approval | null> {
  const { data, error } = await db
    .from('approvals')
    .select(APPROVAL_SELECT_COLUMNS)
    .eq('id', approvalId)
    .eq('plan_id', planId)
    .maybeSingle()

  if (error) {
    console.error('Planner approval lookup error:', error)
    return null
  }

  return (data as Approval | null) ?? null
}

async function loadCurrentApprovalsForPlan(db: PlannerDb, planId: string): Promise<VersionedApproval[]> {
  const { data, error } = await db
    .from('approvals')
    .select(APPROVAL_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .in('status', ['pending', 'expired', 're_approval_required', 'authorized', 'approved'])
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (Array.isArray(data) ? data : []) as VersionedApproval[]
}

function validateExpectedSnapshot(input: {
  plan: Plan
  approval: VersionedApproval
  action: RetryableAgentAction
  expectedSnapshotHash: string
}): {
  response: NextResponse<PlannerApiErrorResponse>
  persistedSnapshotIsStale: boolean
} | null {
  const storedSnapshotHash = readString(input.approval.snapshot_hash)
  const freshSnapshotHash = buildApprovalSnapshotHashV2({
    plan: input.plan,
    approval: input.approval,
    action: input.action,
    payload: readRecord(input.action.payload_json),
  })

  if (
    !storedSnapshotHash ||
    input.approval.snapshot_schema_version !== APPROVAL_SNAPSHOT_SCHEMA_VERSION ||
    input.expectedSnapshotHash !== storedSnapshotHash ||
    storedSnapshotHash !== freshSnapshotHash
  ) {
    return {
      response: NextResponse.json(
        {
          error: 'This approval changed after it was displayed. Refresh and review the current version before continuing.',
          code: 'approval_snapshot_mismatch',
          details: {
            expected_snapshot_hash: input.expectedSnapshotHash,
            current_snapshot_hash: storedSnapshotHash,
            snapshot_schema_version: input.approval.snapshot_schema_version ?? null,
          } as Json,
        },
        { status: 409 }
      ),
      persistedSnapshotIsStale: Boolean(
        storedSnapshotHash &&
        input.approval.snapshot_schema_version === APPROVAL_SNAPSHOT_SCHEMA_VERSION &&
        input.expectedSnapshotHash === storedSnapshotHash &&
        storedSnapshotHash !== freshSnapshotHash
      ),
    }
  }

  return null
}

function validateReapprovalVersion(
  approval: VersionedApproval,
  expectedSnapshotHash: string | null
): {
  response: NextResponse<PlannerApiErrorResponse>
  persistedSnapshotIsStale: false
} | null {
  if ((approval.snapshot_hash ?? null) === expectedSnapshotHash) return null
  return {
    response: NextResponse.json(
      {
        error: 'This approval changed after it was displayed. Refresh before requesting a new version.',
        code: 'approval_snapshot_mismatch',
      },
      { status: 409 }
    ),
    persistedSnapshotIsStale: false,
  }
}

async function markApprovalReapprovalRequired(
  readDb: PlannerDb,
  planId: string,
  approval: VersionedApproval
) {
  if (approval.status === 're_approval_required') return
  const writeDb = createServiceRoleClient() as unknown as PlannerDb
  const { data, error } = await writeDb
    .from('approvals')
    .update({ status: 're_approval_required' })
    .eq('id', approval.id)
    .eq('plan_id', planId)
    .eq('status', approval.status)
    .select(APPROVAL_SELECT_COLUMNS)
    .maybeSingle()
  if (error || !data) return
  await syncApprovalMessageMetadata(readDb, writeDb, planId, data as VersionedApproval)
}

async function supersedeApprovalVersion(
  db: PlannerDb,
  input: {
    plan: Plan
    approval: VersionedApproval
    action: RetryableAgentAction
    actorId: string
    expectedSnapshotHash: string
    changes: { requestedAmountCents: number; eventDate: string | null; notes: string | null } | null
    reason: string
  }
): Promise<
  | { approval: VersionedApproval }
  | { response: NextResponse<PlannerApiErrorResponse> }
> {
  if (!db.rpc) {
    return { response: NextResponse.json({ error: 'Approval versioning is unavailable' }, { status: 500 }) }
  }

  const requestedAmountCents = input.changes
    ? assertIntegerCents(input.changes.requestedAmountCents, 'requestedAmountCents')
    : assertIntegerCents(input.approval.requested_amount_cents ?? 0, 'requestedAmountCents')
  const eventDate = input.changes ? input.changes.eventDate : input.approval.event_date
  const notes = input.changes ? input.changes.notes : input.approval.notes ?? null
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const currentPayload = readRecord(input.action.payload_json) ?? {}
  const actionPayload = {
    ...currentPayload,
    requestedAmountCents,
    requested_amount_cents: requestedAmountCents,
    event_date: eventDate,
    notes,
    expires_at: expiresAt,
  }
  const nextApproval = {
    ...input.approval,
    requested_amount_cents: requestedAmountCents,
    event_date: eventDate,
    notes,
    expires_at: expiresAt,
    status: 'pending' as const,
    authorized_amount_cents: null,
    authorized_by: null,
    authorized_at: null,
    approved_by: null,
    approved_at: null,
  }
  const nextAction = {
    ...input.action,
    amount_cents: requestedAmountCents,
    payload_json: actionPayload as Json,
    status: 'pending' as const,
  }
  const snapshotJson = buildApprovalSnapshotV2({
    plan: input.plan,
    approval: nextApproval,
    action: nextAction,
    payload: actionPayload,
  })
  const snapshotHash = buildApprovalSnapshotHashV2({
    plan: input.plan,
    approval: nextApproval,
    action: nextAction,
    payload: actionPayload,
  })
  const { data, error } = await db.rpc('supersede_approval_version', {
    p_plan_id: input.plan.id,
    p_approval_id: input.approval.id,
    p_expected_snapshot_hash: input.expectedSnapshotHash,
    p_actor_id: input.actorId,
    p_requested_amount_cents: requestedAmountCents,
    p_event_date: eventDate,
    p_notes: notes,
    p_expires_at: expiresAt,
    p_action_payload_json: actionPayload,
    p_snapshot_json: snapshotJson,
    p_snapshot_hash: snapshotHash,
    p_reason: input.reason,
  })

  if (error || !data) {
    const conflict = error?.code === 'P0001' || /snapshot|supersed|active approval/i.test(error?.message ?? '')
    return {
      response: NextResponse.json(
        {
          error: conflict
            ? 'This approval changed after it was displayed. Refresh and review the current version.'
            : 'Failed to create a new approval version',
          code: conflict ? 'approval_snapshot_mismatch' : 'approval_version_failed',
        },
        { status: conflict ? 409 : 500 }
      ),
    }
  }

  const approval = (Array.isArray(data) ? data[0] : data) as VersionedApproval | undefined
  if (!approval) {
    return { response: NextResponse.json({ error: 'Failed to create a new approval version' }, { status: 500 }) }
  }
  return { approval }
}

async function buildApprovalCommandResponse(
  db: PlannerDb,
  approval: VersionedApproval
): Promise<ApprovalCommandResponse> {
  const action = await loadAgentAction(db, approval.agent_action_id) as RetryableAgentAction | null
  const uiState = deriveApprovalUiState({
    approvalStatus: approval.status,
    actionStatus: action?.status ?? null,
    expiresAt: approval.expires_at,
    supersededAt: approval.superseded_at,
  })
  return {
    approval,
    actionStatus: action?.status ?? 'unknown',
    actionResult: (action?.last_retry_result ?? action?.result_metadata ?? null) as Json | null,
    confirmationSnapshot: approval.snapshot_json ?? null,
    uiStatus: uiState.status,
    availableActions: [...uiState.availableActions],
  }
}

async function insertSupersedingApprovalMessage(
  readDb: PlannerDb,
  writeDb: PlannerDb,
  input: {
    planId: string
    oldApprovalId: string
    approval: VersionedApproval
  }
) {
  const { data, error } = await readDb
    .from('plan_messages')
    .select('id, content, metadata')
    .eq('plan_id', input.planId)
    .eq('message_type', 'approval_request')

  if (error) return
  const source = (Array.isArray(data) ? data : []).find((row) => {
    const metadata = readRecord(row.metadata)
    return readString(readRecord(metadata?.approval)?.id) === input.oldApprovalId
  })
  if (!source) return
  const metadata = readRecord(source.metadata) ?? {}
  const oldEmbeddedApproval = readRecord(metadata.approval) ?? {}
  const { error: insertError } = await writeDb.from('plan_messages').insert({
    plan_id: input.planId,
    role: 'agent',
    content: source.content,
    message_type: 'approval_request',
    metadata: {
      ...metadata,
      status: input.approval.status,
      supersedes_message_id: source.id,
      approval: {
        ...oldEmbeddedApproval,
        ...input.approval,
      },
    } as Json,
  })
  if (insertError) console.error('Planner superseding approval message insert error:', insertError)
}

function buildApprovalUpdates(
  status: ApprovalStatus,
  userId: string,
  authorizedAmountCents: number | null | undefined
) {
  if (status === 'authorized' || status === 'approved') {
    const authorizedAt = new Date().toISOString()
    return {
      status,
      authorized_by: userId,
      authorized_at: authorizedAt,
      authorized_amount_cents: authorizedAmountCents == null
        ? null
        : assertIntegerCents(authorizedAmountCents, 'authorizedAmountCents'),
      approved_by: userId,
      approved_at: authorizedAt,
    }
  }

  return { status }
}

function buildSupersededApprovalMessage(approval: Approval): string {
  const date = approval.superseded_at
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(approval.superseded_at))
    : 'a recent update'
  return `This approval was superseded by a plan update on ${date}. Please re-approve from the current recommendation.`
}

async function rollbackApprovalAfterAccessFailure(
  readDb: PlannerDb,
  writeDb: PlannerDb,
  input: {
    planId: string
    approval: Approval
    originalStatus: ApprovalStatus
    actorId: string
  }
) {
  const { data, error } = await writeDb
    .from('approvals')
    .update({
      status: input.originalStatus,
      authorized_by: null,
      authorized_at: null,
      authorized_amount_cents: null,
      approved_by: null,
      approved_at: null,
    })
    .eq('id', input.approval.id)
    .eq('plan_id', input.planId)
    .eq('status', input.approval.status)
    .select(APPROVAL_SELECT_COLUMNS)
    .maybeSingle()

  if (error || !data) {
    Sentry.captureMessage('approval_rollback_failed', {
      level: 'error',
      tags: {
        action: 'approval_rollback_failed',
        plan_id: input.planId,
        approval_id: input.approval.id,
        original_status: input.originalStatus,
        attempted_status: input.approval.status,
      },
      extra: {
        error: error?.message ?? 'Approval row no longer matched rollback predicate',
      },
    })
    return null
  }

  await markAgentActionAccessGateRollback(readDb, writeDb, {
    actionId: input.approval.agent_action_id,
    actorId: input.actorId,
    planId: input.planId,
    originalStatus: input.originalStatus,
    attemptedStatus: input.approval.status,
  })

  await syncApprovalMessageMetadata(readDb, writeDb, input.planId, data as Approval)
  return data as Approval
}

async function markAgentActionAccessGateRollback(
  readDb: PlannerDb,
  writeDb: PlannerDb,
  input: {
    actionId: string
    actorId: string
    planId: string
    originalStatus: ApprovalStatus
    attemptedStatus: ApprovalStatus
  }
) {
  const action = await loadAgentAction(readDb, input.actionId)
  if (!action) return

  const nextMetadata = {
    ...(readRecord(action.result_metadata) ?? {}),
    approval_access_gate_rollback: {
      action: 'approval_access_gate_rollback',
      approval_original_status: input.originalStatus,
      approval_attempted_status: input.attemptedStatus,
      rolled_back_at: new Date().toISOString(),
    },
  } as Json

  const { error } = await writeDb
    .from('agent_actions')
    .update({ result_metadata: nextMetadata })
    .eq('id', input.actionId)
    .eq('plan_id', input.planId)

  if (error) {
    Sentry.captureException(error, {
      tags: {
        action: 'approval_action_rollback_metadata_failed',
        plan_id: input.planId,
        action_id: input.actionId,
      },
      extra: {
        actor_id: input.actorId,
        original_status: input.originalStatus,
        attempted_status: input.attemptedStatus,
      },
    })
  }
}

async function syncAgentActionStatusForApproval(
  readDb: PlannerDb,
  writeDb: PlannerDb,
  payload: {
    actionId: string
    planId: string
    actorId: string
    approvalStatus: ApprovalStatus
  }
) {
  const action = await loadAgentAction(readDb, payload.actionId)
  if (!action) return

  const transition = agentActionStatusForApprovalStatus(payload.approvalStatus, action.status)
  if (!transition) return
  if (!transition.ok) {
    if (
      (payload.approvalStatus === 'cancelled' || payload.approvalStatus === 'rejected') &&
      TERMINAL_ACTION_STATUSES.some((terminalStatus) => terminalStatus === action.status)
    ) {
      console.info('[planner.approvals] Approval cancelled after linked action reached terminal state', {
        approvalStatus: payload.approvalStatus,
        actionId: action.id,
        actionStatus: action.status,
      })
      return
    }
    throw new Error(transition.reason)
  }
  if (!transition.changed) return

  await persistAgentActionTransition(writeDb, {
    action,
    planId: payload.planId,
    actorId: payload.actorId,
    reason: 'approval.status_changed',
    event: payload.approvalStatus === 'cancelled' || payload.approvalStatus === 'rejected'
      ? 'cancelled'
      : 'approval_granted',
    metadata: { approval_status: payload.approvalStatus },
  })
}

async function executeApprovedAction(
  readDb: PlannerDb,
  writeDb: PlannerDb,
  payload: {
    actionId: string
    planId: string
    actorId: string
    plan: Plan
    approval: Approval
  }
) {
  const action = await loadAgentAction(readDb, payload.actionId)
  if (!action) return

  await dispatchApprovedAction({
    action,
    approval: payload.approval,
    registry: {
      send_gmail_outreach: async () => runCompletingActionExecutor(readDb, writeDb, {
        action,
        planId: payload.planId,
        actorId: payload.actorId,
        executionKind: 'send_gmail_outreach',
        completionReason: 'approval.gmail_outreach_sent',
        execute: async (executingAction) => executeApprovedGmailOutreach(readDb, {
          userId: payload.actorId,
          plan: payload.plan,
          action: executingAction,
          approval: payload.approval,
        }),
      }),
      prepare_outreach_drafts: async () => runCompletingActionExecutor(readDb, writeDb, {
        action,
        planId: payload.planId,
        actorId: payload.actorId,
        executionKind: 'prepare_outreach_drafts',
        completionReason: 'approval.outreach_drafts_prepared',
        execute: async () => {
          const preparation = await syncOpportunityInviteStatuses(
            readDb,
            writeDb,
            payload.plan,
            payload.actorId,
            payload.approval
          )
          if (!preparation.prepared) {
            throw new Error(preparation.reason ?? 'Outreach drafts were not prepared')
          }
          return {
            outbound_message_sent: false,
            send_requires_explicit_flow: true,
            ...preparation,
          }
        },
      }),
      await_external_checkout: async () => runHandoffActionExecutor(writeDb, {
        action,
        planId: payload.planId,
        actorId: payload.actorId,
        executionKind: 'await_external_checkout',
        execute: async (executingAction) => executeExternalCheckoutHandoff({
          db: writeDb,
          action: executingAction,
          approval: payload.approval,
          plan: payload.plan,
          actorId: payload.actorId,
        }),
      }),
    },
  })
}

async function runHandoffActionExecutor(
  writeDb: PlannerDb,
  input: {
    action: AgentAction
    planId: string
    actorId: string
    executionKind: ApprovedActionExecutionKind
    execute: (executingAction: AgentAction) => Promise<{
      disposition: 'executing' | 'complete' | 'waiting'
      metadata: Json
    }>
  }
) {
  let action = input.action
  if (action.status === 'approved') {
    action = await persistAgentActionTransition(writeDb, {
      action,
      planId: input.planId,
      actorId: input.actorId,
      reason: 'approval.execution_started',
      event: 'execution_started',
      metadata: {
        execution_kind: input.executionKind,
        outbound_message_sent: false,
      },
    })
  } else if (action.status !== 'executing') {
    throw new Error(`Approved-action handoff cannot resume from ${action.status}`)
  }

  try {
    const result = await input.execute(action)
    if (result.disposition === 'complete') {
      await persistAgentActionTransition(writeDb, {
        action,
        planId: input.planId,
        actorId: input.actorId,
        reason: 'approval.handoff_completed',
        event: 'execution_completed',
        metadata: {
          execution_kind: input.executionKind,
          ...(readRecord(result.metadata) ?? {}),
        },
      })
    }
    return result
  } catch (error) {
    await persistAgentActionTransition(writeDb, {
      action,
      planId: input.planId,
      actorId: input.actorId,
      reason: 'approval.execution_failed',
      event: 'execution_failed',
      metadata: {
        execution_kind: input.executionKind,
        error: error instanceof Error ? error.message : 'Unknown execution error',
      },
    })
    throw error
  }
}

async function runCompletingActionExecutor(
  _readDb: PlannerDb,
  writeDb: PlannerDb,
  input: {
    action: AgentAction
    planId: string
    actorId: string
    executionKind: ApprovedActionExecutionKind
    completionReason: string
    execute: (executingAction: AgentAction) => Promise<Record<string, unknown>>
  }
) {
  let action = await persistAgentActionTransition(writeDb, {
    action: input.action,
    planId: input.planId,
    actorId: input.actorId,
    reason: 'approval.execution_started',
    event: 'execution_started',
    metadata: {
      execution_kind: input.executionKind,
      outbound_message_sent: false,
    },
  })

  try {
    const result = await input.execute(action)
    action = await persistAgentActionTransition(writeDb, {
      action,
      planId: input.planId,
      actorId: input.actorId,
      reason: input.completionReason,
      event: 'execution_completed',
      metadata: {
        execution_kind: input.executionKind,
        ...result,
      },
    })
    return result
  } catch (error) {
    await persistAgentActionTransition(writeDb, {
      action,
      planId: input.planId,
      actorId: input.actorId,
      reason: 'approval.execution_failed',
      event: 'execution_failed',
      metadata: {
        execution_kind: input.executionKind,
        error: error instanceof Error ? error.message : 'Unknown execution error',
      },
    })
    throw error
  }
}

async function loadAgentAction(db: PlannerDb, actionId: string): Promise<AgentAction | null> {
  const { data, error } = await db
    .from('agent_actions')
    .select(AGENT_ACTION_STATUS_SELECT_COLUMNS)
    .eq('id', actionId)
    .maybeSingle()

  if (error) {
    console.error('Planner agent action lookup error:', error)
    return null
  }

  return (data as AgentAction | null) ?? null
}

async function checkApprovalStripeGate(input: {
  db: PlannerDb
  approval: Approval
  planId: string
  organizerId: string
}): Promise<NextResponse<PlannerApiErrorResponse> | null> {
  const action = await loadAgentAction(input.db, input.approval.agent_action_id)
  if (!action) return null

  const gateResult = await checkAuthorizationActionStripeGate({
    supabase: input.db,
    actionType: action.action_type,
    targetType: action.target_type,
    targetId: action.target_id,
    amountCents: action.amount_cents,
    payload: action.payload_json,
    resultMetadata: action.result_metadata,
  })
  if (!gateResult || gateResult.gate.ready) return null

  if (gateResult.target.entityType === 'venue' || gateResult.target.entityType === 'vendor') {
    notifyEntityStripeSetup({
      supabase: input.db,
      entityType: gateResult.target.entityType,
      entityId: gateResult.target.entityId,
      planId: input.planId,
      organizerId: input.organizerId,
      reason: gateResult.gate.reason,
    }).catch((error) => {
      console.error('Planner approval Stripe setup notification failed:', error)
    })
  }

  return NextResponse.json(
    {
      error: getStripeGateErrorMessage({
        entityType: gateResult.target.entityType,
        reason: gateResult.gate.reason,
      }),
      details: {
        code: 'stripe_recipient_not_ready',
        stripe_gate: gateResult.gate,
        target: gateResult.target,
      } as Json,
    },
    { status: 409 }
  )
}

async function persistAgentActionTransition(
  db: PlannerDb,
  input: {
    action: AgentAction
    planId: string
    actorId: string
    reason: string
    event: AgentActionTransitionEvent
    metadata?: Record<string, unknown>
  }
): Promise<AgentAction> {
  const transition = transitionAgentActionStatus(input.action.status, input.event)
  if (!transition.ok) throw new Error(transition.reason)

  const nextMetadata = {
    ...(readRecord(input.action.result_metadata) ?? {}),
    ...(input.metadata ?? {}),
  } as Json
  const updates: Record<string, unknown> = {
    status: transition.to,
    result_metadata: nextMetadata,
  }
  if (transition.to === 'complete') {
    updates.executed_at = new Date().toISOString()
  }

  const { data, error } = await db
    .from('agent_actions')
    .update(updates)
    .eq('id', input.action.id)
    .select(AGENT_ACTION_STATUS_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    console.error('Planner agent action transition update error:', error)
    throw new Error(error?.message ?? 'Failed to update agent action status')
  }

  if (transition.changed) {
    await insertAgentActionAuditLog(db, {
      actionId: input.action.id,
      planId: input.planId,
      fromStatus: transition.from,
      toStatus: transition.to,
      actorId: input.actorId,
      reason: input.reason,
      metadata: input.metadata,
    })
  }

  return data as AgentAction
}

type OutreachPreparationSummary = {
  prepared: boolean
  reason?: string
  venue_invite_count?: number
  vendor_invite_count?: number
  gmail_draft_count?: number
  contact_extraction_pending_count?: number
  contact_email_required_count?: number
  opportunity_brief_id?: string | null
  vendor_opportunity_brief_id?: string | null
  discovery_outreach_results?: unknown[]
}

async function syncOpportunityInviteStatuses(
  readDb: PlannerDb,
  writeDb: PlannerDb,
  plan: Plan,
  userId: string,
  approval: Approval
): Promise<OutreachPreparationSummary> {
  const { data, error } = await readDb
    .from('agent_actions')
    .select(AGENT_ACTION_OPPORTUNITY_SELECT_COLUMNS)
    .eq('id', approval.agent_action_id)
    .maybeSingle()

  if (error || !data) {
    if (error) console.error('Planner opportunity action lookup error:', error)
    return { prepared: false, reason: 'action_not_found' }
  }

  const payload = data.payload_json
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { prepared: false, reason: 'missing_action_payload' }
  }

  const action = data as { id: string; action_type?: string | null; payload_json?: unknown; result_metadata?: unknown }
  const payloadRecord = payload as Record<string, unknown>
  const opportunityBriefId = readString(payloadRecord.opportunity_brief_id)

  if (isVenueOutreachAction(action)) {
    return syncVenueOpportunitySendApproval(readDb, writeDb, plan, userId, approval, payloadRecord, opportunityBriefId)
  }

  if (isVendorOutreachAction(action)) {
    return syncVendorOpportunitySendApproval(readDb, writeDb, plan, userId, approval, payloadRecord)
  }

  if (!opportunityBriefId) return { prepared: false, reason: 'not_outreach_action' }

  if (approval.status === 'authorized' || approval.status === 'approved') {
    const invites = await ensureVenueOpportunityInviteTokens(readDb, opportunityBriefId, writeDb)

    const { error: briefUpdateError } = await writeDb
      .from('venue_opportunity_briefs')
      .update({ status: 'approval_requested' })
      .eq('id', opportunityBriefId)
      .eq('plan_id', plan.id)

    if (briefUpdateError) {
      console.error('Planner opportunity brief authorized status update error:', briefUpdateError)
    }

    await insertOpportunityStatusMessage(writeDb, plan.id, {
      opportunity_brief_id: opportunityBriefId,
      approval_id: approval.id,
      status: 'drafts_prepared',
      content: `Prepared ${invites.length} outreach draft${invites.length === 1 ? '' : 's'} for review.`,
    })
    return {
      prepared: true,
      venue_invite_count: invites.length,
      opportunity_brief_id: opportunityBriefId,
    }
  }

  if (approval.status === 'cancelled' || approval.status === 'rejected') {
    const { error: inviteUpdateError } = await writeDb
      .from('venue_opportunity_invites')
      .update({ status: 'cancelled' })
      .eq('brief_id', opportunityBriefId)

    if (inviteUpdateError) {
      console.error('Planner opportunity invite cancelled status update error:', inviteUpdateError)
    }

    const { error: briefUpdateError } = await writeDb
      .from('venue_opportunity_briefs')
      .update({ status: 'cancelled' })
      .eq('id', opportunityBriefId)
      .eq('plan_id', plan.id)

    if (briefUpdateError) {
      console.error('Planner opportunity brief cancelled status update error:', briefUpdateError)
    }
  }

  return { prepared: false, reason: `approval_${approval.status}` }
}

async function syncVendorOpportunitySendApproval(
  readDb: PlannerDb,
  writeDb: PlannerDb,
  plan: Plan,
  userId: string,
  approval: Approval,
  payload: Record<string, unknown>
): Promise<OutreachPreparationSummary> {
  const vendorBriefId =
    readString(payload.vendor_opportunity_brief_id) ??
    (readString(payload.kind) === 'vendor_outreach' ? readString(payload.opportunity_brief_id) : null)

  if (approval.status === 'cancelled' || approval.status === 'rejected') {
    if (!vendorBriefId) return { prepared: false, reason: `approval_${approval.status}` }

    const { error: inviteUpdateError } = await writeDb
      .from('vendor_opportunity_invites')
      .update({ status: 'cancelled' })
      .eq('brief_id', vendorBriefId)

    if (inviteUpdateError) {
      console.error('Planner vendor opportunity cancel invite update error:', inviteUpdateError)
    }
    return { prepared: false, reason: `approval_${approval.status}` }
  }

  if (approval.status !== 'authorized' && approval.status !== 'approved') {
    return { prepared: false, reason: `approval_${approval.status}` }
  }

  if (vendorBriefId) {
    const invites = await ensureVendorOpportunityInviteTokens(readDb, vendorBriefId, writeDb)
    await updateActionPayload(writeDb, approval.agent_action_id, {
      ...payload,
      vendor_opportunity_brief_id: vendorBriefId,
      vendor_invite_ids: invites.map((invite) => invite.id),
      queued_vendor_invite_count: invites.length,
    })
    await insertOpportunityStatusMessage(writeDb, plan.id, {
      opportunity_brief_id: vendorBriefId,
      approval_id: approval.id,
      status: 'drafts_prepared',
      content: `Prepared ${invites.length} vendor outreach draft${invites.length === 1 ? '' : 's'} for review.`,
    })
    return {
      prepared: true,
      vendor_invite_count: invites.length,
      vendor_opportunity_brief_id: vendorBriefId,
    }
  }

  const vendorIds = readStringArray(payload.vendor_ids).filter(isUuid)
  if (vendorIds.length === 0) {
    console.error('Planner vendor opportunity send approval missing vendor_ids')
    return { prepared: false, reason: 'missing_vendor_ids' }
  }

  const result = await createVendorOpportunityBrief({
    db: readDb,
    writeDb,
    plan,
    userId,
    vendorIds,
    packageType: readString(payload.package_type) ?? 'vendor',
    summary: readString(payload.summary) ?? `${plan.title} vendor quote request`,
    requirements: readRecord(payload.requirements) ?? {},
    responseDeadline: readString(payload.response_deadline),
    quoteRequested: typeof payload.quote_requested === 'boolean' ? payload.quote_requested : true,
    issueTokens: true,
  })

  await updateActionPayload(writeDb, approval.agent_action_id, {
    ...payload,
    vendor_opportunity_brief_id: result.brief.id,
    vendor_invite_ids: result.invites.map((invite) => invite.id),
    queued_vendor_invite_count: result.invites.length,
  })

  await insertOpportunityStatusMessage(writeDb, plan.id, {
    opportunity_brief_id: String(result.brief.id),
    approval_id: approval.id,
    status: 'drafts_prepared',
    content: `Prepared ${result.invites.length} vendor outreach draft${result.invites.length === 1 ? '' : 's'} for review.`,
  })

  return {
    prepared: true,
    vendor_invite_count: result.invites.length,
    vendor_opportunity_brief_id: String(result.brief.id),
  }
}

async function syncVenueOpportunitySendApproval(
  readDb: PlannerDb,
  writeDb: PlannerDb,
  plan: Plan,
  userId: string,
  approval: Approval,
  payload: Record<string, unknown>,
  opportunityBriefId: string | null
): Promise<OutreachPreparationSummary> {
  if (approval.status === 'cancelled' || approval.status === 'rejected') {
    if (!opportunityBriefId) return { prepared: false, reason: `approval_${approval.status}` }

    const { error: inviteUpdateError } = await writeDb
      .from('venue_opportunity_invites')
      .update({ status: 'cancelled' })
      .eq('brief_id', opportunityBriefId)

    if (inviteUpdateError) {
      console.error('Planner venue opportunity cancel invite update error:', inviteUpdateError)
    }
    return { prepared: false, reason: `approval_${approval.status}` }
  }

  if (approval.status !== 'authorized' && approval.status !== 'approved') {
    return { prepared: false, reason: `approval_${approval.status}` }
  }

  if (opportunityBriefId) {
    const invites = await ensureVenueOpportunityInviteTokens(readDb, opportunityBriefId, writeDb)
    const venuePayload = {
      ...payload,
      opportunity_brief_id: opportunityBriefId,
      invite_ids: invites.map((invite) => invite.id),
      queued_invite_count: invites.length,
    }
    await updateActionPayload(writeDb, approval.agent_action_id, venuePayload)
    await insertOpportunityStatusMessage(writeDb, plan.id, {
      opportunity_brief_id: opportunityBriefId,
      approval_id: approval.id,
      status: 'drafts_prepared',
      content: `Prepared ${invites.length} venue outreach draft${invites.length === 1 ? '' : 's'} for review.`,
    })
    let vendorSummary: OutreachPreparationSummary = { prepared: false }
    if (hasVendorOutreachPayload(payload)) {
      vendorSummary = await syncVendorOpportunitySendApproval(readDb, writeDb, plan, userId, approval, venuePayload)
    }
    return {
      prepared: true,
      venue_invite_count: invites.length,
      vendor_invite_count: vendorSummary.vendor_invite_count,
      opportunity_brief_id: opportunityBriefId,
      vendor_opportunity_brief_id: vendorSummary.vendor_opportunity_brief_id,
    }
  }

  const venueIds = readStringArray(payload.venue_ids).filter(isUuid)
  if (venueIds.length === 0) {
    if (hasVendorOutreachPayload(payload)) {
      return syncVendorOpportunitySendApproval(readDb, writeDb, plan, userId, approval, payload)
    }
    console.error('Planner venue opportunity send approval missing venue_ids')
    return { prepared: false, reason: 'missing_venue_ids' }
  }

  const discoveryDrafts = await enqueueDraftsAfterVenueApproval({
    db: readDb,
    writeDb,
    planId: plan.id,
    userId,
    venueIds,
  })

  if (discoveryDrafts.prepared) {
    await updateActionPayload(writeDb, approval.agent_action_id, {
      ...payload,
      venue_ids: discoveryDrafts.unhandledVenueIds,
      discovery_outreach_results: discoveryDrafts.results,
      queued_gmail_approval_count: discoveryDrafts.draftCreatedCount,
      contact_extraction_pending_count: discoveryDrafts.extractionPendingCount,
      contact_email_required_count: discoveryDrafts.emailRequiredCount,
    })
    await insertOpportunityStatusMessage(writeDb, plan.id, {
      opportunity_brief_id: approval.id,
      approval_id: approval.id,
      status: 'drafts_prepared',
      content: buildDiscoveryOutreachStatusMessage(discoveryDrafts),
    })

    let legacySummary: OutreachPreparationSummary = { prepared: false }
    if (discoveryDrafts.unhandledVenueIds.length > 0) {
      const result = await createVenueOpportunityBrief({
        db: readDb,
        writeDb,
        plan,
        userId,
        venueIds: discoveryDrafts.unhandledVenueIds,
        summary: readString(payload.summary) ?? `${plan.title} venue opportunity`,
        requirements: readRecord(payload.requirements) ?? {},
        responseDeadline: readString(payload.response_deadline),
        issueTokens: true,
      })

      await updateActionPayload(writeDb, approval.agent_action_id, {
        ...payload,
        venue_ids: discoveryDrafts.unhandledVenueIds,
        opportunity_brief_id: result.brief.id,
        invite_ids: result.invites.map((invite) => invite.id),
        queued_invite_count: result.invites.length,
        discovery_outreach_results: discoveryDrafts.results,
        queued_gmail_approval_count: discoveryDrafts.draftCreatedCount,
        contact_extraction_pending_count: discoveryDrafts.extractionPendingCount,
        contact_email_required_count: discoveryDrafts.emailRequiredCount,
      })

      await insertOpportunityStatusMessage(writeDb, plan.id, {
        opportunity_brief_id: String(result.brief.id),
        approval_id: approval.id,
        status: 'drafts_prepared',
        content: `Prepared ${result.invites.length} venue outreach draft${result.invites.length === 1 ? '' : 's'} for review.`,
      })

      legacySummary = {
        prepared: true,
        venue_invite_count: result.invites.length,
        opportunity_brief_id: String(result.brief.id),
      }
    }

    let vendorSummary: OutreachPreparationSummary = { prepared: false }
    if (hasVendorOutreachPayload(payload)) {
      vendorSummary = await syncVendorOpportunitySendApproval(readDb, writeDb, plan, userId, approval, payload)
    }

    return {
      prepared: true,
      venue_invite_count: (legacySummary.venue_invite_count ?? 0) + discoveryDrafts.draftCreatedCount,
      vendor_invite_count: vendorSummary.vendor_invite_count,
      gmail_draft_count: discoveryDrafts.draftCreatedCount,
      contact_extraction_pending_count: discoveryDrafts.extractionPendingCount,
      contact_email_required_count: discoveryDrafts.emailRequiredCount,
      opportunity_brief_id: legacySummary.opportunity_brief_id,
      vendor_opportunity_brief_id: vendorSummary.vendor_opportunity_brief_id,
      discovery_outreach_results: discoveryDrafts.results,
    }
  }

  const result = await createVenueOpportunityBrief({
    db: readDb,
    writeDb,
    plan,
    userId,
    venueIds,
    summary: readString(payload.summary) ?? `${plan.title} venue opportunity`,
    requirements: readRecord(payload.requirements) ?? {},
    responseDeadline: readString(payload.response_deadline),
    issueTokens: true,
  })

  const venuePayload = {
    ...payload,
    opportunity_brief_id: result.brief.id,
    invite_ids: result.invites.map((invite) => invite.id),
    queued_invite_count: result.invites.length,
  }
  await updateActionPayload(writeDb, approval.agent_action_id, venuePayload)

  await insertOpportunityStatusMessage(writeDb, plan.id, {
    opportunity_brief_id: String(result.brief.id),
    approval_id: approval.id,
    status: 'drafts_prepared',
    content: `Prepared ${result.invites.length} venue outreach draft${result.invites.length === 1 ? '' : 's'} for review.`,
  })

  let vendorSummary: OutreachPreparationSummary = { prepared: false }
  if (hasVendorOutreachPayload(payload)) {
    vendorSummary = await syncVendorOpportunitySendApproval(readDb, writeDb, plan, userId, approval, venuePayload)
  }

  return {
    prepared: true,
    venue_invite_count: result.invites.length,
    vendor_invite_count: vendorSummary.vendor_invite_count,
    opportunity_brief_id: String(result.brief.id),
    vendor_opportunity_brief_id: vendorSummary.vendor_opportunity_brief_id,
  }
}

function buildDiscoveryOutreachStatusMessage(summary: Awaited<ReturnType<typeof enqueueDraftsAfterVenueApproval>>) {
  const parts = [
    summary.draftCreatedCount > 0
      ? `${summary.draftCreatedCount} Gmail outreach draft${summary.draftCreatedCount === 1 ? '' : 's'} ready for approval`
      : null,
    summary.extractionPendingCount > 0
      ? `${summary.extractionPendingCount} venue${summary.extractionPendingCount === 1 ? '' : 's'} checking website contact details`
      : null,
    summary.emailRequiredCount > 0
      ? `${summary.emailRequiredCount} venue${summary.emailRequiredCount === 1 ? '' : 's'} need a contact email`
      : null,
  ].filter((part): part is string => Boolean(part))

  return parts.length > 0
    ? `${parts.join('; ')}.`
    : 'Prepared venue outreach for review.'
}

function hasVendorOutreachPayload(payload: Record<string, unknown>): boolean {
  return Boolean(readString(payload.vendor_opportunity_brief_id)) ||
    readStringArray(payload.vendor_ids).length > 0
}

function isVenueOutreachAction(action: unknown): boolean {
  const record = readRecord(action)
  const actionType = readString(record?.action_type)
  if (actionType === 'opportunity_send_venues') return true

  const payload = readRecord(record?.payload_json)
  const metadata = readRecord(record?.result_metadata)
  return actionType === 'email' &&
    readString(payload?.kind) === 'venue_outreach' &&
    readString(metadata?.action_type_fallback) === 'opportunity_send_venues'
}

function isVendorOutreachAction(action: unknown): boolean {
  const record = readRecord(action)
  const actionType = readString(record?.action_type)
  if (actionType === 'opportunity_send_vendors') return true

  const payload = readRecord(record?.payload_json)
  const metadata = readRecord(record?.result_metadata)
  return actionType === 'email' &&
    readString(payload?.kind) === 'vendor_outreach' &&
    readString(metadata?.action_type_fallback) === 'opportunity_send_vendors'
}

async function updateActionPayload(db: PlannerDb, actionId: string, payload: Record<string, unknown>) {
  const { error } = await db
    .from('agent_actions')
    .update({ payload_json: payload as Json })
    .eq('id', actionId)

  if (error) console.error('Planner opportunity action payload sync error:', error)
}

async function insertOpportunityStatusMessage(
  db: PlannerDb,
  planId: string,
  payload: {
    opportunity_brief_id: string
    approval_id: string
    status: string
    content: string
  }
) {
  const { error } = await db.from('plan_messages').insert({
    plan_id: planId,
    role: 'agent',
    content: payload.content,
    message_type: 'status_update',
    metadata: payload as unknown as Json,
  })

  if (error) console.error('Planner opportunity status message insert error:', error)
}

async function syncApprovalMessageMetadata(
  readDb: PlannerDb,
  writeDb: PlannerDb,
  planId: string,
  approval: Approval
) {
  const actionPayload = await loadAgentActionPayload(readDb, approval.agent_action_id)
  const executionMetadata = actionPayload ? buildApprovalExecutionMetadata(actionPayload) : {}
  const { data, error } = await readDb
    .from('plan_messages')
    .select(PLAN_MESSAGE_METADATA_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .eq('message_type', 'approval_request')

  if (error) {
    console.error('Planner approval message metadata lookup error:', error)
    return
  }

  const rows = (data ?? []) as Array<{ id: string; metadata: Json | null }>
  await Promise.all(
    rows.map(async (row) => {
      if (!row.metadata || typeof row.metadata !== 'object' || Array.isArray(row.metadata)) return

      const embeddedApproval = row.metadata.approval
      if (!embeddedApproval || typeof embeddedApproval !== 'object' || Array.isArray(embeddedApproval)) return

      const storedApprovalId = embeddedApproval.id
      if (storedApprovalId !== approval.id) return

      const nextMetadata = {
        ...row.metadata,
        ...executionMetadata,
        status: approval.status,
        approval: {
          ...embeddedApproval,
          ...approval,
        },
      } as Json

      const { error: updateError } = await writeDb
        .from('plan_messages')
        .update({ metadata: nextMetadata })
        .eq('id', row.id)

      if (updateError) {
        console.error('Planner approval message metadata update error:', updateError)
      }
    })
  )
}

async function loadAgentActionPayload(db: PlannerDb, actionId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await db
    .from('agent_actions')
    .select('action_type, payload_json, result_metadata')
    .eq('id', actionId)
    .maybeSingle()

  if (error) {
    console.error('Planner approval action payload lookup error:', error)
    return null
  }

  const payload = readRecord(data?.payload_json) ?? {}
  const resultMetadata = readRecord(data?.result_metadata)
  return {
    ...payload,
    action_type: readString(data?.action_type),
    execution_mode:
      readString(resultMetadata?.execution_mode) ?? readString(payload.execution_mode),
  }
}

function buildApprovalExecutionMetadata(payload: Record<string, unknown>): Record<string, unknown> {
  const queuedVenueCount = readNumber(payload.queued_invite_count)
  const queuedVendorCount = readNumber(payload.queued_vendor_invite_count)
  const totalQueued = (queuedVenueCount ?? 0) + (queuedVendorCount ?? 0)

  return {
    action_type: readString(payload.action_type),
    execution_mode: readString(payload.execution_mode),
    opportunity_brief_id: readString(payload.opportunity_brief_id),
    vendor_opportunity_brief_id: readString(payload.vendor_opportunity_brief_id),
    invite_ids: readStringArray(payload.invite_ids),
    vendor_invite_ids: readStringArray(payload.vendor_invite_ids),
    queued_invite_count: totalQueued > 0 ? totalQueued : queuedVenueCount,
    queued_vendor_invite_count: queuedVendorCount,
  }
}

async function insertAgentActionAuditLog(
  db: PlannerDb,
  payload: {
    actionId: string
    planId: string
    fromStatus: string | null
    toStatus: string
    actorId: string
    reason: string
    metadata?: Record<string, unknown>
  }
) {
  const { error } = await db.from('agent_action_audit_log').insert({
    action_id: payload.actionId,
    plan_id: payload.planId,
    from_status: payload.fromStatus,
    to_status: payload.toStatus,
    actor_id: payload.actorId,
    actor_role: 'user',
    reason: payload.reason,
    metadata: (payload.metadata ?? {}) as Json,
  })

  if (error) console.error('Planner agent action audit insert error:', error)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
