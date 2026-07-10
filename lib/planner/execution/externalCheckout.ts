import type { AgentAction, Approval, Json, Plan } from '@/lib/types'

export const EXTERNAL_CHECKOUT_RESULT_KEY = 'external_checkout' as const

export type ExternalCheckoutHandoffStatus = 'ready' | 'completed'

export interface ExternalCheckoutHandoffEvidence {
  status: ExternalCheckoutHandoffStatus
  external_url: string
  approval_id: string
  snapshot_hash: string
  unlocked_at: string
  completion_confirmation_required: boolean
  completed_at?: string
  confirmed_by?: string
  confirmation_source?: 'host' | 'webhook'
}

export interface ExternalCheckoutHandoffResult {
  actionStatus: 'executing'
  resultMetadata: Json
  evidence: ExternalCheckoutHandoffEvidence
}

type ExternalCheckoutExecutionDb = { from: (table: string) => any }

/**
 * Validates and canonicalizes a newly supplied external checkout URL.
 *
 * New writes must use `external_url`. Legacy `url` and `checkout_url` keys are
 * accepted only by the reader below so old actions remain executable without
 * perpetuating the ambiguous storage contract.
 */
export function normalizeExternalCheckoutUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('external_url is required')
  const candidate = value.trim()
  if (!candidate) throw new Error('external_url is required')
  if (candidate.length > 2_048) throw new Error('external_url must be at most 2048 characters')

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error('external_url must be a valid HTTPS URL')
  }

  if (parsed.protocol !== 'https:') throw new Error('external_url must use HTTPS')
  if (parsed.username || parsed.password) {
    throw new Error('external_url must not include embedded credentials')
  }

  return parsed.toString()
}

/** Reads canonical evidence while preserving compatibility with historical payload keys. */
export function readExternalCheckoutUrl(payload: unknown): string | null {
  const record = readRecord(payload)
  if (!record) return null

  if (Object.prototype.hasOwnProperty.call(record, 'external_url')) {
    try {
      return normalizeExternalCheckoutUrl(record.external_url)
    } catch {
      return null
    }
  }

  for (const key of ['url', 'checkout_url'] as const) {
    try {
      return normalizeExternalCheckoutUrl(record[key])
    } catch {
      // Continue through legacy aliases. Invalid links never become handoff evidence.
    }
  }

  return null
}

/**
 * Pure handler for the shared approved-action dispatcher.
 *
 * It performs no navigation or provider call. It only turns the exact approved
 * snapshot into durable evidence that the UI may expose as a host-controlled
 * deep link.
 */
export function prepareExternalCheckoutHandoff(input: {
  action: Pick<
    AgentAction,
    'id' | 'plan_id' | 'action_type' | 'approval_id' | 'payload_json' | 'result_metadata'
  >
  approval: Pick<Approval, 'id' | 'agent_action_id' | 'status' | 'snapshot_hash'>
  now?: Date
}): ExternalCheckoutHandoffResult {
  if (input.action.action_type !== 'external_checkout') {
    throw new Error('External checkout handler received a different action type')
  }
  if (input.approval.agent_action_id !== input.action.id) {
    throw new Error('External checkout approval does not match the action')
  }
  if (input.action.approval_id !== input.approval.id) {
    throw new Error('External checkout action does not point to this approval')
  }
  if (input.approval.status !== 'authorized' && input.approval.status !== 'approved') {
    throw new Error('External checkout requires a current authorization')
  }
  if (!input.approval.snapshot_hash) {
    throw new Error('External checkout approval is missing its snapshot hash')
  }

  const externalUrl = readExternalCheckoutUrl(input.action.payload_json)
  if (!externalUrl) throw new Error('External checkout action is missing a valid HTTPS URL')

  const evidence: ExternalCheckoutHandoffEvidence = {
    status: 'ready',
    external_url: externalUrl,
    approval_id: input.approval.id,
    snapshot_hash: input.approval.snapshot_hash,
    unlocked_at: (input.now ?? new Date()).toISOString(),
    completion_confirmation_required: true,
  }

  return {
    actionStatus: 'executing',
    evidence,
    resultMetadata: {
      ...(readRecord(input.action.result_metadata) ?? {}),
      execution_mode: 'external_checkout',
      message: 'Approved external checkout is ready for the host to open.',
      [EXTERNAL_CHECKOUT_RESULT_KEY]: evidence,
    } as unknown as Json,
  }
}

/**
 * Shared-dispatch handler. The caller owns the approved -> executing state
 * transition; this handler persists only the durable, host-visible handoff
 * evidence and performs no external side effect.
 */
export async function executeExternalCheckoutHandoff(input: {
  db: ExternalCheckoutExecutionDb
  action: Pick<
    AgentAction,
    'id' | 'plan_id' | 'action_type' | 'approval_id' | 'payload_json' | 'result_metadata'
  >
  approval: Pick<Approval, 'id' | 'agent_action_id' | 'status' | 'snapshot_hash'>
  plan: Pick<Plan, 'id' | 'user_id'>
  actorId: string
  now?: Date
}): Promise<{ disposition: 'executing'; metadata: Json }> {
  if (input.action.plan_id !== input.plan.id) {
    throw new Error('External checkout action does not belong to this plan')
  }
  if (input.plan.user_id !== input.actorId) {
    throw new Error('External checkout actor does not own this plan')
  }

  const prepared = prepareExternalCheckoutHandoff({
    action: input.action,
    approval: input.approval,
    now: input.now,
  })
  const { data, error } = await input.db
    .from('agent_actions')
    .update({ result_metadata: prepared.resultMetadata })
    .eq('id', input.action.id)
    .eq('plan_id', input.plan.id)
    .eq('status', 'executing')
    .select('id')
    .maybeSingle()

  if (error || !data) {
    throw new Error(error?.message ?? 'External checkout handoff could not be persisted')
  }

  return { disposition: 'executing', metadata: prepared.resultMetadata }
}

export function readExternalCheckoutHandoffEvidence(
  resultMetadata: unknown
): ExternalCheckoutHandoffEvidence | null {
  const root = readRecord(resultMetadata)
  const evidence = readRecord(root?.[EXTERNAL_CHECKOUT_RESULT_KEY])
  if (!evidence) return null

  const status = evidence.status
  if (status !== 'ready' && status !== 'completed') return null

  const externalUrl = readExternalCheckoutUrl(evidence)
  const approvalId = readString(evidence.approval_id)
  const snapshotHash = readString(evidence.snapshot_hash)
  const unlockedAt = readString(evidence.unlocked_at)
  if (!externalUrl || !approvalId || !snapshotHash || !unlockedAt) return null

  const completedAt = readString(evidence.completed_at)
  const confirmedBy = readString(evidence.confirmed_by)
  const confirmationSource = evidence.confirmation_source

  return {
    status,
    external_url: externalUrl,
    approval_id: approvalId,
    snapshot_hash: snapshotHash,
    unlocked_at: unlockedAt,
    completion_confirmation_required: evidence.completion_confirmation_required === true,
    ...(completedAt ? { completed_at: completedAt } : {}),
    ...(confirmedBy ? { confirmed_by: confirmedBy } : {}),
    ...(confirmationSource === 'host' || confirmationSource === 'webhook'
      ? { confirmation_source: confirmationSource }
      : {}),
  }
}

export function completeExternalCheckoutHandoff(input: {
  resultMetadata: unknown
  confirmedBy: string
  now?: Date
}): { resultMetadata: Json; evidence: ExternalCheckoutHandoffEvidence } {
  const current = readExternalCheckoutHandoffEvidence(input.resultMetadata)
  if (!current) throw new Error('External checkout handoff evidence is missing')

  if (current.status === 'completed') {
    return { resultMetadata: input.resultMetadata as Json, evidence: current }
  }

  const evidence: ExternalCheckoutHandoffEvidence = {
    ...current,
    status: 'completed',
    completed_at: (input.now ?? new Date()).toISOString(),
    confirmed_by: input.confirmedBy,
    confirmation_source: 'host',
  }

  return {
    evidence,
    resultMetadata: {
      ...(readRecord(input.resultMetadata) ?? {}),
      execution_mode: 'external_checkout',
      message: 'Host confirmed the external checkout was completed.',
      [EXTERNAL_CHECKOUT_RESULT_KEY]: evidence,
    } as unknown as Json,
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
