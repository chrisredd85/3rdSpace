'use client'

import type { Plan, PlanMessage, PlannerFullPlanResponse, PlannerListPlansResponse } from '@/lib/types'
import { normalizePlanAttendanceSnapshot } from '@/lib/planner/attendanceSummary'
import { activeConversationStorageKey, planTabs, type EventPlanPayload, type PendingConversionAction, type PendingConversionActionType, type PlannerAccountSummary, type PlannerStateLoadResult, type PlannerTab, type TimelineOutput } from './types'

const PLANNER_STATE_CACHE_TTL_MS = 5_000
const plannerStateRequestCache = new Map<string, {
  createdAt: number
  promise: Promise<PlannerStateLoadResult>
}>()

export function buildEventPlanPayload(plan: Plan): EventPlanPayload {
  return {
    event_name: plan.title ?? null,
    expected_attendance: plan.guest_count,
    city: inferPlanCity(plan.neighborhood),
    venue_type: plan.event_type,
    budget: plan.budget_cap_cents,
    event_date: plan.date_window_start ?? plan.date_window_end,
    monetization_model: plan.ticketed ? 'ticketed' : plan.ticketing_model ?? 'free',
    headcount_min: plan.guest_count,
    headcount_max: plan.guest_count,
    ticket_price_target: null,
    profit_goal: plan.profit_goal_cents,
  }
}

export function inferPlanCity(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'sf' || normalized.includes('san francisco')) return 'San Francisco'
  if (normalized.includes('oakland')) return 'Oakland'
  if (normalized.includes('berkeley')) return 'Berkeley'
  return value ?? null
}

export function isTimelineOutput(value: unknown): value is TimelineOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const output = value as Record<string, unknown>
  return (
    Array.isArray(output.planning_milestones) &&
    Array.isArray(output.day_of_timeline) &&
    Array.isArray(output.staffing_needs) &&
    Array.isArray(output.reminders) &&
    Array.isArray(output.dependency_warnings) &&
    typeof output.impossible_timeline === 'boolean'
  )
}

/**
 * Returns the filtered message list for the active planner tab.
 *
 * Chat tab is now conversational only — recommendation and approval cards are
 * replaced inline with compact narration chips that route the user to the
 * correct tab. The Recommendations and Approvals tabs continue to render the
 * full cards via their existing filters.
 */
export function getVisibleMessages(messages: PlanMessage[], activeTab: PlannerTab) {
  if (activeTab === 'recommendations') return messages.filter(isRecommendationMessage)
  if (activeTab === 'approvals') return messages.filter(isApprovalMessage)
  if (activeTab !== 'chat') return messages

  return messages.map((message) => {
    if (isRecommendationMessage(message)) return toNarrationChipMessage(message, 'recommendations')
    if (isApprovalMessage(message)) return toNarrationChipMessage(message, 'approvals')
    return message
  })
}

/**
 * Wraps a recommendation/approval message as a synthetic chat-thread chip:
 * one-line summary + tab target. Preserves the original `id` so deep linking
 * (?tab=...&msg=...) can scroll the destination tab to the same card.
 */
export function toNarrationChipMessage(
  message: PlanMessage,
  targetTab: 'recommendations' | 'approvals'
): PlanMessage {
  const meta = (message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata))
    ? message.metadata as Record<string, unknown>
    : {}
  const phase = typeof meta.phase === 'string' ? meta.phase : null
  const recs = Array.isArray(meta.recommendations) ? meta.recommendations : []
  const venueCount = recs.filter((rec) => (rec as Record<string, unknown>)?.type === 'Venue').length
  const vendorCount = recs.length - venueCount
  const hasGate = Boolean(meta.economics_gate)

  let summary: string
  if (targetTab === 'approvals') {
    summary = 'Approval ready — review in Approvals.'
  } else if (phase === 'venues') {
    summary = `${venueCount || recs.length} venue ${(venueCount || recs.length) === 1 ? 'match' : 'matches'} ready — open Recommendations.`
  } else if (hasGate) {
    summary = `Vendors + pricing check — open Recommendations.`
  } else if (vendorCount > 0) {
    summary = `${vendorCount} vendor ${vendorCount === 1 ? 'option' : 'options'} ready — open Recommendations.`
  } else {
    summary = 'Recommendations updated — open Recommendations.'
  }

  return {
    ...message,
    message_type: 'text',
    content: summary,
    metadata: { ...meta, kind: 'narration_chip', target_tab: targetTab, target_msg_id: message.id },
  }
}

/**
 * Guards custom signup-gate events emitted by sibling planner panels.
 */
export function isPendingConversionAction(value: unknown): value is PendingConversionAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actionType = (value as Record<string, unknown>).type
  return actionType === 'save' || actionType === 'hold' || actionType === 'authorize'
}

/**
 * User-facing success copy after a gated action resumes.
 */
export function getPendingActionSuccessMessage(type: PendingConversionActionType) {
  if (type === 'authorize') return 'Authorization recorded.'
  if (type === 'hold') return 'Hold request created.'
  return 'Plan saved.'
}

/**
 * Counts messages shown in badge-bearing tabs.
 */
export function getTabCount(activeTab: PlannerTab, recommendationCount: number, approvalCount: number) {
  if (activeTab === 'recommendations') return recommendationCount
  if (activeTab === 'approvals') return approvalCount
  return null
}

export function getPlannerOrganizationName(account: PlannerAccountSummary | null) {
  const companyName = account?.companyName?.trim()
  if (companyName) return companyName

  const emailPrefix = account?.email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim()
  if (emailPrefix) return emailPrefix

  return 'Creator workspace'
}

export function getPlannerRoleLabel(account: PlannerAccountSummary | null) {
  if (account?.userType === 'community_builder') return 'Organizer'
  if (account?.userType === 'venue_owner') return 'Venue'
  if (account?.userType === 'vendor') return 'Vendor'
  return 'Planner'
}

/**
 * Matches structured plan messages, including legacy agent text responses.
 */
export function isPlanArtifactMessage(message: PlanMessage) {
  const messageType = String(message.message_type)
  return (
    messageType === 'confirmation_card' ||
    messageType === 'status_update' ||
    messageType === 'agent_response' ||
    (messageType === 'text' && message.role === 'agent')
  )
}

/**
 * Matches planner recommendation messages that carry real cards or an
 * economics gate. Excludes "I have enough to start matching" acknowledgement
 * messages which have neither — those stay in Chat as conversational text.
 */
export function isRecommendationMessage(message: PlanMessage) {
  if (String(message.message_type) !== 'recommendation') return false
  const meta = message.metadata
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false
  const record = meta as Record<string, unknown>
  const recs = record.recommendations
  if (Array.isArray(recs) && recs.length > 0) return true
  if (record.economics_gate) return true
  const vendorRecs = record.vendor_recommendations
  if (Array.isArray(vendorRecs) && vendorRecs.length > 0) return true
  return false
}

/**
 * Matches planner approval request messages.
 */
export function isApprovalMessage(message: PlanMessage) {
  return String(message.message_type) === 'approval_request'
}

/**
 * Reads narration-chip metadata produced by `toNarrationChipMessage` for Chat
 * tab rendering. Returns null on regular messages so the existing bubble path
 * is unaffected.
 */
export function readNarrationChipMetadata(message: PlanMessage): {
  target_tab: 'recommendations' | 'approvals'
  target_msg_id: string
} | null {
  const meta = message.metadata
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const record = meta as Record<string, unknown>
  if (record.kind !== 'narration_chip') return null
  const tab = record.target_tab
  const msgId = record.target_msg_id
  if (tab !== 'recommendations' && tab !== 'approvals') return null
  if (typeof msgId !== 'string') return null
  return { target_tab: tab, target_msg_id: msgId }
}

/**
 * Returns true when a confirmation card has been superseded by a newer one in the rendered list.
 */
export function hasNewerConfirmationMessage(messages: PlanMessage[], messageIndex: number) {
  const message = messages[messageIndex]
  if (!message || String(message.message_type) !== 'confirmation_card') return false

  return messages
    .slice(messageIndex + 1)
    .some((nextMessage) => String(nextMessage.message_type) === 'confirmation_card')
}

export function publishLivePlan(plan: Plan | null, messages: PlanMessage[]) {
  if (typeof window === 'undefined') return

  if (!plan) {
    window.localStorage.removeItem('planner-live-plan')
    window.dispatchEvent(new CustomEvent('planner-live-plan:update', { detail: { plan: null, messages: [], planId: null } }))
    return
  }

  const snapshot = {
    title: plan.title,
    eventType: plan.event_type,
    status: plan.status,
    guestCount: plan.guest_count,
    budgetCapCents: plan.budget_cap_cents,
    neighborhood: plan.neighborhood,
    dateWindowStart: plan.date_window_start,
    dateWindowEnd: plan.date_window_end,
    ticketed: plan.ticketed,
    ticketingModel: plan.ticketing_model ?? null,
    ticketPriceTargetCents: readPlanTicketPriceTargetCents(plan),
    foodResponsibility: plan.food_responsibility ?? null,
    venueTerms: plan.venue_terms ?? null,
    actionPermission: plan.agent_action ?? null,
    notes: plan.notes ?? null,
    runOfShow: readPlanAgentCacheOutput(plan, 'timeline'),
    workspaceSummary: readPlanAgentCacheOutput(plan, 'workspace_summary'),
    selectedVendors: readPlanSelectedVendors(plan),
    attendance: normalizePlanAttendanceSnapshot(plan, plan.metadata),
    updatedAt: plan.updated_at,
  }

  const payload = {
    plan: snapshot,
    messages,
    planId: plan.id,
  }

  window.localStorage.setItem('planner-live-plan', JSON.stringify(payload))
  window.dispatchEvent(new CustomEvent('planner-live-plan:update', { detail: payload }))
}

export function readPlanTicketPriceTargetCents(plan: Plan): number | null {
  const metadata = readRecord(plan.metadata)
  const cents = readFiniteNumber(metadata?.ticket_price_target_cents)
  if (cents !== null && cents > 0) return cents

  const value = readFiniteNumber(metadata?.ticket_price_target)
  if (value !== null && value > 0) return Math.round(value < 1000 ? value * 100 : value)

  return null
}

export function shouldStartNewPlanFromReply(message: string, activePlan: Plan): boolean {
  if (activePlan.status === 'complete' || activePlan.status === 'archived') return true
  const normalized = message.toLowerCase()
  if (isNewConversationResetRequest(normalized)) return true

  const startsLikeNewPlan =
    /\b(start|create|plan|host|throw|organize)\s+(?:a|an|another|new)\b/.test(normalized) ||
    /\b(new|different)\s+(?:event|plan)\b/.test(normalized) ||
    /\bactually\s+(?:make|create|plan|host|throw)\b/.test(normalized)
  if (!startsLikeNewPlan) return false

  return /\b(event|dinner|party|workshop|class|launch|hackathon|fundraiser|gala|watch party|screening|retreat|offsite|mixer|happy hour|listening party|showcase|pop-?up|activation|run club|wellness)\b/.test(normalized)
}

export function isNewConversationResetRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  return /\b(new|fresh)\s+(chat|conversation)\b/.test(normalized) || /\bstart\s+over\b/.test(normalized)
}

export function readPlanAgentCacheOutput(plan: Plan, key: 'timeline' | 'workspace_summary'): Record<string, unknown> | null {
  const metadata = readRecord(plan.metadata)
  const agentCache = readRecord(metadata?.agent_cache)
  const cacheEntry = readRecord(agentCache?.[key])
  return readRecord(cacheEntry?.output)
}

export function readPlanSelectedVendors(plan: Plan): Record<string, unknown>[] {
  const metadata = readRecord(plan.metadata)
  const shoppingList = readRecord(metadata?.shopping_list)
  return Array.isArray(shoppingList?.selected_vendors)
    ? shoppingList.selected_vendors.flatMap((item) => {
        const record = readRecord(item)
        return record ? [record] : []
      })
    : []
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

export function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Reads the active planner conversation so route changes do not reset the chat.
 */
export function readStoredPlannerConversation(): { plan: Plan; messages: PlanMessage[] } | null {
  if (typeof window === 'undefined') return null

  const raw = window.localStorage.getItem(activeConversationStorageKey)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<{ plan: Plan; messages: PlanMessage[] }>
    if (!parsed.plan || typeof parsed.plan.id !== 'string') {
      clearStoredPlannerConversation()
      return null
    }

    if (isExecutedPlanStatus(parsed.plan.status)) {
      clearStoredPlannerConversation()
      return null
    }

    return {
      plan: parsed.plan,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    }
  } catch {
    clearStoredPlannerConversation()
    return null
  }
}

/**
 * Persists the current conversation until the user starts a new event or the plan completes.
 */
export function persistStoredPlannerConversation(plan: Plan | null, messages: PlanMessage[], shouldPersistDraft: boolean) {
  if (typeof window === 'undefined') return

  if (!shouldPersistDraft || !plan || isExecutedPlanStatus(plan.status)) {
    clearStoredPlannerConversation()
    return
  }

  window.localStorage.setItem(
    activeConversationStorageKey,
    JSON.stringify({
      plan,
      messages,
      savedAt: new Date().toISOString(),
    })
  )
}

/**
 * Clears persisted planner conversation state after an explicit new-event action.
 */
export function clearStoredPlannerConversation() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(activeConversationStorageKey)
}

/**
 * Returns true for terminal plan states that should not restore as an active chat.
 */
export function isExecutedPlanStatus(status: Plan['status']) {
  return status === 'complete' || status === 'archived'
}



export async function loadPlannerStateFromApiCached(requestedPlanId: string | null): Promise<PlannerStateLoadResult> {
  const cacheKey = requestedPlanId ? `plan:${requestedPlanId}` : 'active-plan'
  const cached = plannerStateRequestCache.get(cacheKey)
  const now = Date.now()

  if (cached && now - cached.createdAt < PLANNER_STATE_CACHE_TTL_MS) {
    return cached.promise
  }

  const promise = loadPlannerStateFromApi(requestedPlanId)
  plannerStateRequestCache.set(cacheKey, { createdAt: now, promise })

  try {
    return await promise
  } catch (error) {
    plannerStateRequestCache.delete(cacheKey)
    throw error
  }
}

export async function loadPlannerStateFromApi(requestedPlanId: string | null): Promise<PlannerStateLoadResult> {
  if (requestedPlanId) {
    return loadPlannerPlanDetail(requestedPlanId)
  }

  const response = await fetch('/api/planner/plans?limit=10', { method: 'GET' })

  if (response.status === 401 || response.status === 403) {
    return { status: 'unauthorized' }
  }

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.error ?? 'Unable to load planner plans')
  }

  const listData = payload as PlannerListPlansResponse
  const activeStoredPlan = listData.plans.find((plan) => plan.status !== 'archived')
  if (!activeStoredPlan) return { status: 'loaded', plan: null, messages: [] }

  return loadPlannerPlanDetail(activeStoredPlan.id)
}

export async function loadPlannerPlanDetail(planId: string): Promise<PlannerStateLoadResult> {
  const detailResponse = await fetch(`/api/planner/plans/${planId}`, { method: 'GET' })

  if (detailResponse.status === 401 || detailResponse.status === 403) {
    return { status: 'unauthorized' }
  }

  const detailPayload = await detailResponse.json()
  if (!detailResponse.ok) {
    throw new Error(detailPayload?.error ?? 'Unable to load active planner plan')
  }

  const detailData = detailPayload as PlannerFullPlanResponse
  return {
    status: 'loaded',
    plan: detailData.plan,
    messages: detailData.messages,
  }
}
