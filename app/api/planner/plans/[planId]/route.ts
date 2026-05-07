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
import { loadPlanAgentFields } from '@/lib/planner/planAgentSummaries'
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
  ticketing_model: z.string().trim().max(160).nullable().optional(),
  food_responsibility: z.string().trim().max(160).nullable().optional(),
  venue_terms: z.string().trim().max(160).nullable().optional(),
  agent_action: z.string().trim().max(160).nullable().optional(),
  profit_goal_cents: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
})

interface RouteContext {
  params: {
    planId: string
  }
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

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
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

    return NextResponse.json({
      plan: agentFields.plan,
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
): Promise<NextResponse<{ plan: Plan } | PlannerApiErrorResponse>> {
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

    const existingPlan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!existingPlan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const updates = normalizePlanPatch(parsed.data)
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

    return NextResponse.json({ plan: data as Plan })
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

function normalizePlanPatch(input: z.infer<typeof patchPlanSchema>): Record<string, unknown> {
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

  if (input.date_window !== undefined && input.date_window !== null) {
    updates.notes = [typeof updates.notes === 'string' ? updates.notes : null, `Date window: ${input.date_window}`]
      .filter(Boolean)
      .join('\n')
  }

  return updates
}

function pickChangedFields(plan: Plan, updates: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(updates).filter(([field, value]) => plan[field as keyof Plan] !== value)
  )
}

export function isAllowedPlanStatusTransition(current: PlanStatus, next: PlanStatus) {
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
