import 'server-only'

import * as Sentry from '@sentry/nextjs'
import { enqueueJob, type SupabaseJobClient } from '@/lib/server/job-queue'
import { inferVenueCapacity, shouldSkipVenueCapacityInference, type VenueCapacityInference } from '@/lib/discovery/inferCapacity'
import { toJsonObject, type JsonObject } from '@/lib/types/databaseRows'
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
export type VenueCapacityJobClient = SupabaseJobClient & {
  from(table: 'discovery_venues'): CapacityVenueTable
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
  const { data: venue, error } = await admin
    .from('discovery_venues')
    .select(VENUE_CAPACITY_JOB_SELECT)
    .eq('id', input.discoveryVenueId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load discovery venue: ${error.message}`)
  if (!venue) return { processed: false, skipped: true, reason: 'not_found' }
  if (hasKnownCapacity(venue)) return { processed: false, skipped: true, reason: 'capacity_already_known' }
  if (shouldSkipVenueCapacityInference(venue)) return { processed: false, skipped: true, reason: 'already_inferred' }
  if (!process.env.OPENAI_API_KEY?.trim()) return { processed: false, skipped: true, reason: 'openai_not_configured' }

  let inference: VenueCapacityInference | null = null
  try {
    inference = await inferVenueCapacity({
      name: venue.name,
      venue_type: readVenueType(venue.metadata),
      address: venue.address,
      city: venue.city,
      state: venue.state,
      website_url: venue.website,
      google_types: readGoogleTypes(venue.metadata),
      google_rating: venue.google_rating,
      google_user_ratings_total: venue.google_user_ratings_total,
    }, input.websiteSnippet ?? null)
  } catch (error) {
    Sentry.captureException(error, {
      tags: { component: 'venue_capacity_inference', phase: 'infer' },
      extra: { discovery_venue_id: venue.id },
    })
    throw error
  }

  const attemptedAt = new Date().toISOString()
  const update = buildVenueCapacityInferenceUpdate(inference, attemptedAt)
  const { error: updateError } = await admin
    .from('discovery_venues')
    .update(update)
    .eq('id', venue.id)

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

function readVenueType(metadata: Json | null) {
  const value = toJsonObject(metadata).google_primary_type
  return typeof value === 'string' && value.trim() ? value.trim() : 'venue'
}

function readGoogleTypes(metadata: Json | null): string[] {
  const record = toJsonObject(metadata)
  return [
    ...readStringArray(record.google_types),
    ...readStringArray(record.places_all_types),
  ]
}

function readStringArray(value: JsonObject[keyof JsonObject]): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}
