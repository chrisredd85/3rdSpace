export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import {
  buildMobileHomeReadModel,
  loadOwnedMobilePlan,
  type PlannerDb,
} from '@/lib/planner/mobileReadModels'
import { createClient } from '@/lib/supabase/server'
import type { PlannerApiErrorResponse } from '@/lib/types'

type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

interface RouteContext {
  params: {
    planId: string
  }
}

/**
 * Returns the compact read model used by the mobile planner home surface.
 * This endpoint reads existing plan data only; it does not book, send, or pay.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedMobilePlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    return NextResponse.json(await buildMobileHomeReadModel(auth.db, plan))
  } catch (error) {
    console.error('[mobile.planner.home] GET failed', error)
    return NextResponse.json({ error: 'Unable to load mobile planner home' }, { status: 500 })
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
