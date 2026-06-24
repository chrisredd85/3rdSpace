export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { enqueueVenueCapacityInferenceJob } from '@/lib/discovery/venueCapacityJobs'

type DiscoveryVenueBackfillRow = {
  id: string
  capacity_seated: number | null
  capacity_standing: number | null
  capacity_cocktail: number | null
  capacity_inference_extracted_at: string | null
}

const MAX_BACKFILL_JOBS_PER_INVOCATION = 50

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')

  if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createServiceRoleClient() as any
  const limitParam = Number(request.nextUrl.searchParams.get('limit') ?? MAX_BACKFILL_JOBS_PER_INVOCATION)
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? Math.trunc(limitParam) : MAX_BACKFILL_JOBS_PER_INVOCATION, 1), MAX_BACKFILL_JOBS_PER_INVOCATION)

  const { data, error } = await admin
    .from('discovery_venues')
    .select('id,capacity_seated,capacity_standing,capacity_cocktail,capacity_inference_extracted_at')
    .is('capacity_inference_extracted_at', null)
    .is('capacity_seated', null)
    .is('capacity_standing', null)
    .is('capacity_cocktail', null)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) {
    Sentry.captureException(error, {
      tags: { component: 'venue_capacity_backfill', phase: 'query' },
    })
    return NextResponse.json({ error: 'Failed to query discovery venues' }, { status: 500 })
  }

  const rows = (data ?? []) as DiscoveryVenueBackfillRow[]
  const results: Array<{ id: string; queued: boolean; error?: string }> = []
  for (const row of rows) {
    try {
      await enqueueVenueCapacityInferenceJob(admin, row.id)
      results.push({ id: row.id, queued: true })
    } catch (enqueueError) {
      const message = enqueueError instanceof Error ? enqueueError.message : 'Failed to enqueue capacity job'
      Sentry.captureException(enqueueError, {
        tags: { component: 'venue_capacity_backfill', phase: 'enqueue' },
        extra: { discovery_venue_id: row.id },
      })
      results.push({ id: row.id, queued: false, error: message })
    }
  }

  return NextResponse.json({
    selected: rows.length,
    queued: results.filter((result) => result.queued).length,
    limit,
    results,
  })
}
