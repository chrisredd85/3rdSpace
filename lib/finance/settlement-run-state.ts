import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

type SupabaseAdminClient = SupabaseClient<any, 'public', any>

export type SettlementRunStatus =
  | 'pending'
  | 'awaiting_attendance'
  | 'awaiting_organizer_review'
  | 'awaiting_venue_ack'
  | 'awaiting_venue_payment'
  | 'ready_to_settle'
  | 'blocked'
  | 'settled'
  | 'disputed'
  | 'cancelled'

export type SettlementRunTransition =
  | 'attendance_recorded'
  | 'organizer_approved'
  | 'organizer_disputed'
  | 'venue_acknowledged'
  | 'venue_payment_initiated'
  | 'venue_paid'
  | 'venue_disputed'
  | 'stripe_account_blocked'
  | 'stripe_settled'
  | 'admin_resolved'
  | 'admin_cancelled'

export type SettlementChargeStatus = 'checkout_created' | 'paid' | 'failed' | 'cancelled'

export type AuditActorType = 'admin' | 'organizer' | 'venue' | 'system' | 'stripe_webhook'

export type SettlementTransitionActor = {
  id: string | null
  type: AuditActorType
}

export type TransitionSettlementRunResult =
  | { success: true; run: Record<string, unknown> }
  | { success: false; reason: string; run?: Record<string, unknown> | null }

export type TransitionSettlementChargeResult =
  | { success: true; charge: Record<string, unknown> }
  | { success: false; reason: string; charge?: Record<string, unknown> | null }

const VALID_TRANSITIONS: Record<
  SettlementRunStatus,
  Partial<Record<SettlementRunTransition, SettlementRunStatus>>
> = {
  pending: { attendance_recorded: 'awaiting_organizer_review', stripe_account_blocked: 'blocked' },
  awaiting_attendance: { attendance_recorded: 'awaiting_organizer_review', stripe_account_blocked: 'blocked' },
  awaiting_organizer_review: {
    organizer_approved: 'awaiting_venue_ack',
    organizer_disputed: 'disputed',
    stripe_account_blocked: 'blocked',
    admin_cancelled: 'cancelled',
  },
  awaiting_venue_ack: {
    venue_acknowledged: 'awaiting_venue_payment',
    venue_payment_initiated: 'awaiting_venue_payment',
    venue_disputed: 'disputed',
    organizer_disputed: 'disputed',
    stripe_account_blocked: 'blocked',
    admin_cancelled: 'cancelled',
  },
  awaiting_venue_payment: {
    venue_paid: 'settled',
    stripe_settled: 'settled',
    venue_disputed: 'disputed',
    organizer_disputed: 'disputed',
    stripe_account_blocked: 'blocked',
    admin_cancelled: 'cancelled',
  },
  ready_to_settle: {
    stripe_settled: 'settled',
    stripe_account_blocked: 'blocked',
    admin_cancelled: 'cancelled',
  },
  blocked: { admin_cancelled: 'cancelled' },
  settled: {},
  disputed: { admin_resolved: 'awaiting_organizer_review', admin_cancelled: 'cancelled' },
  cancelled: {},
}

export function transitionSettlementRunStatus(
  current: SettlementRunStatus,
  event: SettlementRunTransition,
): { ok: true; to: SettlementRunStatus } | { ok: false; reason: string } {
  const next = VALID_TRANSITIONS[current]?.[event]
  if (!next) {
    return { ok: false, reason: `Cannot apply '${event}' to status '${current}'` }
  }
  return { ok: true, to: next }
}

export async function transitionSettlementRun(opts: {
  db: SupabaseAdminClient
  runId: string
  fromStatus: SettlementRunStatus
  toStatus: SettlementRunStatus
  action: SettlementRunTransition | string
  actor: SettlementTransitionActor
  reason?: string | null
  metadata?: Record<string, unknown>
  patch?: Record<string, unknown>
}): Promise<TransitionSettlementRunResult> {
  const rpc = (opts.db as any).rpc
  if (typeof rpc === 'function') {
    const { data, error } = await rpc('transition_settlement_run_status', {
      p_run_id: opts.runId,
      p_from_status: opts.fromStatus,
      p_to_status: opts.toStatus,
      p_action: opts.action,
      p_actor_id: opts.actor.id,
      p_actor_type: opts.actor.type,
      p_reason: opts.reason ?? null,
      p_metadata: opts.metadata ?? {},
      p_patch: opts.patch ?? {},
    })

    if (error) throw new Error(error.message ?? 'Failed to transition settlement run')

    const row = Array.isArray(data) ? data[0] : data
    if (!row?.success) {
      return {
        success: false,
        reason: row?.failure_reason ?? 'concurrent_update',
        run: row?.run ?? null,
      }
    }
    return { success: true, run: row.run }
  }

  return fallbackTransitionSettlementRun(opts)
}

export async function transitionSettlementCharge(opts: {
  db: SupabaseAdminClient
  chargeId: string
  fromStatus: SettlementChargeStatus
  toStatus: SettlementChargeStatus
  action: string
  actor: SettlementTransitionActor
  reason?: string | null
  metadata?: Record<string, unknown>
  patch?: Record<string, unknown>
}): Promise<TransitionSettlementChargeResult> {
  const rpc = (opts.db as any).rpc
  if (typeof rpc === 'function') {
    const { data, error } = await rpc('transition_settlement_charge_status', {
      p_charge_id: opts.chargeId,
      p_from_status: opts.fromStatus,
      p_to_status: opts.toStatus,
      p_action: opts.action,
      p_actor_id: opts.actor.id,
      p_actor_type: opts.actor.type,
      p_reason: opts.reason ?? null,
      p_metadata: opts.metadata ?? {},
      p_patch: opts.patch ?? {},
    })

    if (error) throw new Error(error.message ?? 'Failed to transition settlement charge')

    const row = Array.isArray(data) ? data[0] : data
    if (!row?.success) {
      return {
        success: false,
        reason: row?.failure_reason ?? 'concurrent_update',
        charge: row?.charge ?? null,
      }
    }
    return { success: true, charge: row.charge }
  }

  return fallbackTransitionSettlementCharge(opts)
}

async function fallbackTransitionSettlementRun(opts: {
  db: SupabaseAdminClient
  runId: string
  fromStatus: SettlementRunStatus
  toStatus: SettlementRunStatus
  action: SettlementRunTransition | string
  actor: SettlementTransitionActor
  reason?: string | null
  metadata?: Record<string, unknown>
  patch?: Record<string, unknown>
}): Promise<TransitionSettlementRunResult> {
  const { data: before, error: beforeError } = await (opts.db as any)
    .from('settlement_runs')
    .select('*')
    .eq('id', opts.runId)
    .maybeSingle()
  if (beforeError) throw new Error(beforeError.message ?? 'Failed to load settlement run')
  if (!before) return { success: false, reason: 'not_found', run: null }
  if (before.status !== opts.fromStatus) {
    return { success: false, reason: 'concurrent_update', run: before }
  }

  const { data, error } = await (opts.db as any)
    .from('settlement_runs')
    .update({
      ...(opts.patch ?? {}),
      status: opts.toStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', opts.runId)
    .eq('status', opts.fromStatus)
    .select('*')
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to transition settlement run')
  if (!data) return { success: false, reason: 'concurrent_update', run: null }

  await (opts.db as any).from('settlement_audit_log').insert({
    entity_type: 'settlement_run',
    entity_id: opts.runId,
    action: opts.action,
    before_state: before,
    after_state: data,
    actor_id: opts.actor.id,
    actor_type: opts.actor.type,
    reason: opts.reason ?? null,
    metadata: opts.metadata ?? {},
  })

  return { success: true, run: data }
}

async function fallbackTransitionSettlementCharge(opts: {
  db: SupabaseAdminClient
  chargeId: string
  fromStatus: SettlementChargeStatus
  toStatus: SettlementChargeStatus
  action: string
  actor: SettlementTransitionActor
  reason?: string | null
  metadata?: Record<string, unknown>
  patch?: Record<string, unknown>
}): Promise<TransitionSettlementChargeResult> {
  const { data: before, error: beforeError } = await (opts.db as any)
    .from('settlement_charges')
    .select('*')
    .eq('id', opts.chargeId)
    .maybeSingle()
  if (beforeError) throw new Error(beforeError.message ?? 'Failed to load settlement charge')
  if (!before) return { success: false, reason: 'not_found', charge: null }
  if (before.status !== opts.fromStatus) {
    return { success: false, reason: 'concurrent_update', charge: before }
  }

  const { data, error } = await (opts.db as any)
    .from('settlement_charges')
    .update({
      ...(opts.patch ?? {}),
      status: opts.toStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', opts.chargeId)
    .eq('status', opts.fromStatus)
    .select('*')
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to transition settlement charge')
  if (!data) return { success: false, reason: 'concurrent_update', charge: null }

  await (opts.db as any).from('settlement_audit_log').insert({
    entity_type: 'settlement_charge',
    entity_id: opts.chargeId,
    action: opts.action,
    before_state: before,
    after_state: data,
    actor_id: opts.actor.id,
    actor_type: opts.actor.type,
    reason: opts.reason ?? null,
    metadata: opts.metadata ?? {},
  })

  return { success: true, charge: data }
}
