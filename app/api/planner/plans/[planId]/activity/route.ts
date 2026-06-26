export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import {
  buildMobileActivityReadModel,
  loadOwnedMobilePlan,
  type PlannerDb,
} from '@/lib/planner/mobileReadModels'
import { createClient } from '@/lib/supabase/server'
import type { PlannerApiErrorResponse } from '@/lib/types'

type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

interface RouteContext {
  params: Promise<{
    planId: string
  }>
}

/**
 * Returns mobile-safe plan activity. Outreach events are excluded until the
 * outreach runtime lands on main.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedMobilePlan(auth.db, (await context.params).planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    return NextResponse.json(await buildMobileActivityReadModel(auth.db, plan))
  } catch (error) {
    console.error('[mobile.planner.activity] GET failed', error)
    return NextResponse.json({ error: 'Unable to load mobile activity' }, { status: 500 })
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
