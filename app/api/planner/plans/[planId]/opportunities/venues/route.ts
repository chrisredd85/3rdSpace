export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { buildVenueOpportunityOutreach } from '@/lib/planner/opportunityOutreach'
import {
  createVenueOpportunityBrief,
  listVenueOpportunityBriefs,
} from '@/lib/planner/venueOpportunityBriefs'
import { createClient } from '@/lib/supabase/server'
import type { Json, Plan, PlannerApiErrorResponse } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }
type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

interface RouteContext {
  params: {
    planId: string
  }
}

const venueOpportunitySchema = z.object({
  venue_ids: z.array(z.string().uuid()).min(1).max(12),
  summary: z.string().trim().min(1).max(4000),
  requirements: z.record(z.unknown()).default({}),
  response_deadline: z.string().datetime().nullable().optional(),
}).strict()

/**
 * Lists venue opportunity briefs and queued invites for the current plan.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{ briefs: Awaited<ReturnType<typeof listVenueOpportunityBriefs>> } | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const briefs = await listVenueOpportunityBriefs(auth.db, plan.id)
    return NextResponse.json({ briefs })
  } catch (error) {
    console.error('Planner venue opportunities GET error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

/**
 * Creates a venue opportunity brief and queued invite rows.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{ brief: Record<string, unknown>; invites: Record<string, unknown>[] } | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const parsed = venueOpportunitySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const outreach = await buildVenueOpportunityOutreach({
      db: auth.db,
      plan,
      userId: auth.userId,
      venueIds: parsed.data.venue_ids,
      summary: parsed.data.summary,
      requirements: parsed.data.requirements,
      responseDeadline: parsed.data.response_deadline ?? null,
    })
    const result = await createVenueOpportunityBrief({
      db: auth.db,
      plan,
      userId: auth.userId,
      venueIds: parsed.data.venue_ids,
      summary: parsed.data.summary,
      requirements: outreach.requirements,
      responseDeadline: parsed.data.response_deadline ?? null,
      approvalStatus: outreach.approvalStatus,
      outreachMessage: outreach.outreachMessage,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[agent.run] Planner venue opportunities POST error', error)
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
    console.error('Planner venue opportunity plan lookup error:', error)
    return null
  }

  return (data as Plan | null) ?? null
}
