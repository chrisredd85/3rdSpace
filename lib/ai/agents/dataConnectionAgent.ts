import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'
import { buildAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'

const ticketPlatformSchema = z.enum(['eventbrite', 'luma', 'posh', 'partiful'])

const dataConnectionRowSchema = z.object({
  platform: ticketPlatformSchema,
  status: z.string().trim().min(1),
  account_label: z.string().trim().min(1).nullable(),
  webhook_url: z.string().trim().min(1).nullable(),
  last_connected_at: z.string().trim().min(1).nullable(),
  has_event_link: z.boolean(),
})

export const dataConnectionAgentInputSchema = z.object({
  current_plan: z.record(z.unknown()).nullable(),
  requested_platform: ticketPlatformSchema.nullable(),
  external_event_url: z.string().trim().min(1).nullable(),
  connected_platforms: z.array(dataConnectionRowSchema),
  data_goal: z.string().trim().min(1).default('Track RSVPs, ticket sales, refunds, and check-ins for this event.'),
})

const setupStepSchema = z.object({
  title: z.string().trim().min(1),
  detail: z.string().trim().min(1),
  action_type: z.enum(['oauth', 'webhook', 'event_link', 'manual_question', 'verify']),
})

const dataSourceSchema = z.object({
  source: z.string().trim().min(1),
  metrics: z.array(z.string().trim().min(1)),
  collection_method: z.enum(['api', 'webhook', 'event_link', 'manual']),
})

export const dataConnectionAgentOutputSchema = z.object({
  summary: z.string().trim().min(1),
  recommended_platform: ticketPlatformSchema.nullable(),
  setup_status: z.enum(['ready_to_collect', 'needs_connection', 'needs_event_link', 'needs_platform_choice']),
  setup_steps: z.array(setupStepSchema).min(1).max(6),
  data_sources: z.array(dataSourceSchema).min(1),
  post_event_questions: z.array(z.string().trim().min(1)).min(1).max(6),
  cost_note: z.string().trim().min(1),
  guardrails: z.array(z.string().trim().min(1)).min(1),
})

export type DataConnectionAgentInput = z.infer<typeof dataConnectionAgentInputSchema>
export type DataConnectionAgentOutput = z.infer<typeof dataConnectionAgentOutputSchema>
export type DataConnectionAgentResult = AgentResult<DataConnectionAgentOutput>

export const dataConnectionAgentDefinition = {
  agentName: 'data_connection',
  model: 'gpt-4o-mini',
} as const

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

const OUTPUT_CONTRACT = {
  summary: 'plain-language setup summary',
  recommended_platform: 'eventbrite | luma | posh | partiful | null',
  setup_status: 'ready_to_collect | needs_connection | needs_event_link | needs_platform_choice',
  setup_steps: [
    {
      title: 'step title',
      detail: 'exact user action needed',
      action_type: 'oauth | webhook | event_link | manual_question | verify',
    },
  ],
  data_sources: [
    {
      source: 'Eventbrite/Luma/Posh/Partiful/manual venue report',
      metrics: ['RSVPs', 'tickets sold', 'checked-in count'],
      collection_method: 'api | webhook | event_link | manual',
    },
  ],
  post_event_questions: ['specific question for organizer or venue'],
  cost_note: 'short note explaining AI is only used for setup/summary, not row-by-row analysis',
  guardrails: ['never invent metrics', 'use deterministic rollups for raw data'],
}

const SYSTEM_PROMPT = [
  'You are the 3rdSpace Data Connection Agent.',
  'Your job is to help an event organizer set up the data sources needed to measure actual attendance and venue foot traffic signals.',
  'Use AI only for setup guidance and missing-data questions. Raw ticket, RSVP, refund, and check-in metrics are calculated by deterministic backend queries from event_sales_data and imported_attendees.',
  'Return JSON only. Do not include markdown or prose outside JSON.',
  'Never invent check-in counts, ticket sales, bar sales, venue traffic, or revenue. If data is missing, ask for a connection, event link, import, or post-event venue report.',
  'Prefer the requested platform when supplied. Otherwise choose a connected platform. If no platform is connected and the plan is ticketed, recommend Eventbrite for OAuth when possible; otherwise recommend Luma/Posh webhooks or Partiful event-link import based on the organizer wording.',
  'For Eventbrite, setup is OAuth plus event linking/import. For Luma and Posh, setup is webhook endpoint plus event linking. For Partiful, setup is event-link import/webhook where available.',
  'Include manual post-event questions for venue/bar/cafe foot traffic that ticket platforms cannot know, such as walk-ins, peak room count, bar sales, and staff-observed traffic.',
  'Never execute outreach, bookings, payments, purchases, or platform changes. This is setup guidance only.',
  `Output JSON must match this contract: ${JSON.stringify(OUTPUT_CONTRACT)}.`,
].join('\n')

export async function runDataConnectionAgent(
  payload: unknown,
  client: ChatCompletionClient = openai.chat.completions
): Promise<DataConnectionAgentResult> {
  const startedAt = Date.now()
  const input = dataConnectionAgentInputSchema.parse(payload)

  assertOpenAIConfigured()

  const messages: AgentMessagePayload = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(input) },
  ]

  const completion = await client.create({
    model: dataConnectionAgentDefinition.model,
    response_format: { type: 'json_object' },
    messages,
  })

  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, dataConnectionAgentDefinition.model, messages, content)
  if (!content) {
    throw new AgentRunExecutionError('data_connection returned an empty model response', metadata)
  }

  try {
    const output = dataConnectionAgentOutputSchema.parse(parseJsonObject(content))
    return {
      agent_name: dataConnectionAgentDefinition.agentName,
      status: 'succeeded',
      ...metadata,
      duration_ms: Date.now() - startedAt,
      output,
    }
  } catch (error) {
    throw new AgentRunExecutionError(getErrorMessage(error), metadata, error)
  }
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
      throw new Error(`Failed to parse data connection model JSON: ${error.message}`)
    }
    throw new Error('Failed to parse data connection model JSON')
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to parse data connection model JSON'
}
