import { z } from 'zod'

export const eventPlanFieldSchema = z.enum([
  'event_name',
  'expected_attendance',
  'city',
  'venue_type',
  'budget',
  'event_date',
  'monetization_model',
  'headcount_min',
  'headcount_max',
  'ticket_price_target',
  'profit_goal',
])

export const eventPlanSchema = z.object({
  event_name: z.string().trim().min(1).nullable(),
  expected_attendance: z.number().int().nonnegative().nullable(),
  city: z.string().trim().min(1).nullable(),
  venue_type: z.string().trim().min(1).nullable(),
  budget: z.number().nonnegative().nullable(),
  event_date: z.string().trim().min(1).nullable(),
  monetization_model: z.string().trim().min(1).nullable(),
  headcount_min: z.number().int().nonnegative().nullable(),
  headcount_max: z.number().int().nonnegative().nullable(),
  ticket_price_target: z.number().nonnegative().nullable(),
  profit_goal: z.number().nonnegative().nullable(),
})

export type EventPlan = z.infer<typeof eventPlanSchema>

export const agentNameSchema = z.enum([
  'intake',
  'economics',
  'venue_matching',
  'outreach',
  'response_analysis',
  'workspace',
  'timeline',
  'event_plan_extractor',
  'event_planning_advisor',
  'booking_ops_assistant',
])

export type AgentName = z.infer<typeof agentNameSchema>

export const approvalActionSchema = z.object({
  title: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  requires_human_approval: z.literal(true),
})

export const agentOutputSchema = z.object({
  event_plan: eventPlanSchema,
  summary: z.string().trim().min(1),
  missing_fields: z.array(eventPlanFieldSchema),
  recommendations: z.array(z.string().trim().min(1)),
  risks: z.array(z.string().trim().min(1)),
  approval_required: z.boolean(),
  approval_actions: z.array(approvalActionSchema),
})

export type AgentOutput = z.infer<typeof agentOutputSchema>

export const agentRunStatusSchema = z.enum(['succeeded', 'failed'])
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>

export const agentMessagePayloadSchema = z.array(z.object({
  role: z.enum(['system', 'user']),
  content: z.string(),
}))

export type AgentMessagePayload = z.infer<typeof agentMessagePayloadSchema>

export const agentRunMetadataSchema = z.object({
  model: z.string().trim().min(1),
  prompt_tokens: z.number().int().nonnegative().nullable(),
  completion_tokens: z.number().int().nonnegative().nullable(),
  messages_payload: agentMessagePayloadSchema,
  raw_model_output: z.string().nullable(),
})

export type AgentRunMetadata = z.infer<typeof agentRunMetadataSchema>

export const agentResultSchema = z.object({
  agent_name: agentNameSchema,
  status: z.literal('succeeded'),
  model: agentRunMetadataSchema.shape.model,
  prompt_tokens: agentRunMetadataSchema.shape.prompt_tokens,
  completion_tokens: agentRunMetadataSchema.shape.completion_tokens,
  messages_payload: agentRunMetadataSchema.shape.messages_payload,
  raw_model_output: agentRunMetadataSchema.shape.raw_model_output,
  duration_ms: z.number().int().nonnegative(),
  output: agentOutputSchema,
})

export type AgentResult<TOutput = AgentOutput> = {
  agent_name: AgentName
  status: 'succeeded'
  model: string
  prompt_tokens: number | null
  completion_tokens: number | null
  messages_payload: unknown
  raw_model_output: string | null
  duration_ms: number
  output: TOutput
}

export class AgentRunExecutionError extends Error {
  readonly metadata: Partial<AgentRunMetadata>

  constructor(message: string, metadata: Partial<AgentRunMetadata>, cause?: unknown) {
    super(message)
    this.name = 'AgentRunExecutionError'
    this.metadata = metadata
    if (cause !== undefined) {
      this.cause = cause
    }
  }
}

export function getAgentRunErrorMetadata(error: unknown): Partial<AgentRunMetadata> {
  return error instanceof AgentRunExecutionError ? error.metadata : {}
}
