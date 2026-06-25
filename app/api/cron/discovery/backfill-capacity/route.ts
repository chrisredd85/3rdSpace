export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { enqueueVenueCapacityBackfillJobs } from '@/lib/discovery/inferVenueCapacity'
import { getWorkerOrAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')

  if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return queueCapacityBackfill(request)
}

export async function POST(request: NextRequest) {
  const context = await getWorkerOrAdminContext(request)
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  return queueCapacityBackfill(request)
}

async function queueCapacityBackfill(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get('limit')
  const limit = Math.min(Math.max(Number(limitParam || 50) || 50, 1), 200)
  const admin = createServiceRoleClient()
  const result = await enqueueVenueCapacityBackfillJobs(admin as never, limit)

  return NextResponse.json({
    queued: result.queued,
    job_ids: result.jobs.map((job) => job.id),
  })
}
