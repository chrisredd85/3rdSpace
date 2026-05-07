import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { eventPlanSchema, AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'
import { buildAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'

export const outreachTypeSchema = z.enum([
  'venue_inquiry',
  'vendor_inquiry',
  'follow_up',
  'sponsor_inquiry',
])

export const targetPartnerSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(['venue', 'vendor', 'sponsor']),
  contact_name: z.string().trim().min(1).nullable().optional(),
  contact_email: z.string().trim().min(1).nullable().optional(),
  phone: z.string().trim().min(1).nullable().optional(),
  website: z.string().trim().min(1).nullable().optional(),
  contact_info: z.record(z.unknown()).nullable().optional(),
}).passthrough()

export const outreachAgentInputSchema = z.object({
  event_plan: eventPlanSchema,
  target_partner: targetPartnerSchema,
  outreach_type: outreachTypeSchema,
  organizer_preferences: z.record(z.unknown()).nullish(),
  previous_thread_summary: z.string().trim().min(1).nullish(),
})

export const outreachAgentOutputSchema = z.object({
  subject: z.string().trim().min(1),
  message_body: z.string().trim().min(1),
  requested_info: z.array(z.string().trim().min(1)),
  follow_up_date_suggestion: z.string().trim().min(1).nullable(),
  tone: z.string().trim().min(1),
  approval_required: z.literal(true),
})

export type OutreachAgentInput = z.infer<typeof outreachAgentInputSchema>
export type OutreachAgentOutput = z.infer<typeof outreachAgentOutputSchema>
export type OutreachAgentResult = AgentResult<OutreachAgentOutput>

export const outreachAgentDefinition = {
  agentName: 'outreach',
  model: 'gpt-4o',
} as const

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

const OUTREACH_OUTPUT_CONTRACT = {
  subject: 'string',
  message_body: 'string',
  requested_info: ['string'],
  follow_up_date_suggestion: 'string or null',
  tone: 'string',
  approval_required: true,
}

const OUTREACH_SYSTEM_PROMPT = [
  'You are the 3rdSpace Outreach Agent.',
  'Generate concise, professional outreach drafts to venues, vendors, and sponsors.',
  'Return JSON only. Do not include markdown, prose outside JSON, or raw text.',
  'The generated message is only a draft for human approval. Never send email, create bookings, authorize payments, or make commitments.',
  'approval_required must always be exactly true.',
  'Include the event date when known, expected_attendance when known, event_name when known, budget range or budget when available, food/drink needs when available in organizer_preferences, and a specific ask for availability, pricing, minimums, or next details.',
  'Do not overpromise payment, booking, final attendance, exclusivity, or confirmed terms.',
  'If a fact is unknown, ask for it or phrase it as to be confirmed. Do not invent confirmed facts.',
  `Output JSON must match this contract: ${JSON.stringify(OUTREACH_OUTPUT_CONTRACT)}.`,
].join('\n')

export async function runOutreachAgent(
  payload: unknown,
  client: ChatCompletionClient = openai.chat.completions
): Promise<OutreachAgentResult> {
  const startedAt = Date.now()
  const input = outreachAgentInputSchema.parse(payload)

  assertOpenAIConfigured()

  const messages: AgentMessagePayload = [
    {
      role: 'system',
      content: OUTREACH_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: JSON.stringify(input),
    },
  ]

  const completion = await client.create({
    model: outreachAgentDefinition.model,
    response_format: { type: 'json_object' },
    messages,
  })

  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, outreachAgentDefinition.model, messages, content)
  if (!content) {
    throw new AgentRunExecutionError('outreach returned an empty model response', metadata)
  }

  let output: OutreachAgentOutput
  try {
    output = outreachAgentOutputSchema.parse(parseJsonObject(content))
  } catch (error) {
    throw new AgentRunExecutionError(getErrorMessage(error), metadata, error)
  }

  return {
    agent_name: outreachAgentDefinition.agentName,
    status: 'succeeded',
    ...metadata,
    duration_ms: Date.now() - startedAt,
    output,
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to parse outreach model JSON'
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
      throw new Error(`Failed to parse outreach model JSON: ${error.message}`)
    }
    throw new Error('Failed to parse outreach model JSON')
  }
}
