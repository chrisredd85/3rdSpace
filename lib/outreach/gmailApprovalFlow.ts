import 'server-only'

import {
  getUsableGmailAccessToken,
  listGmailThreadMessages,
  modifyGmailThreadLabels,
  sendGmailMessage,
  type ParsedGmailMessage,
} from '@/lib/outreach/gmail'
import { extractReplyTerms } from '@/lib/ai/agents/extractReplyTerms'
import { APPROVAL_SELECT_COLUMNS, PLAN_MESSAGE_SELECT_COLUMNS, PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { rootLogger } from '@/lib/server/logger'
import { buildApprovalSnapshotHash } from '@/lib/planner/execution/reapproval'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { AgentAction, Approval, Json, Plan } from '@/lib/types'
import type { Database } from '@/lib/types/database-generated'

type CreatorEmailAccount = Database['public']['Tables']['creator_email_accounts']['Row']
type PlannerDb = { from: (table: string) => any }

export const GMAIL_APPROVED_OUTREACH_KIND = 'gmail_approved_outreach'
export const GMAIL_APPROVAL_DEMO_TARGET_SOURCE = 'discovery'

const AGENT_ACTION_SELECT_COLUMNS = `
  id,
  plan_id,
  action_type,
  description,
  provider,
  target_type,
  target_id,
  payload_json,
  amount_cents,
  currency,
  status,
  approval_id,
  executed_at,
  result_metadata,
  created_at,
  updated_at
`

export type GmailOutreachTarget = {
  name: string
  email: string
  kind?: 'venue' | 'vendor'
  discoveryVenueId?: string | null
  discoveryVendorId?: string | null
}

export type GmailApprovalState = {
  account: Pick<CreatorEmailAccount, 'id' | 'provider' | 'email_address' | 'created_at' | 'token_expires_at'> | null
  approval: Approval | null
  approvalMessageId: string | null
  planId: string | null
  threads: GmailOutreachThreadSummary[]
}

export type GmailOutreachThreadSummary = {
  id: string
  plan_id: string
  target_name: string
  target_type: string
  target_email: string | null
  state: string
  needs_attention: boolean
  last_event_at: string
  last_inbound_at: string | null
  last_outbound_at: string | null
  messages: GmailOutreachMessageSummary[]
}

export type GmailOutreachMessageSummary = {
  id: string
  direction: string
  subject: string
  body_text: string
  from: string | null
  gmail_message_id: string | null
  gmail_thread_id: string | null
  sent_at: string | null
  received_at: string | null
}

export class GmailConnectionRequiredError extends Error {
  constructor() {
    super('Connect Gmail before creating outreach approvals.')
    this.name = 'GmailConnectionRequiredError'
  }
}

export function isGmailApprovedOutreachAction(
  action: Pick<AgentAction, 'action_type' | 'payload_json'>
): boolean {
  const payload = readRecord(action.payload_json)
  return action.action_type === 'email' && readString(payload?.kind) === GMAIL_APPROVED_OUTREACH_KIND
}

export async function loadGmailApprovalState(db: PlannerDb, userId: string): Promise<GmailApprovalState> {
  const [account, plan] = await Promise.all([
    loadActiveGmailAccount(db, userId),
    loadLatestGmailApprovalPlan(db, userId),
  ])
  const [approvalBundle, threads] = await Promise.all([
    plan ? loadReusableApprovalBundle(db, plan.id) : Promise.resolve(null),
    loadGmailOutreachThreads(db, userId),
  ])

  return {
    account: account
      ? {
        id: account.id,
        provider: account.provider,
        email_address: account.email_address,
        created_at: account.created_at,
        token_expires_at: account.token_expires_at,
      }
      : null,
    approval: approvalBundle?.approval ?? null,
    approvalMessageId: approvalBundle?.messageId ?? null,
    planId: plan?.id ?? null,
    threads,
  }
}

export async function createOrReuseGmailOutreachApproval(
  db: PlannerDb,
  input: {
    userId: string
    targets: GmailOutreachTarget[]
    subject: string
    bodyText: string
    planId?: string | null
    reuseExisting?: boolean
  }
) {
  const account = await loadActiveGmailAccount(db, input.userId)
  if (!account) throw new GmailConnectionRequiredError()

  const targets = normalizeTargets(input.targets)
  const subject = input.subject.trim()
  const bodyText = input.bodyText.trim()
  const plan = input.planId
    ? await loadPlanForGmailApproval(db, input.planId, input.userId)
    : await getOrCreateGmailApprovalPlan(db, input.userId)
  if (!plan) throw new Error('Plan not found')
  const actionPayload = buildActionPayload({
    targets,
    subject,
    bodyText,
    senderEmail: account.email_address,
  })
  const existing = input.planId || input.reuseExisting === false
    ? null
    : await loadReusableApprovalBundle(db, plan.id)
  // The session client proved the Gmail account and plan belong to this user.
  // Only trusted-state mutations below use the service writer.
  const writeDb = createServiceRoleClient() as unknown as PlannerDb

  if (existing) {
    const { approval, action, messageId } = existing
    const { data: updatedAction } = await writeDb
      .from('agent_actions')
      .update({
        description: buildActionDescription(targets),
        payload_json: actionPayload as Json,
        provider: 'Gmail',
        target_type: getBatchTargetType(targets),
        result_metadata: {
          ...(readRecord(action.result_metadata) ?? {}),
          target_count: targets.length,
          venue_count: countTargetsByKind(targets, 'venue'),
          vendor_count: countTargetsByKind(targets, 'vendor'),
        } as Json,
      })
      .eq('id', action.id)
      .select(AGENT_ACTION_SELECT_COLUMNS)
      .single()

    const finalAction = (updatedAction ?? action) as AgentAction
    const approvalUpdates = buildApprovalUpdates(targets, subject)
    const { data: updatedApproval } = await writeDb
      .from('approvals')
      .update({
        ...approvalUpdates,
        snapshot_hash: buildApprovalSnapshotHash({
          plan,
          approval: {
            ...approval,
            ...approvalUpdates,
          },
          action: finalAction,
          payload: actionPayload,
        }),
      })
      .eq('id', approval.id)
      .select(APPROVAL_SELECT_COLUMNS)
      .single()

    const finalApproval = (updatedApproval ?? approval) as Approval
    await updateApprovalMessage(writeDb, messageId, plan, finalAction, finalApproval, actionPayload)

    return {
      plan,
      agentAction: finalAction,
      approval: finalApproval,
      approvalMessageId: messageId,
      redirectUrl: buildPlannerApprovalUrl(plan.id, messageId),
    }
  }

  const { data: agentAction, error: actionError } = await writeDb
    .from('agent_actions')
    .insert({
      plan_id: plan.id,
      action_type: 'email',
      description: buildActionDescription(targets),
      provider: 'Gmail',
      target_type: getBatchTargetType(targets),
      target_id: null,
      payload_json: actionPayload as Json,
      amount_cents: 0,
      currency: 'usd',
      status: 'pending',
      result_metadata: {
        target_count: targets.length,
        venue_count: countTargetsByKind(targets, 'venue'),
        vendor_count: countTargetsByKind(targets, 'vendor'),
        approval_flow: GMAIL_APPROVED_OUTREACH_KIND,
      } as Json,
    })
    .select(AGENT_ACTION_SELECT_COLUMNS)
    .single()

  if (actionError || !agentAction) throw new Error(actionError?.message ?? 'Failed to create Gmail outreach action')

  await insertAgentActionAuditLog(writeDb, {
    actionId: String(agentAction.id),
    planId: plan.id,
    actorId: input.userId,
    toStatus: String(agentAction.status),
    reason: 'gmail_outreach_approval.created',
  })

  const approvalUpdates = buildApprovalUpdates(targets, subject)
  const { data: approval, error: approvalError } = await writeDb
    .from('approvals')
    .insert({
      ...approvalUpdates,
      plan_id: plan.id,
      agent_action_id: agentAction.id,
      status: 'pending',
      requested_amount_cents: 0,
      snapshot_hash: buildApprovalSnapshotHash({
        plan,
        approval: approvalUpdates,
        action: agentAction as AgentAction,
        payload: actionPayload,
      }),
    })
    .select(APPROVAL_SELECT_COLUMNS)
    .single()

  if (approvalError || !approval) throw new Error(approvalError?.message ?? 'Failed to create Gmail outreach approval')

  await writeDb.from('agent_actions').update({ approval_id: approval.id }).eq('id', agentAction.id)

  const { data: message, error: messageError } = await writeDb
    .from('plan_messages')
    .insert({
      plan_id: plan.id,
      role: 'agent',
      content: `Review this Gmail outreach batch before anything sends. Approving sends ${targets.length} email${targets.length === 1 ? '' : 's'} from your connected Gmail account so replies can be compared in 3rdPlace.`,
      message_type: 'approval_request',
      metadata: buildApprovalMessageMetadata(plan, agentAction as AgentAction, approval as Approval, actionPayload) as Json,
    })
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .single()

  if (messageError || !message) throw new Error(messageError?.message ?? 'Failed to create Gmail approval message')

  return {
    plan,
    agentAction: { ...(agentAction as AgentAction), approval_id: approval.id },
    approval: approval as Approval,
    approvalMessageId: String(message.id),
    redirectUrl: buildPlannerApprovalUrl(plan.id, String(message.id)),
  }
}

export async function executeApprovedGmailOutreach(
  db: PlannerDb,
  input: {
    userId: string
    plan: Plan
    action: AgentAction
    approval: Approval
  }
) {
  const payload = readRecord(input.action.payload_json)
  if (readString(payload?.kind) !== GMAIL_APPROVED_OUTREACH_KIND) {
    throw new Error('Action is not Gmail approved outreach')
  }

  const account = await loadActiveGmailAccount(db, input.userId)
  if (!account) throw new GmailConnectionRequiredError()
  const ownedPlan = await loadPlanForGmailApproval(db, input.plan.id, input.userId)
  if (!ownedPlan) throw new Error('Plan not found')
  const writeDb = createServiceRoleClient() as unknown as PlannerDb

  const accessToken = await getUsableGmailAccessToken({ db, account })
  const targets = normalizeTargets(readTargets(payload))
  const subject = readString(payload?.subject) ?? `${input.plan.title} partnership inquiry`
  const bodyTemplate = readString(payload?.body_text) ?? defaultBodyText()
  const now = new Date().toISOString()
  const sent: Array<{ target: GmailOutreachTarget; threadId: string; messageId: string }> = []

  for (const target of targets) {
    const bodyText = renderBodyForTarget(bodyTemplate, target, account.email_address)
    const sendResult = await sendGmailMessage({
      accessToken,
      from: account.email_address,
      to: target.email,
      replyTo: account.email_address,
      subject,
      bodyText,
      bodyHtml: textToHtml(bodyText),
    })

    const thread = await insertOutreachThread(writeDb, {
      userId: input.userId,
      planId: input.plan.id,
      actionId: input.action.id,
      target,
      now,
    })

    await writeDb.from('outreach_messages').insert({
      thread_id: thread.id,
      direction: 'outbound',
      subject,
      body_text: bodyText,
      body_html: textToHtml(bodyText),
      headers_json: {
        from: account.email_address,
        to: target.email,
      } as Json,
      provider_metadata_json: {
        provider: 'gmail',
        label_ids: sendResult.labelIds,
        approval_flow: GMAIL_APPROVED_OUTREACH_KIND,
      } as Json,
      attachments_json: [] as Json,
      gmail_message_id: sendResult.gmailMessageId,
      gmail_thread_id: sendResult.gmailThreadId,
      agent_action_id: input.action.id,
      approval_id: input.approval.id,
      sent_at: now,
      sent_manually: true,
    })

    sent.push({
      target,
      threadId: String(thread.id),
      messageId: sendResult.gmailMessageId,
    })
  }

  await writeDb.from('plan_messages').insert({
    plan_id: input.plan.id,
    role: 'system',
    content: `Sent approved Gmail outreach to ${sent.length} partner${sent.length === 1 ? '' : 's'}. Replies will appear in Outreach for comparison and follow-up.`,
    message_type: 'status_update',
    metadata: {
      kind: GMAIL_APPROVED_OUTREACH_KIND,
      approval_id: input.approval.id,
      agent_action_id: input.action.id,
      sent_count: sent.length,
      thread_ids: sent.map((item) => item.threadId),
      outbound_message_sent: true,
    } as Json,
  })

  return {
    prepared: true,
    sent_count: sent.length,
    thread_ids: sent.map((item) => item.threadId),
    outbound_message_sent: true,
  }
}

export async function syncGmailOutreachThread(
  db: PlannerDb,
  input: {
    userId: string
    threadId: string
  }
) {
  const account = await loadActiveGmailAccount(db, input.userId)
  if (!account) throw new GmailConnectionRequiredError()

  const thread = await loadOwnedThread(db, input.userId, input.threadId)
  if (!thread) throw new Error('Outreach thread not found')
  const writeDb = createServiceRoleClient() as unknown as PlannerDb

  const gmailThreadId = await loadGmailThreadIdForThread(db, input.threadId)
  if (!gmailThreadId) throw new Error('Outreach thread does not have a Gmail thread id yet')

  const accessToken = await getUsableGmailAccessToken({ db, account })
  const messages = await listGmailThreadMessages({ accessToken, gmailThreadId })
  const inserted = await insertMissingGmailMessages(db, writeDb, thread, messages, account.email_address)
  if (inserted > 0) {
    await analyzeInboundReplyTerms(db, writeDb, thread, messages).catch((error) => {
      rootLogger.error('Gmail outreach reply terms extraction failed', error, {
        thread_id: input.threadId,
      })
    })
  }
  const refreshed = await loadGmailOutreachThreads(db, input.userId, input.threadId)

  return {
    inserted_count: inserted,
    thread: refreshed[0] ?? null,
  }
}

export async function markGmailOutreachThreadHandled(
  db: PlannerDb,
  input: {
    userId: string
    threadId: string
  }
) {
  const account = await loadActiveGmailAccount(db, input.userId)
  if (!account) throw new GmailConnectionRequiredError()

  const thread = await loadOwnedThread(db, input.userId, input.threadId)
  if (!thread) throw new Error('Outreach thread not found')
  const writeDb = createServiceRoleClient() as unknown as PlannerDb

  const gmailThreadId = await loadGmailThreadIdForThread(db, input.threadId)
  if (!gmailThreadId) throw new Error('Outreach thread does not have a Gmail thread id yet')

  const accessToken = await getUsableGmailAccessToken({ db, account })
  await modifyGmailThreadLabels({
    accessToken,
    gmailThreadId,
    removeLabelIds: ['UNREAD', 'INBOX'],
  })

  const now = new Date().toISOString()
  await writeDb
    .from('outreach_threads')
    .update({
      state: 'confirmed',
      needs_attention: false,
      updated_at: now,
    })
    .eq('id', input.threadId)
    .eq('user_id', input.userId)

  const refreshed = await loadGmailOutreachThreads(db, input.userId, input.threadId)
  return refreshed[0] ?? null
}

export function defaultBodyText() {
  return [
    'Hi {{place_name}},',
    '',
    "I'm planning a Bay Area happy hour and wanted to see whether there is a fit to support the event.",
    '',
    'If you are interested, please reply with available dates, pricing or minimums, and the best next step.',
    '',
    'Thanks,',
    '{{sender_email}}',
  ].join('\n')
}

function buildActionPayload(input: {
  targets: GmailOutreachTarget[]
  subject: string
  bodyText: string
  senderEmail: string
}) {
  return {
    kind: GMAIL_APPROVED_OUTREACH_KIND,
    targets: input.targets,
    subject: input.subject,
    body_text: input.bodyText,
    sender_email: input.senderEmail,
    requires_user_action: true,
    sends_after_approval: true,
    comparison_goal: 'Collect availability, fit, pricing, and next steps so 3rdPlace can compare replies and recommend the best partner choices.',
    batch_partner_counts: {
      venues: countTargetsByKind(input.targets, 'venue'),
      vendors: countTargetsByKind(input.targets, 'vendor'),
      total: input.targets.length,
    },
    gmail_scopes_demonstrated: ['gmail.send', 'gmail.readonly', 'gmail.modify'],
  }
}

function buildActionDescription(targets: GmailOutreachTarget[]) {
  return `Send approved Gmail outreach to ${formatTargetCounts(targets)}`
}

function buildApprovalUpdates(targets: GmailOutreachTarget[], subject: string) {
  return {
    action_label: `Send outreach to ${formatTargetCounts(targets)}`,
    provider: 'Gmail',
    event_date: null,
    price_cents: 0,
    fees_cents: 0,
    refund_terms: 'No booking or payment happens. This approval only sends the reviewed Gmail outreach.',
    cancellation_terms: 'Cancel before approving to prevent outbound email.',
    package_details: `${subject} — ${targets.map((target) => `${target.name} <${target.email}>`).join(', ')}. Replies are compared by availability, fit, pricing, and next step before recommendations are finalized.`,
    delivery_email: targets[0]?.email ?? null,
  }
}

function buildApprovalMessageMetadata(
  plan: Plan,
  action: AgentAction,
  approval: Approval,
  payload: Record<string, unknown>
) {
  const targets = normalizeTargets(readTargets(payload))
  const senderEmail = readString(payload.sender_email) ?? 'your connected Gmail account'
  const previewTemplate = readString(payload.body_text) ?? defaultBodyText()
  const previewTarget = targets[0]
  const previewBody = previewTarget
    ? renderBodyForTarget(previewTemplate, previewTarget, senderEmail)
    : previewTemplate
  return {
    kind: GMAIL_APPROVED_OUTREACH_KIND,
    venue_ids: targets.map((target) => target.discoveryVenueId).filter(Boolean),
    discovery_venue_ids: targets.map((target) => target.discoveryVenueId).filter(Boolean),
    discovery_vendor_ids: targets.map((target) => target.discoveryVendorId).filter(Boolean),
    projected_costs_cents: 0,
    requires_user_action: true,
    summary: `Approved Gmail send for ${plan.title}`,
    response_deadline: null,
    queued_invite_count: targets.length,
    queued_vendor_invite_count: countTargetsByKind(targets, 'vendor'),
    partner_targets: targets.map((target) => ({
      kind: target.kind ?? 'venue',
      name: target.name,
      email: target.email,
      discovery_venue_id: target.discoveryVenueId ?? null,
      discovery_vendor_id: target.discoveryVendorId ?? null,
    })),
    comparison_goal: readString(payload.comparison_goal),
    invites: targets.map((target) => ({
      target_type: target.kind ?? 'venue',
      venue_response_json: {
        target_type: target.kind ?? 'venue',
        target_name: target.name,
        target_email: target.email,
        discovery_venue_id: target.discoveryVenueId ?? null,
        discovery_vendor_id: target.discoveryVendorId ?? null,
      },
    })),
    opportunity: {
      title: action.description,
      summary: previewBody,
      response_deadline: null,
    },
    approval: {
      ...approval,
      kind: GMAIL_APPROVED_OUTREACH_KIND,
      label: approval.action_label,
      terms: approval.refund_terms,
    },
  }
}

async function updateApprovalMessage(
  db: PlannerDb,
  messageId: string,
  plan: Plan,
  action: AgentAction,
  approval: Approval,
  payload: Record<string, unknown>
) {
  await db
    .from('plan_messages')
    .update({
      metadata: buildApprovalMessageMetadata(plan, action, approval, payload) as Json,
    })
    .eq('id', messageId)
}

async function getOrCreateGmailApprovalPlan(db: PlannerDb, userId: string): Promise<Plan> {
  const existing = await loadLatestGmailApprovalPlan(db, userId)
  if (existing) return existing

  const { data, error } = await db
    .from('plans')
    .insert({
      user_id: userId,
      title: 'Google verification outreach demo',
      event_type: 'Happy hour',
      status: 'ready',
      guest_count: 40,
      ticketed: false,
      ticketing_model: 'rsvp',
      food_responsibility: 'venue',
      neighborhood: 'San Francisco',
      notes: 'Demo plan used to show approval-gated Gmail outreach for Google OAuth verification.',
      metadata: {
        gmail_approval_flow: true,
        google_verification_demo: true,
      } as Json,
    })
    .select(PLAN_SELECT_COLUMNS)
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to create Gmail approval plan')
  return data as Plan
}

async function loadLatestGmailApprovalPlan(db: PlannerDb, userId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (error) throw new Error(error.message)
  const rows = Array.isArray(data) ? data as Plan[] : []
  return rows.find((plan) => readRecord(plan.metadata)?.gmail_approval_flow === true) ?? null
}

async function loadPlanForGmailApproval(db: PlannerDb, planId: string, userId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as Plan | null) ?? null
}

async function loadReusableApprovalBundle(
  db: PlannerDb,
  planId: string
): Promise<{ action: AgentAction; approval: Approval; messageId: string } | null> {
  const { data: messages, error } = await db
    .from('plan_messages')
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .eq('message_type', 'approval_request')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) throw new Error(error.message)

  for (const message of Array.isArray(messages) ? messages : []) {
    const metadata = readRecord(message.metadata)
    if (readString(metadata?.kind) !== GMAIL_APPROVED_OUTREACH_KIND) continue
    const approval = readRecord(metadata?.approval)
    const approvalId = readString(approval?.id)
    if (!approvalId) continue

    const loadedApproval = await loadApproval(db, approvalId)
    if (!loadedApproval || loadedApproval.status !== 'pending') continue
    const action = await loadAgentAction(db, loadedApproval.agent_action_id)
    if (!action || !['pending', 'proposed', 'approved'].includes(action.status)) continue
    if (!isGmailApprovedOutreachAction(action)) continue

    return {
      action,
      approval: loadedApproval,
      messageId: String(message.id),
    }
  }

  return null
}

async function loadApproval(db: PlannerDb, approvalId: string): Promise<Approval | null> {
  const { data, error } = await db
    .from('approvals')
    .select(APPROVAL_SELECT_COLUMNS)
    .eq('id', approvalId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as Approval | null) ?? null
}

async function loadAgentAction(db: PlannerDb, actionId: string): Promise<AgentAction | null> {
  const { data, error } = await db
    .from('agent_actions')
    .select(AGENT_ACTION_SELECT_COLUMNS)
    .eq('id', actionId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as AgentAction | null) ?? null
}

async function loadActiveGmailAccount(db: PlannerDb, userId: string): Promise<CreatorEmailAccount | null> {
  const { data, error } = await db
    .from('creator_email_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'gmail')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as CreatorEmailAccount | null) ?? null
}

async function loadGmailOutreachThreads(
  db: PlannerDb,
  userId: string,
  threadId?: string
): Promise<GmailOutreachThreadSummary[]> {
  let query = db
    .from('outreach_threads')
    .select('id, plan_id, target_name, target_type, target_email, state, needs_attention, last_event_at, last_inbound_at, last_outbound_at, updated_at, channel_strategy')
    .eq('user_id', userId)
    .eq('target_source', GMAIL_APPROVAL_DEMO_TARGET_SOURCE)
    .order('updated_at', { ascending: false })
    .limit(20)

  if (threadId) query = query.eq('id', threadId)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const threads = (Array.isArray(data) ? data : [])
    .filter((thread) => isGmailApprovedOutreachThread(thread as Record<string, unknown>)) as Array<Record<string, unknown>>
  const ids = threads.map((thread) => String(thread.id))
  if (ids.length === 0) return []

  const { data: messages, error: messageError } = await db
    .from('outreach_messages')
    .select('id, thread_id, direction, subject, body_text, headers_json, gmail_message_id, gmail_thread_id, sent_at, received_at, created_at')
    .in('thread_id', ids)
    .order('created_at', { ascending: true })

  if (messageError) throw new Error(messageError.message)
  const messagesByThread = new Map<string, GmailOutreachMessageSummary[]>()
  for (const message of Array.isArray(messages) ? messages as Array<Record<string, unknown>> : []) {
    const id = String(message.thread_id)
    const headers = readRecord(message.headers_json)
    const from = readString(headers?.from) ?? readString(headers?.From)
    const collection = messagesByThread.get(id) ?? []
    collection.push({
      id: String(message.id),
      direction: String(message.direction ?? 'unknown'),
      subject: String(message.subject ?? '(no subject)'),
      body_text: String(message.body_text ?? ''),
      from,
      gmail_message_id: readString(message.gmail_message_id),
      gmail_thread_id: readString(message.gmail_thread_id),
      sent_at: readString(message.sent_at),
      received_at: readString(message.received_at),
    })
    messagesByThread.set(id, collection)
  }

  return threads.map((thread) => ({
    id: String(thread.id),
    plan_id: String(thread.plan_id),
    target_name: String(thread.target_name ?? 'Venue'),
    target_type: String(thread.target_type ?? 'venue'),
    target_email: readString(thread.target_email),
    state: String(thread.state ?? 'sent'),
    needs_attention: Boolean(thread.needs_attention),
    last_event_at: String(thread.last_event_at ?? thread.updated_at ?? new Date().toISOString()),
    last_inbound_at: readString(thread.last_inbound_at),
    last_outbound_at: readString(thread.last_outbound_at),
    messages: messagesByThread.get(String(thread.id)) ?? [],
  }))
}

async function insertOutreachThread(
  db: PlannerDb,
  input: {
    userId: string
    planId: string
    actionId: string
    target: GmailOutreachTarget
    now: string
  }
) {
  const { data, error } = await db
    .from('outreach_threads')
    .insert({
      user_id: input.userId,
      plan_id: input.planId,
      source_agent_action_id: input.actionId,
      target_name: input.target.name,
      target_type: input.target.kind ?? 'venue',
      target_source: GMAIL_APPROVAL_DEMO_TARGET_SOURCE,
      discovery_venue_id: input.target.discoveryVenueId ?? null,
      discovery_vendor_id: input.target.discoveryVendorId ?? null,
      target_email: input.target.email,
      channel: 'email',
      channel_strategy: {
        source: GMAIL_APPROVED_OUTREACH_KIND,
        approval_required: true,
      } as Json,
      state: 'awaiting_reply',
      needs_attention: false,
      last_event_at: input.now,
      last_outbound_at: input.now,
    })
    .select('id, plan_id, target_name, target_email, state, needs_attention, last_event_at, last_inbound_at, last_outbound_at')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to record Gmail outreach thread')
  return data as { id: string }
}

async function loadOwnedThread(db: PlannerDb, userId: string, threadId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await db
    .from('outreach_threads')
    .select('*')
    .eq('id', threadId)
    .eq('user_id', userId)
    .eq('target_source', GMAIL_APPROVAL_DEMO_TARGET_SOURCE)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null
  return isGmailApprovedOutreachThread(data as Record<string, unknown>) ? data : null
}

function isGmailApprovedOutreachThread(thread: Record<string, unknown>): boolean {
  const strategy = readRecord(thread.channel_strategy)
  return readString(strategy?.source) === GMAIL_APPROVED_OUTREACH_KIND
}

async function loadGmailThreadIdForThread(db: PlannerDb, threadId: string): Promise<string | null> {
  const { data, error } = await db
    .from('outreach_messages')
    .select('gmail_thread_id')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return readString(data?.gmail_thread_id)
}

async function insertMissingGmailMessages(
  readDb: PlannerDb,
  writeDb: PlannerDb,
  thread: Record<string, unknown>,
  messages: ParsedGmailMessage[],
  accountEmail: string
) {
  let inserted = 0
  const threadId = String(thread.id)
  const targetEmail = readString(thread.target_email)

  for (const message of messages) {
    const exists = await gmailMessageExists(readDb, message.gmailMessageId)
    if (exists) continue

    const fromEmail = extractEmail(message.from)
    const isOutbound = fromEmail?.toLowerCase() === accountEmail.toLowerCase()
    const direction = isOutbound ? 'outbound' : 'inbound'
    await writeDb.from('outreach_messages').insert({
      thread_id: threadId,
      direction,
      subject: message.subject,
      body_text: message.bodyText,
      body_html: message.bodyHtml,
      headers_json: message.headers as Json,
      provider_metadata_json: {
        provider: 'gmail',
        sync_source: 'gmail.readonly',
      } as Json,
      attachments_json: [] as Json,
      gmail_message_id: message.gmailMessageId,
      gmail_thread_id: message.gmailThreadId,
      received_at: direction === 'inbound' ? message.receivedAt : null,
      sent_at: direction === 'outbound' ? message.receivedAt : null,
      sent_manually: false,
    })
    inserted += 1

    if (direction === 'inbound') {
      await writeDb
        .from('outreach_threads')
        .update({
          state: 'in_negotiation',
          needs_attention: true,
          last_inbound_at: message.receivedAt,
          last_event_at: message.receivedAt,
          target_email: targetEmail,
        })
        .eq('id', threadId)
    }
  }

  return inserted
}

async function analyzeInboundReplyTerms(
  readDb: PlannerDb,
  writeDb: PlannerDb,
  thread: Record<string, unknown>,
  messages: ParsedGmailMessage[]
) {
  const planId = readString(thread.plan_id)
  const threadId = readString(thread.id)
  const targetName = readString(thread.target_name) ?? 'Partner'
  const targetType = readString(thread.target_type) === 'vendor' ? 'vendor' : 'venue'
  const discoveryVenueId = readUuid(thread.discovery_venue_id)
  const discoveryVendorId = readUuid(thread.discovery_vendor_id)
  const inboundMessages = messages.filter((message) => {
    const fromEmail = extractEmail(message.from)?.toLowerCase()
    const targetEmail = readString(thread.target_email)?.toLowerCase()
    return Boolean(fromEmail && targetEmail && fromEmail === targetEmail)
  })
  const latestInbound = inboundMessages[inboundMessages.length - 1]
  if (!planId || !threadId || !latestInbound) return

  const threadText = messages.map((message) => [
    `From: ${message.from}`,
    `Subject: ${message.subject}`,
    message.bodyText,
  ].join('\n')).join('\n\n---\n\n')
  const gmailThreadId = latestInbound.gmailThreadId

  if (targetType === 'vendor' && discoveryVendorId) {
    const serviceType = await loadDiscoveryVendorServiceType(readDb, discoveryVendorId)
    const terms = await extractReplyTerms({
      entityType: 'vendor',
      entityName: targetName,
      serviceType,
      planTitle: readString(thread.plan_title),
      threadText,
    })

    const row = {
      plan_id: planId,
      discovery_vendor_id: discoveryVendorId,
      outreach_thread_id: threadId,
      gmail_thread_id: gmailThreadId,
      classification: terms.classification,
      classification_confidence: terms.confidence,
      quoted_hourly_cents: terms.quoted_hourly_cents,
      quoted_package_cents: terms.quoted_package_cents,
      quoted_minimum_cents: terms.quoted_minimum_cents,
      quoted_deposit_pct: terms.quoted_deposit_pct,
      availability_confirmed: terms.availability_confirmed,
      conditions: terms.conditions as unknown as Json,
      raw_response_excerpt: terms.raw_response_excerpt,
      model: terms.model,
    }

    const { data, error } = await writeDb
      .from('vendor_outreach_responses')
      .upsert(row, { onConflict: 'plan_id,discovery_vendor_id,gmail_thread_id' })
      .select('*')
      .single()

    if (error) throw new Error(error.message)
    if (terms.confidence >= 0.5) {
      await updatePlanOutreachResponseSummary(readDb, writeDb, {
        planId,
        entityType: 'vendor',
        response: {
          id: readString(data?.id),
          discovery_vendor_id: discoveryVendorId,
          name: targetName,
          service_type: serviceType,
          classification: terms.classification,
          confidence: terms.confidence,
          quoted_hourly_cents: terms.quoted_hourly_cents,
          quoted_package_cents: terms.quoted_package_cents,
          quoted_minimum_cents: terms.quoted_minimum_cents,
          availability_confirmed: terms.availability_confirmed,
          conditions: terms.conditions,
          raw_response_excerpt: terms.raw_response_excerpt,
          updated_at: new Date().toISOString(),
        },
      })
    }
    return
  }

  if (discoveryVenueId) {
    const terms = await extractReplyTerms({
      entityType: 'venue',
      entityName: targetName,
      planTitle: readString(thread.plan_title),
      threadText,
    })

    const row = {
      plan_id: planId,
      discovery_venue_id: discoveryVenueId,
      outreach_thread_id: threadId,
      gmail_thread_id: gmailThreadId,
      classification: terms.classification,
      classification_confidence: terms.confidence,
      quoted_price_cents: terms.quoted_price_cents,
      quoted_deal_model: terms.quoted_deal_model,
      availability_confirmed: terms.availability_confirmed,
      capacity_confirmed: terms.capacity_confirmed,
      conditions: terms.conditions as unknown as Json,
      raw_response_excerpt: terms.raw_response_excerpt,
      model: terms.model,
    }

    const { data, error } = await writeDb
      .from('venue_outreach_responses')
      .upsert(row, { onConflict: 'plan_id,discovery_venue_id,gmail_thread_id' })
      .select('*')
      .single()

    if (error) throw new Error(error.message)
    if (terms.confidence >= 0.5) {
      await updatePlanOutreachResponseSummary(readDb, writeDb, {
        planId,
        entityType: 'venue',
        response: {
          id: readString(data?.id),
          discovery_venue_id: discoveryVenueId,
          name: targetName,
          classification: terms.classification,
          confidence: terms.confidence,
          quoted_price_cents: terms.quoted_price_cents,
          quoted_deal_model: terms.quoted_deal_model,
          availability_confirmed: terms.availability_confirmed,
          capacity_confirmed: terms.capacity_confirmed,
          conditions: terms.conditions,
          raw_response_excerpt: terms.raw_response_excerpt,
          updated_at: new Date().toISOString(),
        },
      })
    }
  }
}

async function loadDiscoveryVendorServiceType(db: PlannerDb, discoveryVendorId: string) {
  const { data } = await db
    .from('discovery_vendors')
    .select('service_type')
    .eq('id', discoveryVendorId)
    .maybeSingle()
  return readString(data?.service_type)
}

async function updatePlanOutreachResponseSummary(
  readDb: PlannerDb,
  writeDb: PlannerDb,
  input: {
    planId: string
    entityType: 'venue' | 'vendor'
    response: Record<string, unknown>
  }
) {
  const { data: plan, error } = await readDb
    .from('plans')
    .select('id,title,metadata')
    .eq('id', input.planId)
    .maybeSingle()

  if (error || !plan) return

  const metadata = readRecord(plan.metadata) ?? {}
  const current = readRecord(metadata.outreach_response_summary) ?? {}
  const key = input.entityType === 'venue' ? 'venues' : 'vendors'
  const existing = Array.isArray(current[key]) ? current[key] as unknown[] : []
  const idKey = input.entityType === 'venue' ? 'discovery_venue_id' : 'discovery_vendor_id'
  const responseId = readString(input.response[idKey])
  const nextResponses = [
    input.response,
    ...existing.filter((item) => {
      const record = readRecord(item)
      return !responseId || readString(record?.[idKey]) !== responseId
    }),
  ].slice(0, 12)

  const nextMetadata = {
    ...metadata,
    outreach_response_summary: {
      ...current,
      [key]: nextResponses,
      updated_at: new Date().toISOString(),
    },
  }

  await writeDb.from('plans').update({ metadata: nextMetadata as Json }).eq('id', input.planId)

  if (isFavorableReply(readString(input.response.classification))) {
    const quoteLabel = formatResponseQuote(input.entityType, input.response)
    await writeDb.from('plan_messages').insert({
      plan_id: input.planId,
      role: 'agent',
      content: `Heard back from ${readString(input.response.name) ?? 'a partner'}${quoteLabel ? ` — ${quoteLabel}` : ''}. I updated the brief so you can compare options before accepting anything.`,
      message_type: 'status_update',
      metadata: {
        kind: 'outreach_response_received',
        entity_type: input.entityType,
        response: input.response,
      } as Json,
    })
  }
}

function isFavorableReply(classification: string | null) {
  return classification === 'yes' || classification === 'quote_received' || classification === 'conditional'
}

function formatResponseQuote(entityType: 'venue' | 'vendor', response: Record<string, unknown>) {
  const cents = entityType === 'venue'
    ? readInteger(response.quoted_price_cents)
    : readInteger(response.quoted_package_cents) ?? readInteger(response.quoted_minimum_cents) ?? readInteger(response.quoted_hourly_cents)
  return cents === null ? null : `${formatCents(cents)} quoted`
}

function formatCents(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

async function gmailMessageExists(db: PlannerDb, gmailMessageId: string) {
  const { data, error } = await db
    .from('outreach_messages')
    .select('id')
    .eq('gmail_message_id', gmailMessageId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return Boolean(data)
}

async function insertAgentActionAuditLog(
  db: PlannerDb,
  payload: {
    actionId: string
    planId: string
    actorId: string
    toStatus: string
    reason: string
  }
) {
  await db.from('agent_action_audit_log').insert({
    action_id: payload.actionId,
    plan_id: payload.planId,
    from_status: null,
    to_status: payload.toStatus,
    actor_id: payload.actorId,
    actor_role: 'user',
    reason: payload.reason,
    metadata: {
      approval_flow: GMAIL_APPROVED_OUTREACH_KIND,
    } as Json,
  })
}

function buildPlannerApprovalUrl(planId: string, messageId: string) {
  return `/planner?plan=${encodeURIComponent(planId)}&tab=approvals&msg=${encodeURIComponent(messageId)}`
}

function normalizeTargets(targets: GmailOutreachTarget[]) {
  const cleaned = targets
    .map((target) => ({
      name: target.name.trim(),
      email: target.email.trim().toLowerCase(),
      kind: target.kind === 'vendor' ? 'vendor' as const : 'venue' as const,
      discoveryVenueId: readUuid(target.discoveryVenueId),
      discoveryVendorId: readUuid(target.discoveryVendorId),
    }))
    .filter((target) => target.name && isValidEmail(target.email))

  if (cleaned.length === 0) throw new Error('Add at least one venue or vendor with a valid email address.')
  if (cleaned.length > 6) throw new Error('Send at most six outreach emails at a time.')
  return cleaned
}

function readTargets(payload: Record<string, unknown> | null): GmailOutreachTarget[] {
  const targets = payload?.targets
  if (!Array.isArray(targets)) return []
  return targets.flatMap((target) => {
    if (!target || typeof target !== 'object' || Array.isArray(target)) return []
    const record = target as Record<string, unknown>
    const name = readString(record.name)
    const email = readString(record.email)
    const kind = readString(record.kind) === 'vendor' ? 'vendor' : 'venue'
    const discoveryVenueId = readUuid(record.discoveryVenueId ?? record.discovery_venue_id)
    const discoveryVendorId = readUuid(record.discoveryVendorId ?? record.discovery_vendor_id)
    return name && email ? [{ name, email, kind, discoveryVenueId, discoveryVendorId }] : []
  })
}

export function renderBodyForTarget(template: string, target: GmailOutreachTarget, senderEmail: string) {
  const replacements: Record<string, string> = {
    venue_name: target.name,
    target_name: target.name,
    place_name: target.name,
    sender_email: senderEmail,
  }

  return template
    .replace(/\{\{\s*(venue_name|target_name|place_name|sender_email)\s*\}\}/gi, (_match, key: string) => {
      return replacements[key.toLowerCase()] ?? ''
    })
    .replace(/\{\{\s*[^}]+\s*\}\}/g, '')
}

function extractEmail(value: string | null) {
  if (!value) return null
  const match = value.match(/<([^>]+)>/)
  return (match?.[1] ?? value).trim()
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function readUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null
}

function countTargetsByKind(targets: GmailOutreachTarget[], kind: 'venue' | 'vendor') {
  return targets.filter((target) => (target.kind ?? 'venue') === kind).length
}

function formatTargetCounts(targets: GmailOutreachTarget[]) {
  const venueCount = countTargetsByKind(targets, 'venue')
  const vendorCount = countTargetsByKind(targets, 'vendor')
  const parts = []
  if (venueCount > 0) parts.push(`${venueCount} venue${venueCount === 1 ? '' : 's'}`)
  if (vendorCount > 0) parts.push(`${vendorCount} vendor${vendorCount === 1 ? '' : 's'}`)
  return parts.length > 0 ? parts.join(' and ') : 'selected partners'
}

function getBatchTargetType(targets: GmailOutreachTarget[]) {
  const venueCount = countTargetsByKind(targets, 'venue')
  const vendorCount = countTargetsByKind(targets, 'vendor')
  if (venueCount > 0 && vendorCount > 0) return 'outreach'
  return vendorCount > 0 ? 'vendor' : 'venue'
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
}

function textToHtml(value: string) {
  return escapeHtml(value).replace(/\n/g, '<br />')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
