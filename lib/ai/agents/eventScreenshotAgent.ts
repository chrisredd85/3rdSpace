import 'server-only'

import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { buildAgentRunMetadata, emptyAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'
import { AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'

const confidenceSchema = z.enum(['high', 'medium', 'low'])

const confidenceEntrySchema = z.object({
  confidence: confidenceSchema,
  source: z.string().trim().min(1),
})

const tierBreakdownSchema = z.object({
  tier_name: z.string().trim().min(1),
  tickets_sold: z.number().int().nonnegative().nullable(),
  gross_revenue_cents: z.number().int().nonnegative().nullable(),
  confidence: confidenceSchema,
})

export const eventScreenshotOutputSchema = z.object({
  tickets_sold: z.number().int().nonnegative().nullable(),
  gross_revenue_cents: z.number().int().nonnegative().nullable(),
  refunds_cents: z.number().int().nonnegative().nullable(),
  checked_in_count: z.number().int().nonnegative().nullable(),
  tier_breakdown: z.array(tierBreakdownSchema).default([]),
  field_confidence: z.record(confidenceEntrySchema),
  notes: z.string().trim().nullable(),
})

export type EventScreenshotOutput = z.infer<typeof eventScreenshotOutputSchema>
export type EventScreenshotResult = Omit<AgentResult<EventScreenshotOutput>, 'agent_name'> & {
  agent_name: typeof eventScreenshotAgentDefinition.agentName
}

export type EventScreenshotInput = {
  files?: Array<{
    filename?: string | null
    mimeType: string
    base64: string
  }>
  imageUrls?: string[]
  platform?: string | null
}

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

export const eventScreenshotAgentDefinition = {
  agentName: 'event_screenshot_extraction',
  model: 'gpt-4o',
} as const

const SYSTEM_PROMPT = [
  'You extract post-event ticketing metrics from event platform screenshots.',
  'Return JSON only. Do not infer hidden numbers.',
  'Prefer checked-in/scanned/attended counts over RSVPs or registered counts.',
  'Return all money as integer cents.',
  'If a field is not visible, return null for that field and low confidence.',
  'Per-field confidence must reflect metric reliability: high for clearly labeled values, medium for visible but ambiguously labeled values, low for weak or absent evidence.',
].join('\n')

const USER_PROMPT = [
  'Extract this shape exactly:',
  '{"tickets_sold": number|null, "gross_revenue_cents": number|null, "refunds_cents": number|null, "checked_in_count": number|null, "tier_breakdown": [{"tier_name": string, "tickets_sold": number|null, "gross_revenue_cents": number|null, "confidence": "high"|"medium"|"low"}], "field_confidence": {"field_name": {"confidence": "high"|"medium"|"low", "source": "screenshot"}}, "notes": string|null}.',
  'Supported sources include Posh, Eventbrite, Luma, Partiful, and other event platforms.',
].join('\n')

export async function runEventScreenshotAgent(
  payload: EventScreenshotInput | unknown,
  client: ChatCompletionClient = openai.chat.completions
): Promise<EventScreenshotResult> {
  const startedAt = Date.now()
  const input = normalizeInput(payload)
  const imageUrls = [
    ...(input.imageUrls ?? []),
    ...((input.files ?? []).map((file) => toDataUrl(file.base64, file.mimeType))),
  ].filter(Boolean)

  if (imageUrls.length === 0) {
    return {
      agent_name: eventScreenshotAgentDefinition.agentName,
      status: 'succeeded',
      ...emptyAgentRunMetadata(eventScreenshotAgentDefinition.model),
      duration_ms: Date.now() - startedAt,
      output: emptyOutput('No screenshot images were supplied'),
    }
  }

  assertOpenAIConfigured()

  const prompt = [
    USER_PROMPT,
    input.platform ? `Platform hint: ${input.platform}` : '',
    input.files?.length ? `Filenames: ${input.files.map((file) => file.filename).filter(Boolean).join(', ')}` : '',
  ].filter(Boolean).join('\n\n')
  const metadataMessages: AgentMessagePayload = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ]

  const completion = await client.create({
    model: eventScreenshotAgentDefinition.model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...imageUrls.slice(0, 5).map((imageUrl) => ({
            type: 'image_url',
            image_url: { url: imageUrl },
          })),
        ],
      },
    ] as never,
  })

  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, eventScreenshotAgentDefinition.model, metadataMessages, content)
  if (!content) {
    throw new AgentRunExecutionError('event_screenshot_extraction returned an empty model response', metadata)
  }

  try {
    const output = eventScreenshotOutputSchema.parse(parseJsonObject(content))
    return {
      agent_name: eventScreenshotAgentDefinition.agentName,
      status: 'succeeded',
      ...metadata,
      duration_ms: Date.now() - startedAt,
      output,
    }
  } catch (error) {
    throw new AgentRunExecutionError(getErrorMessage(error), metadata, error)
  }
}

function normalizeInput(payload: EventScreenshotInput | unknown): EventScreenshotInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const record = payload as EventScreenshotInput
  return {
    files: Array.isArray(record.files) ? record.files.slice(0, 5) : [],
    imageUrls: Array.isArray(record.imageUrls) ? record.imageUrls.slice(0, 5) : [],
    platform: typeof record.platform === 'string' ? record.platform : null,
  }
}

function emptyOutput(notes: string): EventScreenshotOutput {
  return {
    tickets_sold: null,
    gross_revenue_cents: null,
    refunds_cents: null,
    checked_in_count: null,
    tier_breakdown: [],
    field_confidence: {
      tickets_sold: { confidence: 'low', source: 'screenshot' },
      gross_revenue_cents: { confidence: 'low', source: 'screenshot' },
      refunds_cents: { confidence: 'low', source: 'screenshot' },
      checked_in_count: { confidence: 'low', source: 'screenshot' },
    },
    notes,
  }
}

function toDataUrl(base64: string, mimeType: string) {
  return `data:${mimeType || 'image/png'};base64,${base64}`
}

function parseJsonObject(content: string) {
  const parsed = JSON.parse(content) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Model response was not a JSON object')
  }
  return parsed
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to parse model JSON'
}
