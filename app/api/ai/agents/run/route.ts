export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runAgent } from '@/lib/ai/agents'
import { agentNameSchema, getAgentRunErrorMetadata } from '@/lib/ai/types'
import { logAgentRun, type AgentRunDb } from '@/lib/server/agent-runs'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

type AgentBillingDb = {
  from: (table: string) => unknown
}

type BuilderBillingTier = 'free_trial' | 'pay_per_event' | 'pro_monthly' | 'pro_annual'

type BuilderBillingQuery = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      maybeSingle: () => Promise<{
        data: { billing_tier?: unknown } | null
        error: { code?: string; message?: string } | null
      }>
    }
  }
}

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
    const admin = createServiceRoleClient() as unknown as AgentRunDb & AgentBillingDb
    const billingGateResponse = await enforceAgentBillingGate(admin, user.id)
    if (billingGateResponse) return billingGateResponse

    const result = await runAgent({
      agent_name: parsedBody.agent_name,
      event_id: parsedBody.event_id ?? null,
      payload: parsedBody.payload,
      user_id: user.id,
    })

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

async function enforceAgentBillingGate(
  admin: AgentBillingDb,
  userId: string
): Promise<NextResponse<{ error: string }> | null> {
  const query = admin.from('builder_profiles')
  if (!isBuilderBillingQuery(query)) return null

  const { data, error } = await query
    .select('billing_tier')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[agent.run] Failed to verify billing tier', error)
    return NextResponse.json({ error: 'Failed to verify billing access' }, { status: 500 })
  }

  const billingTier = readBuilderBillingTier(data?.billing_tier)
  if (!billingTier) return null

  if (billingTier === 'free_trial') {
    return NextResponse.json({ error: 'Upgrade required to use AI agents.' }, { status: 402 })
  }

  if (billingTier === 'pay_per_event') {
    console.warn('[agent.run] Pay-per-event AI credit enforcement is pending')
  }

  return null
}

function isBuilderBillingQuery(value: unknown): value is BuilderBillingQuery {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'select' in value &&
      typeof value.select === 'function'
  )
}

function readBuilderBillingTier(value: unknown): BuilderBillingTier | null {
  if (
    value === 'free_trial' ||
    value === 'pay_per_event' ||
    value === 'pro_monthly' ||
    value === 'pro_annual'
  ) {
    return value
  }

  return null
}
