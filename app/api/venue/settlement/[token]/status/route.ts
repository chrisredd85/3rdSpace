import { NextRequest, NextResponse } from 'next/server'

import { getVenueSettlementTokenState } from '@/lib/finance/settlement-checkout'
import { enforceSettlementTokenRateLimit } from '@/lib/server/settlement-token-rate-limit'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{
    token: string
  }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const rateLimit = await enforceSettlementTokenRateLimit(request, {
      token: (await context.params).token,
      kind: 'view',
    })
    if (rateLimit.limited) return rateLimit.response

    const admin = createServiceRoleClient()
    const state = await getVenueSettlementTokenState(admin, (await context.params).token)

    if (state === 'revoked') {
      return NextResponse.json(
        { error: 'Settlement token revoked', code: 'token_revoked' },
        { status: 410 }
      )
    }
    if (state === 'expired') {
      return NextResponse.json(
        { error: 'Settlement token expired', code: 'token_expired' },
        { status: 404 }
      )
    }
    if (state === 'missing') {
      return NextResponse.json(
        { error: 'Settlement token not found', code: 'token_not_found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ status: 'valid' })
  } catch (error) {
    console.error('[venue.settlement.status] Failed to check settlement token state', error)
    return NextResponse.json(
      { error: 'Unable to verify settlement token', code: 'token_status_failed' },
      { status: 500 }
    )
  }
}
