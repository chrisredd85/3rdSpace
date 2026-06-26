export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { GmailConnectionRequiredError } from '@/lib/outreach/gmailApprovalFlow'
import { PLAN_MESSAGE_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import {
  createDateChangeOutreachApproval,
  DateChangeNoTargetsError,
  DateChangePlanNotFoundError,
  type PlannerDb,
} from '@/lib/planner/dateChangeOutreach'
import {
  ensurePlannerEventAccess,
  PlannerProductAccessActivationError,
  PlannerProductAccessRequiredError,
  productAccessErrorResponse,
} from '@/lib/planner/productAccess'
import { createClient } from '@/lib/supabase/server'
import type { PlanMessage, PlannerApiErrorResponse } from '@/lib/types'

type RouteContext = {
  params: Promise<{
    planId: string
  }>
}

type PlannerAuth =
  | { db: PlannerDb; userId: string }
  | { response: NextResponse<PlannerApiErrorResponse> }

const dateChangeTargetSchema = z.object({
  kind: z.enum(['venue', 'vendor']).default('venue'),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
})

const dateChangeSchema = z.object({
  dateWindowStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateWindowEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  targets: z.array(dateChangeTargetSchema).max(6).optional(),
}).strict()

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await getPlannerAuth()
    if ('response' in auth) return auth.response

    const parsed = dateChangeSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const result = await createDateChangeOutreachApproval(auth.db, {
      userId: auth.userId,
      planId: (await context.params).planId,
      dateWindowStart: parsed.data.dateWindowStart,
      dateWindowEnd: parsed.data.dateWindowEnd,
      note: parsed.data.note,
      targets: parsed.data.targets,
      ensureProductAccess: (plan) => ensurePlannerEventAccess({
        plan,
        userId: auth.userId,
        reason: 'date_change_started',
      }),
    })
    const messages = await loadPlanMessages(auth.db, (await context.params).planId)

    return NextResponse.json({
      plan: result.plan,
      messages,
      approval_id: result.approval.id,
      approval_message_id: result.approvalMessageId,
      redirect_url: result.redirectUrl,
      target_count: result.targetCount,
    })
  } catch (error) {
    if (error instanceof DateChangePlanNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    if (error instanceof GmailConnectionRequiredError) {
      return NextResponse.json({ error: error.message, gmail_required: true }, { status: 409 })
    }

    if (error instanceof DateChangeNoTargetsError) {
      return NextResponse.json({ error: error.message, contact_required: true }, { status: 400 })
    }

    if (error instanceof PlannerProductAccessRequiredError) {
      return NextResponse.json(productAccessErrorResponse(error), { status: error.status })
    }

    if (error instanceof PlannerProductAccessActivationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    console.error('[planner.date-change] POST failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create date-change outreach approval' },
      { status: 500 }
    )
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

async function loadPlanMessages(db: PlannerDb, planId: string): Promise<PlanMessage[]> {
  const { data, error } = await db
    .from('plan_messages')
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[planner.date-change] failed to reload plan messages', error)
    return []
  }

  return (data ?? []) as PlanMessage[]
}
