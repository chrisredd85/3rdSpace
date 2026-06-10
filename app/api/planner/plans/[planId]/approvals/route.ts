/**
 * API route for reading and updating planner approval records.
 *
 * Approval creation now happens through the linked `agent-actions` route, so
 * PATCH is intentionally focused on authorizing, rejecting, or cancelling an
 * existing approval that belongs to the authenticated builder's plan.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
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
  agentActionStatusForApprovalStatus,
  assertIntegerCents,
  isApprovalExecutable,
  transitionAgentActionStatus,
  transitionApprovalStatus,
  type AgentActionTransitionEvent,
} from '@/lib/planner/execution/approvalState'
import { planApprovedActionExecution } from '@/lib/planner/execution/executeApprovedAction'
import { approvalRequiresReapproval } from '@/lib/planner/execution/reapproval'
import { executeApprovedGmailOutreach } from '@/lib/outreach/gmailApprovalFlow'
import {
  BuilderBillingRequiredError,
  consumeBuilderEventAccess,
  getBuilderBillingSummary,
  loadBuilderBillingProfileByUserId,
} from '@/lib/billing/builder-billing'
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

type PlannerDb = { from: (table: string) => any }
type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const patchApprovalSchema = z.object({
  approvalId: z.string().uuid(),
  action: z.enum(['authorize', 'approve', 'reject', 'cancel']),
  authorizedAmountCents: z.number().int().nonnegative().refine(Number.isSafeInteger).nullable().optional(),
})

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
  created_at,
  updated_at
`

const AGENT_ACTION_OPPORTUNITY_SELECT_COLUMNS = 'id, action_type, payload_json, result_metadata'

const PLAN_MESSAGE_METADATA_SELECT_COLUMNS = 'id, metadata'

interface RouteContext {
  params: {
    planId: string
  }
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
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const { data, error } = await auth.db
      .from('approvals')
      .select(APPROVAL_SELECT_COLUMNS)
      .eq('plan_id', context.params.planId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Planner approvals list error:', error)
      return NextResponse.json({ error: 'Failed to fetch approvals' }, { status: 500 })
    }

    return NextResponse.json({ approvals: (data ?? []) as Approval[] })
  } catch (error) {
    console.error('Planner approvals GET error:', error)
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
): Promise<NextResponse<{ approval: Approval } | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const parsed = patchApprovalSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    let plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const existingApproval = await loadApproval(auth.db, context.params.planId, parsed.data.approvalId)
    if (!existingApproval) return NextResponse.json({ error: 'Approval not found' }, { status: 404 })

    const approvalTransition = transitionApprovalStatus(existingApproval.status, parsed.data.action)
    if (!approvalTransition.ok) {
      return NextResponse.json({ error: approvalTransition.reason }, { status: 409 })
    }

    if (
      (parsed.data.action === 'authorize' || parsed.data.action === 'approve') &&
      await approvalRequiresFreshReview(auth.db, plan, existingApproval)
    ) {
      const staleApproval = await markApprovalReapprovalRequired(auth.db, context.params.planId, existingApproval.id)
      if (staleApproval) {
        await syncApprovalMessageMetadata(auth.db, context.params.planId, staleApproval)
      }
      return NextResponse.json(
        { error: 'Plan details changed after this approval was created. Review the latest recommendations and approve again.' },
        { status: 409 }
      )
    }

    if (parsed.data.action === 'authorize' || parsed.data.action === 'approve') {
      const access = await ensurePlannerProductAccess(plan, auth.userId)
      if ('response' in access) return access.response
      plan = access.plan
    }

    const updates = buildApprovalUpdates(approvalTransition.to, auth.userId, parsed.data.authorizedAmountCents)
    const { data, error } = await auth.db
      .from('approvals')
      .update(updates)
      .eq('id', parsed.data.approvalId)
      .eq('plan_id', context.params.planId)
      .select(APPROVAL_SELECT_COLUMNS)
      .single()

    if (error || !data) {
      console.error('Planner approval update error:', error)
      return NextResponse.json({ error: 'Failed to update approval' }, { status: 500 })
    }

    const approval = data as Approval
    await syncAgentActionStatusForApproval(auth.db, {
      actionId: approval.agent_action_id,
      planId: context.params.planId,
      actorId: auth.userId,
      approvalStatus: approval.status,
    })
    if (isApprovalExecutable(approval.status)) {
      await executeApprovedAction(auth.db, {
        actionId: approval.agent_action_id,
        planId: context.params.planId,
        actorId: auth.userId,
        plan,
        approval,
      })
    } else if (approval.status === 'cancelled' || approval.status === 'rejected') {
      await syncOpportunityInviteStatuses(auth.db, plan, auth.userId, approval)
    }
    await syncApprovalMessageMetadata(auth.db, context.params.planId, approval)

    return NextResponse.json({ approval })
  } catch (error) {
    console.error('Planner approvals PATCH error:', error)
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

async function ensurePlannerProductAccess(
  plan: Plan,
  userId: string
): Promise<{ plan: Plan } | { response: NextResponse<PlannerApiErrorResponse> }> {
  const existingMetadata = readRecord(plan.metadata) ?? {}
  const productGate = readRecord(existingMetadata.product_gate)
  if (productGate?.event_access_consumed_at) return { plan }

  const admin = createServiceRoleClient()
  const adminDb = admin as unknown as PlannerDb
  const { data: builder, error } = await loadBuilderBillingProfileByUserId(admin, userId)

  if (error) {
    console.error('[planner.approvals] Failed to verify builder billing access', error)
    return {
      response: NextResponse.json({ error: 'Failed to verify product access' }, { status: 500 }),
    }
  }

  if (!builder) {
    return {
      response: NextResponse.json({ error: 'Builder profile not found' }, { status: 404 }),
    }
  }

  const billing = getBuilderBillingSummary(builder)
  if (!billing.canCreateEvent) {
    return {
      response: NextResponse.json(
        {
          error: 'Choose pay-per-event or Pro to approve outreach.',
          billingRequired: true,
          billing,
        },
        { status: 402 }
      ),
    }
  }

  try {
    const consumed = await consumeBuilderEventAccess({
      admin,
      builder,
      eventId: plan.id,
    })
    const metadata = {
      ...existingMetadata,
      product_gate: {
        event_access_consumed_at: new Date().toISOString(),
        event_access_source: consumed.source,
        event_access_amount: consumed.amount,
      },
    }

    const { data: updatedPlan, error: updateError } = await adminDb
      .from('plans')
      .update({ metadata })
      .eq('id', plan.id)
      .eq('user_id', userId)
      .select(PLAN_SELECT_COLUMNS)
      .maybeSingle()

    if (updateError) {
      console.error('[planner.approvals] Failed to mark product access consumed', updateError)
      return {
        response: NextResponse.json({ error: 'Failed to activate planner access' }, { status: 500 }),
      }
    }

    return { plan: (updatedPlan as Plan | null) ?? { ...plan, metadata } }
  } catch (error) {
    if (error instanceof BuilderBillingRequiredError) {
      return {
        response: NextResponse.json(
          {
            error: 'Choose pay-per-event or Pro to approve outreach.',
            billingRequired: true,
            billing,
          },
          { status: 402 }
        ),
      }
    }

    console.error('[planner.approvals] Failed to consume planner product access', error)
    return {
      response: NextResponse.json({ error: 'Failed to activate planner access' }, { status: 500 }),
    }
  }
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

async function approvalRequiresFreshReview(db: PlannerDb, plan: Plan, approval: Approval): Promise<boolean> {
  if (!approval.snapshot_hash) return false
  const action = await loadAgentAction(db, approval.agent_action_id)
  return approvalRequiresReapproval({
    plan,
    approval,
    action,
    storedSnapshotHash: approval.snapshot_hash,
  })
}

async function markApprovalReapprovalRequired(
  db: PlannerDb,
  planId: string,
  approvalId: string
): Promise<Approval | null> {
  const { data, error } = await db
    .from('approvals')
    .update({ status: 're_approval_required' })
    .eq('id', approvalId)
    .eq('plan_id', planId)
    .select(APPROVAL_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    console.error('Planner approval stale status update error:', error)
    return null
  }

  return data as Approval
}

async function syncAgentActionStatusForApproval(
  db: PlannerDb,
  payload: {
    actionId: string
    planId: string
    actorId: string
    approvalStatus: ApprovalStatus
  }
) {
  const action = await loadAgentAction(db, payload.actionId)
  if (!action) return

  const transition = agentActionStatusForApprovalStatus(payload.approvalStatus, action.status)
  if (!transition) return
  if (!transition.ok) {
    throw new Error(transition.reason)
  }
  if (!transition.changed) return

  await persistAgentActionTransition(db, {
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
  db: PlannerDb,
  payload: {
    actionId: string
    planId: string
    actorId: string
    plan: Plan
    approval: Approval
  }
) {
  let action = await loadAgentAction(db, payload.actionId)
  if (!action) return

  const executionPlan = planApprovedActionExecution({ action, approval: payload.approval })
  if (!executionPlan.canStart) return

  action = await persistAgentActionTransition(db, {
    action,
    planId: payload.planId,
    actorId: payload.actorId,
    reason: 'approval.execution_started',
    event: 'execution_started',
    metadata: {
      execution_kind: executionPlan.kind,
      outbound_message_sent: false,
    },
  })

  try {
    if (executionPlan.kind === 'send_gmail_outreach') {
      const gmailExecution = await executeApprovedGmailOutreach(db, {
        userId: payload.actorId,
        plan: payload.plan,
        action,
        approval: payload.approval,
      })

      await persistAgentActionTransition(db, {
        action,
        planId: payload.planId,
        actorId: payload.actorId,
        reason: 'approval.gmail_outreach_sent',
        event: 'execution_completed',
        metadata: {
          execution_kind: executionPlan.kind,
          ...gmailExecution,
        },
      })
      return
    }

    const preparation = await syncOpportunityInviteStatuses(db, payload.plan, payload.actorId, payload.approval)

    if (!preparation.prepared) {
      throw new Error(preparation.reason ?? 'Outreach drafts were not prepared')
    }

    await persistAgentActionTransition(db, {
      action,
      planId: payload.planId,
      actorId: payload.actorId,
      reason: 'approval.outreach_drafts_prepared',
      event: 'execution_completed',
      metadata: {
        execution_kind: executionPlan.kind,
        outbound_message_sent: false,
        send_requires_explicit_flow: true,
        ...preparation,
      },
    })
  } catch (error) {
    await persistAgentActionTransition(db, {
      action,
      planId: payload.planId,
      actorId: payload.actorId,
      reason: 'approval.execution_failed',
      event: 'execution_failed',
      metadata: {
        execution_kind: executionPlan.kind,
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
  opportunity_brief_id?: string | null
  vendor_opportunity_brief_id?: string | null
}

async function syncOpportunityInviteStatuses(
  db: PlannerDb,
  plan: Plan,
  userId: string,
  approval: Approval
): Promise<OutreachPreparationSummary> {
  const { data, error } = await db
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
    return syncVenueOpportunitySendApproval(db, plan, userId, approval, payloadRecord, opportunityBriefId)
  }

  if (isVendorOutreachAction(action)) {
    return syncVendorOpportunitySendApproval(db, plan, userId, approval, payloadRecord)
  }

  if (!opportunityBriefId) return { prepared: false, reason: 'not_outreach_action' }

  if (approval.status === 'authorized' || approval.status === 'approved') {
    const invites = await ensureVenueOpportunityInviteTokens(db, opportunityBriefId)

    const { error: briefUpdateError } = await db
      .from('venue_opportunity_briefs')
      .update({ status: 'approval_requested' })
      .eq('id', opportunityBriefId)
      .eq('plan_id', plan.id)

    if (briefUpdateError) {
      console.error('Planner opportunity brief authorized status update error:', briefUpdateError)
    }

    await insertOpportunityStatusMessage(db, plan.id, {
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
    const { error: inviteUpdateError } = await db
      .from('venue_opportunity_invites')
      .update({ status: 'cancelled' })
      .eq('brief_id', opportunityBriefId)

    if (inviteUpdateError) {
      console.error('Planner opportunity invite cancelled status update error:', inviteUpdateError)
    }

    const { error: briefUpdateError } = await db
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
  db: PlannerDb,
  plan: Plan,
  userId: string,
  approval: Approval,
  payload: Record<string, unknown>
): Promise<OutreachPreparationSummary> {
  const vendorBriefId = readString(payload.vendor_opportunity_brief_id) ?? readString(payload.opportunity_brief_id)

  if (approval.status === 'cancelled' || approval.status === 'rejected') {
    if (!vendorBriefId) return { prepared: false, reason: `approval_${approval.status}` }

    const { error: inviteUpdateError } = await db
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
    const invites = await ensureVendorOpportunityInviteTokens(db, vendorBriefId)
    await updateActionPayload(db, approval.agent_action_id, {
      ...payload,
      vendor_opportunity_brief_id: vendorBriefId,
      vendor_invite_ids: invites.map((invite) => invite.id),
      queued_vendor_invite_count: invites.length,
    })
    await insertOpportunityStatusMessage(db, plan.id, {
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
    db,
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

  await updateActionPayload(db, approval.agent_action_id, {
    ...payload,
    vendor_opportunity_brief_id: result.brief.id,
    vendor_invite_ids: result.invites.map((invite) => invite.id),
    queued_vendor_invite_count: result.invites.length,
  })

  await insertOpportunityStatusMessage(db, plan.id, {
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
  db: PlannerDb,
  plan: Plan,
  userId: string,
  approval: Approval,
  payload: Record<string, unknown>,
  opportunityBriefId: string | null
): Promise<OutreachPreparationSummary> {
  if (approval.status === 'cancelled' || approval.status === 'rejected') {
    if (!opportunityBriefId) return { prepared: false, reason: `approval_${approval.status}` }

    const { error: inviteUpdateError } = await db
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
    const invites = await ensureVenueOpportunityInviteTokens(db, opportunityBriefId)
    await updateActionPayload(db, approval.agent_action_id, {
      ...payload,
      opportunity_brief_id: opportunityBriefId,
      invite_ids: invites.map((invite) => invite.id),
      queued_invite_count: invites.length,
    })
    await insertOpportunityStatusMessage(db, plan.id, {
      opportunity_brief_id: opportunityBriefId,
      approval_id: approval.id,
      status: 'drafts_prepared',
      content: `Prepared ${invites.length} venue outreach draft${invites.length === 1 ? '' : 's'} for review.`,
    })
    let vendorSummary: OutreachPreparationSummary = { prepared: false }
    if (hasVendorOutreachPayload(payload)) {
      vendorSummary = await syncVendorOpportunitySendApproval(db, plan, userId, approval, payload)
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
      return syncVendorOpportunitySendApproval(db, plan, userId, approval, payload)
    }
    console.error('Planner venue opportunity send approval missing venue_ids')
    return { prepared: false, reason: 'missing_venue_ids' }
  }

  const result = await createVenueOpportunityBrief({
    db,
    plan,
    userId,
    venueIds,
    summary: readString(payload.summary) ?? `${plan.title} venue opportunity`,
    requirements: readRecord(payload.requirements) ?? {},
    responseDeadline: readString(payload.response_deadline),
    issueTokens: true,
  })

  await updateActionPayload(db, approval.agent_action_id, {
    ...payload,
    opportunity_brief_id: result.brief.id,
    invite_ids: result.invites.map((invite) => invite.id),
    queued_invite_count: result.invites.length,
  })

  await insertOpportunityStatusMessage(db, plan.id, {
    opportunity_brief_id: String(result.brief.id),
    approval_id: approval.id,
    status: 'drafts_prepared',
    content: `Prepared ${result.invites.length} venue outreach draft${result.invites.length === 1 ? '' : 's'} for review.`,
  })

  let vendorSummary: OutreachPreparationSummary = { prepared: false }
  if (hasVendorOutreachPayload(payload)) {
    vendorSummary = await syncVendorOpportunitySendApproval(db, plan, userId, approval, payload)
  }

  return {
    prepared: true,
    venue_invite_count: result.invites.length,
    vendor_invite_count: vendorSummary.vendor_invite_count,
    opportunity_brief_id: String(result.brief.id),
    vendor_opportunity_brief_id: vendorSummary.vendor_opportunity_brief_id,
  }
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

async function syncApprovalMessageMetadata(db: PlannerDb, planId: string, approval: Approval) {
  const actionPayload = await loadAgentActionPayload(db, approval.agent_action_id)
  const executionMetadata = actionPayload ? buildApprovalExecutionMetadata(actionPayload) : {}
  const { data, error } = await db
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

      const { error: updateError } = await db
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
    .select('payload_json')
    .eq('id', actionId)
    .maybeSingle()

  if (error) {
    console.error('Planner approval action payload lookup error:', error)
    return null
  }

  return readRecord(data?.payload_json)
}

function buildApprovalExecutionMetadata(payload: Record<string, unknown>): Record<string, unknown> {
  const queuedVenueCount = readNumber(payload.queued_invite_count)
  const queuedVendorCount = readNumber(payload.queued_vendor_invite_count)
  const totalQueued = (queuedVenueCount ?? 0) + (queuedVendorCount ?? 0)

  return {
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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
