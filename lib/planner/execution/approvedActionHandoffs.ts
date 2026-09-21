import 'server-only'

import type { AgentAction, Approval, Json, Plan } from '@/lib/types'
import {
  cancelExecutingCanonicalQuoteBooking,
  executeCanonicalQuoteBooking,
  isCanonicalQuoteBookingAction,
} from './canonicalQuoteBooking'
import {
  cancelConciergeHandoff,
  executeGenericConciergeHandoff,
  executeVendorContactHandoff,
  executeVenueHoldConciergeHandoff,
  type ConciergeExecutionDb,
} from '@/lib/server/concierge-execution'

export type ApprovedHandoffDb = ConciergeExecutionDb & {
  from: (table: string) => any
}

export type ApprovedHandoffResult = {
  disposition: 'executing' | 'complete' | 'waiting'
  metadata: Json
}

/**
 * Executes the concierge branch selected by executeApprovedAction. This is
 * shared by first authorization and failed-action retry; routes do not switch
 * independently on action types.
 */
export async function executeConciergeApprovedAction(input: {
  db: ApprovedHandoffDb
  action: AgentAction
  approval: Approval
  plan: Plan
  actorId: string
}): Promise<ApprovedHandoffResult> {
  if (isCanonicalQuoteBookingAction(input.action)) {
    const booking = await executeCanonicalQuoteBooking(input)
    if (booking.metadata.requires_concierge === true) {
      const queued = await executeGenericConciergeHandoff(input, {
        description: `Claim or coordinate the approved ${String(booking.metadata.quote_kind ?? 'partner')} quote before creating its canonical booking.`,
        hostMessage: '3rdPlace queued the approved quote for operator follow-up because the partner is not claimed. Nothing has been booked or paid.',
        metadata: booking.metadata,
      })
      if (!queued.handled) throw new Error(queued.reason)
      return {
        disposition: 'executing',
        metadata: { ...booking.metadata, ...queued.metadata } as Json,
      }
    }
    return { disposition: booking.disposition, metadata: booking.metadata as Json }
  }

  const execution = input.action.action_type === 'hold_request'
    ? await executeVenueHoldConciergeHandoff(input)
    : input.action.action_type === 'vendor_contact'
      ? await executeVendorContactHandoff(input)
      : await executeGenericConciergeHandoff(input)

  if (!execution.handled) throw new Error(execution.reason)
  return { disposition: execution.disposition, metadata: execution.metadata as Json }
}

export async function cancelConciergeApprovedAction(input: {
  db: ApprovedHandoffDb
  action: AgentAction
  approval: Approval
  plan: Plan
  actorId: string
  reason: string
}): Promise<{ cancelled: true; metadata: Json }> {
  const actionMetadata = readRecord(input.action.result_metadata)
  let taskMetadata: Record<string, unknown> = {}
  if (readString(actionMetadata?.admin_task_id)) {
    const task = await cancelConciergeHandoff(input, input.reason)
    taskMetadata = task.metadata
  }

  if (isCanonicalQuoteBookingAction(input.action)) {
    const booking = await cancelExecutingCanonicalQuoteBooking(input)
    return {
      cancelled: true,
      metadata: { ...booking.metadata, ...taskMetadata } as Json,
    }
  }

  if (!readString(actionMetadata?.admin_task_id)) {
    const task = await cancelConciergeHandoff(input, input.reason)
    taskMetadata = task.metadata
  }
  return { cancelled: true, metadata: taskMetadata as Json }
}

export function requireApprovedHandoffDb(db: {
  from: (table: string) => any
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown
    error: { message?: string; code?: string } | null
  }>
}): ApprovedHandoffDb {
  if (!db.rpc) throw new Error('Approved handoff RPC is unavailable')
  return db as unknown as ApprovedHandoffDb
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
