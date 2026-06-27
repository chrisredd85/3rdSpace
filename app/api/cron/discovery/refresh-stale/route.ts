export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

import { refreshDiscoveryEntityFromPlaces } from '@/lib/discovery/refreshDiscoveryFromPlaces'
import { createServiceRoleClient } from '@/lib/supabase/server'

type RefreshCandidate = {
  id: string
  last_places_refresh_at?: string | null
}

const BATCH_LIMIT_PER_TYPE = 25

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')

  if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GOOGLE_PLACES_API_KEY is not configured' }, { status: 500 })
  }

  const startedAt = Date.now()
  const admin = createServiceRoleClient() as any
  const [venueResult, vendorResult] = await Promise.all([
    loadStaleCandidates(admin, 'discovery_venues'),
    loadStaleCandidates(admin, 'discovery_vendors'),
  ])

  const errors: Array<{ entity_type: string; entity_id: string; error: string }> = []
  const results = []

  for (const venue of venueResult.rows) {
    try {
      results.push(await refreshDiscoveryEntityFromPlaces({
        supabase: admin,
        entityType: 'discovery_venue',
        entityId: venue.id,
        apiKey,
      }))
    } catch (error) {
      errors.push({ entity_type: 'discovery_venue', entity_id: venue.id, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }

  for (const vendor of vendorResult.rows) {
    try {
      results.push(await refreshDiscoveryEntityFromPlaces({
        supabase: admin,
        entityType: 'discovery_vendor',
        entityId: vendor.id,
        apiKey,
      }))
    } catch (error) {
      errors.push({ entity_type: 'discovery_vendor', entity_id: vendor.id, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }

  return NextResponse.json({
    ok: true,
    duration_ms: Date.now() - startedAt,
    refreshed: results.length,
    changes_detected: results.reduce((sum, result) => sum + result.changes_detected, 0),
    errors,
    skipped_query_errors: [...venueResult.errors, ...vendorResult.errors],
  })
}

async function loadStaleCandidates(
  admin: any,
  table: 'discovery_venues' | 'discovery_vendors'
): Promise<{ rows: RefreshCandidate[]; errors: Array<{ table: string; error: string }> }> {
  const { data, error } = await admin
    .from(table)
    .select('id,last_places_refresh_at')
    .or('last_places_refresh_at.is.null,last_places_refresh_at.lt.' + new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('last_places_refresh_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_LIMIT_PER_TYPE)

  if (error) {
    console.error('[discovery.refresh-stale] candidate_lookup_failed', { table, error: error.message })
    return { rows: [], errors: [{ table, error: error.message }] }
  }

  return { rows: (data ?? []) as RefreshCandidate[], errors: [] }
}
