export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import {
  cancelStagedCanonicalQuoteBooking,
  stageCanonicalQuoteBooking,
} from '@/lib/planner/execution/canonicalQuoteBooking'
import { recomputePlanDerivedState } from '@/lib/planner/recomputeDerivedState'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { Plan } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }

interface RouteContext {
  params: Promise<{
    planId: string
  }>
}

const commitVenueSchema = z.object({
  response_id: z.string().uuid(),
}).strict()

const cancelVenueSchema = commitVenueSchema

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await getCreatorAuth()
  if ('response' in auth) return auth.response

  const body = await request.json().catch(() => null)
  const parsed = commitVenueSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid venue commitment payload', issues: parsed.error.flatten() }, { status: 400 })
  }

  const plan = await loadOwnedPlan(auth.db, (await context.params).planId, auth.userId)
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  const reapprovalResponse = requireMutableQuotePlan(plan)
  if (reapprovalResponse) return reapprovalResponse
  const planId = (await context.params).planId
  const writeDb = createServiceRoleClient() as unknown as PlannerDb
  let staged
  try {
    staged = await stageCanonicalQuoteBooking({
      db: writeDb,
      plan,
      actorId: auth.userId,
      quoteKind: 'venue',
      responseId: parsed.data.response_id,
    })
  } catch (error) {
    return mapQuoteBookingError(error)
  }

  await recomputePlanDerivedState({
    supabase: auth.db,
    writeSupabase: writeDb,
    baselineSupabase: writeDb,
    planId,
    trigger: 'commit_changed',
  })
  const refreshedPlan = await loadOwnedPlan(auth.db, planId, auth.userId)
  const responsePlan = refreshedPlan ?? staged.plan
  return NextResponse.json({
    plan: responsePlan,
    canonical_event_id: responsePlan.materialized_event_id ?? null,
    agentAction: staged.agent_action,
    approval: staged.approval,
    approvalMessage: staged.approval_message,
    existing: staged.existing,
    booking_status: 'approval_required',
  })
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await getCreatorAuth()
  if ('response' in auth) return auth.response

  const body = await request.json().catch(() => null)
  const parsed = cancelVenueSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid venue cancellation payload', issues: parsed.error.flatten() }, { status: 400 })
  }

  const planId = (await context.params).planId
  const plan = await loadOwnedPlan(auth.db, planId, auth.userId)
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  const reapprovalResponse = requireMutableQuotePlan(plan)
  if (reapprovalResponse) return reapprovalResponse
  const writeDb = createServiceRoleClient() as unknown as PlannerDb
  let cancelled
  try {
    cancelled = await cancelStagedCanonicalQuoteBooking({
      db: writeDb,
      planId,
      actorId: auth.userId,
      quoteKind: 'venue',
      responseId: parsed.data.response_id,
    })
  } catch (error) {
    return mapQuoteBookingError(error)
  }

  await recomputePlanDerivedState({
    supabase: auth.db,
    writeSupabase: writeDb,
    baselineSupabase: writeDb,
    planId,
    trigger: 'cancel_commit',
  })
  const refreshedPlan = await loadOwnedPlan(auth.db, planId, auth.userId)
  const responsePlan = refreshedPlan ?? cancelled.plan
  return NextResponse.json({
    plan: responsePlan,
    canonical_event_id: responsePlan.materialized_event_id ?? null,
    agentAction: cancelled.agent_action,
    approval: cancelled.approval,
    existing: cancelled.existing,
    booking_status: 'cancelled_before_authorization',
  })
}

async function getCreatorAuth(): Promise<
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<{ error: string }> }
> {
  const supabase = createClient()
  const db = supabase as unknown as PlannerDb
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
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
  if (error) throw new Error(error.message)
  return data as Plan | null
}

function requireMutableQuotePlan(plan: Plan) {
  if (
    (!plan.materialized_event_id && (plan.status === 'drafting' || plan.status === 'ready')) ||
    (Boolean(plan.materialized_event_id) && (plan.status === 'executing' || plan.status === 'booked'))
  ) {
    return null
  }

  return NextResponse.json(
    {
      error: 'Existing approved quote terms are frozen. Revise the plan and complete re-approval before changing venue, vendor, price, or terms.',
      code: 'PLAN_REAPPROVAL_REQUIRED',
      plan_id: plan.id,
      plan_status: plan.status,
      materialized_event_id: plan.materialized_event_id ?? null,
    },
    { status: 409 }
  )
}

function mapQuoteBookingError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Failed to stage venue quote booking'
  if (/response_not_found/i.test(message)) {
    return NextResponse.json({ error: 'Venue quote response not found' }, { status: 404 })
  }
  if (/action_not_found|approval_not_found/i.test(message)) {
    return NextResponse.json({ error: 'Pending venue booking approval not found' }, { status: 404 })
  }
  if (/response_not_actionable/i.test(message)) {
    return NextResponse.json({ error: 'This venue response does not contain an actionable quote' }, { status: 409 })
  }
  if (/exact_date_required/i.test(message)) {
    return NextResponse.json(
      {
        error: 'Choose one exact event date before creating the booking approval',
        code: 'canonical_quote_booking_exact_date_required',
      },
      { status: 409 }
    )
  }
  if (/active_slot_exists|23505/i.test(message)) {
    return NextResponse.json(
      { error: 'Cancel the current venue booking approval before choosing another quote', code: 'canonical_quote_booking_active' },
      { status: 409 }
    )
  }
  if (/requires_mutable_plan|requires_reapproval/i.test(message)) {
    return NextResponse.json(
      { error: 'This quote changed after approval. Create a new approval version before booking.', code: 'PLAN_REAPPROVAL_REQUIRED' },
      { status: 409 }
    )
  }
  if (/requires_pending_approval/i.test(message)) {
    return NextResponse.json(
      { error: 'This booking approval is no longer pending. Use the approval workflow to cancel or revise it.', code: 'canonical_quote_booking_not_pending' },
      { status: 409 }
    )
  }
  console.error('[planner.commit-venue] Failed to stage canonical quote booking', error)
  return NextResponse.json({ error: 'Failed to create venue booking approval' }, { status: 500 })
}
