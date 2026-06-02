import 'server-only'

import {
  createOutreachNotification,
  loadLatestOutreachPolicy,
  recordPolicyDecision,
} from '@/lib/outreach/policyGate'
import type {
  CreatorOutreachPolicy,
  Json,
  OutreachChannel,
  OutreachMessage,
  OutreachPolicyAction,
  OutreachThread,
} from '@/lib/types'

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

const POLICY_SELECT = `
  id,
  user_id,
  version,
  max_unattended_budget_cents,
  allowed_autonomous_actions,
  quiet_hours_start_local,
  quiet_hours_end_local,
  max_inquiries_per_event,
  max_followups_per_thread,
  blacklisted_venue_ids,
  blacklisted_keywords,
  require_approval_for_first_contact,
  irreversible_autonomous_actions,
  trust_level,
  created_at,
  updated_at
`

export type ScheduleAutonomousSendResult = {
  scheduled: true
  message: OutreachMessage
  scheduledSendAt: string
  undoExpiresAt: string
}

export function getScheduledSendDelayMs(channel: OutreachChannel) {
  if (channel === 'email') return 5 * 60 * 1000
  if (channel === 'sms') return 30 * 1000
  return 0
}

export function getUndoWindowExpiresAt(now = new Date()) {
  return new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString()
}

export async function scheduleAutonomousSend(input: {
  db: OutreachDb
  userId: string
  thread: OutreachThread
  draft: OutreachMessage
  policy: CreatorOutreachPolicy
  action: OutreachPolicyAction
  reason: string
  delayMs?: number
}) {
  const now = new Date()
  const delayMs = input.delayMs ?? getScheduledSendDelayMs(input.thread.channel)
  const scheduledSendAt = new Date(now.getTime() + delayMs).toISOString()
  const undoExpiresAt = getUndoWindowExpiresAt(now)

  const { data, error } = await input.db
    .from('outreach_messages')
    .update({
      scheduled_send_at: scheduledSendAt,
      autonomous_send_after: scheduledSendAt,
      autonomy_policy_id: input.policy.id,
      autonomy_policy_version: input.policy.version,
      autonomy_status: 'scheduled',
      undo_expires_at: undoExpiresAt,
      headers_json: {
        ...readRecord(input.draft.headers_json),
        autonomy: {
          action: input.action,
          reason: input.reason,
          policy_version: input.policy.version,
          scheduled_delay_ms: delayMs,
        },
      } as Json,
    })
    .eq('id', input.draft.id)
    .eq('thread_id', input.thread.id)
    .select(MESSAGE_SELECT)
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to schedule autonomous send')

  await recordPolicyDecision({
    db: input.db,
    userId: input.userId,
    action: input.action,
    decision: 'autonomous_scheduled',
    reason: input.reason,
    policy: input.policy,
    context: {
      planId: input.thread.plan_id,
      threadId: input.thread.id,
      messageId: input.draft.id,
      targetId: input.thread.target_id,
      targetName: input.thread.target_name,
      targetType: input.thread.target_type,
      targetSource: input.thread.target_source,
      channel: input.thread.channel,
      followUpCount: input.thread.follow_up_count,
    },
    result: { scheduled_send_at: scheduledSendAt, undo_expires_at: undoExpiresAt },
    reversibleUntil: undoExpiresAt,
  })

  await createOutreachNotification({
    db: input.db,
    userId: input.userId,
    threadId: input.thread.id,
    notificationType: 'agent_acted_autonomously',
    payload: {
      action: input.action,
      message_id: input.draft.id,
      scheduled_send_at: scheduledSendAt,
      undo_expires_at: undoExpiresAt,
      policy_version: input.policy.version,
    },
  })

  return {
    scheduled: true,
    message: data as OutreachMessage,
    scheduledSendAt,
    undoExpiresAt,
  } satisfies ScheduleAutonomousSendResult
}

export async function pauseCreatorOutreachAgent(input: {
  db: OutreachDb
  userId: string
}) {
  const policy = await createNextPolicyVersion(input.db, input.userId, {
    allowed_autonomous_actions: [],
  })

  const openThreads = await loadOpenThreads(input.db, input.userId)
  const openThreadIds = openThreads.map((thread) => thread.id)
  let cancelledMessages = 0

  if (openThreadIds.length > 0) {
    const now = new Date().toISOString()
    const { data: cancelled } = await input.db
      .from('outreach_messages')
      .update({
        cancelled_at: now,
        autonomy_status: 'cancelled',
      })
      .in('thread_id', openThreadIds)
      .eq('autonomy_status', 'scheduled')
      .is('sent_at', null)
      .is('cancelled_at', null)
      .select('id')

    cancelledMessages = (cancelled ?? []).length

    const { error: threadError } = await input.db
      .from('outreach_threads')
      .update({
        state: 'awaiting_creator_review',
        needs_attention: true,
        next_action_at: null,
        last_event_at: now,
      })
      .eq('user_id', input.userId)
      .in('state', ['draft', 'awaiting_reply', 'in_negotiation', 'stale'])

    if (threadError) throw new Error(threadError.message)
  }

  await recordPolicyDecision({
    db: input.db,
    userId: input.userId,
    action: 'pause_agent',
    decision: 'paused',
    reason: 'creator_paused_autonomous_outreach',
    policy,
    result: {
      cancelled_messages: cancelledMessages,
      flagged_threads: openThreadIds.length,
    },
    humanIntervened: true,
  })

  await createOutreachNotification({
    db: input.db,
    userId: input.userId,
    notificationType: 'requires_approval',
    payload: {
      action: 'pause_agent',
      cancelled_messages: cancelledMessages,
      flagged_threads: openThreadIds.length,
      policy_version: policy.version,
    },
  })

  return { policy, cancelledMessages, flaggedThreads: openThreadIds.length }
}

export async function undoLastAutonomousAction(input: {
  db: OutreachDb
  userId: string
}) {
  const audit = await loadLatestUndoableAudit(input.db, input.userId)
  if (!audit) return { undone: false, reason: 'no_undoable_autonomous_action' as const }

  const now = new Date().toISOString()
  const message = audit.message_id ? await loadMessage(input.db, audit.message_id) : null

  if (message && !message.sent_at && message.autonomy_status === 'scheduled') {
    const { error } = await input.db
      .from('outreach_messages')
      .update({
        cancelled_at: now,
        autonomy_status: 'undone',
      })
      .eq('id', message.id)

    if (error) throw new Error(error.message)
    await markAuditUndone(input.db, audit.id, now)
    await createOutreachNotification({
      db: input.db,
      userId: input.userId,
      threadId: audit.thread_id,
      notificationType: 'requires_approval',
      payload: { action: 'undo_autonomous_send', message_id: message.id, outcome: 'scheduled_send_cancelled' },
    })
    return { undone: true, outcome: 'scheduled_send_cancelled' as const, messageId: message.id }
  }

  if (message?.sent_at && audit.thread_id) {
    const thread = await loadThreadById(input.db, audit.thread_id, input.userId)
    if (!thread) return { undone: false, reason: 'thread_not_found' as const }
    const correction = await createCorrectionDraft(input.db, thread, message)
    await markAuditUndone(input.db, audit.id, now)
    await createOutreachNotification({
      db: input.db,
      userId: input.userId,
      threadId: thread.id,
      notificationType: 'requires_approval',
      payload: {
        action: 'undo_autonomous_send',
        original_message_id: message.id,
        correction_draft_message_id: correction.messageId,
        approval_id: correction.approvalId,
      },
    })
    return {
      undone: true,
      outcome: 'correction_draft_created' as const,
      messageId: correction.messageId,
      approvalId: correction.approvalId,
    }
  }

  return { undone: false, reason: 'action_not_reversible' as const }
}

export async function createNextPolicyVersion(
  db: OutreachDb,
  userId: string,
  patch: Partial<Pick<
    CreatorOutreachPolicy,
    | 'max_unattended_budget_cents'
    | 'allowed_autonomous_actions'
    | 'quiet_hours_start_local'
    | 'quiet_hours_end_local'
    | 'max_inquiries_per_event'
    | 'max_followups_per_thread'
    | 'blacklisted_venue_ids'
    | 'blacklisted_keywords'
    | 'require_approval_for_first_contact'
    | 'irreversible_autonomous_actions'
    | 'trust_level'
  >>
) {
  const current = await loadLatestOutreachPolicy(db, userId)
  const nextVersion = (current?.version ?? 0) + 1
  const payload = {
    user_id: userId,
    version: nextVersion,
    max_unattended_budget_cents: patch.max_unattended_budget_cents ?? current?.max_unattended_budget_cents ?? 0,
    allowed_autonomous_actions: patch.allowed_autonomous_actions ?? current?.allowed_autonomous_actions ?? [],
    quiet_hours_start_local: patch.quiet_hours_start_local ?? current?.quiet_hours_start_local ?? null,
    quiet_hours_end_local: patch.quiet_hours_end_local ?? current?.quiet_hours_end_local ?? null,
    max_inquiries_per_event: patch.max_inquiries_per_event ?? current?.max_inquiries_per_event ?? 0,
    max_followups_per_thread: patch.max_followups_per_thread ?? current?.max_followups_per_thread ?? 0,
    blacklisted_venue_ids: patch.blacklisted_venue_ids ?? current?.blacklisted_venue_ids ?? [],
    blacklisted_keywords: patch.blacklisted_keywords ?? current?.blacklisted_keywords ?? [],
    require_approval_for_first_contact: patch.require_approval_for_first_contact ?? current?.require_approval_for_first_contact ?? true,
    irreversible_autonomous_actions: patch.irreversible_autonomous_actions ?? current?.irreversible_autonomous_actions ?? [],
    trust_level: patch.trust_level ?? current?.trust_level ?? 0,
  }

  const { data, error } = await db
    .from('creator_outreach_policies')
    .insert(payload)
    .select(POLICY_SELECT)
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to create outreach policy version')
  return data as CreatorOutreachPolicy
}

export async function recomputeOutreachTrustScores(db: OutreachDb) {
  const policies = await loadLatestPolicies(db)
  let updated = 0
  const errors: Array<{ userId: string; error: string }> = []

  for (const policy of policies) {
    try {
      const metrics = await collectTrustMetrics(db, policy.user_id)
      const nextTrust = deriveTrustLevel(metrics)
      if (nextTrust !== policy.trust_level) {
        await createNextPolicyVersion(db, policy.user_id, { trust_level: nextTrust })
        updated += 1
      }

      await db
        .from('creator_outreach_trust_history')
        .insert({
          user_id: policy.user_id,
          policy_id: policy.id,
          policy_version: policy.version,
          trust_level: nextTrust,
          metrics_json: metrics as Json,
        })
    } catch (error) {
      errors.push({
        userId: policy.user_id,
        error: error instanceof Error ? error.message : 'Unknown trust recompute error',
      })
    }
  }

  return { creatorsChecked: policies.length, updated, errors }
}

async function loadLatestPolicies(db: OutreachDb): Promise<CreatorOutreachPolicy[]> {
  const { data, error } = await db
    .from('creator_outreach_policies')
    .select(POLICY_SELECT)
    .order('user_id', { ascending: true })
    .order('version', { ascending: false })

  if (error) throw new Error(error.message)

  const latest = new Map<string, CreatorOutreachPolicy>()
  for (const row of (data ?? []) as CreatorOutreachPolicy[]) {
    if (!latest.has(row.user_id)) latest.set(row.user_id, row)
  }
  return Array.from(latest.values())
}

async function collectTrustMetrics(db: OutreachDb, userId: string) {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const [{ data: audits }, { data: threads }] = await Promise.all([
    db
      .from('outreach_policy_audit_logs')
      .select('decision, reason, human_intervened, created_at')
      .eq('user_id', userId)
      .gte('created_at', since),
    db
      .from('outreach_threads')
      .select('state, created_at')
      .eq('user_id', userId)
      .gte('created_at', since),
  ])

  const auditRows = (audits ?? []) as Array<{ decision: string; reason: string; human_intervened: boolean; created_at: string }>
  const threadRows = (threads ?? []) as Array<{ state: string; created_at: string }>
  const autonomousActions = auditRows.filter((row) => row.decision === 'autonomous_sent' || row.decision === 'autonomous_scheduled').length
  const blockedActions = auditRows.filter((row) => row.decision === 'blocked' || row.decision === 'pending_approval').length
  const undoEvents = auditRows.filter((row) => row.decision === 'undone').length
  const pauseEvents = auditRows.filter((row) => row.decision === 'paused').length
  const confirmedThreads = threadRows.filter((row) => row.state === 'confirmed').length
  const declinedThreads = threadRows.filter((row) => row.state === 'declined').length

  return {
    period_days: 90,
    autonomous_actions: autonomousActions,
    blocked_actions: blockedActions,
    undo_events: undoEvents,
    pause_events: pauseEvents,
    confirmed_threads: confirmedThreads,
    declined_threads: declinedThreads,
    approval_as_is_rate: null,
    classifier_override_rate: null,
    dispute_free_booking_count: confirmedThreads,
  }
}

function deriveTrustLevel(metrics: Awaited<ReturnType<typeof collectTrustMetrics>>) {
  if (metrics.pause_events > 0 || metrics.undo_events > 1) return 0

  const totalResolved = metrics.confirmed_threads + metrics.declined_threads
  const bookingSignal = totalResolved > 0 ? metrics.confirmed_threads / totalResolved : 0
  const blockPenalty = Math.min(30, metrics.blocked_actions * 3)
  const volumeBonus = Math.min(20, metrics.autonomous_actions * 2)
  const bookingBonus = Math.round(bookingSignal * 35)

  return clamp(25 + volumeBonus + bookingBonus - blockPenalty, 0, 100)
}

async function loadOpenThreads(db: OutreachDb, userId: string): Promise<OutreachThread[]> {
  const { data, error } = await db
    .from('outreach_threads')
    .select(THREAD_SELECT)
    .eq('user_id', userId)
    .in('state', ['draft', 'awaiting_reply', 'in_negotiation', 'stale'])

  if (error) throw new Error(error.message)
  return (data ?? []) as OutreachThread[]
}

async function loadLatestUndoableAudit(db: OutreachDb, userId: string) {
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('outreach_policy_audit_logs')
    .select('*')
    .eq('user_id', userId)
    .in('decision', ['autonomous_scheduled', 'autonomous_sent'])
    .is('undone_at', null)
    .gte('reversible_until', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as { id: string; thread_id: string | null; message_id: string | null } | null
}

async function loadMessage(db: OutreachDb, messageId: string): Promise<OutreachMessage | null> {
  const { data, error } = await db
    .from('outreach_messages')
    .select(MESSAGE_SELECT)
    .eq('id', messageId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as OutreachMessage | null
}

async function loadThreadById(db: OutreachDb, threadId: string, userId: string): Promise<OutreachThread | null> {
  const { data, error } = await db
    .from('outreach_threads')
    .select(THREAD_SELECT)
    .eq('id', threadId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as OutreachThread | null
}

async function createCorrectionDraft(db: OutreachDb, thread: OutreachThread, originalMessage: OutreachMessage) {
  const { data: action, error: actionError } = await db
    .from('agent_actions')
    .insert({
      plan_id: thread.plan_id,
      action_type: 'email',
      description: `Review correction for autonomous outreach to ${thread.target_name}`,
      provider: thread.channel,
      target_type: thread.target_type,
      target_id: thread.target_id,
      payload_json: {
        kind: 'autonomy_undo_correction',
        outreach_thread_id: thread.id,
        original_message_id: originalMessage.id,
      } as Json,
      amount_cents: 0,
      currency: 'usd',
      status: 'pending',
      result_metadata: { source: 'outreach_autonomy_undo' } as Json,
    })
    .select('id')
    .single()

  if (actionError || !action) throw new Error(actionError?.message ?? 'Failed to create correction action')

  const { data: approval, error: approvalError } = await db
    .from('approvals')
    .insert({
      plan_id: thread.plan_id,
      agent_action_id: action.id,
      action_label: `Approve correction to ${thread.target_name}`,
      provider: thread.channel,
      price_cents: 0,
      fees_cents: 0,
      package_details: 'Correction draft for a previously autonomous outreach message.',
      refund_terms: 'No charge is made now. This only approves a correction message.',
      cancellation_terms: 'You can edit or cancel before sending.',
      delivery_email: thread.target_email,
      requested_amount_cents: 0,
      status: 'pending',
    })
    .select('id')
    .single()

  if (approvalError || !approval) throw new Error(approvalError?.message ?? 'Failed to create correction approval')

  const body = [
    `Hi ${thread.target_name} team,`,
    'I want to correct my previous note before you act on it.',
    'Please disregard any part that suggested a confirmed commitment. I will follow up after reviewing the details.',
    'Thank you.',
  ].join('\n\n')

  const { data: message, error: messageError } = await db
    .from('outreach_messages')
    .insert({
      thread_id: thread.id,
      agent_action_id: action.id,
      approval_id: approval.id,
      direction: 'outbound',
      subject: `Correction: ${originalMessage.subject || thread.target_name}`,
      body_text: body,
      body_html: null,
      headers_json: {
        source: 'outreach_autonomy_undo',
        original_message_id: originalMessage.id,
      } as Json,
      autonomy_status: 'pending_approval',
    })
    .select('id')
    .single()

  if (messageError || !message) throw new Error(messageError?.message ?? 'Failed to create correction draft')

  await db
    .from('outreach_threads')
    .update({
      state: 'awaiting_creator_review',
      needs_attention: true,
      next_action_at: null,
      last_event_at: new Date().toISOString(),
    })
    .eq('id', thread.id)

  return { actionId: String(action.id), approvalId: String(approval.id), messageId: String(message.id) }
}

async function markAuditUndone(db: OutreachDb, auditId: string, undoneAt: string) {
  const { error } = await db
    .from('outreach_policy_audit_logs')
    .update({ undone_at: undoneAt, decision: 'undone' })
    .eq('id', auditId)

  if (error) throw new Error(error.message)
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
