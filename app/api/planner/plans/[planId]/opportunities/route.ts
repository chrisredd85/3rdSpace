/**
 * API route for planner venue/vendor opportunity briefs.
 *
 * POST creates the MVP opportunity marketplace bundle: brief, invites, a
 * `Send to venues` approval card, and concierge fallback tasks for unclaimed
 * listings. GET returns existing opportunity rows for the authenticated plan.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  PLAN_MESSAGE_SELECT_COLUMNS,
  PLAN_SELECT_COLUMNS,
  VENUE_OPPORTUNITY_BRIEF_SELECT_COLUMNS,
  VENUE_OPPORTUNITY_INVITE_SELECT_COLUMNS,
} from '@/lib/planner/dbSelects'
import { createVenueOpportunityBundle } from '@/lib/planner/opportunityBuilder'
import { createClient } from '@/lib/supabase/server'
import type {
  Json,
  Plan,
  PlanMessage,
  PlannerApiErrorResponse,
  PlannerOpportunityResponse,
  VenueOpportunityBrief,
  VenueOpportunityInvite,
} from '@/lib/types'

type PlannerDb = { from: (table: string) => any }
type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const postOpportunitySchema = z.object({
  force: z.boolean().optional(),
})

interface RouteContext {
  params: {
    planId: string
  }
}

/**
 * Returns existing opportunity briefs and invites for a planner plan.
 *
 * @param request - Authenticated builder request.
 * @param context - Route params containing the planner plan id.
 * @returns Latest opportunity and invite rows, when present.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<PlannerOpportunityResponse | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const existing = await loadLatestOpportunity(auth.db, context.params.planId)
    if (!existing) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })

    return NextResponse.json(existing)
  } catch (error) {
    console.error('Planner opportunity GET error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

/**
 * Creates a venue/vendor opportunity bundle for a coherent planner plan.
 *
 * @param request - Authenticated builder request with optional `{ force }`.
 * @param context - Route params containing the planner plan id.
 * @returns Created opportunity, invites, and approval message.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<PlannerOpportunityResponse | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const parsed = postOpportunitySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    if (!parsed.data.force) {
      const existing = await loadLatestOpportunity(auth.db, context.params.planId)
      if (existing) return NextResponse.json(existing)
    }

    const messages = await loadMessages(auth.db, context.params.planId)
    const bundle = await createVenueOpportunityBundle({
      db: auth.db,
      plan,
      messages,
      userId: auth.userId,
      force: parsed.data.force,
    })

    if (!bundle) {
      const existing = await loadLatestOpportunity(auth.db, context.params.planId)
      if (existing) return NextResponse.json(existing)
      return NextResponse.json({ error: 'Unable to create opportunity' }, { status: 500 })
    }

    return NextResponse.json({
      opportunity: bundle.opportunity,
      invites: bundle.invites,
      approval_message: bundle.approvalMessage,
    })
  } catch (error) {
    console.error('Planner opportunity POST error:', error)
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
    console.error('Planner opportunity plan lookup error:', error)
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
    console.error('Planner opportunity message lookup error:', error)
    return []
  }

  return (data ?? []) as PlanMessage[]
}

async function loadLatestOpportunity(
  db: PlannerDb,
  planId: string
): Promise<PlannerOpportunityResponse | null> {
  const { data: opportunityData, error } = await db
    .from('venue_opportunity_briefs')
    .select(VENUE_OPPORTUNITY_BRIEF_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !opportunityData) {
    if (error) console.error('Planner opportunity lookup error:', error)
    return null
  }

  const opportunity = opportunityData as VenueOpportunityBrief
  const { data: inviteData, error: inviteError } = await db
    .from('venue_opportunity_invites')
    .select(VENUE_OPPORTUNITY_INVITE_SELECT_COLUMNS)
    .eq('opportunity_id', opportunity.id)
    .order('match_score', { ascending: false })

  if (inviteError) {
    console.error('Planner opportunity invite lookup error:', inviteError)
    return null
  }

  return {
    opportunity,
    invites: (inviteData ?? []) as VenueOpportunityInvite[],
  }
}
