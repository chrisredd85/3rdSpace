export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AGENT_ACTION_EXECUTION_SELECT_COLUMNS } from '@/lib/planner/execution/executeApprovedAction'
import { recordPlannerPaymentAuthenticationState } from '@/lib/planner/paymentAuthenticationState'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { AgentAction } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }

const authenticationOutcomeSchema = z.object({
  approvalId: z.string().uuid(),
  outcome: z.enum(['failed', 'abandoned']),
}).strict()

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
    const { data: plan, error: planError } = await admin
      .from('plans')
      .select('id, user_id')
      .eq('id', planId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (planError) throw new Error(planError.message)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const { data: approval, error: approvalError } = await admin
      .from('approvals')
      .select('id, agent_action_id')
      .eq('id', parsed.data.approvalId)
      .eq('plan_id', planId)
      .maybeSingle()
    if (approvalError) throw new Error(approvalError.message)
    if (!approval) return NextResponse.json({ error: 'Approval not found' }, { status: 404 })

    const { data: action, error: actionError } = await admin
      .from('agent_actions')
      .select(AGENT_ACTION_EXECUTION_SELECT_COLUMNS)
      .eq('id', approval.agent_action_id)
      .eq('plan_id', planId)
      .maybeSingle()
    if (actionError) throw new Error(actionError.message)
    if (!action) return NextResponse.json({ error: 'Payment action not found' }, { status: 404 })
    if (action.action_type !== 'payment' || action.approval_id !== approval.id) {
      return NextResponse.json({ error: 'Approval is not linked to a controlled payment action' }, { status: 422 })
    }

    const { data: paymentIntent, error: paymentIntentError } = await admin
      .from('payment_intents')
      .select('id, stripe_payment_intent_id')
      .eq('approval_id', approval.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (paymentIntentError) throw new Error(paymentIntentError.message)

    await recordPlannerPaymentAuthenticationState({
      db: admin,
      action: action as AgentAction,
      actorId: user.id,
      state: 'retry_allowed',
      paymentIntentId: paymentIntent?.id ?? null,
      outcome: parsed.data.outcome,
    })

    return NextResponse.json({
      status: 'retry_allowed',
      outcome: parsed.data.outcome,
    })
  } catch (error) {
    console.error('[planner.payment.authentication] Failed to record SCA outcome', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to update payment verification state' },
      { status: 500 }
    )
  }
}
