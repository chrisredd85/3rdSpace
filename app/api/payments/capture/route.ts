export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  capturePlannerDeposit,
  PAYMENT_INTENT_SELECT_COLUMNS,
  type PlannerPaymentIntentRow,
} from '@/lib/planner/depositPayments'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { Approval, Json, PlannerApiErrorResponse } from '@/lib/types'

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
    const paymentIntent = await loadOwnedPaymentIntent(admin, parsed.data.paymentIntentId, user.id)
    if (!paymentIntent) return NextResponse.json({ error: 'Payment intent not found' }, { status: 404 })

    if (paymentIntent.approval_id !== parsed.data.approvalId) {
      return NextResponse.json({ error: 'Approval does not match payment intent' }, { status: 422 })
    }

    const approval = await loadApproval(admin, parsed.data.approvalId, paymentIntent.plan_id)
    if (!approval) return NextResponse.json({ error: 'Approval not found' }, { status: 404 })
    if (approval.status !== 'authorized' && approval.status !== 'approved') {
      return NextResponse.json({ error: 'Approval must be authorized before capture' }, { status: 422 })
    }

    const captured = await capturePlannerDeposit({
      db: admin,
      paymentIntent,
      approval,
      explicitUserConfirmation: parsed.data.explicitUserConfirmation,
    })

    return NextResponse.json({ paymentIntent: captured })
  } catch (error) {
    console.error('Planner deposit capture error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to capture deposit' },
      { status: 500 }
    )
  }
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
