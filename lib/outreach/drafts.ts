import 'server-only'

import type { Approval, Json, Plan } from '@/lib/types'

type PlannerDb = { from(table: string): any }

type ApprovedAction = {
  id: string
  payload_json?: unknown
  action_type?: string | null
}

type OutreachTarget = {
  target_type: 'venue' | 'vendor'
  target_id: string
  target_name: string
  target_email: string
}

export type EnsureOutreachThreadsResult = {
  threadIds: string[]
  draftMessageIds: string[]
  skippedTargets: Array<{ targetId: string; reason: string }>
}

const VENUE_TARGET_SELECT = 'id, venue_name, contact_email'
const VENDOR_TARGET_SELECT = 'id, name, contact_email'

/**
 * Creates one draft outreach thread per approved venue/vendor target.
 */
export async function ensureOutreachThreadsForApprovedAction(input: {
  db: PlannerDb
  plan: Plan
  userId: string
  approval: Approval
  action: ApprovedAction
}): Promise<EnsureOutreachThreadsResult> {
  const payload = readRecord(input.action.payload_json) ?? {}
  const [venues, vendors] = await Promise.all([
    loadVenueTargets(input.db, readStringArray(payload.venue_ids)),
    loadVendorTargets(input.db, readStringArray(payload.vendor_ids)),
  ])

  const targets = [...venues, ...vendors]
  const threadIds: string[] = []
  const draftMessageIds: string[] = []
  const skippedTargets: Array<{ targetId: string; reason: string }> = []

  for (const target of targets) {
    if (!target.target_email) {
      skippedTargets.push({ targetId: target.target_id, reason: 'missing_contact_email' })
      continue
    }

    const existing = await loadExistingThread(input.db, input.plan.id, target)
    const thread = existing ?? await createThread(input.db, {
      plan: input.plan,
      userId: input.userId,
      actionId: input.action.id,
      target,
    })

    threadIds.push(String(thread.id))

    const existingDraft = await loadExistingDraft(input.db, String(thread.id), input.action.id)
    const draft = existingDraft ?? await createDraftMessage(input.db, {
      threadId: String(thread.id),
      actionId: input.action.id,
      approvalId: input.approval.id,
      plan: input.plan,
      target,
      summary: readString(payload.summary),
    })

    draftMessageIds.push(String(draft.id))
  }

  return { threadIds, draftMessageIds, skippedTargets }
}

async function loadVenueTargets(db: PlannerDb, venueIds: string[]): Promise<OutreachTarget[]> {
  const ids = uniqueUuidList(venueIds)
  if (ids.length === 0) return []

  const { data, error } = await db
    .from('venues')
    .select(VENUE_TARGET_SELECT)
    .in('id', ids)

  if (error) {
    console.error('[outreach.drafts] Venue target lookup failed', error)
    return []
  }

  return ((data ?? []) as Record<string, unknown>[])
    .map((venue) => ({
      target_type: 'venue' as const,
      target_id: String(venue.id),
      target_name: readString(venue.venue_name) ?? 'Selected venue',
      target_email: readString(venue.contact_email) ?? '',
    }))
}

async function loadVendorTargets(db: PlannerDb, vendorIds: string[]): Promise<OutreachTarget[]> {
  const ids = uniqueUuidList(vendorIds)
  if (ids.length === 0) return []

  const { data, error } = await db
    .from('vendor_profiles')
    .select(VENDOR_TARGET_SELECT)
    .in('id', ids)

  if (error) {
    console.error('[outreach.drafts] Vendor target lookup failed', error)
    return []
  }

  return ((data ?? []) as Record<string, unknown>[])
    .map((vendor) => ({
      target_type: 'vendor' as const,
      target_id: String(vendor.id),
      target_name: readString(vendor.name) ?? 'Selected vendor',
      target_email: readString(vendor.contact_email) ?? '',
    }))
}

async function loadExistingThread(db: PlannerDb, planId: string, target: OutreachTarget) {
  const { data, error } = await db
    .from('outreach_threads')
    .select('*')
    .eq('plan_id', planId)
    .eq('target_type', target.target_type)
    .eq('target_id', target.target_id)
    .neq('state', 'cancelled')
    .maybeSingle()

  if (error) {
    console.error('[outreach.drafts] Existing thread lookup failed', error)
    return null
  }

  return data as Record<string, unknown> | null
}

async function createThread(db: PlannerDb, input: {
  plan: Plan
  userId: string
  actionId: string
  target: OutreachTarget
}) {
  const { data, error } = await db
    .from('outreach_threads')
    .insert({
      plan_id: input.plan.id,
      user_id: input.userId,
      target_type: input.target.target_type,
      target_id: input.target.target_id,
      target_name: input.target.target_name,
      target_email: input.target.target_email,
      channel: 'email',
      state: 'draft',
      source_agent_action_id: input.actionId,
      needs_attention: false,
      last_event_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error || !data) {
    console.error('[outreach.drafts] Thread insert failed', error)
    throw new Error('Failed to create outreach thread')
  }

  return data as Record<string, unknown>
}

async function loadExistingDraft(db: PlannerDb, threadId: string, actionId: string) {
  const { data, error } = await db
    .from('outreach_messages')
    .select('*')
    .eq('thread_id', threadId)
    .eq('agent_action_id', actionId)
    .eq('direction', 'outbound')
    .is('sent_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[outreach.drafts] Existing draft lookup failed', error)
    return null
  }

  return data as Record<string, unknown> | null
}

async function createDraftMessage(db: PlannerDb, input: {
  threadId: string
  actionId: string
  approvalId: string
  plan: Plan
  target: OutreachTarget
  summary: string | null
}) {
  const draft = buildDeterministicDraft(input.plan, input.target, input.summary)
  const { data, error } = await db
    .from('outreach_messages')
    .insert({
      thread_id: input.threadId,
      agent_action_id: input.actionId,
      approval_id: input.approvalId,
      direction: 'outbound',
      subject: draft.subject,
      body_text: draft.bodyText,
      body_html: null,
      headers_json: {
        source: 'approved_agent_action',
        approval_id: input.approvalId,
      } as Json,
    })
    .select('*')
    .single()

  if (error || !data) {
    console.error('[outreach.drafts] Draft insert failed', error)
    throw new Error('Failed to create outreach draft')
  }

  return data as Record<string, unknown>
}

function buildDeterministicDraft(plan: Plan, target: OutreachTarget, summary: string | null) {
  const eventDate = plan.date_window_start ?? plan.date_window_end ?? 'date to be confirmed'
  const headcount = plan.guest_count ? `${plan.guest_count} guests` : 'guest count to be confirmed'
  const budget = plan.budget_cap_cents ? `Budget target: ${formatCents(plan.budget_cap_cents)}.` : null
  const ask = target.target_type === 'venue'
    ? 'availability, pricing, minimums, deposit terms, included services, and any constraints'
    : 'availability, quote, package details, deposit terms, setup needs, and any constraints'

  return {
    subject: `${plan.title} ${target.target_type === 'venue' ? 'availability inquiry' : 'quote request'}`,
    bodyText: [
      `Hi ${target.target_name} team,`,
      `I am planning ${plan.title} for ${headcount} on ${eventDate}.`,
      summary,
      budget,
      `Could you confirm ${ask}?`,
      'Nothing is booked or committed yet. I am checking fit, pricing, and next steps before making a decision.',
      'Thank you.',
    ].filter(Boolean).join('\n\n'),
  }
}

function uniqueUuidList(values: string[]) {
  return Array.from(new Set(values)).filter(isUuid)
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function formatCents(value: number) {
  return `$${Math.round(value / 100).toLocaleString('en-US')}`
}
