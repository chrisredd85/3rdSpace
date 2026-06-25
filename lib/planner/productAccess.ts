import 'server-only'

import {
  BuilderBillingRequiredError,
  consumeBuilderEventAccess,
  getBuilderBillingSummary,
  loadBuilderBillingProfileByUserId,
  type BuilderBillingProfile,
} from '@/lib/billing/builder-billing'
import { PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { Json, Plan } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }

export class PlannerProductAccessRequiredError extends Error {
  status = 402

  constructor(
    message: string,
    public billing: ReturnType<typeof getBuilderBillingSummary>
  ) {
    super(message)
    this.name = 'PlannerProductAccessRequiredError'
  }
}

export class PlannerProductAccessActivationError extends Error {
  status = 500

  constructor(message = 'Failed to activate planner access') {
    super(message)
    this.name = 'PlannerProductAccessActivationError'
  }
}

export async function ensurePlannerEventAccess(params: {
  plan: Plan
  userId: string
  reason: 'approval' | 'outreach_started' | 'date_change_started'
}): Promise<Plan> {
  const existingMetadata = readRecord(params.plan.metadata) ?? {}
  const productGate = readRecord(existingMetadata.product_gate)
  if (productGate?.event_access_consumed_at) return params.plan

  const admin = createServiceRoleClient()
  const adminDb = admin as unknown as PlannerDb
  const { data: builder, error } = await loadBuilderBillingProfileByUserId(admin, params.userId)

  if (error) {
    console.error('[planner.product-access] Failed to load builder billing profile', error)
    throw new PlannerProductAccessActivationError('Failed to verify product access')
  }

  if (!builder) {
    throw new PlannerProductAccessActivationError('Builder profile not found')
  }

  const billing = getBuilderBillingSummary(builder as BuilderBillingProfile)

  try {
    const consumed = await consumeBuilderEventAccess({
      admin,
      builder: builder as BuilderBillingProfile,
      eventId: params.plan.id,
    })
    const metadata = {
      ...existingMetadata,
      product_gate: {
        ...productGate,
        event_access_consumed_at: new Date().toISOString(),
        event_access_source: consumed.source,
        event_access_amount: consumed.amount,
        event_access_reason: params.reason,
      },
    }

    const { data: updatedPlan, error: updateError } = await adminDb
      .from('plans')
      .update({ metadata: metadata as Json })
      .eq('id', params.plan.id)
      .eq('user_id', params.userId)
      .select(PLAN_SELECT_COLUMNS)
      .maybeSingle()

    if (updateError) {
      console.error('[planner.product-access] Failed to mark product access consumed', updateError)
      throw new PlannerProductAccessActivationError()
    }

    return (updatedPlan as Plan | null) ?? { ...params.plan, metadata: metadata as Json }
  } catch (error) {
    if (error instanceof BuilderBillingRequiredError) {
      throw new PlannerProductAccessRequiredError(
        'Choose pay-per-event or Pro to continue planning this event.',
        billing
      )
    }

    if (error instanceof PlannerProductAccessActivationError) {
      throw error
    }

    console.error('[planner.product-access] Failed to consume planner event access', error)
    throw new PlannerProductAccessActivationError()
  }
}

export function productAccessErrorResponse(error: PlannerProductAccessRequiredError) {
  return {
    error: error.message,
    billingRequired: true,
    billing: error.billing,
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
