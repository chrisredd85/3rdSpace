export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { assertIntegerCents } from '@/lib/planner/execution/approvalState'
import { getWorkerOrAdminContext } from '@/lib/server/admin-auth'
import { createServiceRoleClient } from '@/lib/supabase/server'

type PlannerDb = { from: (table: string) => any }

type CapturedPaymentIntent = {
  id: string
  plan_id: string
  partner_kind: 'venue' | 'vendor'
  partner_id: string
  amount_cents: number
  platform_fee_cents: number
  currency: string
}

type CapturedPaymentIntentWithPayoutJoin = CapturedPaymentIntent & {
  payouts?: Array<{ id: string }> | null
}

const PAYMENT_INTENT_SELECT = `
  id,
  plan_id,
  partner_kind,
  partner_id,
  amount_cents,
  platform_fee_cents,
  currency,
  payouts!left(id)
`

/**
 * Reconciles Stripe captures that succeeded after the local payout insert failed.
 *
 * This endpoint intentionally only inserts missing payout rows for already-captured
 * planner deposits. It never captures money and never changes approval state.
 */
export async function POST(request: NextRequest) {
  const context = await getWorkerOrAdminContext(request)
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const admin = createServiceRoleClient() as unknown as PlannerDb
  const candidates = await loadCapturedDepositCandidates(admin)
  const errors: Array<{ payment_intent_id: string; error: string }> = []
  let reconciled = 0

  for (const intent of candidates) {
    try {
      const amountCents = assertIntegerCents(intent.amount_cents, 'amount_cents')
      const platformFeeCents = assertIntegerCents(intent.platform_fee_cents ?? 0, 'platform_fee_cents')
      const payoutAmountCents = Math.max(0, amountCents - platformFeeCents)
      await insertMissingPayout(admin, intent, payoutAmountCents)
      reconciled += 1
      Sentry.captureMessage('capture_reconciled', {
        level: 'info',
        tags: {
          action: 'capture_reconciled',
          plan_id: intent.plan_id,
          payment_intent_id: intent.id,
        },
        extra: {
          amount_cents: amountCents,
          platform_fee_cents: platformFeeCents,
          payout_amount_cents: payoutAmountCents,
        },
      })
    } catch (error) {
      errors.push({
        payment_intent_id: intent.id,
        error: error instanceof Error ? error.message : 'Unknown reconciliation error',
      })
    }
  }

  return NextResponse.json({ reconciled, errors })
}

export async function GET(request: NextRequest) {
  return POST(request)
}

async function loadCapturedDepositCandidates(db: PlannerDb): Promise<CapturedPaymentIntent[]> {
  const { data, error } = await db
    .from('payment_intents')
    .select(PAYMENT_INTENT_SELECT)
    .eq('status', 'captured')
    .is('payouts.id', null)
    .order('captured_at', { ascending: true, nullsFirst: true })
    .limit(100)

  if (error) throw new Error(error.message ?? 'Failed to load captured payment intents')
  return ((data ?? []) as CapturedPaymentIntentWithPayoutJoin[]).map((row) => ({
    id: row.id,
    plan_id: row.plan_id,
    partner_kind: row.partner_kind,
    partner_id: row.partner_id,
    amount_cents: row.amount_cents,
    platform_fee_cents: row.platform_fee_cents,
    currency: row.currency,
  }))
}

async function insertMissingPayout(
  db: PlannerDb,
  intent: CapturedPaymentIntent,
  payoutAmountCents: number
) {
  const { error } = await db
    .from('payouts')
    .insert({
      payment_intent_id: intent.id,
      partner_kind: intent.partner_kind,
      partner_id: intent.partner_id,
      amount_cents: payoutAmountCents,
      currency: intent.currency,
      status: 'pending',
    })

  if (error) throw new Error(error.message ?? 'Failed to insert missing payout')
}
