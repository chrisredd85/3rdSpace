import 'server-only'

import type { AgentAction, Approval, Json, Plan } from '@/lib/types'

type DbError = { message?: string; code?: string } | null

type VendorContactRow = {
  id: string
  name: string
  contact_email: string | null
  portfolio_url: string | null
  discovery_vendor_id: string | null
}

type VendorContactQueryResult = {
  data: VendorContactRow | null
  error: DbError
}

type VendorContactQuery = {
  eq: (column: 'id', value: string) => {
    maybeSingle: () => Promise<VendorContactQueryResult>
  }
}

export type ConciergeExecutionDb = {
  from: (table: 'vendor_profiles') => {
    select: (columns: string) => VendorContactQuery
  }
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown
    error: DbError
  }>
}

export type ConciergeExecutionInput = {
  db: ConciergeExecutionDb
  action: AgentAction
  approval: Approval
  plan: Plan
  actorId: string
}

export type ConciergeExecutionResult =
  | {
      handled: true
      disposition: 'executing' | 'complete'
      metadata: Record<string, Json>
    }
  | {
      handled: false
      reason: string
    }

export type ConciergeCancellationResult = {
  cancelled: true
  metadata: Record<string, Json>
}

export class ConciergeExecutionError extends Error {
  constructor(
    message: string,
    public readonly code = 'concierge_execution_failed'
  ) {
    super(message)
    this.name = 'ConciergeExecutionError'
  }
}

/**
 * Queues an approved venue-hold request for a human operator. The shared
 * dispatcher may already have advanced the action to `executing`; the RPC is
 * idempotent and also tolerates `approved` for crash-safe recovery.
 */
export async function executeVenueHoldConciergeHandoff(
  input: ConciergeExecutionInput
): Promise<ConciergeExecutionResult> {
  assertExecutionIdentity(input, 'hold_request')
  const payload = readRecord(input.action.payload_json)
  const provider = readString(input.action.provider) ?? readString(payload?.provider) ?? 'recommended venue'
  const holdHours = readPositiveInteger(payload?.hold_duration_hours)
  const task = await enqueueApprovedAdminTask(input, {
    taskType: 'concierge_booking',
    description: `Request and verify a venue hold with ${provider}.`,
    priority: 'high',
    metadata: {
      target_type: input.action.target_type ?? 'venue',
      target_id: input.action.target_id,
      provider,
      requested_amount_cents: input.action.amount_cents,
      hold_duration_hours: holdHours,
      approved_snapshot_hash: input.approval.snapshot_hash,
    },
    hostMessage:
      `3rdPlace queued the approved hold request with ${provider} for operator follow-up. ` +
      'Nothing has been booked or paid.',
  })

  return {
    handled: true,
    disposition: 'executing',
    metadata: {
      execution_mode: 'concierge_admin_queue',
      handoff_status: 'queued',
      admin_task_id: task.id,
      event_id: task.event_id,
      outbound_message_sent: false,
    },
  }
}

/**
 * Prepares an unsent vendor email draft when a verified address exists. Missing
 * contact data becomes an operator task. This function never calls Gmail or any
 * other outbound provider.
 */
export async function executeVendorContactHandoff(
  input: ConciergeExecutionInput
): Promise<ConciergeExecutionResult> {
  assertExecutionIdentity(input, 'vendor_contact')
  const payload = readRecord(input.action.payload_json)
  if (readString(payload?.kind) === 'vendor_reply_capture') {
    return { handled: false, reason: 'vendor_reply_capture_is_not_outbound_contact' }
  }

  const targetId = readUuid(input.action.target_id)
  const vendor = targetId ? await loadVendor(input.db, targetId) : null
  const provider = vendor?.name ?? readString(input.action.provider) ?? readString(payload?.provider) ?? 'selected vendor'
  const email = normalizeEmail(vendor?.contact_email)

  if (vendor && email) {
    const { data, error } = await input.db.rpc('prepare_approved_vendor_contact_draft', {
      p_plan_id: input.plan.id,
      p_action_id: input.action.id,
      p_approval_id: input.approval.id,
      p_actor_id: input.actorId,
    })

    if (!error) {
      const result = readRecord(data)
      if (!result) {
        throw new ConciergeExecutionError('Vendor draft command returned no result')
      }
      return {
        handled: true,
        disposition: 'complete',
        metadata: {
          execution_mode: 'concierge_admin_queue',
          handoff_status: 'draft_ready',
          outreach_thread_id: readString(result.outreach_thread_id),
          outreach_message_id: readString(result.outreach_message_id),
          outbound_message_sent: false,
          send_requires_separate_approval: true,
        },
      }
    }

    // Contact data may have changed between lookup and the locked RPC. Fail
    // safely into the operator queue rather than pretending a draft exists.
    if (!/vendor_contact_email_missing/i.test(error.message ?? '')) {
      throw rpcError('Unable to prepare the vendor outreach draft', error)
    }
  }

  const task = await enqueueApprovedAdminTask(input, {
    taskType: 'vendor_confirm',
    description: `Verify contact details and prepare outreach for ${provider}.`,
    priority: 'normal',
    metadata: {
      target_type: input.action.target_type ?? 'vendor',
      target_id: targetId,
      provider,
      contact_state: vendor ? 'email_missing' : 'vendor_not_resolved',
      website: vendor?.portfolio_url ?? null,
      approved_snapshot_hash: input.approval.snapshot_hash,
    },
    hostMessage:
      `3rdPlace queued contact verification for ${provider}. ` +
      'No outreach has been sent.',
  })

  return {
    handled: true,
    disposition: 'executing',
    metadata: {
      execution_mode: 'concierge_admin_queue',
      handoff_status: 'queued',
      admin_task_id: task.id,
      event_id: task.event_id,
      outbound_message_sent: false,
    },
  }
}

/**
 * Queues the unclaimed targets in an approved venue/vendor opportunity batch.
 * Call this with the action reloaded after opportunity invite preparation so
 * the persisted `concierge_invite_ids` reflect the approved work. It replaces
 * the old pre-approval task insertion in opportunityBuilder.
 */
export async function executeOpportunityConciergeHandoff(
  input: ConciergeExecutionInput
): Promise<ConciergeExecutionResult> {
  if (!['opportunity_send_venues', 'opportunity_send_vendors'].includes(input.action.action_type)) {
    return { handled: false, reason: 'not_an_opportunity_concierge_action' }
  }
  assertCommonExecutionIdentity(input)

  const payload = readRecord(input.action.payload_json)
  const targets = readRecordArray(payload?.targets).filter((target) => target.route_to_concierge === true)
  const inviteIds = uniqueStrings([
    ...readStringArray(payload?.concierge_invite_ids),
    ...readStringArray(payload?.concierge_vendor_invite_ids),
  ])
  if (targets.length === 0 && inviteIds.length === 0) {
    return { handled: false, reason: 'no_concierge_targets' }
  }

  const task = await enqueueApprovedAdminTask(input, {
    taskType: 'concierge_booking',
    description: `Route ${Math.max(targets.length, inviteIds.length)} approved opportunity target${Math.max(targets.length, inviteIds.length) === 1 ? '' : 's'} through 3rdPlace operator follow-up.`,
    priority: 'high',
    metadata: {
      opportunity_brief_id: readString(payload?.opportunity_brief_id),
      invite_ids: inviteIds,
      targets: targets as unknown as Json,
      approved_snapshot_hash: input.approval.snapshot_hash,
    },
    hostMessage:
      '3rdPlace queued the approved unclaimed partner follow-up for an operator. No outreach has been sent.',
  })

  return {
    handled: true,
    disposition: 'executing',
    metadata: {
      execution_mode: 'concierge_admin_queue',
      handoff_status: 'queued',
      admin_task_id: task.id,
      event_id: task.event_id,
      outbound_message_sent: false,
    },
  }
}

/**
 * Queues a payload-tagged concierge action that has no narrower handler. This
 * is also the safe fallback for an approved canonical quote whose discovery
 * partner has not been claimed yet, so no legacy booking row can be created.
 */
export async function executeGenericConciergeHandoff(
  input: ConciergeExecutionInput,
  options: {
    description?: string
    hostMessage?: string
    metadata?: Record<string, unknown>
  } = {}
): Promise<ConciergeExecutionResult> {
  assertCommonExecutionIdentity(input)
  const payload = readRecord(input.action.payload_json)
  const provider = readString(input.action.provider) ??
    readString(payload?.target_name) ??
    readString(payload?.provider) ??
    'the selected partner'
  const task = await enqueueApprovedAdminTask(input, {
    taskType: 'concierge_booking',
    description: options.description ?? `Complete the approved concierge handoff with ${provider}.`,
    priority: 'high',
    metadata: {
      target_type: input.action.target_type,
      target_id: input.action.target_id,
      provider,
      approved_snapshot_hash: input.approval.snapshot_hash,
      action_kind: readString(payload?.kind),
      ...(options.metadata ?? {}),
    },
    hostMessage: options.hostMessage ??
      `3rdPlace queued the approved request with ${provider} for operator follow-up. ` +
      'Nothing has been sent, booked, or paid.',
  })

  return {
    handled: true,
    disposition: 'executing',
    metadata: {
      execution_mode: 'concierge_admin_queue',
      handoff_status: 'queued',
      admin_task_id: task.id,
      event_id: task.event_id,
      outbound_message_sent: false,
    },
  }
}

/**
 * Cancels post-authorization operator work by action identity. Approval routes
 * do not need access to the internal task id, and replay remains idempotent in
 * the database command.
 */
export async function cancelConciergeHandoff(
  input: ConciergeExecutionInput,
  reason?: string | null
): Promise<ConciergeCancellationResult> {
  assertCancellationIdentity(input)
  const { data, error } = await input.db.rpc('cancel_approved_admin_task', {
    p_plan_id: input.plan.id,
    p_action_id: input.action.id,
    p_approval_id: input.approval.id,
    p_actor_id: input.actorId,
    p_reason: readString(reason),
    p_host_message: null,
  })

  if (error) throw rpcError('Unable to cancel the approved operator task', error)
  const task = readRecord(Array.isArray(data) ? data[0] : data)
  if (!task || !readString(task.id)) {
    throw new ConciergeExecutionError('Operator cancellation command returned no task')
  }

  return {
    cancelled: true,
    metadata: {
      execution_mode: 'concierge_admin_queue',
      handoff_status: 'cancelled',
      admin_task_id: readString(task.id),
      event_id: readString(task.event_id),
      outbound_message_sent: false,
    },
  }
}

async function enqueueApprovedAdminTask(
  input: ConciergeExecutionInput,
  task: {
    taskType: 'concierge_booking' | 'vendor_confirm'
    description: string
    priority: 'normal' | 'high'
    metadata: Record<string, unknown>
    hostMessage: string
  }
) {
  const { data, error } = await input.db.rpc('enqueue_approved_admin_task', {
    p_plan_id: input.plan.id,
    p_action_id: input.action.id,
    p_approval_id: input.approval.id,
    p_actor_id: input.actorId,
    p_task_type: task.taskType,
    p_description: task.description,
    p_priority: task.priority,
    p_metadata: task.metadata,
    p_due_at: null,
    p_host_message: task.hostMessage,
  })

  if (error) throw rpcError('Unable to queue the approved operator task', error)
  const row = readRecord(Array.isArray(data) ? data[0] : data)
  if (!row || !readString(row.id)) {
    throw new ConciergeExecutionError('Operator task command returned no task')
  }
  return {
    id: readString(row.id)!,
    event_id: readString(row.event_id),
  }
}

async function loadVendor(db: ConciergeExecutionDb, vendorId: string) {
  const { data, error } = await db
    .from('vendor_profiles')
    .select('id,name,contact_email,portfolio_url,discovery_vendor_id')
    .eq('id', vendorId)
    .maybeSingle()

  if (error) throw new ConciergeExecutionError(error.message ?? 'Unable to load vendor contact state')
  if (!data) return null
  return data
}

function assertExecutionIdentity(input: ConciergeExecutionInput, actionType: string) {
  assertCommonExecutionIdentity(input)
  if (input.action.action_type !== actionType) {
    throw new ConciergeExecutionError(`Expected ${actionType} action`, 'concierge_action_type_mismatch')
  }
}

function assertCommonExecutionIdentity(input: ConciergeExecutionInput) {
  if (
    input.action.plan_id !== input.plan.id ||
    input.approval.plan_id !== input.plan.id ||
    input.approval.agent_action_id !== input.action.id ||
    input.action.approval_id !== input.approval.id
  ) {
    throw new ConciergeExecutionError('Action, approval, and plan identity do not match', 'concierge_identity_mismatch')
  }
  if (input.approval.status !== 'authorized' && input.approval.status !== 'approved') {
    throw new ConciergeExecutionError('Approval is not executable', 'concierge_approval_not_executable')
  }
  if (!['approved', 'executing', 'complete'].includes(input.action.status)) {
    throw new ConciergeExecutionError('Action is not ready for concierge execution', 'concierge_action_not_executable')
  }
}

function assertCancellationIdentity(input: ConciergeExecutionInput) {
  if (
    input.plan.user_id !== input.actorId ||
    input.action.plan_id !== input.plan.id ||
    input.approval.plan_id !== input.plan.id ||
    input.approval.agent_action_id !== input.action.id ||
    input.action.approval_id !== input.approval.id
  ) {
    throw new ConciergeExecutionError('Action, approval, and plan identity do not match', 'concierge_identity_mismatch')
  }
}

function rpcError(message: string, error: Exclude<DbError, null>) {
  return new ConciergeExecutionError(
    `${message}: ${error.message ?? 'unknown database error'}`,
    error.code ?? 'concierge_rpc_failed'
  )
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const record = readRecord(item)
    return record ? [record] : []
  })
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readUuid(value: unknown): string | null {
  const valueString = readString(value)
  return valueString && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valueString)
    ? valueString
    : null
}

function normalizeEmail(value: unknown): string | null {
  const email = readString(value)?.toLowerCase() ?? null
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}
