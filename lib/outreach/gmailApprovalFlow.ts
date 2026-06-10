import 'server-only'

import {
  getUsableGmailAccessToken,
  listGmailThreadMessages,
  modifyGmailThreadLabels,
  sendGmailMessage,
  type ParsedGmailMessage,
} from '@/lib/outreach/gmail'
import { APPROVAL_SELECT_COLUMNS, PLAN_MESSAGE_SELECT_COLUMNS, PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
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
  }
) {
  const account = await loadActiveGmailAccount(db, input.userId)
  if (!account) throw new GmailConnectionRequiredError()

  const targets = normalizeTargets(input.targets)
  const subject = input.subject.trim()
  const bodyText = input.bodyText.trim()
  const plan = await getOrCreateGmailApprovalPlan(db, input.userId)
  const actionPayload = buildActionPayload({
    targets,
    subject,
    bodyText,
    senderEmail: account.email_address,
  })
  const existing = await loadReusableApprovalBundle(db, plan.id)

  if (existing) {
    const { approval, action, messageId } = existing
    const { data: updatedAction } = await db
      .from('agent_actions')
      .update({
        description: buildActionDescription(targets),
        payload_json: actionPayload as Json,
        provider: 'Gmail',
        target_type: 'venue',
        result_metadata: {
          ...(readRecord(action.result_metadata) ?? {}),
          target_count: targets.length,
        } as Json,
      })
      .eq('id', action.id)
      .select(AGENT_ACTION_SELECT_COLUMNS)
      .single()

    const { data: updatedApproval } = await db
      .from('approvals')
      .update(buildApprovalUpdates(targets, subject))
      .eq('id', approval.id)
      .select(APPROVAL_SELECT_COLUMNS)
      .single()

    const finalAction = (updatedAction ?? action) as AgentAction
    const finalApproval = (updatedApproval ?? approval) as Approval
    await updateApprovalMessage(db, messageId, plan, finalAction, finalApproval, actionPayload)

    return {
      plan,
      agentAction: finalAction,
      approval: finalApproval,
      approvalMessageId: messageId,
      redirectUrl: buildPlannerApprovalUrl(plan.id, messageId),
    }
  }

  const { data: agentAction, error: actionError } = await db
    .from('agent_actions')
    .insert({
      plan_id: plan.id,
      action_type: 'email',
      description: buildActionDescription(targets),
      provider: 'Gmail',
      target_type: 'venue',
      target_id: null,
      payload_json: actionPayload as Json,
      amount_cents: 0,
      currency: 'usd',
      status: 'pending',
      result_metadata: {
        target_count: targets.length,
        approval_flow: GMAIL_APPROVED_OUTREACH_KIND,
      } as Json,
    })
    .select(AGENT_ACTION_SELECT_COLUMNS)
    .single()

  if (actionError || !agentAction) throw new Error(actionError?.message ?? 'Failed to create Gmail outreach action')

  await insertAgentActionAuditLog(db, {
    actionId: String(agentAction.id),
    planId: plan.id,
    actorId: input.userId,
    toStatus: String(agentAction.status),
    reason: 'gmail_outreach_approval.created',
  })

  const { data: approval, error: approvalError } = await db
    .from('approvals')
    .insert({
      ...buildApprovalUpdates(targets, subject),
      plan_id: plan.id,
      agent_action_id: agentAction.id,
      status: 'pending',
      requested_amount_cents: 0,
    })
    .select(APPROVAL_SELECT_COLUMNS)
    .single()

  if (approvalError || !approval) throw new Error(approvalError?.message ?? 'Failed to create Gmail outreach approval')

  await db.from('agent_actions').update({ approval_id: approval.id }).eq('id', agentAction.id)

  const { data: message, error: messageError } = await db
    .from('plan_messages')
    .insert({
      plan_id: plan.id,
      role: 'agent',
      content: `Review this Gmail outreach before anything sends. Approving sends ${targets.length} email${targets.length === 1 ? '' : 's'} from your connected Gmail account.`,
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
      bodyHtml: bodyText.replace(/\n/g, '<br />'),
    })

    const thread = await insertOutreachThread(db, {
      userId: input.userId,
      planId: input.plan.id,
      actionId: input.action.id,
      target,
      now,
    })

    await db.from('outreach_messages').insert({
      thread_id: thread.id,
      direction: 'outbound',
      subject,
      body_text: bodyText,
      body_html: bodyText.replace(/\n/g, '<br />'),
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

  await db.from('plan_messages').insert({
    plan_id: input.plan.id,
    role: 'system',
    content: `Sent approved Gmail outreach to ${sent.length} venue${sent.length === 1 ? '' : 's'}. Replies will appear in Outreach.`,
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

  const gmailThreadId = await loadGmailThreadIdForThread(db, input.threadId)
  if (!gmailThreadId) throw new Error('Outreach thread does not have a Gmail thread id yet')

  const accessToken = await getUsableGmailAccessToken({ db, account })
  const messages = await listGmailThreadMessages({ accessToken, gmailThreadId })
  const inserted = await insertMissingGmailMessages(db, thread, messages, account.email_address)
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

  const gmailThreadId = await loadGmailThreadIdForThread(db, input.threadId)
  if (!gmailThreadId) throw new Error('Outreach thread does not have a Gmail thread id yet')

  const accessToken = await getUsableGmailAccessToken({ db, account })
  await modifyGmailThreadLabels({
    accessToken,
    gmailThreadId,
    removeLabelIds: ['UNREAD', 'INBOX'],
  })

  const now = new Date().toISOString()
  await db
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
    'Hi {{venue_name}},',
    '',
    "I'm planning a Bay Area happy hour and wanted to see whether your space is open to hosting community events.",
    '',
    'If you are interested, please reply with available dates, minimum spend, and the best next step.',
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
    gmail_scopes_demonstrated: ['gmail.send', 'gmail.readonly', 'gmail.modify'],
  }
}

function buildActionDescription(targets: GmailOutreachTarget[]) {
  return `Send approved Gmail outreach to ${targets.length} venue${targets.length === 1 ? '' : 's'}`
}

function buildApprovalUpdates(targets: GmailOutreachTarget[], subject: string) {
  return {
    action_label: `Send outreach to ${targets.length} venue${targets.length === 1 ? '' : 's'}`,
    provider: 'Gmail',
    event_date: null,
    price_cents: 0,
    fees_cents: 0,
    refund_terms: 'No booking or payment happens. This approval only sends the reviewed Gmail outreach.',
    cancellation_terms: 'Cancel before approving to prevent outbound email.',
    package_details: `${subject} — ${targets.map((target) => `${target.name} <${target.email}>`).join(', ')}`,
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
  return {
    kind: GMAIL_APPROVED_OUTREACH_KIND,
    venue_ids: [],
    projected_costs_cents: 0,
    requires_user_action: true,
    summary: `Approved Gmail send for ${plan.title}`,
    response_deadline: null,
    queued_invite_count: targets.length,
    invites: targets.map((target) => ({
      venue_response_json: {
        target_name: target.name,
        target_email: target.email,
      },
    })),
    opportunity: {
      title: action.description,
      summary: readString(payload.body_text),
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
    .select('id, plan_id, target_name, target_email, state, needs_attention, last_event_at, last_inbound_at, last_outbound_at, updated_at, channel_strategy')
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
      target_type: 'venue',
      target_source: GMAIL_APPROVAL_DEMO_TARGET_SOURCE,
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
  db: PlannerDb,
  thread: Record<string, unknown>,
  messages: ParsedGmailMessage[],
  accountEmail: string
) {
  let inserted = 0
  const threadId = String(thread.id)
  const targetEmail = readString(thread.target_email)

  for (const message of messages) {
    const exists = await gmailMessageExists(db, message.gmailMessageId)
    if (exists) continue

    const fromEmail = extractEmail(message.from)
    const isOutbound = fromEmail?.toLowerCase() === accountEmail.toLowerCase()
    const direction = isOutbound ? 'outbound' : 'inbound'
    await db.from('outreach_messages').insert({
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
      await db
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
    }))
    .filter((target) => target.name && isValidEmail(target.email))

  if (cleaned.length === 0) throw new Error('Add at least one venue with a valid email address.')
  if (cleaned.length > 3) throw new Error('Send at most three outreach emails at a time.')
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
    return name && email ? [{ name, email }] : []
  })
}

function renderBodyForTarget(template: string, target: GmailOutreachTarget, senderEmail: string) {
  return template
    .replace(/\{\{\s*venue_name\s*\}\}/gi, target.name)
    .replace(/\{\{\s*sender_email\s*\}\}/gi, senderEmail)
}

function extractEmail(value: string | null) {
  if (!value) return null
  const match = value.match(/<([^>]+)>/)
  return (match?.[1] ?? value).trim()
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
