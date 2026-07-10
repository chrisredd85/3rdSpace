import { randomUUID } from 'node:crypto'
import type { AgentAction, Approval, Json, Plan } from '@/lib/types'
import {
  APPROVAL_SNAPSHOT_SCHEMA_VERSION,
  buildApprovalSnapshotHashV2,
  buildApprovalSnapshotV2,
} from './reapproval'

type PlannerDb = {
  from: (table: string) => any
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown
    error: { code?: string; message?: string; details?: string; hint?: string } | null
  }>
}

export type CanonicalQuoteKind = 'venue' | 'vendor'

type TrustedQuote = {
  kind: CanonicalQuoteKind
  responseId: string
  discoveryId: string
  partnerName: string
  serviceType: string | null
  amountCents: number
  dealModel: string | null
  terms: Record<string, unknown>
}

export type CanonicalQuoteBookingExecutionResult = {
  disposition: 'executing' | 'waiting'
  metadata: Record<string, unknown>
}

export type StagedCanonicalQuoteBooking = {
  existing: boolean
  plan: Plan
  agent_action: AgentAction
  approval: Approval
  approval_message: Record<string, unknown>
}

export type CancelledCanonicalQuoteBooking = {
  existing: boolean
  plan: Plan
  agent_action: AgentAction
  approval: Approval
}

const ACTION_SELECT = `
  id, plan_id, action_type, description, provider, target_type, target_id,
  payload_json, amount_cents, currency, status, approval_id, executed_at,
  result_metadata, created_at, updated_at
`

const APPROVAL_SELECT = `
  id, plan_id, agent_action_id, action_label, provider, event_date,
  price_cents, fees_cents, refund_terms, cancellation_terms,
  package_details, delivery_email, payment_method_id, status,
  requested_amount_cents, authorized_amount_cents, authorized_by,
  authorized_at, approved_by, approved_at, expires_at, snapshot_hash,
  notes, snapshot_json, snapshot_schema_version, created_at, updated_at
`

/** True only for the payload-tagged booking action staged from a trusted reply. */
export function isCanonicalQuoteBookingAction(
  action: Pick<AgentAction, 'action_type' | 'payload_json'>
) {
  const payload = readRecord(action.payload_json)
  return action.action_type === 'concierge_queue' &&
    readString(payload?.kind) === 'canonical_quote_booking'
}

/**
 * Loads one plan-owned outreach response and constructs the immutable action and
 * approval snapshot before the single staging RPC writes anything.
 */
export async function stageCanonicalQuoteBooking(input: {
  db: PlannerDb
  plan: Plan
  actorId: string
  quoteKind: CanonicalQuoteKind
  responseId: string
}): Promise<StagedCanonicalQuoteBooking> {
  if (!input.db.rpc) throw new Error('canonical_quote_booking_rpc_unavailable')
  if (input.plan.user_id !== input.actorId) throw new Error('canonical_quote_booking_actor_mismatch')
  const acceptsBeforeMaterialization = !input.plan.materialized_event_id &&
    ['drafting', 'ready'].includes(input.plan.status)
  const acceptsAfterMaterialization = Boolean(input.plan.materialized_event_id) &&
    input.plan.status === 'executing'
  if (!acceptsBeforeMaterialization && !acceptsAfterMaterialization) {
    throw new Error('canonical_quote_booking_plan_requires_reapproval')
  }
  const eventDate = await resolveCanonicalBookingDate(input.db, input.plan)

  const quote = await loadTrustedQuote(input.db, input.quoteKind, input.responseId, input.plan.id)
  if (!quote) throw new Error('canonical_quote_booking_response_not_found')

  const actionId = randomUUID()
  const approvalId = randomUUID()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const bookingSlot = quote.kind === 'venue' ? 'venue' : `vendor:${quote.serviceType ?? 'other'}`
  const targetType = quote.kind === 'venue' ? 'discovery_venue' : 'discovery_vendor'
  const actionPayload = {
    kind: 'canonical_quote_booking',
    quote_kind: quote.kind,
    quote_response_id: quote.responseId,
    booking_slot: bookingSlot,
    target_type: targetType,
    target_id: quote.discoveryId,
    target_name: quote.partnerName,
    requested_amount_cents: quote.amountCents,
    price_cents: quote.amountCents,
    event_date: eventDate,
    service_type: quote.serviceType,
    quoted_deal_model: quote.dealModel,
    quote_terms: quote.terms,
    requested_terms: quote.terms,
    route_to_admin_queue: true,
    execution_mode: 'concierge_admin_queue',
    requires_event_materialization: true,
    outbound_message_sent: false,
  }
  const actionForSnapshot = {
    action_type: 'concierge_queue' as const,
    target_type: targetType,
    target_id: quote.discoveryId,
    amount_cents: quote.amountCents,
    payload_json: actionPayload as unknown as Json,
  }
  const approvalForSnapshot = {
    action_label: `Approve booking request with ${quote.partnerName}`,
    provider: quote.partnerName,
    event_date: eventDate,
    price_cents: quote.amountCents,
    fees_cents: 0,
    requested_amount_cents: quote.amountCents,
    package_details: quote.kind === 'venue'
      ? quote.dealModel ?? 'Venue quote'
      : quote.serviceType ?? 'Vendor service',
    expires_at: expiresAt,
    notes: readString(quote.terms.raw_response_excerpt),
  }
  const snapshotInput = {
    plan: input.plan,
    approval: approvalForSnapshot,
    action: actionForSnapshot,
    payload: actionPayload,
  }
  const snapshotJson = buildApprovalSnapshotV2(snapshotInput)
  const snapshotHash = buildApprovalSnapshotHashV2(snapshotInput)

  const { data, error } = await input.db.rpc('stage_plan_quote_booking', {
    p_plan_id: input.plan.id,
    p_actor_id: input.actorId,
    p_quote_kind: quote.kind,
    p_response_id: quote.responseId,
    p_action_id: actionId,
    p_approval_id: approvalId,
    p_expires_at: expiresAt,
    p_action_payload: actionPayload,
    p_snapshot_json: snapshotJson,
    p_snapshot_hash: snapshotHash,
  })
  if (error) throw new Error(readDatabaseError(error))

  const result = readRecord(data)
  const plan = readRecord(result?.plan)
  const action = readRecord(result?.agent_action)
  const approval = readRecord(result?.approval)
  const message = readRecord(result?.approval_message)
  if (!plan || !action || !approval || !message) {
    throw new Error('canonical_quote_booking_stage_returned_incomplete_aggregate')
  }

  return {
    existing: result?.existing === true,
    plan: plan as unknown as Plan,
    agent_action: action as unknown as AgentAction,
    approval: approval as unknown as Approval,
    approval_message: message,
  }
}

/** Atomically cancels a pending quote acceptance and its hidden approval. */
export async function cancelStagedCanonicalQuoteBooking(input: {
  db: PlannerDb
  planId: string
  actorId: string
  quoteKind: CanonicalQuoteKind
  responseId: string
}): Promise<CancelledCanonicalQuoteBooking> {
  if (!input.db.rpc) throw new Error('canonical_quote_booking_rpc_unavailable')

  const { data, error } = await input.db.rpc('cancel_staged_plan_quote_booking', {
    p_plan_id: input.planId,
    p_actor_id: input.actorId,
    p_quote_kind: input.quoteKind,
    p_response_id: input.responseId,
  })
  if (error) throw new Error(readDatabaseError(error))

  const result = readRecord(data)
  const plan = readRecord(result?.plan)
  const action = readRecord(result?.agent_action)
  const approval = readRecord(result?.approval)
  if (!plan || !action || !approval) {
    throw new Error('canonical_quote_booking_cancel_returned_incomplete_aggregate')
  }

  return {
    existing: result?.existing === true,
    plan: plan as unknown as Plan,
    agent_action: action as unknown as AgentAction,
    approval: approval as unknown as Approval,
  }
}

/**
 * Uses the same compare-and-swap context as the approval trigger. It is an exact
 * retry when the trigger already advanced ready -> approved and a safe seam for
 * orchestration tests where the trigger result has not yet been reloaded.
 */
export async function ensureCanonicalQuoteBookingPlanApproved(input: {
  db: PlannerDb
  plan: Plan
  action: AgentAction
  approval: Approval
  actorId: string
}): Promise<Plan> {
  if (!isCanonicalQuoteBookingAction(input.action)) return input.plan
  if (input.plan.status !== 'ready') return input.plan
  if (!input.db.rpc) throw new Error('canonical_quote_booking_transition_rpc_unavailable')
  if (!['approved', 'authorized'].includes(input.approval.status)) {
    throw new Error('canonical_quote_booking_approval_not_executable')
  }

  const { data, error } = await input.db.rpc('transition_plan_status', {
    p_plan_id: input.plan.id,
    p_expected_status: 'ready',
    p_to_status: 'approved',
    p_trigger: 'approval_authorized',
    p_actor_id: input.actorId,
    p_context: {
      approval_id: input.approval.id,
      agent_action_id: input.action.id,
      snapshot_hash: input.approval.snapshot_hash,
    },
  })
  if (error) throw new Error(readDatabaseError(error))
  const row = Array.isArray(data) ? data[0] : data
  return (readRecord(row) as unknown as Plan | null) ?? input.plan
}

/**
 * Shared-dispatch handler. The caller owns approved -> executing; this handler
 * either waits for exact event identity or creates/reuses the pending booking.
 */
export async function executeCanonicalQuoteBooking(input: {
  db: PlannerDb
  action: AgentAction
  approval: Approval
  plan: Plan
  actorId: string
}): Promise<CanonicalQuoteBookingExecutionResult> {
  if (!isCanonicalQuoteBookingAction(input.action)) {
    return {
      disposition: 'waiting',
      metadata: { canonical_booking_status: 'not_canonical_quote_booking' },
    }
  }
  if (!input.db.rpc) throw new Error('canonical_quote_booking_rpc_unavailable')

  const currentPlan = await ensureCanonicalQuoteBookingPlanApproved(input)
  if (!currentPlan.materialized_event_id) {
    return {
      disposition: 'waiting',
      metadata: {
        canonical_booking_status: 'waiting_for_event_materialization',
        requires_event_materialization: true,
        approval_id: input.approval.id,
        outbound_message_sent: false,
      },
    }
  }

  const { data, error } = await input.db.rpc('create_canonical_booking_from_approval', {
    p_plan_id: currentPlan.id,
    p_agent_action_id: input.action.id,
    p_approval_id: input.approval.id,
    p_actor_id: input.actorId,
  })
  if (error) throw new Error(readDatabaseError(error))
  const result = readRecord(data)
  if (!result) throw new Error('canonical_quote_booking_execution_returned_no_result')

  const disposition = result.disposition === 'executing' ? 'executing' : 'waiting'
  return {
    disposition,
    metadata: {
      ...result,
      canonical_booking_status: result.booking_status === 'confirmed'
        ? 'confirmed'
        : result.requires_concierge === true
        ? 'requires_concierge'
        : disposition === 'executing'
          ? 'pending_partner_confirmation'
          : readString(result.reason) ?? 'waiting',
      outbound_message_sent: false,
    },
  }
}

/**
 * Cancels only the operational action/pending booking after authorization.
 * The immutable executable approval remains as historical evidence.
 */
export async function cancelExecutingCanonicalQuoteBooking(input: {
  db: PlannerDb
  action: AgentAction
  approval: Approval
  plan: Plan
  actorId: string
  reason: string
}): Promise<CanonicalQuoteBookingExecutionResult> {
  if (!isCanonicalQuoteBookingAction(input.action)) {
    throw new Error('canonical_quote_booking_cancel_action_mismatch')
  }
  if (!input.db.rpc) throw new Error('canonical_quote_booking_rpc_unavailable')
  if (!input.reason.trim()) throw new Error('canonical_quote_booking_cancel_reason_required')

  const { data, error } = await input.db.rpc('cancel_executing_canonical_quote_booking', {
    p_plan_id: input.plan.id,
    p_agent_action_id: input.action.id,
    p_approval_id: input.approval.id,
    p_actor_id: input.actorId,
    p_reason: input.reason.trim(),
  })
  if (error) throw new Error(readDatabaseError(error))
  const result = readRecord(data)
  if (!result) throw new Error('canonical_quote_booking_cancel_returned_no_result')

  return {
    disposition: 'waiting',
    metadata: {
      ...result,
      canonical_booking_status: 'cancelled',
      approval_status_preserved: input.approval.status,
      outbound_message_sent: false,
    },
  }
}

/**
 * Called after materialization to resume only payload-tagged quote bookings.
 * It does not dispatch generic action types and is safe on exact route retries.
 */
export async function resumeCanonicalQuoteBookingsAfterMaterialization(input: {
  db: PlannerDb
  planId: string
  actorId: string
}): Promise<CanonicalQuoteBookingExecutionResult[]> {
  const { data: planData, error: planError } = await input.db
    .from('plans')
    .select('*')
    .eq('id', input.planId)
    .eq('user_id', input.actorId)
    .maybeSingle()
  if (planError || !planData) throw new Error(planError?.message ?? 'canonical_quote_booking_plan_not_found')

  const { data: actionsData, error: actionsError } = await input.db
    .from('agent_actions')
    .select(ACTION_SELECT)
    .eq('plan_id', input.planId)
    .contains('payload_json', { kind: 'canonical_quote_booking' })
    .in('status', ['approved', 'executing'])
    .order('created_at', { ascending: true })
  if (actionsError) throw new Error(actionsError.message)

  const actions = (Array.isArray(actionsData) ? actionsData : []) as AgentAction[]
  if (actions.length === 0) return []
  const actionIds = actions.map((action) => action.id)
  const { data: approvalsData, error: approvalsError } = await input.db
    .from('approvals')
    .select(APPROVAL_SELECT)
    .in('agent_action_id', actionIds)
    .in('status', ['approved', 'authorized'])
  if (approvalsError) throw new Error(approvalsError.message)

  const approvalsByAction = new Map(
    ((Array.isArray(approvalsData) ? approvalsData : []) as Approval[])
      .map((approval) => [approval.agent_action_id, approval])
  )
  const results: CanonicalQuoteBookingExecutionResult[] = []
  for (const originalAction of actions) {
    const approval = approvalsByAction.get(originalAction.id)
    if (!approval) continue
    let action = originalAction

    if (action.status === 'approved') {
      const nextMetadata = {
        ...(readRecord(action.result_metadata) ?? {}),
        canonical_booking_status: 'resuming_after_event_materialization',
      }
      const { data: updated, error } = await input.db
        .from('agent_actions')
        .update({ status: 'executing', result_metadata: nextMetadata })
        .eq('id', action.id)
        .eq('plan_id', input.planId)
        .eq('status', 'approved')
        .select(ACTION_SELECT)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (updated) {
        const { error: auditError } = await input.db.from('agent_action_audit_log').insert({
          action_id: action.id,
          plan_id: input.planId,
          from_status: 'approved',
          to_status: 'executing',
          actor_id: input.actorId,
          actor_role: 'user',
          reason: 'canonical_quote_booking.materialization_resume',
          metadata: nextMetadata,
        })
        if (auditError) throw new Error(auditError.message)
        action = updated as AgentAction
      }
    }

    const result = await executeCanonicalQuoteBooking({
      db: input.db,
      action,
      approval,
      plan: planData as Plan,
      actorId: input.actorId,
    })
    const mergedMetadata = {
      ...(readRecord(action.result_metadata) ?? {}),
      ...result.metadata,
      agent_action_id: action.id,
    }
    const { error: metadataError } = await input.db
      .from('agent_actions')
      .update({ result_metadata: mergedMetadata })
      .eq('id', action.id)
      .eq('plan_id', input.planId)
    if (metadataError) throw new Error(metadataError.message)
    results.push(result)
  }

  return results
}

async function resolveCanonicalBookingDate(db: PlannerDb, plan: Plan): Promise<string> {
  if (!plan.materialized_event_id) {
    if (
      !plan.date_window_start ||
      !plan.date_window_end ||
      plan.date_window_start !== plan.date_window_end
    ) {
      throw new Error('canonical_quote_booking_exact_date_required')
    }
    return plan.date_window_start
  }

  const { data, error } = await db
    .from('events')
    .select('id, plan_id, event_date')
    .eq('id', plan.materialized_event_id)
    .eq('plan_id', plan.id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const event = readRecord(data)
  const eventDate = readString(event?.event_date)
  if (!eventDate) throw new Error('canonical_quote_booking_reciprocal_event_missing')
  return eventDate
}

async function loadTrustedQuote(
  db: PlannerDb,
  kind: CanonicalQuoteKind,
  responseId: string,
  planId: string
): Promise<TrustedQuote | null> {
  if (kind === 'venue') {
    const { data, error } = await db
      .from('venue_outreach_responses')
      .select(`
        id, plan_id, discovery_venue_id, classification,
        classification_confidence, quoted_price_cents, quoted_deal_model,
        availability_confirmed, capacity_confirmed, conditions,
        raw_response_excerpt, extracted_at,
        discovery_venues!inner(id, name, claimed_venue_id)
      `)
      .eq('id', responseId)
      .eq('plan_id', planId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const row = readRecord(data)
    if (!row) return null
    const venue = readRelationRecord(row.discovery_venues)
    const discoveryId = readString(row.discovery_venue_id)
    if (!discoveryId) return null
    return {
      kind,
      responseId,
      discoveryId,
      partnerName: readString(venue?.name) ?? 'Venue',
      serviceType: null,
      amountCents: readNonnegativeInteger(row.quoted_price_cents),
      dealModel: readString(row.quoted_deal_model),
      terms: buildQuoteTerms(row, {
        quoted_price_cents: readNullableInteger(row.quoted_price_cents),
        quoted_deal_model: readString(row.quoted_deal_model),
        capacity_confirmed: readNullableInteger(row.capacity_confirmed),
      }),
    }
  }

  const { data, error } = await db
    .from('vendor_outreach_responses')
    .select(`
      id, plan_id, discovery_vendor_id, classification,
      classification_confidence, quoted_hourly_cents, quoted_package_cents,
      quoted_minimum_cents, quoted_deposit_pct, availability_confirmed,
      conditions, raw_response_excerpt, extracted_at,
      discovery_vendors!inner(id, name, service_type)
    `)
    .eq('id', responseId)
    .eq('plan_id', planId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const row = readRecord(data)
  if (!row) return null
  const vendor = readRelationRecord(row.discovery_vendors)
  const discoveryId = readString(row.discovery_vendor_id)
  if (!discoveryId) return null
  const amountCents = readNullableInteger(row.quoted_package_cents) ??
    readNullableInteger(row.quoted_minimum_cents) ??
    readNullableInteger(row.quoted_hourly_cents) ?? 0
  return {
    kind,
    responseId,
    discoveryId,
    partnerName: readString(vendor?.name) ?? 'Vendor',
    serviceType: readString(vendor?.service_type),
    amountCents,
    dealModel: null,
    terms: buildQuoteTerms(row, {
      quoted_hourly_cents: readNullableInteger(row.quoted_hourly_cents),
      quoted_package_cents: readNullableInteger(row.quoted_package_cents),
      quoted_minimum_cents: readNullableInteger(row.quoted_minimum_cents),
      quoted_deposit_pct: readNumber(row.quoted_deposit_pct),
    }),
  }
}

function buildQuoteTerms(row: Record<string, unknown>, quote: Record<string, unknown>) {
  return {
    source: 'trusted_outreach_response',
    response_id: readString(row.id),
    classification: readString(row.classification),
    classification_confidence: readNumber(row.classification_confidence),
    availability_confirmed: typeof row.availability_confirmed === 'boolean'
      ? row.availability_confirmed
      : null,
    conditions: Array.isArray(row.conditions) ? row.conditions : [],
    raw_response_excerpt: readString(row.raw_response_excerpt),
    extracted_at: readString(row.extracted_at),
    ...quote,
  }
}

function readDatabaseError(error: { code?: string; message?: string; details?: string; hint?: string }) {
  return [error.message, error.details, error.hint, error.code].filter(Boolean).join(' ')
}

function readRelationRecord(value: unknown) {
  if (Array.isArray(value)) return readRecord(value[0])
  return readRecord(value)
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readNullableInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function readNonnegativeInteger(value: unknown): number {
  return readNullableInteger(value) ?? 0
}

export const CANONICAL_QUOTE_BOOKING_SNAPSHOT_VERSION = APPROVAL_SNAPSHOT_SCHEMA_VERSION
