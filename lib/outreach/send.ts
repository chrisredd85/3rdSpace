import 'server-only'

import { getAgentRunErrorMetadata } from '@/lib/ai/types'
import { getUsableGmailAccessToken, sendGmailMessage } from '@/lib/outreach/gmail'
import { transition } from '@/lib/outreach/threadState'
import { logAgentRun, type AgentRunDb } from '@/lib/server/agent-runs'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { CreatorEmailAccount, Json, OutreachMessage, OutreachThread } from '@/lib/types'

type OutreachDb = { from(table: string): any }

const THREAD_SELECT = `
  id,
  plan_id,
  user_id,
  target_type,
  target_id,
  target_name,
  target_email,
  channel,
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

const MESSAGE_SELECT = `
  id,
  thread_id,
  agent_action_id,
  approval_id,
  direction,
  gmail_message_id,
  gmail_thread_id,
  subject,
  body_text,
  body_html,
  headers_json,
  sent_at,
  received_at,
  classification_json,
  created_at
`

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

export class OutreachSendError extends Error {
  readonly status: number

  constructor(message: string, status = 500) {
    super(message)
    this.name = 'OutreachSendError'
    this.status = status
  }
}

/**
 * Sends an approved outbound outreach draft from the creator's connected Gmail.
 */
export async function sendOutreachDraft(input: {
  db: OutreachDb
  threadId: string
  draftMessageId: string
  userId: string
}) {
  const startedAt = Date.now()
  const logInput = {
    threadId: input.threadId,
    draftMessageId: input.draftMessageId,
  }

  try {
    const thread = await loadThread(input.db, input.threadId, input.userId)
    const draft = await loadDraftMessage(input.db, input.draftMessageId, thread.id)
    if (draft.sent_at) throw new OutreachSendError('This outreach draft has already been sent', 409)
    if (!draft.agent_action_id) throw new OutreachSendError('Draft is missing an approved agent action', 409)

    const approval = await loadApprovedApproval(input.db, draft.agent_action_id, thread.plan_id, input.userId)
    const account = await loadConnectedGmailAccount(input.db, input.userId)
    const accessToken = await getUsableGmailAccessToken({ db: input.db, account })
    const sent = await sendGmailMessage({
      accessToken,
      from: account.email_address,
      to: thread.target_email,
      replyTo: account.email_address,
      subject: draft.subject,
      bodyText: draft.body_text,
      bodyHtml: draft.body_html,
      gmailThreadId: draft.gmail_thread_id,
    })

    const now = new Date()
    const sentAt = now.toISOString()
    const nextActionAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const nextState = transition(thread, { type: 'outbound_sent' })

    const { data: updatedMessage, error: messageError } = await input.db
      .from('outreach_messages')
      .update({
        approval_id: approval.id,
        gmail_message_id: sent.gmailMessageId,
        gmail_thread_id: sent.gmailThreadId,
        sent_at: sentAt,
        headers_json: {
          ...(readRecord(draft.headers_json) ?? {}),
          gmail_label_ids: sent.labelIds,
          sent_from: account.email_address,
        } as Json,
      })
      .eq('id', draft.id)
      .eq('thread_id', thread.id)
      .select(MESSAGE_SELECT)
      .single()

    if (messageError || !updatedMessage) {
      throw new Error(messageError?.message ?? 'Failed to update sent outreach message')
    }

    const { data: updatedThread, error: threadError } = await input.db
      .from('outreach_threads')
      .update({
        state: nextState,
        needs_attention: false,
        last_event_at: sentAt,
        last_outbound_at: sentAt,
        next_action_at: nextActionAt,
      })
      .eq('id', thread.id)
      .eq('user_id', input.userId)
      .select(THREAD_SELECT)
      .single()

    if (threadError || !updatedThread) {
      throw new Error(threadError?.message ?? 'Failed to update outreach thread after send')
    }

    await safeLogAgentRun({
      userId: input.userId,
      planId: thread.plan_id,
      status: 'succeeded',
      inputPayload: logInput,
      outputPayload: {
        operation: 'gmail_send',
        thread_id: thread.id,
        message_id: draft.id,
        gmail_message_id: sent.gmailMessageId,
        gmail_thread_id: sent.gmailThreadId,
      },
      durationMs: Date.now() - startedAt,
    })

    return {
      thread: updatedThread as OutreachThread,
      message: updatedMessage as OutreachMessage,
    }
  } catch (error) {
    await safeLogAgentRun({
      userId: input.userId,
      planId: null,
      status: 'failed',
      inputPayload: logInput,
      outputPayload: null,
      error: error instanceof Error ? error.message : 'Failed to send outreach draft',
      durationMs: Date.now() - startedAt,
    })
    throw error
  }
}

async function loadThread(db: OutreachDb, threadId: string, userId: string): Promise<OutreachThread> {
  const { data, error } = await db
    .from('outreach_threads')
    .select(THREAD_SELECT)
    .eq('id', threadId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new OutreachSendError('Outreach thread not found', 404)

  return data as OutreachThread
}

async function loadDraftMessage(db: OutreachDb, draftMessageId: string, threadId: string): Promise<OutreachMessage> {
  const { data, error } = await db
    .from('outreach_messages')
    .select(MESSAGE_SELECT)
    .eq('id', draftMessageId)
    .eq('thread_id', threadId)
    .eq('direction', 'outbound')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new OutreachSendError('Outreach draft not found', 404)

  return data as OutreachMessage
}

async function loadApprovedApproval(db: OutreachDb, actionId: string, planId: string, userId: string) {
  const { data: plan, error: planError } = await db
    .from('plans')
    .select('id, user_id')
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (planError) throw new Error(planError.message)
  if (!plan) throw new OutreachSendError('Plan not found', 404)

  const { data, error } = await db
    .from('approvals')
    .select('id, status, agent_action_id, plan_id')
    .eq('agent_action_id', actionId)
    .eq('plan_id', planId)
    .in('status', ['approved', 'authorized'])
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new OutreachSendError('Approval is required before sending outreach', 403)

  return data as { id: string; status: string; agent_action_id: string; plan_id: string }
}

async function loadConnectedGmailAccount(db: OutreachDb, userId: string): Promise<CreatorEmailAccount> {
  const { data, error } = await db
    .from('creator_email_accounts')
    .select(ACCOUNT_SELECT)
    .eq('user_id', userId)
    .eq('provider', 'gmail')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new OutreachSendError('Connect Gmail before sending outreach', 409)

  return data as CreatorEmailAccount
}

async function safeLogAgentRun(input: {
  userId: string
  planId: string | null
  status: 'succeeded' | 'failed'
  inputPayload: Record<string, unknown>
  outputPayload?: unknown
  error?: string | null
  durationMs: number
}) {
  try {
    const metadata = getAgentRunErrorMetadata(input.error)
    const admin = createServiceRoleClient() as unknown as AgentRunDb
    await logAgentRun(admin, {
      userId: input.userId,
      planId: input.planId,
      agentName: 'outreach',
      status: input.status,
      inputPayload: {
        operation: 'gmail_send',
        ...input.inputPayload,
      },
      outputPayload: input.outputPayload ?? null,
      error: input.error ?? null,
      durationMs: input.durationMs,
      model: metadata.model ?? 'gmail-api',
      promptTokens: metadata.prompt_tokens ?? null,
      completionTokens: metadata.completion_tokens ?? null,
      messagesPayload: metadata.messages_payload ?? null,
      rawModelOutput: metadata.raw_model_output ?? null,
    })
  } catch (logError) {
    console.error('[outreach.send] Failed to log outbound send', logError)
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
