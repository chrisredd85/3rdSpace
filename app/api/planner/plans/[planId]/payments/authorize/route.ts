export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { APPROVAL_SELECT_COLUMNS, PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { authorizePlannerDeposit } from '@/lib/planner/depositPayments'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { Approval, Json, Plan, PlannerApiErrorResponse } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }

interface RouteContext {
  params: {
    planId: string
  }
}

const authorizeDepositSchema = z.object({
  approvalId: z.string().uuid(),
  partnerKind: z.enum(['venue', 'vendor']),
  partnerId: z.string().uuid(),
  amountCents: z.number().int().min(50),
  paymentMethodId: z.string().trim().min(1).nullable().optional(),
  refundTerms: z.string().trim().max(1000).nullable().optional(),
  platformFeeCents: z.number().int().nonnegative().nullable().optional(),
}).strict()

/**
 * Creates a planner deposit authorization after the related approval is authorized.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<{ paymentIntent: Awaited<ReturnType<typeof authorizePlannerDeposit>> } | PlannerApiErrorResponse>> {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    if (user.user_metadata?.user_type !== 'community_builder') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const parsed = authorizeDepositSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const admin = createServiceRoleClient() as unknown as PlannerDb
    const plan = await loadOwnedPlan(admin, context.params.planId, user.id)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const approval = await loadPlanApproval(admin, context.params.planId, parsed.data.approvalId)
    if (!approval) return NextResponse.json({ error: 'Approval not found' }, { status: 404 })

    if (approval.status !== 'authorized' && approval.status !== 'approved') {
      return NextResponse.json({ error: 'Authorize the approval before authorizing a deposit' }, { status: 422 })
    }

    const paymentIntent = await authorizePlannerDeposit({
      db: admin,
      plan,
      approval,
      userId: user.id,
      partnerKind: parsed.data.partnerKind,
      partnerId: parsed.data.partnerId,
      amountCents: parsed.data.amountCents,
      paymentMethodId: parsed.data.paymentMethodId ?? null,
      refundTerms: parsed.data.refundTerms ?? approval.refund_terms,
      platformFeeCents: parsed.data.platformFeeCents ?? 0,
    })

    return NextResponse.json({ paymentIntent })
  } catch (error) {
    console.error('Planner deposit authorize error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to authorize deposit' },
      { status: 500 }
    )
  }
}

async function loadOwnedPlan(db: PlannerDb, planId: string, userId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as Plan | null) ?? null
}

async function loadPlanApproval(db: PlannerDb, planId: string, approvalId: string): Promise<Approval | null> {
  const { data, error } = await db
    .from('approvals')
    .select(APPROVAL_SELECT_COLUMNS)
    .eq('id', approvalId)
    .eq('plan_id', planId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as Approval | null) ?? null
}
