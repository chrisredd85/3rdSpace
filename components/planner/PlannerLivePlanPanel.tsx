/**
 * Purpose: Renders the fixed right-side Live Event Plan artifact panel for `/planner`.
 * Props: Accepts the active plan id and full conversation thread, plus optional
 * overrides for legacy stubbed budget, approval, rule, and source data.
 * Key behaviors: Derives event summary, recommendations, approvals, profit
 * assumptions, shopping list, and authorization cards from planner messages.
 */
'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronRight,
  ClipboardList,
  MapPin,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  WalletCards,
} from 'lucide-react'
import Link from 'next/link'
import { usePlannerBillingGate } from '@/components/planner/usePlannerBillingGate'
import { humanizeEventType } from '@/lib/planner/archetypes/driftControl'
import { plannerDraftStorageKey } from '@/lib/planner/migrateDraft'
import type { PlanMessage } from '@/lib/types'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/utils/relativeTime'

interface BudgetLineItem {
  label: string
  amountCents: number | null
}

/** Organizer-entered cost that isn't part of the agent's recommendation model. */
interface CustomCostItem {
  id: string
  label: string
  /** Dollar amount (not cents) — stored as a positive number, displayed as dollars. */
  amount: number
  created_at: string
}

interface PendingApproval {
  id: string
  label: string
  amountCents: number | null
  status: string
  subtitle?: string | null
  overThreshold?: boolean
}

interface RecommendationSummary {
  id: string
  name: string
  type: string
  priceLabel: string
  priceCents: number | null
  address: string | null
  capacity: number | null
  fit: string | null
  holdDurationHours: number | null
}

interface RunOfShowMilestone {
  title: string
  dueDate: string
  category: string
  isBlocking: boolean
}

interface RunOfShowSnapshot {
  planningMilestones: RunOfShowMilestone[]
  impossibleTimeline: boolean
}

interface WorkspaceSummarySnapshot {
  workspaceSummary: string
  currentStatus: 'on_track' | 'at_risk' | 'blocked'
  blockers: string[]
  recommendedNextActions: string[]
  approvalsNeeded: string[]
}

interface SpendingRule {
  label: string
  enabled: boolean
}

interface EventSummary {
  event_type: string | null
  guest_count: number | null
  date: string | null
  area: string | null
  budget_cents: number | null
  ticketing_model: string | null
  food_responsibility: string | null
  vendor_needs: string | null
  amenities: string | null
  venue_terms: string | null
  revenue_share: string | null
  action_permission: string | null
  must_haves: string | null
  dress_code: string | null
  duration: string | null
  ticketed: boolean | null
}

interface PlannerLivePlanPanelProps {
  messages?: PlanMessage[]
  planId?: string | null
  estimatedTotalCents?: number | null
  capLabel?: string
  budgetLineItems?: BudgetLineItem[]
  approvals?: PendingApproval[]
  spendingRules?: SpendingRule[]
  sources?: string[]
  /** When true, renders as an inline block (no fixed height, no border-l, no shadow). */
  inline?: boolean
}

interface LivePlanSnapshot {
  title: string
  eventType: string | null
  status: string
  guestCount: number | null
  budgetCapCents: number | null
  neighborhood: string | null
  dateWindowStart: string | null
  dateWindowEnd: string | null
  ticketed: boolean | null
  ticketingModel: string | null
  ticketPriceTargetCents: number | null
  foodResponsibility: string | null
  venueTerms: string | null
  actionPermission: string | null
  notes: string | null
  runOfShow: RunOfShowSnapshot | null
  workspaceSummary: WorkspaceSummarySnapshot | null
  selectedVendors: SelectedPlanVendor[]
  customCosts: CustomCostItem[]
  updatedAt: string | null
}

interface SelectedPlanVendor {
  id: string | null
  vendorId: string | null
  name: string
  serviceType: string | null
  priceCents: number | null
  rateAmount: number | null
  rateType: string | null
  claimStatus: string | null
  isClaimed: boolean | null
  rateSource: string | null
  provenanceLabel: string | null
}

interface LivePlanPanelPayload {
  plan: LivePlanSnapshot | null
  messages: PlanMessage[]
  planId: string | null
}

interface ProfitModel {
  conservativeCents: number
  expectedCents: number
  upsideCents: number
  realisticCents: number
  rangeLowCents: number
  rangeHighCents: number
  perAttendeeNetCents: number | null
  lineItems: Array<{ label: string; amountCents: number; negative?: boolean }>
  paidAverage: number
  venueKickbackCents: number
  revenueShareCents: number
  ticketPricing: TicketPricingModel
  customCostsTotalCents: number
  breakEvenTickets: number | null
}

interface TicketPricingModel {
  marketAverageCents: number
  recommendedCents: number
  breakEvenCents: number
  targetProfitCents: number
  projectedMarginCents: number
  rationale: string
}

interface ShoppingListItem {
  category: string
  label: string
  amountLabel: string
  note?: string
  badge?: string
}

interface AuthorizationCardModel {
  id: string
  label: string
  subtitle: string
  amountLabel: string
  amountCents: number
  approvalId?: string
}

interface PlannerAgentActionRequest {
  actionType: string
  targetType?: string | null
  targetId?: string | null
  payloadJson?: Record<string, unknown> | null
  requestedAmountCents?: number | null
}

interface PendingConversionAction {
  type: 'save' | 'hold' | 'authorize'
  payload?: {
    agentAction?: PlannerAgentActionRequest
    approvalId?: string
    authorizedAmountCents?: number
  }
}

const emptyPayload: LivePlanPanelPayload = {
  plan: null,
  messages: [],
  planId: null,
}

const defaultRules: SpendingRule[] = [
  { label: 'Organizer approval required for deposits', enabled: true },
  { label: 'Only contact capacity-fit venues', enabled: true },
  { label: 'Stay inside confirmed budget', enabled: true },
  { label: 'Pause agent spending', enabled: false },
]

const defaultSources = ['Eventbrite', 'Luma', 'Posh', 'Partiful', 'Venue catalog', 'Vendor catalog']

/**
 * Reads the live-plan payload persisted by the planner page.
 */
function readLivePlanPayload(): LivePlanPanelPayload {
  if (typeof window === 'undefined') return emptyPayload

  const raw = window.localStorage.getItem('planner-live-plan')
  if (!raw) return readStoredDraftLivePlanPayload()

  try {
    return normalizeLivePlanPayload(JSON.parse(raw))
  } catch {
    return readStoredDraftLivePlanPayload()
  }
}

function readStoredDraftLivePlanPayload(): LivePlanPanelPayload {
  if (typeof window === 'undefined') return emptyPayload

  const raw = window.localStorage.getItem(plannerDraftStorageKey)
  if (!raw) return emptyPayload

  try {
    return normalizeLivePlanPayload(JSON.parse(raw))
  } catch {
    return emptyPayload
  }
}

/**
 * Normalizes both the current payload shape and the older plan-only snapshot.
 */
function normalizeLivePlanPayload(value: unknown): LivePlanPanelPayload {
  const record = asRecord(value)
  if (!record) return emptyPayload

  if ('plan' in record || 'messages' in record || 'planId' in record) {
    const planRecord = asRecord(record.plan)
    return {
      plan: normalizeLivePlanSnapshot(planRecord),
      messages: Array.isArray(record.messages) ? (record.messages as PlanMessage[]) : [],
      planId: typeof record.planId === 'string'
        ? record.planId
        : typeof planRecord?.id === 'string'
          ? planRecord.id
          : null,
    }
  }

  return {
    plan: normalizeLivePlanSnapshot(record),
    messages: [],
    planId: null,
  }
}

/**
 * Converts a raw event payload into the minimal plan snapshot used by the panel.
 */
function normalizeLivePlanSnapshot(value: unknown): LivePlanSnapshot | null {
  const record = asRecord(value)
  if (!record) return null
  const ticketingModel = readString(record.ticketingModel) ?? readString(record.ticketing_model)
  const metadata = asRecord(record.metadata)
  const agentCache = asRecord(metadata?.agent_cache)
  const cachedTimeline = asRecord(agentCache?.timeline)
  const cachedWorkspace = asRecord(agentCache?.workspace_summary)

  return {
    title: readString(record.title) ?? 'Untitled plan',
    eventType: readString(record.eventType) ?? readString(record.event_type),
    status: readString(record.status) ?? 'drafting',
    guestCount: readNumber(record.guestCount) ?? readNumber(record.guest_count),
    budgetCapCents: readNumber(record.budgetCapCents) ?? readNumber(record.budget_cap_cents),
    neighborhood: readString(record.neighborhood) ?? readString(record.area),
    dateWindowStart: readString(record.dateWindowStart) ?? readString(record.date_window_start),
    dateWindowEnd: readString(record.dateWindowEnd) ?? readString(record.date_window_end),
    ticketed: readBoolean(record.ticketed) ?? isPaidTicketingModel(ticketingModel),
    ticketingModel,
    ticketPriceTargetCents:
      readNumber(record.ticketPriceTargetCents) ??
      readNumber(record.ticket_price_target_cents) ??
      readNumber(metadata?.ticket_price_target_cents),
    foodResponsibility: readString(record.foodResponsibility) ?? readString(record.food_responsibility),
    venueTerms: readString(record.venueTerms) ?? readString(record.venue_terms),
    actionPermission: readString(record.actionPermission) ?? readString(record.agent_action),
    notes: readString(record.notes),
    runOfShow:
      normalizeRunOfShow(record.runOfShow) ??
      normalizeRunOfShow(record.run_of_show) ??
      normalizeRunOfShow(cachedTimeline?.output),
    workspaceSummary:
      normalizeWorkspaceSummary(record.workspaceSummary) ??
      normalizeWorkspaceSummary(record.workspace_summary) ??
      normalizeWorkspaceSummary(cachedWorkspace?.output),
    selectedVendors: normalizeSelectedVendors(
      record.selectedVendors ??
      record.selected_vendors ??
      asRecord(metadata?.shopping_list)?.selected_vendors
    ),
    customCosts: normalizeCustomCosts(metadata?.custom_costs),
    updatedAt: readString(record.updatedAt) ?? readString(record.updated_at),
  }
}

function normalizeSelectedVendors(value: unknown): SelectedPlanVendor[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    const record = asRecord(item)
    if (!record) return []
    const vendorId = readString(record.vendor_id) ?? readString(record.reference_id) ?? readString(record.id)
    const name = readString(record.external_name) ?? readString(record.business_name) ?? readString(record.name)
    if (!vendorId && !name) return []
    return [{
      id: readString(record.id),
      vendorId,
      name: name ?? 'Vendor',
      serviceType: readString(record.service_type),
      priceCents: readNumber(record.price_cents),
      rateAmount: readNumber(record.rate_amount),
      rateType: readString(record.rate_type),
      claimStatus: readString(record.claim_status),
      isClaimed: readBoolean(record.is_claimed),
      rateSource: readString(record.rate_source),
      provenanceLabel: readString(record.rate_provenance_label),
    }]
  })
}

function normalizeCustomCosts(value: unknown): CustomCostItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const record = asRecord(item)
    if (!record) return []
    const id = readString(record.id)
    const label = readString(record.label)
    const amount = readNumber(record.amount)
    const created_at = readString(record.created_at)
    if (!id || !label || amount === null || amount <= 0 || !created_at) return []
    return [{ id, label, amount, created_at }]
  })
}

/**
 * Formats integer cents for display.
 */
function formatCents(value: number | null) {
  if (typeof value !== 'number') return 'TBD'

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value / 100)
}

/**
 * Formats event type labels for compact display.
 */
function formatEventType(value: string | null) {
  if (!value) return 'Event'
  return humanizeEventType(value) ?? 'Event'
}

/**
 * Returns the latest structured event summary from confirmation messages.
 */
function deriveEventSummary(messages: PlanMessage[], plan: LivePlanSnapshot | null): EventSummary {
  const ticketingModel = plan?.ticketingModel ?? null
  const ticketed = plan?.ticketed ?? isPaidTicketingModel(ticketingModel)
  const budgetCents = deriveBudgetCapCentsFromMessages(messages) ?? plan?.budgetCapCents ?? null
  const fallback: EventSummary = {
    event_type: plan?.eventType ?? null,
    guest_count: plan?.guestCount ?? null,
    date: formatDateWindow(plan),
    area: plan?.neighborhood ?? null,
    budget_cents: budgetCents,
    ticketing_model: ticketingModel,
    food_responsibility: plan?.foodResponsibility ?? null,
    vendor_needs: null,
    amenities: null,
    venue_terms: plan?.venueTerms ?? null,
    revenue_share: null,
    action_permission: plan?.actionPermission ?? null,
    must_haves: null,
    dress_code: null,
    duration: null,
    ticketed,
  }

  const confirmationMessage = [...messages]
    .reverse()
    .find((message) => String(message.message_type) === 'confirmation_card')

  if (!confirmationMessage) return fallback

  const metadata = asRecord(confirmationMessage.metadata)
  const summary = asRecord(metadata?.summary)
  if (summary) {
    return {
      event_type: fallback.event_type ?? readString(summary.event_type),
      guest_count: fallback.guest_count ?? readNumber(summary.guest_count),
      date: fallback.date ?? readString(summary.date),
      area: fallback.area ?? readString(summary.area),
      budget_cents: fallback.budget_cents ?? readNumber(summary.budget_cents),
      ticketing_model: fallback.ticketing_model ?? readString(summary.ticketing_model),
      food_responsibility: fallback.food_responsibility ?? readString(summary.food_responsibility),
      vendor_needs: readString(summary.vendor_needs) ?? fallback.vendor_needs,
      amenities: readString(summary.amenities) ?? fallback.amenities,
      venue_terms: fallback.venue_terms ?? readString(summary.venue_terms),
      revenue_share: readString(summary.revenue_share) ?? fallback.revenue_share,
      action_permission: fallback.action_permission ?? readString(summary.action_permission),
      must_haves: readStringListValue(summary.must_haves) ?? fallback.must_haves,
      dress_code: readString(summary.dress_code) ?? fallback.dress_code,
      duration: readString(summary.duration) ?? fallback.duration,
      ticketed: fallback.ticketed ?? readBoolean(summary.ticketed) ?? isPaidTicketingModel(readString(summary.ticketing_model)),
    }
  }

  return deriveSummaryFromConfirmationItems(metadata, fallback)
}

/**
 * Pulls basic summary fields from confirmation_items when no summary object exists.
 */
function deriveSummaryFromConfirmationItems(
  metadata: Record<string, unknown> | null | undefined,
  fallback: EventSummary
): EventSummary {
  const items = Array.isArray(metadata?.confirmation_items) ? metadata.confirmation_items : []
  const nextSummary = { ...fallback }

  for (const item of items) {
    const record = asRecord(item)
    const label = readString(record?.label)?.toLowerCase() ?? ''
    const value = readString(record?.value)
    if (!value || /^need\b/i.test(value)) continue

    if (label.includes('event') && !nextSummary.event_type) nextSummary.event_type = value
    if (label.includes('guest') && !nextSummary.guest_count) nextSummary.guest_count = readNumber(value.match(/\d+/)?.[0]) ?? nextSummary.guest_count
    if (label.includes('date') && !nextSummary.date) nextSummary.date = value
    if (label.includes('area') && !nextSummary.area) nextSummary.area = value
    if (label.includes('budget') && !nextSummary.budget_cents) nextSummary.budget_cents = parseMoneyToCents(value) ?? nextSummary.budget_cents
    if (label.includes('ticketing')) {
      if (!nextSummary.ticketing_model) nextSummary.ticketing_model = value
      nextSummary.ticketed = nextSummary.ticketed ?? isPaidTicketingModel(value)
    }
    if (label.includes('food') && !nextSummary.food_responsibility) nextSummary.food_responsibility = value
    if (label.includes('vendors')) nextSummary.vendor_needs = value
    if (label.includes('amenities')) nextSummary.amenities = value
    if (label.includes('venue terms') && !nextSummary.venue_terms) nextSummary.venue_terms = value
    if (label.includes('revenue')) nextSummary.revenue_share = value
    if (label.includes('agent action') && !nextSummary.action_permission) nextSummary.action_permission = value
    if (label.includes('duration')) nextSummary.duration = /^not specified$/i.test(value) ? null : value
    if (label.includes('must')) nextSummary.must_haves = value
  }

  return nextSummary
}

/**
 * Returns pending approval summaries from approval_request messages.
 */
function deriveApprovals(messages: PlanMessage[]): PendingApproval[] {
  return messages
    .filter((message) => String(message.message_type) === 'approval_request')
    .map((message) => {
      const metadata = asRecord(message.metadata)
      const approval = asRecord(metadata?.approval) ?? metadata ?? {}
      const id = readString(approval.id) ?? message.id
      const amountCents =
        readNumber(approval.requested_amount_cents) ??
        readNumber(approval.authorized_amount_cents) ??
        readNumber(approval.amount_cents) ??
        readNumber(approval.price_cents) ??
        readNumber(approval.price)
      const label =
        readString(approval.action_label) ??
        readString(approval.label) ??
        readString(approval.provider) ??
        message.content

      return {
        id,
        label,
        amountCents: amountCents ?? null,
        status: readString(approval.status) ?? readString(metadata?.status) ?? 'pending',
        subtitle: readString(approval.package_details) ?? readString(metadata?.subtext),
        overThreshold: Boolean(amountCents && amountCents > 250000),
      }
    })
}

function isRecommendationPlanMessage(message: PlanMessage) {
  if (String(message.message_type) !== 'recommendation') return false
  const metadata = asRecord(message.metadata)
  const recommendations = Array.isArray(metadata?.recommendations) ? metadata.recommendations : []
  return recommendations.length > 0
}

/**
 * Returns compact recommendation summaries from recommendation messages.
 */
function deriveRecommendations(messages: PlanMessage[]): RecommendationSummary[] {
  const latestRecommendationMessage = [...messages].reverse().find(isRecommendationPlanMessage)
  if (!latestRecommendationMessage) return []

  const metadata = asRecord(latestRecommendationMessage.metadata)
  const recommendations = Array.isArray(metadata?.recommendations) ? metadata.recommendations : []

  return recommendations.map((item, index) => {
      const record = asRecord(item) ?? {}
      const name = readString(record.name) ?? readString(record.provider) ?? `Recommendation ${index + 1}`
      const type = readString(record.type) ?? readString(record.recommendation_type) ?? 'Option'
      const priceCents = readNumber(record.price_cents) ?? readNumber(record.price)
      const priceTier = readString(record.price_tier) ?? readString(record.fit)

      return {
        id: readString(record.id) ?? `${latestRecommendationMessage.id}-${index}`,
        name,
        type,
        priceLabel: priceCents !== null && priceCents !== undefined ? formatCents(priceCents) : priceTier ?? 'Pricing pending',
        priceCents: priceCents ?? null,
        address: readString(record.address) ?? readString(record.location) ?? null,
        capacity: readNumber(record.capacity) ?? readNumber(record.capacity_max),
        fit: readString(record.fit) ?? readString(record.note),
        holdDurationHours: readNumber(record.hold_duration_hours),
      }
  })
}

/**
 * Builds budget rows from the latest event summary.
 */
function buildBudgetItems(summary: EventSummary, plan: LivePlanSnapshot | null): BudgetLineItem[] {
  const budgetCapCents = summary.budget_cents ?? plan?.budgetCapCents ?? null
  const noOrganizerFoodCost = hasNoOrganizerFoodCost(summary)
  const noPaidVendors = summary.vendor_needs === 'No vendors needed' || noOrganizerFoodCost
  const venueRatio = getVenueTargetRatio(summary)
  const venueAmountCents = budgetCapCents ? Math.round(budgetCapCents * venueRatio) : null

  if (!budgetCapCents) {
    return [
      { label: 'Venue target', amountCents: null },
      { label: 'Vendor pool', amountCents: null },
      { label: 'Contingency', amountCents: null },
      { label: 'Buffer', amountCents: null },
    ]
  }

  return [
    { label: venueBudgetLabel(summary), amountCents: venueAmountCents },
    {
      label: isDinnerLike(summary.event_type) ? foodBudgetLabel(summary) : 'Vendor pool',
      amountCents: noPaidVendors ? 0 : Math.round(budgetCapCents * 0.3),
    },
    { label: 'Contingency', amountCents: Math.round(budgetCapCents * 0.1) },
    { label: 'Buffer', amountCents: Math.round(budgetCapCents * 0.05) },
  ]
}

/**
 * Calculates deterministic profit assumptions from current summary and recommendations.
 * Custom costs (organizer-entered, dollars) are folded in on top of agent-derived costs.
 */
function buildProfitModel(
  summary: EventSummary,
  recommendations: RecommendationSummary[],
  budgetItems: BudgetLineItem[],
  customCosts: CustomCostItem[] = []
): ProfitModel {
  const guestCount = summary.guest_count ?? 0
  const paidAverage = guestCount > 0 ? Math.max(1, Math.round(guestCount * 0.87)) : 0
  const venueCostCents = recommendations.find((item) => /venue/i.test(item.type))?.priceCents ?? budgetItems[0]?.amountCents ?? 0
  const vendorCostCents =
    budgetItems.find((item) => /vendor|dinner/i.test(item.label))?.amountCents ??
    Math.max(0, Math.round((summary.budget_cents ?? 0) * 0.3))
  const customCostsTotalCents = Math.round(customCosts.reduce((sum, c) => sum + c.amount * 100, 0))
  const ticketPricing = buildTicketPricingModel(summary, paidAverage, venueCostCents + customCostsTotalCents, vendorCostCents)
  const ticketRevenueCents = summary.ticketed && paidAverage > 0 ? ticketPricing.recommendedCents * paidAverage : 0
  const hasBarRevenue = paidAverage > 0
    && summary.ticketed
    && /guests pay venue|cash bar|no-host/i.test(summary.food_responsibility ?? '')
  const barRevenueCents = hasBarRevenue ? Math.round(paidAverage * 2600) : 0
  const feesCents = Math.round(ticketRevenueCents * 0.049)
  const venueKickbackCents = guestCount > 100 ? (guestCount - 100) * 800 : 0
  const revenueShareCents = Math.round(Math.max(0, ticketRevenueCents - feesCents) * 0.12)
  const expectedCents = ticketRevenueCents + barRevenueCents - venueCostCents - vendorCostCents - customCostsTotalCents - feesCents - venueKickbackCents
  const conservativeCents = Math.round(expectedCents * 0.6)
  const upsideCents = Math.round(expectedCents * 1.45)
  const attendeeBasis = paidAverage || guestCount
  const perAttendeeNetCents = attendeeBasis > 0 ? Math.round(expectedCents / attendeeBasis) : null
  const totalCostCents = venueCostCents + vendorCostCents + customCostsTotalCents + feesCents + venueKickbackCents
  const breakEvenTickets =
    summary.ticketed && ticketPricing.recommendedCents > 0 && totalCostCents > 0
      ? Math.ceil(totalCostCents / ticketPricing.recommendedCents)
      : null

  const lineItems: ProfitModel['lineItems'] = [
    { label: `Ticket revenue (${paidAverage || 'TBD'} paid avg × ${formatCents(ticketPricing.recommendedCents)})`, amountCents: ticketRevenueCents },
    { label: 'Bar / drink mark-up', amountCents: barRevenueCents },
    { label: `Venue cost (${recommendations[0]?.name ?? 'target'})`, amountCents: venueCostCents, negative: true },
    { label: 'Vendor cost (catering, DJ, AV, security)', amountCents: vendorCostCents, negative: true },
    { label: 'Platform + payment fees (4.9%)', amountCents: feesCents, negative: true },
    { label: 'Community Host Incentive (per-head model)', amountCents: venueKickbackCents, negative: true },
  ]

  if (customCostsTotalCents > 0) {
    lineItems.push({ label: `Custom costs (${customCosts.length} item${customCosts.length === 1 ? '' : 's'})`, amountCents: customCostsTotalCents, negative: true })
  }

  return {
    conservativeCents,
    expectedCents,
    upsideCents,
    realisticCents: expectedCents,
    rangeLowCents: Math.min(conservativeCents, upsideCents),
    rangeHighCents: Math.max(conservativeCents, upsideCents),
    perAttendeeNetCents,
    paidAverage,
    venueKickbackCents,
    revenueShareCents,
    customCostsTotalCents,
    breakEvenTickets,
    ticketPricing: {
      ...ticketPricing,
      projectedMarginCents: expectedCents,
    },
    lineItems,
  }
}

/**
 * Builds open questions from missing or ambiguous event context.
 */
function buildOpenQuestions(summary: EventSummary, recommendations: RecommendationSummary[]) {
  const questions: string[] = []
  if (!summary.date) questions.push('Confirm target date or time window')
  if (!summary.area) questions.push('Choose preferred neighborhood or city')
  if (!summary.guest_count) questions.push('Set guest target')
  if (!summary.budget_cents) questions.push('Confirm rough budget')
  if (!summary.ticketing_model) questions.push('Choose ticketing model')
  if (!summary.food_responsibility) questions.push('Clarify who pays for food and drinks')
  if (!summary.venue_terms) questions.push('Choose venue deal structure')
  if (!summary.must_haves) questions.push('Add venue/vendor must-haves')
  if (!summary.action_permission) questions.push('Choose what the agent can do after recommendations')
  if (summary.ticketed && !summary.budget_cents) questions.push('Set ticket price assumptions')
  if (recommendations.length === 0) questions.push('Generate venue and vendor recommendations')

  return questions.slice(0, 4)
}

/**
 * Live plan side panel with structured artifact, profit model, approvals, and booking checklist.
 */
export const PlannerLivePlanPanel = memo(function PlannerLivePlanPanel({
  messages,
  planId,
  estimatedTotalCents,
  capLabel,
  budgetLineItems,
  approvals,
  spendingRules = defaultRules,
  sources = defaultSources,
  inline = false,
}: PlannerLivePlanPanelProps) {
  const [livePayload, setLivePayload] = useState<LivePlanPanelPayload>(emptyPayload)
  const [actionFeedback, setActionFeedback] = useState<Record<string, 'loading' | 'sent' | 'error'>>({})
  const [expandedAuthorizationDetails, setExpandedAuthorizationDetails] = useState<Record<string, boolean>>({})
  const [relativeNowMs, setRelativeNowMs] = useState(() => Date.now())
  const [isGeneratingTimeline, setIsGeneratingTimeline] = useState(false)
  const [timelineRetryError, setTimelineRetryError] = useState<string | null>(null)
  // Custom costs — sourced from persisted plan metadata, editable locally and persisted on change
  const [customCosts, setCustomCosts] = useState<CustomCostItem[]>([])
  const [newCostLabel, setNewCostLabel] = useState('')
  const [newCostAmount, setNewCostAmount] = useState('')
  const [customCostError, setCustomCostError] = useState<string | null>(null)
  const [isSavingCustomCosts, setIsSavingCustomCosts] = useState(false)
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const billingGate = usePlannerBillingGate()

  useEffect(() => {
    const initial = readLivePlanPayload()
    setLivePayload(initial)
    if (initial.plan?.customCosts?.length) setCustomCosts(initial.plan.customCosts)

    function handleLivePlanUpdate(event: Event) {
      const customEvent = event as CustomEvent<LivePlanPanelPayload | LivePlanSnapshot | null>
      const next = normalizeLivePlanPayload(customEvent.detail)
      setLivePayload(next)
      if (next.plan?.customCosts?.length) setCustomCosts(next.plan.customCosts)
    }

    window.addEventListener('planner-live-plan:update', handleLivePlanUpdate)
    return () => window.removeEventListener('planner-live-plan:update', handleLivePlanUpdate)
  }, [])

  useEffect(() => {
    const intervalId = window.setInterval(() => setRelativeNowMs(Date.now()), 30_000)
    return () => window.clearInterval(intervalId)
  }, [])

  const activeMessages = messages ?? livePayload.messages
  const livePlan = livePayload.plan
  const activePlanId = planId ?? livePayload.planId
  const runOfShow = livePlan?.runOfShow ?? deriveRunOfShowFromMessages(activeMessages)
  const workspaceSummary = livePlan?.workspaceSummary ?? deriveWorkspaceSummaryFromMessages(activeMessages)
  const updatedAtLabel = useMemo(
    () => formatRelativeTime(livePlan?.updatedAt ?? null, relativeNowMs),
    [livePlan?.updatedAt, relativeNowMs]
  )
  const baseEventSummary = deriveEventSummary(activeMessages, livePlan)
  const ticketPriceTargetCents = deriveTicketPriceTargetCents(baseEventSummary, livePlan, activeMessages)
  const eventSummary = applyTicketPriceIntent(baseEventSummary, ticketPriceTargetCents)
  const renderedBudgetLineItems = budgetLineItems ?? buildBudgetItems(eventSummary, livePlan)
  const renderedApprovals = approvals ?? deriveApprovals(activeMessages)
  const renderedRecommendations = deriveRecommendations(activeMessages)
  const recommendationMessageCount = useMemo(
    () => activeMessages.filter(isRecommendationPlanMessage).length,
    [activeMessages]
  )
  const primaryVenue = renderedRecommendations.find((recommendation) => /venue/i.test(recommendation.type)) ?? null
  const openQuestions = buildOpenQuestions(eventSummary, renderedRecommendations)
  const authorizationCards = buildAuthorizationCards(renderedApprovals, primaryVenue, renderedBudgetLineItems)
  const profitModel = useMemo(
    () => buildProfitModel(eventSummary, renderedRecommendations, renderedBudgetLineItems, customCosts),
    [eventSummary, renderedBudgetLineItems, renderedRecommendations, customCosts]
  )
  const renderedEstimatedTotal =
    estimatedTotalCents !== undefined ? formatCents(estimatedTotalCents) : formatCents(eventSummary.budget_cents)
  const title = derivePlanTitle(livePlan, eventSummary)
  const suggestedTicketPriceCents = ticketPriceTargetCents ?? profitModel.ticketPricing.recommendedCents
  const statusPillLabel = getStatusPillLabel({
    budgetCents: eventSummary.budget_cents,
    capLabel,
    recommendationCount: recommendationMessageCount,
    planStatus: livePlan?.status ?? null,
  })
  const isComparingCommercialModels = isRecommendBestModel(eventSummary.revenue_share)
  const primaryAuthorization = authorizationCards[0] ?? null
  const shoppingListItems = buildShoppingList(primaryVenue, renderedBudgetLineItems, eventSummary, livePlan?.selectedVendors ?? [])

  async function handleGenerateTimeline() {
    if (!activePlanId || activePlanId.startsWith('mock-plan-') || isGeneratingTimeline) return

    setIsGeneratingTimeline(true)
    setTimelineRetryError(null)

    try {
      const response = await fetch(`/api/planner/plans/${activePlanId}/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueLimit: 3, vendorLimit: 3 }),
      })
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok) {
        if (billingGate.handleBillingRequiredResponse(
          response,
          payload as { error?: string; message?: string; billingRequired?: boolean }
        )) {
          throw new Error('Choose a billing path to continue.')
        }
        throw new Error(readString(payload.error) ?? 'Could not generate timeline.')
      }

      const nextRunOfShow = normalizeRunOfShow(payload.timeline)
      const nextWorkspaceSummary = normalizeWorkspaceSummary(payload.workspace_summary)
      if (!nextRunOfShow && !nextWorkspaceSummary) throw new Error('Could not generate timeline.')

      setLivePayload((current) => {
        if (!current.plan) return current
        const nextPayload = {
          ...current,
          plan: {
            ...current.plan,
            runOfShow: nextRunOfShow ?? current.plan.runOfShow,
            workspaceSummary: nextWorkspaceSummary ?? current.plan.workspaceSummary,
          },
        }
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('planner-live-plan', JSON.stringify(nextPayload))
        }
        return nextPayload
      })
    } catch (error) {
      setTimelineRetryError(error instanceof Error ? error.message : 'Could not generate timeline.')
    } finally {
      setIsGeneratingTimeline(false)
    }
  }

  // Persists the current custom costs array to Supabase (debounced via ref).
  const persistCustomCosts = useCallback(async (costs: CustomCostItem[]) => {
    if (!activePlanId || activePlanId.startsWith('mock-plan-')) return
    setIsSavingCustomCosts(true)
    try {
      await fetch(`/api/planner/plans/${activePlanId}/custom-costs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_costs: costs }),
      })
    } catch {
      // Best-effort persist — user sees the change locally regardless
    } finally {
      setIsSavingCustomCosts(false)
    }
  }, [activePlanId])

  function handleAddCost() {
    const label = newCostLabel.trim()
    const amount = parseFloat(newCostAmount)
    if (!label) { setCustomCostError('Label is required'); return }
    if (!Number.isFinite(amount) || amount <= 0) { setCustomCostError('Amount must be greater than 0'); return }
    setCustomCostError(null)
    const newCost: CustomCostItem = {
      id: crypto.randomUUID(),
      label,
      amount,
      created_at: new Date().toISOString(),
    }
    const next = [...customCosts, newCost]
    setCustomCosts(next)
    setNewCostLabel('')
    setNewCostAmount('')
    if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current)
    persistTimeoutRef.current = setTimeout(() => void persistCustomCosts(next), 600)
  }

  function handleRemoveCost(id: string) {
    const next = customCosts.filter((c) => c.id !== id)
    setCustomCosts(next)
    if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current)
    persistTimeoutRef.current = setTimeout(() => void persistCustomCosts(next), 600)
  }

  async function handleAuthorizationAction(card: AuthorizationCardModel) {
    if (!activePlanId || activePlanId.startsWith('mock-plan-')) {
      requestSignupGateForAuthorization(card)
      return
    }

    setActionFeedback((current) => ({ ...current, [card.id]: 'loading' }))

    try {
      if (card.approvalId) {
        const response = await fetch(`/api/planner/plans/${activePlanId}/approvals`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approvalId: card.approvalId,
            action: 'authorize',
            authorizedAmountCents: card.amountCents,
          }),
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => ({} as { error?: string; message?: string; billingRequired?: boolean }))
          if (billingGate.handleBillingRequiredResponse(response, payload)) {
            throw new Error('Choose a billing path to continue.')
          }
          throw new Error('Unable to authorize approval')
        }
      } else {
        const response = await fetch(`/api/planner/plans/${activePlanId}/agent-actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actionType: 'hold_request',
            targetType: 'venue',
            payloadJson: {
              source: 'live_plan_panel',
              label: card.label,
              amountLabel: card.amountLabel,
            },
            requestedAmountCents: card.amountCents,
          }),
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => ({} as { error?: string; message?: string; billingRequired?: boolean }))
          if (billingGate.handleBillingRequiredResponse(response, payload)) {
            throw new Error('Choose a billing path to continue.')
          }
          throw new Error('Unable to create hold request')
        }
      }

      setActionFeedback((current) => ({ ...current, [card.id]: 'sent' }))
    } catch {
      setActionFeedback((current) => ({ ...current, [card.id]: 'error' }))
    }
  }

  /**
   * Asks the planner page to sign up the anonymous user, then resume this authorization.
   */
  function requestSignupGateForAuthorization(card: AuthorizationCardModel) {
    const detail: PendingConversionAction = card.approvalId
      ? {
          type: 'authorize',
          payload: {
            approvalId: card.approvalId,
            authorizedAmountCents: card.amountCents,
            agentAction: buildLivePlanAgentActionPayload(card),
          },
        }
      : {
          type: 'hold',
          payload: {
            agentAction: buildLivePlanAgentActionPayload(card),
          },
        }

    window.dispatchEvent(new CustomEvent('planner:signup-gate', { detail }))
  }

  return (
    <aside className={cn(
      'flex w-full min-w-0 flex-col bg-cream text-ink',
      inline ? '' : 'h-full border-l border-tan shadow-card'
    )}>
      <div className="border-b border-tan px-4 py-6">
        <div className="space-y-2">
          <p className="label-caps whitespace-nowrap text-ink-soft">Event Plan</p>
          {updatedAtLabel ? (
            <span className="inline-flex shrink-0 items-center gap-2 text-xs font-semibold text-forest">
              <span className="h-2 w-2 rounded-full bg-forest" />
              Updated {updatedAtLabel}
            </span>
          ) : null}
        </div>
        <h2 className="mt-4 break-words font-display text-xl font-semibold leading-[1.08] tracking-normal text-ink sm:text-2xl" title={title}>
          {title}
        </h2>
        <div className="mt-5 flex flex-wrap gap-2">
          <PlanPill>
            {eventSummary.area ? eventSummary.area.toUpperCase() : 'NEED AREA'} · {eventSummary.guest_count ? `${eventSummary.guest_count} GUESTS` : 'GUESTS TBD'}
          </PlanPill>
          <PlanPill>
            {formatTicketingPill(eventSummary, ticketPriceTargetCents)}
          </PlanPill>
          {statusPillLabel ? (
            <PlanPill intent={recommendationMessageCount > 0 ? 'recommended' : 'neutral'}>
              {statusPillLabel}
            </PlanPill>
          ) : null}
        </div>
      </div>

      <div
        className={cn(inline ? 'pb-4' : 'min-h-0 flex-1 overflow-y-auto pb-24')}
        data-planner-side-scroll={inline ? undefined : 'true'}
      >
        <ArtifactSection icon={<Sparkles className="h-5 w-5" />} title="Event Plan" subtitle="Structured artifact">
          <div className="grid gap-x-5 gap-y-5 [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))]">
            <ArtifactField label="Event Type" value={formatEventType(eventSummary.event_type)} />
            <ArtifactField label="Date Window" value={eventSummary.date ?? 'Need date'} />
            <ArtifactField label="Neighborhood" value={eventSummary.area ?? 'Need area'} />
            <ArtifactField label="Guest Target" value={eventSummary.guest_count ? String(eventSummary.guest_count) : 'Guests TBD'} />
            <ArtifactField label="Ticketing" value={formatTicketingModel(eventSummary, ticketPriceTargetCents)} />
            <ArtifactField label="Suggested Price" value={formatSuggestedPrice(eventSummary, ticketPriceTargetCents, suggestedTicketPriceCents)} />
            <ArtifactField label="Budget" value={livePlan?.budgetCapCents && livePlan.budgetCapCents > 0 ? formatCents(livePlan.budgetCapCents) : 'No cap set'} />
            <ArtifactField label="Food + Beverage" value={formatFoodResponsibilityValue(eventSummary.food_responsibility)} />
            <ArtifactField label="Venue Terms" value={formatVenueTermsValue(eventSummary)} />
            <ArtifactField label="Revenue Model" value={formatRevenueModelValue(eventSummary)} />
            <ArtifactField label="Agent Action" value={eventSummary.action_permission ?? 'Need approval rules'} />
            <RunOfShowField
              runOfShow={runOfShow}
              eventDate={livePlan?.dateWindowStart ?? livePlan?.dateWindowEnd ?? null}
              canGenerate={Boolean(activePlanId && !activePlanId.startsWith('mock-plan-'))}
              isGenerating={isGeneratingTimeline}
              error={timelineRetryError}
              onGenerate={handleGenerateTimeline}
            />
          </div>

          <div className="mt-7 rounded-lg border border-clay/25 bg-clay-tint/55 p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="label-caps text-clay">Top Venue</p>
                <p className="mt-3 break-words text-lg font-semibold leading-tight text-ink sm:text-xl" title={primaryVenue?.name ?? 'Recommendation pending'}>
                  {primaryVenue?.name ?? 'Recommendation pending'}
                </p>
                <p className="mt-1 flex min-w-0 items-start gap-1.5 break-words text-sm leading-snug text-ink-soft" title={venueMetaLabel(primaryVenue, eventSummary)}>
                  <MapPin className="h-4 w-4 shrink-0" />
                  {venueMetaLabel(primaryVenue, eventSummary)}
                </p>
                <p className="mt-3 break-words text-sm leading-snug text-clay-deep">
                  {workspaceSummary?.workspaceSummary
                    ?? (primaryVenue?.name
                      ? `${primaryVenue.name} will receive the plan after approval.`
                      : 'The agent will confirm details before outreach.')}
                </p>
                {workspaceSummary ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className={cn(
                      'rounded-full px-2 py-1 text-[11px] font-bold uppercase tracking-[0.06em]',
                      workspaceSummary.currentStatus === 'blocked'
                        ? 'bg-brick-tint text-brick'
                        : workspaceSummary.currentStatus === 'at_risk'
                          ? 'bg-ochre-tint text-ochre'
                          : 'bg-forest-tint text-forest'
                    )}>
                      {workspaceSummary.currentStatus.replace(/_/g, ' ')}
                    </span>
                    {workspaceSummary.approvalsNeeded.slice(0, 1).map((approval) => (
                      <span key={approval} className="rounded-full bg-cream px-2 py-1 text-[11px] font-semibold text-ink-soft">
                        {approval}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <Link
                href="/planner/venues"
                className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-clay transition-colors hover:text-clay-deep"
              >
                View
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-tan bg-cream-deep/50 p-5">
            <p className="label-caps text-ink-soft">Open Questions</p>
            {openQuestions.length > 0 ? (
              <div className="mt-4 space-y-2">
                {openQuestions.map((question) => (
                  <div key={question} className="flex items-start gap-3 text-base text-ink-soft">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-ochre" />
                    <span className="break-words leading-snug">{question}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 flex items-start gap-3 text-base text-ink-soft">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
                <span className="break-words leading-snug">Core plan details are coherent enough to request holds.</span>
              </div>
            )}
          </div>
        </ArtifactSection>

        <ArtifactSection icon={<TrendingUp className="h-5 w-5" />} title="Profit Window" subtitle="Realistic forecast + range">
          <div className="mb-5 rounded-lg border border-tan bg-cream-deep/50 p-5">
            <p className="label-caps text-ink-soft">Ticket Pricing</p>
            <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(118px,1fr))]">
              <PricingMetric label="Market avg" value={formatCents(profitModel.ticketPricing.marketAverageCents)} />
              <PricingMetric label="Break-even" value={eventSummary.ticketed ? formatCents(profitModel.ticketPricing.breakEvenCents) : 'N/A'} />
              <PricingMetric label="Recommend" value={eventSummary.ticketed ? formatCents(profitModel.ticketPricing.recommendedCents) : 'Free RSVP'} featured />
            </div>
            <p className="mt-4 text-sm leading-snug text-ink-soft">
              {profitModel.ticketPricing.rationale}
            </p>
          </div>
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
            <ProfitCard label="Realistic" value={profitModel.realisticCents} featured />
            <ProfitRangeCard label="Range" low={profitModel.rangeLowCents} high={profitModel.rangeHighCents} />
            <ProfitCard label="Per-attendee net" value={profitModel.perAttendeeNetCents} />
          </div>

          <div className="mt-5 overflow-hidden rounded-lg border border-tan bg-cream-deep/50">
            {profitModel.lineItems.map((item) => (
              <div key={item.label} className="flex min-w-0 items-center justify-between gap-5 border-b border-tan px-5 py-3 last:border-b-0">
                <span className="min-w-0 truncate text-base text-ink-soft" title={item.label}>{item.label}</span>
                <span className={cn('shrink-0 font-semibold tabular-nums', item.negative ? 'text-brick' : 'text-ink')}>
                  {item.negative ? '-' : ''}
                  {formatCents(item.amountCents)}
                </span>
              </div>
            ))}
            {profitModel.breakEvenTickets !== null ? (
              <div className="flex min-w-0 items-center justify-between gap-5 border-t border-clay/25 bg-clay-tint px-5 py-3">
                <span className="min-w-0 truncate text-sm font-semibold text-clay">Break-even tickets</span>
                <span className="shrink-0 font-bold tabular-nums text-clay">{profitModel.breakEvenTickets}</span>
              </div>
            ) : null}
          </div>

          {/* Custom costs */}
          <div className="mt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="label-caps text-ink-soft">
                Custom Costs
                {isSavingCustomCosts ? <span className="ml-2 text-[10px] font-normal normal-case text-ink-faint">saving…</span> : null}
              </p>
              {profitModel.customCostsTotalCents > 0 ? (
                <span className="shrink-0 text-sm font-semibold tabular-nums text-brick">
                  −{formatCents(profitModel.customCostsTotalCents)} total
                </span>
              ) : null}
            </div>

            {customCosts.length > 0 ? (
              <div className="mb-3 overflow-hidden rounded-lg border border-tan bg-cream-deep/50">
                {customCosts.map((cost) => (
                  <div key={cost.id} className="flex min-w-0 items-center justify-between gap-3 border-b border-tan px-4 py-3 last:border-b-0">
                    <span className="min-w-0 truncate text-sm text-ink" title={cost.label}>{cost.label}</span>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="tabular-nums text-sm font-semibold text-brick">
                        −{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cost.amount)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveCost(cost.id)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-brick-tint hover:text-brick"
                        aria-label={`Remove ${cost.label}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCostLabel}
                  onChange={(e) => { setNewCostLabel(e.target.value); setCustomCostError(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddCost() }}
                  placeholder="Label (e.g. Permit fees)"
                  maxLength={200}
                  className="min-w-0 flex-1 rounded-md border border-tan bg-cream-deep px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-clay/50 focus:outline-none focus:ring-1 focus:ring-clay/30"
                />
                <input
                  type="number"
                  value={newCostAmount}
                  onChange={(e) => { setNewCostAmount(e.target.value); setCustomCostError(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddCost() }}
                  placeholder="$"
                  min="0.01"
                  step="0.01"
                  className="w-24 shrink-0 rounded-md border border-tan bg-cream-deep px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-clay/50 focus:outline-none focus:ring-1 focus:ring-clay/30"
                />
              </div>
              {customCostError ? (
                <p className="text-xs font-medium text-brick">{customCostError}</p>
              ) : null}
              <button
                type="button"
                onClick={handleAddCost}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-tan bg-cream-deep px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-clay/40 hover:text-clay"
              >
                <Plus className="h-4 w-4" />
                Add cost
              </button>
            </div>
          </div>
        </ArtifactSection>

        <ArtifactSection
          icon={<WalletCards className="h-5 w-5" />}
          title="Venue Deal Models"
          subtitle={isComparingCommercialModels ? 'Agent comparison' : 'Compare structures'}
        >
          {isComparingCommercialModels ? (
            <p className="mb-4 rounded-md border border-clay/30 bg-clay-tint px-4 py-3 text-sm leading-snug text-ink-soft">
              The agent will compare flat rental, minimum spend, per-head incentives, bar share, and ticket share before asking you to approve outreach.
            </p>
          ) : null}
          <KickbackCard
            title="Per-head incentive"
            subtitle="$8 per attendee after 100"
            builderText={`Better for builder above ${Math.max(100, profitModel.paidAverage)}`}
            venueText="Capped upside"
            estimate={`≈ ${formatCents(profitModel.venueKickbackCents)} to venue at ${profitModel.paidAverage || 'TBD'}`}
            recommended={profitModel.venueKickbackCents <= profitModel.revenueShareCents}
          />
          <KickbackCard
            title="Ticket share"
            subtitle="12% of net ticket sales after fees"
            builderText="Lower if over-sold"
            venueText="Better for venue"
            estimate={`≈ ${formatCents(profitModel.revenueShareCents)} to venue at ${profitModel.paidAverage || 'TBD'}`}
            recommended={profitModel.revenueShareCents < profitModel.venueKickbackCents}
          />
        </ArtifactSection>

        <ArtifactSection icon={<ClipboardList className="h-5 w-5" />} title="Shopping List" subtitle={`${shoppingListItems.length} line items`}>
          <div className="space-y-7">
            {shoppingListItems.map((item) => (
              <div key={`${item.category}-${item.label}`} className="flex min-w-0 items-start justify-between gap-5">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-ink-faint">{item.category}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p className="break-words text-lg leading-tight text-ink" title={item.label}>{item.label}</p>
                    {item.badge ? (
                      <span className="rounded-full bg-secondary/15 px-2 py-0.5 text-xs font-medium text-secondary">
                        {item.badge}
                      </span>
                    ) : null}
                  </div>
                  {item.note ? (
                    <p className="mt-1 break-words text-sm leading-snug text-ink-soft" title={item.note}>{item.note}</p>
                  ) : null}
                </div>
                <span className="shrink-0 pt-5 text-lg font-semibold tabular-nums text-ink">{item.amountLabel}</span>
              </div>
            ))}
          </div>
        </ArtifactSection>

        <ArtifactSection icon={<ShieldCheck className="h-5 w-5" />} title="Payment + Agent Authorization" subtitle="Approve before action">
          <div className="space-y-4">
            {authorizationCards.map((approval) => {
              const feedback = actionFeedback[approval.id]
              const isLoading = feedback === 'loading'
              const isSent = feedback === 'sent'
              const isExpanded = Boolean(expandedAuthorizationDetails[approval.id])

              return (
                <div key={approval.id} className="rounded-lg border border-tan bg-cream-deep/50 p-5">
                  <div className="flex items-start justify-between gap-5">
                    <div className="min-w-0">
                      <h3 className="break-words text-lg font-semibold leading-tight text-ink sm:text-xl" title={approval.label}>{approval.label}</h3>
                      <p className="mt-1 break-words text-sm leading-snug text-ink-soft" title={approval.subtitle}>{approval.subtitle}</p>
                    </div>
                    <span className="shrink-0 text-xl font-semibold tabular-nums text-ink">{approval.amountLabel}</span>
                  </div>

                  {isExpanded ? (
                    <div className="mt-4 rounded-md border border-tan bg-cream p-3 text-sm text-ink-soft">
                      <p className="font-semibold text-ink">Action details</p>
                      <p className="mt-1">{approval.subtitle}</p>
                      <p className="mt-2">Approval is recorded before the agent contacts the venue or places a hold.</p>
                    </div>
                  ) : null}

                  <div className="mt-5 flex gap-3">
                    <button
                      type="button"
                      disabled={isLoading || isSent}
                      onClick={() => void handleAuthorizationAction(approval)}
                      className={cn(
                        'inline-flex flex-1 items-center justify-center rounded-md px-4 py-3 text-sm font-semibold transition-colors',
                        isSent
                          ? 'bg-forest text-cream'
                          : 'bg-gradient-brand text-cream hover:opacity-90',
                        (isLoading || isSent) && 'cursor-not-allowed opacity-90'
                      )}
                    >
                      {isLoading ? 'Sending...' : isSent ? 'Request sent ✓' : approval.amountCents === 0 ? 'Authorize' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => {
                        setExpandedAuthorizationDetails((current) => ({
                          ...current,
                          [approval.id]: !current[approval.id],
                        }))
                      }}
                      className="inline-flex items-center justify-center rounded-md border border-tan px-4 py-3 text-sm font-semibold text-ink transition-colors hover:bg-cream"
                    >
                      Details
                    </button>
                  </div>
                  {feedback === 'error' ? (
                    <p className="mt-3 text-sm font-medium text-brick">Failed - try again</p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </ArtifactSection>

        <ArtifactSection icon={<Check className="h-5 w-5" />} title="Connected Data" subtitle={`${sources.length} sources available`}>
          <div className="flex flex-wrap gap-2">
            {sources.map((source) => (
              <span key={source} className="inline-flex items-center gap-1.5 rounded-full border border-tan bg-cream-deep px-3 py-1.5 text-xs font-semibold text-ink-soft">
                <Check className="h-3 w-3 text-forest" />
                {source}
              </span>
            ))}
          </div>
          <div className="mt-5 space-y-2">
            {spendingRules.map((rule) => (
              <div key={rule.label} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-ink-soft" title={rule.label}>{rule.label}</span>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', rule.enabled ? 'bg-forest-tint text-forest' : 'bg-cream-deep text-ink-soft')}>
                  {rule.enabled ? 'On' : 'Off'}
                </span>
              </div>
            ))}
          </div>
        </ArtifactSection>
      </div>

      <div className="border-t border-tan bg-cream/95 px-4 py-4 backdrop-blur">
        <button
          type="button"
          disabled={!primaryAuthorization || actionFeedback[primaryAuthorization.id] === 'loading' || actionFeedback[primaryAuthorization.id] === 'sent'}
          onClick={() => {
            if (primaryAuthorization) void handleAuthorizationAction(primaryAuthorization)
          }}
          className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-md bg-gradient-brand px-5 py-3 text-center text-base font-semibold leading-snug text-cream shadow-glow transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Check className="h-5 w-5" />
          {primaryAuthorization && actionFeedback[primaryAuthorization.id] === 'sent'
            ? 'Request sent ✓'
            : primaryAuthorization
              ? 'Request venue hold'
              : 'Complete plan for holds'}
        </button>
        <p className="mt-2 truncate text-center text-xs text-ink-faint" title={activePlanId ? `Plan ${activePlanId}` : 'Plan saves after sign-in'}>
          {activePlanId ? `Plan ${activePlanId.slice(-6)}` : 'Plan saves after sign-in'}
        </p>
      </div>
      {billingGate.modal}
    </aside>
  )
})

PlannerLivePlanPanel.displayName = 'PlannerLivePlanPanel'

/**
 * Builds the same agent-action payload the live plan panel uses once a plan is saved.
 */
function buildLivePlanAgentActionPayload(card: AuthorizationCardModel): PlannerAgentActionRequest {
  return {
    actionType: 'hold_request',
    targetType: 'venue',
    targetId: null,
    payloadJson: {
      source: 'live_plan_panel',
      label: card.label,
      action_label: card.label,
      provider: card.label.replace(/^Approve\s+/i, '').replace(/\s+estimate$/i, '') || 'Recommended venue',
      amountLabel: card.amountLabel,
      price_cents: card.amountCents,
      fees_cents: 0,
      package_details: card.subtitle,
    },
    requestedAmountCents: card.amountCents,
  }
}

function ArtifactSection({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-tan px-4 py-7">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-cream-deep text-ink-soft">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="break-words text-lg font-semibold leading-tight text-ink" title={title}>{title}</h3>
          <p className="break-words text-sm leading-snug text-ink-soft" title={subtitle}>{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function ArtifactField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-faint">{label}</p>
      <p className="mt-2 break-words text-lg leading-tight text-ink sm:text-xl" title={value}>{value}</p>
    </div>
  )
}

function RunOfShowField({
  runOfShow,
  eventDate,
  canGenerate,
  isGenerating,
  error,
  onGenerate,
}: {
  runOfShow: RunOfShowSnapshot | null
  eventDate: string | null
  canGenerate: boolean
  isGenerating: boolean
  error: string | null
  onGenerate: () => void
}) {
  const milestones = runOfShow?.planningMilestones ?? []
  const visibleMilestones = milestones.slice(0, 3)
  const hiddenCount = Math.max(milestones.length - visibleMilestones.length, 0)

  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-faint">Run of Show</p>
      {visibleMilestones.length > 0 ? (
        <div className="mt-2 space-y-2">
          {visibleMilestones.map((milestone) => (
            <p key={`${milestone.dueDate}-${milestone.title}`} className="break-words text-sm leading-snug text-ink" title={milestone.title}>
              <span className="font-semibold text-clay">{formatRunOfShowDateLabel(milestone.dueDate, eventDate)}</span>
              <span className="text-ink-soft"> · </span>
              {milestone.title}
              <span className="text-ink-soft"> · pending</span>
            </p>
          ))}
          {hiddenCount > 0 ? (
            <Link href="/planner?tab=timeline" className="inline-flex text-sm font-semibold text-clay hover:text-clay-deep">
              + {hiddenCount} more
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="break-words text-lg leading-tight text-ink sm:text-xl">Not set</p>
          {canGenerate ? (
            <button
              type="button"
              onClick={onGenerate}
              disabled={isGenerating}
              className="inline-flex items-center gap-1.5 rounded-full border border-tan bg-cream-deep px-3 py-1.5 text-xs font-bold text-ink-soft transition-colors hover:border-clay/50 hover:text-clay disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isGenerating ? 'animate-spin' : '')} />
              {isGenerating ? 'Generating' : 'Generate timeline'}
            </button>
          ) : null}
          {error ? <p className="text-xs text-brick">{error}</p> : null}
        </div>
      )}
    </div>
  )
}

function PlanPill({ children, intent = 'neutral' }: { children: React.ReactNode; intent?: 'neutral' | 'recommended' }) {
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center rounded-full px-3 py-2 text-xs font-bold uppercase leading-tight tracking-[0.04em]',
        intent === 'recommended' ? 'bg-clay text-cream' : 'bg-cream-deep text-ink-soft'
      )}
    >
      {children}
    </span>
  )
}

function ProfitCard({ label, value, featured = false }: { label: string; value: number | null; featured?: boolean }) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-md px-4 py-4 text-center',
        featured ? 'bg-gradient-brand text-cream shadow-glow' : 'bg-cream-deep text-ink'
      )}
    >
      <p className={cn('whitespace-nowrap text-xs font-bold uppercase leading-none tracking-[0.08em]', featured ? 'text-cream/80' : 'text-ink-faint')}>{label}</p>
      <p className="mt-3 whitespace-nowrap font-display text-2xl leading-none tabular-nums">{value === null ? 'TBD' : formatCents(value)}</p>
    </div>
  )
}

function ProfitRangeCard({ label, low, high }: { label: string; low: number; high: number }) {
  return (
    <div className="min-w-0 rounded-md bg-cream-deep px-4 py-4 text-center text-ink">
      <p className="whitespace-nowrap text-xs font-bold uppercase leading-none tracking-[0.08em] text-ink-faint">{label}</p>
      <p className="mt-3 whitespace-nowrap font-display text-xl leading-none tabular-nums">
        {formatCents(low)} - {formatCents(high)}
      </p>
    </div>
  )
}

function PricingMetric({ label, value, featured = false }: { label: string; value: string; featured?: boolean }) {
  return (
    <div className={cn('min-w-0 rounded-md p-3', featured ? 'bg-gradient-brand text-cream' : 'bg-cream-deep text-ink')}>
      <p className={cn('whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.08em]', featured ? 'text-cream/80' : 'text-ink-faint')}>
        {label}
      </p>
      <p className="mt-2 truncate text-lg font-semibold tabular-nums" title={value}>{value}</p>
    </div>
  )
}

function KickbackCard({
  title,
  subtitle,
  builderText,
  venueText,
  estimate,
  recommended,
}: {
  title: string
  subtitle: string
  builderText: string
  venueText: string
  estimate: string
  recommended: boolean
}) {
  return (
    <div className={cn('mb-4 rounded-lg border p-4 last:mb-0', recommended ? 'border-clay/40 bg-clay-tint/55' : 'border-tan bg-cream-deep/50')}>
      <div className="flex min-w-0 flex-col gap-3">
        {recommended ? (
          <span className="inline-flex w-fit max-w-full shrink-0 whitespace-nowrap rounded-md bg-gradient-brand px-3 py-2 text-[11px] font-bold uppercase leading-none tracking-normal text-cream">
            Best fit
          </span>
        ) : null}
        <div className="min-w-0">
          <h3 className="whitespace-normal text-lg font-semibold leading-tight text-ink [overflow-wrap:normal]" title={title}>{title}</h3>
          <p className="mt-2 whitespace-normal text-sm leading-snug text-ink-soft [overflow-wrap:normal]" title={subtitle}>{subtitle}</p>
        </div>
      </div>
      <div className="mt-5 grid gap-3 text-sm text-ink-soft [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))]">
        <p className="whitespace-normal leading-snug [overflow-wrap:normal]"><span className="text-ink-faint">Builder:</span> {builderText}</p>
        <p className="whitespace-normal leading-snug [overflow-wrap:normal]"><span className="text-ink-faint">Venue:</span> {venueText}</p>
      </div>
      <p className="mt-5 whitespace-normal border-t border-tan pt-4 text-sm font-semibold leading-snug text-ink [overflow-wrap:normal]">{estimate}</p>
    </div>
  )
}

function derivePlanTitle(plan: LivePlanSnapshot | null, summary: EventSummary) {
  if (plan?.title && plan.title !== 'Untitled plan') return plan.title

  const area = summary.area
  const eventType = formatEventType(summary.event_type)
  if (area && summary.event_type) return `${area} ${eventType}`
  return `${eventType} Plan`
}

function isPaidTicketingModel(value: string | null) {
  if (!value) return null
  if (/\b(paid|ticketed|sell tickets|admission|dinner ticket|external)\b/i.test(value)) return true
  if (/\b(free|rsvp|invite-only|invite only|no ticket)\b/i.test(value)) return false
  return null
}

function applyTicketPriceIntent(summary: EventSummary, ticketPriceTargetCents: number | null): EventSummary {
  if (!ticketPriceTargetCents || ticketPriceTargetCents <= 0 || summary.ticketed === true) return summary

  return {
    ...summary,
    ticketed: true,
    ticketing_model: summary.ticketing_model ?? 'Ticketed',
  }
}

function getTicketedState(summary: EventSummary, ticketPriceTargetCents: number | null) {
  if (summary.ticketed === false) return false
  if (ticketPriceTargetCents && ticketPriceTargetCents > 0) return true
  return summary.ticketed
}

function formatTicketingModel(summary: EventSummary, ticketPriceTargetCents: number | null) {
  const ticketed = getTicketedState(summary, ticketPriceTargetCents)

  if (ticketed === true) {
    return ticketPriceTargetCents && ticketPriceTargetCents > 0
      ? `Ticketed · ${formatCents(ticketPriceTargetCents)} per ticket`
      : 'Ticketed · price TBD'
  }

  if (ticketed === false) return 'RSVP only'
  return 'Need ticketing model'
}

function formatSuggestedPrice(
  summary: EventSummary,
  ticketPriceTargetCents: number | null,
  suggestedTicketPriceCents: number
) {
  const ticketed = getTicketedState(summary, ticketPriceTargetCents)
  if (ticketed === false) return 'Not ticketed'
  if (ticketed !== true) return 'Need ticketing model'
  if (ticketPriceTargetCents && ticketPriceTargetCents > 0) return formatCents(ticketPriceTargetCents)
  if (suggestedTicketPriceCents > 0) return formatCents(suggestedTicketPriceCents)
  return 'Price TBD'
}

function deriveTicketPriceTargetCents(
  summary: EventSummary,
  plan: LivePlanSnapshot | null,
  messages: PlanMessage[]
) {
  if (plan?.ticketed === false || summary.ticketed === false) return null
  if (plan?.ticketPriceTargetCents && plan.ticketPriceTargetCents > 0) return plan.ticketPriceTargetCents

  const metadataPrice = findTicketPriceInMessageMetadata(messages)
  if (metadataPrice) return metadataPrice

  const textCandidates = [
    summary.ticketing_model,
    plan?.ticketingModel,
    plan?.notes,
    ...messages.slice(-6).map((message) => message.content),
  ]

  for (const candidate of textCandidates) {
    const parsed = extractTicketPriceCents(candidate)
    if (parsed) return parsed
  }

  return null
}

function findTicketPriceInMessageMetadata(messages: PlanMessage[]) {
  for (const message of [...messages].reverse()) {
    const found = findTicketPriceInUnknown(message.metadata)
    if (found) return found
  }

  return null
}

function findTicketPriceInUnknown(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTicketPriceInUnknown(item)
      if (found) return found
    }
    return null
  }

  const record = value as Record<string, unknown>
  const direct =
    readNumber(record.ticket_price_target_cents) ??
    readNumber(record.ticket_price_cents) ??
    normalizePotentialTicketPrice(readNumber(record.ticket_price_target))
  if (direct && direct > 0) return direct

  for (const nested of Object.values(record)) {
    const found = findTicketPriceInUnknown(nested)
    if (found) return found
  }

  return null
}

function normalizePotentialTicketPrice(value: number | null) {
  if (!value || value <= 0) return null
  return value >= 1000 ? Math.round(value) : Math.round(value * 100)
}

function extractTicketPriceCents(value: string | null | undefined) {
  if (!value) return null

  const patterns = [
    /\b(?:ticketed|tickets?|ticket\s+price|price|admission|ga|general admission)\s*(?:is|at|for|=|:)?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(k)?\b/i,
    /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(k)?\s*(?:per\s+)?(?:ticket|admission|ga)\b/i,
  ]

  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (!match) continue
    const dollars = Number(match[1].replaceAll(',', '')) * (match[2] ? 1000 : 1)
    if (Number.isFinite(dollars) && dollars > 0) return Math.round(dollars * 100)
  }

  return null
}

function deriveBudgetCapCentsFromMessages(messages: PlanMessage[]) {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user') continue
    const parsed = extractBudgetCapCents(message.content)
    if (parsed) return parsed
  }

  return null
}

function extractBudgetCapCents(value: string | null | undefined) {
  if (!value) return null

  const patterns = [
    /\b(?:budget|spend|spending cap|target spend|all-in|all in)\b.{0,32}?\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(k)?\b/i,
    /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(k)?\s*(?:budget|spend|spending cap|target spend|all-in|all in)\b/i,
    /\b(?:under|up to|max(?:imum)?|cap(?:ped)? at)\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(k)?\b/i,
  ]

  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (!match) continue
    const dollars = Number(match[1].replaceAll(',', '')) * (match[2] ? 1000 : 1)
    if (Number.isFinite(dollars) && dollars > 0) return Math.round(dollars * 100)
  }

  return null
}

function formatFoodResponsibilityValue(value: string | null) {
  if (!value || /^food\/beverage$/i.test(value)) return 'Need food model'
  return value
}

function formatVenueTermsValue(summary: EventSummary) {
  if (summary.venue_terms) return summary.venue_terms
  if (isRecommendBestModel(summary.revenue_share)) return 'Flexible while agent compares'
  return 'Need terms'
}

function formatRevenueModelValue(summary: EventSummary) {
  if (isRecommendBestModel(summary.revenue_share)) return 'Agent recommends best model'
  return summary.revenue_share ?? 'Need revenue model'
}

function isRecommendBestModel(value: string | null | undefined) {
  return /\brecommend best model|recommend model|compare\b/i.test(value ?? '')
}

function getStatusPillLabel({
  budgetCents,
  capLabel,
  recommendationCount,
  planStatus,
}: {
  budgetCents: number | null
  capLabel?: string
  recommendationCount: number
  planStatus: string | null
}) {
  if (recommendationCount > 0) return capLabel?.toUpperCase() ?? 'RECOMMENDED'
  if (!budgetCents || budgetCents <= 0) return 'BUDGET PENDING'
  if (planStatus === 'ready') return 'AWAITING RECS'
  return null
}

function formatTicketingPill(summary: EventSummary, ticketPriceTargetCents: number | null) {
  const ticketed = getTicketedState(summary, ticketPriceTargetCents)

  if (ticketed === true) {
    return ticketPriceTargetCents && ticketPriceTargetCents > 0
      ? `TICKETED · ${formatCents(ticketPriceTargetCents)}`
      : 'TICKETED · PRICE TBD'
  }

  if (ticketed === false) return 'RSVP ONLY'
  return 'TICKETING TBD'
}

function hasNoOrganizerFoodCost(summary: EventSummary) {
  return /\b(guests pay|no food|sponsor covers)\b/i.test(summary.food_responsibility ?? '')
}

function venueBudgetLabel(summary: EventSummary) {
  if (/\bminimum spend\b/i.test(summary.venue_terms ?? '')) return 'Minimum spend target'
  if (/\bfree space\b/i.test(summary.venue_terms ?? '')) return 'Free venue target'
  return 'Venue target'
}

function foodBudgetLabel(summary: EventSummary) {
  if (/\bguests pay\b/i.test(summary.food_responsibility ?? '')) return 'Guest-paid food'
  if (/\bno food\b/i.test(summary.food_responsibility ?? '')) return 'No food package'
  if (/\bsponsor covers\b/i.test(summary.food_responsibility ?? '')) return 'Sponsor-paid food'
  if (/\bticket includes\b/i.test(summary.food_responsibility ?? '')) return 'Ticket-included food'
  return 'Dinner package'
}

function getVenueTargetRatio(summary: EventSummary) {
  if (/\b(free space|minimum spend)\b/i.test(summary.venue_terms ?? '')) return 0
  if (isDinnerLike(summary.event_type) && hasNoOrganizerFoodCost(summary)) return 0.25
  return 0.55
}

function buildTicketPricingModel(
  summary: EventSummary,
  paidAverage: number,
  venueCostCents: number,
  vendorCostCents: number
): TicketPricingModel {
  const marketAverageCents = getMarketAverageTicketCents(summary)
  const fixedCostCents = Math.max(0, venueCostCents + vendorCostCents)
  const targetProfitCents = Math.round(fixedCostCents * 0.25)
  const breakEvenCents = paidAverage > 0
    ? roundUpToTicketStep(Math.round(fixedCostCents / Math.max(1, paidAverage) / 0.951))
    : 0
  const targetPriceCents = paidAverage > 0
    ? roundUpToTicketStep(Math.round((fixedCostCents + targetProfitCents) / Math.max(1, paidAverage) / 0.951))
    : marketAverageCents

  if (!summary.ticketed) {
    return {
      marketAverageCents,
      recommendedCents: 0,
      breakEvenCents,
      targetProfitCents,
      projectedMarginCents: 0,
      rationale: `This is currently modeled as free/RSVP. Similar ${formatEventType(summary.event_type).toLowerCase()} events often price around ${formatCents(marketAverageCents)} when ticketed.`,
    }
  }

  const pricingCeilingCents = marketAverageCents > 0 ? Math.round(marketAverageCents * 1.35) : Math.max(targetPriceCents, 5000)
  const recommendedCents = hasNoOrganizerFoodCost(summary) && breakEvenCents > pricingCeilingCents
    ? marketAverageCents
    : Math.max(marketAverageCents, Math.min(targetPriceCents, pricingCeilingCents))
  const projectedRevenueCents = recommendedCents * paidAverage
  const projectedMarginCents = Math.round(projectedRevenueCents * 0.951) - fixedCostCents
  const rationale = buildTicketPricingRationale(summary, marketAverageCents, recommendedCents, breakEvenCents, projectedMarginCents)

  return {
    marketAverageCents,
    recommendedCents,
    breakEvenCents,
    targetProfitCents,
    projectedMarginCents,
    rationale,
  }
}

function getMarketAverageTicketCents(summary: EventSummary) {
  const eventType = (summary.event_type ?? '').toLowerCase()

  if (isDinnerLike(summary.event_type)) {
    if (/\bticket includes\b/i.test(summary.food_responsibility ?? '')) return 8500
    if (/\bguests pay\b/i.test(summary.food_responsibility ?? '')) return 3000
    return 6500
  }
  if (eventType.includes('conference') || eventType.includes('summit')) return 15000
  if (eventType.includes('retreat')) return 25000
  if (eventType.includes('fundraiser') || eventType.includes('gala')) return 17500
  if (eventType.includes('food') || eventType.includes('wine') || eventType.includes('tasting')) return 6500
  if (eventType.includes('workshop') || eventType.includes('class')) return 4500
  if (eventType.includes('game')) return 7500
  if (eventType.includes('concert') || eventType.includes('performance')) return 3500
  if (eventType.includes('tennis') || eventType.includes('fitness')) return 3500
  if (eventType.includes('day party')) return 3500
  if (eventType.includes('club')) return 2500
  if (eventType.includes('panel') || eventType.includes('demo day') || eventType.includes('listening')) return 2500
  if (eventType.includes('mixer') || eventType.includes('meetup')) return 2000
  if (eventType.includes('watch')) return 1500
  if (eventType.includes('run club')) return 1000
  if (eventType.includes('pop-up') || eventType.includes('launch')) return 0

  return 2500
}

function roundUpToTicketStep(valueCents: number) {
  if (valueCents <= 0) return 0
  return Math.ceil(valueCents / 500) * 500
}

function buildTicketPricingRationale(
  summary: EventSummary,
  marketAverageCents: number,
  recommendedCents: number,
  breakEvenCents: number,
  projectedMarginCents: number
) {
  if (hasNoOrganizerFoodCost(summary) && breakEvenCents > Math.round(marketAverageCents * 1.35)) {
    return `Recommend ${formatCents(recommendedCents)} because the ticket should cover access/community, not guest food. To protect profit, use free space, minimum spend, or a low deposit instead of pricing above market.`
  }

  if (projectedMarginCents >= 0) {
    return `Recommend ${formatCents(recommendedCents)} based on event-type demand and a ${formatCents(breakEvenCents)} break-even point. This keeps projected margin positive before final venue terms.`
  }

  return `Market average is around ${formatCents(marketAverageCents)}, but current costs imply a ${formatCents(breakEvenCents)} break-even. The agent should reduce venue/vendor cost before raising ticket price.`
}

function deriveRunOfShowFromMessages(messages: PlanMessage[]): RunOfShowSnapshot | null {
  const recommendation = readLatestRecommendationResponse(messages)
  return normalizeRunOfShow(recommendation?.timeline)
}

function deriveWorkspaceSummaryFromMessages(messages: PlanMessage[]): WorkspaceSummarySnapshot | null {
  const recommendation = readLatestRecommendationResponse(messages)
  return normalizeWorkspaceSummary(recommendation?.workspace_summary)
}

function readLatestRecommendationResponse(messages: PlanMessage[]): Record<string, unknown> | null {
  for (const message of [...messages].reverse()) {
    if (String(message.message_type) !== 'recommendation') continue
    const metadata = asRecord(message.metadata)
    const response = asRecord(metadata?.recommendation_response)
    if (response) return response
    if (asRecord(metadata?.timeline) || asRecord(metadata?.workspace_summary)) return metadata
  }

  return null
}

function normalizeRunOfShow(value: unknown): RunOfShowSnapshot | null {
  const record = asRecord(value)
  if (!record) return null
  const rawMilestones = Array.isArray(record.planningMilestones)
    ? record.planningMilestones
    : Array.isArray(record.planning_milestones)
      ? record.planning_milestones
      : []
  const planningMilestones = rawMilestones
    .map((item) => {
      const milestone = asRecord(item)
      if (!milestone) return null
      const title = readString(milestone.title)
      const dueDate = readString(milestone.dueDate) ?? readString(milestone.due_date)
      if (!title || !dueDate) return null
      return {
        title,
        dueDate,
        category: readString(milestone.category) ?? 'planning',
        isBlocking: readBoolean(milestone.isBlocking) ?? readBoolean(milestone.is_blocking) ?? false,
      }
    })
    .filter((item): item is RunOfShowMilestone => item !== null)

  if (planningMilestones.length === 0) return null
  return {
    planningMilestones,
    impossibleTimeline: readBoolean(record.impossibleTimeline) ?? readBoolean(record.impossible_timeline) ?? false,
  }
}

function normalizeWorkspaceSummary(value: unknown): WorkspaceSummarySnapshot | null {
  const record = asRecord(value)
  if (!record) return null
  const workspaceSummary = readString(record.workspaceSummary) ?? readString(record.workspace_summary)
  if (!workspaceSummary) return null
  const currentStatus = readString(record.currentStatus) ?? readString(record.current_status)
  const parsedStatus =
    currentStatus === 'blocked' || currentStatus === 'at_risk' || currentStatus === 'on_track'
      ? currentStatus
      : 'at_risk'

  return {
    workspaceSummary,
    currentStatus: parsedStatus,
    blockers: readStringArray(record.blockers),
    recommendedNextActions: readStringArray(record.recommendedNextActions ?? record.recommended_next_actions),
    approvalsNeeded: readStringArray(record.approvalsNeeded ?? record.approvals_needed),
  }
}

function formatRunOfShowDateLabel(dueDate: string, eventDate: string | null): string {
  if (!eventDate) return dueDate
  const due = parseDateOnly(dueDate)
  const event = parseDateOnly(eventDate)
  if (!due || !event) return dueDate
  const diffDays = Math.round((event.getTime() - due.getTime()) / (24 * 60 * 60 * 1000))
  if (diffDays === 0) return 'Event day'
  if (diffDays > 0) return `T-${diffDays} days`
  return `T+${Math.abs(diffDays)} days`
}

function parseDateOnly(value: string): Date | null {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function venueMetaLabel(recommendation: RecommendationSummary | null, summary: EventSummary) {
  if (!recommendation) return summary.area ? `${summary.area} · recommendation pending` : 'Recommendation pending'
  const address = recommendation.address ?? summary.area ?? 'Bay Area'
  const capacity = recommendation.capacity ? `Cap ${recommendation.capacity}` : 'Capacity pending'
  return `${address} · ${capacity}`
}

function buildShoppingList(
  primaryVenue: RecommendationSummary | null,
  budgetItems: BudgetLineItem[],
  summary: EventSummary,
  selectedVendors: SelectedPlanVendor[] = []
): ShoppingListItem[] {
  const venueCost = primaryVenue?.priceCents ?? budgetItems[0]?.amountCents ?? null
  const vendorCost = budgetItems.find((item) => /vendor|dinner|food/i.test(item.label))?.amountCents ?? null
  const guestCount = summary.guest_count ?? 0
  const noOrganizerFoodCost = hasNoOrganizerFoodCost(summary)
  const items: ShoppingListItem[] = []

  addShoppingItem(items, {
    category: 'Venue',
    label: primaryVenue?.name ?? deriveVenueShoppingLabel(summary),
    amountLabel: formatVenueShoppingAmount(summary, venueCost),
    note: primaryVenue?.fit ?? deriveVenueShoppingNote(summary),
  })

  if (shouldIncludeFood(summary)) {
    addShoppingItem(items, {
      category: 'Food + Beverage',
      label: deriveFoodShoppingLabel(summary),
      amountLabel: deriveFoodShoppingAmount(summary, vendorCost),
      note: noOrganizerFoodCost
        ? 'Organizer does not carry the per-person food cost.'
        : 'Adjusts once menu, minimum, or package terms are selected.',
    })
  }

  for (const vendor of selectedVendors) {
    addShoppingItem(items, {
      category: formatVendorServiceCategory(vendor.serviceType),
      label: vendor.name,
      amountLabel: typeof vendor.priceCents === 'number' ? formatCents(vendor.priceCents) : formatVendorRateAmount(vendor),
      note: vendor.provenanceLabel ?? deriveSelectedVendorNote(vendor),
      badge: vendor.claimStatus === 'invited_unclaimed' ? 'Invited — pending signup' : undefined,
    })
  }

  for (const need of deriveVendorNeedItems(summary)) {
    addShoppingItem(items, need)
  }

  if (shouldIncludeAv(summary)) {
    addShoppingItem(items, {
      category: 'AV / Production',
      label: deriveAvShoppingLabel(summary),
      amountLabel: formatCents(deriveAvEstimateCents(summary)),
      note: 'Estimate updates when venue built-in AV is known.',
    })
  }

  if (shouldIncludeSecurity(summary)) {
    addShoppingItem(items, {
      category: summary.ticketed ? 'Check-in / Security' : 'Guest Operations',
      label: deriveSecurityShoppingLabel(summary),
      amountLabel: formatCents(deriveSecurityEstimateCents(summary)),
      note: 'Sized from guest count, ticketing, and public/private event risk.',
    })
  }

  if (shouldIncludePhotography(summary)) {
    addShoppingItem(items, {
      category: 'Photo / Content',
      label: derivePhotographyShoppingLabel(summary),
      amountLabel: formatCents(55000),
      note: 'Optional until the organizer confirms content needs.',
    })
  }

  if (shouldIncludeSportOps(summary)) {
    addShoppingItem(items, {
      category: 'Activity Ops',
      label: deriveActivityShoppingLabel(summary),
      amountLabel: 'TBD',
      note: 'Depends on route, courts, equipment, instructor, or permit needs.',
    })
  }

  addShoppingItem(items, {
    category: 'Ticketing / RSVP',
    label: deriveTicketingShoppingLabel(summary),
    amountLabel: 'Included',
    note: summary.ticketed
      ? 'Connect Luma, Posh, Partiful, or Eventbrite once the event page exists.'
      : 'Used for headcount tracking even when tickets are free.',
  })

  return items
}

function formatVendorServiceCategory(serviceType: string | null) {
  if (!serviceType) return 'Vendor'
  return serviceType
    .split('_')
    .filter(Boolean)
    .map((part) => (part.toLowerCase() === 'av' ? 'AV' : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join(' ')
}

function formatVendorRateAmount(vendor: SelectedPlanVendor) {
  if (typeof vendor.rateAmount !== 'number') return 'TBD'
  const amount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(vendor.rateAmount)
  if (vendor.rateType === 'per_person') return `${amount}/person`
  if (vendor.rateType === 'hourly') return `${amount}/hr`
  return amount
}

function deriveSelectedVendorNote(vendor: SelectedPlanVendor) {
  if (vendor.claimStatus === 'invited_unclaimed') return 'Waiting for the vendor to claim the invite and confirm or counter the private rate.'
  if (vendor.rateSource === 'confirmed_private_rate') return 'Using your last confirmed private rate with this vendor.'
  if (vendor.rateSource === 'organizer_entered') return 'Organizer-entered rate; vendor confirmation may create a new agreement.'
  return 'Confirm availability and final quote before approval.'
}

function addShoppingItem(items: ShoppingListItem[], item: ShoppingListItem) {
  const key = `${item.category}:${item.label}`.toLowerCase()
  const alreadyExists = items.some((current) => `${current.category}:${current.label}`.toLowerCase() === key)
  if (!alreadyExists) items.push(item)
}

function deriveVenueShoppingLabel(summary: EventSummary) {
  const eventType = formatEventType(summary.event_type).toLowerCase()
  if (isDinnerLike(summary.event_type) && hasNoOrganizerFoodCost(summary)) return 'Guest-pay private dining room'
  if (summary.area && summary.event_type) return `${summary.area} ${eventType} venue`
  if (summary.event_type) return `${formatEventType(summary.event_type)} venue match`
  return 'Venue match pending'
}

function deriveVenueShoppingNote(summary: EventSummary) {
  if (summary.venue_terms) return summary.venue_terms
  if (summary.area) return `Find capacity-fit options near ${summary.area}.`
  return 'Waiting on area, guest count, and budget.'
}

function formatVenueShoppingAmount(summary: EventSummary, venueCost: number | null) {
  if (/\bfree space\b/i.test(summary.venue_terms ?? '')) return 'Free target'
  if (/\bminimum spend\b/i.test(summary.venue_terms ?? '')) return 'Minimum'
  return formatCents(venueCost)
}

function shouldIncludeFood(summary: EventSummary) {
  if (/\bno food\b/i.test(summary.food_responsibility ?? '')) return true
  if (isDinnerLike(summary.event_type)) return true
  if (summaryMatches(summary, /\b(catering|food|dinner|meal|menu|bar|drink|cocktail|wine|tasting|brunch|light bites|snacks)\b/i)) {
    return true
  }
  return false
}

function deriveFoodShoppingLabel(summary: EventSummary) {
  if (/\bno food\b/i.test(summary.food_responsibility ?? '')) return 'No food package'
  if (/\bguests pay\b/i.test(summary.food_responsibility ?? '')) return 'Guests order and pay at venue'
  if (/\bsponsor covers\b/i.test(summary.food_responsibility ?? '')) return 'Sponsor-covered food package'
  if (/\bticket includes\b/i.test(summary.food_responsibility ?? '')) return 'Ticket-included menu'
  if (isDinnerLike(summary.event_type)) return 'Private dining package'
  if (summaryMatches(summary, /\bbar|drink|cocktail|wine\b/i)) return 'Bar or drink package'
  return 'Food package'
}

function deriveFoodShoppingAmount(summary: EventSummary, vendorCost: number | null) {
  if (/\bno food\b/i.test(summary.food_responsibility ?? '')) return 'Not needed'
  if (/\bguests pay\b/i.test(summary.food_responsibility ?? '')) return 'Guest-paid'
  if (/\bsponsor covers\b/i.test(summary.food_responsibility ?? '')) return 'Sponsor-paid'
  return formatCents(vendorCost)
}

function deriveVendorNeedItems(summary: EventSummary): ShoppingListItem[] {
  if (isNoVendorNeed(summary.vendor_needs)) return []

  const text = `${summary.vendor_needs ?? ''}, ${summary.must_haves ?? ''}, ${summary.amenities ?? ''}`
  const items: ShoppingListItem[] = []

  if (/\b(dj|music|playlist)\b/i.test(text)) {
    items.push({ category: 'Music', label: 'DJ or music operator', amountLabel: 'TBD', note: 'Quote depends on duration and sound system.' })
  }
  if (/\b(live band|live music|artist|performer)\b/i.test(text)) {
    items.push({ category: 'Talent', label: 'Live performer booking', amountLabel: 'TBD', note: 'Requires availability, tech rider, and run-of-show.' })
  }
  if (/\b(staffing|check-in|check in|greeter|front door)\b/i.test(text)) {
    items.push({ category: 'Staffing', label: 'Check-in staff', amountLabel: formatCents(42000), note: 'Estimate updates with guest count and arrival window.' })
  }
  if (/\b(valet|transport|shuttle)\b/i.test(text)) {
    items.push({ category: 'Guest Logistics', label: 'Transportation or valet support', amountLabel: 'TBD', note: 'Requires arrival pattern and venue access.' })
  }
  if (/\b(florist|decor|decorator|design)\b/i.test(text)) {
    items.push({ category: 'Decor', label: 'Decor or floral package', amountLabel: 'TBD', note: 'Optional until vibe and venue are selected.' })
  }

  return items
}

function shouldIncludeAv(summary: EventSummary) {
  if (summaryMatches(summary, /\b(no av|no projector|standard setup)\b/i)) return false
  return summaryMatches(summary, /\b(av|projector|mic|microphone|speaker|sound system|screen|tv|recording|livestream|panel|conference|summit|hackathon|demo day|listening party|concert|performance|film screening|watch party|launch)\b/i)
}

function deriveAvShoppingLabel(summary: EventSummary) {
  if (summaryMatches(summary, /\b(panel|fireside|speaker)\b/i)) return 'Mics, speaker, and recording'
  if (summaryMatches(summary, /\b(listening|concert|performance|dj|music)\b/i)) return 'Sound system and playback check'
  if (summaryMatches(summary, /\b(watch|film|screening|tv|screen)\b/i)) return 'Screen and sound package'
  return 'Projector, mic, and speaker support'
}

function deriveAvEstimateCents(summary: EventSummary) {
  if (summaryMatches(summary, /\b(concert|live performance|conference|summit|hackathon)\b/i)) return 85000
  return 32000
}

function shouldIncludeSecurity(summary: EventSummary) {
  const guestCount = summary.guest_count ?? 0
  if (summaryMatches(summary, /\b(no security|private dinner|small dinner)\b/i) && guestCount < 50) return false
  return guestCount >= 100 || summary.ticketed || summaryMatches(summary, /\b(security|check-in|check in|door|club night|concert|day party|public|gala|fundraiser|pop-up|open to public)\b/i)
}

function deriveSecurityShoppingLabel(summary: EventSummary) {
  const guestCount = summary.guest_count ?? 0
  if (guestCount >= 180) return '4 staff for entry and floor support'
  if (guestCount >= 100) return '3 staff for check-in and crowd support'
  return '2 staff for check-in'
}

function deriveSecurityEstimateCents(summary: EventSummary) {
  const guestCount = summary.guest_count ?? 0
  if (guestCount >= 180) return 84000
  if (guestCount >= 100) return 63000
  return 42000
}

function shouldIncludePhotography(summary: EventSummary) {
  return summaryMatches(summary, /\b(photo|photographer|videographer|content|brand|launch|gala|fundraiser|birthday|wedding|gallery|art show|red carpet)\b/i)
}

function derivePhotographyShoppingLabel(summary: EventSummary) {
  if (summaryMatches(summary, /\b(video|videographer)\b/i)) return 'Photo/video coverage'
  if (summaryMatches(summary, /\b(brand|launch|gallery|art)\b/i)) return 'Event content capture'
  return 'Event photographer'
}

function shouldIncludeSportOps(summary: EventSummary) {
  return summaryMatches(summary, /\b(tennis|run club|fitness|yoga|pilates|bootcamp|sports|game outing|basketball|pickleball|athletes|runners)\b/i)
}

function deriveActivityShoppingLabel(summary: EventSummary) {
  if (summaryMatches(summary, /\btennis\b/i)) return 'Court access and tennis setup'
  if (summaryMatches(summary, /\brun club|runners?\b/i)) return 'Route, waiver, and post-run meetup'
  if (summaryMatches(summary, /\byoga|pilates|fitness|bootcamp\b/i)) return 'Instructor, mats, and rain plan'
  return 'Activity logistics'
}

function deriveTicketingShoppingLabel(summary: EventSummary) {
  if (summary.ticketing_model) return summary.ticketing_model
  if (summary.ticketed) return 'Ticketing page'
  return 'RSVP page'
}

function isNoVendorNeed(value: string | null) {
  return /\b(no vendors|no vendor|none|not needed|standard setup)\b/i.test(value ?? '')
}

function summaryMatches(summary: EventSummary, pattern: RegExp) {
  return pattern.test([
    summary.event_type,
    summary.vendor_needs,
    summary.amenities,
    summary.must_haves,
    summary.food_responsibility,
    summary.venue_terms,
    summary.ticketing_model,
    summary.revenue_share,
  ].filter(Boolean).join(' '))
}

function buildAuthorizationCards(
  approvals: PendingApproval[],
  primaryVenue: RecommendationSummary | null,
  budgetItems: BudgetLineItem[]
) {
  if (approvals.length > 0) {
    return approvals.map((approval) => ({
      id: approval.id,
      label: approval.label,
      subtitle: approval.subtitle ?? approval.status,
      amountLabel: formatCents(approval.amountCents),
      amountCents: approval.amountCents ?? 0,
    }))
  }

  const venueCost = primaryVenue?.priceCents ?? budgetItems[0]?.amountCents ?? 0
  if (!primaryVenue) return []

  return [
    {
      id: 'venue-estimate',
      label: primaryVenue?.name ? `Approve ${primaryVenue.name} estimate` : 'Approve venue estimate',
      subtitle: 'Matches the recommendation estimate before final venue terms are confirmed',
      amountLabel: venueCost > 0 ? formatCents(venueCost) : 'TBD',
      amountCents: venueCost,
    },
    {
      id: 'venue-hold',
      label: 'Place date hold',
      subtitle: `${primaryVenue?.holdDurationHours ?? 48}-hour temporary venue hold`,
      amountLabel: 'No charge',
      amountCents: 0,
    },
  ]
}

function hasEventSummaryDetails(summary: EventSummary) {
  return Boolean(
    summary.event_type ||
    summary.guest_count ||
    summary.date ||
    summary.area ||
    summary.budget_cents ||
    summary.must_haves ||
    summary.duration ||
    summary.dress_code
  )
}

function formatDateWindow(plan: LivePlanSnapshot | null) {
  if (!plan?.dateWindowStart) return null
  if (plan.dateWindowEnd && plan.dateWindowEnd !== plan.dateWindowStart) {
    return `${plan.dateWindowStart} to ${plan.dateWindowEnd}`
  }
  return plan.dateWindowStart
}

function parseMoneyToCents(value: string) {
  const match = value.match(/\$?([\d,]+)(?:\.\d{1,2})?\s*(k)?/i)
  if (!match) return null
  const dollars = Number(match[1].replaceAll(',', '')) * (match[2] ? 1000 : 1)
  return Number.isFinite(dollars) ? dollars * 100 : null
}

function isDinnerLike(eventType: string | null) {
  return Boolean(eventType && /\b(dinner|tasting|supper|food)\b/i.test(eventType))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function readStringListValue(value: unknown) {
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    return items.length > 0 ? items.join(', ') : null
  }

  return readString(value)
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => readString(item))
    .filter((item): item is string => Boolean(item))
}

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function readBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null
}
