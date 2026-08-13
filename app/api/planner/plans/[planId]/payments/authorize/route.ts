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
import { validateExecutableApprovalEvidence } from '@/lib/planner/execution/paymentApproval'
import {
  assertBuilderPaymentMethodOwnership,
  BuilderPaymentMethodFlowError,
} from '@/lib/planner/builderPaymentMethods'
import { recordPlannerPaymentAuthenticationState } from '@/lib/planner/paymentAuthenticationState'
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
  partnerKind: z.enum(['venue', 'vendor']).optional(),
  partnerId: z.string().uuid().optional(),
  amountCents: z.number().int().min(50).refine(Number.isSafeInteger).optional(),
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
    const approvalEvidence = validateExecutableApprovalEvidence(approval)
    if (!approvalEvidence.ok) {
      return NextResponse.json(
        { error: approvalEvidence.error },
        { status: approvalEvidence.status }
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

    const approvedAmountCents = approval.authorized_amount_cents ?? approval.requested_amount_cents ?? approval.price_cents ?? 0
    const amountCents = assertIntegerCents(approvedAmountCents, 'approval.authorized_amount_cents', 50)
    const platformFeeCents = assertIntegerCents(approval.fees_cents ?? 0, 'approval.fees_cents')
    if (parsed.data.amountCents != null && parsed.data.amountCents !== amountCents) {
      return NextResponse.json(
        { error: 'Payment amount changed after approval. Review and approve the updated amount before authorizing.' },
        { status: 409 }
      )
    }
    if (
      parsed.data.platformFeeCents != null &&
      parsed.data.platformFeeCents !== platformFeeCents
    ) {
      return NextResponse.json(
        { error: 'Platform fee changed after approval. Review and approve the updated fee before authorizing.' },
        { status: 409 }
      )
    }
    if (action.action_type !== 'payment') {
      return NextResponse.json(
        { error: 'Linked approval is not a controlled payment action.' },
        { status: 422 }
      )
    }
    if (
      (action.target_type !== 'venue' && action.target_type !== 'vendor') ||
      !action.target_id
    ) {
      return NextResponse.json(
        { error: 'Controlled payment action is missing a venue or vendor target.' },
        { status: 422 }
      )
    }
    const partnerKind = action.target_type
    const partnerId = action.target_id
    if (
      (parsed.data.partnerKind && parsed.data.partnerKind !== partnerKind) ||
      (parsed.data.partnerId && parsed.data.partnerId !== partnerId)
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

    const { data: builder, error: builderError } = await admin
      .from('builder_profiles')
      .select('id, stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (builderError) throw new Error(builderError.message)

    const customerId = typeof builder?.stripe_customer_id === 'string'
      ? builder.stripe_customer_id.trim()
      : ''
    if (!builder?.id || !customerId) {
      return NextResponse.json(
        {
          error: 'This payment method is not attached to the authenticated organizer.',
          code: 'builder_payment_method_forbidden',
        },
        { status: 403 }
      )
    }

    await assertBuilderPaymentMethodOwnership({
      customerId,
      paymentMethodId,
    })

    await assertPlannerPartnerStripeReady({
      db: admin,
      partnerKind,
      partnerId,
      eventId: `planner_authorize_${approval.id}`,
    })

    let paymentIntent: PlannerPaymentIntentRow
    try {
      paymentIntent = await authorizePlannerDeposit({
        db: admin,
        plan,
        approval,
        userId: user.id,
        customerId,
        partnerKind,
        partnerId,
        amountCents,
        paymentMethodId,
        refundTerms: approval.refund_terms,
        platformFeeCents,
      })
    } catch (error) {
      if (error instanceof PlannerDepositCustomerActionRequiredError) {
        await recordPlannerPaymentAuthenticationState({
          db: admin,
          action,
          actorId: user.id,
          state: 'awaiting_authentication',
          paymentIntentId: error.paymentIntent.id,
          stripeStatus: error.stripeStatus,
        })
        return NextResponse.json({
          paymentIntent: error.paymentIntent,
          requires_action: true,
          stripe_status: error.stripeStatus,
          client_secret: error.clientSecret,
          next_action: (error.nextAction ?? null) as Json | null,
        })
      }
      throw error
    }

    await persistAgentActionTransitionEvents(admin, {
      action,
      actorId: user.id,
      events: actionTransitionEvents,
      reason: 'payment.authorization_recorded',
      metadata: {
        payment_intent_id: paymentIntent.id,
        payment_status: paymentIntent.status,
        explicit_payment_authorization: true,
        payment_authentication: {
          status: 'authenticated',
          payment_intent_id: paymentIntent.id,
          stripe_status: 'requires_capture',
          outcome: 'succeeded',
          updated_at: new Date().toISOString(),
        },
      },
    })

    return NextResponse.json({ paymentIntent })
  } catch (error) {
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
    if (error instanceof BuilderPaymentMethodFlowError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
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
