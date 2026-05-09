import type OpenAI from 'openai'
import { z } from 'zod'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import { eventPlanSchema, AgentRunExecutionError, type AgentResult } from '@/lib/ai/types'
import { buildAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'
import { vendorStackItemSchema, commercialModelSchema } from '@/lib/planner/archetypes/types'

const intakeMessageSchema = z.object({
  role: z.string().trim().min(1),
  content: z.string().trim().min(1),
})

const intakeTicketPlatformSchema = z.enum(['eventbrite', 'luma', 'posh', 'partiful'])
const intakeBuilderHistorySchema = z.object({
  sample_size: z.number().int().nonnegative(),
  avg: z.number().nonnegative(),
  p75: z.number().nonnegative(),
  confidence: z.enum(['low', 'medium', 'high']),
  last_event_at: z.string().trim().min(1).nullable(),
})

export const intakeExtractedFieldsSchema = z.object({
  event_type: z.string().trim().min(1).nullable(),
  guest_count: z.number().int().nonnegative().nullable(),
  neighborhood: z.string().trim().min(1).nullable(),
  date_window_start: z.string().trim().min(1).nullable(),
  date_window_end: z.string().trim().min(1).nullable(),
  budget_cap_cents: z.number().int().nonnegative().nullable(),
  ticketed: z.boolean().nullable(),
  ticket_price_target: z.number().int().nonnegative().nullable(),
  food_responsibility: z.string().trim().min(1).nullable(),
  profit_goal_cents: z.number().int().nonnegative().nullable(),
})

export const intakeAgentInputSchema = z.object({
  user_message: z.string().trim().min(1),
  existing_event_plan: eventPlanSchema.nullish(),
  current_plan: z.record(z.unknown()).nullish(),
  messages: z.array(intakeMessageSchema).default([]),
  connected_platforms: z.array(intakeTicketPlatformSchema).default([]),
  builder_history: intakeBuilderHistorySchema.nullish(),
  resolved_archetype: z.object({
    key: z.string().trim().min(1),
    display_name: z.string().trim().min(1),
    capacity_range: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
    vendor_stack: z.array(vendorStackItemSchema),
    preferred_commercial_models: z.array(commercialModelSchema),
  }).nullable().optional(),
  organizer_profile: z.record(z.unknown()).nullish(),
})

export const intakeAgentOutputSchema = z.object({
  reflection: z.string().trim().min(1),
  extracted_fields: intakeExtractedFieldsSchema,
  updated_event_plan: eventPlanSchema,
  neighborhood: z.string().trim().min(1).nullable(),
  food_drink_needs: z.string().trim().min(1).nullable(),
  music_av_needs: z.string().trim().min(1).nullable(),
  vibe_audience: z.string().trim().min(1).nullable(),
  hard_constraints: z.array(z.string().trim().min(1)),
  missing_questions: z.array(z.string().trim().min(1)).max(1),
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
  reflection: 'Got it — one short clause reflecting what the user said.',
  next_best_question: 'one conversational question string, or null when ready',
  missing_questions: ['same single question as next_best_question, or [] when ready'],
  extracted_fields: {
    event_type: null,
    guest_count: null,
    neighborhood: null,
    date_window_start: null,
    date_window_end: null,
    budget_cap_cents: null,
    ticketed: null,
    ticket_price_target: null,
    food_responsibility: null,
    profit_goal_cents: null,
  },
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
  confidence_score: 0.75,
  assumptions_made: ['string'],
}

const INTAKE_SYSTEM_PROMPT = [
  'You are the 3rdSpace Intake Agent. Your voice is a sharp event concierge, not a form wizard.',
  'Turn a vague event idea into a structured event draft while sounding natural and useful.',
  'Return JSON only. Do not include markdown, prose outside JSON, or raw text.',
  'The user-facing response is built from reflection plus next_best_question. Make those fields conversational.',
  'ALWAYS set reflection to one short clause that reflects back what the user said, using the user\'s own event words when possible. Example: "Got it — founders game night in the Mission, next two weeks."',
  'Then ask exactly ONE clarifying question for the highest-priority missing field. Priority order: guest_count, date_window, budget_cap, ticketing_model, food_responsibility.',
  'The input includes connected_platforms, the builder ticketing platforms that are actually connected and usable for sales history.',
  'The input may include resolved_archetype. If resolved_archetype is present, treat the event type as understood and do not ask the user to clarify event type.',
  'If resolved_archetype is null or missing and current_plan does not already have event_type, ask exactly one clarifying question: "Is this more of a mixer, a workshop, a dinner, or something else?"',
  'Use resolved_archetype capacity_range, vendor_stack, and preferred_commercial_models as planning context only. Do not expose internal config names unless helpful in plain language.',
  'If connected_platforms is empty and the user mentions ticketing, paid tickets, ticket price, sales, RSVPs on a platform, or a paid event, ask exactly: "Which ticketing platform are you using? Eventbrite, Luma, Posh, or Partiful?"',
  'If connected_platforms has more than one platform and this event is ticketed or platform-specific, either ask which connected platform to use for this event or default to the first platform in connected_platforms as the most recently used.',
  'Do not assume historical ticket data is available when connected_platforms is empty.',
  'The input may include builder_history summarizing past ticketed attendance for this archetype. If builder_history.confidence is "medium" or "high" and the user\'s stated guest count is more than 30% below builder_history.p75, add a single follow-up note in reflection, not a question: "Quick note — your last few events sold more like 180 tickets, so I\'m pulling venues that can handle either size." Do not block intake on this and do not ask the user to revise their number.',
  'Skip any field already present in current_plan, existing_event_plan, or prior messages.',
  'Phrase the question conversationally, never as a label. Good: "How many people are you planning for?" Bad: "What is your GUEST_COUNT?"',
  'NEVER ask multiple questions in one message. NEVER list bullet options unless the user explicitly asks for examples.',
  'NEVER repeat a question the user already answered.',
  'When all required fields are present, set next_best_question to null, missing_questions to [], and make reflection a one-sentence readiness signal like: "Locking that in — pulling Mission venues that fit 50 guests and a $5k budget."',
  'Extract fields from the latest user_message and merge with current_plan and existing_event_plan.',
  'Never wipe a previously-set field unless the user explicitly contradicts it.',
  'Never invent confirmed facts. Put guesses in assumptions_made.',
  'Do not send outreach, create bookings, authorize payments, or execute any action.',
  'Extract event_name, city, neighborhood, event_date, expected_attendance, budget, monetization_model, ticket_price_target, profit_goal, headcount_min, headcount_max, venue_type, food/drink needs, music/AV needs, vibe/audience, and hard constraints when present.',
  'Also populate extracted_fields using planner DB field names: event_type, guest_count, neighborhood, date_window_start, date_window_end, budget_cap_cents, ticketed, ticket_price_target, food_responsibility, profit_goal_cents.',
  'All monetary extracted_fields values must be integer cents.',
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
