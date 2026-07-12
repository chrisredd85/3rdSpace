import { randomUUID } from 'node:crypto'
import type { AgentAction, Approval, Json, Plan } from '@/lib/types'
import {
  executeGenericConciergeHandoff,
  type ConciergeExecutionDb,
} from '@/lib/server/concierge-execution'
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
  amountCents: number | null
  dealModel: string | null
  terms: Record<string, unknown>
}

export type CanonicalQuoteBookingExecutionResult = {
  disposition: 'executing' | 'complete' | 'waiting'
  metadata: Record<string, unknown>
}

type CanonicalQuoteBookingReapprovalReason = 'approval_expired' | 'approval_stale'

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
    ['executing', 'booked'].includes(input.plan.status)
  if (!acceptsBeforeMaterialization && !acceptsAfterMaterialization) {
    throw new Error('canonical_quote_booking_plan_requires_reapproval')
  }
  const eventDate = await resolveCanonicalBookingDate(input.db, input.plan)

  const quote = await loadTrustedQuote(input.db, input.quoteKind, input.responseId, input.plan.id)
  if (!quote) throw new Error('canonical_quote_booking_response_not_found')
  if (quote.amountCents === null && !isExplicitZeroUpfrontQuote(quote)) {
    throw new Error('canonical_quote_booking_price_required')
  }
  const amountCents = quote.amountCents ?? 0

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
    requested_amount_cents: amountCents,
    price_cents: amountCents,
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
    amount_cents: amountCents,
    payload_json: actionPayload as unknown as Json,
  }
  const approvalForSnapshot = {
    action_label: `Approve booking request with ${quote.partnerName}`,
    provider: quote.partnerName,
    event_date: eventDate,
    price_cents: amountCents,
    fees_cents: 0,
    requested_amount_cents: amountCents,
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

  const reapprovalReason = canonicalQuoteBookingReapprovalReason(input.action, input.approval)
  if (reapprovalReason) {
    return canonicalQuoteBookingReapprovalResult(input.action, input.approval, reapprovalReason)
  }

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
  if (error) {
    const databaseError = readDatabaseError(error)
    const databaseReapprovalReason = canonicalQuoteBookingDatabaseReapprovalReason(databaseError)
    if (databaseReapprovalReason) {
      return canonicalQuoteBookingReapprovalResult(
        input.action,
        input.approval,
        databaseReapprovalReason,
      )
    }
    throw new Error(databaseError)
  }
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
  if (error) {
    if (error.code === '40P01') {
      throw new Error('canonical_quote_booking_cancel_retryable_conflict 40P01')
    }
    throw new Error(readDatabaseError(error))
  }
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
    .in('status', ['approved', 'executing', 'failed'])
    .order('created_at', { ascending: true })
  if (actionsError) throw new Error(actionsError.message)

  const actions = (Array.isArray(actionsData) ? actionsData : []) as AgentAction[]
  if (actions.length === 0) return []
  const planStatus = readString(readRecord(planData)?.status) ?? 'unknown'
  if (!isCanonicalQuoteBookingResumePlanStatus(planStatus)) {
    return loadCanonicalQuoteBookingBlockedPlanResults(
      input.db,
      actions,
      input.planId,
      planStatus,
    )
  }
  const approvalIds = [...new Set(
    actions
      .map((action) => readString(action.approval_id))
      .filter((approvalId): approvalId is string => Boolean(approvalId))
  )]
  let approvalsData: unknown[] = []
  if (approvalIds.length > 0) {
    const { data, error } = await input.db
      .from('approvals')
      .select(APPROVAL_SELECT)
      .in('id', approvalIds)
      .in('status', ['approved', 'authorized', 'expired', 're_approval_required'])
    if (error) throw new Error(error.message)
    approvalsData = Array.isArray(data) ? data : []
  }

  const approvalsById = new Map(
    (approvalsData as Approval[])
      .map((approval) => [approval.id, approval])
  )
  const results: CanonicalQuoteBookingExecutionResult[] = []
  for (const originalAction of actions) {
    let action = await loadCanonicalQuoteBookingAction(input.db, originalAction.id, input.planId)
    if (!action) continue
    if (isTerminalAgentActionStatus(action.status)) {
      results.push(canonicalQuoteBookingTerminalActionResult(action))
      continue
    }
    if (action.status !== 'approved' && action.status !== 'executing') continue

    const currentApprovalId = readString(action.approval_id)
    const approval = currentApprovalId ? approvalsById.get(currentApprovalId) : null
    if (
      !approval ||
      approval.agent_action_id !== action.id ||
      approval.plan_id !== input.planId
    ) continue

    const existingExecution = canonicalQuoteBookingExistingExecutionResult(action)
    if (existingExecution) {
      results.push(existingExecution)
      continue
    }

    const reapprovalReason = canonicalQuoteBookingReapprovalReason(action, approval)
    if (reapprovalReason) {
      const persistedApproval = await markCanonicalQuoteBookingReapprovalRequired(
        input.db,
        action,
        approval,
        reapprovalReason,
        input.actorId,
      )
      results.push(canonicalQuoteBookingReapprovalResult(action, persistedApproval, reapprovalReason))
      continue
    }

    // Claim execution before the RPC can create a partner-visible booking. A
    // failed CAS reloads current truth, so concurrent complete/cancel evidence
    // wins and no stale resume call can start or overwrite terminal work.
    if (action.status === 'approved') {
      try {
        action = await claimCanonicalQuoteBookingMaterializationResume(
          input.db,
          action,
          approval,
          input.actorId,
        )
      } catch (claimError) {
        const blocked = await loadCanonicalQuoteBookingPlanRaceResult(
          input.db,
          action.id,
          input.planId,
          input.actorId,
        )
        if (blocked) {
          results.push(blocked)
          continue
        }
        throw claimError
      }
    }

    if (isTerminalAgentActionStatus(action.status)) {
      results.push(canonicalQuoteBookingTerminalActionResult(action))
      continue
    }
    if (action.status !== 'executing') {
      throw new Error('canonical_quote_booking_resume_status_conflict')
    }

    let result: CanonicalQuoteBookingExecutionResult
    try {
      result = await executeCanonicalQuoteBooking({
        db: input.db,
        action,
        approval,
        plan: planData as Plan,
        actorId: input.actorId,
      })
    } catch (executionError) {
      const reloaded = await loadCanonicalQuoteBookingAction(input.db, action.id, input.planId)
      if (reloaded && isTerminalAgentActionStatus(reloaded.status)) {
        results.push(canonicalQuoteBookingTerminalActionResult(reloaded))
        continue
      }
      const blocked = await loadCanonicalQuoteBookingPlanRaceResult(
        input.db,
        action.id,
        input.planId,
        input.actorId,
      )
      if (blocked) {
        results.push(blocked)
        continue
      }
      throw executionError
    }

    if (result.metadata.reapproval_required === true) {
      const persistedApproval = await markCanonicalQuoteBookingReapprovalRequired(
        input.db,
        action,
        approval,
        readString(result.metadata.reapproval_reason) === 'approval_stale'
          ? 'approval_stale'
          : 'approval_expired',
        input.actorId,
      )
      results.push({
        ...result,
        metadata: { ...result.metadata, approval_id: persistedApproval.id },
      })
      continue
    }

    if (result.metadata.requires_concierge === true) {
      const queued = await executeGenericConciergeHandoff({
        db: input.db as ConciergeExecutionDb,
        action,
        approval,
        plan: planData as Plan,
        actorId: input.actorId,
      }, {
        description: `Claim or coordinate the approved ${String(result.metadata.quote_kind ?? 'partner')} quote before creating its canonical booking.`,
        hostMessage: '3rdPlace queued the approved quote for operator follow-up because the partner is not claimed. Nothing has been booked or paid.',
        metadata: result.metadata,
      })
      if (!queued.handled) throw new Error(queued.reason)
      result = {
        disposition: queued.disposition,
        metadata: { ...result.metadata, ...queued.metadata },
      }
    }

    const mergedMetadata = {
      ...(readRecord(action.result_metadata) ?? {}),
      ...result.metadata,
      agent_action_id: action.id,
    }
    const { data: metadataUpdated, error: metadataError } = await input.db
      .from('agent_actions')
      .update({ result_metadata: mergedMetadata })
      .eq('id', action.id)
      .eq('plan_id', input.planId)
      .eq('status', 'executing')
      .select(ACTION_SELECT)
      .maybeSingle()
    if (metadataError) throw new Error(metadataError.message)
    if (!metadataUpdated) {
      const reloaded = await loadCanonicalQuoteBookingAction(input.db, action.id, input.planId)
      if (reloaded && isTerminalAgentActionStatus(reloaded.status)) {
        result = canonicalQuoteBookingTerminalActionResult(reloaded)
      } else {
        throw new Error('canonical_quote_booking_resume_metadata_status_conflict')
      }
    }
    results.push(result)
  }

  return results
}

async function loadCanonicalQuoteBookingBlockedPlanResults(
  db: PlannerDb,
  actions: AgentAction[],
  planId: string,
  planStatus: string,
): Promise<CanonicalQuoteBookingExecutionResult[]> {
  const results: CanonicalQuoteBookingExecutionResult[] = []
  for (const originalAction of actions) {
    const action = await loadCanonicalQuoteBookingAction(db, originalAction.id, planId)
    if (!action) continue
    if (isTerminalAgentActionStatus(action.status)) {
      results.push(canonicalQuoteBookingTerminalActionResult(action))
      continue
    }
    if (action.status === 'approved' || action.status === 'executing') {
      results.push(canonicalQuoteBookingPlanStatusBlockedResult(action, planStatus))
    }
  }
  return results
}

async function loadCanonicalQuoteBookingPlanRaceResult(
  db: PlannerDb,
  actionId: string,
  planId: string,
  actorId: string,
): Promise<CanonicalQuoteBookingExecutionResult | null> {
  const { data, error } = await db
    .from('plans')
    .select('id, user_id, status, materialized_event_id')
    .eq('id', planId)
    .eq('user_id', actorId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const planStatus = readString(readRecord(data)?.status)
  if (!planStatus || isCanonicalQuoteBookingResumePlanStatus(planStatus)) return null

  const action = await loadCanonicalQuoteBookingAction(db, actionId, planId)
  if (!action) return null
  if (isTerminalAgentActionStatus(action.status)) {
    return canonicalQuoteBookingTerminalActionResult(action)
  }
  return action.status === 'approved' || action.status === 'executing'
    ? canonicalQuoteBookingPlanStatusBlockedResult(action, planStatus)
    : null
}

function isCanonicalQuoteBookingResumePlanStatus(status: string): boolean {
  return status === 'executing' || status === 'booked'
}

function canonicalQuoteBookingPlanStatusBlockedResult(
  action: AgentAction,
  planStatus: string,
): CanonicalQuoteBookingExecutionResult {
  return {
    disposition: 'waiting',
    metadata: {
      ...(readRecord(action.result_metadata) ?? {}),
      canonical_booking_status: 'resume_blocked_plan_status',
      resume_blocked: true,
      recovery_required: true,
      resume_blocked_reason: 'plan_status_not_executable',
      plan_status: planStatus,
      agent_action_id: action.id,
      approval_id: action.approval_id,
      action_status: action.status,
    },
  }
}

async function claimCanonicalQuoteBookingMaterializationResume(
  db: PlannerDb,
  action: AgentAction,
  approval: Approval,
  actorId: string,
): Promise<AgentAction> {
  if (!db.rpc) throw new Error('canonical_quote_booking_resume_claim_rpc_unavailable')
  const { data, error } = await db.rpc('claim_canonical_quote_booking_materialization_resume', {
    p_plan_id: action.plan_id,
    p_agent_action_id: action.id,
    p_approval_id: approval.id,
    p_actor_id: actorId,
    p_expected_snapshot_hash: approval.snapshot_hash,
  })
  if (error) throw new Error(readDatabaseError(error))
  const result = readRecord(data)
  const claimedAction = readRecord(result?.agent_action)
  if (
    !claimedAction ||
    !['executing', 'complete', 'cancelled', 'failed'].includes(readString(claimedAction.status) ?? '')
  ) {
    throw new Error('canonical_quote_booking_resume_claim_returned_incomplete_aggregate')
  }
  return claimedAction as unknown as AgentAction
}

async function loadCanonicalQuoteBookingAction(
  db: PlannerDb,
  actionId: string,
  planId: string,
): Promise<AgentAction | null> {
  const { data, error } = await db
    .from('agent_actions')
    .select(ACTION_SELECT)
    .eq('id', actionId)
    .eq('plan_id', planId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as AgentAction | null
}

async function markCanonicalQuoteBookingReapprovalRequired(
  db: PlannerDb,
  action: AgentAction,
  approval: Approval,
  reason: CanonicalQuoteBookingReapprovalReason,
  actorId: string,
): Promise<Approval> {
  if (!db.rpc) throw new Error('canonical_quote_booking_reapproval_rpc_unavailable')
  const { data, error } = await db.rpc('require_canonical_quote_booking_reapproval', {
    p_plan_id: action.plan_id,
    p_agent_action_id: action.id,
    p_approval_id: approval.id,
    p_actor_id: actorId,
    p_expected_snapshot_hash: approval.snapshot_hash,
    p_reason: reason,
  })
  if (error) throw new Error(readDatabaseError(error))
  const result = readRecord(data)
  const persistedApproval = readRecord(result?.approval)
  if (!result || result.disposition !== 'reapproval_required' || !persistedApproval) {
    throw new Error('canonical_quote_booking_reapproval_returned_incomplete_aggregate')
  }
  return persistedApproval as unknown as Approval
}

function canonicalQuoteBookingReapprovalReason(
  action: AgentAction,
  approval: Approval,
): CanonicalQuoteBookingReapprovalReason | null {
  if (approval.status === 're_approval_required') return 'approval_stale'
  if (action.status !== 'approved') return null
  if (approval.status === 'expired') return 'approval_expired'
  if (!approval.expires_at) return null
  const expiresAt = Date.parse(approval.expires_at)
  return Number.isFinite(expiresAt) && expiresAt <= Date.now()
    ? 'approval_expired'
    : null
}

function canonicalQuoteBookingDatabaseReapprovalReason(
  error: string,
): CanonicalQuoteBookingReapprovalReason | null {
  if (/expired|start_requires_unexpired|requires_executable_approval/i.test(error)) {
    return 'approval_expired'
  }
  if (/requires_reapproval|approved_(?:date|amount)_mismatch|snapshot.*(?:stale|mismatch)/i.test(error)) {
    return 'approval_stale'
  }
  return null
}

function canonicalQuoteBookingReapprovalResult(
  action: AgentAction,
  approval: Approval,
  reason: CanonicalQuoteBookingReapprovalReason,
): CanonicalQuoteBookingExecutionResult {
  return {
    disposition: 'waiting',
    metadata: {
      canonical_booking_status: 'reapproval_required',
      reapproval_required: true,
      reapproval_reason: reason,
      approval_id: approval.id,
      agent_action_id: action.id,
      outbound_message_sent: false,
    },
  }
}

function canonicalQuoteBookingTerminalActionResult(
  action: AgentAction,
): CanonicalQuoteBookingExecutionResult {
  const persistedMetadata = readRecord(action.result_metadata) ?? {}
  return {
    disposition: action.status === 'complete' ? 'complete' : 'waiting',
    metadata: {
      ...persistedMetadata,
      canonical_booking_status: readString(persistedMetadata.canonical_booking_status) ?? action.status,
      agent_action_id: action.id,
      action_status: action.status,
    },
  }
}

function canonicalQuoteBookingExistingExecutionResult(
  action: AgentAction,
): CanonicalQuoteBookingExecutionResult | null {
  if (action.status !== 'executing') return null
  const persistedMetadata = readRecord(action.result_metadata)
  const adminTaskId = readString(persistedMetadata?.admin_task_id)
  if (adminTaskId) {
    return {
      disposition: 'executing',
      metadata: {
        ...persistedMetadata,
        existing: true,
        canonical_booking_status: readString(persistedMetadata?.canonical_booking_status) ??
          'requires_concierge',
        admin_task_id: adminTaskId,
        agent_action_id: action.id,
        action_status: action.status,
      },
    }
  }
  const bookingId = readString(persistedMetadata?.booking_id)
  const bookingKind = readString(persistedMetadata?.booking_kind)
  if (!bookingId || (bookingKind !== 'venue' && bookingKind !== 'vendor')) return null

  return {
    disposition: 'executing',
    metadata: {
      ...persistedMetadata,
      existing: true,
      canonical_booking_status: readString(persistedMetadata?.canonical_booking_status) ??
        'pending_partner_confirmation',
      booking_id: bookingId,
      booking_kind: bookingKind,
      agent_action_id: action.id,
      action_status: action.status,
    },
  }
}

function isTerminalAgentActionStatus(status: AgentAction['status']): boolean {
  return status === 'complete' || status === 'cancelled' || status === 'failed'
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
      amountCents: readNullableInteger(row.quoted_price_cents),
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
    readNullableInteger(row.quoted_hourly_cents)
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

function isExplicitZeroUpfrontQuote(quote: TrustedQuote): boolean {
  if (quote.kind !== 'venue') return false
  const dealModel = quote.dealModel
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  return dealModel === 'free_space' ||
    dealModel === 'complimentary' ||
    dealModel === 'comped' ||
    dealModel === 'chi' ||
    dealModel === 'community_host_incentive' ||
    dealModel === 'bar_consumption_chi' ||
    dealModel === 'ticket_chi' ||
    dealModel === 'per_head_chi' ||
    dealModel === 'consumption_share' ||
    dealModel === 'bar_consumption_share' ||
    dealModel === 'ticket_consumption_share'
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

export const CANONICAL_QUOTE_BOOKING_SNAPSHOT_VERSION = APPROVAL_SNAPSHOT_SCHEMA_VERSION
