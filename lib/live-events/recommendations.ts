import 'server-only'

import { computeEventPnL, type EventPnL } from '@/lib/finance/eventActuals'
import {
  evaluateLiveTriggers,
  liveTriggerKeySchema,
  type LiveTrigger,
} from '@/lib/live-events/triggers'
import { runEconomicsAgent } from '@/lib/ai/agents/economicsAgent'
import type { TableInsert, TableRow } from '@/lib/types/databaseRows'
import { z } from 'zod'

export type SupabaseAdminClient = {
  from: (table: string) => QueryBuilder
}

type QueryBuilder = PromiseLike<{ data: unknown; error: QueryError | null }> & {
  select: (columns?: string) => QueryBuilder
  insert: (values: unknown) => QueryBuilder
  eq: (column: string, value: unknown) => QueryBuilder
  maybeSingle: () => Promise<{ data: unknown; error: QueryError | null }>
  single: () => Promise<{ data: unknown; error: QueryError | null }>
}

type QueryError = {
  code?: string
  message?: string
}

type EventRow = {
  id: string
  builder_id: string
  event_name: string | null
  event_type: string | null
  event_date: string | null
  expected_attendance: number | string | null
  expected_attendance_max: number | string | null
  budget: number | string | null
  total_budget: number | string | null
}

export const liveRecommendationStateSchema = z.enum(['open', 'acknowledged', 'dismissed', 'acted_on'])
export const liveRecommendationExecutionModeSchema = z.enum(['analysis_only', 'approval_linked'])

export type LiveRecommendationActionContract = {
  execution_mode: z.infer<typeof liveRecommendationExecutionModeSchema>
  requires_approval_before_execution: true
  approval_id: string | null
  note: string
}

export type LiveRecommendationRow = {
  id: string
  event_id: string
  org_id: string
  trigger_key: LiveTrigger['trigger_key']
  severity: LiveTrigger['severity']
  suggested_action: string
  evidence: Record<string, number | string>
  agent_narrative: string
  state: z.infer<typeof liveRecommendationStateSchema>
  action_contract: LiveRecommendationActionContract
  created_at: string
  updated_at: string
}

export type LiveEventRecomputeResult = {
  eventId: string
  triggers_evaluated: number
  inserted: number
  skipped_open: number
  agent_status: 'succeeded' | 'fallback' | 'skipped'
  recommendations: LiveRecommendationRow[]
}

export function mapLiveTriggerToRecommendationInsert(input: {
  event: EventRow
  trigger: LiveTrigger
  agentNarrative: string
}): TableInsert<'live_recommendations'> {
  return {
    event_id: input.event.id,
    org_id: input.event.builder_id,
    trigger_key: input.trigger.trigger_key,
    severity: input.trigger.severity,
    suggested_action: input.trigger.suggested_action,
    evidence: input.trigger.evidence,
    agent_narrative: input.agentNarrative,
    state: 'open',
  }
}

export function normalizeLiveRecommendationRow(
  row: TableRow<'live_recommendations'> | Record<string, unknown>
): LiveRecommendationRow {
  const evidence = readEvidence(row.evidence)
  const triggerKey = liveTriggerKeySchema.parse(row.trigger_key)
  const severity = z.enum(['info', 'recommend', 'urgent']).parse(row.severity)
  const state = liveRecommendationStateSchema.parse(row.state)

  return {
    id: String(row.id),
    event_id: String(row.event_id),
    org_id: String(row.org_id),
    trigger_key: triggerKey,
    severity,
    suggested_action: String(row.suggested_action ?? ''),
    evidence,
    agent_narrative: String(row.agent_narrative ?? ''),
    state,
    action_contract: buildRecommendationActionContract(evidence),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export function buildRecommendationActionContract(
  evidence: Record<string, number | string>
): LiveRecommendationActionContract {
  const approvalId = readApprovalId(evidence)

  // Live intelligence is advisory. Anything that sends, pays, books, refunds,
  // or changes terms must move through the planner approval/action flow first.
  return {
    execution_mode: approvalId ? 'approval_linked' : 'analysis_only',
    requires_approval_before_execution: true,
    approval_id: approvalId,
    note: approvalId
      ? 'A planner approval record is linked before execution.'
      : 'Create a planner approval before sending, paying, booking, refunding, or changing terms.',
  }
}

export async function runLiveEventRecompute(
  admin: SupabaseAdminClient,
  eventId: string
): Promise<LiveEventRecomputeResult> {
  const event = await loadEvent(admin, eventId)
  const pnl = await computeEventPnL(admin, eventId)
  const triggers = evaluateLiveTriggers(pnl)
  if (triggers.length === 0) {
    return {
      eventId,
      triggers_evaluated: 0,
      inserted: 0,
      skipped_open: 0,
      agent_status: 'skipped',
      recommendations: [],
    }
  }

  const openTriggerKeys = await loadOpenTriggerKeys(admin, eventId)
  const newTriggers = triggers.filter((trigger) => !openTriggerKeys.has(trigger.trigger_key))
  if (newTriggers.length === 0) {
    return {
      eventId,
      triggers_evaluated: triggers.length,
      inserted: 0,
      skipped_open: triggers.length,
      agent_status: 'skipped',
      recommendations: [],
    }
  }

  const narration = await buildAgentNarration(event, pnl, newTriggers)
  const insertedRecommendations: LiveRecommendationRow[] = []
  let skippedOpen = triggers.length - newTriggers.length

  for (const trigger of newTriggers) {
    const insert = mapLiveTriggerToRecommendationInsert({
      event,
      trigger,
      agentNarrative: narration.byTriggerKey.get(trigger.trigger_key) ?? fallbackNarrative(trigger),
    })
    const { data, error } = await admin
      .from('live_recommendations')
      .insert(insert)
      .select('*')
      .single()

    if (error) {
      if (isUniqueConflict(error)) {
        skippedOpen += 1
        continue
      }
      throw new Error(error.message ?? 'Failed to create live recommendation')
    }

    insertedRecommendations.push(normalizeLiveRecommendationRow(data as Record<string, unknown>))
  }

  return {
    eventId,
    triggers_evaluated: triggers.length,
    inserted: insertedRecommendations.length,
    skipped_open: skippedOpen,
    agent_status: narration.agentStatus,
    recommendations: insertedRecommendations,
  }
}

async function loadEvent(admin: SupabaseAdminClient, eventId: string): Promise<EventRow> {
  const { data, error } = await admin
    .from('events')
    .select([
      'id',
      'builder_id',
      'event_name',
      'event_type',
      'event_date',
      'expected_attendance',
      'expected_attendance_max',
      'budget',
      'total_budget',
    ].join(', '))
    .eq('id', eventId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load event')
  if (!data) throw new Error('Event not found')
  return data as EventRow
}

async function loadOpenTriggerKeys(admin: SupabaseAdminClient, eventId: string) {
  const { data, error } = await admin
    .from('live_recommendations')
    .select('trigger_key')
    .eq('event_id', eventId)
    .eq('state', 'open')

  if (error) throw new Error(error.message ?? 'Failed to load open live recommendations')
  return new Set(((data as Array<{ trigger_key?: string }> | null) ?? [])
    .map((row) => row.trigger_key)
    .filter(Boolean) as LiveTrigger['trigger_key'][])
}

async function buildAgentNarration(
  event: EventRow,
  pnl: EventPnL,
  triggers: LiveTrigger[]
): Promise<{
  agentStatus: LiveEventRecomputeResult['agent_status']
  byTriggerKey: Map<LiveTrigger['trigger_key'], string>
}> {
  try {
    const result = await runEconomicsAgent(buildEconomicsInput(event, pnl))
    const narrative = result.output.narrative.trim()
    return {
      agentStatus: 'succeeded',
      byTriggerKey: new Map(triggers.map((trigger) => [
        trigger.trigger_key,
        `${narrative} ${formatTriggerEvidence(trigger)}`,
      ])),
    }
  } catch (error) {
    console.warn('[live-event-recompute] Economics agent narration fell back', error)
    return {
      agentStatus: 'fallback',
      byTriggerKey: new Map(triggers.map((trigger) => [
        trigger.trigger_key,
        fallbackNarrative(trigger),
      ])),
    }
  }
}

function buildEconomicsInput(event: EventRow, pnl: EventPnL) {
  const expectedAttendance =
    readInteger(event.expected_attendance) ??
    readInteger(event.expected_attendance_max) ??
    Math.max(pnl.revenue.tickets_sold, 0)
  const averageTicketPriceCents = pnl.revenue.tickets_sold > 0
    ? Math.round(pnl.revenue.gross_revenue_cents / pnl.revenue.tickets_sold)
    : 0
  const totalCostsCents = pnl.costs.paid_cents + pnl.costs.committed_cents + pnl.costs.estimated_cents

  return {
    mode: 'live',
    actuals: pnl,
    event_plan: {
      event_name: event.event_name ?? 'Untitled event',
      expected_attendance: expectedAttendance,
      city: null,
      venue_type: null,
      budget: 0,
      event_date: event.event_date,
      monetization_model: averageTicketPriceCents > 0 ? 'ticketed' : 'free',
      headcount_min: null,
      headcount_max: expectedAttendance,
      ticket_price_target: averageTicketPriceCents / 100,
      profit_goal: null,
    },
    budget_line_items: [],
    expected_attendance: expectedAttendance,
    venue_cost_cents: 0,
    vendor_cost_cents: totalCostsCents,
    ticket_price_cents: averageTicketPriceCents,
    sponsorship_revenue_cents: 0,
    ticket_price_sweep_cents: buildTicketPriceSweep(averageTicketPriceCents),
    cost_confidence: 'mixed',
  }
}

function buildTicketPriceSweep(priceCents: number) {
  if (priceCents <= 0) return [0, 2500, 5000]
  return Array.from(new Set([
    Math.max(Math.round(priceCents * 0.8), 0),
    priceCents,
    Math.round(priceCents * 1.2),
  ])).sort((first, second) => first - second)
}

function fallbackNarrative(trigger: LiveTrigger) {
  return `${trigger.suggested_action} ${formatTriggerEvidence(trigger)}`
}

function formatTriggerEvidence(trigger: LiveTrigger) {
  const evidence = Object.entries(trigger.evidence)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ')
  return `Evidence: ${trigger.trigger_key} ${evidence}.`
}

function readInteger(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isUniqueConflict(error: { code?: string; message?: string }) {
  return error.code === '23505' || /duplicate key|unique constraint/i.test(error.message ?? '')
}

function readEvidence(value: unknown): Record<string, number | string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.entries(value).reduce<Record<string, number | string>>((evidence, [key, entry]) => {
    if (typeof entry === 'number' && Number.isFinite(entry)) evidence[key] = entry
    if (typeof entry === 'string') evidence[key] = entry
    return evidence
  }, {})
}

function readApprovalId(evidence: Record<string, number | string>) {
  const approvalId = evidence.approval_id
  return typeof approvalId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(approvalId)
    ? approvalId
    : null
}
