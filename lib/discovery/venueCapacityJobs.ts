import 'server-only'
import { readSafeDiscoveryVenue, writeVenueFacts, type VenueRpcClient } from './venueRepository'
import { asRecord, readFieldProvenance } from './foundation/provenance'

import * as Sentry from '@sentry/nextjs'
import { enqueueJob, type SupabaseJobClient } from '@/lib/server/job-queue'
import { inferVenueCapacity, shouldSkipVenueCapacityInference, type VenueCapacityInference } from '@/lib/discovery/inferCapacity'
import type { Json } from '@/lib/types/database-generated'

type DbError = { message: string }
type DbResult<T> = { data: T | null; error: DbError | null }
type CapacityVenueSelectBuilder = {
  eq(column: string, value: unknown): CapacityVenueSelectBuilder
  maybeSingle(): PromiseLike<DbResult<CapacityVenueCandidate>>
}
type CapacityVenueUpdateBuilder = {
  eq(column: string, value: unknown): PromiseLike<{ error: DbError | null }>
}
type CapacityVenueTable = {
  select(columns: string): CapacityVenueSelectBuilder
  update(values: Record<string, unknown>): CapacityVenueUpdateBuilder
}
export type VenueCapacityJobClient = SupabaseJobClient & VenueRpcClient & {
  from(table: 'discovery_venues_safe'): CapacityVenueTable
}

export type CapacityVenueCandidate = {
  id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  website: string | null
  capacity_seated: number | null
  capacity_standing: number | null
  capacity_cocktail: number | null
  google_rating: number | null
  google_user_ratings_total: number | null
  metadata: Json | null
  capacity_inference_extracted_at?: string | null
}

export const VENUE_CAPACITY_JOB_SELECT = [
  'id',
  'name',
  'address',
  'city',
  'state',
  'website',
  'capacity_seated',
  'capacity_standing',
  'capacity_cocktail',
  'google_rating',
  'google_user_ratings_total',
  'metadata',
  'capacity_inference_extracted_at',
].join(',')

export async function enqueueVenueCapacityInferenceJob(
  admin: SupabaseJobClient,
  venueId: string,
  options: { scheduledAt?: string } = {}
) {
  return enqueueJob(admin, {
    jobType: 'infer_venue_capacity',
    payload: { discoveryVenueId: venueId },
    uniqueKey: `infer_venue_capacity:${venueId}`,
    scheduledAt: options.scheduledAt,
    maxAttempts: 3,
  })
}

export async function runVenueCapacityInferenceJob(
  admin: VenueCapacityJobClient,
  input: { discoveryVenueId: string; websiteSnippet?: string | null }
) {
  const { data: storedVenue, error } = await admin
    .from('discovery_venues_safe')
    .select(VENUE_CAPACITY_JOB_SELECT)
    .eq('id', input.discoveryVenueId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load discovery venue: ${error.message}`)
  if (!storedVenue) return { processed: false, skipped: true, reason: 'not_found' }
  const venue = readSafeDiscoveryVenue(storedVenue)
  if (input.websiteSnippet) throw new Error('Unversioned capacity snippet rejected')
  if (!venue.name) return { processed: false, skipped: true, reason: 'independent_evidence_required' }
  if (hasKnownCapacity(venue)) return { processed: false, skipped: true, reason: 'capacity_already_known' }
  if (shouldSkipVenueCapacityInference(venue)) return { processed: false, skipped: true, reason: 'already_inferred' }
  if (!process.env.OPENAI_API_KEY?.trim()) return { processed: false, skipped: true, reason: 'openai_not_configured' }

  let inference: VenueCapacityInference | null = null
  try {
    inference = await inferVenueCapacity({
      name: venue.name,
      venue_type: 'venue',
      address: venue.address,
      city: venue.city,
      state: venue.state,
      website_url: venue.website,
      google_types: [],
    }, input.websiteSnippet ?? null)
  } catch (error) {
    Sentry.captureException(error, {
      tags: { component: 'venue_capacity_inference', phase: 'infer' },
      extra: { discovery_venue_id: venue.id },
    })
    throw error
  }

  const attemptedAt = new Date().toISOString()
  const evidence = asRecord(asRecord(venue.metadata)?.field_provenance) ?? {}
  const lineage = ['name', 'address', 'city', 'state', 'website'].filter(key => evidence[key]).map(field => ({ field, provenance: readFieldProvenance(evidence[field]) }))
  const provenance = { resolution: 'resolved', source: 'derived', evidence_reference: `capacity-inference:${venue.id}:${attemptedAt}`, collected_at: attemptedAt,
    confirmation_status: 'unconfirmed', confidence: inference?.confidence ?? null, lineage }
  const { error: updateError } = await writeVenueFacts(admin, venue.id, {
    inferred_capacity_standing: inference?.standing ?? null, inferred_capacity_seated: inference?.seated ?? null,
  }, { inferred_capacity_standing: provenance, inferred_capacity_seated: provenance }, {
    capacity_inference_admin_status: 'pending', capacity_inference_extracted_at: attemptedAt,
  })

  if (updateError) throw new Error(`Failed to update venue capacity inference: ${updateError.message}`)

  return {
    processed: true,
    skipped: false,
    standing: inference?.standing ?? null,
    seated: inference?.seated ?? null,
    confidence: inference?.confidence ?? 0,
  }
}

export function buildVenueCapacityInferenceUpdate(
  inference: VenueCapacityInference | null,
  attemptedAt: string
): Record<string, unknown> {
  return {
    inferred_capacity_standing: inference?.standing ?? null,
    inferred_capacity_seated: inference?.seated ?? null,
    capacity_inference_confidence: inference?.confidence ?? 0,
    capacity_inference_source_quote: inference?.source_quote ?? null,
    capacity_inference_model: inference?.model ?? null,
    capacity_inference_admin_status: 'pending',
    capacity_inference_extracted_at: attemptedAt,
    updated_at: attemptedAt,
  }
}

export function hasKnownCapacity(venue: Pick<CapacityVenueCandidate, 'capacity_seated' | 'capacity_standing' | 'capacity_cocktail'>) {
  return [venue.capacity_cocktail, venue.capacity_standing, venue.capacity_seated]
    .some((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
}
