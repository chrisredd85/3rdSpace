import type { AgentMessagePayload, AgentRunMetadata } from '@/lib/ai/types'

export type { AgentMessagePayload }

type CompletionMetadataSource = {
  model?: string | null
  usage?: {
    prompt_tokens?: number | null
    completion_tokens?: number | null
  } | null
}

export function buildAgentRunMetadata(
  completion: CompletionMetadataSource,
  fallbackModel: string,
  messagesPayload: AgentMessagePayload,
  rawModelOutput: string | null
): AgentRunMetadata {
  return {
    model: completion.model ?? fallbackModel,
    prompt_tokens: completion.usage?.prompt_tokens ?? null,
    completion_tokens: completion.usage?.completion_tokens ?? null,
    messages_payload: messagesPayload,
    raw_model_output: rawModelOutput,
  }
}

export function emptyAgentRunMetadata(fallbackModel: string): AgentRunMetadata {
  return {
    model: fallbackModel,
    prompt_tokens: null,
    completion_tokens: null,
    messages_payload: [],
    raw_model_output: null,
  }
}
