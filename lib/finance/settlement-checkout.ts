import 'server-only'

import { createHash, createHmac, randomBytes } from 'crypto'
import * as Sentry from '@sentry/nextjs'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'

import { sendEmailNotification } from '@/lib/email'
import { updateChiRateFromSettlement } from '@/lib/finance/chi-rate-trueup'
import {
  transitionSettlementCharge,
  transitionSettlementRun,
  transitionSettlementRunStatus,
  type SettlementTransitionActor,
  type SettlementRunStatus,
} from '@/lib/finance/settlement-run-state'
import { getAppBaseUrl, getStripeClient, isConnectedStripeAccountBlocked } from '@/lib/stripe/connect'
import { assertIntegerCents } from '@/lib/planner/execution/approvalState'

type SupabaseAdminClient = SupabaseClient<any, 'public', any>

export const CHI_SETTLEMENT_METADATA_KIND = 'chi_settlement'

export type SettlementChargeRow = {
  id: string
  settlement_run_id: string
  approval_id: string | null
  organizer_id: string
  venue_id: string
  amount_cents: number
  platform_fee_cents: number
  organizer_payout_cents: number
  currency: string
  status: 'checkout_created' | 'blocked' | 'paid' | 'failed' | 'cancelled'
  stripe_checkout_session_id: string | null
  stripe_payment_intent_id: string | null
  stripe_transfer_id: string | null
  stripe_connected_account_id: string | null
  checkout_url: string | null
  paid_at: string | null
  failed_at: string | null
  trueup_processed_at: string | null
  failure_reason: string | null
}

type SettlementRunRow = {
  id: string
  event_id: string
  organizer_id: string
  venue_id: string
  archetype: string
  venue_type: string
  neighborhood: string
  total_cents: number | null
  status: SettlementRunStatus
}

type VenueSettlementTokenRow = {
  id: string
  settlement_run_id: string
  token_hash: string
  venue_email: string | null
  expires_at: string
  first_viewed_at: string | null
  revoked_at: string | null
}

export type VenueSettlementTokenState = 'valid' | 'revoked' | 'expired' | 'missing'

type VenueRow = {
  id: string
  venue_name: string
  contact_email: string | null
  owner_id: string | null
  city: string | null
  state: string | null
}

type EventRow = {
  id: string
  event_name: string
  event_date: string | null
  builder_id: string | null
}

type PlanRow = {
  id: string
  title: string
  event_type: string | null
  date_window_start: string | null
}

type UserRow = {
  id: string
  email: string
}

type SettlementContext = {
  run: SettlementRunRow
  venue: VenueRow
  event: EventRow | null
  organizer: UserRow | null
  venueOwner: UserRow | null
  plan: PlanRow | null
}

type SettlementApprovalRow = {
  id: string
  agent_action_id: string
  status: string
  authorized_amount_cents: number | null
}

type BuilderStripeAccountRow = {
  stripe_account_id: string | null
  account_status: string | null
  charges_enabled: boolean | null
  payouts_enabled: boolean | null
}

const TOKEN_TTL_DAYS = 14
const PLATFORM_FEE_CENTS = 0

export function hashSettlementToken(rawToken: string) {
  return createHmac('sha256', getSettlementTokenSecret()).update(rawToken).digest('hex')
}

export async function createVenueSettlementToken(
  admin: SupabaseAdminClient,
  settlementRunId: string,
  venueEmail: string | null,
) {
  const rawToken = randomBytes(32).toString('base64url')
  const tokenHash = hashSettlementToken(rawToken)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: existing, error: existingError } = await (admin as any)
    .from('venue_settlement_tokens')
    .select('id')
    .eq('settlement_run_id', settlementRunId)
    .maybeSingle()

  if (existingError) throw new Error(existingError.message ?? 'Failed to load settlement token')

  const values = {
    settlement_run_id: settlementRunId,
    token_hash: tokenHash,
    venue_email: venueEmail,
    expires_at: expiresAt,
    revoked_at: null,
    first_viewed_at: null,
  }

  const query = existing
    ? (admin as any).from('venue_settlement_tokens').update(values).eq('id', existing.id)
    : (admin as any).from('venue_settlement_tokens').insert(values)

  const { data, error } = await query.select('*').single()
  if (error) throw new Error(error.message ?? 'Failed to create settlement token')

  return { rawToken, token: normalizeToken(data) }
}

export async function verifyVenueSettlementToken(admin: SupabaseAdminClient, rawToken: string) {
  const tokenHash = hashSettlementToken(rawToken)
  const now = new Date().toISOString()
  const { data: tokenData, error: tokenError } = await (admin as any)
    .from('venue_settlement_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .maybeSingle()

  if (tokenError) throw new Error(tokenError.message ?? 'Failed to verify settlement token')
  if (!tokenData) return null

  const token = normalizeToken(tokenData)
  await (admin as any)
    .from('venue_settlement_tokens')
    .update({
      first_viewed_at: token.first_viewed_at ?? now,
      last_viewed_at: now,
    })
    .eq('id', token.id)

  const context = await loadSettlementContext(admin, token.settlement_run_id)
  return context ? { token, context } : null
}

export async function getVenueSettlementTokenState(
  admin: SupabaseAdminClient,
  rawToken: string,
): Promise<VenueSettlementTokenState> {
  const tokenHash = hashSettlementToken(rawToken)
  const { data, error } = await (admin as any)
    .from('venue_settlement_tokens')
    .select('expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load settlement token state')
  if (!data) return 'missing'
  if (data.revoked_at) return 'revoked'
  if (String(data.expires_at) <= new Date().toISOString()) return 'expired'
  return 'valid'
}

async function revokeVenueSettlementToken(
  admin: SupabaseAdminClient,
  tokenId: string,
  revokedAt = new Date().toISOString(),
) {
  const { error } = await (admin as any)
    .from('venue_settlement_tokens')
    .update({ revoked_at: revokedAt })
    .eq('id', tokenId)
    .is('revoked_at', null)

  if (error) throw new Error(error.message ?? 'Failed to revoke settlement token')
}

async function revokeVenueSettlementTokensForRun(
  admin: SupabaseAdminClient,
  settlementRunId: string,
  revokedAt = new Date().toISOString(),
) {
  const { error } = await (admin as any)
    .from('venue_settlement_tokens')
    .update({ revoked_at: revokedAt })
    .eq('settlement_run_id', settlementRunId)
    .is('revoked_at', null)

  if (error) throw new Error(error.message ?? 'Failed to revoke settlement tokens')
}

export async function loadSettlementContext(
  admin: SupabaseAdminClient,
  settlementRunId: string,
): Promise<SettlementContext | null> {
  const { data: runData, error: runError } = await (admin as any)
    .from('settlement_runs')
    .select('*')
    .eq('id', settlementRunId)
    .maybeSingle()
  if (runError) throw new Error(runError.message ?? 'Failed to load settlement run')
  if (!runData) return null

  const run = normalizeRun(runData)
  const [venue, event, organizer] = await Promise.all([
    loadVenue(admin, run.venue_id),
    loadEvent(admin, run.event_id),
    loadUser(admin, run.organizer_id),
  ])

  if (!venue) return null

  const [venueOwner, plan] = await Promise.all([
    venue.owner_id ? loadUser(admin, venue.owner_id) : Promise.resolve(null),
    loadLikelyPlan(admin, run.organizer_id, event),
  ])

  return { run, venue, event, organizer, venueOwner, plan }
}

export async function ensureSettlementApproval(
  admin: SupabaseAdminClient,
  input: {
    run: SettlementRunRow
    context?: SettlementContext
    organizerId: string
  },
): Promise<SettlementApprovalRow> {
  const existing = await loadAuthorizedSettlementApproval(admin, input.run.id)
  if (existing) return existing

  const context = input.context ?? await loadSettlementContext(admin, input.run.id)
  if (!context?.plan) {
    throw new Error('Cannot create CHI settlement approval without an attached planner plan')
  }

  const amountCents = assertIntegerCents(input.run.total_cents ?? 0, 'total_cents')
  if (amountCents <= 0) throw new Error('Cannot approve a zero-value CHI settlement')

  const now = new Date().toISOString()
  const description = `Authorize community host incentive settlement for ${context.venue.venue_name}`
  const payload = {
    settlement_run_id: input.run.id,
    event_id: input.run.event_id,
    venue_id: input.run.venue_id,
    archetype: input.run.archetype,
    venue_type: input.run.venue_type,
  }

  const { data: action, error: actionError } = await (admin as any)
    .from('agent_actions')
    .insert({
      plan_id: context.plan.id,
      action_type: 'payment',
      description,
      provider: '3rdPlace CHI',
      amount_cents: amountCents,
      currency: 'usd',
      status: 'approved',
      target_type: 'settlement_run',
      target_id: input.run.id,
      payload_json: payload,
    })
    .select('*')
    .single()

  if (actionError) throw new Error(actionError.message ?? 'Failed to create CHI settlement action')

  const { data: approval, error: approvalError } = await (admin as any)
    .from('approvals')
    .insert({
      plan_id: context.plan.id,
      agent_action_id: action.id,
      action_label: 'Community host incentive settlement',
      provider: context.venue.venue_name,
      event_date: context.event?.event_date ? context.event.event_date.slice(0, 10) : null,
      price_cents: amountCents,
      fees_cents: 0,
      refund_terms: 'No booking or payment changes occur without the venue completing the settlement checkout.',
      cancellation_terms: 'Venue may dispute before payment.',
      package_details: `CHI settlement for ${context.event?.event_name ?? context.plan.title}.`,
      delivery_email: context.venue.contact_email ?? context.venueOwner?.email ?? null,
      status: 'authorized',
      approved_by: input.organizerId,
      approved_at: now,
      requested_amount_cents: amountCents,
      authorized_amount_cents: amountCents,
      authorized_by: input.organizerId,
      authorized_at: now,
      approval_type: 'chi_settlement',
      settlement_run_id: input.run.id,
    })
    .select('*')
    .single()

  if (approvalError) throw new Error(approvalError.message ?? 'Failed to create CHI settlement approval')

  await (admin as any)
    .from('agent_actions')
    .update({ approval_id: approval.id })
    .eq('id', action.id)

  return normalizeApproval(approval)
}

export async function sendVenueSettlementAcknowledgementEmail(
  admin: SupabaseAdminClient,
  settlementRunId: string,
) {
  const context = await loadSettlementContext(admin, settlementRunId)
  if (!context) return { sent: false, reason: 'settlement_run_not_found' }

  const recipient = context.venue.contact_email ?? context.venueOwner?.email ?? null
  if (!recipient) {
    return { sent: false, reason: 'venue_email_missing' }
  }

  const { rawToken } = await createVenueSettlementToken(admin, settlementRunId, recipient)
  const url = `${getConfiguredAppBaseUrl()}/venue/settlement/${encodeURIComponent(rawToken)}`
  const amount = formatCents(context.run.total_cents ?? 0)
  const eventName = context.event?.event_name ?? context.plan?.title ?? 'your recent event'

  return sendEmailNotification({
    to: recipient,
    subject: `3rdPlace settlement review for ${eventName}`,
    body: [
      `${context.organizer?.email ?? 'A 3rdPlace host'} approved a community host incentive settlement for ${context.venue.venue_name}.`,
      `Amount due: ${amount}.`,
      'Review the settlement details, pay through Stripe Checkout, or dispute the amount from the secure link below.',
    ].join('\n\n'),
    actionUrl: url,
  })
}

export async function startSettlementCheckout(
  admin: SupabaseAdminClient,
  rawToken: string,
  request: Request,
) {
  const verified = await verifyVenueSettlementToken(admin, rawToken)
  if (!verified) return { status: 404 as const, body: { error: 'Settlement link is invalid or expired' } }

  const { context } = verified
  const { run } = context
  if (run.status === 'blocked') {
    return {
      status: 409 as const,
      body: {
        error: 'Stripe account is blocked. Reconnect Stripe before continuing this settlement.',
        code: 'account_blocked',
      },
    }
  }

  if (!['awaiting_venue_ack', 'awaiting_venue_payment'].includes(run.status)) {
    return {
      status: 409 as const,
      body: { error: `Settlement is not payable in status ${run.status}`, code: 'settlement_not_payable' },
    }
  }

  const amountCents = assertIntegerCents(run.total_cents ?? 0, 'total_cents')
  if (amountCents <= 0) {
    return { status: 409 as const, body: { error: 'Settlement has no payable amount', code: 'settlement_amount_missing' } }
  }

  const approval = await loadAuthorizedSettlementApproval(admin, run.id)
  if (!approval) {
    return { status: 409 as const, body: { error: 'Organizer approval is required before payment', code: 'approval_required' } }
  }

  const account = await loadOrganizerStripeAccount(admin, run.organizer_id)
  if (account?.stripe_account_id && isConnectedStripeAccountBlocked(account.account_status)) {
    await blockSettlementRunForAccountState(admin, run, account.stripe_account_id, 'checkout_account_blocked')
    return {
      status: 409 as const,
      body: {
        error: 'Stripe account is blocked. Reconnect Stripe before continuing this settlement.',
        code: 'account_blocked',
      },
    }
  }

  if (!account?.stripe_account_id || !account.charges_enabled || !account.payouts_enabled) {
    return {
      status: 409 as const,
      body: {
        error: 'Organizer payout account is not ready for CHI settlement',
        code: 'organizer_connect_not_ready',
      },
    }
  }

  const existing = await loadActiveSettlementCharge(admin, run.id)
  if (existing?.status === 'paid') {
    return { status: 200 as const, body: { already_paid: true, charge_id: existing.id } }
  }
  if (existing?.checkout_url) {
    return { status: 200 as const, body: { hosted_checkout_url: existing.checkout_url, charge_id: existing.id } }
  }
  if (existing) {
    return { status: 409 as const, body: { error: 'Checkout is being prepared. Try again.', code: 'checkout_in_progress' } }
  }

  const { data: chargeData, error: chargeError } = await (admin as any)
    .from('settlement_charges')
    .insert({
      settlement_run_id: run.id,
      approval_id: approval.id,
      organizer_id: run.organizer_id,
      venue_id: run.venue_id,
      amount_cents: amountCents,
      platform_fee_cents: PLATFORM_FEE_CENTS,
      organizer_payout_cents: amountCents - PLATFORM_FEE_CENTS,
      currency: 'usd',
      status: 'checkout_created',
      stripe_connected_account_id: account.stripe_account_id,
      metadata: {
        settlement_run_id: run.id,
        event_id: run.event_id,
        venue_id: run.venue_id,
      },
    })
    .select('*')
    .single()

  if (chargeError) {
    if (isUniqueViolation(chargeError)) {
      const winning = await loadActiveSettlementCharge(admin, run.id)
      if (winning?.checkout_url) {
        return { status: 200 as const, body: { hosted_checkout_url: winning.checkout_url, charge_id: winning.id } }
      }
      return { status: 409 as const, body: { error: 'Checkout is being prepared. Try again.', code: 'checkout_in_progress' } }
    }
    throw new Error(chargeError.message ?? 'Failed to create settlement charge')
  }

  const charge = normalizeCharge(chargeData)
  const session = await createStripeCheckoutSession({
    request,
    charge,
    context,
    connectedAccountId: account.stripe_account_id,
    rawToken,
  })

  const { data: updatedChargeData, error: updateChargeError } = await (admin as any)
    .from('settlement_charges')
    .update({
      stripe_checkout_session_id: session.id,
      checkout_url: session.url,
    })
    .eq('id', charge.id)
    .select('*')
    .single()

  if (updateChargeError) throw new Error(updateChargeError.message ?? 'Failed to store settlement checkout')

  if (run.status === 'awaiting_venue_ack') {
    const transition = transitionSettlementRunStatus(run.status, 'venue_payment_initiated')
    if (transition.ok) {
      await transitionSettlementRun({
        db: admin,
        runId: run.id,
        fromStatus: run.status,
        toStatus: transition.to,
        action: 'venue_payment_initiated',
        actor: { id: null, type: 'venue' },
        reason: 'Venue initiated CHI settlement checkout.',
        metadata: { settlement_charge_id: charge.id },
      })
    }
  }

  return {
    status: 200 as const,
    body: {
      hosted_checkout_url: session.url,
      charge_id: updatedChargeData.id,
    },
  }
}

export async function disputeSettlementFromVenueToken(
  admin: SupabaseAdminClient,
  rawToken: string,
  reason: string | null,
) {
  const verified = await verifyVenueSettlementToken(admin, rawToken)
  if (!verified) return { status: 404 as const, body: { error: 'Settlement link is invalid or expired' } }

  const { run } = verified.context
  if (run.status === 'disputed') {
    await revokeVenueSettlementToken(admin, verified.token.id)
    return { status: 200 as const, body: { status: 'disputed' } }
  }
  if (!['awaiting_venue_ack', 'awaiting_venue_payment'].includes(run.status)) {
    return {
      status: 409 as const,
      body: { error: `Settlement cannot be disputed in status ${run.status}`, code: 'settlement_not_disputable' },
    }
  }

  const transition = transitionSettlementRunStatus(run.status, 'venue_disputed')
  if (!transition.ok) throw new Error(transition.reason)

  const now = new Date().toISOString()
  const transitioned = await transitionSettlementRun({
    db: admin,
    runId: run.id,
    fromStatus: run.status,
    toStatus: transition.to,
    action: 'venue_disputed',
    actor: { id: null, type: 'venue' },
    reason: reason?.trim() || 'Venue disputed the CHI settlement.',
    patch: {
      disputed_at: now,
      dispute_reason: reason?.trim() || 'Venue disputed the CHI settlement.',
    },
  })

  if (!transitioned.success) {
    return { status: 409 as const, body: { error: 'Settlement was updated by another request', code: 'settlement_stale' } }
  }

  await revokeVenueSettlementToken(admin, verified.token.id, now)

  return { status: 200 as const, body: { status: transitioned.run.status } }
}

export async function resolveDisputedSettlement(
  admin: SupabaseAdminClient,
  runId: string,
  input: {
    actor: SettlementTransitionActor
    reason: string
  },
) {
  const run = await loadRun(admin, runId)
  if (!run) return { status: 404 as const, body: { error: 'Settlement run not found' } }
  if (run.status !== 'disputed') {
    return { status: 409 as const, body: { error: `Settlement is not disputed in status ${run.status}`, code: 'not_disputed' } }
  }

  const transition = transitionSettlementRunStatus(run.status, 'admin_resolved')
  if (!transition.ok) throw new Error(transition.reason)

  const reason = input.reason.trim()
  const beforeState = { status: run.status, dispute_reason: runDisputeReason(run) }
  const disputeReason = `${runDisputeReason(run)}\n\nAdmin resolution: ${reason}`
  const transitioned = await transitionSettlementRun({
    db: admin,
    runId: run.id,
    fromStatus: run.status,
    toStatus: transition.to,
    action: 'admin_resolved',
    actor: input.actor,
    reason,
    patch: { dispute_reason: disputeReason },
  })

  if (!transitioned.success) {
    return { status: 409 as const, body: { error: 'Settlement was updated by another request', code: 'settlement_stale' } }
  }

  const { error: adminAuditError } = await (admin as any).from('admin_audit_log').insert({
    admin_user_id: input.actor.id,
    action: 'dispute_resolved',
    entity_type: 'settlement_run',
    entity_id: run.id,
    before_state: beforeState,
    after_state: { status: transitioned.run.status },
    reason,
    metadata: {
      reason,
      dispute_reason: disputeReason,
    },
  })
  if (adminAuditError) throw new Error(adminAuditError.message ?? 'Failed to write admin settlement audit log')

  return { status: 200 as const, body: { status: transitioned.run.status } }
}

export async function handleSettlementCheckoutCompleted(
  admin: SupabaseAdminClient,
  session: Stripe.Checkout.Session,
) {
  if (session.metadata?.kind !== CHI_SETTLEMENT_METADATA_KIND) return { handled: false }

  const charge = await loadChargeForCheckoutSession(admin, session)
  if (!charge) return { handled: false, reason: 'charge_not_found' }
  if (charge.status === 'paid') {
    await revokeVenueSettlementTokensForRun(admin, charge.settlement_run_id)
    return { handled: true, idempotent: true }
  }

  const now = new Date().toISOString()
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id ?? null

  const paidTransition = await transitionSettlementCharge({
    db: admin,
    chargeId: charge.id,
    fromStatus: 'checkout_created',
    toStatus: 'paid',
    action: 'checkout.session.completed',
    actor: { id: null, type: 'stripe_webhook' },
    reason: 'Stripe Checkout completed for CHI settlement charge.',
    metadata: { checkout_session_id: session.id },
    patch: {
      stripe_payment_intent_id: paymentIntentId,
      paid_at: now,
      failure_reason: null,
    },
  })

  if (!paidTransition.success) return { handled: true, idempotent: true }

  const paidCharge = normalizeCharge(paidTransition.charge)
  const run = await loadRun(admin, paidCharge.settlement_run_id)
  if (run && run.status === 'awaiting_venue_payment') {
    const transition = transitionSettlementRunStatus(run.status, 'venue_paid')
    if (transition.ok) {
      await transitionSettlementRun({
        db: admin,
        runId: run.id,
        fromStatus: run.status,
        toStatus: transition.to,
        action: 'venue_paid',
        actor: { id: null, type: 'stripe_webhook' },
        reason: 'Stripe Checkout marked CHI settlement charge paid.',
        metadata: { settlement_charge_id: paidCharge.id, checkout_session_id: session.id },
      })
    }
  }

  await runSettlementTrueUpOnce(admin, paidCharge)
  await notifyOrganizerPaid(admin, paidCharge)
  await revokeVenueSettlementTokensForRun(admin, paidCharge.settlement_run_id, now)

  return { handled: true, charge_id: paidCharge.id }
}

export async function handleSettlementPaymentIntentFailed(
  admin: SupabaseAdminClient,
  paymentIntent: Stripe.PaymentIntent,
) {
  if (paymentIntent.metadata?.kind !== CHI_SETTLEMENT_METADATA_KIND) return { handled: false }

  const chargeId = paymentIntent.metadata?.settlement_charge_id
  const settlementRunId = paymentIntent.metadata?.settlement_run_id
  let query = (admin as any).from('settlement_charges').select('*')
  if (chargeId) {
    query = query.eq('id', chargeId)
  } else if (settlementRunId) {
    query = query.eq('settlement_run_id', settlementRunId)
  } else {
    query = query.eq('stripe_payment_intent_id', paymentIntent.id)
  }
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to load failed settlement charge')
  if (!data) return { handled: false, reason: 'charge_not_found' }

  const message = paymentIntent.last_payment_error?.message ?? 'Stripe payment failed'
  const failedTransition = await transitionSettlementCharge({
    db: admin,
    chargeId: data.id,
    fromStatus: 'checkout_created',
    toStatus: 'failed',
    action: 'payment_intent.payment_failed',
    actor: { id: null, type: 'stripe_webhook' },
    reason: message,
    metadata: { payment_intent_id: paymentIntent.id },
    patch: {
      stripe_payment_intent_id: paymentIntent.id,
      failed_at: new Date().toISOString(),
      failure_reason: message,
    },
  })

  if (!failedTransition.success) return { handled: true, idempotent: true }

  await notifyVenuePaymentFailed(admin, normalizeCharge(failedTransition.charge), message)
  return { handled: true, charge_id: data.id }
}

async function createStripeCheckoutSession(input: {
  request: Request
  charge: SettlementChargeRow
  context: SettlementContext
  connectedAccountId: string
  rawToken: string
}) {
  const stripe = getStripeClient()
  const baseUrl = getAppBaseUrl(input.request)
  const metadata = {
    kind: CHI_SETTLEMENT_METADATA_KIND,
    settlement_charge_id: input.charge.id,
    settlement_run_id: input.charge.settlement_run_id,
    approval_id: input.charge.approval_id ?? '',
    organizer_id: input.charge.organizer_id,
    venue_id: input.charge.venue_id,
  }

  return stripe.checkout.sessions.create(
    {
      mode: 'payment',
      payment_method_types: ['card', 'us_bank_account'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: input.charge.amount_cents,
            product_data: {
              name: `3rdPlace CHI settlement - ${input.context.venue.venue_name}`,
              metadata,
            },
          },
        },
      ],
      payment_intent_data: {
        application_fee_amount: input.charge.platform_fee_cents,
        transfer_data: {
          destination: input.connectedAccountId,
          amount: input.charge.organizer_payout_cents,
        },
        metadata,
      },
      metadata,
      success_url: `${baseUrl}/venue/settlement/${encodeURIComponent(input.rawToken)}?settlement=success`,
      cancel_url: `${baseUrl}/venue/settlement/${encodeURIComponent(input.rawToken)}?settlement=cancelled`,
    },
    {
      idempotencyKey: `chi_settlement_checkout_${input.charge.settlement_run_id}_${input.charge.amount_cents}`,
    },
  )
}

async function runSettlementTrueUpOnce(admin: SupabaseAdminClient, charge: SettlementChargeRow) {
  const { data, error } = await (admin as any)
    .from('settlement_charges')
    .update({ trueup_processed_at: new Date().toISOString() })
    .eq('id', charge.id)
    .is('trueup_processed_at', null)
    .select('*')
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to lock CHI settlement true-up')
  if (!data) return

  const context = await loadSettlementContext(admin, charge.settlement_run_id)
  if (!context) return
  await updateChiRateFromSettlement(admin, {
    organizerId: context.run.organizer_id,
    venueId: context.run.venue_id,
    archetype: context.run.archetype,
    venueType: context.run.venue_type,
    settlementRunId: context.run.id,
  })
}

async function blockSettlementRunForAccountState(
  admin: SupabaseAdminClient,
  run: SettlementRunRow,
  stripeAccountId: string,
  reason: string,
) {
  const transition = transitionSettlementRunStatus(run.status, 'stripe_account_blocked')
  if (!transition.ok) return

  const now = new Date().toISOString()
  await (admin as any)
    .from('settlement_runs')
    .update({
      status: transition.to,
      blocked_at: now,
      blocked_previous_status: run.status,
      blocked_stripe_account_id: stripeAccountId,
      account_state_blocked_at: now,
      account_state_block_reason: reason,
    })
    .eq('id', run.id)
    .eq('status', run.status)
}

async function notifyOrganizerPaid(admin: SupabaseAdminClient, charge: SettlementChargeRow) {
  const context = await loadSettlementContext(admin, charge.settlement_run_id)
  if (!context?.organizer?.email) return

  await sendEmailNotification({
    to: context.organizer.email,
    subject: `CHI settlement paid - ${context.venue.venue_name}`,
    body: [
      `${context.venue.venue_name} completed the CHI settlement payment.`,
      `Amount: ${formatCents(charge.amount_cents)}.`,
      'Funds are routed to your connected Stripe account.',
    ].join('\n\n'),
  }).catch((error) => {
    Sentry.captureException(error, { tags: { area: 'chi_settlement_paid_email' } })
  })
}

async function notifyVenuePaymentFailed(admin: SupabaseAdminClient, charge: SettlementChargeRow, reason: string) {
  const context = await loadSettlementContext(admin, charge.settlement_run_id)
  const recipient = context?.venue.contact_email ?? context?.venueOwner?.email ?? null
  if (!recipient || !context) return

  await sendEmailNotification({
    to: recipient,
    subject: `3rdPlace settlement payment failed - ${context.venue.venue_name}`,
    body: [
      'Stripe reported that the CHI settlement payment did not complete.',
      `Reason: ${reason}.`,
      'Please reopen your secure settlement link and try again, or dispute the settlement if the amount needs review.',
    ].join('\n\n'),
  }).catch((error) => {
    Sentry.captureException(error, { tags: { area: 'chi_settlement_failed_email' } })
  })
}

export async function loadAuthorizedSettlementApproval(
  admin: SupabaseAdminClient,
  settlementRunId: string,
): Promise<SettlementApprovalRow | null> {
  const { data, error } = await (admin as any)
    .from('approvals')
    .select('id, agent_action_id, status, authorized_amount_cents')
    .eq('settlement_run_id', settlementRunId)
    .eq('approval_type', 'chi_settlement')
    .eq('status', 'authorized')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load CHI settlement approval')
  return data ? normalizeApproval(data) : null
}

async function loadActiveSettlementCharge(admin: SupabaseAdminClient, settlementRunId: string) {
  const { data, error } = await (admin as any)
    .from('settlement_charges')
    .select('*')
    .eq('settlement_run_id', settlementRunId)
    .in('status', ['checkout_created', 'paid'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load settlement charge')
  return data ? normalizeCharge(data) : null
}

async function loadChargeForCheckoutSession(admin: SupabaseAdminClient, session: Stripe.Checkout.Session) {
  const chargeId = session.metadata?.settlement_charge_id
  const settlementRunId = session.metadata?.settlement_run_id
  let query = (admin as any).from('settlement_charges').select('*')
  if (chargeId) {
    query = query.eq('id', chargeId)
  } else if (session.id) {
    query = query.eq('stripe_checkout_session_id', session.id)
  } else if (settlementRunId) {
    query = query.eq('settlement_run_id', settlementRunId)
  }
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to load settlement charge')
  return data ? normalizeCharge(data) : null
}

async function loadOrganizerStripeAccount(
  admin: SupabaseAdminClient,
  organizerId: string,
): Promise<BuilderStripeAccountRow | null> {
  const { data, error } = await (admin as any)
    .from('builder_stripe_accounts')
    .select('stripe_account_id, account_status, charges_enabled, payouts_enabled')
    .eq('user_id', organizerId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load organizer Stripe account')
  return (data as BuilderStripeAccountRow | null) ?? null
}

async function loadRun(admin: SupabaseAdminClient, runId: string): Promise<(SettlementRunRow & { dispute_reason?: string | null }) | null> {
  const { data, error } = await (admin as any)
    .from('settlement_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to load settlement run')
  return data ? normalizeRun(data) as SettlementRunRow & { dispute_reason?: string | null } : null
}

async function loadVenue(admin: SupabaseAdminClient, venueId: string): Promise<VenueRow | null> {
  const { data, error } = await (admin as any)
    .from('venues')
    .select('id, venue_name, contact_email, owner_id, city, state')
    .eq('id', venueId)
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to load venue')
  return (data as VenueRow | null) ?? null
}

async function loadEvent(admin: SupabaseAdminClient, eventId: string): Promise<EventRow | null> {
  const { data, error } = await (admin as any)
    .from('events')
    .select('id, event_name, event_date, builder_id')
    .eq('id', eventId)
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to load event')
  return (data as EventRow | null) ?? null
}

async function loadUser(admin: SupabaseAdminClient, userId: string): Promise<UserRow | null> {
  const { data, error } = await (admin as any)
    .from('users')
    .select('id, email')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to load user')
  return (data as UserRow | null) ?? null
}

async function loadLikelyPlan(
  admin: SupabaseAdminClient,
  organizerId: string,
  event: EventRow | null,
): Promise<PlanRow | null> {
  const { data, error } = await (admin as any)
    .from('plans')
    .select('id, title, event_type, date_window_start')
    .eq('user_id', organizerId)
    .order('updated_at', { ascending: false })
    .limit(25)
  if (error) throw new Error(error.message ?? 'Failed to load planner plan')

  const plans = ((data ?? []) as PlanRow[])
  const eventDate = event?.event_date?.slice(0, 10)
  return plans.find((plan) => plan.date_window_start?.slice(0, 10) === eventDate)
    ?? plans.find((plan) => normalizeDimension(plan.title) === normalizeDimension(event?.event_name ?? ''))
    ?? plans[0]
    ?? null
}

function normalizeToken(row: any): VenueSettlementTokenRow {
  return {
    id: String(row.id),
    settlement_run_id: String(row.settlement_run_id),
    token_hash: String(row.token_hash),
    venue_email: row.venue_email ?? null,
    expires_at: String(row.expires_at),
    first_viewed_at: row.first_viewed_at ?? null,
    revoked_at: row.revoked_at ?? null,
  }
}

function normalizeRun(row: any): SettlementRunRow {
  return {
    id: String(row.id),
    event_id: String(row.event_id),
    organizer_id: String(row.organizer_id),
    venue_id: String(row.venue_id),
    archetype: String(row.archetype),
    venue_type: String(row.venue_type),
    neighborhood: String(row.neighborhood),
    total_cents: row.total_cents == null ? null : Number(row.total_cents),
    status: row.status as SettlementRunStatus,
  }
}

function normalizeApproval(row: any): SettlementApprovalRow {
  return {
    id: String(row.id),
    agent_action_id: String(row.agent_action_id),
    status: String(row.status),
    authorized_amount_cents: row.authorized_amount_cents == null ? null : Number(row.authorized_amount_cents),
  }
}

function normalizeCharge(row: any): SettlementChargeRow {
  return {
    id: String(row.id),
    settlement_run_id: String(row.settlement_run_id),
    approval_id: row.approval_id ?? null,
    organizer_id: String(row.organizer_id),
    venue_id: String(row.venue_id),
    amount_cents: Number(row.amount_cents),
    platform_fee_cents: Number(row.platform_fee_cents ?? 0),
    organizer_payout_cents: Number(row.organizer_payout_cents ?? Number(row.amount_cents) - Number(row.platform_fee_cents ?? 0)),
    currency: String(row.currency ?? 'usd'),
    status: row.status,
    stripe_checkout_session_id: row.stripe_checkout_session_id ?? null,
    stripe_payment_intent_id: row.stripe_payment_intent_id ?? null,
    stripe_transfer_id: row.stripe_transfer_id ?? null,
    stripe_connected_account_id: row.stripe_connected_account_id ?? null,
    checkout_url: row.checkout_url ?? null,
    paid_at: row.paid_at ?? null,
    failed_at: row.failed_at ?? null,
    trueup_processed_at: row.trueup_processed_at ?? null,
    failure_reason: row.failure_reason ?? null,
  }
}

function getSettlementTokenSecret() {
  const secret = process.env.SETTLEMENT_ACK_TOKEN_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SETTLEMENT_ACK_TOKEN_SECRET required in production')
    }
    return 'local-dev-only-do-not-use-in-prod'
  }
  if (secret.length < 32) {
    throw new Error('SETTLEMENT_ACK_TOKEN_SECRET must be at least 32 chars')
  }
  return secret
}

function getConfiguredAppBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://www.3rdplace.io')
  ).replace(/\/$/, '')
}

function formatCents(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

function normalizeDimension(value: string | null | undefined) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function isUniqueViolation(error: { code?: string; message?: string }) {
  return error.code === '23505' || /duplicate key|unique constraint/i.test(error.message ?? '')
}

function runDisputeReason(run: { dispute_reason?: string | null }) {
  return run.dispute_reason ?? 'Dispute resolved by admin.'
}

export function settlementTokenPreview(rawToken: string) {
  return createHash('sha256').update(rawToken).digest('hex').slice(0, 12)
}
