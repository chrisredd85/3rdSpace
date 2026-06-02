import 'server-only'

import type { ReplyClassifierOutput } from '@/lib/ai/agents/replyClassifier'
import {
  canActAutonomously,
  createOutreachNotification,
  recordPolicyDecision,
} from '@/lib/outreach/policyGate'
import { sendOutreachDraft } from '@/lib/outreach/send'
import type { Json, OutreachPolicyAction, OutreachThread, Plan } from '@/lib/types'

type OutreachDb = { from(table: string): any }

export async function maybeCreateAutonomousReplyDraft(input: {
  db: OutreachDb
  thread: OutreachThread
  plan: Plan
  inboundMessageId: string
  classification: ReplyClassifierOutput
}) {
  const action = actionForClassification(input.classification)
  if (!action) return { created: false, reason: 'intent_not_autonomous_candidate' as const }

  if (input.thread.channel === 'instagram' || input.thread.channel === 'voice') {
    await notifyRequiresApproval(input.db, input.thread, action, 'channel_requires_creator_review', input.inboundMessageId)
    return { created: false, reason: 'channel_requires_creator_review' as const }
  }

  if (
    input.classification.confidence < 0.8 ||
    input.classification.requires_human_review ||
    input.classification.extracted.required_action_from_creator
  ) {
    await notifyRequiresApproval(input.db, input.thread, action, 'classifier_requires_creator_review', input.inboundMessageId)
    return { created: false, reason: 'classifier_requires_creator_review' as const }
  }

  const priceCents = input.classification.extracted.price_cents
  const gate = await canActAutonomously({
    db: input.db,
    userId: input.thread.user_id,
    action,
    context: {
      planId: input.plan.id,
      threadId: input.thread.id,
      targetId: input.thread.target_id,
      targetName: input.thread.target_name,
      targetType: input.thread.target_type,
      targetSource: input.thread.target_source,
      channel: input.thread.channel,
      priceCents,
      budgetCapCents: input.plan.budget_cap_cents,
      bodyText: input.classification.summary_for_creator,
      moneyMovement: false,
      requiresSignature: false,
      legalCommitment: false,
      modelName: 'reply_classifier',
    },
  })

  if (!gate.allowed) {
    await recordPolicyDecision({
      db: input.db,
      userId: input.thread.user_id,
      action,
      decision: 'pending_approval',
      reason: gate.reason,
      policy: gate.policy,
      context: {
        planId: input.plan.id,
        threadId: input.thread.id,
        channel: input.thread.channel,
        priceCents,
      },
      result: { required_approval_type: gate.required_approval_type ?? 'approval' },
    })
    await notifyRequiresApproval(input.db, input.thread, action, gate.reason, input.inboundMessageId)
    return { created: false, reason: gate.reason }
  }

  const actionRow = await createReplyAction(input.db, input.thread, input.plan, action, input.inboundMessageId)
  const approval = await createReplyApproval(input.db, input.thread, input.plan, actionRow.id)
  const bodyText = buildReplyBody(input.thread, input.classification)
  const { data: message, error: messageError } = await input.db
    .from('outreach_messages')
    .insert({
      thread_id: input.thread.id,
      agent_action_id: actionRow.id,
      approval_id: approval.id,
      direction: 'outbound',
      subject: input.thread.channel === 'email' ? `Re: ${input.plan.title}` : '',
      body_text: bodyText,
      body_html: null,
      headers_json: {
        source: 'autonomous_reply',
        inbound_message_id: input.inboundMessageId,
        classifier_intent: input.classification.intent,
        extracted: input.classification.extracted,
      } as Json,
      autonomy_status: 'pending_approval',
    })
    .select('id')
    .single()

  if (messageError || !message) throw new Error(messageError?.message ?? 'Failed to create autonomous reply draft')

  await sendOutreachDraft({
    db: input.db,
    threadId: input.thread.id,
    draftMessageId: String(message.id),
    userId: input.thread.user_id,
    autonomous: true,
  })

  return { created: true, messageId: String(message.id), action }
}

function actionForClassification(classification: ReplyClassifierOutput): OutreachPolicyAction | null {
  if (classification.intent === 'needs_info') return 'reply_to_needs_info'
  if (classification.intent === 'price_quote') return 'reply_to_price_quote'
  return null
}

async function createReplyAction(
  db: OutreachDb,
  thread: OutreachThread,
  plan: Plan,
  action: OutreachPolicyAction,
  inboundMessageId: string
) {
  const { data, error } = await db
    .from('agent_actions')
    .insert({
      plan_id: plan.id,
      action_type: thread.channel === 'email' ? 'email' : 'vendor_contact',
      description: `Autonomous ${action.replace(/_/g, ' ')} reply to ${thread.target_name}`,
      provider: thread.channel,
      target_type: thread.target_type,
      target_id: thread.target_id,
      payload_json: {
        kind: 'autonomous_reply',
        outreach_thread_id: thread.id,
        inbound_message_id: inboundMessageId,
        action,
      } as Json,
      amount_cents: 0,
      currency: 'usd',
      status: 'pending',
      result_metadata: { source: 'outreach_autonomous_reply' } as Json,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to create autonomous reply action')
  return data as { id: string }
}

async function createReplyApproval(db: OutreachDb, thread: OutreachThread, plan: Plan, actionId: string) {
  const { data, error } = await db
    .from('approvals')
    .insert({
      plan_id: plan.id,
      agent_action_id: actionId,
      action_label: `Approve autonomous reply to ${thread.target_name}`,
      provider: thread.channel,
      event_date: plan.date_window_start,
      price_cents: 0,
      fees_cents: 0,
      package_details: 'Low-stakes autonomous outreach reply.',
      refund_terms: 'No charge is made now. This only authorizes a reply draft.',
      cancellation_terms: 'You can pause or undo autonomous sends within the configured window.',
      delivery_email: thread.target_email,
      requested_amount_cents: 0,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to create autonomous reply approval')
  return data as { id: string }
}

function buildReplyBody(thread: OutreachThread, classification: ReplyClassifierOutput) {
  if (classification.intent === 'price_quote') {
    return [
      `Hi ${thread.target_name} team,`,
      'Thanks for the quote. Could you hold the date while I review the options?',
      'Nothing is confirmed or paid yet; I just want to keep the conversation moving while I compare fit.',
      'Appreciate it.',
    ].join('\n\n')
  }

  return [
    `Hi ${thread.target_name} team,`,
    'Thanks for the quick note. Could you share the missing details on availability, pricing, and any minimums for the event?',
    'Nothing is booked or committed yet.',
    'Thank you.',
  ].join('\n\n')
}

async function notifyRequiresApproval(
  db: OutreachDb,
  thread: OutreachThread,
  action: OutreachPolicyAction,
  reason: string,
  inboundMessageId: string
) {
  await createOutreachNotification({
    db,
    userId: thread.user_id,
    threadId: thread.id,
    notificationType: reason === 'price_above_unattended_budget_cap' ? 'quote_received' : 'requires_approval',
    payload: {
      action,
      reason,
      inbound_message_id: inboundMessageId,
    },
  })
}
