export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'

import { runVenueWebsiteExtraction } from '@/app/api/internal/jobs/venue-website-extraction/route'

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')

  if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  // Listing observations are request-only for both entity kinds. Keep independent
  // website extraction; it owns its separate, flag-gated exact-ID bootstrap.

  let discoveryExtraction: unknown = null
  try {
    const extractionResponse = await runVenueWebsiteExtraction()
    discoveryExtraction = await extractionResponse.json()
  } catch (error) {
    discoveryExtraction = {
      error: error instanceof Error ? error.message : 'Discovery extraction failed',
    }
    console.warn('[discovery.refresh-stale] website_extraction_failed', discoveryExtraction)
  }

  return NextResponse.json({
    ok: true,
    duration_ms: Date.now() - startedAt,
    refreshed: 0,
    changes_detected: 0,
    discovery_extraction: discoveryExtraction,
    errors: [],
    skipped_query_errors: [],
  })
}
