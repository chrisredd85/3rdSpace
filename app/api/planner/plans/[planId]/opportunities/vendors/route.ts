export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { buildVendorOpportunityOutreach, OutreachApprovalRequiredError } from '@/lib/planner/opportunityOutreach'
import {
  createVendorOpportunityBrief,
  listVendorOpportunityBriefs,
} from '@/lib/planner/vendorOpportunityBriefs'
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

const vendorOpportunitySchema = z.object({
  vendor_ids: z.array(z.string().uuid()).min(1).max(12),
  package_type: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(4000),
  requirements: z.record(z.unknown()).default({}),
  response_deadline: z.string().datetime().nullable().optional(),
  quote_requested: z.boolean().optional(),
}).strict()

/**
 * Lists vendor opportunity briefs and queued quote invites for the current plan.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{ briefs: Awaited<ReturnType<typeof listVendorOpportunityBriefs>> } | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const briefs = await listVendorOpportunityBriefs(auth.db, plan.id)
    return NextResponse.json({ briefs })
  } catch (error) {
    console.error('Planner vendor opportunities GET error:', error)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}

/**
 * Creates a vendor quote/availability opportunity brief and queued invite rows.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{ brief: Record<string, unknown>; invites: Record<string, unknown>[] } | PlannerApiErrorResponse>> {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const parsed = vendorOpportunitySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const plan = await loadOwnedPlan(auth.db, context.params.planId, auth.userId)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const outreach = await buildVendorOpportunityOutreach({
      db: auth.db,
      plan,
      userId: auth.userId,
      vendorIds: parsed.data.vendor_ids,
      packageType: parsed.data.package_type,
      summary: parsed.data.summary,
      requirements: parsed.data.requirements,
      responseDeadline: parsed.data.response_deadline ?? null,
    })
    const result = await createVendorOpportunityBrief({
      db: auth.db,
      plan,
      userId: auth.userId,
      vendorIds: parsed.data.vendor_ids,
      packageType: parsed.data.package_type,
      summary: parsed.data.summary,
      requirements: outreach.requirements,
      responseDeadline: parsed.data.response_deadline ?? null,
      quoteRequested: parsed.data.quote_requested ?? true,
      approvalStatus: outreach.approvalStatus,
      outreachMessage: outreach.outreachMessage,
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof OutreachApprovalRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error('[agent.run] Planner vendor opportunities POST error', error)
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
    console.error('Planner vendor opportunity plan lookup error:', error)
    return null
  }

  return (data as Plan | null) ?? null
}
