import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'
import { buildAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'

export const replyClassifierIntentSchema = z.enum([
  'available',
  'unavailable',
  'needs_info',
  'redirect',
  'price_quote',
  'contract_request',
  'other',
])

export const replyClassifierStateSchema = z.enum([
  'draft',
  'awaiting_reply',
  'in_negotiation',
  'confirmed',
  'declined',
  'stale',
  'cancelled',
  'awaiting_creator_review',
])

export const replyClassifierInputSchema = z.object({
  thread: z.object({
    target_type: z.enum(['venue', 'vendor']),
    target_name: z.string().trim().min(1),
    state: replyClassifierStateSchema,
    plan_title: z.string().trim().min(1),
    event_date: z.string().trim().min(1).nullable(),
    guest_count: z.number().int().nonnegative().nullable(),
    budget_cap_cents: z.number().int().nonnegative().nullable(),
  }),
  previous_thread_summary: z.string().trim().min(1).nullable().optional(),
  inbound_message: z.object({
    from: z.string().trim().min(1).nullable(),
    subject: z.string().trim().min(1),
    body_text: z.string().trim().min(1),
    received_at: z.string().trim().min(1),
  }),
})

export const replyClassifierOutputSchema = z.object({
  intent: replyClassifierIntentSchema,
  confidence: z.number().min(0).max(1),
  extracted: z.object({
    price_cents: z.number().int().nonnegative().nullable(),
    date_confirmed: z.boolean(),
    capacity_confirmed: z.boolean(),
    alternative_date: z.string().trim().min(1).nullable(),
    required_action_from_creator: z.string().trim().min(1).nullable(),
  }),
  suggested_next_state: replyClassifierStateSchema,
  requires_human_review: z.boolean(),
  summary_for_creator: z.string().trim().min(1),
})

export type ReplyClassifierInput = z.infer<typeof replyClassifierInputSchema>
export type ReplyClassifierOutput = z.infer<typeof replyClassifierOutputSchema>
export type ReplyClassifierResult = AgentResult<ReplyClassifierOutput>

export const replyClassifierDefinition = {
  agentName: 'reply_classifier',
  model: 'gpt-4o-mini',
} as const

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

const REPLY_CLASSIFIER_OUTPUT_CONTRACT = {
  intent: 'available | unavailable | needs_info | redirect | price_quote | contract_request | other',
  confidence: 'number between 0 and 1',
  extracted: {
    price_cents: 'integer cents or null',
    date_confirmed: 'boolean',
    capacity_confirmed: 'boolean',
    alternative_date: 'string or null',
    required_action_from_creator: 'string or null',
  },
  suggested_next_state: 'draft | awaiting_reply | in_negotiation | confirmed | declined | stale | cancelled | awaiting_creator_review',
  requires_human_review: 'boolean',
  summary_for_creator: 'string',
}

const REPLY_CLASSIFIER_SYSTEM_PROMPT = [
  'You are the 3rdSpace Reply Classifier.',
  'Classify inbound venue/vendor outreach replies for a creator-led event plan.',
  'Return JSON only. Do not include markdown, prose outside JSON, or raw text.',
  'Never draft or send a reply. Never confirm a booking, payment, deposit, date, or terms.',
  'Extract monetary quotes as integer cents when explicit. If unclear, use null and set requires_human_review true.',
  'Use suggested_next_state only as a recommendation. confirmed should only be used when the partner clearly confirms availability and terms without unresolved creator action.',
  'If the reply asks a question, asks for missing info, redirects to another contact, includes a contract, or is ambiguous, set requires_human_review true.',
  'If confidence is below 0.7, requires_human_review should be true.',
  `Output JSON must match this contract: ${JSON.stringify(REPLY_CLASSIFIER_OUTPUT_CONTRACT)}.`,
].join('\n')

export async function runReplyClassifier(
  payload: unknown,
  client: ChatCompletionClient = openai.chat.completions
): Promise<ReplyClassifierResult> {
  const startedAt = Date.now()
  const input = replyClassifierInputSchema.parse(payload)

  assertOpenAIConfigured()

  const messages: AgentMessagePayload = [
    {
      role: 'system',
      content: REPLY_CLASSIFIER_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: JSON.stringify(input),
    },
  ]

  const completion = await client.create({
    model: replyClassifierDefinition.model,
    response_format: { type: 'json_object' },
    messages,
  })

  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, replyClassifierDefinition.model, messages, content)
  if (!content) {
    throw new AgentRunExecutionError('reply classifier returned an empty model response', metadata)
  }

  let output: ReplyClassifierOutput
  try {
    output = replyClassifierOutputSchema.parse(parseJsonObject(content))
  } catch (error) {
    throw new AgentRunExecutionError(getErrorMessage(error), metadata, error)
  }

  return {
    agent_name: replyClassifierDefinition.agentName,
    status: 'succeeded',
    ...metadata,
    duration_ms: Date.now() - startedAt,
    output,
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to parse reply classifier JSON'
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
      throw new Error(`Failed to parse reply classifier JSON: ${error.message}`)
    }
    throw new Error('Failed to parse reply classifier JSON')
  }
}
