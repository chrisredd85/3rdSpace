/**
 * Purpose: Renders the fixed right-side event record artifact panel for `/planner`.
 * Props: Accepts the active plan id and full conversation thread, plus optional
 * overrides for legacy stubbed budget, approval, rule, and source data.
 * Key behaviors: Derives event summary, recommendations, approvals, profit
 * assumptions, shopping list, and authorization cards from planner messages.
 */
'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Mail,
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
import { useRouter } from 'next/navigation'
import { EntityReadinessBadge } from '@/components/planner/EntityReadinessBadge'
import { PlannerEventMaterializationCard } from '@/components/planner/PlannerEventMaterializationCard'
import { InviteVendorModal } from '@/components/planner/InviteVendorModal'
import { InviteVenueModal } from '@/components/planner/InviteVenueModal'
import { ReportIncorrectInfoModal, type ReportIncorrectInfoEntity } from '@/components/planner/ReportIncorrectInfoModal'
import { RevisionHistoryModal } from '@/components/planner/RevisionHistoryModal'
import { StaleRecommendationNotice } from '@/components/planner/StaleRecommendationNotice'
import { usePlannerBillingGate } from '@/components/planner/usePlannerBillingGate'
import { VendorLocationBadge, type VendorLocationBadgeProps } from '@/components/planner/VendorLocationBadge'
import {
  hasAttendanceSignal,
  normalizePlanAttendanceSnapshot,
  type PlanAttendanceSnapshot,
} from '@/lib/planner/attendanceSummary'
import { humanizeEventType } from '@/lib/planner/archetypes/driftControl'
import { plannerDraftStorageKey } from '@/lib/planner/migrateDraft'
import { readSpecialSupplyMetadata, type SpecialSupplyMetadata } from '@/lib/planner/specialSupply'
import {
  resolveEntityReadiness,
  type EntityReadinessIndicator,
  type EntityStripeReadinessInput,
} from '@/lib/planner/entityStripeReadiness'
import { readVendorNeedStatusFromMetadata } from '@/lib/planner/vendorNeedStatus'
import type { PlanMessage, VendorNeedStatus } from '@/lib/types'
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
  approvalId: string | null
  messageId: string
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
  capacityKnown: boolean
  fit: string | null
  holdDurationHours: number | null
  commercialModelMatch: string | null
  dealModelSummary: string | null
  tags: string[]
  discoveryVenueId: string | null
  contactStatus: string | null
  contactEmail: string | null
  contactEmailSource: string | null
  contactEmailConfidence: string | null
  contactFormUrl: string | null
  contactFormLabel: string | null
  contactFormSourcePath: string | null
  contactPhone: string | null
  website: string | null
  extractionStatus: string | null
  discoveryCandidateStatus: string | null
  outreachDraftRequestStatus: string | null
  outreachDraftApprovalMessageId: string | null
  outreachDraftApprovalId: string | null
  outreachApprovalCreatedAt: string | null
  isClaimed: boolean | null
  claimStatus: string | null
  invitedAt: string | null
  stripeConnectStatus: string | null
  settledAt: string | null
  settledAmountCents: number | null
  planRevisionAtCreation: number | null
  formattedAddress: string | null
  city: string | null
  neighborhood: string | null
  serviceArea: string | null
  servesEventCity: boolean | null
  outOfCityApproved: boolean | null
  specialSupply: boolean | null
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
  vendor_need_status: VendorNeedStatus
  amenities: string | null
  venue_terms: string | null
  consumption_share: string | null
  action_permission: string | null
  must_haves: string | null
  dress_code: string | null
  duration: string | null
  ticketed: boolean | null
  attendance: PlanAttendanceSnapshot
  special_supply: SpecialSupplyMetadata | null
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
  onDateChangeRequest?: (input: PlannerDateChangeRequestInput) => Promise<void>
  onEventMaterialized?: () => Promise<void> | void
  onNavigateToTab?: (tabId: 'approvals', messageId?: string) => void
}

export interface PlannerDateChangeRequestInput {
  dateWindowStart: string
  dateWindowEnd?: string | null
  note?: string | null
  targets?: Array<{
    kind: 'venue' | 'vendor'
    name: string
    email: string
  }>
}

interface LivePlanSnapshot {
  title: string
  eventType: string | null
  status: string
  guestCount: number | null
  budgetCapCents: number | null
  neighborhood: string | null
  eventCity: string | null
  dateWindowStart: string | null
  dateWindowEnd: string | null
  materializedEventId: string | null
  ticketed: boolean | null
  ticketingModel: string | null
  ticketPriceTargetCents: number | null
  foodResponsibility: string | null
  vendorNeedStatus: VendorNeedStatus
  venueTerms: string | null
  actionPermission: string | null
  notes: string | null
  runOfShow: RunOfShowSnapshot | null
  workspaceSummary: WorkspaceSummarySnapshot | null
  selectedVenue: SelectedPlanVenue | null
  selectedVendors: SelectedPlanVendor[]
  outreachResponses: OutreachResponseSummary
  committedVenue: CommittedVenueQuote | null
  committedVendors: CommittedVendorQuote[]
  customCosts: CustomCostItem[]
  attendance: PlanAttendanceSnapshot
  specialSupply: SpecialSupplyMetadata | null
  latestRevision: PlanRevisionSnapshot | null
  planRevisionCount: number
  briefRenderVersion: number
  updatedAt: string | null
}

interface PlanRevisionSnapshot {
  type: string
  field: string | null
  value: unknown
  sourceMessageExcerpt: string | null
  eventBriefSections: string[]
  appliedAt: string | null
}

interface OutreachReplyOption {
  kind: 'venue' | 'vendor'
  responseId: string
  discoveryId: string
  name: string
  serviceType: string | null
  status: string
  quoteCents: number | null
  confidence: number | null
  summary: string | null
  updatedAt: string | null
}

interface OutreachResponseSummary {
  venues: OutreachReplyOption[]
  vendors: OutreachReplyOption[]
}

interface CommittedVenueQuote {
  discoveryVenueId: string
  name: string | null
  quotedPriceCents: number | null
  quotedDealModel: string | null
  quotedTerms: Record<string, unknown>
  committedAt: string | null
  settledAt: string | null
  settledAmountCents: number | null
}

interface CommittedVendorQuote {
  discoveryVendorId: string
  name: string | null
  serviceType: string
  quotedHourlyCents: number | null
  quotedPackageCents: number | null
  quotedMinimumCents: number | null
  quotedDepositPct: number | null
  quotedTerms: Record<string, unknown>
  committedAt: string | null
  settledAt: string | null
  settledAmountCents: number | null
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
  invitedAt: string | null
  stripeConnectStatus: string | null
  settledAt: string | null
  settledAmountCents: number | null
  rateSource: string | null
  provenanceLabel: string | null
  city: string | null
  neighborhood: string | null
  formattedAddress: string | null
  serviceArea: string | null
  servesEventCity: boolean | null
  outOfCityApproved: boolean | null
  specialSupply: boolean | null
}

interface SelectedPlanVenue {
  id: string | null
  venueId: string | null
  name: string
  venueType: string | null
  city: string | null
  state: string | null
  standingCapacity: number | null
  seatedCapacity: number | null
  priceCents: number | null
  termType: string | null
  amountCents: number | null
  claimStatus: string | null
  isClaimed: boolean | null
  invitedAt: string | null
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
  baselineSource: 'personal' | 'archetype' | 'default'
  baselineBasisLabel: string
  perAttendeeNetCents: number | null
  lineItems: Array<{ label: string; amountCents: number; negative?: boolean }>
  paidAverage: number
  venueChiCents: number
  consumptionShareCents: number
  barConsumptionShareCents: number
  venueIncentiveCents: number
  venueIncentiveLabel: string
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

interface PlannerProjectionBaseline {
  source: 'personal' | 'archetype' | 'default'
  avgSellThrough: number
  avgNoShowRate: number
  avgAttendanceRate: number
  avgMarginCents: number | null
  stddevMarginCents: number | null
  nEvents: number
  basisLabel: string
}

interface ShoppingListItem {
  category: string
  label: string
  amountLabel: string
  note?: string
  badge?: string
  readinessIndicator?: EntityReadinessIndicator | null
  locationBadge?: VendorLocationBadgeProps | null
  reportEntity?: ReportIncorrectInfoEntity | null
}

interface AuthorizationCardModel {
  id: string
  label: string
  subtitle: string
  amountLabel: string
  amountCents: number
  approvalId?: string
  approvalMessageId?: string
  targetType?: string | null
  targetId?: string | null
  readinessIndicator?: EntityReadinessIndicator | null
  isStripeGated?: boolean
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

const emptyOutreachResponseSummary: OutreachResponseSummary = { venues: [], vendors: [] }

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
  const acceptedQuoteState = asRecord(metadata?.accepted_quote_state)
  const shoppingList = asRecord(metadata?.shopping_list)

  return {
    title: readString(record.title) ?? 'Untitled plan',
    eventType: readString(record.eventType) ?? readString(record.event_type),
    status: readString(record.status) ?? 'drafting',
    guestCount: readNumber(record.guestCount) ?? readNumber(record.guest_count),
    budgetCapCents: readNumber(record.budgetCapCents) ?? readNumber(record.budget_cap_cents),
    neighborhood: readString(record.neighborhood) ?? readString(record.area),
    eventCity: readString(record.eventCity) ?? readString(record.event_city) ?? readString(metadata?.event_city),
    dateWindowStart: readString(record.dateWindowStart) ?? readString(record.date_window_start),
    dateWindowEnd: readString(record.dateWindowEnd) ?? readString(record.date_window_end),
    materializedEventId: readString(record.materializedEventId) ?? readString(record.materialized_event_id),
    ticketed: readBoolean(record.ticketed) ?? isPaidTicketingModel(ticketingModel),
    ticketingModel,
    ticketPriceTargetCents:
      readNumber(record.ticketPriceTargetCents) ??
      readNumber(record.ticket_price_target_cents) ??
      readNumber(metadata?.ticket_price_target_cents),
    foodResponsibility: readString(record.foodResponsibility) ?? readString(record.food_responsibility),
    vendorNeedStatus: readVendorNeedStatusFromMetadata(metadata),
    specialSupply: readSpecialSupplyMetadata(metadata),
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
    selectedVenue: normalizeSelectedVenue(
      record.selectedVenue ??
      record.selected_venue ??
      shoppingList?.selected_venue
    ),
    selectedVendors: normalizeSelectedVendors(
      record.selectedVendors ??
      record.selected_vendors ??
      shoppingList?.selected_vendors
    ),
    outreachResponses: normalizeOutreachResponseSummary(metadata?.outreach_response_summary),
    committedVenue: normalizeCommittedVenueQuote(
      record.committedVenue ??
      record.committed_venue ??
      acceptedQuoteState?.venue ??
      {
        discovery_venue_id: record.committed_venue_id,
        quoted_price_cents: record.committed_venue_quoted_price_cents,
        quoted_deal_model: record.committed_venue_quoted_deal_model,
        quoted_terms: record.committed_venue_quoted_terms,
        committed_at: record.committed_venue_at,
      }
    ),
    committedVendors: normalizeCommittedVendorQuotes(
      record.committedVendors ??
      record.committed_vendors ??
      acceptedQuoteState?.vendors ??
      metadata?.committed_vendors
    ),
    customCosts: normalizeCustomCosts(metadata?.custom_costs),
    attendance: normalizePlanAttendanceSnapshot(record, metadata),
    latestRevision: normalizePlanRevisionSnapshot(metadata?.latest_plan_revision),
    planRevisionCount: Math.max(0, Math.floor(readNumber(record.planRevisionCount) ?? readNumber(record.plan_revision_count) ?? 0)),
    briefRenderVersion: Math.max(0, Math.floor(readNumber(record.briefRenderVersion) ?? readNumber(record.brief_render_version) ?? 0)),
    updatedAt: readString(record.updatedAt) ?? readString(record.updated_at),
  }
}

function normalizePlanRevisionSnapshot(value: unknown): PlanRevisionSnapshot | null {
  const record = asRecord(value)
  if (!record) return null
  const type = readString(record.type)
  if (!type) return null

  return {
    type,
    field: readString(record.field),
    value: record.value,
    sourceMessageExcerpt: readString(record.source_message_excerpt),
    eventBriefSections: readStringArray(record.event_brief_sections),
    appliedAt: readString(record.applied_at),
  }
}

function normalizeOutreachResponseSummary(value: unknown): OutreachResponseSummary {
  const record = asRecord(value)
  if (!record) return emptyOutreachResponseSummary
  return {
    venues: normalizeOutreachReplyOptions(record.venues, 'venue'),
    vendors: normalizeOutreachReplyOptions(record.vendors, 'vendor'),
  }
}

function normalizeOutreachReplyOptions(value: unknown, kind: 'venue' | 'vendor'): OutreachReplyOption[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    const record = asRecord(item)
    if (!record) return []
    const responseId = readString(record.id) ?? readString(record.response_id)
    const discoveryId =
      readString(record.discovery_venue_id) ??
      readString(record.discoveryVendorId) ??
      readString(record.discovery_vendor_id) ??
      readString(record.discoveryId)
    if (!responseId || !discoveryId) return []
    const name =
      readString(record.venue_name) ??
      readString(record.vendor_name) ??
      readString(record.name) ??
      (kind === 'venue' ? 'Venue response' : 'Vendor response')

    return [{
      kind,
      responseId,
      discoveryId,
      name,
      serviceType: readString(record.service_type),
      status: readString(record.status) ?? readString(record.classification) ?? 'reply_received',
      quoteCents:
        readNumber(record.quote_cents) ??
        readNumber(record.quoted_price_cents) ??
        readNumber(record.quoted_package_cents) ??
        readNumber(record.quoted_minimum_cents),
      confidence: readNumber(record.confidence) ?? readNumber(record.classification_confidence),
      summary: readString(record.summary) ?? readString(record.raw_response_excerpt),
      updatedAt: readString(record.updated_at) ?? readString(record.updatedAt),
    }]
  }).sort((first, second) => {
    const firstScore = outreachReplyFitScore(first)
    const secondScore = outreachReplyFitScore(second)
    if (secondScore !== firstScore) return secondScore - firstScore
    return (first.quoteCents ?? Number.POSITIVE_INFINITY) - (second.quoteCents ?? Number.POSITIVE_INFINITY)
  })
}

function normalizeCommittedVenueQuote(value: unknown): CommittedVenueQuote | null {
  const record = asRecord(value)
  if (!record) return null
  const discoveryVenueId =
    readString(record.discoveryVenueId) ??
    readString(record.discovery_venue_id) ??
    readString(record.id)
  if (!discoveryVenueId) return null
  return {
    discoveryVenueId,
    name: readString(record.name) ?? readString(record.venue_name),
    quotedPriceCents:
      readNumber(record.quotedPriceCents) ??
      readNumber(record.quoted_price_cents),
    quotedDealModel:
      readString(record.quotedDealModel) ??
      readString(record.quoted_deal_model),
    quotedTerms: asRecord(record.quotedTerms) ?? asRecord(record.quoted_terms) ?? {},
    committedAt: readString(record.committedAt) ?? readString(record.committed_at),
    settledAt:
      readString(record.settledAt) ??
      readString(record.settled_at) ??
      readString(record.paidAt) ??
      readString(record.paid_at),
    settledAmountCents:
      readNumber(record.settledAmountCents) ??
      readNumber(record.settled_amount_cents),
  }
}

function normalizeCommittedVendorQuotes(value: unknown): CommittedVendorQuote[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    const record = asRecord(item)
    if (!record) return []
    const discoveryVendorId =
      readString(record.discoveryVendorId) ??
      readString(record.discovery_vendor_id) ??
      readString(record.id)
    const serviceType = readString(record.serviceType) ?? readString(record.service_type)
    if (!discoveryVendorId || !serviceType) return []
    return [{
      discoveryVendorId,
      name: readString(record.name) ?? readString(record.vendor_name),
      serviceType,
      quotedHourlyCents:
        readNumber(record.quotedHourlyCents) ??
        readNumber(record.quoted_hourly_cents),
      quotedPackageCents:
        readNumber(record.quotedPackageCents) ??
        readNumber(record.quoted_package_cents),
      quotedMinimumCents:
        readNumber(record.quotedMinimumCents) ??
        readNumber(record.quoted_minimum_cents),
      quotedDepositPct:
        readNumber(record.quotedDepositPct) ??
        readNumber(record.quoted_deposit_pct),
      quotedTerms: asRecord(record.quotedTerms) ?? asRecord(record.quoted_terms) ?? {},
      committedAt: readString(record.committedAt) ?? readString(record.committed_at),
      settledAt:
        readString(record.settledAt) ??
        readString(record.settled_at) ??
        readString(record.paidAt) ??
        readString(record.paid_at),
      settledAmountCents:
        readNumber(record.settledAmountCents) ??
        readNumber(record.settled_amount_cents),
    }]
  })
}

function normalizeSelectedVenue(value: unknown): SelectedPlanVenue | null {
  const record = asRecord(value)
  if (!record) return null

  const venueId = readString(record.venue_id) ?? readString(record.reference_id) ?? readString(record.id)
  const name = readString(record.external_name) ?? readString(record.venue_name) ?? readString(record.name)
  if (!venueId && !name) return null

  return {
    id: readString(record.id),
    venueId,
    name: name ?? 'Venue',
    venueType: readString(record.venue_type),
    city: readString(record.city),
    state: readString(record.state),
    standingCapacity: readNumber(record.standing_capacity),
    seatedCapacity: readNumber(record.seated_capacity),
    priceCents: readNumber(record.price_cents),
    termType: readString(record.term_type),
    amountCents: readNumber(record.amount_cents),
    claimStatus: readString(record.claim_status),
    isClaimed: readBoolean(record.is_claimed),
    invitedAt: readString(record.invited_at) ?? readString(record.invitedAt),
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
      invitedAt: readString(record.invited_at) ?? readString(record.invitedAt),
      stripeConnectStatus:
        readString(record.stripe_connect_status) ??
        readString(record.stripeConnectStatus) ??
        readString(record.stripe_account_status) ??
        readString(record.account_status),
      settledAt:
        readString(record.settled_at) ??
        readString(record.settledAt) ??
        readString(record.paid_at) ??
        readString(record.paidAt),
      settledAmountCents:
        readNumber(record.settled_amount_cents) ??
        readNumber(record.settledAmountCents),
      rateSource: readString(record.rate_source),
      provenanceLabel: readString(record.rate_provenance_label),
      city: readString(record.city) ?? readString(record.vendor_city),
      neighborhood: readString(record.neighborhood),
      formattedAddress: readString(record.formatted_address) ?? readString(record.address),
      serviceArea: readString(record.service_area) ?? readString(record.serviceArea),
      servesEventCity: readBoolean(record.serves_event_city) ?? readBoolean(record.servesEventCity),
      outOfCityApproved: readBoolean(record.out_of_city_approved) ?? readBoolean(record.outOfCityApproved),
      specialSupply: readBoolean(record.special_supply) ?? readBoolean(record.specialSupply),
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
    vendor_needs: plan?.vendorNeedStatus === 'none' ? 'No vendors needed' : null,
    vendor_need_status: plan?.vendorNeedStatus ?? 'unknown',
    amenities: null,
    venue_terms: plan?.venueTerms ?? null,
    consumption_share: null,
    action_permission: plan?.actionPermission ?? null,
    must_haves: null,
    dress_code: null,
    duration: null,
    ticketed,
    attendance: plan?.attendance ?? normalizePlanAttendanceSnapshot(null),
    special_supply: plan?.specialSupply ?? null,
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
      vendor_need_status: fallback.vendor_need_status,
      amenities: readString(summary.amenities) ?? fallback.amenities,
      venue_terms: fallback.venue_terms ?? readString(summary.venue_terms),
      consumption_share: readString(summary.consumption_share) ?? fallback.consumption_share,
      action_permission: fallback.action_permission ?? readString(summary.action_permission),
      must_haves: readStringListValue(summary.must_haves) ?? fallback.must_haves,
      dress_code: readString(summary.dress_code) ?? fallback.dress_code,
      duration: readString(summary.duration) ?? fallback.duration,
      ticketed: fallback.ticketed ?? readBoolean(summary.ticketed) ?? isPaidTicketingModel(readString(summary.ticketing_model)),
      attendance: normalizePlanAttendanceSnapshot(summary, metadata, fallback.attendance),
      special_supply: fallback.special_supply,
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
    if (label.includes('revenue')) nextSummary.consumption_share = value
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
      const approvalId = readString(approval.id)
      const id = approvalId ?? message.id
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
        approvalId,
        messageId: message.id,
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
      const contactStatus = readString(record.contact_status)
      const discoveryVenueId =
        readString(record.discovery_venue_id) ??
        (contactStatus || readString(record.discovery_candidate_id) ? readString(record.venue_id) : null)

      return {
        id: readString(record.id) ?? `${latestRecommendationMessage.id}-${index}`,
        name,
        type,
        priceLabel: priceCents !== null && priceCents !== undefined ? formatCents(priceCents) : priceTier ?? 'Pricing pending',
        priceCents: priceCents ?? null,
        address: readString(record.address) ?? readString(record.location) ?? null,
        capacity: readNumber(record.capacity) ?? readNumber(record.capacity_max),
        capacityKnown: readBoolean(record.capacity_known) ?? (readNumber(record.capacity) ?? readNumber(record.capacity_max)) !== null,
        fit: readString(record.fit) ?? readString(record.note),
        holdDurationHours: readNumber(record.hold_duration_hours),
        commercialModelMatch:
          readString(record.commercial_model_match) ??
          readString(record.commercialModelMatch) ??
          readString(record.commercial_model) ??
          null,
        dealModelSummary:
          readString(record.deal_model_summary) ??
          readString(record.dealModelSummary) ??
          readString(record.venue_terms) ??
          null,
        tags: [
          ...readStringArray(record.tags),
          ...readStringArray(record.fit_tags),
        ].slice(0, 4),
        discoveryVenueId,
        contactStatus,
        contactEmail: readString(record.contact_email),
        contactEmailSource: readString(record.contact_email_source),
        contactEmailConfidence: readString(record.contact_email_confidence),
        contactFormUrl: readString(record.contact_form_url),
        contactFormLabel: readString(record.contact_form_label),
        contactFormSourcePath: readString(record.contact_form_source_path),
        contactPhone: readString(record.contact_phone),
        website: readString(record.website),
        extractionStatus: readString(record.extraction_status),
        discoveryCandidateStatus: readString(record.discovery_candidate_status),
        outreachDraftRequestStatus: readString(record.outreach_draft_request_status),
        outreachDraftApprovalMessageId: readString(record.outreach_draft_approval_message_id),
        outreachDraftApprovalId: readString(record.outreach_draft_approval_id),
        outreachApprovalCreatedAt: readString(record.outreach_approval_created_at),
        isClaimed: readBoolean(record.is_claimed) ?? readBoolean(record.isClaimed),
        claimStatus: readString(record.claim_status) ?? readString(record.claimStatus),
        invitedAt: readString(record.invited_at) ?? readString(record.invitedAt),
        stripeConnectStatus:
          readString(record.stripe_connect_status) ??
          readString(record.stripeConnectStatus) ??
          readString(record.stripe_account_status) ??
          readString(record.account_status),
        settledAt:
          readString(record.settled_at) ??
          readString(record.settledAt) ??
          readString(record.paid_at) ??
          readString(record.paidAt),
        settledAmountCents:
          readNumber(record.settled_amount_cents) ??
          readNumber(record.settledAmountCents),
        planRevisionAtCreation:
          readNumber(record.plan_revision_at_creation) ??
          readNumber(record.planRevisionAtCreation),
        formattedAddress:
          readString(record.formatted_address) ??
          readString(record.formattedAddress) ??
          readString(record.address),
        city:
          readString(record.city) ??
          readString(record.vendor_city) ??
          readString(record.venue_city),
        neighborhood:
          readString(record.neighborhood) ??
          readString(record.area),
        serviceArea:
          readString(record.service_area) ??
          readString(record.serviceArea),
        servesEventCity:
          readBoolean(record.serves_event_city) ??
          readBoolean(record.servesEventCity),
        outOfCityApproved:
          readBoolean(record.out_of_city_approved) ??
          readBoolean(record.outOfCityApproved),
        specialSupply:
          readBoolean(record.special_supply) ??
          readBoolean(record.specialSupply),
      }
  })
}

type GmailOutreachDraftSummary = {
  pendingCount: number
  firstMessageId: string | null
  pendingByVenueId: Map<string, { messageId: string; approvalId: string | null }>
  sentByVenueId: Map<string, { messageId: string; approvalId: string | null }>
}

function deriveGmailOutreachDraftSummary(messages: PlanMessage[]): GmailOutreachDraftSummary {
  const summary: GmailOutreachDraftSummary = {
    pendingCount: 0,
    firstMessageId: null,
    pendingByVenueId: new Map(),
    sentByVenueId: new Map(),
  }

  for (const message of messages) {
    if (String(message.message_type) !== 'approval_request') continue
    const metadata = asRecord(message.metadata)
    if (readString(metadata?.kind) !== 'gmail_approved_outreach') continue

    const approval = asRecord(metadata?.approval)
    const status = readString(approval?.status) ?? readString(metadata?.status) ?? 'pending'
    const approvalId = readString(approval?.id)
    const targets = Array.isArray(metadata?.partner_targets) ? metadata.partner_targets : []
    const venueIds = new Set([
      ...readStringArray(metadata?.discovery_venue_ids),
      ...targets.flatMap((target) => {
        const record = asRecord(target)
        const id = readString(record?.discovery_venue_id)
        return id ? [id] : []
      }),
    ])
    if (venueIds.size === 0) continue

    for (const venueId of venueIds) {
      if (status === 'pending') {
        if (!summary.pendingByVenueId.has(venueId)) {
          summary.pendingByVenueId.set(venueId, { messageId: String(message.id), approvalId })
          summary.pendingCount += 1
          summary.firstMessageId ??= String(message.id)
        }
      } else if (status === 'authorized' || status === 'approved' || status === 'complete') {
        if (!summary.sentByVenueId.has(venueId)) {
          summary.sentByVenueId.set(venueId, { messageId: String(message.id), approvalId })
        }
      }
    }
  }

  return summary
}

/**
 * Builds budget rows from the latest event summary.
 */
function buildBudgetItems(summary: EventSummary, plan: LivePlanSnapshot | null): BudgetLineItem[] {
  const budgetCapCents = summary.budget_cents ?? plan?.budgetCapCents ?? null
  const noOrganizerFoodCost = hasNoOrganizerFoodCost(summary)
  const noPaidVendors = summary.vendor_need_status === 'none' || isNoVendorNeed(summary.vendor_needs) || noOrganizerFoodCost
  const venueRatio = getVenueTargetRatio(summary)
  const venueAmountCents = budgetCapCents ? Math.round(budgetCapCents * venueRatio) : null

  if (!budgetCapCents) {
    return [
      { label: 'Venue target', amountCents: null },
      noPaidVendors
        ? { label: 'Vendor pool not needed', amountCents: 0 }
        : { label: 'Vendor pool', amountCents: null },
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
  customCosts: CustomCostItem[] = [],
  baseline: PlannerProjectionBaseline | null = null,
  livePlan: LivePlanSnapshot | null = null
): ProfitModel {
  const guestCount = summary.guest_count ?? 0
  const sellThrough = clampRate(baseline?.avgSellThrough ?? 0.87, 0, 1.5)
  const noShowRate = clampRate(baseline?.avgNoShowRate ?? 0.15, 0, 1)
  const paidAverage = guestCount > 0 ? Math.max(1, Math.round(guestCount * sellThrough)) : 0
  const projectedAttendance = paidAverage > 0 ? Math.max(1, Math.round(paidAverage * (1 - noShowRate))) : 0
  const committedVenueCostCents = livePlan?.committedVenue?.quotedPriceCents ?? null
  const committedVendorCostCents = sumCommittedVendorQuotes(livePlan?.committedVendors ?? [])
  const venueCostCents =
    committedVenueCostCents ??
    recommendations.find((item) => /venue/i.test(item.type))?.priceCents ??
    budgetItems[0]?.amountCents ??
    0
  const vendorCostCents =
    (committedVendorCostCents > 0 ? committedVendorCostCents : null) ??
    budgetItems.find((item) => /vendor|dinner/i.test(item.label))?.amountCents ??
    Math.max(0, Math.round((summary.budget_cents ?? 0) * 0.3))
  const customCostsTotalCents = Math.round(customCosts.reduce((sum, c) => sum + c.amount * 100, 0))
  const ticketPricing = buildTicketPricingModel(summary, paidAverage, venueCostCents + customCostsTotalCents, vendorCostCents)
  const ticketRevenueCents = summary.ticketed && paidAverage > 0 ? ticketPricing.recommendedCents * paidAverage : 0
  const feesCents = Math.round(ticketRevenueCents * 0.049)
  const venueChiCents = guestCount > 100 ? (guestCount - 100) * 800 : 0
  const consumptionShareCents = Math.round(Math.max(0, ticketRevenueCents - feesCents) * 0.12)
  const barConsumptionShareCents = estimateBarConsumptionShareCents(summary, paidAverage)
  const venueIncentive = resolveVenueIncentiveProjection(summary, {
    perHeadCents: venueChiCents,
    ticketShareCents: consumptionShareCents,
    barShareCents: barConsumptionShareCents,
  })
  const expectedCents = ticketRevenueCents + venueIncentive.amountCents - venueCostCents - vendorCostCents - customCostsTotalCents - feesCents
  const conservativeCents = Math.round(expectedCents * 0.6)
  const upsideCents = Math.round(expectedCents * 1.45)
  const attendeeBasis = projectedAttendance || paidAverage || guestCount
  const perAttendeeNetCents = attendeeBasis > 0 ? Math.round(expectedCents / attendeeBasis) : null
  const totalCostCents = venueCostCents + vendorCostCents + customCostsTotalCents + feesCents
  const breakEvenCostCents = Math.max(0, totalCostCents - venueIncentive.amountCents)
  const breakEvenTickets =
    summary.ticketed && ticketPricing.recommendedCents > 0 && breakEvenCostCents > 0
      ? Math.ceil(breakEvenCostCents / ticketPricing.recommendedCents)
      : null

  const baselineStddev = baseline?.stddevMarginCents && baseline.stddevMarginCents > 0 ? baseline.stddevMarginCents : null
  const rangeLowCents = baselineStddev ? expectedCents - baselineStddev : Math.min(conservativeCents, upsideCents)
  const rangeHighCents = baselineStddev ? expectedCents + baselineStddev : Math.max(conservativeCents, upsideCents)

  const lineItems: ProfitModel['lineItems'] = [
    { label: `Ticket revenue (${paidAverage || 'TBD'} paid avg × ${formatCents(ticketPricing.recommendedCents)})`, amountCents: ticketRevenueCents },
    { label: venueIncentive.label, amountCents: venueIncentive.amountCents },
    { label: `Venue cost (${livePlan?.committedVenue?.name ?? recommendations[0]?.name ?? 'target'})`, amountCents: venueCostCents, negative: true },
    { label: 'Platform + payment fees (4.9%)', amountCents: feesCents, negative: true },
  ]

  if (summary.vendor_need_status !== 'none') {
    lineItems.splice(3, 0, {
      label: committedVendorCostCents > 0 ? 'Accepted vendor quotes' : 'Vendor cost (catering, DJ, AV, security)',
      amountCents: vendorCostCents,
      negative: true,
    })
  }

  if (customCostsTotalCents > 0) {
    lineItems.push({ label: `Custom costs (${customCosts.length} item${customCosts.length === 1 ? '' : 's'})`, amountCents: customCostsTotalCents, negative: true })
  }

  return {
    conservativeCents,
    expectedCents,
    upsideCents,
    realisticCents: expectedCents,
    rangeLowCents,
    rangeHighCents,
    baselineSource: baseline?.source ?? 'default',
    baselineBasisLabel: baseline?.basisLabel ?? 'Industry default',
    perAttendeeNetCents,
    paidAverage,
    venueChiCents,
    consumptionShareCents,
    barConsumptionShareCents,
    venueIncentiveCents: venueIncentive.amountCents,
    venueIncentiveLabel: venueIncentive.label,
    customCostsTotalCents,
    breakEvenTickets,
    ticketPricing: {
      ...ticketPricing,
      projectedMarginCents: expectedCents,
    },
    lineItems,
  }
}

function clampRate(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function sumCommittedVendorQuotes(vendors: CommittedVendorQuote[]): number {
  return vendors.reduce((sum, vendor) => sum + (committedVendorQuoteCents(vendor) ?? 0), 0)
}

function committedVendorQuoteCents(vendor: CommittedVendorQuote): number | null {
  return vendor.quotedPackageCents ?? vendor.quotedMinimumCents ?? vendor.quotedHourlyCents
}

function upsertCommittedVendor(
  current: CommittedVendorQuote[],
  next: CommittedVendorQuote
): CommittedVendorQuote[] {
  const filtered = current.filter((vendor) =>
    vendor.discoveryVendorId !== next.discoveryVendorId &&
    vendor.serviceType !== next.serviceType
  )
  return [...filtered, next]
}

function outreachReplyFitScore(option: OutreachReplyOption): number {
  const normalized = option.status.toLowerCase()
  const statusScore =
    normalized.includes('quote') || normalized.includes('yes') || normalized.includes('available')
      ? 30
      : normalized.includes('conditional')
        ? 20
        : normalized.includes('no')
          ? -30
          : 0
  const priceScore = option.quoteCents !== null ? 10 : 0
  const confidenceScore = option.confidence !== null ? Math.round(option.confidence * 10) : 0
  return statusScore + priceScore + confidenceScore
}

function isActionableOutreachReply(option: OutreachReplyOption): boolean {
  const normalized = option.status.toLowerCase()
  if (normalized.includes('no') || normalized.includes('declin')) return false
  return normalized.includes('yes') ||
    normalized.includes('quote') ||
    normalized.includes('available') ||
    normalized.includes('conditional') ||
    option.quoteCents !== null
}

function quoteFeedbackKey(option: OutreachReplyOption): string {
  return `${option.kind}:${option.responseId}`
}

function readProjectionBaseline(value: unknown): PlannerProjectionBaseline | null {
  const record = asRecord(value)
  if (!record) return null
  const source = readString(record.source)
  if (source !== 'personal' && source !== 'archetype' && source !== 'default') return null
  return {
    source,
    avgSellThrough: clampRate(readNumber(record.avgSellThrough) ?? 0.85, 0, 1.5),
    avgNoShowRate: clampRate(readNumber(record.avgNoShowRate) ?? 0.15, 0, 1),
    avgAttendanceRate: clampRate(readNumber(record.avgAttendanceRate) ?? 0.85, 0, 1.5),
    avgMarginCents: readNumber(record.avgMarginCents),
    stddevMarginCents: readNumber(record.stddevMarginCents),
    nEvents: Math.max(0, Math.floor(readNumber(record.nEvents) ?? 0)),
    basisLabel: readString(record.basisLabel) ?? 'Industry default',
  }
}

function estimateBarConsumptionShareCents(summary: EventSummary, paidAverage: number) {
  if (paidAverage <= 0) return 0

  const text = [
    summary.food_responsibility,
    summary.venue_terms,
    summary.consumption_share,
  ].filter(Boolean).join(' ')

  if (!/\b(bar consumption|venue consumption|cash bar|no-host|guests pay venue|drink sales|beverage sales|bar chi)\b/i.test(text)) {
    return 0
  }

  const estimatedBarSpendCents = paidAverage * 2600
  return Math.round(estimatedBarSpendCents * 0.12)
}

function resolveVenueIncentiveProjection(
  summary: EventSummary,
  options: {
    perHeadCents: number
    ticketShareCents: number
    barShareCents: number
  }
) {
  const text = [
    summary.venue_terms,
    summary.consumption_share,
    summary.food_responsibility,
  ].filter(Boolean).join(' ')

  if (/\b(ticket chi|ticket consumption|ticket share|door incentive|door share)\b/i.test(text)) {
    return { amountCents: options.ticketShareCents, label: 'Venue consumption incentive (ticket CHI)' }
  }

  if (/\b(bar consumption|venue consumption|cash bar|no-host|guests pay venue|drink sales|beverage sales|bar chi)\b/i.test(text)) {
    return { amountCents: options.barShareCents, label: 'Venue consumption incentive (bar CHI)' }
  }

  if (/\b(per[-\s]?head|per attendee|headcount chi|attendance incentive)\b/i.test(text)) {
    return { amountCents: options.perHeadCents, label: 'Venue consumption incentive (per-head CHI)' }
  }

  if (isRecommendBestModel(summary.consumption_share)) {
    const candidates = [
      { amountCents: options.perHeadCents, label: 'Venue consumption incentive (best model)' },
      { amountCents: options.ticketShareCents, label: 'Venue consumption incentive (best model)' },
      { amountCents: options.barShareCents, label: 'Venue consumption incentive (best model)' },
    ]
    return candidates.reduce((best, candidate) => (
      candidate.amountCents > best.amountCents ? candidate : best
    ))
  }

  return { amountCents: 0, label: 'Venue consumption incentive' }
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
  if (!summary.must_haves) questions.push(summary.vendor_need_status === 'none' ? 'Add venue must-haves' : 'Add venue/vendor must-haves')
  if (!summary.action_permission) questions.push('Choose what the agent can do after recommendations')
  if (summary.ticketed && !summary.budget_cents) questions.push('Set ticket price assumptions')
  if (recommendations.length === 0) questions.push(summary.vendor_need_status === 'none' ? 'Generate venue recommendations' : 'Generate venue and vendor recommendations')

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
  onDateChangeRequest,
  onEventMaterialized,
  onNavigateToTab,
}: PlannerLivePlanPanelProps) {
  const router = useRouter()
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
  const [isDateChangeOpen, setIsDateChangeOpen] = useState(false)
  const [dateChangeStart, setDateChangeStart] = useState('')
  const [dateChangeEnd, setDateChangeEnd] = useState('')
  const [dateChangeNote, setDateChangeNote] = useState('')
  const [dateChangeTargetKind, setDateChangeTargetKind] = useState<'venue' | 'vendor'>('venue')
  const [dateChangeTargetName, setDateChangeTargetName] = useState('')
  const [dateChangeTargetEmail, setDateChangeTargetEmail] = useState('')
  const [dateChangeError, setDateChangeError] = useState<string | null>(null)
  const [dateChangeSuccess, setDateChangeSuccess] = useState<string | null>(null)
  const [isSubmittingDateChange, setIsSubmittingDateChange] = useState(false)
  const [contactEmailDrafts, setContactEmailDrafts] = useState<Record<string, string>>({})
  const [contactEmailFeedback, setContactEmailFeedback] = useState<Record<string, 'saving' | 'saved' | 'draft_created' | 'error'>>({})
  const [contactDraftMessageIds, setContactDraftMessageIds] = useState<Record<string, string | null>>({})
  const [quoteCommitFeedback, setQuoteCommitFeedback] = useState<Record<string, 'saving' | 'saved' | 'error'>>({})
  const [isInviteVenueModalOpen, setIsInviteVenueModalOpen] = useState(false)
  const [isInviteVendorModalOpen, setIsInviteVendorModalOpen] = useState(false)
  const [projectionBaseline, setProjectionBaseline] = useState<PlannerProjectionBaseline | null>(null)
  const [isProjectionBaselineRefreshing, setIsProjectionBaselineRefreshing] = useState(false)
  const [isRevisionHistoryOpen, setIsRevisionHistoryOpen] = useState(false)
  const [recommendationRefreshState, setRecommendationRefreshState] = useState<'idle' | 'refreshing' | 'done' | 'error'>('idle')
  const [reportIncorrectEntity, setReportIncorrectEntity] = useState<ReportIncorrectInfoEntity | null>(null)
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
  const activeBriefRenderVersion = livePlan?.briefRenderVersion ?? 0
  const recommendationCardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const runOfShow = livePlan?.runOfShow ?? deriveRunOfShowFromMessages(activeMessages)
  const workspaceSummary = livePlan?.workspaceSummary ?? deriveWorkspaceSummaryFromMessages(activeMessages)
  const currentPlanRevisionCount = livePlan?.planRevisionCount ?? 0
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
  const outreachDraftSummary = useMemo(
    () => deriveGmailOutreachDraftSummary(activeMessages),
    [activeMessages]
  )
  const recommendationMessageCount = useMemo(
    () => activeMessages.filter(isRecommendationPlanMessage).length,
    [activeMessages]
  )
  const venueRecommendations = renderedRecommendations.filter((recommendation) => /venue/i.test(recommendation.type))
  const selectedVenue = livePlan?.selectedVenue ?? null
  const primaryVenue = selectedVenue
    ? recommendationFromSelectedVenue(selectedVenue, eventSummary)
    : venueRecommendations[0] ?? null
  const primaryVenueReadiness = resolveVenueReadiness(primaryVenue, livePlan, relativeNowMs)
  const openQuestions = buildOpenQuestions(eventSummary, renderedRecommendations)
  const authorizationCards = buildAuthorizationCards(renderedApprovals, primaryVenue, renderedBudgetLineItems, primaryVenueReadiness)
  const profitModel = useMemo(
    () => buildProfitModel(eventSummary, renderedRecommendations, renderedBudgetLineItems, customCosts, projectionBaseline, livePlan),
    [eventSummary, renderedBudgetLineItems, renderedRecommendations, customCosts, projectionBaseline, livePlan]
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
  const isComparingCommercialModels = isRecommendBestModel(eventSummary.consumption_share)
  const primaryAuthorization = authorizationCards[0] ?? null
  const outreachReplyOptions = livePlan?.outreachResponses ?? emptyOutreachResponseSummary
  const shoppingListItems = buildShoppingList(primaryVenue, renderedBudgetLineItems, eventSummary, livePlan?.selectedVendors ?? [], livePlan, relativeNowMs)
  const canRequestDateChange = Boolean(onDateChangeRequest && activePlanId && !activePlanId.startsWith('mock-plan-'))
  const canReportDiscoveryInfo = Boolean(activePlanId && !activePlanId.startsWith('mock-plan-'))
  const isRefreshingRecommendations = recommendationRefreshState === 'refreshing'
  const handleVenueComparisonJump = useCallback((venueId: string) => {
    const target = recommendationCardRefs.current[venueId]
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    target.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (isDateChangeOpen) return
    setDateChangeStart(livePlan?.dateWindowStart ?? '')
    setDateChangeEnd(
      livePlan?.dateWindowEnd && livePlan.dateWindowEnd !== livePlan.dateWindowStart
        ? livePlan.dateWindowEnd
        : ''
    )
  }, [isDateChangeOpen, livePlan?.dateWindowEnd, livePlan?.dateWindowStart])

  useEffect(() => {
    if (!activePlanId || activePlanId.startsWith('mock-plan-')) {
      setProjectionBaseline(null)
      setIsProjectionBaselineRefreshing(false)
      return
    }

    let cancelled = false
    async function loadBaseline() {
      try {
        setIsProjectionBaselineRefreshing(true)
        const response = await fetch(`/api/planner/plans/${activePlanId}/baseline?briefVersion=${activeBriefRenderVersion}`, {
          method: 'GET',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) {
          if (!cancelled) setProjectionBaseline(null)
          return
        }
        const json = await response.json()
        if (!cancelled) setProjectionBaseline(readProjectionBaseline(json?.baseline))
      } catch {
        if (!cancelled) setProjectionBaseline(null)
      } finally {
        if (!cancelled) setIsProjectionBaselineRefreshing(false)
      }
    }

    void loadBaseline()
    return () => {
      cancelled = true
    }
  }, [activePlanId, activeBriefRenderVersion])

  async function handleDateChangeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!onDateChangeRequest) return

    const proposedStart = dateChangeStart.trim()
    const proposedEnd = dateChangeEnd.trim()
    const targetName = dateChangeTargetName.trim()
    const targetEmail = dateChangeTargetEmail.trim()

    if (!proposedStart) {
      setDateChangeError('Choose the proposed date before creating the approval.')
      return
    }

    if ((targetName && !targetEmail) || (!targetName && targetEmail)) {
      setDateChangeError('Add both partner name and partner email, or leave both blank to use existing outreach contacts.')
      return
    }

    setIsSubmittingDateChange(true)
    setDateChangeError(null)
    setDateChangeSuccess(null)

    try {
      await onDateChangeRequest({
        dateWindowStart: proposedStart,
        dateWindowEnd: proposedEnd || proposedStart,
        note: dateChangeNote.trim() || null,
        targets: targetName && targetEmail
          ? [{
              kind: dateChangeTargetKind,
              name: targetName,
              email: targetEmail,
            }]
          : [],
      })
      setDateChangeSuccess('Date-change approval created. Review it before partner emails send.')
      setIsDateChangeOpen(false)
      setDateChangeTargetName('')
      setDateChangeTargetEmail('')
      setDateChangeNote('')
    } catch (error) {
      setDateChangeError(error instanceof Error ? error.message : 'Could not create the date-change approval.')
    } finally {
      setIsSubmittingDateChange(false)
    }
  }

  async function handleRefreshRecommendations() {
    if (!activePlanId || activePlanId.startsWith('mock-plan-') || recommendationRefreshState === 'refreshing') return

    setRecommendationRefreshState('refreshing')
    try {
      const response = await fetch(`/api/planner/plans/${activePlanId}/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          venueLimit: 3,
          vendorLimit: eventSummary.vendor_need_status === 'none' ? 0 : 3,
        }),
      })
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok) {
        if (billingGate.handleBillingRequiredResponse(
          response,
          payload as { error?: string; message?: string; billingRequired?: boolean }
        )) {
          throw new Error('Choose a billing path to continue.')
        }
        throw new Error(readString(payload.error) ?? 'Could not refresh recommendations.')
      }
      setRecommendationRefreshState('done')
    } catch (error) {
      console.error('[planner.live-plan] stale_recommendation_refresh_failed', error)
      setRecommendationRefreshState('error')
    }
  }

  async function handleVenueContactEmailSubmit(venue: RecommendationSummary) {
    const discoveryVenueId = venue.discoveryVenueId
    if (!discoveryVenueId) return

    const email = contactEmailDrafts[discoveryVenueId]?.trim()
    if (!email) {
      setContactEmailFeedback((current) => ({ ...current, [discoveryVenueId]: 'error' }))
      return
    }

    setContactEmailFeedback((current) => ({ ...current, [discoveryVenueId]: 'saving' }))
    try {
      const response = await fetch(`/api/planner/discovery-venues/${encodeURIComponent(discoveryVenueId)}/contact-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      })
      const payload = await response.json().catch(() => ({})) as {
        error?: string
        draft_results?: Array<{
          status?: string
          discoveryVenueId?: string
          approvalMessageId?: string | null
        }>
      }
      if (!response.ok) throw new Error(payload.error ?? 'Unable to save contact email')

      const createdDraft = payload.draft_results?.find((result) =>
        result.discoveryVenueId === discoveryVenueId && result.status === 'draft_created'
      )
      if (createdDraft) {
        setContactDraftMessageIds((current) => ({
          ...current,
          [discoveryVenueId]: createdDraft.approvalMessageId ?? null,
        }))
        setContactEmailFeedback((current) => ({ ...current, [discoveryVenueId]: 'draft_created' }))
      } else {
        setContactEmailFeedback((current) => ({ ...current, [discoveryVenueId]: 'saved' }))
      }
      setContactEmailDrafts((current) => ({ ...current, [discoveryVenueId]: '' }))
    } catch (error) {
      console.error('[planner.live-plan] contact_email_save_failed', error)
      setContactEmailFeedback((current) => ({ ...current, [discoveryVenueId]: 'error' }))
    }
  }

  async function handleCommitOutreachReply(option: OutreachReplyOption) {
    if (!activePlanId || activePlanId.startsWith('mock-plan-')) return

    const feedbackKey = quoteFeedbackKey(option)
    setQuoteCommitFeedback((current) => ({ ...current, [feedbackKey]: 'saving' }))

    try {
      const response = await fetch(
        option.kind === 'venue'
          ? `/api/planner/plans/${activePlanId}/commit-venue`
          : `/api/planner/plans/${activePlanId}/commit-vendor`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ response_id: option.responseId }),
        }
      )
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Could not accept quote')

      setLivePayload((current) => {
        if (!current.plan) return current
        const now = new Date().toISOString()
        const nextPlan: LivePlanSnapshot = option.kind === 'venue'
          ? {
              ...current.plan,
              committedVenue: {
                discoveryVenueId: option.discoveryId,
                name: option.name,
                quotedPriceCents: option.quoteCents,
                quotedDealModel: option.status,
                quotedTerms: {
                  source: 'outreach_reply',
                  status: option.status,
                  summary: option.summary,
                  confidence: option.confidence,
                  updated_at: option.updatedAt,
                },
                committedAt: now,
                settledAt: null,
                settledAmountCents: null,
              },
              updatedAt: now,
            }
          : {
              ...current.plan,
              committedVendors: upsertCommittedVendor(current.plan.committedVendors, {
                discoveryVendorId: option.discoveryId,
                name: option.name,
                serviceType: option.serviceType ?? 'other',
                quotedHourlyCents: null,
                quotedPackageCents: option.quoteCents,
                quotedMinimumCents: null,
                quotedDepositPct: null,
                quotedTerms: {
                  source: 'outreach_reply',
                  status: option.status,
                  summary: option.summary,
                  confidence: option.confidence,
                  updated_at: option.updatedAt,
                },
                committedAt: now,
                settledAt: null,
                settledAmountCents: null,
              }),
              updatedAt: now,
            }
        const nextPayload = { ...current, plan: nextPlan }
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('planner-live-plan', JSON.stringify(nextPayload))
        }
        return nextPayload
      })
      setQuoteCommitFeedback((current) => ({ ...current, [feedbackKey]: 'saved' }))
    } catch (error) {
      console.error('[planner.live-plan] quote_commit_failed', error)
      setQuoteCommitFeedback((current) => ({ ...current, [feedbackKey]: 'error' }))
    }
  }

  async function handleGenerateTimeline() {
    if (!activePlanId || activePlanId.startsWith('mock-plan-') || isGeneratingTimeline) return

    setIsGeneratingTimeline(true)
    setTimelineRetryError(null)

    try {
      const response = await fetch(`/api/planner/plans/${activePlanId}/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueLimit: 3, vendorLimit: eventSummary.vendor_need_status === 'none' ? 0 : 3 }),
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
    if (card.approvalId && activePlanId && !activePlanId.startsWith('mock-plan-')) {
      if (onNavigateToTab) {
        onNavigateToTab('approvals', card.approvalMessageId)
      } else {
        router.push(`/planner?plan=${encodeURIComponent(activePlanId)}&tab=approvals`)
      }
      return
    }

    if (!activePlanId || activePlanId.startsWith('mock-plan-')) {
      requestSignupGateForAuthorization(card)
      return
    }

    setActionFeedback((current) => ({ ...current, [card.id]: 'loading' }))

    try {
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
      const payload = await response.json().catch(() => ({} as {
        error?: string
        message?: string
        billingRequired?: boolean
        approvalMessage?: { id?: string }
      }))
      if (!response.ok) {
        if (billingGate.handleBillingRequiredResponse(response, payload)) {
          throw new Error('Choose a billing path to continue.')
        }
        throw new Error('Unable to create approval request')
      }

      const approvalMessageId = payload.approvalMessage?.id
      if (onNavigateToTab) {
        onNavigateToTab('approvals', approvalMessageId)
      } else {
        router.push(`/planner?plan=${encodeURIComponent(activePlanId)}&tab=approvals`)
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
    const detail: PendingConversionAction = {
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
          <p className="label-caps whitespace-nowrap text-ink-soft">Event record</p>
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
          {eventSummary.special_supply ? (
            <PlanPill intent="recommended">
              Quote required
            </PlanPill>
          ) : null}
          {statusPillLabel ? (
            <PlanPill intent={recommendationMessageCount > 0 ? 'recommended' : 'neutral'}>
              {statusPillLabel}
            </PlanPill>
          ) : null}
        </div>
        {outreachDraftSummary.pendingCount > 0 ? (
          <button
            type="button"
            onClick={() => onNavigateToTab?.('approvals', outreachDraftSummary.firstMessageId ?? undefined)}
            className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full border border-clay/35 bg-clay-tint px-3 py-2 text-left text-xs font-bold uppercase tracking-[0.06em] text-clay transition-colors hover:border-clay hover:bg-clay hover:text-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-clay"
          >
            <Mail className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">
              {outreachDraftSummary.pendingCount} outreach draft{outreachDraftSummary.pendingCount === 1 ? '' : 's'} ready for review
            </span>
            <ChevronRight className="h-4 w-4 shrink-0" />
          </button>
        ) : null}
        {livePlan?.latestRevision ? (
          <PlanRevisionBanner
            revision={livePlan.latestRevision}
            onViewHistory={() => setIsRevisionHistoryOpen(true)}
          />
        ) : null}
        <RevisionHistoryModal
          planId={activePlanId}
          isOpen={isRevisionHistoryOpen}
          onClose={() => setIsRevisionHistoryOpen(false)}
        />
        <ReportIncorrectInfoModal
          entity={reportIncorrectEntity}
          isOpen={Boolean(reportIncorrectEntity)}
          onClose={() => setReportIncorrectEntity(null)}
        />
      </div>

      <div
        className={cn(inline ? 'pb-4' : 'min-h-0 flex-1 overflow-y-auto pb-24')}
        data-planner-side-scroll={inline ? undefined : 'true'}
      >
        <ArtifactSection icon={<Sparkles className="h-5 w-5" />} title="Brief" subtitle="Structured event record" collapsible={false}>
          <div className="grid gap-x-5 gap-y-5 [grid-template-columns:repeat(auto-fit,minmax(120px,1fr))]">
            <ArtifactField label="Event Type" value={formatEventType(eventSummary.event_type)} />
            <ArtifactField label="Date Window" value={eventSummary.date ?? 'Need date'} />
            <ArtifactField label="Neighborhood" value={eventSummary.area ?? 'Need area'} />
            <ArtifactField label="Guest Target" value={eventSummary.guest_count ? String(eventSummary.guest_count) : 'Guests TBD'} />
            <ArtifactField label="Tickets / RSVPs" value={formatTicketsOrRsvps(eventSummary.attendance)} />
            <ArtifactField label="Checked In" value={formatCheckedInCount(eventSummary.attendance)} />
            <ArtifactField label="Remaining" value={formatRemainingCapacity(eventSummary.attendance, eventSummary.guest_count)} />
            <ArtifactField label="Ticketing" value={formatTicketingModel(eventSummary, ticketPriceTargetCents)} />
            <ArtifactField label="Suggested Price" value={formatSuggestedPrice(eventSummary, ticketPriceTargetCents, suggestedTicketPriceCents)} />
            <ArtifactField label="Budget" value={livePlan?.budgetCapCents && livePlan.budgetCapCents > 0 ? formatCents(livePlan.budgetCapCents) : 'No cap set'} />
            <ArtifactField label="Food + Beverage" value={formatFoodResponsibilityValue(eventSummary.food_responsibility)} />
            <ArtifactField label="Venue Terms" value={formatVenueTermsValue(eventSummary)} />
            <ArtifactField label="Revenue Model" value={formatRevenueModelValue(eventSummary)} />
            <ArtifactField label="Agent Action" value={eventSummary.action_permission ?? 'Need approval rules'} />
            <ArtifactField
              label="Complexity"
              value={eventSummary.special_supply ? `${eventSummary.special_supply.label} - verified quote required` : 'Standard event'}
            />
            <RunOfShowField
              runOfShow={runOfShow}
              eventDate={livePlan?.dateWindowStart ?? livePlan?.dateWindowEnd ?? null}
              canGenerate={Boolean(activePlanId && !activePlanId.startsWith('mock-plan-'))}
              isGenerating={isGeneratingTimeline}
              error={timelineRetryError}
              onGenerate={handleGenerateTimeline}
            />
          </div>

          {activePlanId && livePlan && (livePlan.status === 'approved' || livePlan.materializedEventId) ? (
            <div className="mt-6">
              <PlannerEventMaterializationCard
                key={`${activePlanId}:${livePlan.materializedEventId ?? 'pending'}`}
                planId={activePlanId}
                planStatus={livePlan.status}
                materializedEventId={livePlan.materializedEventId}
                dateWindowStart={livePlan.dateWindowStart}
                dateWindowEnd={livePlan.dateWindowEnd}
                onMaterialized={onEventMaterialized}
                compact
              />
            </div>
          ) : null}

          {eventSummary.special_supply ? (
            <SpecialSupplyBrief specialSupply={eventSummary.special_supply} />
          ) : null}

          <div className="mt-7 rounded-lg border border-tan bg-cream-deep/75 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="label-caps text-clay">Date change</p>
                <h4 className="mt-2 flex items-center gap-2 text-base font-semibold leading-tight text-ink">
                  <CalendarDays className="h-4 w-4 text-clay" />
                  Try a new date
                </h4>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
                  Proposes a new date and creates approval-gated outreach before any venue or vendor email sends.
                </p>
              </div>
              <button
                type="button"
                disabled={!onDateChangeRequest}
                onClick={() => {
                  setIsDateChangeOpen((current) => !current)
                  setDateChangeError(null)
                  setDateChangeSuccess(null)
                }}
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-clay/40 bg-cream px-4 py-2 text-sm font-bold text-clay transition-colors hover:bg-clay hover:text-cream disabled:cursor-not-allowed disabled:border-tan disabled:text-ink-faint disabled:hover:bg-cream"
              >
                <Mail className="h-4 w-4" />
                {isDateChangeOpen ? 'Close' : 'Create approval'}
              </button>
            </div>

            {dateChangeSuccess ? (
              <p className="mt-4 rounded-md border border-forest/20 bg-forest/10 px-3 py-2 text-sm font-semibold text-forest">
                {dateChangeSuccess}
              </p>
            ) : null}

            {!canRequestDateChange && onDateChangeRequest ? (
              <p className="mt-4 rounded-md border border-tan bg-cream px-3 py-2 text-sm text-ink-soft">
                Save this plan before creating date-change outreach approvals.
              </p>
            ) : null}

            {isDateChangeOpen ? (
              <form onSubmit={handleDateChangeSubmit} className="mt-5 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.08em] text-ink-faint">Proposed date</span>
                    <input
                      type="date"
                      value={dateChangeStart}
                      onChange={(event) => setDateChangeStart(event.target.value)}
                      className="mt-2 min-h-11 w-full rounded-md border border-tan bg-cream px-3 text-sm font-semibold text-ink outline-none transition-colors focus:border-clay"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.08em] text-ink-faint">End date optional</span>
                    <input
                      type="date"
                      value={dateChangeEnd}
                      onChange={(event) => setDateChangeEnd(event.target.value)}
                      className="mt-2 min-h-11 w-full rounded-md border border-tan bg-cream px-3 text-sm font-semibold text-ink outline-none transition-colors focus:border-clay"
                    />
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-[0.8fr_1.1fr_1.2fr]">
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.08em] text-ink-faint">Partner type</span>
                    <select
                      value={dateChangeTargetKind}
                      onChange={(event) => setDateChangeTargetKind(event.target.value === 'vendor' ? 'vendor' : 'venue')}
                      className="mt-2 min-h-11 w-full rounded-md border border-tan bg-cream px-3 text-sm font-semibold text-ink outline-none transition-colors focus:border-clay"
                    >
                      <option value="venue">Venue</option>
                      <option value="vendor">Vendor</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.08em] text-ink-faint">Partner name optional</span>
                    <input
                      type="text"
                      value={dateChangeTargetName}
                      onChange={(event) => setDateChangeTargetName(event.target.value)}
                      placeholder="Use existing contacts"
                      className="mt-2 min-h-11 w-full rounded-md border border-tan bg-cream px-3 text-sm font-semibold text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-clay"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-[0.08em] text-ink-faint">Partner email optional</span>
                    <input
                      type="email"
                      value={dateChangeTargetEmail}
                      onChange={(event) => setDateChangeTargetEmail(event.target.value)}
                      placeholder="Use existing outreach contacts"
                      className="mt-2 min-h-11 w-full rounded-md border border-tan bg-cream px-3 text-sm font-semibold text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-clay"
                    />
                  </label>
                </div>

                <p className="text-xs leading-relaxed text-ink-faint">
                  Use the defaults unless a specific partner should receive the date-change note.
                </p>

                <label className="block">
                  <span className="text-xs font-bold uppercase tracking-[0.08em] text-ink-faint">Organizer note optional</span>
                  <textarea
                    value={dateChangeNote}
                    onChange={(event) => setDateChangeNote(event.target.value)}
                    rows={3}
                    placeholder="Mention timing constraints or why the date is moving."
                    className="mt-2 w-full rounded-md border border-tan bg-cream px-3 py-2 text-sm font-semibold text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-clay"
                  />
                </label>

                {dateChangeError ? (
                  <p className="rounded-md border border-brick/30 bg-brick/10 px-3 py-2 text-sm font-semibold text-brick">
                    {dateChangeError}
                  </p>
                ) : null}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs leading-relaxed text-ink-faint">
                    Emails are queued as approvals. Nothing sends until the organizer approves the Gmail card.
                  </p>
                  <button
                    type="submit"
                    disabled={!canRequestDateChange || isSubmittingDateChange}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-clay px-4 py-2 text-sm font-bold text-cream transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <RefreshCw className={cn('h-4 w-4', isSubmittingDateChange ? 'animate-spin' : '')} />
                    {isSubmittingDateChange ? 'Creating approval' : 'Create date-change approval'}
                  </button>
                </div>
              </form>
            ) : null}
          </div>

          <div
            ref={(node) => {
              if (primaryVenue) recommendationCardRefs.current[primaryVenue.id] = node
            }}
            tabIndex={primaryVenue ? -1 : undefined}
            className="mt-7 rounded-lg border border-clay/25 bg-clay-tint/55 p-5 outline-none focus-visible:ring-2 focus-visible:ring-clay"
          >
            <div className="flex items-start justify-between gap-4">
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
                {primaryVenue ? (
                  <StaleRecommendationNotice
                    planRevisionAtCreation={primaryVenue.planRevisionAtCreation}
                    currentPlanRevisionCount={currentPlanRevisionCount}
                    isRefreshing={isRefreshingRecommendations}
                    onRefresh={handleRefreshRecommendations}
                    className="mt-3"
                  />
                ) : null}
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
                {primaryVenue ? (
                  <VenueOutreachStatus
                    venue={primaryVenue}
                    draftSummary={outreachDraftSummary}
                    emailDrafts={contactEmailDrafts}
                    emailFeedback={contactEmailFeedback}
                    localDraftMessageIds={contactDraftMessageIds}
                    onEmailChange={(venueId, value) => setContactEmailDrafts((current) => ({ ...current, [venueId]: value }))}
                    onEmailSubmit={handleVenueContactEmailSubmit}
                    onNavigateToApprovals={(messageId) => onNavigateToTab?.('approvals', messageId ?? undefined)}
                  />
                ) : null}
                {canReportDiscoveryInfo && primaryVenue?.discoveryVenueId ? (
                  <ReportIncorrectInfoButton
                    entity={{ kind: 'venue', id: primaryVenue.discoveryVenueId, name: primaryVenue.name }}
                    onReport={setReportIncorrectEntity}
                    className="mt-3"
                  />
                ) : null}
                {activePlanId && !activePlanId.startsWith('mock-plan-') ? (
                  <button
                    type="button"
                    onClick={() => setIsInviteVenueModalOpen(true)}
                    className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-clay/30 bg-cream/80 px-3 py-2 text-sm font-bold text-clay transition-colors hover:bg-clay-tint"
                  >
                    <Plus className="h-4 w-4" />
                    Invite a venue I know
                  </button>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-3">
                <EntityReadinessBadge indicator={primaryVenueReadiness} className="items-end text-right" />
                <Link
                  href="/planner/venues"
                  className="inline-flex items-center gap-1 text-sm font-bold text-clay transition-colors hover:text-clay-deep"
                >
                  View
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
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

          <VenueComparisonTable
            venues={venueRecommendations}
            draftSummary={outreachDraftSummary}
            emailDrafts={contactEmailDrafts}
            emailFeedback={contactEmailFeedback}
            localDraftMessageIds={contactDraftMessageIds}
            onVenueClick={handleVenueComparisonJump}
            onEmailChange={(venueId, value) => setContactEmailDrafts((current) => ({ ...current, [venueId]: value }))}
            onEmailSubmit={handleVenueContactEmailSubmit}
            onNavigateToApprovals={(messageId) => onNavigateToTab?.('approvals', messageId ?? undefined)}
            currentPlanRevisionCount={currentPlanRevisionCount}
            isRefreshingRecommendations={isRefreshingRecommendations}
            onRefreshRecommendations={handleRefreshRecommendations}
            canReportIncorrectInfo={canReportDiscoveryInfo}
            onReportIncorrectInfo={setReportIncorrectEntity}
          />
          <OutreachQuoteComparison
            responses={outreachReplyOptions}
            committedVenue={livePlan?.committedVenue ?? null}
            committedVendors={livePlan?.committedVendors ?? []}
            feedback={quoteCommitFeedback}
            onCommit={handleCommitOutreachReply}
          />
        </ArtifactSection>

        <ArtifactSection id="profit-window" icon={<TrendingUp className="h-5 w-5" />} title="Profit Window" subtitle="Realistic forecast + range">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {profitModel.baselineSource !== 'default' ? (
              <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-forest/20 bg-forest/10 px-3 py-1 text-xs font-semibold text-forest">
                <TrendingUp className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{profitModel.baselineBasisLabel}</span>
              </div>
            ) : null}
            {isProjectionBaselineRefreshing ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-tan bg-cream-deep px-3 py-1 text-xs font-semibold text-ink-soft">
                Updating assumptions...
              </div>
            ) : null}
          </div>
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
            <ProfitRangeCard
              label={profitModel.baselineSource === 'default' ? 'Range' : 'Historical range'}
              low={profitModel.rangeLowCents}
              high={profitModel.rangeHighCents}
            />
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
          id="venue-deal-models"
          icon={<WalletCards className="h-5 w-5" />}
          title="Venue Deal Models"
          subtitle={isComparingCommercialModels ? 'Agent comparison' : 'Compare structures'}
          defaultCollapsed
        >
          {isComparingCommercialModels ? (
            <p className="mb-4 rounded-md border border-clay/30 bg-clay-tint px-4 py-3 text-sm leading-snug text-ink-soft">
              The agent will compare flat rental, minimum spend, per-head CHI, bar consumption CHI, and ticket CHI before asking you to approve outreach.
            </p>
          ) : null}
          <ChiCard
            title="Per-head incentive"
            subtitle="$8 per attendee after 100"
            builderText={`Better for builder above ${Math.max(100, profitModel.paidAverage)}`}
            venueText="Capped upside"
            estimate={`≈ ${formatCents(profitModel.venueChiCents)} to host at ${profitModel.paidAverage || 'TBD'}`}
            recommended={profitModel.venueIncentiveCents === profitModel.venueChiCents && profitModel.venueChiCents > 0}
          />
          <ChiCard
            title="Bar consumption CHI"
            subtitle="12% of estimated drink spend"
            builderText="Best when guests buy drinks on site"
            venueText="Venue keeps primary bar sales"
            estimate={`≈ ${formatCents(profitModel.barConsumptionShareCents)} to host at ${profitModel.paidAverage || 'TBD'}`}
            recommended={profitModel.venueIncentiveCents === profitModel.barConsumptionShareCents && profitModel.barConsumptionShareCents > 0}
          />
          <ChiCard
            title="Ticket CHI"
            subtitle="12% of net ticket sales after fees"
            builderText="Lower if over-sold"
            venueText="Better for venue"
            estimate={`≈ ${formatCents(profitModel.consumptionShareCents)} to host at ${profitModel.paidAverage || 'TBD'}`}
            recommended={profitModel.venueIncentiveCents === profitModel.consumptionShareCents && profitModel.consumptionShareCents > 0}
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
                  {item.readinessIndicator ? (
                    <EntityReadinessBadge indicator={item.readinessIndicator} className="mt-2" />
                  ) : null}
                  {item.locationBadge ? (
                    <VendorLocationBadge {...item.locationBadge} className="mt-2" />
                  ) : null}
                  {canReportDiscoveryInfo && item.reportEntity ? (
                    <ReportIncorrectInfoButton
                      entity={item.reportEntity}
                      onReport={setReportIncorrectEntity}
                      className="mt-2"
                    />
                  ) : null}
                  {item.note ? (
                    <p className="mt-1 break-words text-sm leading-snug text-ink-soft" title={item.note}>{item.note}</p>
                  ) : null}
                </div>
                <span className="shrink-0 pt-5 text-lg font-semibold tabular-nums text-ink">{item.amountLabel}</span>
              </div>
            ))}
            {activePlanId && !activePlanId.startsWith('mock-plan-') ? (
              <button
                type="button"
                onClick={() => setIsInviteVendorModalOpen(true)}
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-clay/30 bg-cream px-3 py-2 text-sm font-bold text-clay transition-colors hover:bg-clay-tint"
              >
                <Plus className="h-4 w-4" />
                Invite a vendor I know
              </button>
            ) : null}
          </div>
        </ArtifactSection>

        <ArtifactSection
          icon={<ShieldCheck className="h-5 w-5" />}
          title="Payment + Agent Authorization"
          subtitle="Approve before action"
          defaultCollapsed={authorizationCards.length === 0}
        >
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
                      <p className="mt-2">
                        {approval.approvalId
                          ? 'Open the canonical approval card to review the exact snapshot before authorization.'
                          : 'Create an approval request first. This panel never authorizes a purchase or send directly.'}
                      </p>
                    </div>
                  ) : null}

                  {approval.isStripeGated && approval.readinessIndicator ? (
                    <div className="mt-4 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-ink-soft">
                      <div className="flex flex-wrap items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-warning" aria-hidden="true" />
                        <p className="font-semibold text-ink">Payment authorization blocked</p>
                        <EntityReadinessBadge indicator={approval.readinessIndicator} />
                      </div>
                      <p className="mt-2">
                        This partner needs to finish Stripe setup before 3rdPlace can authorize or send money. The server will send a setup reminder when you retry.
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-5 flex gap-3">
                    <button
                      type="button"
                      disabled={isLoading || isSent || approval.isStripeGated}
                      onClick={() => void handleAuthorizationAction(approval)}
                      className={cn(
                        'inline-flex flex-1 items-center justify-center rounded-md px-4 py-3 text-sm font-semibold transition-colors',
                        isSent
                          ? 'bg-forest text-cream'
                          : 'bg-gradient-brand text-cream hover:opacity-90',
                        (isLoading || isSent || approval.isStripeGated) && 'cursor-not-allowed opacity-70'
                      )}
                    >
                      {isLoading
                        ? 'Creating approval...'
                        : isSent
                          ? 'Approval created ✓'
                          : approval.isStripeGated
                            ? 'Stripe setup needed'
                            : approval.approvalId
                              ? 'Review approval'
                              : 'Create approval'}
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
                    <p className="mt-3 text-sm font-medium text-brick">Approval request failed — try again</p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </ArtifactSection>

        <ArtifactSection icon={<Check className="h-5 w-5" />} title="What 3rdPlace is using" subtitle={`${sources.length} sources available`} defaultCollapsed>
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
            ? 'Approval ready ✓'
            : primaryAuthorization
              ? 'Request venue hold'
              : 'Complete plan for holds'}
        </button>
        <p className="mt-2 truncate text-center text-xs text-ink-faint" title={activePlanId ? `Plan ${activePlanId}` : 'Plan saves after sign-in'}>
          {activePlanId ? `Plan ${activePlanId.slice(-6)}` : 'Plan saves after sign-in'}
        </p>
      </div>
      <InviteVenueModal
        isOpen={isInviteVenueModalOpen}
        activePlanId={activePlanId}
        prefill={{
          city: eventSummary.area ?? undefined,
          state: 'CA',
        }}
        onClose={() => setIsInviteVenueModalOpen(false)}
      />
      <InviteVendorModal
        isOpen={isInviteVendorModalOpen}
        activePlanId={activePlanId}
        onClose={() => setIsInviteVendorModalOpen(false)}
      />
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
    targetType: card.targetType ?? 'venue',
    targetId: card.targetId ?? null,
    payloadJson: {
      source: 'live_plan_panel',
      label: card.label,
      action_label: card.label,
      provider: card.label.replace(/^Approve\s+/i, '').replace(/\s+estimate$/i, '') || 'Recommended venue',
      amountLabel: card.amountLabel,
      price_cents: card.amountCents,
      fees_cents: 0,
      package_details: card.subtitle,
      execution_mode: 'concierge_admin_queue',
    },
    requestedAmountCents: card.amountCents,
  }
}

function ArtifactSection({
  id,
  icon,
  title,
  subtitle,
  children,
  collapsible = true,
  defaultCollapsed = false,
}: {
  id?: string
  icon: React.ReactNode
  title: string
  subtitle: string
  children: React.ReactNode
  collapsible?: boolean
  defaultCollapsed?: boolean
}) {
  const storageKey = `brief_section_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`
  const [isOpen, setIsOpen] = useState(!defaultCollapsed)

  useEffect(() => {
    if (!collapsible) {
      setIsOpen(true)
      return
    }

    try {
      const stored = window.localStorage.getItem(storageKey)
      if (stored === 'true' || stored === 'collapsed') {
        setIsOpen(false)
        return
      }
      if (stored === 'false' || stored === 'expanded') {
        setIsOpen(true)
        return
      }
    } catch {
      // Collapsibility is a convenience; ignore storage errors.
    }

    setIsOpen(!defaultCollapsed)
  }, [collapsible, defaultCollapsed, storageKey])

  function toggleSection() {
    if (!collapsible) return
    setIsOpen((current) => {
      const next = !current
      try {
        window.localStorage.setItem(storageKey, next ? 'false' : 'true')
      } catch {
        // Ignore storage errors.
      }
      return next
    })
  }

  return (
    <section id={id} className="scroll-mt-24 border-b border-tan px-4 py-7">
      {collapsible ? (
        <button
          type="button"
          onClick={toggleSection}
          aria-expanded={isOpen}
          className="mb-5 flex min-h-11 w-full items-center justify-between gap-3 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-clay"
        >
          <ArtifactSectionHeading icon={icon} title={title} subtitle={subtitle} />
          {isOpen ? <ChevronDown className="h-5 w-5 shrink-0 text-ink-soft" /> : <ChevronRight className="h-5 w-5 shrink-0 text-ink-soft" />}
        </button>
      ) : (
        <div className="mb-5 flex min-h-11 w-full items-center justify-between gap-3">
          <ArtifactSectionHeading icon={icon} title={title} subtitle={subtitle} />
        </div>
      )}
      {isOpen ? children : null}
    </section>
  )
}

function ArtifactSectionHeading({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-cream-deep text-ink-soft">
        {icon}
      </div>
      <div className="min-w-0">
        <h3 className="break-words text-lg font-semibold leading-tight text-ink" title={title}>{title}</h3>
        <p className="break-words text-sm leading-snug text-ink-soft" title={subtitle}>{subtitle}</p>
      </div>
    </div>
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

function ReportIncorrectInfoButton({
  entity,
  onReport,
  className,
}: {
  entity: ReportIncorrectInfoEntity
  onReport: (entity: ReportIncorrectInfoEntity) => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onReport(entity)}
      className={cn(
        'inline-flex min-h-9 items-center justify-center rounded-md border border-tan bg-cream px-3 text-xs font-bold uppercase tracking-[0.06em] text-ink-soft transition-colors hover:border-clay hover:text-clay focus:outline-none focus-visible:ring-2 focus-visible:ring-clay',
        className
      )}
    >
      Report incorrect info
    </button>
  )
}

function VenueOutreachStatus({
  venue,
  draftSummary,
  emailDrafts,
  emailFeedback,
  localDraftMessageIds,
  compact = false,
  onEmailChange,
  onEmailSubmit,
  onNavigateToApprovals,
}: {
  venue: RecommendationSummary
  draftSummary: GmailOutreachDraftSummary
  emailDrafts: Record<string, string>
  emailFeedback: Record<string, 'saving' | 'saved' | 'draft_created' | 'error'>
  localDraftMessageIds: Record<string, string | null>
  compact?: boolean
  onEmailChange: (venueId: string, value: string) => void
  onEmailSubmit: (venue: RecommendationSummary) => void
  onNavigateToApprovals: (messageId?: string | null) => void
}) {
  const venueId = venue.discoveryVenueId
  if (!venueId) return null

  const pendingDraft = draftSummary.pendingByVenueId.get(venueId)
  const sentInquiry = draftSummary.sentByVenueId.get(venueId)
  const localDraftMessageId = localDraftMessageIds[venueId]
  const feedback = emailFeedback[venueId]
  const inputValue = emailDrafts[venueId] ?? ''
  const hasLocalDraft = feedback === 'draft_created'
  const isDraftPending = Boolean(pendingDraft || localDraftMessageId || hasLocalDraft || venue.outreachDraftRequestStatus === 'draft_created')
  const isExtractionPending = venue.outreachDraftRequestStatus === 'extraction_pending'
  const needsEmail = venue.outreachDraftRequestStatus === 'email_required' ||
    (venue.contactStatus === 'no_contact_available' && !venue.contactEmail)

  if (isDraftPending) {
    const messageId = pendingDraft?.messageId ?? localDraftMessageId ?? venue.outreachDraftApprovalMessageId
    return (
      <button
        type="button"
        onClick={() => onNavigateToApprovals(messageId)}
        className={cn(
          'inline-flex max-w-full items-center gap-2 rounded-full border border-clay/30 bg-cream px-3 py-1.5 text-left text-xs font-bold uppercase tracking-[0.06em] text-clay transition-colors hover:border-clay hover:bg-clay hover:text-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-clay',
          compact ? 'text-[11px]' : 'mt-3'
        )}
      >
        <Mail className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">Draft pending approval</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      </button>
    )
  }

  if (sentInquiry) {
    return (
      <button
        type="button"
        onClick={() => onNavigateToApprovals(sentInquiry.messageId)}
        className={cn(
          'inline-flex max-w-full items-center gap-2 rounded-full border border-forest/25 bg-forest-tint px-3 py-1.5 text-left text-xs font-bold uppercase tracking-[0.06em] text-forest',
          compact ? 'text-[11px]' : 'mt-3'
        )}
      >
        <Check className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">Inquiry sent</span>
      </button>
    )
  }

  if (isExtractionPending) {
    return (
      <div className={cn(
        'inline-flex max-w-full items-center gap-2 rounded-full border border-tan bg-cream px-3 py-1.5 text-xs font-semibold text-ink-soft',
        compact ? 'text-[11px]' : 'mt-3'
      )}>
        <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-clay" />
        <span className="min-w-0 truncate">Checking website for contact email</span>
      </div>
    )
  }

  if (venue.contactStatus === 'contact_form_available' && venue.contactFormUrl) {
    return (
      <a
        href={venue.contactFormUrl}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'inline-flex max-w-full items-center gap-2 rounded-full border border-ochre/35 bg-ochre/10 px-3 py-1.5 text-left text-xs font-bold uppercase tracking-[0.06em] text-ochre transition-colors hover:border-ochre hover:bg-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-ochre',
          compact ? 'text-[11px]' : 'mt-3'
        )}
      >
        <Mail className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{venue.contactFormLabel ?? 'Open contact form'}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      </a>
    )
  }

  if (needsEmail) {
    return (
      <form
        className={cn('grid gap-2', compact ? 'max-w-[260px]' : 'mt-3 max-w-md sm:grid-cols-[minmax(0,1fr)_auto]')}
        onSubmit={(event) => {
          event.preventDefault()
          onEmailSubmit(venue)
        }}
      >
        <input
          type="email"
          value={inputValue}
          onChange={(event) => onEmailChange(venueId, event.target.value)}
          placeholder="booking@example.com"
          aria-label={`Contact email for ${venue.name}`}
          className="min-h-9 min-w-0 rounded-md border border-tan bg-cream px-3 text-sm font-semibold text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-clay"
        />
        <button
          type="submit"
          disabled={feedback === 'saving'}
          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-clay/35 bg-cream px-3 text-xs font-bold uppercase tracking-[0.06em] text-clay transition-colors hover:bg-clay hover:text-cream disabled:cursor-wait disabled:opacity-60"
        >
          {feedback === 'saving' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
          Add contact email
        </button>
        {feedback === 'error' ? (
          <p className="text-xs font-semibold text-brick sm:col-span-2">Enter a valid contact email.</p>
        ) : null}
        {feedback === 'saved' ? (
          <p className="text-xs font-semibold text-forest sm:col-span-2">Contact saved. Select this venue from outreach search to create a draft.</p>
        ) : null}
      </form>
    )
  }

  if (venue.contactStatus === 'contact_pending') {
    return (
      <div className={cn(
        'inline-flex max-w-full items-center gap-2 rounded-full border border-tan bg-cream px-3 py-1.5 text-xs font-semibold text-ink-soft',
        compact ? 'text-[11px]' : 'mt-3'
      )}>
        <RefreshCw className="h-3.5 w-3.5 shrink-0 text-clay" />
        <span className="min-w-0 truncate">Contact lookup available after approval</span>
      </div>
    )
  }

  if (venue.contactStatus === 'ready_to_reach_out') {
    return (
      <div className={cn(
        'inline-flex max-w-full items-center gap-2 rounded-full border border-forest/20 bg-forest-tint px-3 py-1.5 text-xs font-semibold text-forest',
        compact ? 'text-[11px]' : 'mt-3'
      )}>
        <Mail className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          Contact on file{venue.contactEmailSource ? ` · ${venue.contactEmailSource.replace(/_/g, ' ')}` : ''}
        </span>
      </div>
    )
  }

  return (
    <div className={cn(
      'inline-flex max-w-full items-center gap-2 rounded-full border border-tan bg-cream px-3 py-1.5 text-xs font-semibold text-ink-soft',
      compact ? 'text-[11px]' : 'mt-3'
    )}>
      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-ochre" />
      <span className="min-w-0 truncate">Contact status pending</span>
    </div>
  )
}

function VenueComparisonTable({
  venues,
  draftSummary,
  emailDrafts,
  emailFeedback,
  localDraftMessageIds,
  onVenueClick,
  onEmailChange,
  onEmailSubmit,
  onNavigateToApprovals,
  currentPlanRevisionCount,
  isRefreshingRecommendations,
  onRefreshRecommendations,
  canReportIncorrectInfo,
  onReportIncorrectInfo,
}: {
  venues: RecommendationSummary[]
  draftSummary: GmailOutreachDraftSummary
  emailDrafts: Record<string, string>
  emailFeedback: Record<string, 'saving' | 'saved' | 'draft_created' | 'error'>
  localDraftMessageIds: Record<string, string | null>
  onVenueClick: (venueId: string) => void
  onEmailChange: (venueId: string, value: string) => void
  onEmailSubmit: (venue: RecommendationSummary) => void
  onNavigateToApprovals: (messageId?: string | null) => void
  currentPlanRevisionCount: number
  isRefreshingRecommendations: boolean
  onRefreshRecommendations: () => void
  canReportIncorrectInfo: boolean
  onReportIncorrectInfo: (entity: ReportIncorrectInfoEntity) => void
}) {
  if (venues.length < 2) return null
  const topVenue = venues[0]

  return (
    <div className="mt-4 rounded-lg border border-tan bg-cream p-5" data-testid="venue-comparison-table">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="label-caps text-ink-soft">Compare venue options</p>
          <p className="mt-2 text-sm leading-snug text-ink-soft">
            Use this to compare fit before approving outreach, holds, or payment.
          </p>
        </div>
        <span className="rounded-full border border-tan bg-cream-deep px-3 py-1 text-xs font-bold uppercase tracking-[0.06em] text-forest">
          {venues.length} options
        </span>
      </div>

      <div className="mt-4 rounded-md border border-forest/20 bg-forest-tint/60 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-forest">Recommended first</p>
        <p className="mt-1 font-display text-lg font-semibold leading-tight text-ink">{topVenue.name}</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Best fit based on capacity, contact readiness, and event economics. Review the details below before approving outreach, holds, or payment.
        </p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[760px] w-full border-separate border-spacing-0 text-left text-sm">
          <caption className="sr-only">Side-by-side comparison of recommended venues</caption>
          <thead>
            <tr className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">
              <th scope="col" className="border-b border-tan px-3 py-3">Venue</th>
              <th scope="col" className="border-b border-tan px-3 py-3">Capacity</th>
              <th scope="col" className="border-b border-tan px-3 py-3">Commercial model</th>
              <th scope="col" className="border-b border-tan px-3 py-3">Estimate</th>
              <th scope="col" className="border-b border-tan px-3 py-3">Fit</th>
              <th scope="col" className="border-b border-tan px-3 py-3">Tags</th>
              <th scope="col" className="border-b border-tan px-3 py-3">Deal model</th>
            </tr>
          </thead>
          <tbody>
            {venues.map((venue, index) => (
              <tr key={venue.id} className="align-top">
                <td className="border-b border-tan/70 px-3 py-4">
                  <button
                    type="button"
                    onClick={() => onVenueClick(venue.id)}
                    className="text-left font-bold leading-tight text-clay underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-clay"
                    aria-label={`View full recommendation for ${venue.name}`}
                  >
                    {venue.name}
                  </button>
                  {index === 0 ? (
                    <span className="mt-2 inline-flex rounded-full bg-forest-tint px-2 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-forest">
                      Best fit
                    </span>
                  ) : null}
                  <StaleRecommendationNotice
                    planRevisionAtCreation={venue.planRevisionAtCreation}
                    currentPlanRevisionCount={currentPlanRevisionCount}
                    isRefreshing={isRefreshingRecommendations}
                    onRefresh={onRefreshRecommendations}
                    compact
                    className="mt-2"
                  />
                  <div className="mt-3">
                    <VenueOutreachStatus
                      venue={venue}
                      draftSummary={draftSummary}
                      emailDrafts={emailDrafts}
                      emailFeedback={emailFeedback}
                      localDraftMessageIds={localDraftMessageIds}
                      compact
                      onEmailChange={onEmailChange}
                      onEmailSubmit={onEmailSubmit}
                      onNavigateToApprovals={onNavigateToApprovals}
                    />
                  </div>
                  {canReportIncorrectInfo && venue.discoveryVenueId ? (
                    <ReportIncorrectInfoButton
                      entity={{ kind: 'venue', id: venue.discoveryVenueId, name: venue.name }}
                      onReport={onReportIncorrectInfo}
                      className="mt-3"
                    />
                  ) : null}
                </td>
                <td className="border-b border-tan/70 px-3 py-4 font-semibold text-ink">
                  {venue.capacity ? `${venue.capacity} guests` : 'Pending'}
                </td>
                <td className="border-b border-tan/70 px-3 py-4 text-ink-soft">
                  {venueCommercialModelLabel(venue)}
                </td>
                <td className="border-b border-tan/70 px-3 py-4 font-semibold text-ink">
                  {venueEstimateLabel(venue)}
                </td>
                <td className="border-b border-tan/70 px-3 py-4 text-ink-soft">
                  {venueFitLabel(venue, index)}
                </td>
                <td className="border-b border-tan/70 px-3 py-4">
                  <div className="flex flex-wrap gap-1.5">
                    {venueFitTags(venue).map((tag) => (
                      <span key={tag} className="rounded-full border border-tan bg-cream-deep px-2 py-1 text-[11px] font-semibold text-ink-soft">
                        {tag}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="border-b border-tan/70 px-3 py-4 text-ink-soft">
                  {venueDealModelLabel(venue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function OutreachQuoteComparison({
  responses,
  committedVenue,
  committedVendors,
  feedback,
  onCommit,
}: {
  responses: OutreachResponseSummary
  committedVenue: CommittedVenueQuote | null
  committedVendors: CommittedVendorQuote[]
  feedback: Record<string, 'saving' | 'saved' | 'error'>
  onCommit: (option: OutreachReplyOption) => void
}) {
  const venueOptions = responses.venues.filter(isActionableOutreachReply)
  const vendorOptions = responses.vendors.filter(isActionableOutreachReply)
  const hasContent = venueOptions.length > 0 || vendorOptions.length > 0 || committedVenue || committedVendors.length > 0
  if (!hasContent) return null

  return (
    <div className="mt-4 rounded-lg border border-forest/20 bg-forest/5 p-5" data-testid="outreach-quote-comparison">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="label-caps text-forest">Reply quotes</p>
          <p className="mt-2 text-sm leading-snug text-ink-soft">
            Compare verified replies before updating the event record. Booking and payment still need separate approvals.
          </p>
        </div>
        <span className="rounded-full border border-forest/20 bg-cream px-3 py-1 text-xs font-bold uppercase tracking-[0.06em] text-forest">
          {venueOptions.length + vendorOptions.length} reply option{venueOptions.length + vendorOptions.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {venueOptions.map((option) => (
          <OutreachQuoteCard
            key={`venue-${option.discoveryId}`}
            option={option}
            isCommitted={committedVenue?.discoveryVenueId === option.discoveryId}
            feedback={feedback[quoteFeedbackKey(option)]}
            onCommit={onCommit}
          />
        ))}
        {vendorOptions.map((option) => (
          <OutreachQuoteCard
            key={`vendor-${option.discoveryId}-${option.serviceType ?? 'default'}`}
            option={option}
            isCommitted={committedVendors.some((vendor) =>
              vendor.discoveryVendorId === option.discoveryId ||
              vendor.serviceType === (option.serviceType ?? 'other')
            )}
            feedback={feedback[quoteFeedbackKey(option)]}
            onCommit={onCommit}
          />
        ))}
      </div>
    </div>
  )
}

function OutreachQuoteCard({
  option,
  isCommitted,
  feedback,
  onCommit,
}: {
  option: OutreachReplyOption
  isCommitted: boolean
  feedback?: 'saving' | 'saved' | 'error'
  onCommit: (option: OutreachReplyOption) => void
}) {
  const isSaving = feedback === 'saving'
  return (
    <div className="rounded-md border border-tan bg-cream p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
            {option.kind === 'venue' ? 'Venue' : formatVendorServiceCategory(option.serviceType)}
          </p>
          <h3 className="mt-1 break-words text-base font-bold leading-tight text-ink" title={option.name}>
            {option.name}
          </h3>
        </div>
        <span className={cn(
          'shrink-0 rounded-full px-2 py-1 text-[11px] font-bold uppercase tracking-[0.06em]',
          isCommitted ? 'bg-forest-tint text-forest' : 'bg-clay-tint text-clay'
        )}>
          {isCommitted ? 'In plan' : option.status.replace(/_/g, ' ')}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-tan/70 bg-cream-deep px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">Quote</p>
          <p className="mt-1 font-semibold tabular-nums text-ink">{formatCents(option.quoteCents)}</p>
        </div>
        <div className="rounded-md border border-tan/70 bg-cream-deep px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">Confidence</p>
          <p className="mt-1 font-semibold text-ink">{option.confidence !== null ? `${Math.round(option.confidence * 100)}%` : 'Review'}</p>
        </div>
      </div>
      {option.summary ? (
        <p className="mt-3 text-sm leading-snug text-ink-soft">{option.summary}</p>
      ) : null}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs leading-snug text-ink-faint">
          {option.updatedAt ? `Updated ${formatRelativeTime(option.updatedAt, Date.now())}` : 'Reply parsed from outreach.'}
        </p>
        <button
          type="button"
          disabled={isCommitted || isSaving}
          onClick={() => onCommit(option)}
          className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-md bg-clay px-3 py-2 text-sm font-bold text-cream transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {isCommitted ? 'Approval ready' : isSaving ? 'Creating approval' : feedback === 'error' ? 'Retry' : 'Create booking approval'}
        </button>
      </div>
    </div>
  )
}

function SpecialSupplyBrief({ specialSupply }: { specialSupply: SpecialSupplyMetadata }) {
  return (
    <div className="mt-7 rounded-lg border border-clay/30 bg-cream-deep/85 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="label-caps text-clay">Special supply</p>
          <h4 className="mt-2 flex items-center gap-2 text-base font-semibold leading-tight text-ink">
            <AlertCircle className="h-4 w-4 text-clay" />
            {specialSupply.candidate_status_label}
          </h4>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
            3rdPlace scouts leads and scans their websites for contact, package, capacity, and quote clues before outreach. Contact forms are linked for manual follow-up; email outreach remains approval-gated.
          </p>
        </div>
        <div className="rounded-full border border-tan bg-cream px-3 py-1.5 text-xs font-bold uppercase tracking-[0.06em] text-forest">
          Verified quote required
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-tan bg-cream p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">Intake pack</p>
          <ul className="mt-3 space-y-2 text-sm leading-snug text-ink-soft">
            {specialSupply.intake_questions.slice(0, 4).map((question) => (
              <li key={question} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-clay" />
                <span>{question}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-md border border-tan bg-cream p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">Compare only confirmed terms</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {specialSupply.quote_comparison_fields.slice(0, 8).map((field) => (
              <span key={field} className="rounded-full border border-tan bg-cream-deep px-2.5 py-1 text-xs font-semibold text-ink-soft">
                {field}
              </span>
            ))}
          </div>
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            Execution stays in the existing lanes: concierge queue first, external checkout if the provider has one, controlled payment only after Stripe onboarding.
          </p>
        </div>
      </div>
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

function PlanRevisionBanner({
  revision,
  onViewHistory,
}: {
  revision: PlanRevisionSnapshot
  onViewHistory: () => void
}) {
  const label = revision.sourceMessageExcerpt
    ? revision.sourceMessageExcerpt
    : `${revision.type.replace(/_/g, ' ')}${revision.field ? ` · ${revision.field.replace(/_/g, ' ')}` : ''}`
  const applied = revision.appliedAt ? formatRelativeTime(revision.appliedAt) : null
  const sectionLabel = formatRevisionSectionList(revision.eventBriefSections)

  return (
    <div className="mt-4 rounded-lg border border-clay/30 bg-clay-tint/70 p-3 text-sm text-ink">
      <div className="flex items-start gap-3">
        <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-clay" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-clay">
            Plan updated{applied ? ` · ${applied}` : ''}
          </p>
          <p className="mt-1 break-words leading-snug text-ink-soft">
            {label}. Stale recommendations and approvals are blocked while the agent refreshes current options.
          </p>
          {sectionLabel ? (
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.08em] text-forest">
              Event record refreshed: {sectionLabel}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onViewHistory}
          className="inline-flex min-h-10 shrink-0 items-center rounded-md border border-clay/25 bg-cream px-3 text-xs font-bold uppercase tracking-[0.06em] text-clay transition-colors hover:bg-clay hover:text-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-clay"
        >
          View history
        </button>
      </div>
    </div>
  )
}

function formatRevisionSectionList(sections: string[]) {
  const labels = sections
    .map((section) => section.replace(/_/g, ' '))
    .filter(Boolean)
    .slice(0, 6)
  if (labels.length === 0) return null
  const suffix = sections.length > labels.length ? ` +${sections.length - labels.length}` : ''
  return `${labels.join(', ')}${suffix}`
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

function ChiCard({
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

function formatTicketsOrRsvps(attendance: PlanAttendanceSnapshot) {
  if (attendance.ticketsSold !== null) {
    const refunds = attendance.ticketsRefunded ?? 0
    if (refunds > 0) {
      const activeTickets = Math.max(attendance.ticketsSold - refunds, 0)
      return `${formatWholeNumber(activeTickets)} active (${formatWholeNumber(attendance.ticketsSold)} sold)`
    }

    return `${formatWholeNumber(attendance.ticketsSold)} sold`
  }

  if (attendance.currentAttendance !== null) {
    return `${formatWholeNumber(attendance.currentAttendance)} confirmed`
  }

  return 'No ticketing signal yet'
}

function formatCheckedInCount(attendance: PlanAttendanceSnapshot) {
  if (attendance.checkedIn !== null) return `${formatWholeNumber(attendance.checkedIn)} checked in`
  return 'No check-ins yet'
}

function formatRemainingCapacity(attendance: PlanAttendanceSnapshot, guestTarget: number | null) {
  if (!guestTarget || guestTarget <= 0) return 'Set guest target'
  if (!hasAttendanceSignal(attendance)) return 'No sales signal yet'
  const committed = attendance.ticketsSold !== null
    ? Math.max(attendance.ticketsSold - (attendance.ticketsRefunded ?? 0), 0)
    : attendance.currentAttendance ?? attendance.checkedIn
  if (committed === null) return 'No sales signal yet'
  const remaining = Math.max(guestTarget - committed, 0)
  return `${formatWholeNumber(remaining)} remaining`
}

function formatWholeNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
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
  if (isRecommendBestModel(summary.consumption_share)) return 'Flexible while agent compares'
  return 'Need terms'
}

function formatRevenueModelValue(summary: EventSummary) {
  if (isRecommendBestModel(summary.consumption_share)) return 'Agent recommends best model'
  return summary.consumption_share ?? 'Need commercial model'
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
  const capacity = recommendation.capacity
    ? `Cap ${recommendation.capacity}`
    : recommendation.capacityKnown === false
      ? 'Capacity TBD — confirm with venue'
      : 'Capacity pending'
  return `${address} · ${capacity}`
}

function venueCommercialModelLabel(venue: RecommendationSummary) {
  if (venue.commercialModelMatch) return venue.commercialModelMatch
  if (typeof venue.priceCents === 'number' && venue.priceCents < 0) return 'CHI incentive'
  if (typeof venue.priceCents === 'number' && venue.priceCents > 0) return 'Rental or minimum'
  if (/spend|rental|deposit|fee/i.test(venue.priceLabel)) return 'Rental or minimum'
  return 'Terms pending'
}

function venueEstimateLabel(venue: RecommendationSummary) {
  if (typeof venue.priceCents === 'number') {
    if (venue.priceCents < 0) return `+${formatCents(Math.abs(venue.priceCents))} back`
    return formatCents(venue.priceCents)
  }

  return venue.priceLabel && venue.priceLabel !== 'Pricing pending' ? venue.priceLabel : 'TBD'
}

function venueFitLabel(venue: RecommendationSummary, index: number) {
  const fitScore = extractFitScore(venue.fit)
  if (fitScore) return fitScore
  return index === 0 ? 'Top ranked' : 'Strong candidate'
}

function extractFitScore(value: string | null) {
  if (!value) return null
  const match = value.match(/\b(\d{1,3})\s*%/)
  if (!match) return null
  return `${match[1]}%`
}

function venueFitTags(venue: RecommendationSummary) {
  if (venue.tags.length > 0) return venue.tags.slice(0, 3)

  const fallbackTags: string[] = []
  if (venue.address) fallbackTags.push(venue.address)
  if (venue.capacity) fallbackTags.push(`${venue.capacity} cap`)
  if (!venue.capacity && venue.capacityKnown === false) fallbackTags.push('Capacity TBD')
  if (typeof venue.priceCents === 'number' && venue.priceCents < 0) fallbackTags.push('CHI')
  if (fallbackTags.length === 0 && venue.fit) fallbackTags.push(venue.fit.slice(0, 48))
  return fallbackTags.length > 0 ? fallbackTags.slice(0, 3) : ['Needs review']
}

function recommendationFromSelectedVenue(venue: SelectedPlanVenue, summary: EventSummary): RecommendationSummary {
  const capacity = venue.standingCapacity ?? venue.seatedCapacity
  const location = [venue.city, venue.state].filter(Boolean).join(', ') || summary.area || null
  return {
    id: venue.venueId ?? venue.id ?? venue.name,
    name: venue.name,
    type: 'venue',
    priceLabel: formatSelectedVenuePriceLabel(venue),
    priceCents: venue.priceCents,
    address: location,
    capacity,
    capacityKnown: typeof capacity === 'number',
    fit: 'Known venue added by the organizer. Claim and Stripe setup are still required before payment.',
    holdDurationHours: 48,
    commercialModelMatch: venue.termType,
    dealModelSummary: formatSelectedVenueTermLabel(venue),
    tags: ['Known venue', venue.claimStatus === 'invited_unclaimed' ? 'Invite pending' : 'Private terms'].filter(Boolean),
    discoveryVenueId: venue.venueId,
    contactStatus: 'ready_to_reach_out',
    contactEmail: null,
    contactEmailSource: null,
    contactEmailConfidence: null,
    contactFormUrl: null,
    contactFormLabel: null,
    contactFormSourcePath: null,
    contactPhone: null,
    website: null,
    extractionStatus: null,
    discoveryCandidateStatus: null,
    outreachDraftRequestStatus: null,
    outreachDraftApprovalMessageId: null,
    outreachDraftApprovalId: null,
    outreachApprovalCreatedAt: null,
    isClaimed: venue.isClaimed,
    claimStatus: venue.claimStatus,
    invitedAt: venue.invitedAt,
    stripeConnectStatus: null,
    settledAt: null,
    settledAmountCents: null,
    planRevisionAtCreation: null,
    formattedAddress: location,
    city: venue.city,
    neighborhood: null,
    serviceArea: null,
    servesEventCity: null,
    outOfCityApproved: null,
    specialSupply: null,
  }
}

function formatSelectedVenuePriceLabel(venue: SelectedPlanVenue) {
  if (venue.termType === 'no_charge') return 'No charge'
  if (venue.termType === 'tbd') return 'Terms TBD'
  return formatCents(venue.priceCents)
}

function formatSelectedVenueTermLabel(venue: SelectedPlanVenue) {
  const labels: Record<string, string> = {
    flat_rental: 'Flat rental',
    minimum_spend: 'Minimum spend',
    per_head_chi: 'Per-head CHI',
    bar_chi: 'Bar consumption CHI',
    no_charge: 'No charge',
    tbd: 'Terms to confirm',
  }
  return labels[venue.termType ?? ''] ?? 'Private terms'
}

function venueDealModelLabel(venue: RecommendationSummary) {
  if (venue.dealModelSummary) return venue.dealModelSummary
  if (typeof venue.priceCents === 'number' && venue.priceCents < 0) return 'Host receives projected attendance-based CHI after confirmed spend.'
  if (typeof venue.priceCents === 'number' && venue.priceCents > 0) return 'Host pays this estimate after approval and confirmed terms.'
  return 'Agent needs partner confirmation before this can be approved.'
}

function buildShoppingList(
  primaryVenue: RecommendationSummary | null,
  budgetItems: BudgetLineItem[],
  summary: EventSummary,
  selectedVendors: SelectedPlanVendor[] = [],
  livePlan: LivePlanSnapshot | null = null,
  nowMs = Date.now()
): ShoppingListItem[] {
  const venueCost = livePlan?.committedVenue?.quotedPriceCents ?? primaryVenue?.priceCents ?? budgetItems[0]?.amountCents ?? null
  const vendorCost = budgetItems.find((item) => /vendor|dinner|food/i.test(item.label))?.amountCents ?? null
  const guestCount = summary.guest_count ?? 0
  const noOrganizerFoodCost = hasNoOrganizerFoodCost(summary)
  const items: ShoppingListItem[] = []

  addShoppingItem(items, {
    category: 'Venue',
    label: livePlan?.committedVenue?.name ?? primaryVenue?.name ?? deriveVenueShoppingLabel(summary),
    amountLabel: formatVenueShoppingAmount(summary, venueCost),
    note: livePlan?.committedVenue
      ? `In-plan reply${livePlan.committedVenue.quotedDealModel ? ` · ${livePlan.committedVenue.quotedDealModel}` : ''}.`
      : primaryVenue?.fit ?? deriveVenueShoppingNote(summary),
    badge: livePlan?.committedVenue ? 'In plan' : undefined,
    readinessIndicator: resolveVenueReadiness(primaryVenue, livePlan, nowMs, Boolean(livePlan?.committedVenue)),
    reportEntity: primaryVenue?.discoveryVenueId
      ? { kind: 'venue', id: primaryVenue.discoveryVenueId, name: primaryVenue.name }
      : undefined,
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

  if (summary.vendor_need_status !== 'none') {
    for (const vendor of livePlan?.committedVendors ?? []) {
      addShoppingItem(items, {
        category: formatVendorServiceCategory(vendor.serviceType),
        label: vendor.name ?? formatVendorServiceCategory(vendor.serviceType),
        amountLabel: formatCents(committedVendorQuoteCents(vendor)),
        note: 'In-plan reply. Payment or booking still requires a separate approval.',
        badge: 'In plan',
        readinessIndicator: resolveCommittedVendorReadiness(vendor, nowMs),
      })
    }

    for (const vendor of selectedVendors) {
      addShoppingItem(items, {
        category: formatVendorServiceCategory(vendor.serviceType),
        label: vendor.name,
        amountLabel: typeof vendor.priceCents === 'number' ? formatCents(vendor.priceCents) : formatVendorRateAmount(vendor),
        note: vendor.provenanceLabel ?? deriveSelectedVendorNote(vendor),
        badge: vendor.claimStatus === 'invited_unclaimed' ? 'Invited — pending signup' : undefined,
        readinessIndicator: resolveSelectedVendorReadiness(vendor, nowMs),
        locationBadge: vendorLocationBadgeForSelectedVendor(vendor, livePlan, summary),
        reportEntity: vendor.vendorId
          ? { kind: 'vendor', id: vendor.vendorId, name: vendor.name }
          : undefined,
      })
    }
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

function vendorLocationBadgeForSelectedVendor(
  vendor: SelectedPlanVendor,
  livePlan: LivePlanSnapshot | null,
  summary: EventSummary
): VendorLocationBadgeProps | null {
  if (!vendor.city && !vendor.neighborhood && !vendor.formattedAddress && !vendor.serviceArea && !vendor.specialSupply) return null

  return {
    eventCity: livePlan?.eventCity ?? summary.area,
    vendorCity: vendor.city,
    neighborhood: vendor.neighborhood,
    formattedAddress: vendor.formattedAddress,
    serviceArea: vendor.serviceArea,
    servesEventCity: vendor.servesEventCity,
    approved: vendor.outOfCityApproved,
    specialSupply: vendor.specialSupply ?? Boolean(livePlan?.specialSupply ?? summary.special_supply),
  }
}

function resolveVenueReadiness(
  primaryVenue: RecommendationSummary | null,
  livePlan: LivePlanSnapshot | null,
  nowMs: number,
  forceCommitted = false
) {
  const committedVenue = livePlan?.committedVenue ?? null
  const committedApplies = Boolean(
    committedVenue && (forceCommitted || !primaryVenue || isCommittedVenueForRecommendation(committedVenue, primaryVenue))
  )
  const entity: EntityStripeReadinessInput | null =
    primaryVenue
      ? {
        name: primaryVenue.name,
        isClaimed: primaryVenue.isClaimed,
        claimStatus: primaryVenue.claimStatus,
        invitedAt: primaryVenue.invitedAt,
        stripeConnectStatus: primaryVenue.stripeConnectStatus,
      }
      : committedVenue
        ? { name: committedVenue.name }
        : null

  if (!entity && !committedVenue) return null

  return resolveEntityReadiness({
    entityType: 'venue',
    entity,
    committedAmount: committedApplies ? committedVenue?.quotedPriceCents ?? null : null,
    committedAt: committedApplies ? committedVenue?.committedAt ?? null : null,
    settledAmount: committedApplies
      ? committedVenue?.settledAmountCents ?? committedVenue?.quotedPriceCents ?? null
      : primaryVenue?.settledAmountCents ?? null,
    settledAt: committedApplies ? committedVenue?.settledAt ?? null : primaryVenue?.settledAt ?? null,
    nowMs,
  })
}

function resolveSelectedVendorReadiness(vendor: SelectedPlanVendor, nowMs: number) {
  return resolveEntityReadiness({
    entityType: 'vendor',
    entity: {
      name: vendor.name,
      isClaimed: vendor.isClaimed,
      claimStatus: vendor.claimStatus,
      invitedAt: vendor.invitedAt,
      stripeConnectStatus: vendor.stripeConnectStatus,
    },
    settledAmount: vendor.settledAmountCents ?? vendor.priceCents,
    settledAt: vendor.settledAt,
    nowMs,
  })
}

function resolveCommittedVendorReadiness(vendor: CommittedVendorQuote, nowMs: number) {
  return resolveEntityReadiness({
    entityType: 'vendor',
    entity: { name: vendor.name },
    committedAmount: committedVendorQuoteCents(vendor),
    committedAt: vendor.committedAt,
    settledAmount: vendor.settledAmountCents ?? committedVendorQuoteCents(vendor),
    settledAt: vendor.settledAt,
    nowMs,
  })
}

function isCommittedVenueForRecommendation(committedVenue: CommittedVenueQuote, venue: RecommendationSummary) {
  return (
    committedVenue.discoveryVenueId === venue.discoveryVenueId ||
    committedVenue.discoveryVenueId === venue.id ||
    Boolean(committedVenue.name && committedVenue.name === venue.name)
  )
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
  if (summary.vendor_need_status === 'none' || isNoVendorNeed(summary.vendor_needs)) return []

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
  if (summary.vendor_need_status === 'none') return false
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
  if (summary.vendor_need_status === 'none') return false
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
  if (summary.vendor_need_status === 'none') return false
  return summaryMatches(summary, /\b(photo|photographer|videographer|content|brand|launch|gala|fundraiser|birthday|wedding|gallery|art show|red carpet)\b/i)
}

function derivePhotographyShoppingLabel(summary: EventSummary) {
  if (summaryMatches(summary, /\b(video|videographer)\b/i)) return 'Photo/video coverage'
  if (summaryMatches(summary, /\b(brand|launch|gallery|art)\b/i)) return 'Event content capture'
  return 'Event photographer'
}

function shouldIncludeSportOps(summary: EventSummary) {
  if (summary.vendor_need_status === 'none') return false
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
    summary.consumption_share,
  ].filter(Boolean).join(' '))
}

function buildAuthorizationCards(
  approvals: PendingApproval[],
  primaryVenue: RecommendationSummary | null,
  budgetItems: BudgetLineItem[],
  primaryVenueReadiness: EntityReadinessIndicator | null
): AuthorizationCardModel[] {
  if (approvals.length > 0) {
    return approvals.map((approval) => ({
      id: approval.id,
      approvalId: approval.approvalId ?? undefined,
      approvalMessageId: approval.messageId,
      label: approval.label,
      subtitle: approval.subtitle ?? approval.status,
      amountLabel: formatCents(approval.amountCents),
      amountCents: approval.amountCents ?? 0,
    }))
  }

  const venueCost = primaryVenue?.priceCents ?? budgetItems[0]?.amountCents ?? 0
  if (!primaryVenue) return []
  const venueStripeGated = venueCost > 0 && Boolean(
    primaryVenueReadiness &&
      !['stripe_ready', 'committed', 'settled'].includes(primaryVenueReadiness.status)
  )

  return [
    {
      id: 'venue-estimate',
      label: primaryVenue?.name ? `Approve ${primaryVenue.name} estimate` : 'Approve venue estimate',
      subtitle: 'Matches the recommendation estimate before final venue terms are confirmed',
      amountLabel: venueCost > 0 ? formatCents(venueCost) : 'TBD',
      amountCents: venueCost,
      targetType: 'venue',
      targetId: primaryVenue.id,
      readinessIndicator: primaryVenueReadiness,
      isStripeGated: venueStripeGated,
    },
    {
      id: 'venue-hold',
      label: 'Place date hold',
      subtitle: `${primaryVenue?.holdDurationHours ?? 48}-hour temporary venue hold`,
      amountLabel: 'No charge',
      amountCents: 0,
      targetType: 'venue',
      targetId: primaryVenue.id,
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
