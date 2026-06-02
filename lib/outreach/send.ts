import 'server-only'

import { getAgentRunErrorMetadata } from '@/lib/ai/types'
import { getScheduledSendDelayMs, scheduleAutonomousSend } from '@/lib/outreach/autonomy'
import { insertVenueDiscoverySignal } from '@/lib/outreach/discoverySignals'
import { getUsableGmailAccessToken, sendGmailMessage } from '@/lib/outreach/gmail'
import {
  canActAutonomously,
  createOutreachNotification,
  recordPolicyDecision,
  type PolicyGateContext,
} from '@/lib/outreach/policyGate'
import { transition } from '@/lib/outreach/threadState'
import { sendTwilioSms } from '@/lib/outreach/twilio'
import { placeVoiceAvailabilityCall } from '@/lib/outreach/voice'
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

const MESSAGE_SELECT = `
  id,
  thread_id,
  agent_action_id,
  approval_id,
  direction,
  gmail_message_id,
  gmail_thread_id,
  channel_external_id,
  subject,
  body_text,
  body_html,
  headers_json,
  attachments_json,
  transcript_text,
  recording_url,
  sent_manually,
  provider_metadata_json,
  provider_cost_cents,
  scheduled_send_at,
  autonomous_send_after,
  cancelled_at,
  autonomy_policy_id,
  autonomy_policy_version,
  autonomy_status,
  undo_expires_at,
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
  manualSent?: boolean
  autonomous?: boolean
  skipScheduledDelay?: boolean
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
    if (draft.cancelled_at) throw new OutreachSendError('This outreach draft has been cancelled', 409)
    if (draft.autonomy_status === 'scheduled' && !input.skipScheduledDelay) {
      throw new OutreachSendError('This autonomous outreach draft is already scheduled', 409)
    }
    if (!draft.agent_action_id) throw new OutreachSendError('Draft is missing an approved agent action', 409)

    const policyAction = inferPolicyAction(thread, draft)
    const policyContext = buildPolicyContext(thread, draft)
    const gate = await canActAutonomously({
      db: input.db,
      userId: input.userId,
      action: policyAction,
      context: policyContext,
    })

    let approvalId: string | null = null
    if (input.autonomous) {
      if (thread.channel === 'instagram') {
        throw new OutreachSendError('Instagram outreach requires creator manual send confirmation', 409)
      }
      if (!gate.allowed || !gate.policy) {
        await markAutonomousSendBlocked(input.db, {
          thread,
          draft,
          userId: input.userId,
          action: policyAction,
          reason: gate.reason,
          requiredApprovalType: gate.required_approval_type,
        })
        throw new OutreachSendError('Creator approval is required before this outreach action', 403)
      }

      const delayMs = getScheduledSendDelayMs(thread.channel)
      if (delayMs > 0 && !input.skipScheduledDelay) {
        const scheduled = await scheduleAutonomousSend({
          db: input.db,
          userId: input.userId,
          thread,
          draft,
          policy: gate.policy,
          action: policyAction,
          reason: gate.reason,
          delayMs,
        })
        await safeLogAgentRun({
          userId: input.userId,
          planId: thread.plan_id,
          status: 'succeeded',
          inputPayload: { ...logInput, autonomous: true },
          outputPayload: {
            operation: `${thread.channel}_autonomous_scheduled`,
            thread_id: thread.id,
            message_id: draft.id,
            scheduled_send_at: scheduled.scheduledSendAt,
          },
          durationMs: Date.now() - startedAt,
        })
        return scheduled
      }
    } else {
      const approval = await loadApprovedApproval(input.db, draft.agent_action_id, thread.plan_id, input.userId)
      approvalId = approval.id
    }

    const sentResult = thread.channel === 'email'
      ? await sendEmailDraft({ db: input.db, thread, draft, approvalId, userId: input.userId })
      : thread.channel === 'instagram'
        ? await confirmManualInstagramSend({ db: input.db, thread, draft, approvalId, manualSent: input.manualSent === true })
        : thread.channel === 'sms'
          ? await sendSmsDraft({ db: input.db, thread, draft, approvalId, userId: input.userId })
          : await sendVoiceDraft({ db: input.db, thread, draft, approvalId })

    if (input.autonomous && gate.policy) {
      const undoExpiresAt = draft.undo_expires_at ?? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
      await recordPolicyDecision({
        db: input.db,
        userId: input.userId,
        action: policyAction,
        decision: 'autonomous_sent',
        reason: gate.reason,
        policy: gate.policy,
        context: policyContext,
        result: {
          message_id: sentResult.message.id,
          channel_external_id: sentResult.message.channel_external_id,
        },
        reversibleUntil: undoExpiresAt,
      })
      await createOutreachNotification({
        db: input.db,
        userId: input.userId,
        threadId: thread.id,
        notificationType: 'agent_acted_autonomously',
        payload: {
          action: policyAction,
          message_id: sentResult.message.id,
          channel: thread.channel,
          undo_expires_at: undoExpiresAt,
          policy_version: gate.policy.version,
        },
      })
    }

    await safeLogAgentRun({
      userId: input.userId,
      planId: thread.plan_id,
      status: 'succeeded',
      inputPayload: logInput,
      outputPayload: {
        operation: `${thread.channel}_send`,
        thread_id: thread.id,
        message_id: draft.id,
        channel_external_id: sentResult.message.channel_external_id,
      },
      durationMs: Date.now() - startedAt,
    })

    return sentResult
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

async function sendEmailDraft(input: {
  db: OutreachDb
  thread: OutreachThread
  draft: OutreachMessage
  approvalId: string | null
  userId: string
}) {
  if (!input.thread.target_email) {
    throw new OutreachSendError('Email outreach requires a target email address', 409)
  }

  const account = await loadConnectedGmailAccount(input.db, input.userId)
  const accessToken = await getUsableGmailAccessToken({ db: input.db, account })
  const sent = await sendGmailMessage({
    accessToken,
    from: account.email_address,
    to: input.thread.target_email,
    replyTo: account.email_address,
    subject: input.draft.subject,
    bodyText: input.draft.body_text,
    bodyHtml: input.draft.body_html,
    gmailThreadId: input.draft.gmail_thread_id,
  })

  return persistSentOutreach({
    db: input.db,
    thread: input.thread,
    draft: input.draft,
    approvalId: input.approvalId,
    channelExternalId: sent.gmailMessageId,
    gmailMessageId: sent.gmailMessageId,
    gmailThreadId: sent.gmailThreadId,
    providerMetadata: {
      gmail_label_ids: sent.labelIds,
      sent_from: account.email_address,
    },
  })
}

async function confirmManualInstagramSend(input: {
  db: OutreachDb
  thread: OutreachThread
  draft: OutreachMessage
  approvalId: string | null
  manualSent: boolean
}) {
  if (!input.manualSent) {
    throw new OutreachSendError('Confirm the Instagram DM was sent manually before marking this thread sent', 409)
  }
  if (!input.thread.target_instagram_handle) {
    throw new OutreachSendError('Instagram outreach requires a target Instagram handle', 409)
  }

  return persistSentOutreach({
    db: input.db,
    thread: input.thread,
    draft: input.draft,
    approvalId: input.approvalId,
    channelExternalId: `instagram-manual:${Date.now()}`,
    sentManually: true,
    providerMetadata: {
      instagram_handle: input.thread.target_instagram_handle,
      send_mode: 'creator_deep_link',
    },
  })
}

async function sendSmsDraft(input: {
  db: OutreachDb
  thread: OutreachThread
  draft: OutreachMessage
  approvalId: string | null
  userId: string
}) {
  try {
    const sent = await sendTwilioSms({
      db: input.db,
      thread: input.thread,
      draft: input.draft,
      userId: input.userId,
    })

    return persistSentOutreach({
      db: input.db,
      thread: input.thread,
      draft: input.draft,
      approvalId: input.approvalId,
      channelExternalId: sent.messageSid,
      providerMetadata: {
        provider: 'twilio',
        status: sent.status,
        response: sent.raw,
      },
    })
  } catch (error) {
    throw new OutreachSendError(error instanceof Error ? error.message : 'Failed to send SMS outreach', 409)
  }
}

async function sendVoiceDraft(input: {
  db: OutreachDb
  thread: OutreachThread
  draft: OutreachMessage
  approvalId: string | null
}) {
  try {
    const sent = await placeVoiceAvailabilityCall({
      db: input.db,
      thread: input.thread,
      draft: input.draft,
    })

    return persistSentOutreach({
      db: input.db,
      thread: input.thread,
      draft: input.draft,
      approvalId: input.approvalId,
      channelExternalId: sent.callId,
      providerMetadata: {
        provider: sent.provider,
        response: sent.raw,
      },
    })
  } catch (error) {
    throw new OutreachSendError(error instanceof Error ? error.message : 'Failed to place voice call', 409)
  }
}

async function persistSentOutreach(input: {
  db: OutreachDb
  thread: OutreachThread
  draft: OutreachMessage
  approvalId: string | null
  channelExternalId: string
  gmailMessageId?: string | null
  gmailThreadId?: string | null
  providerMetadata?: Record<string, unknown>
  sentManually?: boolean
}) {
  const now = new Date()
  const sentAt = now.toISOString()
  const nextActionAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString()
  const nextState = transition(input.thread, { type: 'outbound_sent' })

  const { data: updatedMessage, error: messageError } = await input.db
    .from('outreach_messages')
    .update({
      approval_id: input.approvalId ?? input.draft.approval_id ?? null,
      gmail_message_id: input.gmailMessageId ?? null,
      gmail_thread_id: input.gmailThreadId ?? null,
      channel_external_id: input.channelExternalId,
      sent_at: sentAt,
      sent_manually: input.sentManually ?? false,
      autonomy_status: input.approvalId ? 'manual' : 'sent',
      provider_metadata_json: input.providerMetadata ?? {},
      headers_json: {
        ...(readRecord(input.draft.headers_json) ?? {}),
        ...(input.providerMetadata ?? {}),
      } as Json,
    })
    .eq('id', input.draft.id)
    .eq('thread_id', input.thread.id)
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
    .eq('id', input.thread.id)
    .eq('user_id', input.thread.user_id)
    .select(THREAD_SELECT)
    .single()

  if (threadError || !updatedThread) {
    throw new Error(threadError?.message ?? 'Failed to update outreach thread after send')
  }

  await insertVenueDiscoverySignal({
    db: input.db,
    thread: updatedThread as OutreachThread,
    eventType: 'email_sent',
  })

  return {
    thread: updatedThread as OutreachThread,
    message: updatedMessage as OutreachMessage,
  }
}

async function markAutonomousSendBlocked(db: OutreachDb, input: {
  thread: OutreachThread
  draft: OutreachMessage
  userId: string
  action: ReturnType<typeof inferPolicyAction>
  reason: string
  requiredApprovalType?: string
}) {
  await db
    .from('outreach_messages')
    .update({
      autonomy_status: 'blocked',
      autonomy_policy_version: null,
      headers_json: {
        ...(readRecord(input.draft.headers_json) ?? {}),
        autonomy_block: {
          action: input.action,
          reason: input.reason,
          required_approval_type: input.requiredApprovalType ?? 'approval',
        },
      } as Json,
    })
    .eq('id', input.draft.id)
    .eq('thread_id', input.thread.id)

  await recordPolicyDecision({
    db,
    userId: input.userId,
    action: input.action,
    decision: 'blocked',
    reason: input.reason,
    context: buildPolicyContext(input.thread, input.draft),
    result: { required_approval_type: input.requiredApprovalType ?? 'approval' },
  })

  await createOutreachNotification({
    db,
    userId: input.userId,
    threadId: input.thread.id,
    notificationType: 'policy_blocked_action',
    payload: {
      action: input.action,
      message_id: input.draft.id,
      reason: input.reason,
      required_approval_type: input.requiredApprovalType ?? 'approval',
    },
  })
}

function inferPolicyAction(thread: OutreachThread, draft: OutreachMessage) {
  const headers = readRecord(draft.headers_json) ?? {}
  const source = typeof headers.source === 'string' ? headers.source : ''
  if (source.includes('follow_up') || thread.follow_up_count > 0) return 'send_follow_up' as const
  if (thread.state === 'draft') return 'first_contact' as const
  if (/quote|pricing|price|hold/i.test(`${draft.subject}\n${draft.body_text}`)) {
    return 'reply_to_price_quote' as const
  }
  return 'reply_to_needs_info' as const
}

function buildPolicyContext(thread: OutreachThread, draft: OutreachMessage): PolicyGateContext {
  const headers = readRecord(draft.headers_json) ?? {}
  const extracted = readRecord(headers.extracted) ?? {}
  return {
    planId: thread.plan_id,
    threadId: thread.id,
    messageId: draft.id,
    targetId: thread.target_id,
    targetName: thread.target_name,
    targetType: thread.target_type,
    targetSource: thread.target_source,
    channel: thread.channel,
    priceCents: readNumber(extracted.price_cents),
    bodyText: draft.body_text,
    isFirstContact: thread.state === 'draft' && thread.follow_up_count === 0,
    followUpCount: thread.follow_up_count,
    moneyMovement: false,
    requiresSignature: false,
    legalCommitment: false,
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

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
