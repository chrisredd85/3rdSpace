/**
 * Purpose: Triggers the AI recommendation pipeline for a plan and returns the
 * resulting plan_messages so the client can append them to its conversation state.
 *
 * This endpoint is called by the client *after* the messages route returns an
 * agent message with message_type 'recommendation', avoiding the need to run the
 * full AI recommend pipeline inside the messages route (which would cause timeouts).
 *
 * Key behaviours:
 * - Community-builder auth only.
 * - Calls createAutoRecommendationMessage which hits /api/planner/plans/[planId]/recommend.
 * - Returns { messages: PlanMessage[] } — may be empty if the pipeline errors.
 * - maxDuration = 60 gives the AI pipeline enough runway.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createAutoRecommendationMessage } from '@/lib/planner/autoRecommendations'
import { createClient } from '@/lib/supabase/server'
import type { PlannerApiErrorResponse } from '@/lib/types'

interface RouteContext {
  params: Promise<{
    planId: string
  }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  const supabase = createClient()
  const db = supabase as unknown as Parameters<typeof createAutoRecommendationMessage>[0]['db']

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json<PlannerApiErrorResponse>({ error: 'Not authenticated' }, { status: 401 })
  }

  if (user.user_metadata?.user_type !== 'community_builder') {
    return NextResponse.json<PlannerApiErrorResponse>({ error: 'Unauthorized' }, { status: 403 })
  }

  const { planId } = (await context.params)

  try {
    const messages = await createAutoRecommendationMessage({ db, request, planId })
    return NextResponse.json({ messages })
  } catch (error) {
    console.error('[trigger-recommendations] Unexpected error', error)
    return NextResponse.json({ messages: [] })
  }
}
