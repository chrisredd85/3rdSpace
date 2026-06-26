import { NextRequest, NextResponse } from 'next/server'

import { startSettlementCheckout } from '@/lib/finance/settlement-checkout'
import { enforceSettlementTokenRateLimit } from '@/lib/server/settlement-token-rate-limit'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

    const admin = createServiceRoleClient()
    const result = await startSettlementCheckout(admin, (await context.params).token, request)
    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    console.error('[venue.settlement.pay] Failed to create settlement checkout', error)
    return NextResponse.json(
      { error: 'Unable to start settlement checkout', code: 'checkout_failed' },
      { status: 500 },
    )
  }
}
