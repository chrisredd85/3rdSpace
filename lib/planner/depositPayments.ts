import 'server-only'

import { getStripeClient } from '@/lib/stripe/connect'
import type { Approval, Json, Plan } from '@/lib/types'

type PlannerDb = { from: (table: string) => any }

export interface PlannerPaymentIntentRow {
  id: string
  plan_id: string
  approval_id: string
  partner_kind: 'venue' | 'vendor'
  partner_id: string
  amount_cents: number
  currency: string
  status: 'requested' | 'authorized' | 'captured' | 'refunded' | 'failed'
  stripe_payment_intent_id: string | null
  authorized_at: string | null
  captured_at: string | null
  refund_terms: string
  platform_fee_cents: number
  created_at: string
  updated_at: string
}

export const PAYMENT_INTENT_SELECT_COLUMNS = `
  id,
  plan_id,
  approval_id,
  partner_kind,
  partner_id,
  amount_cents,
  currency,
  status,
  stripe_payment_intent_id,
  authorized_at,
  captured_at,
  refund_terms,
  platform_fee_cents,
  created_at,
  updated_at
`

/**
 * Creates or returns a planner deposit payment authorization record.
 *
 * When Stripe and a payment method are present, this creates a manual-capture
 * PaymentIntent and stores the authorization. Without Stripe credentials, it
 * creates a requested local record only; capture still requires a separate call.
 */
export async function authorizePlannerDeposit(input: {
  db: PlannerDb
  plan: Plan
  approval: Approval
  userId: string
  partnerKind: 'venue' | 'vendor'
  partnerId: string
  amountCents: number
  paymentMethodId?: string | null
  refundTerms?: string | null
  platformFeeCents?: number | null
}) {
  if (input.approval.status !== 'authorized' && input.approval.status !== 'approved') {
    throw new Error('Approval must be authorized before deposit authorization')
  }
  if (input.amountCents < 50) throw new Error('Deposit amount must be at least 50 cents')

  const existing = await loadExistingActivePaymentIntent(input.db, input.approval.id)
  if (existing) return existing

  const platformFeeCents = Math.max(0, Math.round(input.platformFeeCents ?? 0))
  const stripePaymentIntent = await maybeCreateStripeManualPaymentIntent({
    plan: input.plan,
    approval: input.approval,
    userId: input.userId,
    partnerKind: input.partnerKind,
    partnerId: input.partnerId,
    amountCents: input.amountCents,
    paymentMethodId: input.paymentMethodId ?? null,
    platformFeeCents,
  })

  const now = new Date().toISOString()
  const status = stripePaymentIntent?.status === 'requires_capture' ? 'authorized' : 'requested'
  const { data, error } = await input.db
    .from('payment_intents')
    .insert({
      plan_id: input.plan.id,
      approval_id: input.approval.id,
      partner_kind: input.partnerKind,
      partner_id: input.partnerId,
      amount_cents: input.amountCents,
      currency: 'usd',
      status,
      stripe_payment_intent_id: stripePaymentIntent?.id ?? null,
      authorized_at: status === 'authorized' ? now : null,
      refund_terms: input.refundTerms ?? 'Refundable up to 7 days before the event unless partner terms override.',
      platform_fee_cents: platformFeeCents,
    })
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to create planner deposit')
  return data as PlannerPaymentIntentRow
}

/**
 * Captures an authorized planner deposit after explicit user confirmation.
 */
export async function capturePlannerDeposit(input: {
  db: PlannerDb
  paymentIntent: PlannerPaymentIntentRow
  approval: Approval
  explicitUserConfirmation: boolean
}) {
  if (!input.explicitUserConfirmation) {
    throw new Error('Explicit user confirmation is required before capture')
  }
  if (input.approval.status !== 'authorized' && input.approval.status !== 'approved') {
    throw new Error('Approval must be authorized before capture')
  }
  if (input.paymentIntent.status !== 'authorized' && input.paymentIntent.status !== 'requested') {
    throw new Error(`Cannot capture a ${input.paymentIntent.status} deposit`)
  }

  if (input.paymentIntent.stripe_payment_intent_id) {
    const stripe = getStripeClient()
    await stripe.paymentIntents.capture(input.paymentIntent.stripe_payment_intent_id)
  }

  const capturedAt = new Date().toISOString()
  const { data, error } = await input.db
    .from('payment_intents')
    .update({
      status: 'captured',
      captured_at: capturedAt,
    })
    .eq('id', input.paymentIntent.id)
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to capture planner deposit')

  const captured = data as PlannerPaymentIntentRow
  const payoutAmountCents = Math.max(0, captured.amount_cents - captured.platform_fee_cents)
  await input.db.from('payouts').insert({
    payment_intent_id: captured.id,
    partner_kind: captured.partner_kind,
    partner_id: captured.partner_id,
    amount_cents: payoutAmountCents,
    currency: captured.currency,
    status: 'pending',
  })

  return captured
}

/**
 * Records Stripe webhook state for planner deposit PaymentIntents.
 */
export async function applyPlannerStripePaymentIntentWebhook(db: PlannerDb, stripePaymentIntent: {
  id: string
  status: string
  metadata?: Record<string, string>
  last_payment_error?: { message?: string | null } | null
}) {
  if (stripePaymentIntent.metadata?.payment_kind !== 'planner_deposit') return false

  const plannerPaymentIntentId = stripePaymentIntent.metadata.planner_payment_intent_id
  const status = stripePaymentIntent.status === 'succeeded'
    ? 'captured'
    : stripePaymentIntent.status === 'requires_capture'
      ? 'authorized'
      : stripePaymentIntent.status === 'requires_payment_method' || stripePaymentIntent.status === 'canceled'
        ? 'failed'
        : null

  if (!status) return true

  const updates: Record<string, unknown> = { status }
  if (status === 'captured') updates.captured_at = new Date().toISOString()
  if (status === 'authorized') updates.authorized_at = new Date().toISOString()

  const query = db.from('payment_intents').update(updates)
  if (plannerPaymentIntentId) {
    await query.eq('id', plannerPaymentIntentId)
  } else {
    await query.eq('stripe_payment_intent_id', stripePaymentIntent.id)
  }

  return true
}

/**
 * Marks a planner deposit as refunded from a Stripe charge webhook.
 */
export async function applyPlannerStripeRefundWebhook(db: PlannerDb, stripePaymentIntentId: string | null) {
  if (!stripePaymentIntentId) return false

  await db
    .from('payment_intents')
    .update({ status: 'refunded' })
    .eq('stripe_payment_intent_id', stripePaymentIntentId)

  return true
}

async function loadExistingActivePaymentIntent(db: PlannerDb, approvalId: string) {
  const { data, error } = await db
    .from('payment_intents')
    .select(PAYMENT_INTENT_SELECT_COLUMNS)
    .eq('approval_id', approvalId)
    .in('status', ['requested', 'authorized', 'captured'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as PlannerPaymentIntentRow | null) ?? null
}

async function maybeCreateStripeManualPaymentIntent(input: {
  plan: Plan
  approval: Approval
  userId: string
  partnerKind: 'venue' | 'vendor'
  partnerId: string
  amountCents: number
  paymentMethodId: string | null
  platformFeeCents: number
}) {
  if (!process.env.STRIPE_SECRET_KEY || !input.paymentMethodId) return null

  const stripe = getStripeClient()
  return stripe.paymentIntents.create(
    {
      amount: input.amountCents,
      currency: 'usd',
      capture_method: 'manual',
      confirm: true,
      payment_method: input.paymentMethodId,
      automatic_payment_methods: { enabled: true },
      metadata: {
        payment_kind: 'planner_deposit',
        plan_id: input.plan.id,
        approval_id: input.approval.id,
        user_id: input.userId,
        partner_kind: input.partnerKind,
        partner_id: input.partnerId,
        platform_fee_cents: String(input.platformFeeCents),
      },
    },
    {
      idempotencyKey: `planner_deposit_${input.approval.id}_${input.amountCents}`,
    }
  )
}
