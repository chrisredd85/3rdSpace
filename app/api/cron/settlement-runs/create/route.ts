export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

import { isChiEligibleVenueType } from '@/lib/finance/chi-eligibility'
import { enqueueJob, type SupabaseJobClient } from '@/lib/server/job-queue'
import { createServiceRoleClient } from '@/lib/supabase/server'

type EventCandidate = {
  id: string
  event_date: string
  venue_id: string | null
  venues?: {
    venue_type: string | null
  } | null
}

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')

  if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createServiceRoleClient()
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const { data, error } = await (admin as any)
      .from('events')
      .select('id, event_date, venue_id, venues(venue_type)')
      .not('venue_id', 'is', null)
      .lte('event_date', cutoff)
      .order('event_date', { ascending: true })
      .limit(100)

    if (error) throw new Error(error.message ?? 'Failed to load settlement run candidates')

    let enqueued = 0
    let skippedNotEligible = 0
    let skippedExistingRun = 0
    let failed = 0
    const jobIds: string[] = []
    const errors: Array<{ event_id: string; error: string }> = []

    for (const event of ((data ?? []) as EventCandidate[])) {
      try {
        const existingRun = await loadExistingSettlementRun(admin, event.id)
        if (existingRun) {
          skippedExistingRun += 1
          continue
        }

        if (!isChiEligibleVenueType(event.venues?.venue_type)) {
          skippedNotEligible += 1
          continue
        }

        const job = await enqueueJob(admin as unknown as SupabaseJobClient, {
          jobType: 'settlement.run.create',
          payload: { event_id: event.id },
          uniqueKey: `settlement-run-create:${event.id}`,
          maxAttempts: 3,
        })
        jobIds.push(job.id)
        enqueued += 1
      } catch (error) {
        failed += 1
        errors.push({
          event_id: event.id,
          error: error instanceof Error ? error.message : 'Failed to enqueue settlement run',
        })
        console.error('[settlement-runs.create] Candidate failed', {
          eventId: event.id,
          error,
        })
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: (data ?? []).length,
      enqueued,
      skipped_not_eligible: skippedNotEligible,
      skipped_existing_run: skippedExistingRun,
      failed,
      errors: errors.slice(0, 10),
      job_ids: jobIds,
    })
  } catch (error) {
    console.error('[settlement-runs.create] Cron failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Settlement run cron failed' },
      { status: 500 },
    )
  }
}

async function loadExistingSettlementRun(admin: ReturnType<typeof createServiceRoleClient>, eventId: string) {
  const { data, error } = await (admin as any)
    .from('settlement_runs')
    .select('id')
    .eq('event_id', eventId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load existing settlement run')
  return data
}
