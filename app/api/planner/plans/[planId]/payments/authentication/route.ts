export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AGENT_ACTION_EXECUTION_SELECT_COLUMNS } from '@/lib/planner/execution/executeApprovedAction'
import { isPaymentApprovalExpired } from '@/lib/planner/execution/paymentApproval'
import {
  derivePlannerPaymentAuthenticationSnapshot,
  PlannerPaymentAuthenticationConflictError,
  recordPlannerPaymentAuthenticationState,
} from '@/lib/planner/paymentAuthenticationState'
import { getStripeClient } from '@/lib/stripe/connect'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { AgentAction } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }

const authenticationOutcomeSchema = z.object({
  approvalId: z.string().uuid(),
  outcome: z.enum(['failed', 'abandoned']),
}).strict()

const authenticationSnapshotSchema = z.object({
  approvalId: z.string().uuid(),
})

/**
 * Hydrates durable SCA/payment state after a planner refresh. This endpoint
 * never captures money and never returns a Stripe client secret; continuing an
 * SCA attempt still goes through the explicit authorize action.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> }
) {
  try {
    const parsed = authenticationSnapshotSchema.safeParse({
      approvalId: request.nextUrl.searchParams.get('approvalId'),
    })
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid approval id' }, { status: 400 })
    }

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

    const { planId } = await context.params
    const admin = createServiceRoleClient() as unknown as PlannerDb
    const owned = await loadOwnedPaymentAction(admin, {
      planId,
      approvalId: parsed.data.approvalId,
      userId: user.id,
    })
    if (owned.error) {
      return NextResponse.json({ error: owned.error }, { status: owned.status })
    }

    const { data: paymentIntent, error: paymentIntentError } = await admin
      .from('payment_intents')
      .select('id, status, stripe_payment_method_id')
      .eq('approval_id', parsed.data.approvalId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (paymentIntentError) throw new Error(paymentIntentError.message)

    return NextResponse.json(
      derivePlannerPaymentAuthenticationSnapshot({
        action: owned.action!,
        paymentIntent,
      })
    )
  } catch (error) {
    console.error('[planner.payment.authentication] Failed to hydrate SCA state', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load payment verification state' },
      { status: 500 }
    )
  }
}

/**
 * Clears an incomplete organizer SCA attempt without failing or executing the
 * approved payment action. A later explicit retry reuses Stripe/local
 * idempotency and remains behind the organizer's capture confirmation.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> }
) {
  try {
    const parsed = authenticationOutcomeSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

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

    const { planId } = await context.params
    const admin = createServiceRoleClient() as unknown as PlannerDb
    const owned = await loadOwnedPaymentAction(admin, {
      planId,
      approvalId: parsed.data.approvalId,
      userId: user.id,
    })
    if (owned.error) {
      return NextResponse.json({ error: owned.error }, { status: owned.status })
    }
    if (!owned.action || !owned.approval) {
      return NextResponse.json({ error: 'Payment action not found' }, { status: 404 })
    }
    const { action, approval } = owned
    if (
      (approval.status !== 'approved' && approval.status !== 'authorized') ||
      approval.superseded_at ||
      isPaymentApprovalExpired(approval.expires_at)
    ) {
      return NextResponse.json(
        { error: 'This payment approval is no longer eligible for authentication updates.' },
        { status: 409 }
      )
    }

    const { data: paymentIntent, error: paymentIntentError } = await admin
      .from('payment_intents')
      .select('id, status, stripe_payment_intent_id')
      .eq('approval_id', approval.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (paymentIntentError) throw new Error(paymentIntentError.message)
    if (
      !paymentIntent?.id ||
      !paymentIntent.stripe_payment_intent_id ||
      !['pending', 'requested'].includes(paymentIntent.status)
    ) {
      return NextResponse.json(
        { error: 'No active authentication attempt matches this approval.' },
        { status: 409 }
      )
    }

    const authenticationAttempt = readAuthenticationAttempt(action.result_metadata)
    if (
      authenticationAttempt?.status !== 'awaiting_authentication' ||
      authenticationAttempt.paymentIntentId !== paymentIntent.id
    ) {
      return NextResponse.json(
        { error: 'Payment authentication state changed. Refresh before retrying.' },
        { status: 409 }
      )
    }

    let stripePaymentIntent: {
      status: string
      last_payment_error?: { message?: string | null } | null
      cancellation_reason?: string | null
    }
    try {
      stripePaymentIntent = await getStripeClient().paymentIntents.retrieve(
        paymentIntent.stripe_payment_intent_id
      )
    } catch (stripeError) {
      console.error('[planner.payment.authentication] Stripe truth unavailable', stripeError)
      return NextResponse.json(
        { error: 'Stripe authentication state could not be verified. Retry safely.' },
        { status: 503 }
      )
    }
    const stripeStatus = stripePaymentIntent.status
    const canRetryCurrentAttempt =
      stripeStatus === 'requires_action' || stripeStatus === 'requires_confirmation'
    const mustStartNewAttempt =
      stripeStatus === 'requires_payment_method' || stripeStatus === 'canceled'
    if (!canRetryCurrentAttempt && !mustStartNewAttempt) {
      return NextResponse.json(
        { error: 'Stripe authentication state changed. Refresh before retrying.' },
        { status: 409 }
      )
    }

    if (mustStartNewAttempt) {
      await failTerminalAuthenticationAttempt(admin, {
        id: paymentIntent.id,
        approvalId: approval.id,
        stripePaymentIntentId: paymentIntent.stripe_payment_intent_id,
        failureReason:
          stripePaymentIntent.last_payment_error?.message ??
          (stripeStatus === 'canceled'
            ? `Stripe PaymentIntent was canceled${
                stripePaymentIntent.cancellation_reason
                  ? ` (${stripePaymentIntent.cancellation_reason})`
                  : ''
              } before capture.`
            : 'Stripe authentication failed and requires a new payment method.'),
      })
    }

    const outcome = stripeStatus === 'requires_payment_method'
      ? 'failed'
      : parsed.data.outcome

    await recordPlannerPaymentAuthenticationState({
      db: admin,
      action,
      actorId: user.id,
      state: 'retry_allowed',
      paymentIntentId: paymentIntent.id,
      stripeStatus,
      outcome,
      expectedAuthentication: {
        state: 'awaiting_authentication',
        paymentIntentId: paymentIntent.id,
      },
    })

    return NextResponse.json({
      status: 'retry_allowed',
      outcome,
    })
  } catch (error) {
    if (error instanceof PlannerPaymentAuthenticationConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('[planner.payment.authentication] Failed to record SCA outcome', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to update payment verification state' },
      { status: 500 }
    )
  }
}

async function failTerminalAuthenticationAttempt(
  db: PlannerDb,
  input: {
    id: string
    approvalId: string
    stripePaymentIntentId: string
    failureReason: string
  }
) {
  const { data, error } = await db
    .from('payment_intents')
    .update({
      status: 'failed',
      failure_reason: input.failureReason,
    })
    .eq('id', input.id)
    .eq('approval_id', input.approvalId)
    .eq('stripe_payment_intent_id', input.stripePaymentIntentId)
    .in('status', ['pending', 'requested'])
    .select('id')
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to release terminal Stripe authentication attempt: ${error.message}`)
  }
  if (!data) {
    throw new PlannerPaymentAuthenticationConflictError()
  }
}

async function loadOwnedPaymentAction(
  db: PlannerDb,
  input: { planId: string; approvalId: string; userId: string }
): Promise<
  | {
      action: AgentAction
      approval: {
        id: string
        status: string
        expires_at: string | null
        superseded_at: string | null
      }
      error: null
      status: 200
    }
  | { action: null; approval: null; error: string; status: 404 | 422 }
> {
  const { data: plan, error: planError } = await db
    .from('plans')
    .select('id, user_id')
    .eq('id', input.planId)
    .eq('user_id', input.userId)
    .maybeSingle()
  if (planError) throw new Error(planError.message)
  if (!plan) return { action: null, approval: null, error: 'Plan not found', status: 404 }

  const { data: approval, error: approvalError } = await db
    .from('approvals')
    .select('id, agent_action_id, status, expires_at, superseded_at')
    .eq('id', input.approvalId)
    .eq('plan_id', input.planId)
    .maybeSingle()
  if (approvalError) throw new Error(approvalError.message)
  if (!approval) return { action: null, approval: null, error: 'Approval not found', status: 404 }

  const { data: action, error: actionError } = await db
    .from('agent_actions')
    .select(AGENT_ACTION_EXECUTION_SELECT_COLUMNS)
    .eq('id', approval.agent_action_id)
    .eq('plan_id', input.planId)
    .maybeSingle()
  if (actionError) throw new Error(actionError.message)
  if (!action) return { action: null, approval: null, error: 'Payment action not found', status: 404 }
  if (action.action_type !== 'payment' || action.approval_id !== approval.id) {
    return {
      action: null,
      approval: null,
      error: 'Approval is not linked to a controlled payment action',
      status: 422,
    }
  }

  return {
    action: action as AgentAction,
    approval: {
      id: String(approval.id),
      status: String(approval.status),
      expires_at: typeof approval.expires_at === 'string' ? approval.expires_at : null,
      superseded_at: typeof approval.superseded_at === 'string' ? approval.superseded_at : null,
    },
    error: null,
    status: 200,
  }
}

function readAuthenticationAttempt(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const authentication = (value as Record<string, unknown>).payment_authentication
  if (!authentication || typeof authentication !== 'object' || Array.isArray(authentication)) return null
  const record = authentication as Record<string, unknown>
  return {
    status: typeof record.status === 'string' ? record.status : null,
    paymentIntentId:
      typeof record.payment_intent_id === 'string' ? record.payment_intent_id : null,
  }
}
