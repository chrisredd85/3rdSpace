import type OpenAI from 'openai'
import { z } from 'zod'
import { AgentRunExecutionError } from '@/lib/ai/types'
import { buildAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'

export const replyClassifierLabelSchema = z.enum([
  'available',
  'unavailable',
  'needs_follow_up',
  'pricing_or_terms_change',
  'unsubscribe',
  'bounce',
  'needs_creator_review',
])

export const replyClassifierInputSchema = z.object({
  reply_text: z.string().trim().min(1),
  thread_context: z.object({
    target_name: z.string().trim().min(1).optional(),
    target_type: z.enum(['venue', 'vendor', 'sponsor']).optional(),
    is_first_contact: z.boolean().optional(),
  }).passthrough().optional(),
})

export const replyClassifierOutputSchema = z.object({
  label: replyClassifierLabelSchema,
  confidence: z.number().min(0).max(1),
  requires_creator_review: z.boolean(),
  should_pause_autonomy: z.boolean(),
  rationale: z.string().trim().min(1),
  extracted_terms: z.object({
    price_cents: z.number().int().nonnegative().nullable().optional(),
    date: z.string().trim().min(1).nullable().optional(),
    capacity: z.number().int().nonnegative().nullable().optional(),
    terms_summary: z.string().trim().min(1).nullable().optional(),
  }).default({}),
})

export type ReplyClassifierLabel = z.infer<typeof replyClassifierLabelSchema>
export type ReplyClassifierInput = z.infer<typeof replyClassifierInputSchema>
export type ReplyClassifierOutput = z.infer<typeof replyClassifierOutputSchema>
export type ReplyClassifierResult = {
  agent_name: 'reply_classifier'
  status: 'succeeded'
  model: string
  prompt_tokens: number | null
  completion_tokens: number | null
  messages_payload: unknown
  raw_model_output: string | null
  duration_ms: number
  output: ReplyClassifierOutput
}

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

const REPLY_CLASSIFIER_OUTPUT_CONTRACT = {
  label: replyClassifierLabelSchema.options,
  confidence: 'number between 0 and 1',
  requires_creator_review: 'boolean',
  should_pause_autonomy: 'boolean',
  rationale: 'string',
  extracted_terms: {
    price_cents: 'integer cents or null',
    date: 'string or null',
    capacity: 'integer or null',
    terms_summary: 'string or null',
  },
}

const REPLY_CLASSIFIER_SYSTEM_PROMPT = [
  'You are the 3rdPlace reply classifier for approval-gated event outreach.',
  'Return JSON only. Do not include markdown or prose outside JSON.',
  'Default toward creator review when the reply changes price, date, seats, vendor, venue, or terms.',
  'Unsubscribes, bounces, and legal/compliance concerns must pause autonomy.',
  'Do not decide to send, book, pay, refund, import, or change terms.',
  `Output JSON must match this contract: ${JSON.stringify(REPLY_CLASSIFIER_OUTPUT_CONTRACT)}.`,
].join('\n')

export async function runReplyClassifier(
  payload: unknown,
  client?: ChatCompletionClient
): Promise<ReplyClassifierResult> {
  const startedAt = Date.now()
  const input = replyClassifierInputSchema.parse(payload)
  const completionClient = client ?? await getDefaultCompletionClient()
  const messages: AgentMessagePayload = [
    { role: 'system', content: REPLY_CLASSIFIER_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(input) },
  ]

  const completion = await completionClient.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages,
  })
  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, 'gpt-4o-mini', messages, content)
  if (!content) {
    throw new AgentRunExecutionError('reply classifier returned an empty model response', metadata)
  }

  try {
    return {
      agent_name: 'reply_classifier',
      status: 'succeeded',
      ...metadata,
      duration_ms: Date.now() - startedAt,
      output: replyClassifierOutputSchema.parse(parseJsonObject(content)),
    }
  } catch (error) {
    throw new AgentRunExecutionError(
      error instanceof Error ? error.message : 'Failed to parse reply classifier JSON',
      metadata,
      error
    )
  }
}

export function classifyReplyWithRules(payload: unknown): ReplyClassifierOutput {
  const input = replyClassifierInputSchema.parse(payload)
  const text = input.reply_text.toLowerCase()
  const extractedTerms = extractTerms(input.reply_text)

  if (matches(text, ['unsubscribe', 'remove me', 'do not contact', 'stop emailing'])) {
    return replyClassifierOutputSchema.parse({
      label: 'unsubscribe',
      confidence: 0.99,
      requires_creator_review: true,
      should_pause_autonomy: true,
      rationale: 'The reply asks to stop outreach.',
      extracted_terms: extractedTerms,
    })
  }

  if (matches(text, ['undeliverable', 'delivery has failed', 'mailbox unavailable', 'address not found'])) {
    return replyClassifierOutputSchema.parse({
      label: 'bounce',
      confidence: 0.98,
      requires_creator_review: true,
      should_pause_autonomy: true,
      rationale: 'The message indicates delivery failed.',
      extracted_terms: extractedTerms,
    })
  }

  if (matches(text, ['not available', 'unavailable', 'fully booked', 'already booked', 'cannot host'])) {
    return replyClassifierOutputSchema.parse({
      label: 'unavailable',
      confidence: 0.9,
      requires_creator_review: false,
      should_pause_autonomy: false,
      rationale: 'The partner says they are unavailable.',
      extracted_terms: extractedTerms,
    })
  }

  if (
    extractedTerms.price_cents ||
    extractedTerms.capacity ||
    matches(text, ['minimum spend', 'deposit', 'contract', 'cancellation', 'terms', 'rate', 'pricing'])
  ) {
    return replyClassifierOutputSchema.parse({
      label: 'pricing_or_terms_change',
      confidence: 0.88,
      requires_creator_review: true,
      should_pause_autonomy: false,
      rationale: 'The reply includes price, capacity, or terms that require creator review.',
      extracted_terms: extractedTerms,
    })
  }

  if (matches(text, ['available', 'we can host', 'can accommodate', 'works for us', 'happy to'])) {
    return replyClassifierOutputSchema.parse({
      label: 'available',
      confidence: 0.86,
      requires_creator_review: false,
      should_pause_autonomy: false,
      rationale: 'The reply indicates availability without changing terms.',
      extracted_terms: extractedTerms,
    })
  }

  if (matches(text, ['can you send', 'more details', 'what time', 'how many', 'could you confirm', 'question'])) {
    return replyClassifierOutputSchema.parse({
      label: 'needs_follow_up',
      confidence: 0.82,
      requires_creator_review: false,
      should_pause_autonomy: false,
      rationale: 'The partner asks for more information.',
      extracted_terms: extractedTerms,
    })
  }

  return replyClassifierOutputSchema.parse({
    label: 'needs_creator_review',
    confidence: 0.7,
    requires_creator_review: true,
    should_pause_autonomy: false,
    rationale: 'The reply is ambiguous enough to require creator review.',
    extracted_terms: extractedTerms,
  })
}

async function getDefaultCompletionClient(): Promise<ChatCompletionClient> {
  const { assertOpenAIConfigured, openai } = await import('@/lib/ai/client')
  assertOpenAIConfigured()
  return openai.chat.completions
}

function parseJsonObject(content: string): unknown {
  const value = JSON.parse(content) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Model response was not a JSON object')
  }
  return value
}

function matches(text: string, phrases: string[]) {
  return phrases.some((phrase) => text.includes(phrase))
}

function extractTerms(replyText: string): ReplyClassifierOutput['extracted_terms'] {
  const priceMatch = replyText.match(/\$([0-9][0-9,]*(?:\.[0-9]{1,2})?)/)
  const capacityMatch = replyText.match(/\b(?:capacity|cap|fits|accommodate[s]?)\s+(?:is\s+|up to\s+)?([0-9]{2,5})\b/i)
  const dateMatch = replyText.match(/\b(?:20[2-9][0-9]-[01][0-9]-[0-3][0-9]|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+[0-9]{1,2})\b/i)
  const terms: ReplyClassifierOutput['extracted_terms'] = {}

  if (priceMatch?.[1]) {
    terms.price_cents = parseDollarAmountToCents(priceMatch[1])
  }
  if (capacityMatch?.[1]) {
    terms.capacity = Number.parseInt(capacityMatch[1], 10)
  }
  if (dateMatch?.[0]) {
    terms.date = dateMatch[0]
  }
  if (terms.price_cents || terms.capacity || terms.date) {
    terms.terms_summary = 'Reply includes executable terms that need creator review before action.'
  }

  return terms
}

function parseDollarAmountToCents(amount: string): number {
  const [wholePart, decimalPart = ''] = amount.replace(/,/g, '').split('.')
  const dollars = Number.parseInt(wholePart, 10)
  const centsText = decimalPart.padEnd(2, '0').slice(0, 2)
  const cents = Number.parseInt(centsText || '0', 10)
  return dollars * 100 + cents
}
