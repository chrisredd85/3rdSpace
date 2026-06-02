export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { recomputeOutreachTrustScores } from '@/lib/outreach/autonomy'
import { createServiceRoleClient } from '@/lib/supabase/server'

/**
 * Weekly trust-score recompute. This updates trust but never enables autonomy.
 */
export async function POST(request: NextRequest) {
  return runTrustRecomputeRequest(request)
}

export async function GET(request: NextRequest) {
  return runTrustRecomputeRequest(request)
}

async function runTrustRecomputeRequest(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createServiceRoleClient() as any
  const result = await recomputeOutreachTrustScores(admin)
  return NextResponse.json(result)
}

function isAuthorizedCron(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'

  const headerSecret = request.headers.get('x-cron-secret')
  const authHeader = request.headers.get('authorization')
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  return headerSecret === secret || bearer === secret
}
