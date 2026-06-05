import {
  APPROVAL_SELECT_COLUMNS,
  PLAN_MESSAGE_SELECT_COLUMNS,
  PLAN_SELECT_COLUMNS,
  RECOMMENDATION_SELECT_COLUMNS,
} from '@/lib/planner/dbSelects'
import type { Approval, Json, Plan, PlanMessage, Recommendation } from '@/lib/types'

export type PlannerDb = { from: (table: string) => any }

export type StatusTone = 'clay' | 'forest' | 'ochre' | 'muted' | 'brick'

export interface MobileProgressItem {
  id: 'brief' | 'venues' | 'budget' | 'outreach'
  label: string
  detail: string
  status: string
  tone: StatusTone
}

export interface MobileActivityItem {
  id: string
  kind: 'plan_update' | 'approval' | 'payment' | 'ticketing' | 'budget' | 'problem' | 'system'
  summary: string
  detail: string | null
  occurred_at: string
}

export interface MobileHomeReadModel {
  plan: Plan
  pending_approvals: Approval[]
  pending_approval_count: number
  problem: MobileActivityItem | null
  progress: MobileProgressItem[]
  updates: MobileActivityItem[]
}

export interface MobileBudgetLine {
  id: string
  category: string
  label: string
  low_cents: number
  high_cents: number
  status: string
  source: string
}

export interface MobileBudgetReadModel {
  plan_id: string
  target_cents: number | null
  buffer_target_cents: number | null
  low_total_cents: number
  high_total_cents: number
  committed_total_cents: number
  projected_delta_cents: number | null
  projected_buffer_low_cents: number | null
  projected_buffer_high_cents: number | null
  lines: MobileBudgetLine[]
}

export interface MobileAnalyticsEvent {
  id: string
  name: string
  event_type: string | null
  net_revenue_cents: number
  total_costs_cents: number
  profit_cents: number
  margin_percent: number | null
}

export interface MobileAnalyticsReadModel {
  events_per_year: number
  average_margin_percent: number | null
  rebook_rate_percent: number | null
  best_format: string | null
  recommendation: string
  recent_events: MobileAnalyticsEvent[]
}

type BudgetRow = {
  plan_id: string
  target_cents: number | null
  buffer_target_cents: number | null
}

type BudgetLineRow = MobileBudgetLine

type ActivityRow = {
  id: string
  kind: MobileActivityItem['kind']
  summary: string
  payload: Json
  occurred_at: string
  created_at?: string | null
}

type EventRow = {
  id: string
  event_name: string | null
  event_type: string | null
  event_date: string | null
  status: string | null
}

type FinancialSummaryRow = {
  event_id: string
  net_revenue: number | string | null
  net_revenue_cents?: number | null
  total_costs: number | string | null
  total_costs_cents?: number | null
  expected_profit: number | string | null
  profit_cents?: number | null
  profit_margin: number | string | null
}

export async function loadOwnedMobilePlan(db: PlannerDb, planId: string, userId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[mobile.planner] Plan lookup failed', error)
    return null
  }

  return (data as Plan | null) ?? null
}

export async function buildMobileHomeReadModel(db: PlannerDb, plan: Plan): Promise<MobileHomeReadModel> {
  const [pendingApprovals, recommendations, activityRows, statusMessages] = await Promise.all([
    loadPendingApprovals(db, plan.id),
    loadRecommendations(db, plan.id),
    loadPlanActivityRows(db, plan.id),
    loadStatusMessages(db, plan.id),
  ])

  const activity = [
    ...activityRows.map(activityRowToItem),
    ...statusMessages.map(statusMessageToItem),
  ].sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())

  return {
    plan,
    pending_approvals: pendingApprovals.slice(0, 3),
    pending_approval_count: pendingApprovals.length,
    problem: activity.find((item) => item.kind === 'problem') ?? null,
    progress: buildProgress(plan, recommendations, pendingApprovals),
    updates: activity.filter((item) => item.kind !== 'problem').slice(0, 5),
  }
}

export async function buildMobileBudgetReadModel(
  db: PlannerDb,
  plan: Plan,
  projectedDeltaCents: number | null
): Promise<MobileBudgetReadModel> {
  const [budget, budgetLines, commitments] = await Promise.all([
    loadPlanBudget(db, plan.id),
    loadPlanBudgetLines(db, plan.id),
    loadPlanCommitmentLines(db, plan.id),
  ])
  const lines = [...budgetLines, ...commitments]
  const targetCents = budget?.target_cents ?? plan.budget_cap_cents
  const bufferTargetCents = budget?.buffer_target_cents ?? defaultBufferTarget(targetCents)
  const activeLines = lines.filter((line) => line.status !== 'cancelled')
  const lowTotal = activeLines.reduce((sum, line) => sum + line.low_cents, 0)
  const highTotal = activeLines.reduce((sum, line) => sum + line.high_cents, 0)
  const committedTotal = activeLines
    .filter((line) => line.status === 'committed' || line.status === 'paid')
    .reduce((sum, line) => sum + line.high_cents, 0)
  const delta = projectedDeltaCents

  return {
    plan_id: plan.id,
    target_cents: targetCents,
    buffer_target_cents: bufferTargetCents,
    low_total_cents: lowTotal,
    high_total_cents: highTotal,
    committed_total_cents: committedTotal,
    projected_delta_cents: delta,
    projected_buffer_low_cents: targetCents == null ? null : targetCents - lowTotal - (delta ?? 0),
    projected_buffer_high_cents: targetCents == null ? null : targetCents - highTotal - (delta ?? 0),
    lines,
  }
}

export async function buildMobileActivityReadModel(db: PlannerDb, plan: Plan): Promise<{ activities: MobileActivityItem[] }> {
  const [activityRows, statusMessages, approvals] = await Promise.all([
    loadPlanActivityRows(db, plan.id),
    loadStatusMessages(db, plan.id),
    loadAllApprovals(db, plan.id),
  ])

  const approvalItems = approvals
    .filter((approval) => approval.status !== 'pending')
    .map((approval) => approvalToActivityItem(approval))

  const activities = [
    ...activityRows.map(activityRowToItem),
    ...statusMessages.map(statusMessageToItem),
    ...approvalItems,
  ].sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())

  return { activities: activities.slice(0, 50) }
}

export async function buildMobileAnalyticsReadModel(db: PlannerDb, builderProfileId: string): Promise<MobileAnalyticsReadModel> {
  const { data: eventData, error: eventsError } = await db
    .from('events')
    .select('id, event_name, event_type, event_date, status')
    .eq('builder_id', builderProfileId)
    .order('event_date', { ascending: false })
    .limit(100)

  if (eventsError) {
    console.error('[mobile.planner] Event analytics lookup failed', eventsError)
    throw new Error('Failed to load planner analytics')
  }

  const events = (eventData ?? []) as EventRow[]
  if (events.length === 0) return emptyAnalytics()

  const eventIds = events.map((event) => event.id)
  const { data: summaryData, error: summaryError } = await db
    .from('event_financial_summary')
    .select('event_id, net_revenue, total_costs, expected_profit, profit_margin')
    .in('event_id', eventIds)

  if (summaryError) {
    console.error('[mobile.planner] Financial summary lookup failed', summaryError)
    throw new Error('Failed to load planner analytics')
  }

  const summaries = new Map<string, FinancialSummaryRow>(
    ((summaryData ?? []) as FinancialSummaryRow[]).map((row) => [row.event_id, row])
  )
  const currentYear = new Date().getFullYear()
  const currentYearEvents = events.filter((event) => {
    if (!event.event_date) return false
    return new Date(event.event_date).getFullYear() === currentYear
  })
  const completedEvents = events.filter((event) => event.status === 'completed')
  const enriched = events.map((event) => eventToAnalyticsEvent(event, summaries.get(event.id)))
  const eventsWithMargin = enriched.filter((event) => event.margin_percent !== null)
  const averageMargin = eventsWithMargin.length === 0
    ? null
    : Math.round(eventsWithMargin.reduce((sum, event) => sum + (event.margin_percent ?? 0), 0) / eventsWithMargin.length)
  const bestFormat = findBestFormat(enriched)

  return {
    events_per_year: currentYearEvents.length,
    average_margin_percent: averageMargin,
    rebook_rate_percent: null,
    best_format: bestFormat,
    recommendation: buildAnalyticsRecommendation({ averageMargin, bestFormat, completedCount: completedEvents.length }),
    recent_events: enriched.slice(0, 5),
  }
}

async function loadPendingApprovals(db: PlannerDb, planId: string): Promise<Approval[]> {
  const { data, error } = await db
    .from('approvals')
    .select(APPROVAL_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[mobile.planner] Pending approvals lookup failed', error)
    return []
  }

  return (data ?? []) as Approval[]
}

async function loadAllApprovals(db: PlannerDb, planId: string): Promise<Approval[]> {
  const { data, error } = await db
    .from('approvals')
    .select(APPROVAL_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[mobile.planner] Approval activity lookup failed', error)
    return []
  }

  return (data ?? []) as Approval[]
}

async function loadRecommendations(db: PlannerDb, planId: string): Promise<Recommendation[]> {
  const { data, error } = await db
    .from('recommendations')
    .select(RECOMMENDATION_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .order('rank', { ascending: true })

  if (error) {
    console.error('[mobile.planner] Recommendation lookup failed', error)
    return []
  }

  return (data ?? []) as Recommendation[]
}

async function loadPlanActivityRows(db: PlannerDb, planId: string): Promise<ActivityRow[]> {
  const { data, error } = await db
    .from('plan_activity')
    .select('id, kind, summary, payload, occurred_at, created_at')
    .eq('plan_id', planId)
    .order('occurred_at', { ascending: false })
    .limit(25)

  if (error) {
    console.error('[mobile.planner] Activity lookup failed', error)
    return []
  }

  return (data ?? []) as ActivityRow[]
}

async function loadStatusMessages(db: PlannerDb, planId: string): Promise<PlanMessage[]> {
  const { data, error } = await db
    .from('plan_messages')
    .select(PLAN_MESSAGE_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .eq('message_type', 'status_update')
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error('[mobile.planner] Status message lookup failed', error)
    return []
  }

  return (data ?? []) as PlanMessage[]
}

async function loadPlanBudget(db: PlannerDb, planId: string): Promise<BudgetRow | null> {
  const { data, error } = await db
    .from('plan_budget')
    .select('plan_id, target_cents, buffer_target_cents')
    .eq('plan_id', planId)
    .maybeSingle()

  if (error) {
    console.error('[mobile.planner] Plan budget lookup failed', error)
    return null
  }

  return (data as BudgetRow | null) ?? null
}

async function loadPlanBudgetLines(db: PlannerDb, planId: string): Promise<MobileBudgetLine[]> {
  const { data, error } = await db
    .from('plan_budget_lines')
    .select('id, category, label, low_cents, high_cents, status, source')
    .eq('plan_id', planId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[mobile.planner] Plan budget lines lookup failed', error)
    return []
  }

  return ((data ?? []) as BudgetLineRow[]).map((line) => ({
    id: String(line.id),
    category: line.category,
    label: line.label,
    low_cents: line.low_cents ?? 0,
    high_cents: line.high_cents ?? 0,
    status: line.status,
    source: line.source,
  }))
}

async function loadPlanCommitmentLines(db: PlannerDb, planId: string): Promise<MobileBudgetLine[]> {
  const { data, error } = await db
    .from('event_cost_commitments')
    .select('id, category, party_name, description, amount_cents, state, source')
    .eq('plan_id', planId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[mobile.planner] Event commitment lookup failed', error)
    return []
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const amount = readNumber(row.amount_cents) ?? 0
    return {
      id: String(row.id),
      category: String(row.category ?? 'other'),
      label: String(row.description ?? row.party_name ?? 'Committed cost'),
      low_cents: amount,
      high_cents: amount,
      status: mapCommitmentState(String(row.state ?? 'estimated')),
      source: String(row.source ?? 'commitment'),
    }
  })
}

function buildProgress(plan: Plan, recommendations: Recommendation[], approvals: Approval[]): MobileProgressItem[] {
  const hasBrief =
    Boolean(plan.title) &&
    Boolean(plan.guest_count) &&
    Boolean(plan.budget_cap_cents) &&
    Boolean(plan.neighborhood)
  const venues = recommendations.filter((recommendation) => recommendation.type === 'venue')
  const vendorCount = recommendations.filter((recommendation) => recommendation.type === 'vendor').length

  return [
    {
      id: 'brief',
      label: 'Brief',
      detail: hasBrief ? 'Core event facts are usable' : 'Needs event facts',
      status: hasBrief ? 'Ready' : 'Draft',
      tone: hasBrief ? 'forest' : 'ochre',
    },
    {
      id: 'venues',
      label: 'Venues',
      detail: venues.length > 0 ? `${venues.length} recommendation${venues.length === 1 ? '' : 's'} available` : 'No venue recommendations yet',
      status: venues.length > 0 ? 'In review' : 'Empty',
      tone: venues.length > 0 ? 'forest' : 'muted',
    },
    {
      id: 'budget',
      label: 'Budget',
      detail: plan.budget_cap_cents == null ? 'No budget target yet' : 'Target set on plan',
      status: plan.budget_cap_cents == null ? 'Missing' : 'Watch',
      tone: plan.budget_cap_cents == null ? 'ochre' : 'forest',
    },
    {
      id: 'outreach',
      label: 'Outreach',
      detail: approvals.length > 0 || vendorCount > 0 ? 'Approvals available; send pipeline pending' : 'Gmail outreach in development',
      status: 'Gated',
      tone: 'muted',
    },
  ]
}

function activityRowToItem(row: ActivityRow): MobileActivityItem {
  const payload = readRecord(row.payload)
  return {
    id: row.id,
    kind: row.kind,
    summary: row.summary,
    detail: readString(payload?.detail),
    occurred_at: row.occurred_at,
  }
}

function statusMessageToItem(message: PlanMessage): MobileActivityItem {
  return {
    id: message.id,
    kind: 'plan_update',
    summary: message.content,
    detail: null,
    occurred_at: message.created_at,
  }
}

function approvalToActivityItem(approval: Approval): MobileActivityItem {
  return {
    id: approval.id,
    kind: approval.price_cents && approval.price_cents > 0 ? 'payment' : 'approval',
    summary: `${approval.action_label} ${approval.status}`,
    detail: approval.provider,
    occurred_at: approval.updated_at,
  }
}

function eventToAnalyticsEvent(event: EventRow, summary?: FinancialSummaryRow): MobileAnalyticsEvent {
  const netRevenue = summary?.net_revenue_cents ?? toCents(summary?.net_revenue)
  const totalCosts = summary?.total_costs_cents ?? toCents(summary?.total_costs)
  const profit = summary?.profit_cents ?? toCents(summary?.expected_profit) ?? netRevenue - totalCosts
  const margin = readNumber(summary?.profit_margin)

  return {
    id: event.id,
    name: event.event_name ?? 'Untitled event',
    event_type: event.event_type,
    net_revenue_cents: netRevenue,
    total_costs_cents: totalCosts,
    profit_cents: profit,
    margin_percent: margin,
  }
}

function findBestFormat(events: MobileAnalyticsEvent[]): string | null {
  const groups = new Map<string, { count: number; profit: number }>()
  for (const event of events) {
    if (!event.event_type) continue
    const current = groups.get(event.event_type) ?? { count: 0, profit: 0 }
    groups.set(event.event_type, {
      count: current.count + 1,
      profit: current.profit + event.profit_cents,
    })
  }

  let best: { format: string; averageProfit: number } | null = null
  for (const [format, value] of groups) {
    const averageProfit = value.count === 0 ? 0 : value.profit / value.count
    if (!best || averageProfit > best.averageProfit) {
      best = { format, averageProfit }
    }
  }

  return best?.format ?? null
}

function buildAnalyticsRecommendation(input: {
  averageMargin: number | null
  bestFormat: string | null
  completedCount: number
}) {
  if (input.completedCount === 0) {
    return 'Complete an event report to unlock event performance recommendations.'
  }

  if (input.bestFormat && input.averageMargin !== null) {
    return `${titleize(input.bestFormat)} events have the strongest current signal. Keep comparing venue minimums against the target margin before approving new holds.`
  }

  return 'Use completed event reports to compare margin, attendance, and rebook signals before repeating a format.'
}

function emptyAnalytics(): MobileAnalyticsReadModel {
  return {
    events_per_year: 0,
    average_margin_percent: null,
    rebook_rate_percent: null,
    best_format: null,
    recommendation: 'Complete an event report to unlock event performance recommendations.',
    recent_events: [],
  }
}

function defaultBufferTarget(targetCents: number | null): number | null {
  if (targetCents == null) return null
  return Math.round(targetCents * 0.1)
}

function mapCommitmentState(state: string): string {
  if (state === 'accepted' || state === 'invoiced') return 'committed'
  if (state === 'paid') return 'paid'
  if (state === 'cancelled') return 'cancelled'
  if (state === 'quoted') return 'quoted'
  return 'planned'
}

function toCents(value: number | string | null | undefined): number {
  if (value == null) return 0
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.round(numeric * 100)
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  return null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function titleize(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
