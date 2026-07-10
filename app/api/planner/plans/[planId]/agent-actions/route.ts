/**
 * API route for creating planner agent actions from recommendation CTAs.
 *
 * The route owns the first step in the booking backend: it records a requested
 * action and, for hold/vendor-contact actions, creates the linked approval row
 * that the user can authorize or cancel.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readIntegerCents } from '@/lib/planner/execution/approvalState'
import { classifyExecutionMode, requiresApprovalForAgentAction } from '@/lib/planner/executionModes'
import {
  APPROVAL_SNAPSHOT_SCHEMA_VERSION,
  buildApprovalSnapshotHashV2,
  buildApprovalSnapshotV2,
} from '@/lib/planner/execution/reapproval'
import { normalizeExternalCheckoutUrl } from '@/lib/planner/execution/externalCheckout'
import {
  checkAuthorizationActionStripeGate,
  getStripeGateErrorMessage,
} from '@/lib/planner/stripeReadinessGate'
import { checkRateLimit, rateLimitHeaders } from '@/lib/server/rate-limit'
import { notifyEntityStripeSetup } from '@/lib/server/notifyEntityStripeSetup'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { AgentAction, Approval, Json, PlanMessage, PlannerApiErrorResponse, Plan } from '@/lib/types'
import type { JsonObject, TableInsert, TableUpdate } from '@/lib/types'

type DbError = { message: string; code?: string }
type DbResult<T> = { data: T | null; error: DbError | null }
type DbListResult<T> = { data: T[] | null; error: DbError | null }
type DbMutationResult = { error: DbError | null }
type SelectBuilder<T> = PromiseLike<DbListResult<T>> & {
  eq(column: string, value: unknown): SelectBuilder<T>
  order(column: string, options?: { ascending?: boolean }): SelectBuilder<T>
  limit(count: number): SelectBuilder<T>
  maybeSingle(): PromiseLike<DbResult<T>>
  single(): PromiseLike<DbResult<T>>
}
type InsertBuilder<T> = PromiseLike<DbListResult<T>> & { select(columns: string): { single(): PromiseLike<DbResult<T>> } }
type UpdateBuilder = { eq(column: string, value: unknown): PromiseLike<DbMutationResult> }
type PlannerTable<Row, Insert, Update> = {
  select(columns: string): SelectBuilder<Row>
  insert(values: Insert): InsertBuilder<Row>
  update(values: Update): UpdateBuilder
}
type PlannerDb = {
  from(table: 'plans'): PlannerTable<Plan, TableInsert<'plans'>, TableUpdate<'plans'>>
  from(table: 'agent_actions'): PlannerTable<AgentAction, TableInsert<'agent_actions'>, TableUpdate<'agent_actions'>>
  from(table: 'approvals'): PlannerTable<Approval, TableInsert<'approvals'>, TableUpdate<'approvals'>>
  from(table: 'plan_messages'): PlannerTable<PlanMessage, TableInsert<'plan_messages'>, TableUpdate<'plan_messages'>>
  from(
    table: 'agent_action_audit_log'
  ): PlannerTable<unknown, TableInsert<'agent_action_audit_log'>, TableUpdate<'agent_action_audit_log'>>
}
type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const safeCentsSchema = z.number().int().nonnegative().refine(Number.isSafeInteger)
const paymentCentsSchema = z.number().int().min(50).refine(Number.isSafeInteger)
const optionalTargetFields = {
  targetType: z.string().trim().min(1).max(80).nullable().optional(),
  targetId: z.string().uuid().nullable().optional(),
}
const optionalGenericActionFields = {
  ...optionalTargetFields,
  payloadJson: z.record(z.unknown()).nullable().optional(),
  requestedAmountCents: safeCentsSchema.nullable().optional(),
}

function genericAgentActionSchema<Kind extends string>(actionType: Kind) {
  return z.object({
    actionType: z.literal(actionType),
    ...optionalGenericActionFields,
  }).strict()
}

const externalCheckoutUrlSchema = z.string().trim().min(1).max(2_048)
  .refine((value) => {
    try {
      normalizeExternalCheckoutUrl(value)
      return true
    } catch {
      return false
    }
  }, 'external_url must be a valid HTTPS URL without embedded credentials')
  .transform((value) => normalizeExternalCheckoutUrl(value))

const externalCheckoutPayloadSchema = z.object({
  kind: z.literal('external_checkout'),
  external_url: externalCheckoutUrlSchema,
  action_label: z.string().trim().min(1).max(160),
  provider: z.string().trim().min(1).max(160),
  package_details: z.string().trim().min(1).max(2_000),
  price_cents: safeCentsSchema.optional(),
  fees_cents: safeCentsSchema.optional(),
  refund_terms: z.string().trim().max(1_000).nullable().optional(),
  cancellation_terms: z.string().trim().max(1_000).nullable().optional(),
  event_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  delivery_email: z.string().trim().email().nullable().optional(),
  notes: z.string().trim().max(4_000).nullable().optional(),
  source: z.string().trim().max(120).optional(),
}).strict()

const paymentPayloadSchema = z.object({
  kind: z.enum(['venue_rental', 'venue_deposit', 'vendor_deposit']),
  action_label: z.string().trim().min(1).max(160),
  provider: z.string().trim().min(1).max(160),
  package_details: z.string().trim().min(1).max(2_000),
  refund_terms: z.string().trim().min(1).max(1_000),
  cancellation_terms: z.string().trim().min(1).max(1_000),
  fees_cents: safeCentsSchema.optional(),
  event_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  delivery_email: z.string().trim().email().nullable().optional(),
  notes: z.string().trim().max(4_000).nullable().optional(),
  source: z.string().trim().max(120).optional(),
}).strict()

const createAgentActionSchema = z.discriminatedUnion('actionType', [
  genericAgentActionSchema('hold_request'),
  genericAgentActionSchema('vendor_contact'),
  genericAgentActionSchema('payment'),
  genericAgentActionSchema('ai_query'),
  genericAgentActionSchema('export'),
  genericAgentActionSchema('opportunity_send_venues'),
  genericAgentActionSchema('opportunity_send_vendors'),
  z.object({
    actionType: z.literal('external_checkout'),
    ...optionalTargetFields,
    payloadJson: externalCheckoutPayloadSchema,
    requestedAmountCents: safeCentsSchema.nullable().optional(),
  }).strict(),
  z.object({
    actionType: z.literal('payment'),
    targetType: z.enum(['venue', 'vendor']),
    targetId: z.string().uuid(),
    payloadJson: paymentPayloadSchema,
    requestedAmountCents: paymentCentsSchema,
  }).strict(),
])

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

const AGENT_ACTION_SELECT_COLUMNS = `
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
  created_at,
  updated_at
`

interface RouteContext {
  params: Promise<{
    planId: string
  }>
}

/**
 * Lists recent agent actions for a planner-owned plan.
 *
 * Timeline derivation uses these rows as the source of truth for venue hold
 * lifecycle state, rather than inferring holds from recommendation messages.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{ agentActions: AgentAction[] } | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, (await context.params).planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const requestedLimit = Number.parseInt(request.nextUrl.searchParams.get('limit') ?? '50', 10)
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50

    const { data, error } = await auth.db
      .from('agent_actions')
      .select(AGENT_ACTION_SELECT_COLUMNS)
      .eq('plan_id', (await context.params).planId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('Planner agent actions list error:', error)
      return NextResponse.json({ error: 'Failed to load agent actions' }, { status: 500 })
    }

    return NextResponse.json({ agentActions: (data ?? []) as AgentAction[] })
  } catch (error) {
    console.error('Planner agent action GET error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

/**
 * Creates an agent action and optional approval for a planner-owned plan.
 *
 * @param request - Authenticated builder request containing action details.
 * @param context - Route params containing the planner plan id.
 * @returns Created agent action and, for hold/vendor-contact actions, approval.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{ agentAction: AgentAction; approval?: Approval; approvalMessage?: PlanMessage } | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const rateLimit = await checkRateLimit(`planner:agent-actions:${auth.userId}`)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many planner actions. Try again shortly.' },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      )
    }

    const parsed = createAgentActionSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const plan = await loadOwnedPlan(auth.db, (await context.params).planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const submittedPayload = (parsed.data.payloadJson ?? {}) as JsonObject
    const cents = readActionCents(submittedPayload, parsed.data.requestedAmountCents)
    if ('error' in cents) {
      return NextResponse.json({ error: cents.error }, { status: 400 })
    }

    const requestedAmountCents = cents.requestedAmountCents
    const feesCents = cents.feesCents
    const payload = normalizeAgentActionPayload(
      parsed.data.actionType,
      submittedPayload,
      requestedAmountCents,
      feesCents
    )
    const actionLabel = readString(payload.action_label) ?? readDefaultActionLabel(parsed.data.actionType)
    const provider = readString(payload.provider)
    const targetType = parsed.data.targetType ?? readString(payload.target_type)
    const targetId = parsed.data.targetId ?? readUuid(payload.target_id)
    const executionMode = classifyExecutionMode({
      actionType: parsed.data.actionType,
      provider,
      targetType,
      externalUrl: readString(payload.external_url) ?? readString(payload.checkout_url),
      hasControlledPaymentAccount:
        readBoolean(payload.has_controlled_payment_account) ??
        readBoolean(payload.hasControlledPaymentAccount) ??
        readBoolean(payload.has_stripe_account),
      routeToAdminQueue:
        readBoolean(payload.route_to_admin_queue) ??
        readBoolean(payload.routeToAdminQueue) ??
        readBoolean(payload.route_to_concierge),
    })

    const stripeGate = await checkAgentActionStripeGate({
      actionType: parsed.data.actionType,
      targetType,
      targetId,
      requestedAmountCents,
      payload,
      executionMode,
      planId: (await context.params).planId,
      organizerId: auth.userId,
    })
    if (stripeGate) return stripeGate

    // Ownership was proved with the session/RLS client above. Trusted state is
    // service-owned, so use a narrowly scoped writer only after that check.
    const writeDb = createServiceRoleClient() as unknown as PlannerDb

    const agentActionInsert: TableInsert<'agent_actions'> = {
      plan_id: (await context.params).planId,
      action_type: parsed.data.actionType,
      target_type: targetType,
      target_id: targetId,
      payload_json: payload,
      description: actionLabel,
      provider,
      amount_cents: requestedAmountCents,
      currency: 'usd',
      status: 'pending',
      result_metadata: {
        source: 'planner_recommendation',
        execution_mode: executionMode,
        payload,
      },
    }

    const { data: actionData, error: actionError } = await writeDb
      .from('agent_actions')
      .insert(agentActionInsert)
      .select(AGENT_ACTION_SELECT_COLUMNS)
      .single()

    if (actionError || !actionData) {
      console.error('Planner agent action create error:', actionError)
      return NextResponse.json({ error: 'Failed to create agent action' }, { status: 500 })
    }

    const agentAction = actionData as AgentAction
    await insertAgentActionAuditLog(writeDb, {
      actionId: agentAction.id,
      planId: (await context.params).planId,
      fromStatus: null,
      toStatus: agentAction.status,
      actorId: auth.userId,
      reason: 'agent_action.created',
      metadata: { action_type: agentAction.action_type },
    })

    if (!requiresApprovalForAgentAction(parsed.data.actionType)) {
      return NextResponse.json({ agentAction })
    }

    const approvalExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const approvalSnapshotFields = {
      action_label: actionLabel,
      event_date: normalizeDate(readString(payload.event_date)),
      price_cents: requestedAmountCents,
      fees_cents: feesCents,
      requested_amount_cents: requestedAmountCents,
      provider,
      delivery_email: readString(payload.delivery_email),
      refund_terms: readString(payload.refund_terms),
      cancellation_terms: readString(payload.cancellation_terms),
      package_details: readString(payload.package_details),
      expires_at: approvalExpiresAt,
      notes: readString(payload.notes),
    }
    const approvalSnapshotInput = {
      plan,
      approval: approvalSnapshotFields,
      action: agentAction,
      payload,
    }
    const approvalInsert = {
      plan_id: (await context.params).planId,
      agent_action_id: agentAction.id,
      ...approvalSnapshotFields,
      payment_method_id: readString(payload.payment_method_id),
      status: 'pending',
      snapshot_hash: buildApprovalSnapshotHashV2(approvalSnapshotInput),
      snapshot_json: buildApprovalSnapshotV2(approvalSnapshotInput) as unknown as Json,
      snapshot_schema_version: APPROVAL_SNAPSHOT_SCHEMA_VERSION,
    } as unknown as TableInsert<'approvals'>

    const { data: approvalData, error: approvalError } = await writeDb
      .from('approvals')
      .insert(approvalInsert)
      .select(APPROVAL_SELECT_COLUMNS)
      .single()

    if (approvalError || !approvalData) {
      console.error('Planner approval create from action error:', approvalError)
      return NextResponse.json({ error: 'Failed to create approval' }, { status: 500 })
    }

    const approval = approvalData as Approval

    await writeDb
      .from('agent_actions')
      .update({ approval_id: approval.id })
      .eq('id', agentAction.id)

    const { data: approvalMessageData, error: approvalMessageError } = await writeDb
      .from('plan_messages')
      .insert({
        plan_id: (await context.params).planId,
        role: 'agent',
        content: `${actionLabel} is ready for review. Approve before 3rdPlace sends, books, or pays.`,
        message_type: 'approval_request',
        metadata: {
          state: 'recommendation_action_approval_requested',
          status: 'pending',
          source: 'planner_recommendation_action',
          action_type: agentAction.action_type,
          execution_mode: executionMode,
          approval,
          agent_action_id: agentAction.id,
        } as unknown as Json,
      })
      .select('*')
      .single()

    if (approvalMessageError || !approvalMessageData) {
      console.error('Planner approval message create from action error:', approvalMessageError)
      return NextResponse.json({ error: 'Failed to create approval message' }, { status: 500 })
    }

    return NextResponse.json({
      agentAction: { ...agentAction, approval_id: approval.id },
      approval,
      approvalMessage: approvalMessageData as PlanMessage,
    })
  } catch (error) {
    console.error('Planner agent action POST error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

async function checkAgentActionStripeGate(input: {
  actionType: z.infer<typeof createAgentActionSchema>['actionType']
  targetType?: string | null
  targetId?: string | null
  requestedAmountCents: number | null
  payload: JsonObject
  executionMode: string
  planId: string
  organizerId: string
}): Promise<NextResponse<PlannerApiErrorResponse> | null> {
  const admin = createServiceRoleClient()
  const gateResult = await checkAuthorizationActionStripeGate({
    supabase: admin as any,
    actionType: input.actionType,
    targetType: input.targetType,
    targetId: input.targetId,
    amountCents: input.requestedAmountCents,
    payload: {
      ...input.payload,
      execution_mode: input.executionMode,
    },
  })
  if (!gateResult || gateResult.gate.ready) return null

  if (gateResult.target.entityType === 'venue' || gateResult.target.entityType === 'vendor') {
    notifyEntityStripeSetup({
      supabase: admin as any,
      entityType: gateResult.target.entityType,
      entityId: gateResult.target.entityId,
      planId: input.planId,
      organizerId: input.organizerId,
      reason: gateResult.gate.reason,
    }).catch((error) => {
      console.error('Planner agent-action Stripe setup notification failed:', error)
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
    console.error('Planner agent action plan lookup error:', error)
    return null
  }

  return (data as Plan | null) ?? null
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
    metadata?: JsonObject
  }
) {
  const auditInsert: TableInsert<'agent_action_audit_log'> = {
    action_id: payload.actionId,
    plan_id: payload.planId,
    from_status: payload.fromStatus,
    to_status: payload.toStatus,
    actor_id: payload.actorId,
    actor_role: 'user',
    reason: payload.reason,
    metadata: payload.metadata ?? {},
  }

  const { error } = await db.from('agent_action_audit_log').insert(auditInsert)

  if (error) console.error('Planner agent action audit insert error:', error)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readActionCents(
  payload: JsonObject,
  requestedAmountCents: number | null | undefined
): { requestedAmountCents: number; feesCents: number } | { error: string } {
  try {
    return {
      requestedAmountCents:
        readIntegerCents(requestedAmountCents, 'requestedAmountCents') ??
        readIntegerCents(payload.requestedAmountCents, 'payloadJson.requestedAmountCents') ??
        0,
      feesCents: readIntegerCents(payload.fees_cents, 'payloadJson.fees_cents') ?? 0,
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Money values must be integer cents' }
  }
}

function readUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function normalizeDate(value: string | null): string | null {
  if (!value) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function readDefaultActionLabel(actionType: z.infer<typeof createAgentActionSchema>['actionType']): string {
  if (actionType === 'hold_request') return 'Request venue hold'
  if (actionType === 'vendor_contact') return 'Contact vendor'
  if (actionType === 'opportunity_send_venues') return 'Prepare venue outreach'
  if (actionType === 'opportunity_send_vendors') return 'Prepare vendor outreach'
  if (actionType === 'external_checkout') return 'External checkout'
  if (actionType === 'payment') return 'Authorize payment'
  if (actionType === 'ai_query') return 'Agent research'
  return 'Export plan'
}

function normalizeAgentActionPayload(
  actionType: z.infer<typeof createAgentActionSchema>['actionType'],
  payload: JsonObject,
  requestedAmountCents: number,
  feesCents: number
): JsonObject {
  if (actionType === 'external_checkout') {
    return {
      ...payload,
      kind: 'external_checkout',
      external_url: normalizeExternalCheckoutUrl(payload.external_url),
      price_cents: requestedAmountCents,
      requestedAmountCents,
      fees_cents: feesCents,
    }
  }

  if (actionType === 'payment') {
    return {
      ...payload,
      price_cents: requestedAmountCents,
      requestedAmountCents,
      fees_cents: feesCents,
      requires_stripe_recipient: true,
    }
  }

  return payload
}
