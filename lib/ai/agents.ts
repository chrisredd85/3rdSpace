import type OpenAI from 'openai'
import { assertOpenAIConfigured, openai } from '@/lib/ai/client'
import {
  economicsAgentDefinition,
  runEconomicsAgent,
  type EconomicsAgentResult,
} from '@/lib/ai/agents/economicsAgent'
import { intakeAgentDefinition, runIntakeAgent, type IntakeAgentResult } from '@/lib/ai/agents/intakeAgent'
import {
  runVenueMatchingAgent,
  venueMatchingAgentDefinition,
  type VenueMatchingAgentResult,
} from '@/lib/ai/agents/venueMatchingAgent'
import {
  outreachAgentDefinition,
  runOutreachAgent,
  type OutreachAgentResult,
} from '@/lib/ai/agents/outreachAgent'
import {
  replyClassifierDefinition,
  runReplyClassifier,
  type ReplyClassifierResult,
} from '@/lib/ai/agents/replyClassifier'
import {
  responseAnalysisAgentDefinition,
  runResponseAnalysisAgent,
  type ResponseAnalysisAgentResult,
} from '@/lib/ai/agents/responseAnalysisAgent'
import {
  runWorkspaceAgent,
  workspaceAgentDefinition,
  type WorkspaceAgentResult,
} from '@/lib/ai/agents/workspaceAgent'
import {
  runTimelineAgent,
  timelineAgentDefinition,
  type TimelineAgentResult,
} from '@/lib/ai/agents/timelineAgent'
import {
  dataConnectionAgentDefinition,
  runDataConnectionAgent,
  type DataConnectionAgentResult,
} from '@/lib/ai/agents/dataConnectionAgent'
import {
  documentExtractionAgentDefinition,
  runDocumentExtractionAgent,
  type DocumentExtractionResult,
} from '@/lib/ai/agents/documentExtractionAgent'
import {
  agentNameSchema,
  agentOutputSchema,
  agentResultSchema,
  AgentRunExecutionError,
  type AgentName,
  type AgentResult,
} from '@/lib/ai/types'
import { buildAgentRunMetadata, type AgentMessagePayload } from '@/lib/ai/run-metadata'

const EVENT_PLAN_FIELDS = [
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
] as const

const AGENT_OUTPUT_CONTRACT = {
  event_plan: Object.fromEntries(EVENT_PLAN_FIELDS.map((field) => [field, null])),
  summary: 'string',
  missing_fields: ['event_name'],
  recommendations: ['string'],
  risks: ['string'],
  approval_required: true,
  approval_actions: [
    {
      title: 'string',
      rationale: 'string',
      requires_human_approval: true,
    },
  ],
}

type AgentDefinition = {
  agentName: AgentName
  model: 'gpt-4o' | 'gpt-4o-mini'
} & (
  | { outputSchema: 'foundation'; systemPrompt: string }
  | { outputSchema: 'intake' }
  | { outputSchema: 'economics' }
  | { outputSchema: 'venue_matching' }
  | { outputSchema: 'outreach' }
  | { outputSchema: 'reply_classifier' }
  | { outputSchema: 'response_analysis' }
  | { outputSchema: 'workspace' }
  | { outputSchema: 'timeline' }
  | { outputSchema: 'data_connection' }
  | { outputSchema: 'document_extraction' }
)

type ChatCompletionClient = Pick<OpenAI['chat']['completions'], 'create'>
type ChatCompletionCreate = OpenAI['chat']['completions']['create']
type ChatCompletionCreateBody = Parameters<ChatCompletionCreate>[0]
type ChatCompletionCreateOptions = Parameters<ChatCompletionCreate>[1]

const AGENT_OPENAI_TIMEOUT_MS = 15_000

export type RunAgentInput = {
  agent_name: AgentName
  payload: Record<string, unknown>
  user_id: string
  event_id?: string | null
}

export const AGENT_REGISTRY: Record<AgentName, AgentDefinition> = {
  intake: {
    agentName: intakeAgentDefinition.agentName,
    model: intakeAgentDefinition.model,
    outputSchema: 'intake',
  },
  economics: {
    agentName: economicsAgentDefinition.agentName,
    model: economicsAgentDefinition.model,
    outputSchema: 'economics',
  },
  venue_matching: {
    agentName: venueMatchingAgentDefinition.agentName,
    model: venueMatchingAgentDefinition.model,
    outputSchema: 'venue_matching',
  },
  outreach: {
    agentName: outreachAgentDefinition.agentName,
    model: outreachAgentDefinition.model,
    outputSchema: 'outreach',
  },
  reply_classifier: {
    agentName: replyClassifierDefinition.agentName,
    model: replyClassifierDefinition.model,
    outputSchema: 'reply_classifier',
  },
  response_analysis: {
    agentName: responseAnalysisAgentDefinition.agentName,
    model: responseAnalysisAgentDefinition.model,
    outputSchema: 'response_analysis',
  },
  workspace: {
    agentName: workspaceAgentDefinition.agentName,
    model: workspaceAgentDefinition.model,
    outputSchema: 'workspace',
  },
  timeline: {
    agentName: timelineAgentDefinition.agentName,
    model: timelineAgentDefinition.model,
    outputSchema: 'timeline',
  },
  data_connection: {
    agentName: dataConnectionAgentDefinition.agentName,
    model: dataConnectionAgentDefinition.model,
    outputSchema: 'data_connection',
  },
  document_extraction: {
    agentName: documentExtractionAgentDefinition.agentName,
    model: documentExtractionAgentDefinition.model,
    outputSchema: 'document_extraction',
  },
  event_plan_extractor: {
    agentName: 'event_plan_extractor',
    model: 'gpt-4o-mini',
    outputSchema: 'foundation',
    systemPrompt:
      'You extract event planning details from structured or natural-language input. Return JSON only. Do not recommend outreach, bookings, payments, or commitments.',
  },
  event_planning_advisor: {
    agentName: 'event_planning_advisor',
    model: 'gpt-4o',
    outputSchema: 'foundation',
    systemPrompt:
      'You help plan Bay Area events. Return JSON only with planning recommendations, risks, missing fields, and human approval actions. Do not execute outreach, bookings, payments, or commitments.',
  },
  booking_ops_assistant: {
    agentName: 'booking_ops_assistant',
    model: 'gpt-4o',
    outputSchema: 'foundation',
    systemPrompt:
      'You support event booking operations by identifying follow-up gaps and approval-gated next steps. Return JSON only. Never send outreach, create bookings, approve payments, or commit terms.',
  },
}

const timedOpenAIChatCompletionClient: ChatCompletionClient = {
  create: (async (
    body: ChatCompletionCreateBody,
    options?: ChatCompletionCreateOptions
  ) => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), AGENT_OPENAI_TIMEOUT_MS)

    try {
      return await openai.chat.completions.create(body, {
        ...(options ?? {}),
        signal: controller.signal,
      } as ChatCompletionCreateOptions)
    } finally {
      clearTimeout(timeoutId)
    }
  }) as ChatCompletionCreate,
}

/**
 * Add future agents to AGENT_REGISTRY with a dedicated prompt and output schema.
 * Keep each agent single-shot: structured input in, validated JSON out, human approval
 * before any outreach, booking, payment, or commitment.
 */
export async function runAgent(
  input: RunAgentInput,
  client: ChatCompletionClient = timedOpenAIChatCompletionClient
): Promise<
  | AgentResult
  | IntakeAgentResult
  | EconomicsAgentResult
  | VenueMatchingAgentResult
  | OutreachAgentResult
  | ReplyClassifierResult
  | ResponseAnalysisAgentResult
  | WorkspaceAgentResult
  | TimelineAgentResult
  | DataConnectionAgentResult
  | DocumentExtractionResult
> {
  const startedAt = Date.now()
  const agentName = agentNameSchema.parse(input.agent_name)
  const agent = AGENT_REGISTRY[agentName]

  if (agent.outputSchema === 'intake') {
    return runIntakeAgent(input.payload, client)
  }

  if (agent.outputSchema === 'economics') {
    return runEconomicsAgent(input.payload, client)
  }

  if (agent.outputSchema === 'venue_matching') {
    return runVenueMatchingAgent(input.payload, client)
  }

  if (agent.outputSchema === 'outreach') {
    return runOutreachAgent(input.payload, client)
  }

  if (agent.outputSchema === 'reply_classifier') {
    return runReplyClassifier(input.payload, client)
  }

  if (agent.outputSchema === 'response_analysis') {
    return runResponseAnalysisAgent(input.payload, client)
  }

  if (agent.outputSchema === 'workspace') {
    return runWorkspaceAgent(input.payload, client)
  }

  if (agent.outputSchema === 'timeline') {
    return runTimelineAgent(input.payload, client)
  }

  if (agent.outputSchema === 'data_connection') {
    return runDataConnectionAgent(input.payload, client)
  }

  if (agent.outputSchema === 'document_extraction') {
    return runDocumentExtractionAgent(input.payload, client)
  }

  assertOpenAIConfigured()

  const messages: AgentMessagePayload = [
    {
      role: 'system',
      content: [
        agent.systemPrompt,
        'All monetary fields should be plain numeric planning estimates, not formatted strings.',
        'Use null for unknown EventPlan fields. Every EventPlan key must be present.',
        `Output JSON must match this contract: ${JSON.stringify(AGENT_OUTPUT_CONTRACT)}.`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        user_id: input.user_id,
        event_id: input.event_id ?? null,
        payload: input.payload,
      }),
    },
  ]

  const completion = await client.create({
    model: agent.model,
    response_format: { type: 'json_object' },
    messages,
  })

  const content = completion.choices[0]?.message?.content ?? null
  const metadata = buildAgentRunMetadata(completion, agent.model, messages, content)
  if (!content) {
    throw new AgentRunExecutionError(`${agent.agentName} returned an empty model response`, metadata)
  }

  let output: unknown
  try {
    const parsedJson = parseJsonObject(content)
    output = agentOutputSchema.parse(parsedJson)
  } catch (error) {
    throw new AgentRunExecutionError(getErrorMessage(error), metadata, error)
  }

  return agentResultSchema.parse({
    agent_name: agent.agentName,
    status: 'succeeded',
    ...metadata,
    duration_ms: Date.now() - startedAt,
    output,
  })
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to parse model JSON'
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
      throw new Error(`Failed to parse model JSON: ${error.message}`)
    }
    throw new Error('Failed to parse model JSON')
  }
}
