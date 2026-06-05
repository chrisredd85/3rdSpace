export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  buildMobileBudgetReadModel,
  loadOwnedMobilePlan,
  type PlannerDb,
} from '@/lib/planner/mobileReadModels'
import { createClient } from '@/lib/supabase/server'
import type { PlannerApiErrorResponse } from '@/lib/types'

type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const budgetQuerySchema = z.object({
  actionAmountCents: z.coerce.number().int().nonnegative().nullable().optional(),
})

interface RouteContext {
  params: {
    planId: string
  }
}

/**
 * Returns plan-scoped budget totals for the mobile budget drilldown.
 * All money values are integer cents.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const parsed = budgetQuerySchema.safeParse({
      actionAmountCents: request.nextUrl.searchParams.get('actionAmountCents'),
    })
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
    }

    const plan = await loadOwnedMobilePlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    return NextResponse.json(await buildMobileBudgetReadModel(
      auth.db,
      plan,
      parsed.data.actionAmountCents ?? null
    ))
  } catch (error) {
    console.error('[mobile.planner.budget] GET failed', error)
    return NextResponse.json({ error: 'Unable to load mobile budget' }, { status: 500 })
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
