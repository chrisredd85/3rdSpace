/**
 * API route for planner plan revisions.
 *
 * POST is the explicit non-chat entry point for admin or freshness-triggered
 * changes that should supersede stale recommendations/approvals before
 * rediscovery. Chat-driven revisions are applied from the messages route.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { applyPlanRevision, type PlanRevisionTrigger } from '@/lib/planner/planRevisions'
import { createClient } from '@/lib/supabase/server'
import type { Json, Plan, PlanRevision, PlannerApiErrorResponse } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }
type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const planRevisionTriggerSchema = z.object({
  type: z.enum([
    'negative_preference',
    'positive_preference',
    'vendor_stack_addition',
    'vendor_stack_removal',
    'date_change',
    'guest_count_change',
    'budget_change',
    'venue_swap',
    'scope_change',
    'discovery_data_changed',
  ]),
  field: z.string().trim().min(1).max(120),
  value: z.unknown(),
  source_message_excerpt: z.string().trim().min(1).max(500).optional(),
})

const postRevisionSchema = z.object({
  trigger: planRevisionTriggerSchema,
  sourceMessageId: z.string().uuid().optional(),
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
  profit_goal_cents,
  notes,
  metadata,
  created_at,
  updated_at
`

const PLAN_REVISION_SELECT_COLUMNS = `
  id,
  plan_id,
  triggered_by_user_id,
  trigger_type,
  trigger_payload,
  source_message_id,
  impact_summary,
  rediscovery_triggered_for,
  applied_at,
  audit_log_id
`

interface RouteContext {
  params: Promise<{ planId: string }>
}

export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{ revisions: PlanRevision[] } | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const planId = (await context.params).planId
    const plan = await loadOwnedPlan(auth.db, planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const { data, error } = await auth.db
      .from('plan_revisions')
      .select(PLAN_REVISION_SELECT_COLUMNS)
      .eq('plan_id', planId)
      .order('applied_at', { ascending: false })

    if (error) {
      console.error('[planner.revisions] Revision history lookup failed', error)
      return NextResponse.json({ error: 'Failed to fetch plan revisions' }, { status: 500 })
    }

    return NextResponse.json({ revisions: (data ?? []) as PlanRevision[] })
  } catch (error) {
    console.error('[planner.revisions] GET failed', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{ revision_id: string; impact: Json } | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const parsed = postRevisionSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const planId = (await context.params).planId
    const plan = await loadOwnedPlan(auth.db, planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const result = await applyPlanRevision({
      supabase: auth.db,
      planId,
      userId: auth.userId,
      trigger: parsed.data.trigger as PlanRevisionTrigger,
      sourceMessageId: parsed.data.sourceMessageId,
    })

    return NextResponse.json({
      revision_id: result.revision_id,
      impact: result.impact as unknown as Json,
    })
  } catch (error) {
    console.error('[planner.revisions] POST failed', error)
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
    console.error('[planner.revisions] Plan ownership lookup failed', error)
    return null
  }

  return (data as Plan | null) ?? null
}
