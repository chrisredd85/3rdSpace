import 'server-only'

import { z } from 'zod'
import type { WorkspaceAgentInput, WorkspaceAgentOutput } from '@/lib/ai/agents/workspaceAgent'
import type { TimelineAgentInput, TimelineAgentOutput } from '@/lib/ai/agents/timelineAgent'
import { getAgentRunErrorMetadata } from '@/lib/ai/types'
import { buildEventPlanFromPlannerPlan, getPlannerPlanEventDate } from '@/lib/planner/agentPlanAdapter'
import { logAgentRun, type AgentRunDb } from '@/lib/server/agent-runs'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { Json, Plan } from '@/lib/types'
import { generateMilestoneTemplate, milestoneTemplateOutputSchema } from '@/lib/events/milestoneTemplates'

type QueryError = { message: string } | null
type QueryResult<T> = { data: T | null; error: QueryError }
type QueryBuilder<T = Record<string, unknown>[]> = PromiseLike<QueryResult<T>> & {
  select(columns: string): QueryBuilder<T>
  update(payload: Record<string, unknown>): QueryBuilder<T>
  eq(column: string, value: unknown): QueryBuilder<T>
  in(column: string, values: string[]): QueryBuilder<T>
  order(column: string, options?: { ascending?: boolean }): QueryBuilder<T>
  maybeSingle(): Promise<QueryResult<Record<string, unknown>>>
}
type PlannerDb = {
  from(table: string): QueryBuilder
}

const workspaceAgentOutputSchema = z.object({
  workspace_summary: z.string().trim().min(1),
  current_status: z.enum(['on_track', 'at_risk', 'blocked']),
  blockers: z.array(z.string().trim().min(1)),
  overdue_items: z.array(z.string().trim().min(1)),
  recommended_next_actions: z.array(z.string().trim().min(1)),
  approvals_needed: z.array(z.string().trim().min(1)),
})

export type PlanAgentFields = {
  plan: Plan
  workspace_summary: WorkspaceAgentOutput | null
  timeline: TimelineAgentOutput | null
}

export async function loadPlanAgentFields(input: {
  db: PlannerDb
  plan: Plan
  userId: string
}): Promise<PlanAgentFields> {
  const metadata = readRecord(input.plan.metadata) ?? {}
  const eventId = readString(metadata.event_id) ?? input.plan.id
  const [tasks, venueBookings, vendorBookings, budgetSummary] = await Promise.all([
    loadEventTasks(input.db, eventId),
    loadVenueBookings(input.db, eventId),
    loadVendorBookings(input.db, eventId),
    loadBudgetSummary(input.db, eventId),
  ])
  const confirmedVenueBookings = venueBookings.filter((booking) => isConfirmedStatus(booking.status))
  const confirmedVendorBookings = vendorBookings.filter((booking) => isConfirmedStatus(booking.status))
  const venueRequirements = await loadVenueRequirements(
    input.db,
    confirmedVenueBookings.map((booking) => booking.venue_id)
  )
  const eventPlan = buildEventPlanFromPlannerPlan(input.plan)
  const workspaceInput: WorkspaceAgentInput = {
    event_plan: eventPlan,
    tasks,
    venue_bookings: venueBookings,
    vendor_bookings: vendorBookings,
    budget_summary: budgetSummary,
    timeline: [],
  }
  const eventDate = getPlannerPlanEventDate(input.plan)
  const timelineInput: TimelineAgentInput | null = eventDate
    ? {
      event_plan: eventPlan,
      event_date: eventDate,
      confirmed_venue_bookings: confirmedVenueBookings,
      confirmed_vendor_bookings: confirmedVendorBookings,
      venue_requirements: venueRequirements,
    }
    : null
  const agentCache = readRecord(metadata.agent_cache) ?? {}
  const workspaceCacheKey = buildCacheKey({
    event_id: eventId,
    plan_updated_at: input.plan.updated_at,
    tasks,
    venue_bookings: venueBookings,
    vendor_bookings: vendorBookings,
    budget_summary: budgetSummary,
  })
  const cachedWorkspace = readCachedOutput(
    readRecord(agentCache.workspace_summary),
    workspaceCacheKey,
    workspaceAgentOutputSchema
  )
  const workspaceSummary = cachedWorkspace ?? buildDeterministicWorkspaceOutput(workspaceInput)

  const timelineCacheKey = timelineInput
    ? buildCacheKey({
      plan_updated_at: input.plan.updated_at,
      event_id: eventId,
      event_date: eventDate,
      confirmed_venue_bookings: confirmedVenueBookings,
      confirmed_vendor_bookings: confirmedVendorBookings,
      venue_requirements: venueRequirements,
    })
    : null
  const cachedTimeline = timelineCacheKey
    ? readCachedOutput(readRecord(agentCache.timeline), timelineCacheKey, milestoneTemplateOutputSchema)
    : null
  const timeline = timelineInput
    ? cachedTimeline ?? generateMilestoneTemplate(timelineInput)
    : null
  const nextAgentCache = {
    ...agentCache,
    workspace_summary: {
      cache_key: workspaceCacheKey,
      generated_at: new Date().toISOString(),
      output: workspaceSummary,
    },
    ...(timeline && timelineCacheKey ? {
      timeline: {
        cache_key: timelineCacheKey,
        generated_at: new Date().toISOString(),
        output: timeline,
      },
    } : {}),
  }
  const nextMetadata = {
    ...metadata,
    agent_cache: nextAgentCache,
  }

  if (!cachedWorkspace || (timelineInput && !cachedTimeline)) {
    await updatePlanMetadata(input.db, input.plan.id, input.userId, nextMetadata)
  }

  return {
    plan: {
      ...input.plan,
      metadata: nextMetadata as Json,
    },
    workspace_summary: workspaceSummary,
    timeline,
  }
}

async function generateWorkspaceSummary(input: {
  userId: string
  planId: string
  payload: WorkspaceAgentInput
}): Promise<WorkspaceAgentOutput> {
  if (!hasOpenAIKey()) return buildDeterministicWorkspaceOutput(input.payload)

  const startedAt = Date.now()
  try {
    const { runWorkspaceAgent, workspaceAgentDefinition } = await import('@/lib/ai/agents/workspaceAgent')
    const result = await runWorkspaceAgent(input.payload)
    await safeLogAgentRun({
      userId: input.userId,
      planId: input.planId,
      agentName: workspaceAgentDefinition.agentName,
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
    return result.output
  } catch (error) {
    const metadata = getAgentRunErrorMetadata(error)
    await safeLogAgentRun({
      userId: input.userId,
      planId: input.planId,
      agentName: 'workspace',
      status: 'failed',
      inputPayload: input.payload,
      outputPayload: null,
      error: error instanceof Error ? error.message : 'Unknown workspace agent error',
      durationMs: Date.now() - startedAt,
      model: metadata.model ?? 'gpt-4o-mini',
      promptTokens: metadata.prompt_tokens ?? null,
      completionTokens: metadata.completion_tokens ?? null,
      messagesPayload: metadata.messages_payload ?? null,
      rawModelOutput: metadata.raw_model_output ?? null,
    })
    throw error
  }
}

async function generateTimeline(input: {
  userId: string
  planId: string
  payload: TimelineAgentInput
}): Promise<TimelineAgentOutput> {
  if (!hasOpenAIKey()) return generateMilestoneTemplate(input.payload)

  const startedAt = Date.now()
  try {
    const { runTimelineAgent, timelineAgentDefinition } = await import('@/lib/ai/agents/timelineAgent')
    const result = await runTimelineAgent(input.payload)
    await safeLogAgentRun({
      userId: input.userId,
      planId: input.planId,
      agentName: timelineAgentDefinition.agentName,
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
    return result.output
  } catch (error) {
    const metadata = getAgentRunErrorMetadata(error)
    await safeLogAgentRun({
      userId: input.userId,
      planId: input.planId,
      agentName: 'timeline',
      status: 'failed',
      inputPayload: input.payload,
      outputPayload: null,
      error: error instanceof Error ? error.message : 'Unknown timeline agent error',
      durationMs: Date.now() - startedAt,
      model: metadata.model ?? 'gpt-4o-mini',
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
  agentName: 'workspace' | 'timeline'
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
      agentName: input.agentName,
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
    console.error('[agent.run] Failed to log planner summary agent run', error)
  }
}

function buildDeterministicWorkspaceOutput(payload: WorkspaceAgentInput): WorkspaceAgentOutput {
  const overdueItems = payload.tasks
    .filter((task) => task.due_date && !isClosedStatus(task.status) && isPastDate(task.due_date))
    .map((task) => task.title)
  const blockers: string[] = []
  const recommendedNextActions: string[] = []
  const approvalsNeeded: string[] = []

  payload.tasks.forEach((task) => {
    const title = task.title.toLowerCase()
    const isOpen = !isClosedStatus(task.status)

    if (isOpen && title.includes('contract')) {
      blockers.push(`Unsigned contract task still open: ${task.title}.`)
      recommendedNextActions.push(`Resolve contract task: ${task.title}.`)
      approvalsNeeded.push(`Review and approve contract terms for: ${task.title}.`)
    }

    if (isOpen && title.includes('deposit')) {
      blockers.push(`Deposit task still open: ${task.title}.`)
      recommendedNextActions.push(`Resolve deposit task: ${task.title}.`)
      approvalsNeeded.push(`Approve deposit handling for: ${task.title}.`)
    }
  })

  payload.venue_bookings.forEach((booking) => {
    if (!isConfirmedStatus(booking.status)) {
      blockers.push(`Venue booking ${booking.id} is missing venue confirmation.`)
      recommendedNextActions.push(`Follow up on venue booking ${booking.id} for confirmation and terms.`)
    }
  })

  payload.vendor_bookings.forEach((booking) => {
    if (booking.quoted_price === null) {
      blockers.push(`Vendor booking ${booking.id} is missing a quoted price.`)
      recommendedNextActions.push(`Request a quote for vendor booking ${booking.id}.`)
    }

    if (!isConfirmedStatus(booking.status)) {
      recommendedNextActions.push(`Follow up on vendor booking ${booking.id} for status confirmation.`)
    } else {
      approvalsNeeded.push(`Approve confirmed vendor terms for booking ${booking.id}.`)
    }
  })

  if (payload.budget_summary?.profit_margin !== null && payload.budget_summary?.profit_margin !== undefined) {
    if (payload.budget_summary.profit_margin < 20) {
      blockers.push('Budget risk: projected profit margin is below 20%.')
      recommendedNextActions.push('Rework pricing or costs to lift projected margin above 20%.')
    }
  }

  overdueItems.forEach((title) => {
    blockers.push(`Overdue task: ${title}.`)
    recommendedNextActions.push(`Complete overdue task: ${title}.`)
  })

  const uniqueBlockers = uniqueStrings(blockers)
  const uniqueOverdueItems = uniqueStrings(overdueItems)

  return workspaceAgentOutputSchema.parse({
    workspace_summary: `${uniqueBlockers.length} blocker${uniqueBlockers.length === 1 ? '' : 's'}; ${uniqueOverdueItems.length} overdue item${uniqueOverdueItems.length === 1 ? '' : 's'}.`,
    current_status: uniqueBlockers.length > 0 ? 'blocked' : 'on_track',
    blockers: uniqueBlockers,
    overdue_items: uniqueOverdueItems,
    recommended_next_actions: uniqueStrings(recommendedNextActions),
    approvals_needed: uniqueStrings(approvalsNeeded),
  })
}

async function loadEventTasks(db: PlannerDb, eventId: string): Promise<WorkspaceAgentInput['tasks']> {
  const { data, error } = await db
    .from('event_tasks')
    .select('*')
    .eq('event_id', eventId)
    .order('due_date', { ascending: true })

  if (error) {
    console.error('[agent.run] Workspace task lookup failed', error)
    return []
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: readString(row.id) ?? 'unknown-task',
    event_id: readString(row.event_id) ?? eventId,
    title: readString(row.title) ?? readString(row.text) ?? 'Untitled task',
    due_date: readString(row.due_date),
    status: readString(row.status) ?? (readBoolean(row.completed) ? 'complete' : 'open'),
    assigned_to: readString(row.assigned_to),
  }))
}

async function loadVenueBookings(db: PlannerDb, eventId: string): Promise<WorkspaceAgentInput['venue_bookings'] & TimelineAgentInput['confirmed_venue_bookings']> {
  const { data, error } = await db
    .from('venue_bookings')
    .select('*')
    .eq('event_id', eventId)

  if (error) {
    console.error('[agent.run] Venue booking lookup failed', error)
    return []
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: readString(row.id) ?? 'unknown-venue-booking',
    event_id: readString(row.event_id) ?? eventId,
    venue_id: readString(row.venue_id) ?? 'unknown-venue',
    status: readString(row.status),
    quoted_price: readNumber(row.quoted_price),
    booking_date: readString(row.booking_date) ?? undefined,
    start_time: readString(row.start_time),
    end_time: readString(row.end_time),
  }))
}

async function loadVendorBookings(db: PlannerDb, eventId: string): Promise<WorkspaceAgentInput['vendor_bookings'] & TimelineAgentInput['confirmed_vendor_bookings']> {
  const { data, error } = await db
    .from('vendor_bookings')
    .select('*')
    .eq('event_id', eventId)

  if (error) {
    console.error('[agent.run] Vendor booking lookup failed', error)
    return []
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: readString(row.id) ?? 'unknown-vendor-booking',
    event_id: readString(row.event_id) ?? eventId,
    vendor_id: readString(row.vendor_id) ?? 'unknown-vendor',
    status: readString(row.status),
    quoted_price: readNumber(row.quoted_price),
    booking_date: readString(row.booking_date) ?? undefined,
    start_time: readString(row.start_time),
    end_time: readString(row.end_time),
    confirmed_start_time: readString(row.confirmed_start_time),
    confirmed_end_time: readString(row.confirmed_end_time),
    setup_time: readString(row.setup_time),
  }))
}

async function loadBudgetSummary(db: PlannerDb, eventId: string): Promise<WorkspaceAgentInput['budget_summary']> {
  const { data, error } = await db
    .from('event_financial_summary')
    .select('*')
    .eq('event_id', eventId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.error('[agent.run] Budget summary lookup failed', error)
    return null
  }

  return {
    event_id: readString(data.event_id) ?? eventId,
    expected_profit: readNumber(data.expected_profit),
    profit_margin: readNumber(data.profit_margin),
    break_even_tickets: readNumber(data.break_even_tickets),
    net_revenue: readNumber(data.net_revenue),
    total_costs: readNumber(data.total_costs),
  }
}

async function loadVenueRequirements(
  db: PlannerDb,
  venueIds: string[]
): Promise<TimelineAgentInput['venue_requirements']> {
  const ids = Array.from(new Set(venueIds.filter(Boolean)))
  if (ids.length === 0) return []

  const { data, error } = await db
    .from('venue_requirements')
    .select('*')
    .in('venue_id', ids)

  if (error) {
    console.error('[agent.run] Venue requirement lookup failed', error)
    return []
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: readString(row.id) ?? 'unknown-requirement',
    venue_id: readString(row.venue_id) ?? 'unknown-venue',
    requirement_type: readString(row.requirement_type),
    is_required: readBoolean(row.is_required),
    description: readString(row.description),
    minimum_liability_coverage: readNumber(row.minimum_liability_coverage),
    requires_additional_insured: readBoolean(row.requires_additional_insured),
    custom_question: readString(row.custom_question),
  }))
}

async function updatePlanMetadata(
  db: PlannerDb,
  planId: string,
  userId: string,
  metadata: Record<string, unknown>
) {
  const { error } = await db
    .from('plans')
    .update({ metadata: metadata as Json })
    .eq('id', planId)
    .eq('user_id', userId)

  if (error) console.error('[agent.run] Plan agent cache update failed', error)
}

function readCachedOutput<T>(
  cache: Record<string, unknown> | null,
  cacheKey: string,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }
): T | null {
  if (!cache || cache.cache_key !== cacheKey) return null
  const output = readRecord(cache.output)
  if (!output) return null
  const parsed = schema.safeParse(output)
  return parsed.success ? parsed.data : null
}

function buildCacheKey(value: Record<string, unknown>): string {
  return JSON.stringify(value)
}

function isConfirmedStatus(status: string | null): boolean {
  if (!status) return false
  return ['confirmed', 'approved', 'booked', 'paid'].includes(status.trim().toLowerCase())
}

function isClosedStatus(status: string): boolean {
  return ['complete', 'completed', 'done', 'cancelled', 'canceled'].includes(status.trim().toLowerCase())
}

function isPastDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return false
  const due = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return due.getTime() < today.getTime()
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function hasOpenAIKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim())
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
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

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return null
}
