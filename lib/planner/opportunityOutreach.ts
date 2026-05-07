import 'server-only'

import type { OutreachAgentInput, OutreachAgentOutput } from '@/lib/ai/agents/outreachAgent'
import { getAgentRunErrorMetadata } from '@/lib/ai/types'
import { buildEventPlanFromPlannerPlan } from '@/lib/planner/agentPlanAdapter'
import { logAgentRun, type AgentRunDb } from '@/lib/server/agent-runs'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { Json, Plan } from '@/lib/types'

type QueryError = { message: string } | null
type QueryResult = { data: unknown[] | null; error: QueryError }
type SelectQuery = {
  in(column: string, values: string[]): PromiseLike<QueryResult>
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

export async function buildVenueOpportunityOutreach(input: {
  db: PlannerDb
  plan: Plan
  userId: string
  venueIds: string[]
  summary: string
  requirements: Record<string, unknown>
  responseDeadline: string | null
}): Promise<OpportunityOutreachBundle> {
  const targets = await loadVenueTargets(input.db, input.venueIds)
  return buildOpportunityOutreach({
    plan: input.plan,
    userId: input.userId,
    partnerType: 'venue',
    outreachType: 'venue_inquiry',
    targets,
    summary: input.summary,
    requirements: input.requirements,
    responseDeadline: input.responseDeadline,
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
}): Promise<OpportunityOutreachBundle> {
  const eventPlan = buildEventPlanFromPlannerPlan(input.plan)
  const targets = input.targets.length > 0
    ? input.targets
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
    contact_email: readString(row.contact_email),
    phone: readString(row.phone),
    website: readString(row.portfolio_url),
    details: {
      service_type: readString(row.service_type),
      service_area: readString(row.service_area),
    },
  }))
}

function buildDeterministicOutreachDraft(input: {
  plan: Plan
  target: OutreachTarget
  summary: string
  requirements: Record<string, unknown>
  responseDeadline: string | null
}): OutreachAgentOutput & { target_name: string; target_type: PartnerType } {
  const eventDate = input.plan.date_window_start ?? input.plan.date_window_end ?? 'date to be confirmed'
  const headcount = input.plan.guest_count ? `${input.plan.guest_count} guests` : 'guest count to be confirmed'
  const budget = input.plan.budget_cap_cents ? `Budget target: ${formatCents(input.plan.budget_cap_cents)}.` : ''
  const ask = input.target.type === 'venue'
    ? 'availability, pricing, minimums, deposit terms, and what is included'
    : 'availability, quote, package details, deposit terms, and setup needs'

  return {
    target_name: input.target.name,
    target_type: input.target.type,
    subject: `${input.plan.title} ${input.target.type === 'venue' ? 'availability inquiry' : 'vendor quote request'}`,
    message_body: [
      `Hi ${input.target.name} team,`,
      `I am planning ${input.plan.title} for ${headcount} on ${eventDate}.`,
      input.summary,
      budget,
      `Could you confirm ${ask}?`,
      'Nothing is booked or committed yet; this is an approval-pending inquiry draft.',
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
