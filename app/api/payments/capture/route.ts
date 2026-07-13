export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  capturePlannerDeposit,
  PaymentCaptureAlreadyInProgressError,
  PAYMENT_INTENT_SELECT_COLUMNS,
  PlannerDepositAccountBlockedError,
  PlannerDepositCaptureFailedError,
  PlannerDepositNotFundedError,
  type PlannerPaymentIntentRow,
} from '@/lib/planner/depositPayments'
import { reconcilePlannerDepositTerminalEffects } from '@/lib/planner/depositCaptureEffects'
import { PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import {
  AGENT_ACTION_EXECUTION_SELECT_COLUMNS,
  paymentCaptureTransitionEvents,
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

const captureDepositSchema = z.object({
  paymentIntentId: z.string().uuid(),
  approvalId: z.string().uuid(),
  explicitUserConfirmation: z.literal(true),
}).strict()

const APPROVAL_CAPTURE_SELECT = `
  id,
  plan_id,
  agent_action_id,
  action_label,
  provider,
  event_date,
  price_cents,
  fees_cents,
  refund_terms,
  cancellation_terms,
  package_details,
  delivery_email,
  payment_method_id,
  status,
  requested_amount_cents,
  authorized_amount_cents,
  authorized_by,
  authorized_at,
  approved_by,
  approved_at,
  expires_at,
  snapshot_hash,
  created_at,
  updated_at
`

/**
 * Captures a planner deposit only after approval authorization and explicit user click.
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<{ paymentIntent: PlannerPaymentIntentRow } | PlannerApiErrorResponse>> {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const parsed = captureDepositSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() as Json },
        { status: 400 }
      )
    }

    const admin = createServiceRoleClient() as unknown as PlannerDb
    let paymentIntent = await loadOwnedPaymentIntent(admin, parsed.data.paymentIntentId, user.id)
    if (!paymentIntent) return NextResponse.json({ error: 'Payment intent not found' }, { status: 404 })

    if (paymentIntent.approval_id !== parsed.data.approvalId) {
      return NextResponse.json({ error: 'Approval does not match payment intent' }, { status: 422 })
    }

    const approval = await loadApproval(admin, parsed.data.approvalId, paymentIntent.plan_id)
    if (!approval) return NextResponse.json({ error: 'Approval not found' }, { status: 404 })
    if (approval.status !== 'authorized' && approval.status !== 'approved') {
      return NextResponse.json({ error: 'Approval must be authorized before capture' }, { status: 422 })
    }
    if (isPaymentApprovalExpired(approval.expires_at)) {
      return NextResponse.json(
        { error: 'Approval expired. Review the latest terms and approve again.' },
        { status: 409 }
      )
    }

    const plan = await loadPlan(admin, paymentIntent.plan_id)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const action = await loadAgentAction(admin, approval.agent_action_id)
    if (!action) return NextResponse.json({ error: 'Linked approval action not found' }, { status: 422 })
    try {
      paymentCaptureTransitionEvents(action.status)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Payment action cannot be captured' },
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
    if (paymentIntent.amount_cents !== approvedAmountCents) {
      return NextResponse.json(
        { error: 'Payment amount changed after approval. Review and approve the updated amount before capture.' },
        { status: 409 }
      )
    }

    await assertPlannerPartnerStripeReady({
      db: admin,
      partnerKind: paymentIntent.partner_kind,
      partnerId: paymentIntent.partner_id,
      eventId: `planner_capture_${paymentIntent.id}`,
    })
    const refreshedPaymentIntent = await loadOwnedPaymentIntent(
      admin,
      paymentIntent.id,
      user.id
    )
    if (!refreshedPaymentIntent) {
      return NextResponse.json({ error: 'Payment intent not found' }, { status: 404 })
    }
    paymentIntent = refreshedPaymentIntent

    const captured = await capturePlannerDeposit({
      db: admin,
      paymentIntent,
      approval,
      explicitUserConfirmation: parsed.data.explicitUserConfirmation,
    })

    const effects = await reconcilePlannerDepositTerminalEffects({
      db: admin,
      paymentIntent: captured,
      actorId: user.id,
      actorRole: 'user',
      reason: 'payment.capture_completed',
      metadata: { explicit_user_confirmation: true },
    })
    if (effects.outcome !== 'completed') {
      throw new PaymentCaptureAlreadyInProgressError(
        'Payment was captured and its local effects are still being finalized.'
      )
    }

    return NextResponse.json({ paymentIntent: effects.paymentIntent })
  } catch (error) {
    if (error instanceof PaymentCaptureAlreadyInProgressError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 }
      )
    }

    if (error instanceof PlannerDepositAccountBlockedError) {
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

    if (error instanceof PlannerDepositCaptureFailedError) {
      try {
        await reconcileFailedCaptureEffects(error.paymentIntent)
      } catch (recoveryError) {
        console.error('Planner deposit capture failure action recovery error:', recoveryError)
      }
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 422 }
      )
    }

    if (error instanceof PlannerDepositNotFundedError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 422 }
      )
    }

    console.error('Planner deposit capture error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to capture deposit' },
      { status: 500 }
    )
  }
}

async function reconcileFailedCaptureEffects(
  paymentIntent: PlannerPaymentIntentRow
) {
  const admin = createServiceRoleClient() as unknown as PlannerDb
  await reconcilePlannerDepositTerminalEffects({
    db: admin,
    paymentIntent,
    actorId: null,
    actorRole: 'system',
    reason: 'payment.capture_failed',
  })
}

async function loadOwnedPaymentIntent(
  db: PlannerDb,
  paymentIntentId: string,
  userId: string
): Promise<PlannerPaymentIntentRow | null> {
  const { data, error } = await db
    .from('payment_intents')
    .select(`${PAYMENT_INTENT_SELECT_COLUMNS}, plans!inner(user_id)`)
    .eq('id', paymentIntentId)
    .eq('plans.user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as PlannerPaymentIntentRow | null) ?? null
}

async function loadApproval(db: PlannerDb, approvalId: string, planId: string): Promise<Approval | null> {
  const { data, error } = await db
    .from('approvals')
    .select(APPROVAL_CAPTURE_SELECT)
    .eq('id', approvalId)
    .eq('plan_id', planId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as Approval | null) ?? null
}

async function loadPlan(db: PlannerDb, planId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', planId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as Plan | null) ?? null
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
