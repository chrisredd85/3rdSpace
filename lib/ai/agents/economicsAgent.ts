import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'
import { buildAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'
import {
  calculateEventPlanningEconomics,
  eventPlanningEconomicsInputSchema,
  eventPlanningEconomicsOutputSchema,
} from '@/lib/finance/eventPlanningEconomics'

export const economicsAgentInputSchema = eventPlanningEconomicsInputSchema

const economicsRecommendationSchema = z.object({
  recommendation_summary: z.string().trim().min(1),
})

export const economicsAgentOutputSchema = eventPlanningEconomicsOutputSchema.extend({
  recommendation_summary: z.string().trim().min(1),
})

export type EconomicsAgentInput = z.infer<typeof economicsAgentInputSchema>
export type EconomicsAgentOutput = z.infer<typeof economicsAgentOutputSchema>
export type EconomicsAgentResult = AgentResult<EconomicsAgentOutput>

export const economicsAgentDefinition = {
  agentName: 'economics',
  model: 'gpt-4o-mini',
} as const

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

const ECONOMICS_SYSTEM_PROMPT = [
  'You are the 3rdSpace Event Economics Agent.',
  'Explain pre-event profitability projections from supplied hypothetical inputs only.',
  'Return JSON only with exactly this field: recommendation_summary.',
  'Do not recalculate, overwrite, or reinterpret numeric fields. The application code owns all totals, scenarios, margins, and break-even math.',
  'All money in the input is integer cents. Convert cents to dollars only inside display wording.',
  'Do not read from a database, send outreach, create bookings, authorize payments, or execute any action.',
].join('\n')

export async function runEconomicsAgent(
  payload: unknown,
  client: ChatCompletionClient = openai.chat.completions
): Promise<EconomicsAgentResult> {
  const startedAt = Date.now()
  const input = economicsAgentInputSchema.parse(payload)
  const calculations = calculateEventPlanningEconomics(input)

  assertOpenAIConfigured()

  const messages: AgentMessagePayload = [
    {
      role: 'system',
      content: ECONOMICS_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: JSON.stringify({
        event_plan: input.event_plan,
        input_cents: {
          budget_line_items: input.budget_line_items,
          expected_attendance: input.expected_attendance,
          venue_cost_cents: input.venue_cost_cents,
          vendor_cost_cents: input.vendor_cost_cents,
          ticket_price_cents: input.ticket_price_cents,
          sponsorship_revenue_cents: input.sponsorship_revenue_cents,
        },
        calculated_output_cents: calculations,
      }),
    },
  ]

  const completion = await client.create({
    model: economicsAgentDefinition.model,
    response_format: { type: 'json_object' },
    messages,
  })

  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, economicsAgentDefinition.model, messages, content)
  if (!content) {
    throw new AgentRunExecutionError('economics returned an empty model response', metadata)
  }

  let output: EconomicsAgentOutput
  try {
    const recommendation = economicsRecommendationSchema.parse(parseJsonObject(content))
    output = economicsAgentOutputSchema.parse({
      ...calculations,
      recommendation_summary: recommendation.recommendation_summary,
    })
  } catch (error) {
    throw new AgentRunExecutionError(getErrorMessage(error), metadata, error)
  }

  return {
    agent_name: economicsAgentDefinition.agentName,
    status: 'succeeded',
    ...metadata,
    duration_ms: Date.now() - startedAt,
    output,
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to parse economics model JSON'
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
      throw new Error(`Failed to parse economics model JSON: ${error.message}`)
    }
    throw new Error('Failed to parse economics model JSON')
  }
}
