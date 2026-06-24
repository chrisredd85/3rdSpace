export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildWebsiteExtractionUpdate,
  shouldAttemptWebsiteExtraction,
  type DiscoveryVenueRow,
} from '@/lib/server/discovery-enrichment'
import { getWorkerOrAdminContext } from '@/lib/server/admin-auth'
import { extractVenueContacts } from '@/lib/server/venue-website-extractor'
import { enqueuePendingDraftsForDiscoveryVenue } from '@/lib/planner/discoveryOutreachDrafts'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database-generated'

type SupabaseAdminClient = SupabaseClient<Database, 'public'>
type DiscoveryVenue = Database['public']['Tables']['discovery_venues']['Row']
type DiscoveryVenueExtractionCandidate = Pick<
  DiscoveryVenue,
  | 'id'
  | 'name'
  | 'website'
  | 'contact_email'
  | 'extracted_emails'
  | 'website_extraction_status'
  | 'website_extraction_attempts'
  | 'metadata'
>

type ExtractionSummary = {
  processed: number
  successful: number
  failed: number
  no_emails: number
  rate_limited: number
  blocked_by_robots: number
  timeout: number
  skipped: number
}

const QUERY_LIMIT = 200
const PROCESS_LIMIT = 5
const BATCH_SIZE = 5

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')

  if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return runVenueWebsiteExtraction()
}

export async function POST(request: NextRequest) {
  const context = await getWorkerOrAdminContext(request)
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  return runVenueWebsiteExtraction()
}

async function runVenueWebsiteExtraction() {
  const startedAt = Date.now()
  console.info('[venue-website-extraction] invocation_started', {
    started_at: new Date(startedAt).toISOString(),
    process_limit: PROCESS_LIMIT,
    batch_size: BATCH_SIZE,
  })

  const admin = createServiceRoleClient() as SupabaseAdminClient
  const { data, error } = await admin
    .from('discovery_venues')
    .select('id,name,website,contact_email,extracted_emails,website_extraction_status,website_extraction_attempts,metadata')
    .not('website', 'is', null)
    .order('website_extraction_attempted_at', { ascending: true, nullsFirst: true })
    .limit(QUERY_LIMIT)
    .returns<DiscoveryVenueExtractionCandidate[]>()

  if (error) {
    Sentry.captureException(error, {
      tags: { component: 'venue_website_extraction_cron', phase: 'query' },
    })
    console.error('[venue-website-extraction] discovery_venues_query_failed', {
      error: error.message,
    })
    return NextResponse.json({ error: 'Failed to query discovery venues' }, { status: 500 })
  }

  const venues = (data ?? [])
    .filter((row) => shouldAttemptWebsiteExtraction(row as DiscoveryVenueRow))
    .slice(0, PROCESS_LIMIT)

  console.info('[venue-website-extraction] batch_selected', {
    queried: data?.length ?? 0,
    selected: venues.length,
  })

  const summary: ExtractionSummary = {
    processed: 0,
    successful: 0,
    failed: 0,
    no_emails: 0,
    rate_limited: 0,
    blocked_by_robots: 0,
    timeout: 0,
    skipped: 0,
  }
  const results: Array<{ id: string; status: string; emails: number; draft_approvals?: number; error?: string }> = []

  for (const batch of chunk(venues, BATCH_SIZE)) {
    const batchResults = await Promise.all(batch.map((venue) => processVenue(admin, venue)))
    for (const result of batchResults) {
      summary.processed += 1
      results.push(result)
      if (result.status === 'successful') summary.successful += 1
      else if (result.status === 'no_emails_found') summary.no_emails += 1
      else if (result.status === 'rate_limited') summary.rate_limited += 1
      else if (result.status === 'blocked_by_robots') summary.blocked_by_robots += 1
      else if (result.status === 'timeout') summary.timeout += 1
      else summary.failed += 1
      console.info('[venue-website-extraction] venue_processed', result)
    }
  }

  summary.skipped = Math.max(0, (data?.length ?? 0) - venues.length)
  const durationMs = Date.now() - startedAt
  console.info('[venue-website-extraction] invocation_completed', {
    duration_ms: durationMs,
    ...summary,
  })
  return NextResponse.json({ ...summary, duration_ms: durationMs, results })
}

async function processVenue(admin: SupabaseAdminClient, venue: DiscoveryVenueExtractionCandidate) {
  const attemptedAt = new Date().toISOString()

  try {
    const result = await extractVenueContacts(venue.website ?? '', {
      venueName: venue.name,
      venueType: readVenueType(venue.metadata),
    })
    const update = buildWebsiteExtractionUpdate(result, venue.website_extraction_attempts, attemptedAt)
    const { error } = await admin
      .from('discovery_venues')
      .update(update)
      .eq('id', venue.id)

    if (error) {
      Sentry.captureException(error, {
        tags: { component: 'venue_website_extraction_cron', phase: 'update' },
        extra: { discovery_venue_id: venue.id, extraction_status: result.status },
      })
      console.error('[venue-website-extraction] discovery_venue_update_failed', {
        discovery_venue_id: venue.id,
        status: result.status,
        error: error.message,
      })
      return { id: venue.id, status: 'fetch_failed', emails: result.emails.length, error: error.message }
    }

    let draftApprovals = 0
    if (result.emails.length > 0) {
      const draftResults = await enqueuePendingDraftsForDiscoveryVenue({
        db: admin,
        discoveryVenueId: venue.id,
      })
      draftApprovals = draftResults.filter((draft) => draft.status === 'draft_created').length
    }

    return { id: venue.id, status: result.status, emails: result.emails.length, draft_approvals: draftApprovals }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Website extraction failed'
    Sentry.captureException(error, {
      tags: { component: 'venue_website_extraction_cron', phase: 'process_venue' },
      extra: { discovery_venue_id: venue.id },
    })
    console.error('[venue-website-extraction] extraction_failed', {
      discovery_venue_id: venue.id,
      error: message,
    })

    const fallbackResult = {
      status: 'fetch_failed' as const,
      emails: [],
      metadata: {
        paths_attempted: [],
        paths_successful: [],
        total_fetch_time_ms: 0,
        robots_txt_consulted: false,
        error: message,
      },
    }
    await admin
      .from('discovery_venues')
      .update(buildWebsiteExtractionUpdate(fallbackResult, venue.website_extraction_attempts, attemptedAt))
      .eq('id', venue.id)

    return { id: venue.id, status: 'fetch_failed', emails: 0, error: message }
  }
}

function readVenueType(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return 'venue'
  const value = (metadata as Record<string, unknown>).venue_type
  return typeof value === 'string' && value.trim() ? value : 'venue'
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}
