import 'server-only'

import type OpenAI from 'openai'
import { z } from 'zod'
import { enqueueJob, type SupabaseJobClient } from '@/lib/server/job-queue'
import type { JsonObject } from '@/lib/types/databaseRows'

export const VENUE_CAPACITY_INFERENCE_MODEL = 'gpt-4o-mini'
export const VENUE_CAPACITY_CONFIDENCE_THRESHOLD = 0.7

const capacityValueSchema = z.number().int().nonnegative().nullable()

export const venueCapacityInferenceSchema = z.object({
  standing_capacity: capacityValueSchema,
  seated_capacity: capacityValueSchema,
  confidence: z.number().min(0).max(1),
  source_quote: z.string().trim().min(1).nullable(),
})

export type VenueCapacityInference = {
  standing: number | null
  seated: number | null
  confidence: number
  source_quote: string | null
  model: string
}

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

type VenueCapacityCandidate = {
  name: string
  place_types: string[]
  website_url: string | null
  formatted_address: string | null
}

type VenueCapacityDbRow = {
  id: string
  name: string
  address: string | null
  website: string | null
  metadata: unknown
  capacity_inference_extracted_at: string | null
}

type CapacityInferenceDb = SupabaseJobClient & {
  from(table: 'discovery_venues'): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        maybeSingle(): PromiseLike<{ data: VenueCapacityDbRow | null; error: { message: string } | null }>
      }
      is(column: string, value: unknown): {
        order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): {
          limit(count: number): PromiseLike<{ data: Array<{ id: string }> | null; error: { message: string } | null }>
        }
      }
    }
    update(values: Record<string, unknown>): {
      eq(column: string, value: unknown): PromiseLike<{ error: { message: string } | null }>
    }
  }
}

const SYSTEM_PROMPT = [
  'You are a venue capacity extractor.',
  'Given name, type, address, and optionally a website snippet, estimate standing and seated capacity.',
  'Return JSON only.',
  'Return null for fields you cannot estimate with confidence.',
  'Be conservative. When in doubt, prefer null.',
  'Do not invent exact quotes. If a website snippet contains capacity language, copy a short source_quote.',
].join('\n')

export async function inferVenueCapacity(
  venue: VenueCapacityCandidate,
  websiteSnippet?: string | null,
  client?: ChatCompletionClient
): Promise<VenueCapacityInference | null> {
  await waitForCapacityInferenceSlot()
  const completionClient = client ?? await getDefaultCompletionClient()

  const completion = await completionClient.create({
    model: VENUE_CAPACITY_INFERENCE_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          venue,
          website_snippet: websiteSnippet?.slice(0, 4000) ?? null,
          output_contract: {
            standing_capacity: 'integer or null',
            seated_capacity: 'integer or null',
            confidence: '0 to 1',
            source_quote: 'short quote or null',
          },
        }),
      },
    ],
  })

  const content = completion.choices[0]?.message?.content
  if (!content) return null

  const parsed = venueCapacityInferenceSchema.parse(parseJsonObject(content))
  return {
    standing: sanitizeCapacity(parsed.standing_capacity),
    seated: sanitizeCapacity(parsed.seated_capacity),
    confidence: parsed.confidence,
    source_quote: parsed.source_quote,
    model: VENUE_CAPACITY_INFERENCE_MODEL,
  }
}

export function shouldSkipVenueCapacityInference(venue: { capacity_inference_extracted_at?: string | null }) {
  return Boolean(venue.capacity_inference_extracted_at)
}

export async function enqueueVenueCapacityInferenceJob(
  admin: SupabaseJobClient,
  discoveryVenueId: string,
  scheduledAt?: string
) {
  return enqueueJob(admin, {
    jobType: 'venue.capacity_infer',
    payload: { discovery_venue_id: discoveryVenueId } as JsonObject,
    uniqueKey: `venue-capacity:${discoveryVenueId}`,
    scheduledAt,
    maxAttempts: 3,
  })
}

export async function enqueueVenueCapacityBackfillJobs(
  admin: CapacityInferenceDb,
  limit = 50
) {
  const { data, error } = await admin
    .from('discovery_venues')
    .select('id')
    .is('capacity_inference_extracted_at', null)
    .order('updated_at', { ascending: true, nullsFirst: true })
    .limit(Math.max(1, Math.min(limit, 200)))

  if (error) throw new Error(`Failed to load capacity inference backfill candidates: ${error.message}`)

  const jobs = []
  for (const row of data ?? []) {
    jobs.push(await enqueueVenueCapacityInferenceJob(admin, row.id))
  }
  return { queued: jobs.length, jobs }
}

export async function runVenueCapacityInferenceJob(
  admin: CapacityInferenceDb,
  discoveryVenueId: string,
  client?: ChatCompletionClient
) {
  const { data: venue, error } = await admin
    .from('discovery_venues')
    .select('id,name,address,website,metadata,capacity_inference_extracted_at')
    .eq('id', discoveryVenueId)
    .maybeSingle()

  if (error) throw new Error(`Failed to load discovery venue for capacity inference: ${error.message}`)
  if (!venue) return { processed: false, reason: 'not_found' as const, discovery_venue_id: discoveryVenueId }
  if (shouldSkipVenueCapacityInference(venue)) {
    return { processed: false, reason: 'already_inferred' as const, discovery_venue_id: discoveryVenueId }
  }
  if (!client && !process.env.OPENAI_API_KEY?.trim()) {
    return { processed: false, reason: 'openai_not_configured' as const, discovery_venue_id: discoveryVenueId }
  }

  const inferredAt = new Date().toISOString()
  const inference = await inferVenueCapacity({
    name: venue.name,
    place_types: readVenuePlaceTypes(venue.metadata),
    website_url: venue.website,
    formatted_address: venue.address,
  }, null, client)

  const { error: updateError } = await admin
    .from('discovery_venues')
    .update(buildVenueCapacityInferenceUpdate(inference, inferredAt))
    .eq('id', venue.id)

  if (updateError) throw new Error(`Failed to persist venue capacity inference: ${updateError.message}`)

  return {
    processed: true,
    discovery_venue_id: venue.id,
    standing: inference?.standing ?? null,
    seated: inference?.seated ?? null,
    confidence: inference?.confidence ?? 0,
  }
}

export function buildVenueCapacityInferenceUpdate(
  inference: VenueCapacityInference | null,
  inferredAt: string
) {
  return {
    inferred_capacity_standing: inference?.standing ?? null,
    inferred_capacity_seated: inference?.seated ?? null,
    capacity_inference_confidence: inference?.confidence ?? 0,
    capacity_inference_source_quote: inference?.source_quote ?? null,
    capacity_inference_model: inference?.model ?? VENUE_CAPACITY_INFERENCE_MODEL,
    capacity_inference_admin_status: 'pending',
    capacity_inference_extracted_at: inferredAt,
    updated_at: inferredAt,
  }
}

export function readVenuePlaceTypes(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return []
  const record = metadata as Record<string, unknown>
  const values = [
    record.google_primary_type,
    ...(Array.isArray(record.google_types) ? record.google_types : []),
    ...(Array.isArray(record.places_all_types) ? record.places_all_types : []),
  ]
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))]
}

async function getDefaultCompletionClient(): Promise<ChatCompletionClient> {
  const { assertOpenAIConfigured, openai } = await import('@/lib/ai/client')
  assertOpenAIConfigured()
  return openai.chat.completions
}

function sanitizeCapacity(value: number | null) {
  if (value === null) return null
  return Math.max(0, Math.round(value))
}

function parseJsonObject(content: string): unknown {
  try {
    const value = JSON.parse(content) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Model response was not a JSON object')
    }
    return value
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse venue capacity inference JSON: ${error.message}`)
    }
    throw new Error('Failed to parse venue capacity inference JSON')
  }
}

const CAPACITY_INFERENCE_LIMIT_PER_MINUTE = 50
let capacityWindowStartedAt = 0
let capacityWindowCount = 0

async function waitForCapacityInferenceSlot() {
  const now = Date.now()
  if (now - capacityWindowStartedAt >= 60_000) {
    capacityWindowStartedAt = now
    capacityWindowCount = 0
  }

  if (capacityWindowCount < CAPACITY_INFERENCE_LIMIT_PER_MINUTE) {
    capacityWindowCount += 1
    return
  }

  const waitMs = Math.max(0, 60_000 - (now - capacityWindowStartedAt))
  await new Promise((resolve) => setTimeout(resolve, waitMs))
  capacityWindowStartedAt = Date.now()
  capacityWindowCount = 1
}
