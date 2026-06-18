export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { reviewSettlementRun } from '@/lib/finance/settlement-runs'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const reviewSchema = z.object({
  action: z.enum(['approve', 'dispute']),
  dispute_reason: z.string().trim().min(10).max(1000).optional(),
}).superRefine((value, ctx) => {
  if (value.action === 'dispute' && !value.dispute_reason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dispute_reason'],
      message: 'Dispute reason is required',
    })
  }
})

export async function PATCH(
  request: NextRequest,
  context: { params: { runId: string } },
) {
  try {
    const supabase = createClient()
    const admin = createServiceRoleClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = reviewSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 422 })
    }

    const updated = await reviewSettlementRun(admin, {
      runId: context.params.runId,
      organizerId: user.id,
      action: parsed.data.action,
      disputeReason: parsed.data.dispute_reason ?? null,
    })

    if (!updated) {
      return NextResponse.json(
        { error: 'Settlement run was updated by another request. Refresh and try again.', code: 'settlement_stale' },
        { status: 409 },
      )
    }

    return NextResponse.json({ settlement_run: updated })
  } catch (error) {
    console.error('[settlement-runs.review] Failed to review settlement run', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to review settlement run' },
      { status: 500 },
    )
  }
}
