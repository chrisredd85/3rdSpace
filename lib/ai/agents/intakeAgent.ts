import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { eventPlanSchema, AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'
import { buildAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'

export const intakeAgentInputSchema = z.object({
  user_message: z.string().trim().min(1),
  existing_event_plan: eventPlanSchema.nullish(),
  organizer_profile: z.record(z.unknown()).nullish(),
})

export const intakeAgentOutputSchema = z.object({
  updated_event_plan: eventPlanSchema,
  neighborhood: z.string().trim().min(1).nullable(),
  food_drink_needs: z.string().trim().min(1).nullable(),
  music_av_needs: z.string().trim().min(1).nullable(),
  vibe_audience: z.string().trim().min(1).nullable(),
  hard_constraints: z.array(z.string().trim().min(1)),
  missing_questions: z.array(z.string().trim().min(1)).max(3),
  confidence_score: z.number().min(0).max(1),
  next_best_question: z.string().trim().min(1).nullable(),
  assumptions_made: z.array(z.string().trim().min(1)),
})

export type IntakeAgentInput = z.infer<typeof intakeAgentInputSchema>
export type IntakeAgentOutput = z.infer<typeof intakeAgentOutputSchema>
export type IntakeAgentResult = AgentResult<IntakeAgentOutput>

export const intakeAgentDefinition = {
  agentName: 'intake',
  model: 'gpt-4o',
} as const

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>

const INTAKE_OUTPUT_CONTRACT = {
  updated_event_plan: {
    event_name: null,
    expected_attendance: null,
    city: null,
    venue_type: null,
    budget: null,
    event_date: null,
    monetization_model: null,
    headcount_min: null,
    headcount_max: null,
    ticket_price_target: null,
    profit_goal: null,
  },
  neighborhood: null,
  food_drink_needs: null,
  music_av_needs: null,
  vibe_audience: null,
  hard_constraints: [],
  missing_questions: ['string, max 3 total'],
  confidence_score: 0.75,
  next_best_question: 'string or null',
  assumptions_made: ['string'],
}

const INTAKE_SYSTEM_PROMPT = [
  'You are the 3rdSpace Intake Agent.',
  'Your job is to turn a vague event idea into a structured event draft and a short missing-question list.',
  'Return JSON only. Do not include markdown, prose outside JSON, or raw text.',
  'Preserve existing_event_plan fields unless the new user_message clearly changes them.',
  'Never invent confirmed facts. Put guesses in assumptions_made.',
  'Ask no more than 3 missing_questions at once.',
  'Do not send outreach, create bookings, authorize payments, or execute any action.',
  'Extract event_name, city, neighborhood, event_date, expected_attendance, budget, monetization_model, ticket_price_target, profit_goal, headcount_min, headcount_max, venue_type, food/drink needs, music/AV needs, vibe/audience, and hard constraints when present.',
  'Use monetization_model values like ticketed, free, or sponsored when the user provides enough evidence.',
  'Use null for unknown EventPlan fields. Every EventPlan key must be present.',
  `Output JSON must match this contract: ${JSON.stringify(INTAKE_OUTPUT_CONTRACT)}.`,
].join('\n')

export async function runIntakeAgent(
  payload: unknown,
  client: ChatCompletionClient = openai.chat.completions
): Promise<IntakeAgentResult> {
  const startedAt = Date.now()
  const input = intakeAgentInputSchema.parse(payload)

  assertOpenAIConfigured()

  const messages: AgentMessagePayload = [
    {
      role: 'system',
      content: INTAKE_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: JSON.stringify(input),
    },
  ]

  const completion = await client.create({
    model: intakeAgentDefinition.model,
    response_format: { type: 'json_object' },
    messages,
  })

  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, intakeAgentDefinition.model, messages, content)
  if (!content) {
    throw new AgentRunExecutionError('intake returned an empty model response', metadata)
  }

  let output: IntakeAgentOutput
  try {
    output = intakeAgentOutputSchema.parse(parseJsonObject(content))
  } catch (error) {
    throw new AgentRunExecutionError(getErrorMessage(error), metadata, error)
  }

  return {
    agent_name: intakeAgentDefinition.agentName,
    status: 'succeeded',
    ...metadata,
    duration_ms: Date.now() - startedAt,
    output,
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to parse intake model JSON'
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
      throw new Error(`Failed to parse intake model JSON: ${error.message}`)
    }
    throw new Error('Failed to parse intake model JSON')
  }
}

/*
Example API request:

await fetch('/api/ai/agents/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    agent_name: 'intake',
    payload: {
      user_message: 'I want to host a 60 person founder dinner in SF',
      existing_event_plan: null,
      organizer_profile: { organization_name: '3rdSpace Labs' }
    }
  })
})
*/
