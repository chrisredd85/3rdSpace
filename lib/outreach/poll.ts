import 'server-only'

import * as Sentry from '@sentry/nextjs'
import { runReplyClassifier, type ReplyClassifierOutput } from '@/lib/ai/agents/replyClassifier'
import { runOutreachAgent } from '@/lib/ai/agents/outreachAgent'
import { getAgentRunErrorMetadata } from '@/lib/ai/types'
import { buildEventPlanFromPlannerPlan } from '@/lib/planner/agentPlanAdapter'
import { maybeCreateAutonomousReplyDraft } from '@/lib/outreach/autonomousReplies'
import { getReplyLatencySeconds, insertVenueDiscoverySignal } from '@/lib/outreach/discoverySignals'
import { getUsableGmailAccessToken, listGmailThreadMessages, type ParsedGmailMessage } from '@/lib/outreach/gmail'
import {
  canActAutonomously,
  createOutreachNotification,
  recordPolicyDecision,
} from '@/lib/outreach/policyGate'
import { sendOutreachDraft } from '@/lib/outreach/send'
import { eventForSuggestedState, transition } from '@/lib/outreach/threadState'
import { logAgentRun, type AgentRunDb } from '@/lib/server/agent-runs'
import type { CreatorEmailAccount, Json, OutreachThread, Plan } from '@/lib/types'

type OutreachDb = { from(table: string): any }

const ACCOUNT_SELECT = `
  id,
  user_id,
  provider,
  email_address,
  oauth_access_token,
  oauth_refresh_token,
  token_expires_at,
  history_id,
  label_id,
  created_at,
  revoked_at
`

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

export type OutreachPollResult = {
  accounts: number
  threadsChecked: number
  inboundMessages: number
  classifications: number
  followUpDrafts: number
  staleThreads: number
  errors: number
}

/**
 * Polls connected creator Gmail accounts for active outreach replies and due follow-ups.
 */
export async function runOutreachPoll(db: OutreachDb): Promise<OutreachPollResult> {
  const result: OutreachPollResult = {
    accounts: 0,
    threadsChecked: 0,
    inboundMessages: 0,
    classifications: 0,
    followUpDrafts: 0,
    staleThreads: 0,
    errors: 0,
  }

  const accounts = await loadActiveAccounts(db)
  result.accounts = accounts.length

  for (const account of accounts) {
    try {
      const accessToken = await getUsableGmailAccessToken({ db, account })
      const threads = await loadActiveThreads(db, account.user_id)
      result.threadsChecked += threads.length

      for (const thread of threads) {
        try {
          const outbound = await loadLatestSentOutbound(db, thread.id)
          if (outbound?.gmail_thread_id) {
            const inboundCount = await ingestThreadReplies(db, {
              account,
              accessToken,
              thread,
              gmailThreadId: outbound.gmail_thread_id,
            })
            result.inboundMessages += inboundCount.inboundMessages
            result.classifications += inboundCount.classifications
          }

          const followUp = await maybeCreateFollowUpDraft(db, thread)
          if (followUp === 'draft_created') result.followUpDrafts += 1
          if (followUp === 'stale') result.staleThreads += 1
        } catch (threadError) {
          result.errors += 1
          capturePollError(threadError, { userId: account.user_id, threadId: thread.id })
        }
      }
    } catch (accountError) {
      result.errors += 1
      capturePollError(accountError, { userId: account.user_id, accountId: account.id })
    }
  }

  return result
}

async function ingestThreadReplies(db: OutreachDb, input: {
  account: CreatorEmailAccount
  accessToken: string
  thread: OutreachThread
  gmailThreadId: string
}) {
  const result = { inboundMessages: 0, classifications: 0 }
  const gmailMessages = await listGmailThreadMessages({
    accessToken: input.accessToken,
    gmailThreadId: input.gmailThreadId,
  })
  const existingIds = await loadExistingGmailMessageIds(db, input.thread.id)
  const newerThan = Date.parse(input.thread.last_inbound_at ?? input.thread.last_outbound_at ?? input.thread.created_at)

  for (const gmailMessage of gmailMessages) {
    if (existingIds.has(gmailMessage.gmailMessageId)) continue
    if (isCreatorMessage(gmailMessage, input.account.email_address)) continue
    if (Date.parse(gmailMessage.receivedAt) <= newerThan) continue

    const { data: inserted, error } = await db
      .from('outreach_messages')
      .insert({
        thread_id: input.thread.id,
        direction: 'inbound',
        gmail_message_id: gmailMessage.gmailMessageId,
        gmail_thread_id: gmailMessage.gmailThreadId,
        subject: gmailMessage.subject,
        body_text: gmailMessage.bodyText,
        body_html: gmailMessage.bodyHtml,
        headers_json: gmailMessage.headers as Json,
        received_at: gmailMessage.receivedAt,
      })
      .select('id')
      .single()

    if (error || !inserted) throw new Error(error?.message ?? 'Failed to insert inbound outreach message')
    result.inboundMessages += 1

    const classification = await classifyInboundMessage(db, input.thread, gmailMessage)
    result.classifications += 1
    await applyClassification(db, input.thread, String(inserted.id), gmailMessage, classification)
  }

  return result
}

async function classifyInboundMessage(
  db: OutreachDb,
  thread: OutreachThread,
  gmailMessage: ParsedGmailMessage
): Promise<ReplyClassifierOutput> {
  const plan = await loadPlan(db, thread.plan_id)
  const payload = {
    thread: {
      target_type: thread.target_type,
      target_name: thread.target_name,
      state: thread.state,
      plan_title: plan.title,
      event_date: plan.date_window_start ?? plan.date_window_end,
      guest_count: plan.guest_count,
      budget_cap_cents: plan.budget_cap_cents,
    },
    previous_thread_summary: await buildThreadSummary(db, thread.id),
    inbound_message: {
      from: gmailMessage.from,
      subject: gmailMessage.subject,
      body_text: gmailMessage.bodyText,
      received_at: gmailMessage.receivedAt,
    },
  }
  const startedAt = Date.now()

  try {
    const output = await runReplyClassifier(payload)
    await safeLogAgentRun(db, {
      userId: thread.user_id,
      planId: thread.plan_id,
      agentName: 'reply_classifier',
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
      agentName: 'reply_classifier',
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
    throw error
  }
}

async function applyClassification(
  db: OutreachDb,
  thread: OutreachThread,
  messageId: string,
  gmailMessage: ParsedGmailMessage,
  classification: ReplyClassifierOutput
) {
  const shouldHoldState = classification.confidence < 0.7 || classification.requires_human_review
  let nextState = thread.state

  if (!shouldHoldState) {
    const event = eventForSuggestedState(classification.suggested_next_state)
    if (event) nextState = transition(thread, event)
  }

  const needsAttention = shouldHoldState || Boolean(classification.extracted.required_action_from_creator)
  const classificationJson = classification as unknown as Json

  const { error: messageError } = await db
    .from('outreach_messages')
    .update({ classification_json: classificationJson })
    .eq('id', messageId)

  if (messageError) throw new Error(`Failed to update inbound classification: ${messageError.message}`)

  const { error: threadError } = await db
    .from('outreach_threads')
    .update({
      state: nextState,
      needs_attention: needsAttention,
      last_event_at: gmailMessage.receivedAt,
      last_inbound_at: gmailMessage.receivedAt,
      next_action_at: null,
    })
    .eq('id', thread.id)

  if (threadError) throw new Error(`Failed to update outreach thread classification: ${threadError.message}`)

  await insertVenueDiscoverySignal({
    db,
    thread,
    eventType: 'reply_received',
    latencySeconds: getReplyLatencySeconds(thread, gmailMessage.receivedAt),
  })

  if (nextState === 'declined') {
    await insertVenueDiscoverySignal({ db, thread, eventType: 'declined' })
  }

  if (nextState === 'confirmed') {
    await insertVenueDiscoverySignal({ db, thread, eventType: 'booked' })
  }

  try {
    const plan = await loadPlan(db, thread.plan_id)
    await maybeCreateAutonomousReplyDraft({
      db,
      thread: { ...thread, state: nextState, needs_attention: needsAttention },
      plan,
      inboundMessageId: messageId,
      classification,
    })
  } catch (error) {
    capturePollError(error, { planId: thread.plan_id, threadId: thread.id, operation: 'autonomous_reply' })
  }
}

async function maybeCreateFollowUpDraft(db: OutreachDb, thread: OutreachThread): Promise<'none' | 'draft_created' | 'stale'> {
  if (thread.state !== 'awaiting_reply') return 'none'
  if (!thread.next_action_at || Date.parse(thread.next_action_at) > Date.now()) return 'none'
  if (thread.last_inbound_at && (!thread.last_outbound_at || Date.parse(thread.last_inbound_at) > Date.parse(thread.last_outbound_at))) {
    return 'none'
  }

  if (thread.follow_up_count >= 2) {
    const nextState = transition(thread, { type: 'mark_stale' })
    const { error } = await db
      .from('outreach_threads')
      .update({
        state: nextState,
        needs_attention: true,
        last_event_at: new Date().toISOString(),
        next_action_at: null,
      })
      .eq('id', thread.id)

    if (error) throw new Error(`Failed to mark outreach thread stale: ${error.message}`)
    await insertVenueDiscoverySignal({ db, thread, eventType: 'stale' })
    return 'stale'
  }

  const plan = await loadPlan(db, thread.plan_id)
  const action = await createFollowUpAction(db, plan, thread)
  const approval = await createFollowUpApproval(db, plan, thread, String(action.id))
  const draft = await buildFollowUpDraft(plan, thread, await buildThreadSummary(db, thread.id))

  const { data: message, error: messageError } = await db
    .from('outreach_messages')
    .insert({
      thread_id: thread.id,
      agent_action_id: action.id,
      approval_id: approval.id,
      direction: 'outbound',
      subject: draft.subject,
      body_text: draft.bodyText,
      body_html: null,
      headers_json: {
        source: 'follow_up_scheduler',
        follow_up_count: thread.follow_up_count + 1,
      } as Json,
    })
    .select('id')
    .single()

  if (messageError || !message) throw new Error(`Failed to create follow-up draft: ${messageError?.message ?? 'Unknown error'}`)

  const autoScheduled = await maybeScheduleAutonomousFollowUp(db, {
    plan,
    thread,
    draftMessageId: String(message.id),
  })

  const { error: threadError } = await db
    .from('outreach_threads')
    .update({
      follow_up_count: thread.follow_up_count + 1,
      needs_attention: !autoScheduled,
      last_event_at: new Date().toISOString(),
      next_action_at: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq('id', thread.id)

  if (threadError) throw new Error(`Failed to update follow-up schedule: ${threadError.message}`)
  return 'draft_created'
}

async function maybeScheduleAutonomousFollowUp(db: OutreachDb, input: {
  plan: Plan
  thread: OutreachThread
  draftMessageId: string
}) {
  const gate = await canActAutonomously({
    db,
    userId: input.thread.user_id,
    action: 'send_follow_up',
    context: {
      planId: input.plan.id,
      threadId: input.thread.id,
      messageId: input.draftMessageId,
      targetId: input.thread.target_id,
      targetName: input.thread.target_name,
      targetType: input.thread.target_type,
      targetSource: input.thread.target_source,
      channel: input.thread.channel,
      budgetCapCents: input.plan.budget_cap_cents,
      followUpCount: input.thread.follow_up_count + 1,
      moneyMovement: false,
      requiresSignature: false,
      legalCommitment: false,
    },
  })

  if (!gate.allowed) {
    await db
      .from('outreach_messages')
      .update({
        autonomy_status: 'pending_approval',
        autonomy_policy_id: gate.policy?.id ?? null,
        autonomy_policy_version: gate.policy?.version ?? null,
      })
      .eq('id', input.draftMessageId)

    await recordPolicyDecision({
      db,
      userId: input.thread.user_id,
      action: 'send_follow_up',
      decision: 'pending_approval',
      reason: gate.reason,
      policy: gate.policy,
      context: {
        planId: input.plan.id,
        threadId: input.thread.id,
        messageId: input.draftMessageId,
        channel: input.thread.channel,
      },
      result: { required_approval_type: gate.required_approval_type ?? 'approval' },
    })
    await createOutreachNotification({
      db,
      userId: input.thread.user_id,
      threadId: input.thread.id,
      notificationType: 'requires_approval',
      payload: {
        action: 'send_follow_up',
        message_id: input.draftMessageId,
        reason: gate.reason,
      },
    })
    return false
  }

  await sendOutreachDraft({
    db,
    threadId: input.thread.id,
    draftMessageId: input.draftMessageId,
    userId: input.thread.user_id,
    autonomous: true,
  })

  return true
}

async function createFollowUpAction(db: OutreachDb, plan: Plan, thread: OutreachThread) {
  const { data, error } = await db
    .from('agent_actions')
    .insert({
      plan_id: plan.id,
      action_type: 'email',
      description: `Follow up with ${thread.target_name}`,
      provider: 'gmail',
      target_type: thread.target_type,
      target_id: thread.target_id,
      payload_json: {
        kind: 'outreach_follow_up',
        outreach_thread_id: thread.id,
        target_type: thread.target_type,
        target_id: thread.target_id,
        target_email: thread.target_email,
        follow_up_count: thread.follow_up_count + 1,
      } as Json,
      amount_cents: 0,
      currency: 'usd',
      status: 'pending',
      result_metadata: { source: 'outreach_poll_follow_up' } as Json,
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to create follow-up action')
  return data as Record<string, unknown>
}

async function createFollowUpApproval(db: OutreachDb, plan: Plan, thread: OutreachThread, actionId: string) {
  const { data, error } = await db
    .from('approvals')
    .insert({
      plan_id: plan.id,
      agent_action_id: actionId,
      action_label: `Approve follow-up to ${thread.target_name}`,
      provider: 'gmail',
      event_date: plan.date_window_start,
      price_cents: 0,
      fees_cents: 0,
      package_details: `Follow-up email to ${thread.target_name}`,
      refund_terms: 'No charge is made now. This only approves a follow-up email draft.',
      cancellation_terms: 'You can cancel before sending.',
      delivery_email: thread.target_email,
      requested_amount_cents: 0,
      status: 'pending',
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to create follow-up approval')
  return data as Record<string, unknown>
}

async function buildFollowUpDraft(plan: Plan, thread: OutreachThread, previousThreadSummary: string | null) {
  if (process.env.OPENAI_API_KEY) {
    try {
      const result = await runOutreachAgent({
        event_plan: buildEventPlanFromPlannerPlan(plan),
        target_partner: {
          name: thread.target_name,
          type: thread.target_type,
          contact_email: thread.target_email,
        },
        outreach_type: 'follow_up',
        organizer_preferences: {
          follow_up_count: thread.follow_up_count + 1,
          budget_cap_cents: plan.budget_cap_cents,
          guest_count: plan.guest_count,
          neighborhood: plan.neighborhood,
        },
        previous_thread_summary: previousThreadSummary ?? `${plan.title} outreach to ${thread.target_name}`,
      })

      return {
        subject: result.output.subject ?? `Following up: ${plan.title}`,
        bodyText: result.output.message_body,
      }
    } catch (error) {
      capturePollError(error, { planId: plan.id, threadId: thread.id, operation: 'follow_up_draft' })
    }
  }

  const eventDate = plan.date_window_start ?? plan.date_window_end ?? 'the date we mentioned'
  return {
    subject: `Following up: ${plan.title}`,
    bodyText: [
      `Hi ${thread.target_name} team,`,
      `I wanted to follow up on my note about ${plan.title} for ${eventDate}.`,
      'Could you let me know if this is a fit, and share availability, pricing, minimums, and next steps if so?',
      'Nothing is booked or committed yet. I am just trying to confirm fit before moving forward.',
      'Thank you.',
    ].join('\n\n'),
  }
}

async function loadActiveAccounts(db: OutreachDb): Promise<CreatorEmailAccount[]> {
  const { data, error } = await db
    .from('creator_email_accounts')
    .select(ACCOUNT_SELECT)
    .eq('provider', 'gmail')
    .is('revoked_at', null)

  if (error) throw new Error(`Failed to load creator Gmail accounts: ${error.message}`)
  return (data ?? []) as CreatorEmailAccount[]
}

async function loadActiveThreads(db: OutreachDb, userId: string): Promise<OutreachThread[]> {
  const { data, error } = await db
    .from('outreach_threads')
    .select(THREAD_SELECT)
    .eq('user_id', userId)
    .eq('channel', 'email')
    .in('state', ['awaiting_reply', 'in_negotiation'])

  if (error) throw new Error(`Failed to load active outreach threads: ${error.message}`)
  return (data ?? []) as OutreachThread[]
}

async function loadLatestSentOutbound(db: OutreachDb, threadId: string) {
  const { data, error } = await db
    .from('outreach_messages')
    .select('id, gmail_thread_id, sent_at')
    .eq('thread_id', threadId)
    .eq('direction', 'outbound')
    .not('sent_at', 'is', null)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Failed to load latest outbound: ${error.message}`)
  return data as { id: string; gmail_thread_id: string | null; sent_at: string | null } | null
}

async function loadExistingGmailMessageIds(db: OutreachDb, threadId: string) {
  const { data, error } = await db
    .from('outreach_messages')
    .select('gmail_message_id')
    .eq('thread_id', threadId)
    .not('gmail_message_id', 'is', null)

  if (error) throw new Error(`Failed to load existing Gmail message ids: ${error.message}`)
  return new Set(((data ?? []) as Array<{ gmail_message_id: string | null }>).map((row) => row.gmail_message_id).filter(Boolean) as string[])
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

async function buildThreadSummary(db: OutreachDb, threadId: string) {
  const { data, error } = await db
    .from('outreach_messages')
    .select('direction, subject, body_text, sent_at, received_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(8)

  if (error) return null
  const rows = (data ?? []) as Array<{ direction: string; subject: string; body_text: string; sent_at: string | null; received_at: string | null }>
  if (rows.length === 0) return null
  return rows.map((row) => `${row.direction}: ${row.subject}\n${row.body_text.slice(0, 500)}`).join('\n\n')
}

async function safeLogAgentRun(
  db: OutreachDb,
  input: {
    userId: string
    planId: string
    agentName: 'reply_classifier'
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
  await logAgentRun(db as unknown as AgentRunDb, {
    userId: input.userId,
    planId: input.planId,
    agentName: input.agentName,
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
}

function isCreatorMessage(message: ParsedGmailMessage, emailAddress: string) {
  return Boolean(message.from?.toLowerCase().includes(emailAddress.toLowerCase()))
}

function capturePollError(error: unknown, context: Record<string, unknown>) {
  console.error('[outreach.poll] Poll error', { error, context })
  Sentry.captureException(error, { extra: context })
}
