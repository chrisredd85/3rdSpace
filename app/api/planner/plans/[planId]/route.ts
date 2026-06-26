/**
 * API route for reading and patching one persisted Agent Planner plan.
 *
 * Purpose:
 * - GET loads the full persisted plan payload needed after a page reload.
 * - PATCH updates plan fields and writes field-level audit rows.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  APPROVAL_SELECT_COLUMNS,
  PLAN_MESSAGE_SELECT_COLUMNS,
  PLAN_SELECT_COLUMNS,
  RECOMMENDATION_SELECT_COLUMNS,
} from '@/lib/planner/dbSelects'
import { createAutoRecommendationMessage } from '@/lib/planner/autoRecommendations'
import { loadPlanAgentFields } from '@/lib/planner/planAgentSummaries'
import { enrichPlanSelectedVendors } from '@/lib/planner/planVendorSelections'
import { createClient } from '@/lib/supabase/server'
import type {
  Approval,
  Json,
  Plan,
  PlannerApiErrorResponse,
  PlannerFullPlanResponse,
  PlanMessage,
  PlanStatus,
  Recommendation,
} from '@/lib/types'

type PlannerDb = { from: (table: string) => any }
type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const planStatusSchema = z.enum(['drafting', 'ready', 'approved', 'executing', 'complete', 'archived'])

const patchPlanSchema = z.object({
  status: planStatusSchema.optional(),
  title: z.string().trim().min(1).max(160).optional(),
  event_type: z.string().trim().max(120).nullable().optional(),
  guest_count: z.number().int().nonnegative().nullable().optional(),
  headcount: z.number().int().nonnegative().nullable().optional(),
  neighborhood: z.string().trim().max(120).nullable().optional(),
  area: z.string().trim().max(120).nullable().optional(),
  date_window_start: z.string().trim().max(32).nullable().optional(),
  date_window_end: z.string().trim().max(32).nullable().optional(),
  date_window: z.string().trim().max(160).nullable().optional(),
  budget_cap_cents: z.number().int().nonnegative().nullable().optional(),
  budget_cents: z.number().int().nonnegative().nullable().optional(),
  ticketed: z.boolean().optional(),
  ticket_price_target: z.number().int().nonnegative().nullable().optional(),
  ticketing_model: z.string().trim().max(160).nullable().optional(),
  food_responsibility: z.string().trim().max(160).nullable().optional(),
  venue_terms: z.string().trim().max(160).nullable().optional(),
  agent_action: z.string().trim().max(160).nullable().optional(),
  profit_goal_cents: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
})

interface RouteContext {
  params: Promise<{
    planId: string
  }>
}

/**
 * Loads a full persisted planner plan for the authenticated community builder.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<PlannerFullPlanResponse | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, (await context.params).planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const [messages, recommendations, approvals] = await Promise.all([
      loadMessages(auth.db, plan.id),
      loadRecommendations(auth.db, plan.id),
      loadApprovals(auth.db, plan.id),
    ])
    const agentFields = await loadPlanAgentFields({
      db: auth.db,
      plan,
      userId: auth.userId,
    })
    const enrichedPlan = await enrichPlanSelectedVendors(auth.db, agentFields.plan, auth.userId)

    return NextResponse.json({
      plan: enrichedPlan,
      messages,
      recommendations,
      approvals,
      workspace_summary: agentFields.workspace_summary,
      timeline: agentFields.timeline,
    })
  } catch (error) {
    console.error('[agent.run] Planner plan GET error', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

/**
 * Updates a persisted planner plan and records per-field audit rows.
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{ plan: Plan; follow_up_messages?: PlanMessage[] } | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const parsed = patchPlanSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const existingPlan = await loadOwnedPlan(auth.db, (await context.params).planId, auth.userId)
    if (!existingPlan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const updates = normalizePlanPatch(parsed.data, existingPlan)
    if (updates.status && !isAllowedPlanStatusTransition(existingPlan.status, updates.status as PlanStatus)) {
      return NextResponse.json(
        { error: `Illegal status transition from ${existingPlan.status} to ${updates.status}` },
        { status: 422 }
      )
    }

    const changedUpdates = pickChangedFields(existingPlan, updates)
    if (Object.keys(changedUpdates).length === 0) {
      return NextResponse.json({ plan: existingPlan })
    }

    const { data, error } = await auth.db
      .from('plans')
      .update(changedUpdates)
      .eq('id', existingPlan.id)
      .eq('user_id', auth.userId)
      .select(PLAN_SELECT_COLUMNS)
      .single()

    if (error || !data) {
      console.error('Planner plan PATCH error:', error)
      return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 })
    }

    await insertPlanUpdateRows(auth.db, existingPlan, changedUpdates)
    const plan = data as Plan
    const followUpMessages = didMatchAffectingFieldsChange(existingPlan, plan)
      ? await refreshRecommendationsAfterPlanChange({
          db: auth.db,
          request,
          plan,
          changedFields: findMatchAffectingChangedFields(existingPlan, plan),
        })
      : []

    return NextResponse.json({
      plan,
      follow_up_messages: followUpMessages.length > 0 ? followUpMessages : undefined,
    })
  } catch (error) {
    console.error('Planner plan PATCH unexpected error:', error)
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
    console.error('Planner plan lookup error:', error)
    return null
  }

  return (data as Plan | null) ?? null
}

async function loadMessages(db: PlannerDb, planId: string): Promise<PlanMessage[]> {
  const { data, error } = await db
    .from('plan_messages')
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Planner plan messages lookup error:', error)
    return []
  }

  return (data ?? []) as PlanMessage[]
}

async function loadRecommendations(db: PlannerDb, planId: string): Promise<Recommendation[]> {
  const { data, error } = await db
    .from('recommendations')
    .select(RECOMMENDATION_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .order('rank', { ascending: true })

  if (error) {
    console.error('Planner plan recommendations lookup error:', error)
    return []
  }

  return (data ?? []) as Recommendation[]
}

async function loadApprovals(db: PlannerDb, planId: string): Promise<Approval[]> {
  const { data, error } = await db
    .from('approvals')
    .select(APPROVAL_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Planner plan approvals lookup error:', error)
    return []
  }

  return (data ?? []) as Approval[]
}

function normalizePlanPatch(input: z.infer<typeof patchPlanSchema>, currentPlan: Plan): Record<string, unknown> {
  const updates: Record<string, unknown> = {}

  for (const key of [
    'status',
    'title',
    'event_type',
    'date_window_start',
    'date_window_end',
    'ticketed',
    'ticketing_model',
    'food_responsibility',
    'venue_terms',
    'agent_action',
    'profit_goal_cents',
    'notes',
  ] as const) {
    if (input[key] !== undefined) updates[key] = input[key]
  }

  if (input.guest_count !== undefined) updates.guest_count = input.guest_count
  if (input.headcount !== undefined) updates.guest_count = input.headcount
  if (input.neighborhood !== undefined) updates.neighborhood = input.neighborhood
  if (input.area !== undefined) updates.neighborhood = input.area
  if (input.budget_cap_cents !== undefined) updates.budget_cap_cents = input.budget_cap_cents
  if (input.budget_cents !== undefined) updates.budget_cap_cents = input.budget_cents
  if (input.ticket_price_target !== undefined) {
    const metadata = readRecord(currentPlan.metadata) ?? {}
    updates.metadata = {
      ...metadata,
      ticket_price_target_cents: input.ticket_price_target,
    }
  }
  if (input.ticketed === false) {
    const metadata = readRecord(currentPlan.metadata) ?? {}
    const nextMetadata = { ...metadata }
    delete nextMetadata.ticket_price_target_cents
    delete nextMetadata.ticket_price_target
    updates.metadata = nextMetadata
    updates.ticketing_model = input.ticketing_model ?? 'rsvp'
  }

  if (input.date_window !== undefined && input.date_window !== null) {
    updates.notes = [typeof updates.notes === 'string' ? updates.notes : null, `Date window: ${input.date_window}`]
      .filter(Boolean)
      .join('\n')
  }

  return updates
}

async function refreshRecommendationsAfterPlanChange(input: {
  db: PlannerDb
  request: NextRequest
  plan: Plan
  changedFields: string[]
}): Promise<PlanMessage[]> {
  const recommendations = await loadActiveRecommendations(input.db, input.plan.id)
  if (recommendations.length === 0 || input.plan.status !== 'ready') return []

  const supersededAt = new Date().toISOString()
  await Promise.all(recommendations.map((recommendation) => supersedeRecommendation(input.db, recommendation, supersededAt, input.changedFields)))
  await invalidatePendingOutreachApprovals(input.db, input.plan.id, supersededAt, input.changedFields)

  const statusMessage = await insertRecommendationRefreshStatusMessage(input.db, input.plan.id, input.changedFields)
  const recommendationMessages = await createAutoRecommendationMessage({
    db: input.db,
    request: input.request,
    planId: input.plan.id,
  })

  return [statusMessage, ...recommendationMessages].filter((message): message is PlanMessage => message !== null)
}

async function loadActiveRecommendations(db: PlannerDb, planId: string): Promise<Recommendation[]> {
  const { data, error } = await db
    .from('recommendations')
    .select(RECOMMENDATION_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .in('status', ['pending', 'selected'])

  if (error) {
    console.error('Planner active recommendation lookup error:', error)
    return []
  }

  return (data ?? []) as Recommendation[]
}

async function supersedeRecommendation(
  db: PlannerDb,
  recommendation: Recommendation,
  supersededAt: string,
  changedFields: string[]
) {
  const metadata = readRecord(recommendation.metadata) ?? {}
  const { error } = await db
    .from('recommendations')
    .update({
      status: 'rejected',
      metadata: {
        ...metadata,
        superseded_at: supersededAt,
        superseded_reason: 'match_affecting_plan_change',
        superseded_changed_fields: changedFields,
      } as Json,
    })
    .eq('id', recommendation.id)

  if (error) console.error('Planner recommendation supersede error:', error)
}

async function invalidatePendingOutreachApprovals(
  db: PlannerDb,
  planId: string,
  supersededAt: string,
  changedFields: string[]
) {
  const { data, error } = await db
    .from('agent_actions')
    .select('id, action_type, status, payload_json')
    .eq('plan_id', planId)
    .in('action_type', ['opportunity_send_venues', 'opportunity_send_vendors', 'email'])

  if (error) {
    console.error('Planner outreach approval action invalidation lookup error:', error)
    return
  }

  const actionIds = ((data ?? []) as Array<Record<string, unknown>>)
    .filter((action) => action.status !== 'complete')
    .filter((action) => readRecord(action.payload_json)?.kind === 'venue_outreach')
    .map((action) => readString(action.id))
    .filter((id): id is string => Boolean(id))
  if (actionIds.length === 0) return

  const { error: approvalError } = await db
    .from('approvals')
    .update({ status: 're_approval_required' })
    .in('agent_action_id', actionIds)
    .in('status', ['pending', 'approved', 'authorized'])

  if (approvalError) console.error('Planner outreach approval invalidation error:', approvalError)

  await markOutreachApprovalMessagesReapprovalRequired(db, planId, supersededAt, changedFields)
}

async function markOutreachApprovalMessagesReapprovalRequired(
  db: PlannerDb,
  planId: string,
  supersededAt: string,
  changedFields: string[]
) {
  const { data, error } = await db
    .from('plan_messages')
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .eq('message_type', 'approval_request')

  if (error) {
    console.error('Planner outreach approval message invalidation lookup error:', error)
    return
  }

  await Promise.all(((data ?? []) as PlanMessage[]).map(async (message) => {
    const metadata = readRecord(message.metadata)
    if (metadata?.kind !== 'venue_outreach') return
    const approval = readRecord(metadata.approval)
    const nextMetadata = {
      ...metadata,
      status: 're_approval_required',
      superseded_at: supersededAt,
      superseded_changed_fields: changedFields,
      approval: approval
        ? {
            ...approval,
            status: 're_approval_required',
          }
        : approval,
    } as Json

    const { error: updateError } = await db
      .from('plan_messages')
      .update({ metadata: nextMetadata })
      .eq('id', message.id)

    if (updateError) console.error('Planner outreach approval message invalidation error:', updateError)
  }))
}

async function insertRecommendationRefreshStatusMessage(
  db: PlannerDb,
  planId: string,
  changedFields: string[]
): Promise<PlanMessage | null> {
  const { data, error } = await db
    .from('plan_messages')
    .insert({
      plan_id: planId,
      role: 'agent',
      content: 'Updated the plan — re-checking venues against the new numbers.',
      message_type: 'status_update',
      metadata: {
        reason: 'recommendations_superseded',
        changed_fields: changedFields,
      } as Json,
    })
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .single()

  if (error || !data) {
    console.error('Planner recommendation refresh status message insert error:', error)
    return null
  }

  return data as PlanMessage
}

function didMatchAffectingFieldsChange(before: Plan, after: Plan): boolean {
  const beforeSnapshot = buildMatchAffectingSnapshot(before)
  const afterSnapshot = buildMatchAffectingSnapshot(after)
  return Object.keys(beforeSnapshot).some((key) => beforeSnapshot[key] !== afterSnapshot[key])
}

function findMatchAffectingChangedFields(before: Plan, after: Plan): string[] {
  const beforeSnapshot = buildMatchAffectingSnapshot(before)
  const afterSnapshot = buildMatchAffectingSnapshot(after)
  return Object.keys(beforeSnapshot).filter((key) => beforeSnapshot[key] !== afterSnapshot[key])
}

function buildMatchAffectingSnapshot(plan: Plan): Record<string, unknown> {
  const metadata = readRecord(plan.metadata)
  return {
    neighborhood: plan.neighborhood,
    guest_count: plan.guest_count,
    budget_cap_cents: plan.budget_cap_cents,
    ticketed: plan.ticketed,
    ticket_price_target: readNumber(metadata?.ticket_price_target_cents) ?? readNumber(metadata?.ticket_price_target),
    date_window_start: plan.date_window_start,
    date_window_end: plan.date_window_end,
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function pickChangedFields(plan: Plan, updates: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(updates).filter(([field, value]) => plan[field as keyof Plan] !== value)
  )
}

function isAllowedPlanStatusTransition(current: PlanStatus, next: PlanStatus) {
  if (current === next) return true

  const allowed: Record<PlanStatus, PlanStatus[]> = {
    drafting: ['ready', 'archived'],
    ready: ['approved', 'drafting', 'archived'],
    approved: ['executing', 'archived'],
    executing: ['complete', 'archived'],
    complete: ['archived'],
    archived: [],
  }

  return allowed[current].includes(next)
}

async function insertPlanUpdateRows(db: PlannerDb, plan: Plan, updates: Record<string, unknown>) {
  const rows = Object.entries(updates).map(([field, newValue]) => ({
    plan_id: plan.id,
    field,
    old_value: toJsonValue(plan[field as keyof Plan]),
    new_value: toJsonValue(newValue),
  }))

  if (rows.length === 0) return

  const { error } = await db.from('planner_plan_updates').insert(rows)
  if (error) console.error('Planner plan update audit insert error:', error)
}

function toJsonValue(value: unknown): Json {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    Array.isArray(value) ||
    (typeof value === 'object' && value !== null)
  ) {
    return value as Json
  }

  return null
}
