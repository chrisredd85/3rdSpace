import 'server-only'

import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'

export const contactDisambiguationEmailSchema = z.object({
  email: z.string().email(),
  source_path: z.string().trim().min(1),
  surrounding_context: z.string().optional(),
})

export const contactDisambiguationResultSchema = z.object({
  ranked_emails: z.array(z.object({
    email: z.string().email(),
    likelihood_booking_contact: z.number().min(0).max(1),
    reasoning: z.string().trim().min(1),
  })),
})

export type ContactDisambiguationInput = {
  emails: Array<z.infer<typeof contactDisambiguationEmailSchema>>
  venue_name: string
  venue_type: string
}

export type ContactDisambiguationResult = z.infer<typeof contactDisambiguationResultSchema>

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_CACHE_ENTRIES = 250
const cache = new Map<string, { expiresAt: number; result: ContactDisambiguationResult }>()

const SYSTEM_PROMPT = [
  'You rank public venue email addresses for 3rdPlace venue outreach.',
  'Return JSON only.',
  'Rank by likelihood that the address reaches events, private events, group booking, owner, general manager, or venue booking staff.',
  'Prefer booking/events/private-events addresses over generic info addresses.',
  'Do not invent emails. Return every input email exactly once.',
].join('\n')

export async function disambiguateBookingContact(
  input: ContactDisambiguationInput,
  client?: ChatCompletionClient
): Promise<ContactDisambiguationResult> {
  const normalizedEmails = input.emails.map((email) => contactDisambiguationEmailSchema.parse(email))
  if (normalizedEmails.length === 0) return { ranked_emails: [] }
  if (normalizedEmails.length === 1) {
    return {
      ranked_emails: [{
        email: normalizedEmails[0].email,
        likelihood_booking_contact: 1,
        reasoning: 'Only one public contact email was found.',
      }],
    }
  }

  const cacheKey = buildCacheKey({
    ...input,
    emails: normalizedEmails,
  })
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.result

  const completionClient = client ?? getDefaultCompletionClient()
  const completion = await completionClient.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          venue_name: input.venue_name,
          venue_type: input.venue_type,
          emails: normalizedEmails,
          output_shape: {
            ranked_emails: [{
              email: 'input email',
              likelihood_booking_contact: 'number 0-1',
              reasoning: 'short reason',
            }],
          },
        }),
      },
    ],
  })

  const content = completion.choices[0]?.message?.content
  if (!content) throw new Error('contact disambiguation returned an empty response')

  const result = normalizeDisambiguationResult(
    contactDisambiguationResultSchema.parse(JSON.parse(content)),
    normalizedEmails
  )

  cacheResult(cacheKey, result)
  return result
}

export function clearContactDisambiguationCache() {
  cache.clear()
}

function getDefaultCompletionClient(): ChatCompletionClient {
  assertOpenAIConfigured()
  return openai.chat.completions
}

function normalizeDisambiguationResult(
  result: ContactDisambiguationResult,
  inputEmails: Array<z.infer<typeof contactDisambiguationEmailSchema>>
): ContactDisambiguationResult {
  const inputEmailSet = new Set(inputEmails.map((email) => email.email.toLowerCase()))
  const seen = new Set<string>()
  const ranked = result.ranked_emails.filter((email) => {
    const normalized = email.email.toLowerCase()
    if (!inputEmailSet.has(normalized) || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })

  for (const email of inputEmails) {
    if (seen.has(email.email.toLowerCase())) continue
    ranked.push({
      email: email.email,
      likelihood_booking_contact: 0.2,
      reasoning: 'The model did not rank this input email, so it was retained with low confidence.',
    })
  }

  return { ranked_emails: ranked }
}

function buildCacheKey(input: ContactDisambiguationInput) {
  return JSON.stringify({
    venue_name: input.venue_name.trim().toLowerCase(),
    venue_type: input.venue_type.trim().toLowerCase(),
    emails: input.emails
      .map((email) => ({
        email: email.email.trim().toLowerCase(),
        source_path: email.source_path,
        surrounding_context: email.surrounding_context ?? '',
      }))
      .sort((a, b) => a.email.localeCompare(b.email)),
  })
}

function cacheResult(key: string, result: ContactDisambiguationResult) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey) cache.delete(oldestKey)
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result })
}
