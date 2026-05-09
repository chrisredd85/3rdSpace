/**
 * API route for reading and updating planner approval records.
 *
 * Approval creation now happens through the linked `agent-actions` route, so
 * PATCH is intentionally focused on authorizing, rejecting, or cancelling an
 * existing approval that belongs to the authenticated builder's plan.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
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
  enqueueOpportunityInviteSendJobs,
  enqueueVendorOpportunityInviteSendJobs,
} from '@/lib/server/opportunity-email-worker'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { Approval, Json, PlannerApiErrorResponse, PlannerApprovalsResponse, Plan } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }
type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const patchApprovalSchema = z.object({
  approvalId: z.string().uuid(),
  action: z.enum(['authorize', 'approve', 'reject', 'cancel']),
  authorizedAmountCents: z.number().int().nonnegative().nullable().optional(),
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

const AGENT_ACTION_STATUS_SELECT_COLUMNS = 'id, status, action_type'

const AGENT_ACTION_OPPORTUNITY_SELECT_COLUMNS = 'id, action_type, payload_json'

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

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const existingApproval = await loadApproval(auth.db, context.params.planId, parsed.data.approvalId)
    if (!existingApproval) return NextResponse.json({ error: 'Approval not found' }, { status: 404 })

    if (
      (parsed.data.action === 'authorize' || parsed.data.action === 'approve') &&
      approvalRequiresFreshReview(plan, existingApproval)
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

    const updates = buildApprovalUpdates(parsed.data.action, auth.userId, parsed.data.authorizedAmountCents)
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
    await syncAgentActionStatus(auth.db, {
      actionId: approval.agent_action_id,
      planId: context.params.planId,
      actorId: auth.userId,
      approvalStatus: approval.status,
    })
    await syncOpportunityInviteStatuses(auth.db, plan, auth.userId, approval)
    if (approval.status === 'authorized' || approval.status === 'approved') {
      await markAgentActionExecuted(auth.db, {
        actionId: approval.agent_action_id,
        planId: context.params.planId,
        actorId: auth.userId,
      })
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
  action: z.infer<typeof patchApprovalSchema>['action'],
  userId: string,
  authorizedAmountCents: number | null | undefined
) {
  if (action === 'authorize' || action === 'approve') {
    const authorizedAt = new Date().toISOString()
    return {
      status: action === 'approve' ? 'approved' : 'authorized',
      authorized_by: userId,
      authorized_at: authorizedAt,
      authorized_amount_cents: authorizedAmountCents ?? null,
      approved_by: userId,
      approved_at: authorizedAt,
    }
  }

  if (action === 'cancel') {
    return { status: 'cancelled' }
  }

  return { status: 'rejected' }
}

function approvalRequiresFreshReview(plan: Plan, approval: Approval): boolean {
  if (!approval.snapshot_hash) return false
  return approval.snapshot_hash !== buildPlanApprovalSnapshotHash(plan)
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

function buildPlanApprovalSnapshotHash(plan: Plan): string {
  const snapshot = {
    event_type: plan.event_type,
    guest_count: plan.guest_count,
    budget_cap_cents: plan.budget_cap_cents,
    neighborhood: plan.neighborhood,
    date_window_start: plan.date_window_start,
    date_window_end: plan.date_window_end,
    ticketed: plan.ticketed,
    ticketing_model: plan.ticketing_model,
    food_responsibility: plan.food_responsibility,
    profit_goal_cents: plan.profit_goal_cents,
  }

  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

async function syncAgentActionStatus(
  db: PlannerDb,
  payload: {
    actionId: string
    planId: string
    actorId: string
    approvalStatus: string
  }
) {
  const status =
    payload.approvalStatus === 'authorized'
      ? 'approved'
      : payload.approvalStatus === 'cancelled' || payload.approvalStatus === 'rejected'
        ? 'cancelled'
        : null

  if (!status) return

  const { data: currentAction, error: currentActionError } = await db
    .from('agent_actions')
    .select(AGENT_ACTION_STATUS_SELECT_COLUMNS)
    .eq('id', payload.actionId)
    .maybeSingle()

  if (currentActionError) {
    console.error('Planner agent action status lookup error:', currentActionError)
  }

  const fromStatus = typeof currentAction?.status === 'string' ? currentAction.status : null
  if (fromStatus === status) return

  const { error } = await db.from('agent_actions').update({ status }).eq('id', payload.actionId)
  if (error) console.error('Planner agent action status sync error:', error)
  if (error) return

  await insertAgentActionAuditLog(db, {
    actionId: payload.actionId,
    planId: payload.planId,
    fromStatus,
    toStatus: status,
    actorId: payload.actorId,
    reason: 'approval.status_changed',
    metadata: { approval_status: payload.approvalStatus },
  })
}

async function markAgentActionExecuted(
  db: PlannerDb,
  payload: {
    actionId: string
    planId: string
    actorId: string
  }
) {
  const { data: currentAction, error: currentActionError } = await db
    .from('agent_actions')
    .select(AGENT_ACTION_STATUS_SELECT_COLUMNS)
    .eq('id', payload.actionId)
    .maybeSingle()

  if (currentActionError) {
    console.error('Planner agent action executed status lookup error:', currentActionError)
  }

  const fromStatus = typeof currentAction?.status === 'string' ? currentAction.status : null
  const actionType = typeof currentAction?.action_type === 'string' ? currentAction.action_type : null
  if (actionType !== 'opportunity_send_venues' && actionType !== 'opportunity_send_vendors') return
  if (fromStatus === 'complete') return

  const { error } = await db
    .from('agent_actions')
    .update({ status: 'complete', executed_at: new Date().toISOString() })
    .eq('id', payload.actionId)

  if (error) {
    console.error('Planner agent action executed status sync error:', error)
    return
  }

  await insertAgentActionAuditLog(db, {
    actionId: payload.actionId,
    planId: payload.planId,
    fromStatus,
    toStatus: 'complete',
    actorId: payload.actorId,
    reason: 'approval.executed',
    metadata: { execution: 'outreach_jobs_enqueued' },
  })
}

async function syncOpportunityInviteStatuses(db: PlannerDb, plan: Plan, userId: string, approval: Approval) {
  const { data, error } = await db
    .from('agent_actions')
    .select(AGENT_ACTION_OPPORTUNITY_SELECT_COLUMNS)
    .eq('id', approval.agent_action_id)
    .maybeSingle()

  if (error || !data) {
    if (error) console.error('Planner opportunity action lookup error:', error)
    return
  }

  const payload = data.payload_json
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return

  const action = data as { id: string; action_type?: string | null; payload_json?: unknown }
  const opportunityBriefId = readString((payload as Record<string, unknown>).opportunity_brief_id)

  if (action.action_type === 'opportunity_send_venues') {
    await syncVenueOpportunitySendApproval(db, plan, userId, approval, payload as Record<string, unknown>, opportunityBriefId)
    return
  }

  if (action.action_type === 'opportunity_send_vendors') {
    await syncVendorOpportunitySendApproval(db, plan, userId, approval, payload as Record<string, unknown>)
    return
  }

  if (!opportunityBriefId) return

  if (approval.status === 'authorized' || approval.status === 'approved') {
    const invites = await ensureVenueOpportunityInviteTokens(db, opportunityBriefId)
    await enqueueVenueInviteSendJobs(invites)

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
      status: 'queued',
      content: `Queued — ${invites.length} invite${invites.length === 1 ? '' : 's'} ready to send.`,
    })
    return
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
}

async function syncVendorOpportunitySendApproval(
  db: PlannerDb,
  plan: Plan,
  userId: string,
  approval: Approval,
  payload: Record<string, unknown>
) {
  const vendorBriefId = readString(payload.vendor_opportunity_brief_id) ?? readString(payload.opportunity_brief_id)

  if (approval.status === 'cancelled' || approval.status === 'rejected') {
    if (!vendorBriefId) return

    const { error: inviteUpdateError } = await db
      .from('vendor_opportunity_invites')
      .update({ status: 'cancelled' })
      .eq('brief_id', vendorBriefId)

    if (inviteUpdateError) {
      console.error('Planner vendor opportunity cancel invite update error:', inviteUpdateError)
    }
    return
  }

  if (approval.status !== 'authorized' && approval.status !== 'approved') return

  if (vendorBriefId) {
    const invites = await ensureVendorOpportunityInviteTokens(db, vendorBriefId)
    await enqueueVendorInviteSendJobs(invites)
    await updateActionPayload(db, approval.agent_action_id, {
      ...payload,
      vendor_opportunity_brief_id: vendorBriefId,
      vendor_invite_ids: invites.map((invite) => invite.id),
      queued_vendor_invite_count: invites.length,
    })
    await insertOpportunityStatusMessage(db, plan.id, {
      opportunity_brief_id: vendorBriefId,
      approval_id: approval.id,
      status: 'queued',
      content: `Sent inquiries to ${invites.length} vendor${invites.length === 1 ? '' : 's'} — I'll ping you when they reply.`,
    })
    return
  }

  const vendorIds = readStringArray(payload.vendor_ids).filter(isUuid)
  if (vendorIds.length === 0) {
    console.error('Planner vendor opportunity send approval missing vendor_ids')
    return
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
  await enqueueVendorInviteSendJobs(result.invites)

  await updateActionPayload(db, approval.agent_action_id, {
    ...payload,
    vendor_opportunity_brief_id: result.brief.id,
    vendor_invite_ids: result.invites.map((invite) => invite.id),
    queued_vendor_invite_count: result.invites.length,
  })

  await insertOpportunityStatusMessage(db, plan.id, {
    opportunity_brief_id: String(result.brief.id),
    approval_id: approval.id,
    status: 'queued',
    content: `Sent inquiries to ${result.invites.length} vendor${result.invites.length === 1 ? '' : 's'} — I'll ping you when they reply.`,
  })
}

async function syncVenueOpportunitySendApproval(
  db: PlannerDb,
  plan: Plan,
  userId: string,
  approval: Approval,
  payload: Record<string, unknown>,
  opportunityBriefId: string | null
) {
  if (approval.status === 'cancelled' || approval.status === 'rejected') {
    if (!opportunityBriefId) return

    const { error: inviteUpdateError } = await db
      .from('venue_opportunity_invites')
      .update({ status: 'cancelled' })
      .eq('brief_id', opportunityBriefId)

    if (inviteUpdateError) {
      console.error('Planner venue opportunity cancel invite update error:', inviteUpdateError)
    }
    return
  }

  if (approval.status !== 'authorized' && approval.status !== 'approved') return

  if (opportunityBriefId) {
    const invites = await ensureVenueOpportunityInviteTokens(db, opportunityBriefId)
    await enqueueVenueInviteSendJobs(invites)
    await updateActionPayload(db, approval.agent_action_id, {
      ...payload,
      opportunity_brief_id: opportunityBriefId,
      invite_ids: invites.map((invite) => invite.id),
      queued_invite_count: invites.length,
    })
    await insertOpportunityStatusMessage(db, plan.id, {
      opportunity_brief_id: opportunityBriefId,
      approval_id: approval.id,
      status: 'queued',
      content: `Sent inquiries to ${invites.length} venue${invites.length === 1 ? '' : 's'} — I'll ping you when they reply.`,
    })
    if (hasVendorOutreachPayload(payload)) {
      await syncVendorOpportunitySendApproval(db, plan, userId, approval, payload)
    }
    return
  }

  const venueIds = readStringArray(payload.venue_ids).filter(isUuid)
  if (venueIds.length === 0) {
    if (hasVendorOutreachPayload(payload)) {
      await syncVendorOpportunitySendApproval(db, plan, userId, approval, payload)
      return
    }
    console.error('Planner venue opportunity send approval missing venue_ids')
    return
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
  await enqueueVenueInviteSendJobs(result.invites)

  await updateActionPayload(db, approval.agent_action_id, {
    ...payload,
    opportunity_brief_id: result.brief.id,
    invite_ids: result.invites.map((invite) => invite.id),
    queued_invite_count: result.invites.length,
  })

  await insertOpportunityStatusMessage(db, plan.id, {
    opportunity_brief_id: String(result.brief.id),
    approval_id: approval.id,
    status: 'queued',
    content: `Sent inquiries to ${result.invites.length} venue${result.invites.length === 1 ? '' : 's'} — I'll ping you when they reply.`,
  })

  if (hasVendorOutreachPayload(payload)) {
    await syncVendorOpportunitySendApproval(db, plan, userId, approval, payload)
  }
}

function hasVendorOutreachPayload(payload: Record<string, unknown>): boolean {
  return Boolean(readString(payload.vendor_opportunity_brief_id)) ||
    readStringArray(payload.vendor_ids).length > 0
}

async function enqueueVenueInviteSendJobs(invites: Array<Record<string, unknown>>) {
  if (invites.length === 0) return
  const admin = createServiceRoleClient()
  await enqueueOpportunityInviteSendJobs(admin, invites)
}

async function enqueueVendorInviteSendJobs(invites: Array<Record<string, unknown>>) {
  if (invites.length === 0) return
  const admin = createServiceRoleClient()
  await enqueueVendorOpportunityInviteSendJobs(admin, invites)
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

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
