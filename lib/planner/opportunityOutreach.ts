import 'server-only'

import type { OutreachAgentInput, OutreachAgentOutput } from '@/lib/ai/agents/outreachAgent'
import { getAgentRunErrorMetadata } from '@/lib/ai/types'
import { buildEventPlanFromPlannerPlan } from '@/lib/planner/agentPlanAdapter'
import { getVenueComplianceStatus } from '@/lib/planner/venueComplianceGate'
import { logAgentRun, type AgentRunDb } from '@/lib/server/agent-runs'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { Json, Plan } from '@/lib/types'

type QueryError = { message: string } | null
type QueryResult = { data: unknown[] | null; error: QueryError }
type SelectQuery = {
  eq(column: string, value: unknown): SelectQuery
  in(column: string, values: string[]): SelectQuery
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2>
}
type PlannerDb = {
  from(table: string): {
    select(columns: string): SelectQuery
  }
}

type PartnerType = 'venue' | 'vendor'

type OutreachTarget = {
  id: string
  name: string
  type: PartnerType
  source?: 'onboarded' | 'discovery'
  contact_email: string | null
  phone: string | null
  website: string | null
  details: Record<string, unknown>
}

export type OpportunityOutreachBundle = {
  approvalStatus: 'pending'
  outreachMessage: Json
  requirements: Record<string, unknown>
}

const VENUE_OUTREACH_SELECT = `
  id,
  venue_name,
  contact_email,
  city,
  state,
  venue_type,
  standing_capacity
`

const DISCOVERY_VENUE_OUTREACH_SELECT = `
  id,
  name,
  contact_email,
  contact_phone,
  website,
  neighborhood,
  city,
  state,
  capacity_seated,
  capacity_standing,
  capacity_cocktail,
  vibe_tags,
  price_hint_cents_low,
  price_hint_cents_high
`

const VENDOR_OUTREACH_SELECT = `
  id,
  name,
  contact_email,
  phone,
  portfolio_url,
  service_type,
  service_area
`

const OUTREACH_AGENT_NAME = 'outreach'
const OUTREACH_AGENT_MODEL = 'gpt-4o'

export class OutreachApprovalRequiredError extends Error {
  constructor() {
    super('Approved outreach approval is required before generating partner outreach.')
    this.name = 'OutreachApprovalRequiredError'
  }
}

export async function buildVenueOpportunityOutreach(input: {
  db: PlannerDb
  plan: Plan
  userId: string
  venueIds: string[]
  discoveryVenueIds?: string[]
  summary: string
  requirements: Record<string, unknown>
  responseDeadline: string | null
}): Promise<OpportunityOutreachBundle> {
  const discoveryVenueIds = input.discoveryVenueIds ?? []
  await assertApprovedOutreachGate({
    db: input.db,
    planId: input.plan.id,
    venueIds: input.venueIds,
    discoveryVenueIds,
    vendorIds: [],
  })
  const [onboardedTargets, discoveryTargets] = await Promise.all([
    loadVenueTargets(input.db, input.venueIds),
    loadDiscoveryVenueTargets(input.db, discoveryVenueIds),
  ])
  const compliantTargets = await filterCompliantVenueOutreachTargets(onboardedTargets)
  return buildOpportunityOutreach({
    plan: input.plan,
    userId: input.userId,
    partnerType: 'venue',
    outreachType: 'venue_inquiry',
    targets: [...compliantTargets, ...discoveryTargets],
    summary: input.summary,
    requirements: input.requirements,
    responseDeadline: input.responseDeadline,
    allowFallbackTarget: false,
  })
}

export async function buildVendorOpportunityOutreach(input: {
  db: PlannerDb
  plan: Plan
  userId: string
  vendorIds: string[]
  packageType: string
  summary: string
  requirements: Record<string, unknown>
  responseDeadline: string | null
}): Promise<OpportunityOutreachBundle> {
  await assertApprovedOutreachGate({
    db: input.db,
    planId: input.plan.id,
    venueIds: [],
    vendorIds: input.vendorIds,
  })
  const targets = await loadVendorTargets(input.db, input.vendorIds)
  return buildOpportunityOutreach({
    plan: input.plan,
    userId: input.userId,
    partnerType: 'vendor',
    outreachType: 'vendor_inquiry',
    targets,
    summary: input.summary,
    requirements: {
      ...input.requirements,
      package_type: input.packageType,
    },
    responseDeadline: input.responseDeadline,
  })
}

async function buildOpportunityOutreach(input: {
  plan: Plan
  userId: string
  partnerType: PartnerType
  outreachType: 'venue_inquiry' | 'vendor_inquiry'
  targets: OutreachTarget[]
  summary: string
  requirements: Record<string, unknown>
  responseDeadline: string | null
  allowFallbackTarget?: boolean
}): Promise<OpportunityOutreachBundle> {
  const eventPlan = buildEventPlanFromPlannerPlan(input.plan)
  const targets = input.targets.length > 0
    ? input.targets
    : input.allowFallbackTarget === false
      ? []
      : [buildFallbackTarget(input.partnerType)]
  const drafts = hasOpenAIKey()
    ? await Promise.all(targets.map((target) => runLoggedOutreachAgent({
      userId: input.userId,
      planId: input.plan.id,
      payload: {
        event_plan: eventPlan,
        target_partner: {
          name: target.name,
          type: target.type,
          contact_email: target.contact_email,
          phone: target.phone,
          website: target.website,
          contact_info: target.details,
        },
        outreach_type: input.outreachType,
        organizer_preferences: {
          summary: input.summary,
          requirements: input.requirements,
          budget_cap_cents: input.plan.budget_cap_cents,
          guest_count: input.plan.guest_count,
          neighborhood: input.plan.neighborhood,
          response_deadline: input.responseDeadline,
          ...readSenderPreferences(input.plan.metadata),
        },
        previous_thread_summary: input.summary,
      },
    })))
    : targets.map((target) => buildDeterministicOutreachDraft({
      plan: input.plan,
      target,
      summary: input.summary,
      requirements: input.requirements,
      responseDeadline: input.responseDeadline,
    }))

  const outreachMessage = toJson({
    approval_status: 'pending',
    source: hasOpenAIKey() ? 'outreach_agent' : 'deterministic_fallback',
    drafts,
  })

  return {
    approvalStatus: 'pending',
    outreachMessage,
    requirements: {
      ...input.requirements,
      approval_status: 'pending',
      outreach_drafts: drafts,
    },
  }
}

async function assertApprovedOutreachGate(input: {
  db: PlannerDb
  planId: string
  venueIds: string[]
  discoveryVenueIds?: string[]
  vendorIds: string[]
}) {
  const targetVenueIds = new Set(input.venueIds)
  const targetDiscoveryVenueIds = new Set(input.discoveryVenueIds ?? [])
  const targetVendorIds = new Set(input.vendorIds)
  const { data: actionRows, error: actionError } = await input.db
    .from('agent_actions')
    .select('id, action_type, payload_json')
    .eq('plan_id', input.planId)
    .in('action_type', ['opportunity_send_venues', 'opportunity_send_vendors'])

  if (actionError) {
    console.error('[agent.run] Outreach approval action lookup failed', actionError)
    throw new OutreachApprovalRequiredError()
  }

  const actions = Array.isArray(actionRows)
    ? actionRows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object' && !Array.isArray(row)))
    : []
  const matchingActionIds = actions
    .filter((action) => actionCoversTargets(action, targetVenueIds, targetDiscoveryVenueIds, targetVendorIds))
    .map((action) => typeof action.id === 'string' ? action.id : null)
    .filter((id): id is string => Boolean(id))

  if (matchingActionIds.length === 0) throw new OutreachApprovalRequiredError()

  const { data: approvalRows, error: approvalError } = await input.db
    .from('approvals')
    .select('id, status, agent_action_id')
    .in('agent_action_id', matchingActionIds)
    .in('status', ['approved', 'authorized'])

  if (approvalError) {
    console.error('[agent.run] Outreach approval lookup failed', approvalError)
    throw new OutreachApprovalRequiredError()
  }

  if (!Array.isArray(approvalRows) || approvalRows.length === 0) {
    throw new OutreachApprovalRequiredError()
  }
}

function actionCoversTargets(
  action: Record<string, unknown>,
  venueIds: Set<string>,
  discoveryVenueIds: Set<string>,
  vendorIds: Set<string>
): boolean {
  const payload = action.payload_json
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const record = payload as Record<string, unknown>
  const actionVenueIds = new Set(readStringArray(record.venue_ids))
  const actionDiscoveryVenueIds = new Set(readStringArray(record.discovery_venue_ids))
  const actionVendorIds = new Set(readStringArray(record.vendor_ids))
  const coversVenues = venueIds.size === 0 || Array.from(venueIds).every((id) => actionVenueIds.has(id))
  const coversDiscoveryVenues =
    discoveryVenueIds.size === 0 ||
    Array.from(discoveryVenueIds).every((id) => actionDiscoveryVenueIds.has(id))
  const coversVendors = vendorIds.size === 0 || Array.from(vendorIds).every((id) => actionVendorIds.has(id))
  return coversVenues && coversDiscoveryVenues && coversVendors
}

async function runLoggedOutreachAgent(input: {
  userId: string
  planId: string
  payload: OutreachAgentInput
}): Promise<OutreachAgentOutput & { target_name: string; target_type: PartnerType }> {
  const startedAt = Date.now()

  try {
    const { runOutreachAgent } = await import('@/lib/ai/agents/outreachAgent')
    const result = await runOutreachAgent(input.payload)
    await safeLogAgentRun({
      userId: input.userId,
      planId: input.planId,
      status: result.status,
      inputPayload: input.payload,
      outputPayload: result.output,
      durationMs: result.duration_ms,
      model: result.model,
      promptTokens: result.prompt_tokens,
      completionTokens: result.completion_tokens,
      messagesPayload: result.messages_payload,
      rawModelOutput: result.raw_model_output,
    })
    return {
      ...result.output,
      target_name: input.payload.target_partner.name,
      target_type: input.payload.target_partner.type as PartnerType,
    }
  } catch (error) {
    const metadata = getAgentRunErrorMetadata(error)
    await safeLogAgentRun({
      userId: input.userId,
      planId: input.planId,
      status: 'failed',
      inputPayload: input.payload,
      outputPayload: null,
      error: error instanceof Error ? error.message : 'Unknown outreach agent error',
      durationMs: Date.now() - startedAt,
      model: metadata.model ?? OUTREACH_AGENT_MODEL,
      promptTokens: metadata.prompt_tokens ?? null,
      completionTokens: metadata.completion_tokens ?? null,
      messagesPayload: metadata.messages_payload ?? null,
      rawModelOutput: metadata.raw_model_output ?? null,
    })
    throw error
  }
}

async function safeLogAgentRun(input: {
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
}) {
  try {
    const admin = createServiceRoleClient() as unknown as AgentRunDb
    await logAgentRun(admin, {
      userId: input.userId,
      planId: input.planId,
      agentName: OUTREACH_AGENT_NAME,
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
    console.error('[agent.run] Failed to log outreach agent run', error)
  }
}

async function loadVenueTargets(db: PlannerDb, venueIds: string[]): Promise<OutreachTarget[]> {
  const ids = Array.from(new Set(venueIds))
  if (ids.length === 0) return []

  const { data, error } = await db
    .from('venues')
    .select(VENUE_OUTREACH_SELECT)
    .in('id', ids)

  if (error) {
    console.error('[agent.run] Venue outreach target lookup failed', error)
    return ids.map((id) => ({ ...buildFallbackTarget('venue'), id }))
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: readString(row.id) ?? 'unknown-venue',
    name: readString(row.venue_name) ?? 'Selected venue',
    type: 'venue',
    source: 'onboarded',
    contact_email: readString(row.contact_email),
    phone: null,
    website: null,
    details: {
      city: readString(row.city),
      state: readString(row.state),
      venue_type: readString(row.venue_type),
      standing_capacity: readNumber(row.standing_capacity),
    },
  }))
}

async function loadDiscoveryVenueTargets(db: PlannerDb, discoveryVenueIds: string[]): Promise<OutreachTarget[]> {
  const ids = Array.from(new Set(discoveryVenueIds))
  if (ids.length === 0) return []

  const { data, error } = await db
    .from('discovery_venues')
    .select(DISCOVERY_VENUE_OUTREACH_SELECT)
    .in('id', ids)
    .eq('is_claimed', false)

  if (error) {
    console.error('[agent.run] Discovery venue outreach target lookup failed', error)
    return ids.map((id) => ({
      ...buildFallbackTarget('venue'),
      id,
      source: 'discovery',
      details: { target_source: 'discovery' },
    }))
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: readString(row.id) ?? 'unknown-discovery-venue',
    name: readString(row.name) ?? 'Selected venue',
    type: 'venue',
    source: 'discovery',
    contact_email: readString(row.contact_email),
    phone: readString(row.contact_phone),
    website: readString(row.website),
    details: {
      target_source: 'discovery',
      discovery_venue_id: readString(row.id),
      neighborhood: readString(row.neighborhood),
      city: readString(row.city),
      state: readString(row.state),
      capacity_seated: readNumber(row.capacity_seated),
      capacity_standing: readNumber(row.capacity_standing),
      capacity_cocktail: readNumber(row.capacity_cocktail),
      vibe_tags: readStringArray(row.vibe_tags),
      price_hint_cents_low: readNumber(row.price_hint_cents_low),
      price_hint_cents_high: readNumber(row.price_hint_cents_high),
    },
  }))
}

async function loadVendorTargets(db: PlannerDb, vendorIds: string[]): Promise<OutreachTarget[]> {
  const ids = Array.from(new Set(vendorIds))
  if (ids.length === 0) return []

  const { data, error } = await db
    .from('vendor_profiles')
    .select(VENDOR_OUTREACH_SELECT)
    .in('id', ids)

  if (error) {
    console.error('[agent.run] Vendor outreach target lookup failed', error)
    return ids.map((id) => ({ ...buildFallbackTarget('vendor'), id }))
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: readString(row.id) ?? 'unknown-vendor',
    name: readString(row.name) ?? 'Selected vendor',
    type: 'vendor',
    source: 'onboarded',
    contact_email: readString(row.contact_email),
    phone: readString(row.phone),
    website: readString(row.portfolio_url),
    details: {
      service_type: readString(row.service_type),
      service_area: readString(row.service_area),
    },
  }))
}

async function filterCompliantVenueOutreachTargets(targets: OutreachTarget[]) {
  if (targets.length === 0) return targets

  const admin = createServiceRoleClient()
  const checked = await Promise.all(targets.map(async (target) => {
    try {
      const status = await getVenueComplianceStatus(admin as any, target.id)
      if (!status.is_compliant) {
        console.warn('[agent.run] Skipping non-compliant venue outreach draft', {
          venue_id: target.id,
          reason: status.reason,
        })
        return null
      }
      return target
    } catch (error) {
      console.error('[agent.run] Venue compliance check failed for outreach draft', {
        venue_id: target.id,
        error,
      })
      return target
    }
  }))

  return checked.filter((target): target is OutreachTarget => target !== null)
}

function buildDeterministicOutreachDraft(input: {
  plan: Plan
  target: OutreachTarget
  summary: string
  requirements: Record<string, unknown>
  responseDeadline: string | null
}): OutreachAgentOutput & { target_name: string; target_type: PartnerType } {
  const eventDateRaw = input.plan.date_window_start ?? input.plan.date_window_end
  const eventDate = eventDateRaw ?? 'date to be confirmed'
  const headcount = input.plan.guest_count ? `${input.plan.guest_count} guests` : 'guest count to be confirmed'
  const budget = input.plan.budget_cap_cents ? `Budget target: ${formatCents(input.plan.budget_cap_cents)}.` : ''
  const ask = input.target.type === 'venue'
    ? 'availability, pricing, minimums, deposit terms, and what is included'
    : 'availability, quote, package details, deposit terms, and setup needs'

  const senderPrefs = readSenderPreferences(input.plan.metadata)
  const identity = senderPrefs.sender_identity ?? senderPrefs.creator_display_name ?? null
  const signOffName = senderPrefs.creator_display_name ?? null

  return {
    target_name: input.target.name,
    target_type: input.target.type,
    subject: buildDeterministicSubject({
      eventDateIso: eventDateRaw,
      guestCount: input.plan.guest_count,
      eventType: input.plan.event_type,
      planTitle: input.plan.title,
      identity,
      budgetCents: input.plan.budget_cap_cents,
      budgetInSubject: Boolean(senderPrefs.budget_signal_in_subject),
      targetType: input.target.type,
    }),
    message_body: [
      `Hi ${input.target.name} team,`,
      `I am planning ${input.plan.title} for ${headcount} on ${eventDate}.`,
      input.summary,
      budget,
      `Could you confirm ${ask}?`,
      'Nothing is booked or committed yet; this is an approval-pending inquiry draft.',
      signOffName ? `Thanks,\n${signOffName}` : 'Thanks',
    ].filter(Boolean).join('\n\n'),
    requested_info: [
      'Availability for the requested date or window',
      'Pricing, minimums, and deposit terms',
      'Included services and exclusions',
    ],
    follow_up_date_suggestion: input.responseDeadline,
    tone: 'professional',
    approval_required: true,
  }
}

type SenderPreferences = {
  sender_identity?: string
  creator_display_name?: string
  budget_signal_in_subject?: boolean
}

function readSenderPreferences(metadata: unknown): SenderPreferences {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  const record = metadata as Record<string, unknown>
  const prefs: SenderPreferences = {}
  const senderIdentity = readString(record.sender_identity)
  if (senderIdentity) prefs.sender_identity = senderIdentity
  const creatorDisplayName = readString(record.creator_display_name)
  if (creatorDisplayName) prefs.creator_display_name = creatorDisplayName
  if (typeof record.budget_signal_in_subject === 'boolean') {
    prefs.budget_signal_in_subject = record.budget_signal_in_subject
  }
  return prefs
}

const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatEventDateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim())
  if (!match) return null
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isFinite(month) || !Number.isFinite(day) || month < 1 || month > 12) return null
  return `${MONTH_ABBREVIATIONS[month - 1]} ${day}`
}

function formatBudgetSegment(cents: number | null | undefined): string | null {
  if (!cents || cents <= 0) return null
  const thousands = Math.round(cents / 100000)
  if (thousands <= 0) return null
  return `$${thousands}K range`
}

function buildDeterministicSubject(input: {
  eventDateIso: string | null | undefined
  guestCount: number | null
  eventType: string | null
  planTitle: string
  identity: string | null
  budgetCents: number | null
  budgetInSubject: boolean
  targetType: PartnerType
}): string {
  const dateLabel = formatEventDateLabel(input.eventDateIso)
  const headcountLabel = input.guestCount ? `${input.guestCount}-person` : null
  const eventTypeLabel = input.eventType?.trim() || (input.targetType === 'venue' ? 'event' : 'vendor request')
  const budgetSegment = input.budgetInSubject ? formatBudgetSegment(input.budgetCents) : null

  if (dateLabel) {
    const middle = [headcountLabel, eventTypeLabel].filter(Boolean).join(' ')
    const middleWithBudget = budgetSegment ? `${middle}, ${budgetSegment}` : middle
    const segments = [dateLabel, middleWithBudget, input.identity].filter((segment): segment is string => Boolean(segment && segment.trim().length > 0))
    return segments.join(' — ')
  }

  const fallbackMiddle = [headcountLabel, eventTypeLabel].filter(Boolean).join(' ') || input.planTitle
  const segments = [fallbackMiddle, input.identity].filter((segment): segment is string => Boolean(segment && segment.trim().length > 0))
  return segments.join(' — ')
}

function buildFallbackTarget(type: PartnerType): OutreachTarget {
  return {
    id: `unknown-${type}`,
    name: type === 'venue' ? 'Selected venue' : 'Selected vendor',
    type,
    contact_email: null,
    phone: null,
    website: null,
    details: {},
  }
}

function hasOpenAIKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim())
}

function formatCents(value: number): string {
  return `$${Math.round(value / 100).toLocaleString('en-US')}`
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,]/g, ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toJson(value: Record<string, unknown>): Json {
  return value as Json
}
