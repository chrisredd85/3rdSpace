export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

import { lookupBaseline } from '@/lib/planner/baselines'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

type RouteContext = {
  params: {
    planId: string
  }
}

type PlanBaselineRow = {
  id: string
  user_id: string
  event_type: string | null
  neighborhood: string | null
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: plan, error: planError } = await supabase
    .from('plans')
    .select('id, user_id, event_type, neighborhood')
    .eq('id', context.params.planId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (planError) {
    console.error('[planner.baselines] Failed to load plan', planError)
    return NextResponse.json({ error: 'Failed to load plan baseline' }, { status: 500 })
  }

  if (!plan) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }

  const typedPlan = plan as PlanBaselineRow
  const admin = createServiceRoleClient()
  const baseline = await lookupBaseline(admin, {
    organizerId: user.id,
    archetype: typedPlan.event_type,
    neighborhood: typedPlan.neighborhood,
  })

  return NextResponse.json({ baseline })
}
