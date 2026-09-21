import 'server-only'

import type OpenAI from 'openai'
import { z } from 'zod'

const centsSchema = z.number().int().nonnegative().nullable()
const classificationSchema = z.enum(['yes', 'no', 'conditional', 'quote_received', 'follow_up_needed', 'unclear'])
const conditionSchema = z.object({
  type: z.string().trim().min(1),
  detail: z.string().trim().min(1),
})

export const venueReplyTermsSchema = z.object({
  classification: classificationSchema,
  confidence: z.number().min(0).max(1),
  quoted_price_cents: centsSchema,
  quoted_deal_model: z.string().trim().min(1).nullable(),
  availability_confirmed: z.boolean().nullable(),
  capacity_confirmed: z.number().int().positive().nullable(),
  conditions: z.array(conditionSchema).default([]),
  raw_response_excerpt: z.string().trim().min(1).nullable(),
})

export const vendorReplyTermsSchema = z.object({
  classification: classificationSchema,
  confidence: z.number().min(0).max(1),
  quoted_hourly_cents: centsSchema,
  quoted_package_cents: centsSchema,
  quoted_minimum_cents: centsSchema,
  quoted_deposit_pct: z.number().min(0).max(1).nullable(),
  availability_confirmed: z.boolean().nullable(),
  conditions: z.array(conditionSchema).default([]),
  raw_response_excerpt: z.string().trim().min(1).nullable(),
})

export type VenueReplyTerms = z.infer<typeof venueReplyTermsSchema> & { model: string }
export type VendorReplyTerms = z.infer<typeof vendorReplyTermsSchema> & { model: string }

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>
type EntityType = 'venue' | 'vendor'

const MODEL = 'gpt-4o-mini'

const VENUE_SYSTEM_PROMPT = [
  'You are a venue response analyzer.',
  'Given an email thread between organizer and venue, extract classification and structured terms.',
  'Return nulls for fields the venue did not address. Be conservative.',
  'All money must be integer cents.',
  'Return JSON only.',
].join('\n')

const VENDOR_SYSTEM_PROMPT = [
  'You are a vendor response analyzer.',
  'Given an email thread between organizer and vendor, extract classification and structured terms.',
  'Return nulls for fields the vendor did not address. Be conservative.',
  'All money must be integer cents.',
  'Return JSON only.',
].join('\n')

export async function extractReplyTerms(
  input: {
    entityType: 'venue'
    entityName: string
    planTitle?: string | null
    threadText: string
  },
  client?: ChatCompletionClient
): Promise<VenueReplyTerms>
export async function extractReplyTerms(
  input: {
    entityType: 'vendor'
    entityName: string
    serviceType?: string | null
    planTitle?: string | null
    threadText: string
  },
  client?: ChatCompletionClient
): Promise<VendorReplyTerms>
export async function extractReplyTerms(
  input: {
    entityType: EntityType
    entityName: string
    serviceType?: string | null
    planTitle?: string | null
    threadText: string
  },
  client?: ChatCompletionClient
): Promise<VenueReplyTerms | VendorReplyTerms> {
  const completionClient = client ?? await getDefaultCompletionClient()

  const completion = await completionClient.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: input.entityType === 'venue' ? VENUE_SYSTEM_PROMPT : VENDOR_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: JSON.stringify({
          entity_name: input.entityName,
          entity_type: input.entityType,
          service_type: input.serviceType ?? null,
          plan_title: input.planTitle ?? null,
          thread_text: input.threadText.slice(0, 8000),
          output_contract: input.entityType === 'venue'
            ? {
                classification: 'yes | no | conditional | quote_received | follow_up_needed | unclear',
                confidence: '0 to 1',
                quoted_price_cents: 'integer cents or null',
                quoted_deal_model: 'flat_rental | minimum_spend | consumption_share | free_space | other | null',
                availability_confirmed: 'boolean or null',
                capacity_confirmed: 'integer or null',
                conditions: [{ type: 'string', detail: 'string' }],
                raw_response_excerpt: 'short quote or null',
              }
            : {
                classification: 'yes | no | conditional | quote_received | follow_up_needed | unclear',
                confidence: '0 to 1',
                quoted_hourly_cents: 'integer cents or null',
                quoted_package_cents: 'integer cents or null',
                quoted_minimum_cents: 'integer cents or null',
                quoted_deposit_pct: '0 to 1 or null',
                availability_confirmed: 'boolean or null',
                conditions: [{ type: 'string', detail: 'string' }],
                raw_response_excerpt: 'short quote or null',
              },
        }),
      },
    ],
  })

  const content = completion.choices[0]?.message?.content
  if (!content) throw new Error('extractReplyTerms returned an empty model response')

  const parsed = parseJsonObject(content)
  if (input.entityType === 'venue') {
    const terms = venueReplyTermsSchema.parse(parsed)
    return {
      ...terms,
      quoted_deal_model: canonicalizeVenueDealModel(terms.quoted_deal_model),
      model: MODEL,
    }
  }
  return { ...vendorReplyTermsSchema.parse(parsed), model: MODEL }
}

function canonicalizeVenueDealModel(value: string | null): string | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  if (normalized === 'rental' || normalized === 'flat_rental') return 'flat_rental'
  if (normalized === 'minimum' || normalized === 'minimum_spend') return 'minimum_spend'
  if (
    normalized === 'chi' ||
    normalized === 'community_host_incentive' ||
    normalized === 'consumption_share' ||
    normalized === 'bar_consumption_chi'
  ) return 'consumption_share'
  if (
    normalized === 'free' ||
    normalized === 'free_space' ||
    normalized === 'complimentary' ||
    normalized === 'comped'
  ) return 'free_space'
  return normalized || null
}

async function getDefaultCompletionClient(): Promise<ChatCompletionClient> {
  const { assertOpenAIConfigured, openai } = await import('@/lib/ai/client')
  assertOpenAIConfigured()
  return openai.chat.completions
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
      throw new Error(`Failed to parse reply terms JSON: ${error.message}`)
    }
    throw new Error('Failed to parse reply terms JSON')
  }
}
