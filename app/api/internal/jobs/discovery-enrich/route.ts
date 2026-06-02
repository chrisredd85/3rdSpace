export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { enrichDiscoveryVenues } from '@/lib/server/discovery-enrichment'
import { createServiceRoleClient } from '@/lib/supabase/server'

/**
 * Refreshes discovery venue metadata from Google Places Details.
 */
export async function POST(request: NextRequest) {
  return runDiscoveryEnrichRequest(request)
}

export async function GET(request: NextRequest) {
  return runDiscoveryEnrichRequest(request)
}

async function runDiscoveryEnrichRequest(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const requestedLimit = Number(request.nextUrl.searchParams.get('limit') ?? '50')
  const limit = Number.isFinite(requestedLimit) ? requestedLimit : 50
  const admin = createServiceRoleClient() as any
  const result = await enrichDiscoveryVenues({ db: admin, limit })
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
