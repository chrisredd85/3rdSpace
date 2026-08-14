/**
 * Pure derivation layer for planner timeline milestone statuses.
 *
 * This module computes per-milestone status (done / in_progress / blocked /
 * overdue / pending / awaiting_venue_response) from observable planner state.
 * The derivation intentionally stays conservative: it marks a milestone as
 * "done" only when there is a clear signal, and falls back to "pending"
 * (neutral) rather than surfacing false-positive blockers.
 *
 * Signals used:
 * - Completed hold_request with a structured hold_confirmed outcome → active venue hold
 * - Pending/approved/executing hold_request action → awaiting venue response
 * - Approval message with kind = 'venue_outreach' + status authorized → outreach sent
 * - Plan.ticketed + plan.ticketing_model → ticketing intent
 */

import type { PlanMessage } from '@/lib/types/planner'
import type { PlanningMilestone } from '@/lib/events/milestoneTemplates'

export type MilestoneStatus = 'done' | 'in_progress' | 'blocked' | 'overdue' | 'pending' | 'awaiting_venue_response'

export interface DerivedMilestone extends PlanningMilestone {
  /** Computed lifecycle status for the milestone. */
  status: MilestoneStatus
  /** Human-readable explanation when status is blocked or overdue. */
  blocker_reason?: string
  /** Planner tab that can resolve the blocker. */
  blocker_tab?: 'recommendations' | 'approvals'
  /** ID of the specific planner message to scroll to when resolving. */
  blocker_msg_id?: string
  /** Venue name for pending hold requests, when known. */
  awaiting_venue_name?: string
}

/**
 * Minimal plan shape needed for derivation — avoids importing the full Plan
 * interface so this module stays portable.
 */
export interface DerivationPlan {
  ticketed: boolean
  ticketing_model?: string | null
}

export interface DerivationAgentAction {
  id: string
  action_type?: string | null
  status?: string | null
  target_type?: string | null
  payload_json?: unknown
  result_metadata?: unknown
  created_at?: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivation context — built once per call from the messages list
// ─────────────────────────────────────────────────────────────────────────────

interface DerivationContext {
  /** A hold_request completed with a structured hold_confirmed outcome. */
  hasVenueHold: boolean
  /** A hold_request exists but has not reached a terminal outcome. */
  hasPendingVenueHold: boolean
  /** Pending hold request venue name, when present in action metadata. */
  awaitingVenueName: string | null
  /** A venue_outreach approval message exists in the thread. */
  hasOutreachApproval: boolean
  /** The venue_outreach approval has been authorized/approved. */
  outreachApproved: boolean
  /** ID of the most recent phase-2 recommendation message (for deep-link scroll). */
  recMsgId: string | null
  /** ID of the most recent venue_outreach approval message (for deep-link scroll). */
  outreachMsgId: string | null
}

const TERMINAL_HOLD_STATUSES = new Set(['complete', 'cancelled', 'canceled', 'failed', 'rejected', 'declined', 'expired'])

function readMeta(message: PlanMessage): Record<string, unknown> | null {
  if (!message.metadata || typeof message.metadata !== 'object' || Array.isArray(message.metadata)) {
    return null
  }
  return message.metadata as Record<string, unknown>
}

function readApprovalStatus(meta: Record<string, unknown>): string | null {
  // Status may live directly on metadata OR on the nested approval record.
  const direct = meta.status
  if (typeof direct === 'string') return direct
  const approval = meta.approval
  if (approval && typeof approval === 'object' && !Array.isArray(approval)) {
    const nested = (approval as Record<string, unknown>).status
    if (typeof nested === 'string') return nested
  }
  return null
}

function buildDerivationContext(messages: PlanMessage[], agentActions: DerivationAgentAction[]): DerivationContext {
  // Phase 2 recommendation: useful for deep-linking, but not proof that a hold
  // is approved. Actual hold state comes from agent_actions below.
  const phase2Rec = [...messages].reverse().find((msg) => {
    if (String(msg.message_type) !== 'recommendation') return false
    const meta = readMeta(msg)
    return meta?.phase === 'vendors'
  })

  const holdActions = [...agentActions]
    .filter((action) => action.action_type === 'hold_request')
    .sort(compareNewestActionFirst)
  const confirmedHold = holdActions.find(isConfirmedVenueHold)
  const pendingHold = holdActions.find((action) => {
    const status = normalizeStatus(action.status)
    return !isConfirmedVenueHold(action) && !TERMINAL_HOLD_STATUSES.has(status)
  })

  // Venue outreach approval message.
  const outreachMsg = [...messages].reverse().find((msg) => {
    if (String(msg.message_type) !== 'approval_request') return false
    const meta = readMeta(msg)
    return meta?.kind === 'venue_outreach'
  })

  let outreachApproved = false
  if (outreachMsg) {
    const meta = readMeta(outreachMsg)
    if (meta) {
      const statusStr = readApprovalStatus(meta)
      outreachApproved = statusStr === 'authorized' || statusStr === 'approved'
    }
  }

  return {
    hasVenueHold: Boolean(confirmedHold),
    hasPendingVenueHold: Boolean(pendingHold),
    awaitingVenueName: pendingHold ? readVenueNameFromAction(pendingHold) : null,
    hasOutreachApproval: Boolean(outreachMsg),
    outreachApproved,
    recMsgId: phase2Rec?.id ?? null,
    outreachMsgId: outreachMsg?.id ?? null,
  }
}

function isConfirmedVenueHold(action: DerivationAgentAction) {
  if (normalizeStatus(action.status) !== 'complete') return false
  const metadata = readRecord(action.result_metadata)
  const outcome = readRecord(metadata?.admin_task_outcome)
  return normalizeStatus(readString(outcome?.outcome)) === 'hold_confirmed'
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-milestone status rules
// ─────────────────────────────────────────────────────────────────────────────

type StatusResult = {
  status: MilestoneStatus
  blocker_reason?: string
  blocker_tab?: 'recommendations' | 'approvals'
  blocker_msg_id?: string
  awaiting_venue_name?: string
}

function awaitingVenueResponse(ctx: DerivationContext, fallback = 'Awaiting venue response'): StatusResult {
  return {
    status: 'awaiting_venue_response',
    blocker_reason: ctx.awaitingVenueName ? `Awaiting ${ctx.awaitingVenueName}` : fallback,
    blocker_tab: 'recommendations',
    blocker_msg_id: ctx.recMsgId ?? undefined,
    awaiting_venue_name: ctx.awaitingVenueName ?? undefined,
  }
}

function deriveStatus(
  milestone: PlanningMilestone,
  ctx: DerivationContext,
  plan: DerivationPlan,
  startOfToday: Date
): StatusResult {
  const title = milestone.title.toLowerCase()
  const category = milestone.category.toLowerCase()
  const dueDate = parseDateOnly(milestone.due_date)
  const isOverdue = dueDate !== null && dueDate.getTime() < startOfToday.getTime()

  // ── Venue confirmation ──────────────────────────────────────────────────────
  if (
    (title.includes('venue') && (title.includes('confirm') || title.includes('book'))) ||
    category === 'venue'
  ) {
    if (ctx.hasVenueHold) return { status: 'in_progress' }
    if (ctx.hasPendingVenueHold) return awaitingVenueResponse(ctx)
    if (isOverdue) {
      return {
        status: 'overdue',
        blocker_reason: 'No venue hold yet — request a hold to proceed',
        blocker_tab: 'recommendations',
        blocker_msg_id: ctx.recMsgId ?? undefined,
      }
    }
    return {
      status: 'blocked',
      blocker_reason: 'Select and request a venue hold to confirm',
      blocker_tab: 'recommendations',
      blocker_msg_id: ctx.recMsgId ?? undefined,
    }
  }

  // ── Venue deposit / payment ─────────────────────────────────────────────────
  if (
    category === 'payment' ||
    (title.includes('deposit') && title.includes('venue')) ||
    (title.includes('pay') && title.includes('venue'))
  ) {
    if (ctx.hasPendingVenueHold && !ctx.hasVenueHold) return awaitingVenueResponse(ctx, 'Awaiting venue response before deposit')
    if (!ctx.hasVenueHold) {
      if (isOverdue) {
        return {
          status: 'overdue',
          blocker_reason: 'Venue not yet held — confirm venue first',
          blocker_tab: 'recommendations',
          blocker_msg_id: ctx.recMsgId ?? undefined,
        }
      }
      return {
        status: 'blocked',
        blocker_reason: 'Venue hold required before deposit',
        blocker_tab: 'recommendations',
        blocker_msg_id: ctx.recMsgId ?? undefined,
      }
    }
    return { status: 'in_progress' }
  }

  // ── Vendor confirmation ─────────────────────────────────────────────────────
  if (
    (title.includes('vendor') && (title.includes('confirm') || title.includes('book'))) ||
    category === 'vendor'
  ) {
    if (ctx.hasPendingVenueHold && !ctx.hasVenueHold) {
      return awaitingVenueResponse(ctx, 'Awaiting venue response before contacting vendors')
    }
    if (!ctx.hasVenueHold) {
      if (isOverdue) {
        return {
          status: 'overdue',
          blocker_reason: 'Confirm a venue first',
          blocker_tab: 'recommendations',
          blocker_msg_id: ctx.recMsgId ?? undefined,
        }
      }
      return {
        status: 'blocked',
        blocker_reason: 'Confirm a venue before contacting vendors',
        blocker_tab: 'recommendations',
        blocker_msg_id: ctx.recMsgId ?? undefined,
      }
    }
    if (!ctx.hasOutreachApproval || !ctx.outreachApproved) {
      if (isOverdue) {
        return {
          status: 'overdue',
          blocker_reason: 'Approve outreach to contact vendors',
          blocker_tab: 'approvals',
          blocker_msg_id: ctx.outreachMsgId ?? undefined,
        }
      }
      return {
        status: 'blocked',
        blocker_reason: 'Approve vendor outreach to proceed',
        blocker_tab: 'approvals',
        blocker_msg_id: ctx.outreachMsgId ?? undefined,
      }
    }
    return { status: 'in_progress' }
  }

  // ── Ticketing / RSVP ────────────────────────────────────────────────────────
  if (title.includes('ticket') || title.includes('rsvp')) {
    if (plan.ticketed && plan.ticketing_model) return { status: 'in_progress' }
    if (isOverdue) return { status: 'overdue' }
    return { status: 'pending' }
  }

  // ── Compliance / venue requirements ────────────────────────────────────────
  if (category === 'compliance') {
    if (ctx.hasPendingVenueHold && !ctx.hasVenueHold) {
      return awaitingVenueResponse(ctx, 'Awaiting venue response to surface its requirements')
    }
    if (!ctx.hasVenueHold) {
      if (isOverdue) {
        return {
          status: 'overdue',
          blocker_reason: 'Hold a venue to surface its requirements',
          blocker_tab: 'recommendations',
          blocker_msg_id: ctx.recMsgId ?? undefined,
        }
      }
      return {
        status: 'blocked',
        blocker_reason: 'Hold a venue to surface its requirements',
        blocker_tab: 'recommendations',
        blocker_msg_id: ctx.recMsgId ?? undefined,
      }
    }
    if (isOverdue) return { status: 'overdue' }
    return { status: 'pending' }
  }

  // ── Day-of milestones ───────────────────────────────────────────────────────
  if (category === 'day-of') {
    if (isOverdue) return { status: 'overdue' }
    return { status: 'pending' }
  }

  // ── Default: only date-based ────────────────────────────────────────────────
  if (isOverdue) return { status: 'overdue' }
  return { status: 'pending' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives per-milestone status from the observable planner message state.
 *
 * @param plan   - Minimal plan fields (ticketed, ticketing_model).
 * @param messages - All plan messages, including recommendations and approvals.
 * @param milestones - Milestones from the timeline agent output.
 * @param today  - Overrideable reference date (defaults to now).
 * @returns Milestones enriched with `status`, optional `blocker_reason`, and
 *          optional deep-link fields (`blocker_tab`, `blocker_msg_id`).
 */
export function deriveMilestoneStatuses(
  plan: DerivationPlan,
  messages: PlanMessage[],
  milestones: PlanningMilestone[],
  agentActions: DerivationAgentAction[] = [],
  today: Date = new Date()
): DerivedMilestone[] {
  const startOfToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const ctx = buildDerivationContext(messages, agentActions)
  return milestones.map((milestone) => {
    const { status, ...extras } = deriveStatus(milestone, ctx, plan, startOfToday)
    return { ...milestone, status, ...extras }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseDateOnly(value: string): Date | null {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function normalizeStatus(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function compareNewestActionFirst(a: DerivationAgentAction, b: DerivationAgentAction): number {
  const aTime = Date.parse(a.created_at ?? '')
  const bTime = Date.parse(b.created_at ?? '')
  return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0)
}

function readVenueNameFromAction(action: DerivationAgentAction): string | null {
  const payload = readRecord(action.payload_json)
  const result = readRecord(action.result_metadata)
  return (
    readString(payload?.venue_name) ??
    readString(payload?.venueName) ??
    readString(payload?.provider) ??
    readString(payload?.target_name) ??
    readString(readRecord(payload?.venue)?.name) ??
    readString(result?.venue_name) ??
    readString(result?.venueName) ??
    null
  )
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
