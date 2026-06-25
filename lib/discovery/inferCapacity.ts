import 'server-only'

import type OpenAI from 'openai'
import { z } from 'zod'

const capacitySchema = z.number().int().nonnegative().nullable()

export const VENUE_CAPACITY_INFERENCE_MODEL = 'gpt-4o-mini'
export const VENUE_CAPACITY_TRUST_THRESHOLD = 0.7

export const venueCapacityInferenceSchema = z.object({
  standing: capacitySchema,
  seated: capacitySchema,
  confidence: z.number().min(0).max(1),
  source_quote: z.string().trim().min(1).nullable(),
})

export type VenueCapacityInference = z.infer<typeof venueCapacityInferenceSchema> & {
  model: string
}

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

const SYSTEM_PROMPT = [
  'You are a conservative venue event-capacity extractor.',
  'Estimate standing/cocktail capacity and seated capacity for an event venue from public signals.',
  'Return JSON only.',
  'Use integer people counts.',
  'Return null for standing or seated when there is not enough evidence.',
  'Be conservative. When in doubt, prefer null and lower confidence.',
  'Do not invent exact venue guarantees. If a website snippet contains capacity language, copy a short source_quote.',
  'If the place is a hotel, restaurant, bar, lounge, ballroom, gallery, or event venue, estimate only for plausible private-event use.',
].join('\n')

export async function inferVenueCapacity(
  venue: {
    name: string
    venue_type?: string | null
    address?: string | null
    city?: string | null
    state?: string | null
    website_url?: string | null
    google_types?: string[]
    google_rating?: number | null
    google_user_ratings_total?: number | null
  },
  websiteSnippet?: string | null,
  client?: ChatCompletionClient
): Promise<VenueCapacityInference | null> {
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
            standing: 'integer people or null',
            seated: 'integer people or null',
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
  const sanitized = {
    ...parsed,
    standing: sanitizeCapacity(parsed.standing),
    seated: sanitizeCapacity(parsed.seated),
    confidence: Math.min(1, Math.max(0, parsed.confidence)),
    model: VENUE_CAPACITY_INFERENCE_MODEL,
  }

  if (sanitized.standing === null && sanitized.seated === null && sanitized.confidence < VENUE_CAPACITY_TRUST_THRESHOLD) {
    return sanitized
  }

  return sanitized
}

export function shouldSkipVenueCapacityInference(venue: { capacity_inference_extracted_at?: string | null }) {
  return Boolean(venue.capacity_inference_extracted_at)
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
