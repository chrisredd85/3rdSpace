import 'server-only'

import {
  hasContactForChannel,
  selectOutreachChannel,
  type ChannelContactProfile,
  type CreatorEnabledChannels,
} from '@/lib/outreach/channels'
import { buildDiscoveryVenueClaimUrl } from '@/lib/outreach/discoveryClaimTokens'
import { ensureVoiceDisclosure } from '@/lib/outreach/voice'
import type { Approval, Json, Plan } from '@/lib/types'
import type { OutreachChannel } from '@/lib/types'

type PlannerDb = { from(table: string): any }

type ApprovedAction = {
  id: string
  payload_json?: unknown
  action_type?: string | null
}

type OutreachTarget = {
  target_type: 'venue' | 'vendor'
  target_source: 'onboarded' | 'discovery'
  target_id: string
  discovery_venue_id?: string | null
  target_name: string
  target_email: string | null
  target_phone?: string | null
  target_instagram_handle?: string | null
  contact_profile?: ChannelContactProfile | null
  website?: string | null
}

export type EnsureOutreachThreadsResult = {
  threadIds: string[]
  draftMessageIds: string[]
  skippedTargets: Array<{ targetId: string; reason: string }>
}

const VENUE_TARGET_SELECT = 'id, venue_name, contact_email'
const VENDOR_TARGET_SELECT = 'id, name, contact_email'
const DISCOVERY_VENUE_TARGET_SELECT = 'id, name, contact_email, contact_phone, instagram_handle, website'

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
  const discoveryVenues = await loadDiscoveryVenueTargets(input.db, readStringArray(payload.discovery_venue_ids))

  const targets = [...venues, ...discoveryVenues, ...vendors]
  const threadIds: string[] = []
  const draftMessageIds: string[] = []
  const skippedTargets: Array<{ targetId: string; reason: string }> = []

  for (const target of targets) {
    const channel = resolveTargetChannel(payload, target)
    if (!hasContactForChannel(channel, toChannelTarget(target), target.contact_profile)) {
      skippedTargets.push({ targetId: target.target_id, reason: `missing_${channel}_contact` })
      continue
    }

    const existing = await loadExistingThread(input.db, input.plan.id, target, channel)
    const thread = existing ?? await createThread(input.db, {
      plan: input.plan,
      userId: input.userId,
      actionId: input.action.id,
      target,
      channel,
      channelStrategy: buildChannelStrategy(payload, target, channel),
    })

    threadIds.push(String(thread.id))

    const existingDraft = await loadExistingDraft(input.db, String(thread.id), input.action.id)
    const draft = existingDraft ?? await createDraftMessage(input.db, {
      threadId: String(thread.id),
      actionId: input.action.id,
      approvalId: input.approval.id,
      plan: input.plan,
      target,
      channel,
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

  const profiles = await loadVenueContactProfiles(db, 'venue_id', ids)

  return ((data ?? []) as Record<string, unknown>[])
    .map((venue) => ({
      target_type: 'venue' as const,
      target_source: 'onboarded' as const,
      target_id: String(venue.id),
      target_name: readString(venue.venue_name) ?? 'Selected venue',
      target_email: profiles.get(String(venue.id))?.email ?? readString(venue.contact_email),
      target_phone: profiles.get(String(venue.id))?.phone_e164 ?? null,
      target_instagram_handle: profiles.get(String(venue.id))?.instagram_handle ?? null,
      contact_profile: profiles.get(String(venue.id)) ?? null,
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
      target_source: 'onboarded' as const,
      target_id: String(vendor.id),
      target_name: readString(vendor.name) ?? 'Selected vendor',
      target_email: readString(vendor.contact_email),
    }))
}

async function loadDiscoveryVenueTargets(db: PlannerDb, discoveryVenueIds: string[]): Promise<OutreachTarget[]> {
  const ids = uniqueUuidList(discoveryVenueIds)
  if (ids.length === 0) return []

  const { data, error } = await db
    .from('discovery_venues')
    .select(DISCOVERY_VENUE_TARGET_SELECT)
    .in('id', ids)
    .eq('is_claimed', false)

  if (error) {
    console.error('[outreach.drafts] Discovery venue target lookup failed', error)
    return []
  }

  const profiles = await loadVenueContactProfiles(db, 'discovery_venue_id', ids)

  return ((data ?? []) as Record<string, unknown>[])
    .map((venue) => ({
      target_type: 'venue' as const,
      target_source: 'discovery' as const,
      target_id: String(venue.id),
      discovery_venue_id: String(venue.id),
      target_name: readString(venue.name) ?? 'Selected venue',
      target_email: profiles.get(String(venue.id))?.email ?? readString(venue.contact_email),
      target_phone: profiles.get(String(venue.id))?.phone_e164 ?? readString(venue.contact_phone),
      target_instagram_handle: profiles.get(String(venue.id))?.instagram_handle ?? readString(venue.instagram_handle),
      contact_profile: profiles.get(String(venue.id)) ?? null,
      website: readString(venue.website),
    }))
}

async function loadVenueContactProfiles(
  db: PlannerDb,
  column: 'venue_id' | 'discovery_venue_id',
  ids: string[]
) {
  const profiles = new Map<string, ChannelContactProfile>()
  if (ids.length === 0) return profiles

  const { data, error } = await db
    .from('venue_contact_profiles')
    .select('venue_id, discovery_venue_id, email, phone_e164, instagram_handle, preferred_channel, sms_opted_out_at, voice_allowed')
    .in(column, ids)

  if (error) {
    console.error('[outreach.drafts] Venue contact profile lookup failed', error)
    return profiles
  }

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const id = readString(row[column])
    if (!id) continue
    profiles.set(id, {
      email: readString(row.email),
      phone_e164: readString(row.phone_e164),
      instagram_handle: readString(row.instagram_handle),
      preferred_channel: readOutreachChannel(row.preferred_channel),
      sms_opted_out_at: readString(row.sms_opted_out_at),
      voice_allowed: row.voice_allowed === true,
    })
  }

  return profiles
}

async function loadExistingThread(db: PlannerDb, planId: string, target: OutreachTarget, channel: OutreachChannel) {
  const { data, error } = await db
    .from('outreach_threads')
    .select('*')
    .eq('plan_id', planId)
    .eq('target_type', target.target_type)
    .eq('target_source', target.target_source)
    .eq('target_id', target.target_id)
    .eq('channel', channel)
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
  channel: OutreachChannel
  channelStrategy: Json
}) {
  const { data, error } = await db
    .from('outreach_threads')
    .insert({
      plan_id: input.plan.id,
      user_id: input.userId,
      target_type: input.target.target_type,
      target_source: input.target.target_source,
      target_id: input.target.target_id,
      discovery_venue_id: input.target.discovery_venue_id ?? null,
      target_name: input.target.target_name,
      target_email: input.target.target_email,
      target_phone: input.target.target_phone ?? null,
      target_instagram_handle: input.target.target_instagram_handle ?? null,
      channel: input.channel,
      channel_strategy: input.channelStrategy,
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
  channel: OutreachChannel
  summary: string | null
}) {
  const draft = buildDeterministicDraft(input.plan, input.target, input.channel, input.summary)
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

function buildDeterministicDraft(plan: Plan, target: OutreachTarget, channel: OutreachChannel, summary: string | null) {
  const eventDate = plan.date_window_start ?? plan.date_window_end ?? 'date to be confirmed'
  const headcount = plan.guest_count ? `${plan.guest_count} guests` : 'guest count to be confirmed'
  const budget = plan.budget_cap_cents ? `Budget target: ${formatCents(plan.budget_cap_cents)}.` : null
  const claimLink = target.target_source === 'discovery' && target.discovery_venue_id
    ? buildDiscoveryVenueClaimUrl({ discoveryVenueId: target.discovery_venue_id })
    : null
  const ask = target.target_type === 'venue'
    ? 'availability, pricing, minimums, deposit terms, included services, and any constraints'
    : 'availability, quote, package details, deposit terms, setup needs, and any constraints'

  if (channel === 'sms') {
    return {
      subject: '',
      bodyText: [
        `Hi ${target.target_name}, I am planning ${plan.title} for ${headcount} on ${eventDate}.`,
        `Could you confirm availability and rough pricing? Nothing is booked yet.`,
      ].join(' '),
    }
  }

  if (channel === 'instagram') {
    return {
      subject: '',
      bodyText: [
        `Hi ${target.target_name} team - I am planning ${plan.title} for ${headcount} on ${eventDate}.`,
        `Could you share availability and rough pricing?`,
        'Nothing is booked yet; just checking fit before I move forward.',
      ].join('\n\n'),
    }
  }

  if (channel === 'voice') {
    return {
      subject: '',
      bodyText: ensureVoiceDisclosure([
        `I am calling on behalf of the organizer for ${plan.title}.`,
        `They are looking at ${headcount} on ${eventDate}.`,
        `I wanted to check whether the space may be available, get a rough quote or minimum, and ask who should receive the event brief.`,
        'Nothing is booked or committed yet.',
      ].join(' ')),
    }
  }

  return {
    subject: `${plan.title} ${target.target_type === 'venue' ? 'availability inquiry' : 'quote request'}`,
    bodyText: [
      `Hi ${target.target_name} team,`,
      `I am planning ${plan.title} for ${headcount} on ${eventDate}.`,
      summary,
      budget,
      `Could you confirm ${ask}?`,
      'Nothing is booked or committed yet. I am checking fit, pricing, and next steps before making a decision.',
      claimLink ? `If you manage this venue, you can claim the 3rdPlace listing here so future inquiries route directly to you: ${claimLink}` : null,
      'Thank you.',
    ].filter(Boolean).join('\n\n'),
  }
}

function resolveTargetChannel(payload: Record<string, unknown>, target: OutreachTarget): OutreachChannel {
  const requestedChannel = readOutreachChannel(payload.channel)
  const targetChannels = readRecord(payload.target_channels)
  const requestedForTarget = readOutreachChannel(targetChannels?.[target.target_id])
  return selectOutreachChannel({
    contactProfile: target.contact_profile,
    target: toChannelTarget(target),
    requestedChannel: requestedForTarget ?? requestedChannel,
    creatorEnabledChannels: readEnabledChannels(payload.creator_enabled_channels),
  })
}

function buildChannelStrategy(
  payload: Record<string, unknown>,
  target: OutreachTarget,
  channel: OutreachChannel
): Json {
  return {
    selected_channel: channel,
    requested_channel: readOutreachChannel(payload.channel),
    preferred_channel: target.contact_profile?.preferred_channel ?? null,
    source: 'phase4_channel_selection',
    approval_gate: 'creator_required',
  } as Json
}

function toChannelTarget(target: OutreachTarget) {
  return {
    email: target.target_email,
    phone: target.target_phone,
    instagramHandle: target.target_instagram_handle,
  }
}

function readEnabledChannels(value: unknown): CreatorEnabledChannels | undefined {
  const record = readRecord(value)
  if (!record) return undefined
  return {
    email: record.email === true,
    instagram: record.instagram === true,
    sms: record.sms === true,
    voice: record.voice === true,
  }
}

function readOutreachChannel(value: unknown): OutreachChannel | null {
  return value === 'email' || value === 'instagram' || value === 'sms' || value === 'voice'
    ? value
    : null
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
