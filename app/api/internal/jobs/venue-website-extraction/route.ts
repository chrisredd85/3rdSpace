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
import { inferVendorRate, shouldSkipVendorRateInference } from '@/lib/discovery/inferVendorRate'
import { enqueueVenueCapacityInferenceJob, hasKnownCapacity } from '@/lib/discovery/venueCapacityJobs'
import { getWorkerOrAdminContext } from '@/lib/server/admin-auth'
import { extractVenueContacts } from '@/lib/server/venue-website-extractor'
import { enqueuePendingDraftsForDiscoveryVenue } from '@/lib/planner/discoveryOutreachDrafts'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { SupabaseJobClient } from '@/lib/server/job-queue'
import type { Database, Json } from '@/lib/types/database-generated'

type SupabaseAdminClient = SupabaseClient<any, 'public'>
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
  | 'capacity_seated'
  | 'capacity_standing'
  | 'capacity_cocktail'
> & {
  capacity_inference_extracted_at?: string | null
}

type DiscoveryVendorExtractionCandidate = {
  id: string
  name: string
  service_type: string | null
  website: string | null
  contact_email: string | null
  organizer_provided_email: string | null
  extracted_emails: Json | null
  website_extraction_status: string | null
  website_extraction_attempts: number | null
  place_types: Json | null
  rate_inference_extracted_at: string | null
}

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
const VENDOR_PROCESS_LIMIT = 5
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
    .select('id,name,website,contact_email,extracted_emails,website_extraction_status,website_extraction_attempts,metadata,capacity_seated,capacity_standing,capacity_cocktail,capacity_inference_extracted_at')
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

  const { data: vendorData, error: vendorError } = await admin
    .from('discovery_vendors')
    .select('id,name,service_type,website,contact_email,organizer_provided_email,extracted_emails,website_extraction_status,website_extraction_attempts,place_types,rate_inference_extracted_at')
    .not('website', 'is', null)
    .order('website_extraction_attempted_at', { ascending: true, nullsFirst: true })
    .limit(QUERY_LIMIT)

  if (vendorError) {
    Sentry.captureException(vendorError, {
      tags: { component: 'venue_website_extraction_cron', phase: 'vendor_query' },
    })
    console.error('[venue-website-extraction] discovery_vendors_query_failed', {
      error: vendorError.message,
    })
  }

  const vendors = ((vendorData ?? []) as DiscoveryVendorExtractionCandidate[])
    .filter(shouldAttemptVendorWebsiteExtraction)
    .slice(0, VENDOR_PROCESS_LIMIT)

  console.info('[venue-website-extraction] batch_selected', {
    queried: data?.length ?? 0,
    selected: venues.length,
    vendor_queried: vendorData?.length ?? 0,
    vendor_selected: vendors.length,
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
  const results: Array<{ id: string; status: string; emails: number; draft_approvals?: number; capacity_job_queued?: boolean; error?: string }> = []
  const vendorSummary: ExtractionSummary = {
    processed: 0,
    successful: 0,
    failed: 0,
    no_emails: 0,
    rate_limited: 0,
    blocked_by_robots: 0,
    timeout: 0,
    skipped: 0,
  }
  const vendorResults: Array<{ id: string; status: string; emails: number; rate_inferred?: boolean; error?: string }> = []

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

  for (const batch of chunk(vendors, BATCH_SIZE)) {
    const batchResults = await Promise.all(batch.map((vendor) => processVendor(admin, vendor)))
    for (const result of batchResults) {
      vendorSummary.processed += 1
      vendorResults.push(result)
      if (result.status === 'successful') vendorSummary.successful += 1
      else if (result.status === 'no_emails_found') vendorSummary.no_emails += 1
      else if (result.status === 'rate_limited') vendorSummary.rate_limited += 1
      else if (result.status === 'blocked_by_robots') vendorSummary.blocked_by_robots += 1
      else if (result.status === 'timeout') vendorSummary.timeout += 1
      else vendorSummary.failed += 1
      console.info('[venue-website-extraction] vendor_processed', result)
    }
  }

  summary.skipped = Math.max(0, (data?.length ?? 0) - venues.length)
  vendorSummary.skipped = Math.max(0, (vendorData?.length ?? 0) - vendors.length)
  const durationMs = Date.now() - startedAt
  console.info('[venue-website-extraction] invocation_completed', {
    duration_ms: durationMs,
    ...summary,
    vendor_summary: vendorSummary,
  })
  return NextResponse.json({ ...summary, duration_ms: durationMs, results, vendor_summary: vendorSummary, vendor_results: vendorResults })
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
    const capacityJobQueued = await maybeEnqueueVenueCapacityInference(admin, venue)

    return {
      id: venue.id,
      status: result.status,
      emails: result.emails.length,
      draft_approvals: draftApprovals,
      capacity_job_queued: capacityJobQueued,
    }
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

async function maybeEnqueueVenueCapacityInference(admin: SupabaseAdminClient, venue: DiscoveryVenueExtractionCandidate) {
  if (venue.capacity_inference_extracted_at) return false
  if (hasKnownCapacity(venue)) return false
  if (!process.env.OPENAI_API_KEY?.trim()) return false

  try {
    await enqueueVenueCapacityInferenceJob(admin as unknown as SupabaseJobClient, venue.id)
    return true
  } catch (error) {
    Sentry.captureException(error, {
      tags: { component: 'venue_website_extraction_cron', phase: 'venue_capacity_job_enqueue' },
      extra: { discovery_venue_id: venue.id },
    })
    console.error('[venue-website-extraction] capacity_inference_enqueue_failed', {
      discovery_venue_id: venue.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

async function processVendor(admin: SupabaseAdminClient, vendor: DiscoveryVendorExtractionCandidate) {
  const attemptedAt = new Date().toISOString()

  try {
    const result = await extractVenueContacts(vendor.website ?? '', {
      venueName: vendor.name,
      venueType: vendor.service_type ?? 'vendor',
    })
    const inference = await maybeInferVendorRate(vendor, result.emails.map((email) =>
      `${email.email} found on ${email.source_path}`
    ).join('\n'))
    const update = buildVendorWebsiteExtractionUpdate(result, vendor.website_extraction_attempts, attemptedAt, inference)
    const { error } = await admin
      .from('discovery_vendors')
      .update(update)
      .eq('id', vendor.id)

    if (error) {
      Sentry.captureException(error, {
        tags: { component: 'venue_website_extraction_cron', phase: 'vendor_update' },
        extra: { discovery_vendor_id: vendor.id, extraction_status: result.status },
      })
      console.error('[venue-website-extraction] discovery_vendor_update_failed', {
        discovery_vendor_id: vendor.id,
        status: result.status,
        error: error.message,
      })
      return { id: vendor.id, status: 'fetch_failed', emails: result.emails.length, rate_inferred: Boolean(inference), error: error.message }
    }

    return { id: vendor.id, status: result.status, emails: result.emails.length, rate_inferred: Boolean(inference) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Vendor website extraction failed'
    Sentry.captureException(error, {
      tags: { component: 'venue_website_extraction_cron', phase: 'process_vendor' },
      extra: { discovery_vendor_id: vendor.id },
    })
    console.error('[venue-website-extraction] vendor_extraction_failed', {
      discovery_vendor_id: vendor.id,
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
      .from('discovery_vendors')
      .update(buildVendorWebsiteExtractionUpdate(fallbackResult, vendor.website_extraction_attempts, attemptedAt, null))
      .eq('id', vendor.id)

    return { id: vendor.id, status: 'fetch_failed', emails: 0, rate_inferred: false, error: message }
  }
}

function readVenueType(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return 'venue'
  const value = (metadata as Record<string, unknown>).venue_type
  return typeof value === 'string' && value.trim() ? value : 'venue'
}

function shouldAttemptVendorWebsiteExtraction(row: DiscoveryVendorExtractionCandidate) {
  if (!row.website?.trim()) return false
  if (row.contact_email?.trim() || row.organizer_provided_email?.trim()) return false
  if (Array.isArray(row.extracted_emails) && row.extracted_emails.length > 0 && shouldSkipVendorRateInference(row)) return false
  if (!new Set<string | null>([null, 'never_attempted', 'fetch_failed', 'no_emails_found', 'rate_limited', 'timeout']).has(row.website_extraction_status)) {
    return !shouldSkipVendorRateInference(row)
  }
  return (row.website_extraction_attempts ?? 0) < 3 || !shouldSkipVendorRateInference(row)
}

async function maybeInferVendorRate(vendor: DiscoveryVendorExtractionCandidate, websiteSnippet: string | null) {
  if (shouldSkipVendorRateInference(vendor)) return null
  if (!process.env.OPENAI_API_KEY?.trim()) return null

  try {
    return await inferVendorRate({
      name: vendor.name,
      service_type: vendor.service_type ?? 'other',
      place_types: Array.isArray(vendor.place_types)
        ? vendor.place_types.filter((item): item is string => typeof item === 'string')
        : [],
      website_url: vendor.website,
    }, websiteSnippet)
  } catch (error) {
    Sentry.captureException(error, {
      tags: { component: 'venue_website_extraction_cron', phase: 'vendor_rate_inference' },
      extra: { discovery_vendor_id: vendor.id },
    })
    console.error('[venue-website-extraction] vendor_rate_inference_failed', {
      discovery_vendor_id: vendor.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function buildVendorWebsiteExtractionUpdate(
  result: Parameters<typeof buildWebsiteExtractionUpdate>[0],
  attempts: number | null | undefined,
  attemptedAt: string,
  inference: Awaited<ReturnType<typeof inferVendorRate>> | null
) {
  return {
    extracted_emails: toJson(result.emails),
    website_extraction_attempted_at: attemptedAt,
    website_extraction_status: result.status,
    website_extraction_metadata: toJson({
      ...result.metadata,
      rate_inference_model: inference?.model ?? null,
    }),
    website_extraction_attempts: (attempts ?? 0) + 1,
    inferred_hourly_rate_cents: inference?.hourly_cents ?? null,
    inferred_package_rate_cents: inference?.package_cents ?? null,
    inferred_minimum_cents: inference?.minimum_cents ?? null,
    rate_inference_confidence: inference?.confidence ?? null,
    rate_inference_source_quote: inference?.source_quote ?? null,
    rate_inference_model: inference?.model ?? null,
    rate_inference_admin_status: inference ? 'pending' : undefined,
    rate_inference_extracted_at: inference ? attemptedAt : null,
    updated_at: attemptedAt,
  }
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}
