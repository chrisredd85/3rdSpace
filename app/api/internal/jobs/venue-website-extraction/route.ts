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
import { readSafeDiscoveryVenue, writeVenueFacts } from '@/lib/discovery/venueRepository'
import { SAFE_VENDOR_TABLE, readSafeDiscoveryVendor, writeVendorFacts } from '@/lib/discovery/vendorRepository'
import { readFieldProvenance, retentionOrigin, type FieldProvenance } from '@/lib/discovery/foundation/provenance'
import { getVenueContactDetails } from '@/lib/server/venue-places-details'
import { createVendorDetailsContext, getVendorContactDetails, type VendorDetailsContext } from '@/lib/server/vendor-places-details'
import { isGoogleVenueEnabled, isGoogleVendorEnabled } from '@/lib/server/google-places-flags'
import type { ExtractionResult } from '@/lib/server/venue-website-extractor'

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
  extracted_contact_forms?: Json | null
  organizer_provided_emails?: Json | null
  source?: string | null
  source_external_id?: string | null
}

type DiscoveryVendorExtractionCandidate = {
  id: string
  name: string | null
  service_type: string | null
  website: string | null
  contact_email: string | null
  organizer_provided_email: string | null
  extracted_emails: Json | null
  extracted_contact_forms?: Json | null
  website_extraction_status: string | null
  website_extraction_attempts: number | null
  rate_inference_extracted_at: string | null
  source: string | null
  source_external_id: string | null
  field_provenance: Record<string, unknown>
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

export async function runVenueWebsiteExtraction() {
  const startedAt = Date.now()
  console.info('[venue-website-extraction] invocation_started', {
    started_at: new Date(startedAt).toISOString(),
    process_limit: PROCESS_LIMIT,
    batch_size: BATCH_SIZE,
  })

  const admin = createServiceRoleClient() as SupabaseAdminClient
  const { data, error } = await admin
    .from('discovery_venues_safe')
    .select('id,name,website,contact_email,organizer_provided_emails,extracted_emails,extracted_contact_forms,website_extraction_status,website_extraction_attempts,metadata,capacity_seated,capacity_standing,capacity_cocktail,capacity_inference_extracted_at,source,source_external_id')
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

  const safeVenues = (data ?? []).map((row) => readSafeDiscoveryVenue(row) as DiscoveryVenueExtractionCandidate)
  const venues = safeVenues
    .filter((row) => shouldAttemptWebsiteExtraction(row as DiscoveryVenueRow, { googleHydrationEnabled: isGoogleVenueEnabled() }))
    .slice(0, PROCESS_LIMIT)

  const { data: vendorData, error: vendorError } = await admin
    .from(SAFE_VENDOR_TABLE)
    .select('id,source,source_external_id,name,service_type,website,contact_email,organizer_provided_email,extracted_emails,extracted_contact_forms,website_extraction_status,website_extraction_attempts,rate_inference_extracted_at,field_provenance')
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

  const vendors = (vendorData ?? []).map((row) => readSafeDiscoveryVendor(row) as DiscoveryVendorExtractionCandidate)
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
      if (result.status === 'skipped') summary.skipped += 1
      else if (result.status === 'successful') summary.successful += 1
      else if (result.status === 'no_emails_found') summary.no_emails += 1
      else if (result.status === 'rate_limited') summary.rate_limited += 1
      else if (result.status === 'blocked_by_robots') summary.blocked_by_robots += 1
      else if (result.status === 'timeout') summary.timeout += 1
      else summary.failed += 1
      console.info('[venue-website-extraction] venue_processed', result)
    }
  }

  // Reconcile old pending requests even when a terminal row is no longer crawled.
  const terminalVenues = safeVenues.filter((venue) => !venues.includes(venue)
    && (venue.website_extraction_status === 'blocked_by_robots'
      || venue.website_extraction_status === 'no_emails_found'
      || venue.website_extraction_status === 'successful'
      || (venue.website_extraction_attempts ?? 0) >= 3)).slice(0, PROCESS_LIMIT)
  for (const venue of terminalVenues) await resumePendingDrafts(admin, venue.id)

  const vendorDetailsContext = createVendorDetailsContext()
  for (const batch of chunk(vendors, 3)) {
    const batchResults = await Promise.all(batch.map((vendor) => processVendor(admin, vendor, vendorDetailsContext)))
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

  summary.skipped += Math.max(0, (data?.length ?? 0) - venues.length)
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
  let result: ExtractionResult
  try {
    let website = venue.website
    if (!website && venue.source === 'google_places' && venue.source_external_id && isGoogleVenueEnabled()) {
      const { data: saved, error: savedError } = await admin.from('plan_discovery_venue_candidates')
        .select('id').eq('discovery_venue_id', venue.id).is('dismissed_at', null).limit(1).maybeSingle()
      if (savedError || !saved) return { id: venue.id, status: 'skipped', emails: 0 }
      const details = await getVenueContactDetails(venue.source_external_id)
      if (!details) throw new Error('venue_contact_lookup_unavailable')
      website = details.websiteUri ?? null
    }
    result = website
      ? await extractVenueContacts(website, { venueName: venue.name ?? undefined, venueType: readVenueType(venue.metadata) })
      : emptyExtractionResult('no_emails_found')
  } catch {
    result = emptyExtractionResult('fetch_failed')
  }

  // Only a successful site observation supplies durable facts. Locator responses
  // and provider error text never enter this update or its provenance.
  const values: Record<string, unknown> = {}
  const provenance: Record<string, FieldProvenance> = {}
  const update = buildWebsiteExtractionUpdate(result, venue.website_extraction_attempts, attemptedAt, venue)
  const metadata = venue.metadata && typeof venue.metadata === 'object' && !Array.isArray(venue.metadata)
    ? venue.metadata as Record<string, unknown> : {}
  const priorProvenance = metadata.field_provenance && typeof metadata.field_provenance === 'object'
    ? metadata.field_provenance as Record<string, unknown> : {}
  try {
    for (const [field, entries] of [
      ['extracted_emails', result.emails],
      ['extracted_contact_forms', result.contact_forms ?? []],
    ] as const) {
      if (entries.length === 0) continue
      if (entries.some((entry) => entry.source !== 'business_website' || !entry.source_url || !/^https?:\/\//i.test(entry.source_url))) {
        throw new Error('contact_evidence_missing')
      }
      values[field] = update[field]
      const lineage = entries.map((entry) => ({
        field,
        provenance: {
          resolution: 'resolved', source: 'venue_site', evidence_reference: entry.source_url!,
          collected_at: entry.extracted_at, confidence: entry.confidence,
          confirmation_status: 'site_published', lineage: [],
        } as FieldProvenance,
      }))
      const prior = readFieldProvenance(priorProvenance[field])
      if (retentionOrigin(prior) === 'independent') lineage.push({ field, provenance: prior })
      provenance[field] = {
        resolution: 'resolved', source: 'venue_site', evidence_reference: entries[0].source_url!,
        collected_at: attemptedAt, confidence: null, confirmation_status: 'site_published', lineage,
      }
    }
    const { error } = await writeVenueFacts(admin, venue.id, values, provenance, {
      website_extraction_status: result.status,
      website_extraction_attempts: (venue.website_extraction_attempts ?? 0) + 1,
      website_extraction_attempted_at: attemptedAt,
    })
    if (error) throw new Error('contact_persistence_failed')
  } catch {
    console.warn('[venue-website-extraction] contact_persistence_failed', { discovery_venue_id: venue.id })
    return { id: venue.id, status: 'fetch_failed', emails: 0, error: 'contact_persistence_failed' }
  }

  // Draft preparation is a separate retryable step. Its failure cannot erase
  // facts that were just saved, and every final extraction outcome is reconciled.
  const resumed = await resumePendingDrafts(admin, venue.id)
  const capacityJobQueued = venue.website ? await maybeEnqueueVenueCapacityInference(admin, venue) : false
  return {
    id: venue.id, status: result.status, emails: result.emails.length,
    draft_approvals: resumed.count, draft_resume_failed: resumed.failed,
    capacity_job_queued: capacityJobQueued,
  }
}

function emptyExtractionResult(status: 'fetch_failed' | 'no_emails_found'): ExtractionResult {
  return {
    status, emails: [], contact_forms: [],
    metadata: { paths_attempted: [], paths_successful: [], total_fetch_time_ms: 0, robots_txt_consulted: false },
  }
}

async function resumePendingDrafts(admin: SupabaseAdminClient, venueId: string) {
  try {
    const results = await enqueuePendingDraftsForDiscoveryVenue({ db: admin, discoveryVenueId: venueId })
    return { count: results.filter((draft) => draft.status === 'draft_created').length, failed: false }
  } catch {
    console.warn('[venue-website-extraction] pending_draft_lookup_failed', { discovery_venue_id: venueId })
    return { count: 0, failed: true }
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

async function processVendor(admin: SupabaseAdminClient, vendor: DiscoveryVendorExtractionCandidate, context: VendorDetailsContext) {
  const attemptedAt = new Date().toISOString()
  let result: ExtractionResult
  try {
    let website = vendor.website
    if (!website && vendor.source === 'google_places' && vendor.source_external_id && isGoogleVendorEnabled()) {
      const { data: saved, error } = await admin.from('plan_discovery_vendor_candidates')
        .select('id').eq('discovery_vendor_id', vendor.id).is('dismissed_at', null).limit(1).maybeSingle()
      if (error || !saved) return { id: vendor.id, status: 'skipped', emails: 0, rate_inferred: false }
      const details = await getVendorContactDetails(vendor.source_external_id, context)
      if (!details) throw new Error('vendor_contact_lookup_unavailable')
      website = details.websiteUri ?? null
    }
    result = website
      ? await extractVenueContacts(website, { venueName: vendor.name ?? undefined, venueType: vendor.service_type ?? 'vendor' })
      : emptyExtractionResult('no_emails_found')
  } catch {
    result = emptyExtractionResult('fetch_failed')
  }

  // Site observations are independent evidence. The temporary Google navigation
  // pointer and any provider error text never enter a saved value or provenance.
  const values: Record<string, unknown> = {}
  const provenance: Record<string, FieldProvenance> = {}
  const update = buildWebsiteExtractionUpdate(result, vendor.website_extraction_attempts, attemptedAt, vendor)
  try {
    for (const [field, entries] of [
      ['extracted_emails', result.emails],
      ['extracted_contact_forms', result.contact_forms ?? []],
    ] as const) {
      if (entries.length === 0) continue
      if (entries.some((entry) => entry.source !== 'business_website' || !entry.source_url || !/^https?:\/\//i.test(entry.source_url))) {
        throw new Error('contact_evidence_missing')
      }
      values[field] = update[field]
      const lineage = entries.map((entry) => ({ field, provenance: {
        resolution: 'resolved', source: 'venue_site', evidence_reference: entry.source_url!,
        collected_at: entry.extracted_at, confidence: entry.confidence,
        confirmation_status: 'site_published', lineage: [],
      } as FieldProvenance }))
      const prior = readFieldProvenance(vendor.field_provenance[field])
      if (retentionOrigin(prior) === 'independent') lineage.push({ field, provenance: prior })
      provenance[field] = {
        resolution: 'resolved', source: 'venue_site', evidence_reference: entries[0].source_url!,
        collected_at: attemptedAt, confidence: null, confirmation_status: 'site_published', lineage,
      }
    }
    const { error } = await writeVendorFacts(admin, vendor.id, values, provenance, {
      website_extraction_status: result.status,
      website_extraction_attempts: (vendor.website_extraction_attempts ?? 0) + 1,
      website_extraction_attempted_at: attemptedAt,
    })
    if (error) throw new Error('contact_persistence_failed')
  } catch {
    console.warn('[venue-website-extraction] vendor_contact_persistence_failed', { discovery_vendor_id: vendor.id })
    return { id: vendor.id, status: 'fetch_failed', emails: result.emails.length, rate_inferred: false, error: 'contact_persistence_failed' }
  }

  // Optional estimates run after the contact commit; errors cannot erase contacts
  // or previously known prices, and missing prices never make a contact retry eligible.
  const rateInferred = await maybeInferVendorRate(admin, vendor, result, provenance, attemptedAt)
  return { id: vendor.id, status: result.status, emails: result.emails.length, rate_inferred: rateInferred }
}

function readVenueType(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return 'venue'
  const value = (metadata as Record<string, unknown>).venue_type
  return typeof value === 'string' && value.trim() ? value : 'venue'
}

function shouldAttemptVendorWebsiteExtraction(row: DiscoveryVendorExtractionCandidate) {
  const canLocate = row.website?.trim() || (isGoogleVendorEnabled() && row.source === 'google_places' && row.source_external_id)
  if (!canLocate) return false
  if (row.contact_email?.trim() || row.organizer_provided_email?.trim()) return false
  if (Array.isArray(row.extracted_emails) && row.extracted_emails.length > 0) return false
  if (Array.isArray(row.extracted_contact_forms) && row.extracted_contact_forms.length > 0) return false
  if (!new Set<string | null>([null, 'never_attempted', 'fetch_failed', 'no_emails_found', 'rate_limited', 'timeout']).has(row.website_extraction_status)) return false
  return (row.website_extraction_attempts ?? 0) < 3
}

async function maybeInferVendorRate(
  admin: SupabaseAdminClient,
  vendor: DiscoveryVendorExtractionCandidate,
  result: ExtractionResult,
  contactProvenance: Record<string, FieldProvenance>,
  attemptedAt: string,
): Promise<boolean> {
  if (shouldSkipVendorRateInference(vendor) || !process.env.OPENAI_API_KEY?.trim()) return false
  if (!vendor.name || !vendor.service_type) return false
  const lineage = ['name', 'service_type', ...(vendor.website ? ['website'] : [])]
    .map((field) => ({ field, provenance: readFieldProvenance(vendor.field_provenance[field]) }))
  if (lineage.some((entry) => retentionOrigin(entry.provenance) !== 'independent')) return false
  if (result.emails.length > 0) {
    const contact = contactProvenance.extracted_emails
    if (!contact || retentionOrigin(contact) !== 'independent') return false
    lineage.push({ field: 'extracted_emails', provenance: contact })
  }
  try {
    const inference = await inferVendorRate({
      name: vendor.name, service_type: vendor.service_type,
      // Saved website is independent; fresh Google navigation data is not model input.
      website_url: vendor.website,
    }, result.emails.map((email) => `${email.email} found on ${email.source_path}`).join('\n') || null)
    if (!inference) return false
    const values: Record<string, unknown> = {}
    for (const [field, value] of [
      ['inferred_hourly_rate_cents', inference.hourly_cents],
      ['inferred_package_rate_cents', inference.package_cents],
      ['inferred_minimum_cents', inference.minimum_cents],
    ] as const) if (value !== null) values[field] = value
    if (Object.keys(values).length === 0) return false
    const evidence: FieldProvenance = {
      resolution: 'resolved', source: 'derived', evidence_reference: `vendor-rate:${vendor.id}:${attemptedAt}`,
      collected_at: attemptedAt, confidence: inference.confidence, confirmation_status: 'unconfirmed', lineage,
    }
    const { error } = await writeVendorFacts(admin, vendor.id, values,
      Object.fromEntries(Object.keys(values).map((field) => [field, evidence])), {
        rate_inference_admin_status: 'pending', rate_inference_extracted_at: attemptedAt,
      })
    if (error) throw new Error('rate_persistence_failed')
    return true
  } catch {
    console.warn('[venue-website-extraction] vendor_rate_inference_failed', { discovery_vendor_id: vendor.id })
    return false
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}
