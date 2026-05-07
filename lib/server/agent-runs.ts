import 'server-only'

import type { AgentName, AgentRunStatus } from '@/lib/ai/types'

const TABLES = {
  AGENT_RUNS: 'agent_runs',
} as const

type AgentRunInsertResult = {
  error: { message: string } | null
}

type AgentRunInsertBuilder = PromiseLike<AgentRunInsertResult>

export type AgentRunDb = {
  from(table: string): {
    insert(payload: Record<string, unknown>): AgentRunInsertBuilder
  }
}

export type AgentRunLogInput = {
  userId: string
  eventId?: string | null
  planId?: string | null
  agentName: AgentName
  status: AgentRunStatus
  inputPayload: Record<string, unknown>
  outputPayload?: unknown
  error?: string | null
  durationMs: number
  model: string
  promptTokens?: number | null
  completionTokens?: number | null
  messagesPayload?: unknown
  rawModelOutput?: string | null
}

export async function logAgentRun(db: AgentRunDb, input: AgentRunLogInput) {
  const { error } = await db.from(TABLES.AGENT_RUNS).insert({
    user_id: input.userId,
    event_id: input.eventId ?? null,
    plan_id: input.planId ?? null,
    agent_name: input.agentName,
    status: input.status,
    input_payload: input.inputPayload,
    output_payload: input.outputPayload ?? null,
    error: input.error ?? null,
    duration_ms: input.durationMs,
    model: input.model,
    prompt_tokens: input.promptTokens ?? null,
    completion_tokens: input.completionTokens ?? null,
    messages_payload: input.messagesPayload ?? null,
    raw_model_output: input.rawModelOutput ?? null,
  })

  if (error) {
    throw new Error(`Failed to log agent run: ${error.message}`)
  }
}
