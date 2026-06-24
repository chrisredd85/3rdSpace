import 'server-only'

import type OpenAI from 'openai'
import { z } from 'zod'
import type { VendorServiceType } from '@/lib/server/places-vendor-search'

const centsSchema = z.number().int().nonnegative().nullable()

export const vendorRateInferenceSchema = z.object({
  hourly_cents: centsSchema,
  package_cents: centsSchema,
  minimum_cents: centsSchema,
  confidence: z.number().min(0).max(1),
  source_quote: z.string().trim().min(1).nullable(),
})

export type VendorRateInference = z.infer<typeof vendorRateInferenceSchema> & {
  model: string
}

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

const MODEL = 'gpt-4o-mini'

const SYSTEM_PROMPT = [
  'You are a vendor rate extractor.',
  "Given a vendor's name, service type, public place types, and optional website snippet, estimate typical pricing for an event.",
  'Return JSON only.',
  'All money must be integer cents.',
  'Return null for hourly_cents, package_cents, or minimum_cents when you cannot estimate that field with confidence.',
  'Be conservative. When in doubt, prefer null.',
  'Do not invent exact quotes. If a website snippet contains pricing language, copy a short source_quote.',
].join('\n')

export async function inferVendorRate(
  vendor: {
    name: string
    service_type: VendorServiceType | string
    place_types?: string[]
    website_url?: string | null
  },
  websiteSnippet?: string | null,
  client?: ChatCompletionClient
): Promise<VendorRateInference | null> {
  const completionClient = client ?? await getDefaultCompletionClient()

  const completion = await completionClient.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          vendor,
          website_snippet: websiteSnippet?.slice(0, 6000) ?? null,
          output_contract: {
            hourly_cents: 'integer cents or null',
            package_cents: 'integer cents or null',
            minimum_cents: 'integer cents or null',
            confidence: '0 to 1',
            source_quote: 'short quote or null',
          },
        }),
      },
    ],
  })

  const content = completion.choices[0]?.message?.content
  if (!content) return null

  const parsed = vendorRateInferenceSchema.parse(parseJsonObject(content))
  if (
    parsed.hourly_cents === null &&
    parsed.package_cents === null &&
    parsed.minimum_cents === null &&
    parsed.confidence < 0.7
  ) {
    return { ...parsed, model: MODEL }
  }

  return {
    ...parsed,
    hourly_cents: sanitizeCents(parsed.hourly_cents),
    package_cents: sanitizeCents(parsed.package_cents),
    minimum_cents: sanitizeCents(parsed.minimum_cents),
    model: MODEL,
  }
}

async function getDefaultCompletionClient(): Promise<ChatCompletionClient> {
  const { assertOpenAIConfigured, openai } = await import('@/lib/ai/client')
  assertOpenAIConfigured()
  return openai.chat.completions
}

export function shouldSkipVendorRateInference(vendor: { rate_inference_extracted_at?: string | null }) {
  return Boolean(vendor.rate_inference_extracted_at)
}

function sanitizeCents(value: number | null) {
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
      throw new Error(`Failed to parse vendor rate inference JSON: ${error.message}`)
    }
    throw new Error('Failed to parse vendor rate inference JSON')
  }
}
