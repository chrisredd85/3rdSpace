export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { APPROVAL_SELECT_COLUMNS, PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import {
  authorizePlannerDeposit,
  PlannerDepositAccountBlockedError,
  PlannerDepositAuthorizationFailedError,
  PlannerDepositAuthorizationPendingError,
  PlannerDepositCustomerActionRequiredError,
  PlannerDepositPaymentMethodRequiredError,
  PlannerDepositReservationConflictError,
  type PlannerPaymentIntentRow,
} from '@/lib/planner/depositPayments'
import {
  assertIntegerCents,
  type AgentActionTransitionEvent,
} from '@/lib/planner/execution/approvalState'
import {
  AGENT_ACTION_EXECUTION_SELECT_COLUMNS,
  paymentAuthorizationTransitionEvents,
  persistAgentActionTransitionEvents,
} from '@/lib/planner/execution/executeApprovedAction'
import { isPaymentApprovalExpired } from '@/lib/planner/execution/paymentApproval'
import { approvalRequiresReapproval } from '@/lib/planner/execution/reapproval'
import {
  assertPlannerPartnerStripeReady,
  PlannerPartnerStripeReadinessUnavailableError,
} from '@/lib/planner/partnerStripeReadiness'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { AgentAction, Approval, Json, Plan, PlannerApiErrorResponse } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }

interface RouteContext {
  params: Promise<{
    planId: string
  }>
}

interface PlannerDepositActionRequiredResponse {
  paymentIntent: PlannerPaymentIntentRow
  requires_action: true
  stripe_status: 'requires_action' | 'requires_confirmation'
  client_secret: string
  next_action: Json | null
}

const authorizeDepositSchema = z.object({
  approvalId: z.string().uuid(),
  partnerKind: z.enum(['venue', 'vendor']),
  partnerId: z.string().uuid(),
  amountCents: z.number().int().min(50).refine(Number.isSafeInteger),
  paymentMethodId: z.string().trim().min(1).nullable().optional(),
  refundTerms: z.string().trim().max(1000).nullable().optional(),
  platformFeeCents: z.number().int().nonnegative().refine(Number.isSafeInteger).nullable().optional(),
}).strict()

/**
 * Creates a planner deposit authorization after the related approval is authorized.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse<
  { paymentIntent: Awaited<ReturnType<typeof authorizePlannerDeposit>> } |
  PlannerDepositActionRequiredResponse |
  PlannerApiErrorResponse
>> {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    if (user.user_metadata?.user_type !== 'community_builder') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const parsed = authorizeDepositSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const admin = createServiceRoleClient() as unknown as PlannerDb
    const plan = await loadOwnedPlan(admin, (await context.params).planId, user.id)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const approval = await loadPlanApproval(admin, (await context.params).planId, parsed.data.approvalId)
    if (!approval) return NextResponse.json({ error: 'Approval not found' }, { status: 404 })

    if (approval.status !== 'authorized' && approval.status !== 'approved') {
      return NextResponse.json({ error: 'Authorize the approval before authorizing a deposit' }, { status: 422 })
    }
    if (isPaymentApprovalExpired(approval.expires_at)) {
      return NextResponse.json(
        { error: 'Approval expired. Review the latest terms and approve again.' },
        { status: 409 }
      )
    }

    const action = await loadAgentAction(admin, approval.agent_action_id)
    if (!action) return NextResponse.json({ error: 'Linked approval action not found' }, { status: 422 })
    let actionTransitionEvents: AgentActionTransitionEvent[] = []
    try {
      actionTransitionEvents = paymentAuthorizationTransitionEvents(action.status)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Payment action cannot be authorized' },
        { status: 422 }
      )
    }

    if (approvalRequiresReapproval({ plan, approval, action, storedSnapshotHash: approval.snapshot_hash })) {
      return NextResponse.json(
        { error: 'Approval details changed. Review the latest payment terms and approve again.' },
        { status: 409 }
      )
    }

    const amountCents = assertIntegerCents(parsed.data.amountCents, 'amountCents', 50)
    const platformFeeCents = assertIntegerCents(approval.fees_cents ?? 0, 'approval.fees_cents')
    if (
      parsed.data.platformFeeCents != null &&
      parsed.data.platformFeeCents !== platformFeeCents
    ) {
      return NextResponse.json(
        { error: 'Platform fee changed after approval. Review and approve the updated fee before authorizing.' },
        { status: 409 }
      )
    }
    const approvedAmountCents = approval.authorized_amount_cents ?? approval.requested_amount_cents ?? approval.price_cents ?? 0
    if (amountCents !== approvedAmountCents) {
      return NextResponse.json(
        { error: 'Payment amount changed after approval. Review and approve the updated amount before authorizing.' },
        { status: 409 }
      )
    }

    if (
      action.target_type !== parsed.data.partnerKind ||
      action.target_id !== parsed.data.partnerId
    ) {
      return NextResponse.json(
        { error: 'Payment partner changed after approval. Review and approve the updated partner before authorizing.' },
        { status: 409 }
      )
    }

    if (
      parsed.data.refundTerms !== undefined &&
      parsed.data.refundTerms !== approval.refund_terms
    ) {
      return NextResponse.json(
        { error: 'Refund terms changed after approval. Review and approve the updated terms before authorizing.' },
        { status: 409 }
      )
    }

    const requestedPaymentMethodId = parsed.data.paymentMethodId?.trim() || null
    const approvedPaymentMethodId = approval.payment_method_id?.trim() || null
    if (
      requestedPaymentMethodId &&
      approvedPaymentMethodId &&
      requestedPaymentMethodId !== approvedPaymentMethodId
    ) {
      return NextResponse.json(
        { error: 'Payment method changed after approval. Review and approve the updated payment method before authorizing.' },
        { status: 409 }
      )
    }
    const paymentMethodId = requestedPaymentMethodId || approvedPaymentMethodId
    if (!paymentMethodId) {
      return NextResponse.json(
        { error: 'A payment method is required to authorize this deposit.' },
        { status: 422 }
      )
    }

    await assertPlannerPartnerStripeReady({
      db: admin,
      partnerKind: parsed.data.partnerKind,
      partnerId: parsed.data.partnerId,
      eventId: `planner_authorize_${approval.id}`,
    })

    const paymentIntent = await authorizePlannerDeposit({
      db: admin,
      plan,
      approval,
      userId: user.id,
      partnerKind: parsed.data.partnerKind,
      partnerId: parsed.data.partnerId,
      amountCents,
      paymentMethodId,
      refundTerms: approval.refund_terms,
      platformFeeCents,
    })

    await persistAgentActionTransitionEvents(admin, {
      action,
      actorId: user.id,
      events: actionTransitionEvents,
      reason: 'payment.authorization_recorded',
      metadata: {
        payment_intent_id: paymentIntent.id,
        payment_status: paymentIntent.status,
        explicit_payment_authorization: true,
      },
    })

    return NextResponse.json({ paymentIntent })
  } catch (error) {
    if (error instanceof PlannerDepositCustomerActionRequiredError) {
      return NextResponse.json({
        paymentIntent: error.paymentIntent,
        requires_action: true,
        stripe_status: error.stripeStatus,
        client_secret: error.clientSecret,
        next_action: (error.nextAction ?? null) as Json | null,
      })
    }
    console.error('Planner deposit authorize error:', error)
    if (
      error instanceof PlannerDepositPaymentMethodRequiredError ||
      error instanceof PlannerDepositAuthorizationFailedError
    ) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 422 }
      )
    }
    if (
      error instanceof PlannerDepositAuthorizationPendingError ||
      error instanceof PlannerDepositReservationConflictError ||
      error instanceof PlannerDepositAccountBlockedError
    ) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 }
      )
    }
    if (error instanceof PlannerPartnerStripeReadinessUnavailableError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 503 }
      )
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to authorize deposit' },
      { status: 500 }
    )
  }
}

async function loadOwnedPlan(db: PlannerDb, planId: string, userId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as Plan | null) ?? null
}

async function loadPlanApproval(db: PlannerDb, planId: string, approvalId: string): Promise<Approval | null> {
  const { data, error } = await db
    .from('approvals')
    .select(APPROVAL_SELECT_COLUMNS)
    .eq('id', approvalId)
    .eq('plan_id', planId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as Approval | null) ?? null
}

async function loadAgentAction(db: PlannerDb, actionId: string): Promise<AgentAction | null> {
  const { data, error } = await db
    .from('agent_actions')
    .select(AGENT_ACTION_EXECUTION_SELECT_COLUMNS)
    .eq('id', actionId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as AgentAction | null) ?? null
}
