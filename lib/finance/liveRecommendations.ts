import 'server-only'

import { computeEventPnL, type EventPnL } from '@/lib/finance/eventActuals'
import { evaluateLiveTriggers, type LiveTrigger } from '@/lib/finance/liveTriggers'
import { runEconomicsAgent } from '@/lib/ai/agents/economicsAgent'

type SupabaseAdminClient = any

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

type LiveRecommendationRow = {
  id: string
  event_id: string
  org_id: string
  trigger_key: LiveTrigger['trigger_key']
  severity: LiveTrigger['severity']
  suggested_action: string
  evidence: Record<string, number | string>
  agent_narrative: string
  state: 'open' | 'acknowledged' | 'dismissed' | 'acted_on'
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
    const { data, error } = await admin
      .from('live_recommendations')
      .insert({
        event_id: event.id,
        org_id: event.builder_id,
        trigger_key: trigger.trigger_key,
        severity: trigger.severity,
        suggested_action: trigger.suggested_action,
        evidence: trigger.evidence,
        agent_narrative: narration.byTriggerKey.get(trigger.trigger_key) ?? fallbackNarrative(trigger),
        state: 'open',
      })
      .select('*')
      .single()

    if (error) {
      if (isUniqueConflict(error)) {
        skippedOpen += 1
        continue
      }
      throw new Error(error.message ?? 'Failed to create live recommendation')
    }

    insertedRecommendations.push(data as LiveRecommendationRow)
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
