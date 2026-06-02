import 'server-only'

import { runReplyClassifier, type ReplyClassifierOutput } from '@/lib/ai/agents/replyClassifier'
import { getAgentRunErrorMetadata } from '@/lib/ai/types'
import { maybeCreateAutonomousReplyDraft } from '@/lib/outreach/autonomousReplies'
import { getReplyLatencySeconds, insertVenueDiscoverySignal } from '@/lib/outreach/discoverySignals'
import { isSmsOptOutKeyword } from '@/lib/outreach/channels'
import { eventForSuggestedState, transition } from '@/lib/outreach/threadState'
import { logAgentRun, type AgentRunDb } from '@/lib/server/agent-runs'
import type { Json, OutreachChannel, OutreachThread, Plan } from '@/lib/types'

type OutreachDb = { from(table: string): any }

const THREAD_SELECT = `
  id,
  plan_id,
  user_id,
  target_type,
  target_id,
  target_name,
  target_email,
  target_phone,
  target_instagram_handle,
  channel,
  target_source,
  discovery_venue_id,
  channel_strategy,
  state,
  source_agent_action_id,
  needs_attention,
  follow_up_count,
  last_event_at,
  last_outbound_at,
  last_inbound_at,
  next_action_at,
  created_at,
  updated_at
`

const PLAN_SELECT = `
  id,
  user_id,
  title,
  event_type,
  status,
  guest_count,
  budget_cap_cents,
  neighborhood,
  date_window_start,
  date_window_end,
  ticketed,
  profit_goal_cents,
  notes,
  metadata,
  created_at,
  updated_at
`

export async function logInboundChannelReply(input: {
  db: OutreachDb
  thread: OutreachThread
  channel: OutreachChannel
  bodyText: string
  receivedAt?: string | null
  channelExternalId?: string | null
  providerMetadata?: Record<string, unknown>
  manual?: boolean
}) {
  const receivedAt = input.receivedAt ?? new Date().toISOString()
  const isOptOut = input.channel === 'sms' && isSmsOptOutKeyword(input.bodyText)
  const { data: inserted, error } = await input.db
    .from('outreach_messages')
    .insert({
      thread_id: input.thread.id,
      direction: 'inbound',
      channel_external_id: input.channelExternalId ?? (input.manual ? `manual:${Date.now()}` : null),
      subject: input.channel === 'email' ? 'Manual reply' : '',
      body_text: input.bodyText,
      body_html: null,
      transcript_text: input.channel === 'voice' ? input.bodyText : null,
      headers_json: {
        channel: input.channel,
        manual: input.manual === true,
      } as Json,
      provider_metadata_json: input.providerMetadata ?? {},
      received_at: receivedAt,
    })
    .select('id')
    .single()

  if (error || !inserted) throw new Error(error?.message ?? 'Failed to insert inbound outreach reply')

  if (input.manual) {
    await input.db
      .from('outreach_compliance_events')
      .insert({
        thread_id: input.thread.id,
        message_id: String(inserted.id),
        user_id: input.thread.user_id,
        channel: input.channel,
        event_type: 'manual_reply_logged',
        severity: 'info',
        metadata: { channel_external_id: input.channelExternalId ?? null } as Json,
      })
  }

  let classification: ReplyClassifierOutput | null = null
  if (!isOptOut) {
    classification = await classifyReply(input.db, input.thread, input.bodyText, receivedAt)
  }

  await applyInboundUpdate(input.db, {
    thread: input.thread,
    messageId: String(inserted.id),
    bodyText: input.bodyText,
    receivedAt,
    channel: input.channel,
    isOptOut,
    classification,
  })

  return { messageId: String(inserted.id), classification, isOptOut }
}

async function classifyReply(
  db: OutreachDb,
  thread: OutreachThread,
  bodyText: string,
  receivedAt: string
) {
  const plan = await loadPlan(db, thread.plan_id)
  const payload = {
    thread: {
      target_type: thread.target_type,
      target_name: thread.target_name,
      state: thread.state,
      channel: thread.channel,
      plan_title: plan.title,
      event_date: plan.date_window_start ?? plan.date_window_end,
      guest_count: plan.guest_count,
      budget_cap_cents: plan.budget_cap_cents,
    },
    previous_thread_summary: null,
    inbound_message: {
      from: thread.target_name,
      subject: `${thread.channel} reply`,
      body_text: bodyText,
      received_at: receivedAt,
    },
  }
  const startedAt = Date.now()

  try {
    const output = await runReplyClassifier(payload)
    await safeLogAgentRun(db, {
      userId: thread.user_id,
      planId: thread.plan_id,
      status: 'succeeded',
      inputPayload: payload,
      outputPayload: output.output,
      durationMs: output.duration_ms,
      model: output.model,
      promptTokens: output.prompt_tokens,
      completionTokens: output.completion_tokens,
      messagesPayload: output.messages_payload,
      rawModelOutput: output.raw_model_output,
    })
    return output.output
  } catch (error) {
    const metadata = getAgentRunErrorMetadata(error)
    await safeLogAgentRun(db, {
      userId: thread.user_id,
      planId: thread.plan_id,
      status: 'failed',
      inputPayload: payload,
      outputPayload: null,
      error: error instanceof Error ? error.message : 'Reply classifier failed',
      durationMs: Date.now() - startedAt,
      model: metadata.model ?? 'gpt-4o-mini',
      promptTokens: metadata.prompt_tokens ?? null,
      completionTokens: metadata.completion_tokens ?? null,
      messagesPayload: metadata.messages_payload ?? null,
      rawModelOutput: metadata.raw_model_output ?? null,
    })
    return null
  }
}

async function applyInboundUpdate(
  db: OutreachDb,
  input: {
    thread: OutreachThread
    messageId: string
    bodyText: string
    receivedAt: string
    channel: OutreachChannel
    isOptOut: boolean
    classification: ReplyClassifierOutput | null
  }
) {
  let nextState = input.thread.state
  let needsAttention = true
  let classificationJson: Json | null = null

  if (input.isOptOut) {
    nextState = 'declined'
    needsAttention = true
    await honorSmsOptOut(db, input.thread, input.bodyText)
  } else if (input.classification) {
    const shouldHoldState = input.classification.confidence < 0.7 || input.classification.requires_human_review
    classificationJson = input.classification as unknown as Json
    needsAttention = shouldHoldState || Boolean(input.classification.extracted.required_action_from_creator)
    if (!shouldHoldState) {
      const event = eventForSuggestedState(input.classification.suggested_next_state)
      if (event) nextState = transition(input.thread, event)
    }
  }

  const { error: messageError } = await db
    .from('outreach_messages')
    .update({ classification_json: classificationJson })
    .eq('id', input.messageId)

  if (messageError) throw new Error(`Failed to update inbound classification: ${messageError.message}`)

  const { error: threadError } = await db
    .from('outreach_threads')
    .update({
      state: nextState,
      needs_attention: needsAttention,
      last_event_at: input.receivedAt,
      last_inbound_at: input.receivedAt,
      next_action_at: null,
    })
    .eq('id', input.thread.id)

  if (threadError) throw new Error(`Failed to update outreach thread: ${threadError.message}`)

  await insertVenueDiscoverySignal({
    db,
    thread: input.thread,
    eventType: 'reply_received',
    latencySeconds: getReplyLatencySeconds(input.thread, input.receivedAt),
  })

  if (input.classification) {
    try {
      const plan = await loadPlan(db, input.thread.plan_id)
      await maybeCreateAutonomousReplyDraft({
        db,
        thread: { ...input.thread, state: nextState, needs_attention: needsAttention },
        plan,
        inboundMessageId: input.messageId,
        classification: input.classification,
      })
    } catch (error) {
      console.error('[outreach.inbound] Autonomous reply draft failed', error)
    }
  }
}

async function honorSmsOptOut(db: OutreachDb, thread: OutreachThread, bodyText: string) {
  if (!thread.target_phone) return

  await db
    .from('venue_contact_profiles')
    .update({ sms_opted_out_at: new Date().toISOString() })
    .eq('phone_e164', thread.target_phone)

  await db
    .from('outreach_compliance_events')
    .insert({
      thread_id: thread.id,
      user_id: thread.user_id,
      channel: 'sms',
      event_type: 'sms_opt_out_honored',
      severity: 'warning',
      metadata: { body_text: bodyText } as Json,
    })
}

async function loadPlan(db: OutreachDb, planId: string): Promise<Plan> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT)
    .eq('id', planId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Plan not found for outreach thread')
  return data as Plan
}

async function safeLogAgentRun(
  db: OutreachDb,
  input: {
    userId: string
    planId: string
    status: 'succeeded' | 'failed'
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
) {
  try {
    await logAgentRun(db as unknown as AgentRunDb, {
      userId: input.userId,
      planId: input.planId,
      agentName: 'reply_classifier',
      status: input.status,
      inputPayload: input.inputPayload,
      outputPayload: input.outputPayload ?? null,
      error: input.error ?? null,
      durationMs: input.durationMs,
      model: input.model,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      messagesPayload: input.messagesPayload ?? null,
      rawModelOutput: input.rawModelOutput ?? null,
    })
  } catch (error) {
    console.error('[outreach.inbound] Failed to log reply classifier run', error)
  }
}

export async function loadOwnedOutreachThread(input: {
  db: OutreachDb
  planId: string
  threadId: string
  userId: string
}) {
  const { data, error } = await input.db
    .from('outreach_threads')
    .select(THREAD_SELECT)
    .eq('id', input.threadId)
    .eq('plan_id', input.planId)
    .eq('user_id', input.userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as OutreachThread | null
}
