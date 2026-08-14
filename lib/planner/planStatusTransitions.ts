import type { Json, Plan, PlanStatus } from '@/lib/types'

/** Database-owned lifecycle triggers. Callers describe facts; the database validates the transition. */
export type PlanStatusTransitionTrigger =
  | 'intake_completed'
  | 'intake_invalidated'
  | 'approval_authorized'
  | 'event_materialized'
  | 'booking_created'
  | 'outcome_recorded'
  | 'plan_archived'

export type PlanStatusRpcClient = {
  rpc: (
    functionName: 'transition_plan_status',
    args: {
      p_plan_id: string
      p_expected_status: PlanStatus
      p_to_status: PlanStatus
      p_trigger: PlanStatusTransitionTrigger
      p_actor_id: string
      p_context: Json
    }
  ) => Promise<{ data: unknown; error: { message?: string; code?: string; details?: string; hint?: string } | null }>
}

export class PlanStatusTransitionError extends Error {
  readonly code: string | null
  readonly details: string | null
  readonly hint: string | null

  constructor(error: { message?: string; code?: string; details?: string; hint?: string }) {
    super(error.message ?? 'Plan status transition failed')
    this.name = 'PlanStatusTransitionError'
    this.code = error.code ?? null
    this.details = error.details ?? null
    this.hint = error.hint ?? null
  }
}

/**
 * Executes the sole application-facing plan lifecycle transition command.
 *
 * The RPC owns validation, compare-and-swap, mutation, and audit logging. This
 * helper deliberately has no direct-update fallback: a failed command must
 * leave the existing status intact.
 */
export async function transitionPlanStatus(
  db: PlanStatusRpcClient,
  input: {
    planId: string
    expectedStatus: PlanStatus
    toStatus: PlanStatus
    trigger: PlanStatusTransitionTrigger
    actorId: string
    context?: Json
  }
): Promise<Plan> {
  const { data, error } = await db.rpc('transition_plan_status', {
    p_plan_id: input.planId,
    p_expected_status: input.expectedStatus,
    p_to_status: input.toStatus,
    p_trigger: input.trigger,
    p_actor_id: input.actorId,
    p_context: input.context ?? {},
  })

  if (error) throw new PlanStatusTransitionError(error)

  const candidate = unwrapPlan(data)
  if (!candidate) {
    throw new PlanStatusTransitionError({
      code: 'invalid_transition_response',
      message: 'Plan status transition returned no plan record',
    })
  }

  return candidate
}

function unwrapPlan(data: unknown): Plan | null {
  const value = Array.isArray(data) ? data[0] : data
  if (!isRecord(value)) return null

  const nested = isRecord(value.plan_record) ? value.plan_record : value
  if (typeof nested.id !== 'string' || typeof nested.status !== 'string') return null

  return nested as unknown as Plan
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
