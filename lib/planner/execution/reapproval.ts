import { createHash } from 'node:crypto'
import type { AgentAction, Approval, Json, Plan } from '@/lib/types'

export const APPROVAL_SNAPSHOT_SCHEMA_VERSION = 2 as const

export interface ApprovalSnapshotInput {
  plan: Pick<
    Plan,
    | 'event_type'
    | 'guest_count'
    | 'budget_cap_cents'
    | 'neighborhood'
    | 'date_window_start'
    | 'date_window_end'
    | 'ticketed'
    | 'ticketing_model'
    | 'food_responsibility'
    | 'profit_goal_cents'
  >
  approval?: Partial<Pick<
    Approval,
    | 'event_date'
    | 'price_cents'
    | 'fees_cents'
    | 'requested_amount_cents'
    | 'action_label'
    | 'provider'
    | 'delivery_email'
    | 'refund_terms'
    | 'cancellation_terms'
    | 'package_details'
    | 'expires_at'
    | 'notes'
  >> | null
  action?: Partial<Pick<
    AgentAction,
    'action_type' | 'target_type' | 'target_id' | 'amount_cents' | 'payload_json'
  >> | null
  payload?: Record<string, unknown> | null
}

export interface ReapprovalCheckInput extends ApprovalSnapshotInput {
  storedSnapshotHash: string | null | undefined
  storedSnapshotVersion?: number | null
}

export interface ApprovalSnapshotV2 {
  schema_version: typeof APPROVAL_SNAPSHOT_SCHEMA_VERSION
  plan: ReturnType<typeof buildPlanSnapshot>
  approval: {
    action_label: string | null
    event_date: string | null
    requested_amount_cents: number | null
    price_cents: number | null
    fees_cents: number | null
    notes: string | null
    provider: string | null
    delivery_email: string | null
    refund_terms: string | null
    cancellation_terms: string | null
    package_details: string | null
    expires_at: string | null
  }
  counterparty: {
    provider: string | null
    target_type: string | null
    target_id: string | null
    display_name: string | null
    delivery_email: string | null
    venue_ids: string[]
    vendor_ids: string[]
  }
  action: {
    action_type: string | null
    target_type: string | null
    target_id: string | null
    amount_cents: number | null
    payload_json: Json | null
  }
}

export function buildApprovalSnapshotHash(input: ApprovalSnapshotInput): string {
  return hashStableJson(buildApprovalSnapshotV1(input))
}

/** Builds the full immutable snapshot displayed by the explicit authorization step. */
export function buildApprovalSnapshotV2(input: ApprovalSnapshotInput): ApprovalSnapshotV2 {
  const payload = input.payload ?? readRecord(input.action?.payload_json)
  const actionPayload = (input.action?.payload_json ?? input.payload ?? null) as Json | null
  const targetType = input.action?.target_type ?? readString(payload?.target_type)
  const targetId = input.action?.target_id ?? readString(payload?.target_id)
  const provider = input.approval?.provider ?? readString(payload?.provider)
  const deliveryEmail = input.approval?.delivery_email ?? readString(payload?.delivery_email)

  return {
    schema_version: APPROVAL_SNAPSHOT_SCHEMA_VERSION,
    plan: buildPlanSnapshot(input.plan),
    approval: {
      action_label: input.approval?.action_label ?? readString(payload?.action_label),
      event_date: input.approval?.event_date ?? readString(payload?.event_date),
      requested_amount_cents:
        input.approval?.requested_amount_cents ?? readNumber(payload?.requestedAmountCents),
      price_cents: input.approval?.price_cents ?? readNumber(payload?.price_cents),
      fees_cents: input.approval?.fees_cents ?? readNumber(payload?.fees_cents),
      notes: input.approval?.notes ?? readString(payload?.notes),
      provider,
      delivery_email: deliveryEmail,
      refund_terms: input.approval?.refund_terms ?? readString(payload?.refund_terms),
      cancellation_terms:
        input.approval?.cancellation_terms ?? readString(payload?.cancellation_terms),
      package_details: input.approval?.package_details ?? readString(payload?.package_details),
      expires_at: input.approval?.expires_at ?? readString(payload?.expires_at),
    },
    counterparty: {
      provider,
      target_type: targetType,
      target_id: targetId,
      display_name: readFirstString(payload, [
        'target_name',
        'venue_name',
        'vendor_name',
        'counterparty_name',
      ]) ?? provider,
      delivery_email: deliveryEmail,
      venue_ids: readStringArray(payload?.venue_ids),
      vendor_ids: readStringArray(payload?.vendor_ids),
    },
    action: {
      action_type: input.action?.action_type ?? null,
      target_type: targetType,
      target_id: targetId,
      amount_cents: input.action?.amount_cents ?? readNumber(payload?.amount_cents),
      payload_json: actionPayload,
    },
  }
}

export function buildApprovalSnapshotHashV2(input: ApprovalSnapshotInput): string {
  return hashStableJson(buildApprovalSnapshotV2(input))
}

export function buildLegacyPlanApprovalSnapshotHash(input: Pick<ApprovalSnapshotInput, 'plan'>): string {
  return hashStableJson(buildPlanSnapshot(input.plan))
}

export function approvalRequiresReapproval(input: ReapprovalCheckInput): boolean {
  if (!input.storedSnapshotHash?.trim()) return true

  if (input.storedSnapshotVersion === APPROVAL_SNAPSHOT_SCHEMA_VERSION) {
    return input.storedSnapshotHash !== buildApprovalSnapshotHashV2(input)
  }

  const nextSnapshotHash = buildApprovalSnapshotHash(input)
  if (input.storedSnapshotHash === nextSnapshotHash) return false

  // Phase 0 and earlier approvals used a plan-only hash. Keep those approvals
  // usable while new approvals receive the fuller execution-sensitive hash.
  return input.storedSnapshotHash !== buildLegacyPlanApprovalSnapshotHash({ plan: input.plan })
}

function buildApprovalSnapshotV1(input: ApprovalSnapshotInput) {
  const payload = input.payload ?? readRecord(input.action?.payload_json)
  const venueIds = readStringArray(payload?.venue_ids)
  const vendorIds = readStringArray(payload?.vendor_ids)

  // Re-approval invariant: a prior approval cannot authorize changed price,
  // date/seats, vendor/venue targets, or partner terms.
  return {
    plan: buildPlanSnapshot(input.plan),
    approval: {
      event_date: input.approval?.event_date ?? readString(payload?.event_date),
      price_cents: input.approval?.price_cents ?? readNumber(payload?.price_cents),
      fees_cents: input.approval?.fees_cents ?? readNumber(payload?.fees_cents),
      requested_amount_cents:
        input.approval?.requested_amount_cents ?? readNumber(payload?.requestedAmountCents),
      provider: input.approval?.provider ?? readString(payload?.provider),
      refund_terms: input.approval?.refund_terms ?? readString(payload?.refund_terms),
      cancellation_terms: input.approval?.cancellation_terms ?? readString(payload?.cancellation_terms),
      package_details: input.approval?.package_details ?? readString(payload?.package_details),
    },
    action: {
      action_type: input.action?.action_type ?? null,
      target_type: input.action?.target_type ?? readString(payload?.target_type),
      target_id: input.action?.target_id ?? readString(payload?.target_id),
      amount_cents: input.action?.amount_cents ?? readNumber(payload?.amount_cents),
      venue_ids: venueIds,
      vendor_ids: vendorIds,
      seats: readNumber(payload?.seats) ?? readNumber(payload?.guest_count),
      terms: readTermsSignature(payload),
    },
  }
}

function buildPlanSnapshot(plan: ApprovalSnapshotInput['plan']) {
  return {
    event_type: plan.event_type,
    guest_count: plan.guest_count,
    budget_cap_cents: plan.budget_cap_cents,
    neighborhood: plan.neighborhood,
    date_window_start: plan.date_window_start,
    date_window_end: plan.date_window_end,
    ticketed: plan.ticketed,
    ticketing_model: plan.ticketing_model,
    food_responsibility: plan.food_responsibility,
    profit_goal_cents: plan.profit_goal_cents,
  }
}

function readTermsSignature(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  const terms = readRecord(payload?.terms)
  if (terms) return terms

  const requestedTerms = readRecord(payload?.requested_terms)
  if (requestedTerms) return requestedTerms

  const requirements = readRecord(payload?.requirements)
  const requirementTerms = readRecord(requirements?.requested_terms)
  return requirementTerms ?? null
}

function hashStableJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortStable(value))).digest('hex')
}

function sortStable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortStable)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortStable(item)])
  )
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readFirstString(record: Record<string, unknown> | null, keys: string[]): string | null {
  for (const key of keys) {
    const value = readString(record?.[key])
    if (value) return value
  }
  return null
}
