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
import { checkRateLimit, rateLimitHeaders } from '@/lib/server/rate-limit'
import { createClient } from '@/lib/supabase/server'
import type { AgentAction, Approval, Json, PlannerApiErrorResponse, Plan } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }
type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const createAgentActionSchema = z.object({
  actionType: z.enum([
    'hold_request',
    'vendor_contact',
    'external_checkout',
    'ai_query',
    'export',
    'opportunity_send_venues',
    'opportunity_send_vendors',
  ]),
  targetType: z.string().trim().min(1).max(80).nullable().optional(),
  targetId: z.string().uuid().nullable().optional(),
  payloadJson: z.record(z.unknown()).nullable().optional(),
  requestedAmountCents: z.number().int().nonnegative().nullable().optional(),
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
  created_at,
  updated_at
`

interface RouteContext {
  params: {
    planId: string
  }
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

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const requestedLimit = Number.parseInt(request.nextUrl.searchParams.get('limit') ?? '50', 10)
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50

    const { data, error } = await auth.db
      .from('agent_actions')
      .select(AGENT_ACTION_SELECT_COLUMNS)
      .eq('plan_id', context.params.planId)
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
): Promise<NextResponse<{ agentAction: AgentAction; approval?: Approval } | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const rateLimit = checkRateLimit(`planner:agent-actions:${auth.userId}`)
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

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const payload = (parsed.data.payloadJson ?? {}) as Record<string, unknown>
    const requestedAmountCents = parsed.data.requestedAmountCents ?? readNumber(payload.requestedAmountCents) ?? 0
    const actionLabel = readString(payload.action_label) ?? readDefaultActionLabel(parsed.data.actionType)
    const provider = readString(payload.provider)

    const { data: actionData, error: actionError } = await auth.db
      .from('agent_actions')
      .insert({
        plan_id: context.params.planId,
        action_type: parsed.data.actionType,
        target_type: parsed.data.targetType ?? readString(payload.target_type),
        target_id: parsed.data.targetId ?? readUuid(payload.target_id),
        payload_json: payload as Json,
        description: actionLabel,
        provider,
        amount_cents: requestedAmountCents,
        currency: 'usd',
        status: 'pending',
        result_metadata: {
          source: 'planner_recommendation',
          payload,
        },
      })
      .select(AGENT_ACTION_SELECT_COLUMNS)
      .single()

    if (actionError || !actionData) {
      console.error('Planner agent action create error:', actionError)
      return NextResponse.json({ error: 'Failed to create agent action' }, { status: 500 })
    }

    const agentAction = actionData as AgentAction
    await insertAgentActionAuditLog(auth.db, {
      actionId: agentAction.id,
      planId: context.params.planId,
      fromStatus: null,
      toStatus: agentAction.status,
      actorId: auth.userId,
      reason: 'agent_action.created',
      metadata: { action_type: agentAction.action_type },
    })

    if (
      parsed.data.actionType !== 'hold_request' &&
      parsed.data.actionType !== 'vendor_contact' &&
      parsed.data.actionType !== 'external_checkout' &&
      parsed.data.actionType !== 'opportunity_send_venues' &&
      parsed.data.actionType !== 'opportunity_send_vendors'
    ) {
      return NextResponse.json({ agentAction })
    }

    const { data: approvalData, error: approvalError } = await auth.db
      .from('approvals')
      .insert({
        plan_id: context.params.planId,
        agent_action_id: agentAction.id,
        action_label: actionLabel,
        provider,
        event_date: normalizeDate(readString(payload.event_date)),
        price_cents: requestedAmountCents,
        fees_cents: readNumber(payload.fees_cents) ?? 0,
        package_details: readString(payload.package_details),
        refund_terms: readString(payload.refund_terms),
        cancellation_terms: readString(payload.cancellation_terms),
        delivery_email: readString(payload.delivery_email),
        payment_method_id: readString(payload.payment_method_id),
        requested_amount_cents: requestedAmountCents,
        status: 'pending',
      })
      .select(APPROVAL_SELECT_COLUMNS)
      .single()

    if (approvalError || !approvalData) {
      console.error('Planner approval create from action error:', approvalError)
      return NextResponse.json({ error: 'Failed to create approval' }, { status: 500 })
    }

    const approval = approvalData as Approval

    await auth.db
      .from('agent_actions')
      .update({ approval_id: approval.id })
      .eq('id', agentAction.id)

    return NextResponse.json({ agentAction: { ...agentAction, approval_id: approval.id }, approval })
  } catch (error) {
    console.error('Planner agent action POST error:', error)
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

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null
}

function normalizeDate(value: string | null): string | null {
  if (!value) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function readDefaultActionLabel(actionType: z.infer<typeof createAgentActionSchema>['actionType']): string {
  if (actionType === 'hold_request') return 'Request venue hold'
  if (actionType === 'vendor_contact') return 'Contact vendor'
  if (actionType === 'opportunity_send_venues') return 'Send to venues'
  if (actionType === 'opportunity_send_vendors') return 'Request vendor quotes'
  if (actionType === 'external_checkout') return 'External checkout'
  if (actionType === 'ai_query') return 'Agent research'
  return 'Export plan'
}
