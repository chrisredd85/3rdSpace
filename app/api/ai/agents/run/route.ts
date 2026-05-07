export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runAgent } from '@/lib/ai/agents'
import { agentNameSchema, getAgentRunErrorMetadata } from '@/lib/ai/types'
import { logAgentRun, type AgentRunDb } from '@/lib/server/agent-runs'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

const agentRunRequestSchema = z.object({
  agent_name: agentNameSchema,
  event_id: z.string().uuid().nullable().optional(),
  plan_id: z.string().uuid().nullable().optional(),
  payload: z.record(z.unknown()),
})

const agentRunResponseSchema = z.object({
  data: z.unknown(),
})

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  let parsedBody: z.infer<typeof agentRunRequestSchema> | null = null
  let userId: string | null = null

  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    userId = user.id
    const body = agentRunRequestSchema.safeParse(await request.json())
    if (!body.success) {
      return NextResponse.json({ error: 'Invalid agent run payload' }, { status: 400 })
    }

    parsedBody = body.data
    const result = await runAgent({
      agent_name: parsedBody.agent_name,
      event_id: parsedBody.event_id ?? null,
      payload: parsedBody.payload,
      user_id: user.id,
    })

    const admin = createServiceRoleClient() as unknown as AgentRunDb
    await logAgentRun(admin, {
      userId: user.id,
      eventId: parsedBody.event_id ?? null,
      agentName: parsedBody.agent_name,
      status: result.status,
      inputPayload: parsedBody.payload,
      outputPayload: result.output,
      durationMs: result.duration_ms,
      planId: parsedBody.plan_id ?? null,
      model: result.model,
      promptTokens: result.prompt_tokens,
      completionTokens: result.completion_tokens,
      messagesPayload: result.messages_payload,
      rawModelOutput: result.raw_model_output,
    })

    return NextResponse.json(agentRunResponseSchema.parse({ data: result }))
  } catch (error) {
    console.error('[agent.run] Failed to run agent', error)

    if (userId && parsedBody) {
      try {
        const metadata = getAgentRunErrorMetadata(error)
        const admin = createServiceRoleClient() as unknown as AgentRunDb
        await logAgentRun(admin, {
          userId,
          eventId: parsedBody.event_id ?? null,
          planId: parsedBody.plan_id ?? null,
          agentName: parsedBody.agent_name,
          status: 'failed',
          inputPayload: parsedBody.payload,
          outputPayload: null,
          error: error instanceof Error ? error.message : 'Unknown agent error',
          durationMs: Date.now() - startedAt,
          model: metadata.model ?? 'unknown',
          promptTokens: metadata.prompt_tokens ?? null,
          completionTokens: metadata.completion_tokens ?? null,
          messagesPayload: metadata.messages_payload ?? null,
          rawModelOutput: metadata.raw_model_output ?? null,
        })
      } catch (logError) {
        console.error('[agent.run] Failed to log failed agent run', logError)
      }
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to run agent' },
      { status: 500 }
    )
  }
}
