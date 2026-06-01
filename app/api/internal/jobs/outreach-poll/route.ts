export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { runOutreachPoll } from '@/lib/outreach/poll'
import { createServiceRoleClient } from '@/lib/supabase/server'

/**
 * Polls creator Gmail threads for outreach replies and due follow-ups.
 */
export async function POST(request: NextRequest) {
  return runPollRequest(request)
}

export async function GET(request: NextRequest) {
  return runPollRequest(request)
}

async function runPollRequest(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createServiceRoleClient() as any
  const result = await runOutreachPoll(admin)
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
