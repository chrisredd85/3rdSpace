import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { disputeSettlementFromVenueToken } from '@/lib/finance/settlement-checkout'
import { enforceSettlementTokenRateLimit } from '@/lib/server/settlement-token-rate-limit'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  reason: z.string().max(2000).optional().nullable(),
})

type RouteContext = {
  params: Promise<{
    token: string
  }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const rateLimit = await enforceSettlementTokenRateLimit(request, {
      token: (await context.params).token,
      kind: 'action',
    })
    if (rateLimit.limited) return rateLimit.response

    const body = BodySchema.parse(await request.json().catch(() => ({})))
    const admin = createServiceRoleClient()
    const result = await disputeSettlementFromVenueToken(admin, (await context.params).token, body.reason ?? null)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid dispute payload', details: error.flatten() }, { status: 422 })
    }
    console.error('[venue.settlement.dispute] Failed to dispute settlement', error)
    return NextResponse.json(
      { error: 'Unable to dispute settlement', code: 'dispute_failed' },
      { status: 500 },
    )
  }
}
