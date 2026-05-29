export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { sendVenueOverdueWarningEmail } from '@/lib/email'
import { getVenueComplianceStatus } from '@/lib/planner/venueComplianceGate'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

type VenueRow = {
  id: string
  venue_name: string | null
  last_overdue_count_notified: number | null
}

type VenueCronResult = {
  venue_id: string
  overdue_count: number
  previous_count: number
  notified: boolean
  updated: boolean
  error?: string
}

const notificationThresholds = [1, 2, 3]

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')

  if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createServiceRoleClient() as any
    const { data: venueRows, error: venuesError } = await admin
      .from('venues')
      .select('id, venue_name, last_overdue_count_notified')
      .order('created_at', { ascending: true })

    if (venuesError) {
      throw new Error(venuesError.message ?? 'Failed to load venues')
    }

    const results: VenueCronResult[] = []

    for (const venue of ((venueRows ?? []) as VenueRow[])) {
      results.push(await processVenue(admin, venue))
    }

    return NextResponse.json({
      ok: true,
      scanned: results.length,
      notified: results.filter((result) => result.notified).length,
      updated: results.filter((result) => result.updated).length,
      failed: results.filter((result) => result.error).length,
      results,
    })
  } catch (error) {
    console.error('[venue-overdue-check] Cron failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Venue overdue check failed' },
      { status: 500 }
    )
  }
}

async function processVenue(admin: any, venue: VenueRow): Promise<VenueCronResult> {
  const previousCount = Number(venue.last_overdue_count_notified ?? 0)

  try {
    const status = await getVenueComplianceStatus(admin, venue.id)
    const shouldNotify = shouldSendThresholdNotification(previousCount, status.overdue_count)

    if (shouldNotify) {
      await sendVenueOverdueWarningEmail({
        venueId: venue.id,
        overdueCount: status.overdue_count,
      })
    }

    const updated = await updateLastNotifiedCount(admin, venue.id, status.overdue_count)

    return {
      venue_id: venue.id,
      overdue_count: status.overdue_count,
      previous_count: previousCount,
      notified: shouldNotify,
      updated,
    }
  } catch (error) {
    console.error('[venue-overdue-check] Venue scan failed', {
      venue_id: venue.id,
      error,
    })
    return {
      venue_id: venue.id,
      overdue_count: previousCount,
      previous_count: previousCount,
      notified: false,
      updated: false,
      error: error instanceof Error ? error.message : 'Venue scan failed',
    }
  }
}

function shouldSendThresholdNotification(previousCount: number, overdueCount: number) {
  return notificationThresholds.some((threshold) => previousCount < threshold && overdueCount >= threshold)
}

async function updateLastNotifiedCount(admin: any, venueId: string, overdueCount: number) {
  const { error } = await admin
    .from('venues')
    .update({ last_overdue_count_notified: overdueCount })
    .eq('id', venueId)

  if (error) {
    throw new Error(error.message ?? 'Failed to update overdue notification count')
  }

  return true
}
