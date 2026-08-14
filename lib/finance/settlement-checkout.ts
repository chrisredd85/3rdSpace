import 'server-only'

import { createHash, createHmac, randomBytes } from 'crypto'
import * as Sentry from '@sentry/nextjs'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'

import { sendEmailNotification } from '@/lib/email'
import {
  SETTLEMENT_CURRENCY,
  assertSettlementChargeAmounts,
  calculateSettlementChargeAmounts,
} from '@/lib/finance/settlement-fees'
import { updateChiRateFromSettlement } from '@/lib/finance/chi-rate-trueup'
import {
  transitionSettlementCharge,
  transitionSettlementRun,
  transitionSettlementRunStatus,
  type SettlementTransitionActor,
  type SettlementRunStatus,
} from '@/lib/finance/settlement-run-state'
import { checkStripeReadinessForAuthorization } from '@/lib/planner/stripeReadinessGate'
import { getAppBaseUrl, getStripeClient } from '@/lib/stripe/connect'
import { assertIntegerCents } from '@/lib/planner/execution/approvalState'
import {
  APPROVAL_SNAPSHOT_SCHEMA_VERSION,
  buildApprovalSnapshotHashV2,
  buildApprovalSnapshotV2,
} from '@/lib/planner/execution/reapproval'

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
  blocked_at?: string | null
  blocked_previous_status?: string | null
  blocked_stripe_account_id?: string | null
  account_state_blocked_at?: string | null
  account_state_block_reason?: string | null
  account_state_blocked_event_id?: string | null
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
  blocked_at?: string | null
  blocked_previous_status?: SettlementRunStatus | null
  blocked_stripe_account_id?: string | null
  account_state_blocked_at?: string | null
  account_state_block_reason?: string | null
  account_state_blocked_event_id?: string | null
}

export type SettlementCheckoutCompletionOptions = {
  actor?: SettlementTransitionActor
  settlementChargeId?: string | null
  action?: string
  reason?: string
  metadata?: Record<string, unknown>
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
  guest_count: number | null
  budget_cap_cents: number | null
  neighborhood: string | null
  date_window_start: string | null
  date_window_end: string | null
  ticketed: boolean | null
  ticketing_model: string | null
  food_responsibility: string | null
  profit_goal_cents: number | null
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

const TOKEN_TTL_DAYS = 14

export class SettlementApprovalAmountDriftError extends Error {
  constructor(
    public details: {
      planId: string | null
      approval_id: string
      run_id: string
      approval_amount: number | null
      current_total: number
      drift_amount: number | null
    },
  ) {
    super('Approval amount no longer matches settlement total')
    this.name = 'SettlementApprovalAmountDriftError'
  }
}

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

  const approvalSnapshot = {
    action_label: 'Community host incentive settlement',
    event_date: context.event?.event_date ? context.event.event_date.slice(0, 10) : null,
    price_cents: amountCents,
    fees_cents: 0,
    requested_amount_cents: amountCents,
    provider: context.venue.venue_name,
    delivery_email: context.venue.contact_email ?? context.venueOwner?.email ?? null,
    refund_terms: 'No booking or payment changes occur without the venue completing the settlement checkout.',
    cancellation_terms: 'Venue may dispute before payment.',
    package_details: `CHI settlement for ${context.event?.event_name ?? context.plan.title}.`,
    expires_at: null,
    notes: null,
  }
  const approvalSnapshotInput = {
    plan: {
      ...context.plan,
      ticketed: context.plan.ticketed ?? false,
    },
    approval: approvalSnapshot,
    action,
    payload,
  }

  const { data: approval, error: approvalError } = await (admin as any)
    .from('approvals')
    .insert({
      plan_id: context.plan.id,
      agent_action_id: action.id,
      ...approvalSnapshot,
      status: 'authorized',
      approved_by: input.organizerId,
      approved_at: now,
      requested_amount_cents: amountCents,
      authorized_amount_cents: amountCents,
      authorized_by: input.organizerId,
      authorized_at: now,
      approval_type: 'chi_settlement',
      settlement_run_id: input.run.id,
      snapshot_hash: buildApprovalSnapshotHashV2(approvalSnapshotInput),
      snapshot_json: buildApprovalSnapshotV2(approvalSnapshotInput),
      snapshot_schema_version: APPROVAL_SNAPSHOT_SCHEMA_VERSION,
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
  const amountDrift = validateSettlementApprovalAmount({
    approval,
    run,
    planId: context.plan?.id ?? null,
    currentTotalCents: amountCents,
  })
  if (amountDrift) {
    Sentry.captureException(amountDrift, {
      level: 'warning',
      tags: { area: 'chi_settlement_checkout', code: 'approval_amount_drift' },
      extra: amountDrift.details,
    })
    return {
      status: 409 as const,
      body: {
        error: `Settlement amount changed since it was approved. Re-approve at ${formatCents(amountCents)} to continue.`,
        code: 'approval_amount_drift',
        current_total_cents: amountCents,
        approval_amount_cents: approval.authorized_amount_cents,
      },
    }
  }

  const organizerGate = await checkStripeReadinessForAuthorization({
    supabase: admin as any,
    entityType: 'organizer',
    entityId: run.organizer_id,
  })
  if (!organizerGate.ready) {
    if (['restricted', 'disabled', 'deauthorized'].includes(organizerGate.reason)) {
      const transition = transitionSettlementRunStatus(run.status, 'stripe_account_blocked')
      if (transition.ok) {
        await transitionSettlementRun({
          db: admin,
          runId: run.id,
          fromStatus: run.status,
          toStatus: transition.to,
          action: 'stripe_account_blocked',
          actor: { id: null, type: 'system' },
          reason: 'checkout_account_blocked',
          metadata: {
            stripe_account_id: organizerGate.account_id,
            block_reason: organizerGate.reason,
          },
          patch: {
            blocked_previous_status: run.status,
            blocked_stripe_account_id: organizerGate.account_id,
            account_state_block_reason: 'checkout_account_blocked',
          },
        })
      }
      return {
        status: 409 as const,
        body: {
          error: 'Stripe account is blocked. Reconnect Stripe before continuing this settlement.',
          code: 'account_blocked',
        },
      }
    }
    return {
      status: 409 as const,
      body: {
        error: 'Organizer payout account is not ready for CHI settlement',
        code: 'organizer_connect_not_ready',
        reason: organizerGate.reason,
      },
    }
  }
  const connectedAccountId = organizerGate.account_id

  const existing = await loadActiveSettlementCharge(admin, run.id)
  if (existing) assertSettlementChargeAmounts(existing)
  if (existing?.status === 'paid') {
    return { status: 200 as const, body: { already_paid: true, charge_id: existing.id } }
  }
  if (existing?.checkout_url) {
    return { status: 200 as const, body: { hosted_checkout_url: existing.checkout_url, charge_id: existing.id } }
  }
  if (existing) {
    return { status: 409 as const, body: { error: 'Checkout is being prepared. Try again.', code: 'checkout_in_progress' } }
  }

  const amounts = calculateSettlementChargeAmounts(amountCents)

  const { data: chargeData, error: chargeError } = await (admin as any)
    .from('settlement_charges')
    .insert({
      settlement_run_id: run.id,
      approval_id: approval.id,
      organizer_id: run.organizer_id,
      venue_id: run.venue_id,
      amount_cents: amounts.amountCents,
      platform_fee_cents: amounts.platformFeeCents,
      organizer_payout_cents: amounts.organizerPayoutCents,
      currency: amounts.currency,
      status: 'checkout_created',
      stripe_connected_account_id: connectedAccountId,
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
  assertSettlementChargeAmounts(charge)
  const session = await createStripeCheckoutSession({
    request,
    charge,
    context,
    connectedAccountId,
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
  options: SettlementCheckoutCompletionOptions = {},
) {
  if (
    session.metadata?.kind !== CHI_SETTLEMENT_METADATA_KIND &&
    !options.settlementChargeId
  ) {
    return { handled: false }
  }

  const charge = await loadChargeForCheckoutSession(admin, session, options.settlementChargeId)
  if (!charge) return { handled: false, reason: 'charge_not_found' }
  if (session.payment_status !== 'paid') {
    return { handled: true, reconciled: false, reason: 'payment_pending' }
  }

  const now = new Date().toISOString()
  const actor = options.actor ?? { id: null, type: 'stripe_webhook' as const }
  const action = options.action ?? 'checkout.session.completed'
  const reason = options.reason ?? 'Stripe Checkout completed for CHI settlement charge.'
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id ?? null
  let paidCharge = charge
  let chargeChanged = false

  if (charge.status !== 'paid') {
    const canReconcileBlocked =
      charge.status === 'blocked' && charge.blocked_previous_status === 'checkout_created'
    if (charge.status !== 'checkout_created' && !canReconcileBlocked) {
      throw new Error(
        `Cannot reconcile completed settlement Checkout Session ${session.id} from local status ${charge.status}`,
      )
    }

    const paidTransition = await transitionSettlementCharge({
      db: admin,
      chargeId: charge.id,
      fromStatus: charge.status,
      toStatus: 'paid',
      action,
      actor,
      reason,
      metadata: {
        checkout_session_id: session.id,
        recovered_from_account_restriction: charge.status === 'blocked',
        ...(options.metadata ?? {}),
      },
      patch: {
        stripe_payment_intent_id: paymentIntentId,
        paid_at: now,
        failure_reason: null,
      },
    })

    if (paidTransition.success) {
      paidCharge = normalizeCharge(paidTransition.charge)
      chargeChanged = true
    } else if (paidTransition.charge && paidTransition.charge.status === 'paid') {
      paidCharge = normalizeCharge(paidTransition.charge)
    } else {
      throw new Error(
        `Settlement charge ${charge.id} changed before completed Checkout reconciliation`,
      )
    }
  }

  paidCharge = await clearCompletedSettlementChargeBlock(admin, paidCharge, actor, {
    checkout_session_id: session.id,
    ...(options.metadata ?? {}),
  })

  const run = await loadRun(admin, paidCharge.settlement_run_id)
  let runChanged = false
  if (run && run.status !== 'settled') {
    const canReconcileBlockedRun =
      run.status === 'blocked' && run.blocked_previous_status === 'awaiting_venue_payment'
    if (run.status !== 'awaiting_venue_payment' && !canReconcileBlockedRun) {
      throw new Error(
        `Cannot settle completed Checkout Session ${session.id} from settlement run status ${run.status}`,
      )
    }

    const transition = transitionSettlementRunStatus(run.status, 'venue_paid')
    if (!transition.ok) throw new Error(transition.reason)
    const transitionedRun = await transitionSettlementRun({
      db: admin,
      runId: run.id,
      fromStatus: run.status,
      toStatus: transition.to,
      action: 'venue_paid',
      actor,
      reason: 'Stripe Checkout marked CHI settlement charge paid.',
      metadata: {
        settlement_charge_id: paidCharge.id,
        checkout_session_id: session.id,
        recovered_from_account_restriction: run.status === 'blocked',
        ...(options.metadata ?? {}),
      },
    })
    if (transitionedRun.success) {
      runChanged = true
      await clearCompletedSettlementRunBlock(
        admin,
        transitionedRun.run,
        actor,
        { checkout_session_id: session.id, ...(options.metadata ?? {}) },
      )
    } else if (transitionedRun.run?.status !== 'settled') {
      throw new Error(
        `Settlement run ${run.id} changed before completed Checkout reconciliation`,
      )
    }
  }

  await runSettlementTrueUpOnce(admin, paidCharge)
  if (chargeChanged || runChanged) await notifyOrganizerPaid(admin, paidCharge)
  await revokeVenueSettlementTokensForRun(admin, paidCharge.settlement_run_id, now)

  return {
    handled: true,
    reconciled: true,
    charge_id: paidCharge.id,
    idempotent: !chargeChanged && !runChanged,
  }
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
  const actor = { id: null, type: 'stripe_webhook' as const }
  const loadedCharge = normalizeCharge(data)
  const canFailBlockedCharge =
    loadedCharge.status === 'blocked' &&
    loadedCharge.blocked_previous_status === 'checkout_created'
  const canFailCharge = loadedCharge.status === 'checkout_created' || canFailBlockedCharge
  let charge = loadedCharge
  let chargeChanged = false

  if (canFailCharge) {
    const failedTransition = await transitionSettlementCharge({
      db: admin,
      chargeId: loadedCharge.id,
      fromStatus: loadedCharge.status,
      toStatus: 'failed',
      action: 'payment_intent.payment_failed',
      actor,
      reason: message,
      metadata: {
        payment_intent_id: paymentIntent.id,
        recovered_from_account_restriction: canFailBlockedCharge,
      },
      patch: {
        stripe_payment_intent_id: paymentIntent.id,
        failed_at: new Date().toISOString(),
        failure_reason: message,
      },
    })

    if (failedTransition.success) {
      charge = normalizeCharge(failedTransition.charge)
      chargeChanged = true
    } else if (failedTransition.charge?.status === 'failed') {
      charge = normalizeCharge(failedTransition.charge)
    } else {
      return { handled: true, idempotent: true }
    }
  } else if (loadedCharge.status !== 'failed') {
    return { handled: true, idempotent: true }
  }

  const hasBlockedFailureLineage =
    charge.blocked_previous_status === 'checkout_created' &&
    hasSettlementBlockMetadata(charge)
  if (hasBlockedFailureLineage) {
    await reconcileSettlementRunAfterBlockedPaymentFailure(admin, charge, paymentIntent.id, message)
    charge = await clearFailedSettlementChargeBlock(admin, charge, actor, {
      payment_intent_id: paymentIntent.id,
    })
  }

  if (chargeChanged) await notifyVenuePaymentFailed(admin, charge, message)
  return {
    handled: true,
    charge_id: charge.id,
    idempotent: !chargeChanged,
  }
}

async function reconcileSettlementRunAfterBlockedPaymentFailure(
  admin: SupabaseAdminClient,
  charge: SettlementChargeRow,
  paymentIntentId: string,
  reason: string,
) {
  const run = await loadRun(admin, charge.settlement_run_id)
  if (!run) throw new Error(`Settlement run ${charge.settlement_run_id} not found for failed charge`)

  const priorStatus = run.blocked_previous_status
  if (
    run.status === 'blocked' &&
    priorStatus !== 'awaiting_venue_ack' &&
    priorStatus !== 'awaiting_venue_payment'
  ) {
    throw new Error(
      `Cannot reconcile failed settlement charge ${charge.id} from blocked run status ${priorStatus ?? 'unknown'}`,
    )
  }

  if (
    charge.blocked_stripe_account_id &&
    run.blocked_stripe_account_id &&
    charge.blocked_stripe_account_id !== run.blocked_stripe_account_id
  ) {
    throw new Error(`Settlement charge ${charge.id} and run ${run.id} have different blocked Stripe accounts`)
  }
  if (
    charge.account_state_blocked_event_id &&
    run.account_state_blocked_event_id &&
    charge.account_state_blocked_event_id !== run.account_state_blocked_event_id
  ) {
    throw new Error(`Settlement charge ${charge.id} and run ${run.id} have different block events`)
  }

  let retryableRun: Record<string, unknown> | null = null
  if (run.status === 'blocked') {
    const transition = await transitionSettlementRun({
      db: admin,
      runId: run.id,
      fromStatus: 'blocked',
      toStatus: priorStatus!,
      action: 'payment_intent.payment_failed',
      actor: { id: null, type: 'stripe_webhook' },
      reason,
      metadata: {
        settlement_charge_id: charge.id,
        payment_intent_id: paymentIntentId,
        recovered_from_account_restriction: true,
      },
    })
    if (transition.success) {
      retryableRun = transition.run
    } else if (transition.run?.status === priorStatus) {
      retryableRun = transition.run ?? null
    } else {
      throw new Error(`Settlement run ${run.id} changed before failed payment reconciliation`)
    }
  } else if (
    (run.status === 'awaiting_venue_ack' || run.status === 'awaiting_venue_payment') &&
    hasSettlementBlockMetadata(run)
  ) {
    retryableRun = run
  }

  if (retryableRun && hasSettlementBlockMetadata(retryableRun)) {
    await clearFailedSettlementRunBlock(
      admin,
      retryableRun,
      { id: null, type: 'stripe_webhook' },
      { settlement_charge_id: charge.id, payment_intent_id: paymentIntentId },
    )
  }
}

async function clearFailedSettlementChargeBlock(
  admin: SupabaseAdminClient,
  charge: SettlementChargeRow,
  actor: SettlementTransitionActor,
  metadata: Record<string, unknown>,
) {
  if (!hasSettlementBlockMetadata(charge)) return charge

  const beforeState = { ...charge }
  let query = (admin as any)
    .from('settlement_charges')
    .update({
      blocked_at: null,
      blocked_previous_status: null,
      blocked_stripe_account_id: null,
      account_state_blocked_at: null,
      account_state_block_reason: null,
      account_state_blocked_event_id: null,
      checkout_url: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', charge.id)
    .eq('status', 'failed')
  if (charge.account_state_blocked_event_id) {
    query = query.eq('account_state_blocked_event_id', charge.account_state_blocked_event_id)
  }
  const { data, error } = await query.select('*').maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to clear failed settlement charge block')
  if (!data) throw new Error(`Failed settlement charge changed while clearing block: ${charge.id}`)

  await writeSettlementBlockClearAudit(admin, {
    entityType: 'settlement_charge',
    entityId: charge.id,
    actor,
    beforeState,
    afterState: data,
    metadata,
    action: 'account_restriction_cleared_after_payment_failure',
    reason: 'Stripe confirmed the blocked settlement payment failed; the charge can no longer settle.',
  })
  return normalizeCharge(data)
}

async function clearFailedSettlementRunBlock(
  admin: SupabaseAdminClient,
  run: Record<string, unknown>,
  actor: SettlementTransitionActor,
  metadata: Record<string, unknown>,
) {
  if (!hasSettlementBlockMetadata(run)) return run

  const beforeState = { ...run }
  const runId = String(run.id)
  let query = (admin as any)
    .from('settlement_runs')
    .update({
      blocked_at: null,
      blocked_previous_status: null,
      blocked_stripe_account_id: null,
      stripe_account_recovery_notified_at: null,
      account_state_blocked_at: null,
      account_state_block_reason: null,
      account_state_blocked_event_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .in('status', ['awaiting_venue_ack', 'awaiting_venue_payment'])
  const blockEventId = typeof run.account_state_blocked_event_id === 'string'
    ? run.account_state_blocked_event_id
    : null
  if (blockEventId) query = query.eq('account_state_blocked_event_id', blockEventId)
  const { data, error } = await query.select('*').maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to clear failed settlement run block')
  if (!data) throw new Error(`Settlement run changed while clearing failed payment block: ${runId}`)

  await writeSettlementBlockClearAudit(admin, {
    entityType: 'settlement_run',
    entityId: runId,
    actor,
    beforeState,
    afterState: data,
    metadata,
    action: 'account_restriction_cleared_after_payment_failure',
    reason: 'Stripe confirmed the blocked settlement payment failed; the venue may retry checkout.',
  })
  return data as Record<string, unknown>
}

async function clearCompletedSettlementChargeBlock(
  admin: SupabaseAdminClient,
  charge: SettlementChargeRow,
  actor: SettlementTransitionActor,
  metadata: Record<string, unknown>,
) {
  if (!hasSettlementBlockMetadata(charge)) return charge

  const beforeState = { ...charge }
  const { data, error } = await (admin as any)
    .from('settlement_charges')
    .update({
      blocked_at: null,
      blocked_previous_status: null,
      blocked_stripe_account_id: null,
      account_state_blocked_at: null,
      account_state_block_reason: null,
      account_state_blocked_event_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', charge.id)
    .eq('status', 'paid')
    .select('*')
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to clear paid settlement charge block')
  if (!data) throw new Error(`Paid settlement charge not found while clearing block: ${charge.id}`)

  await writeSettlementBlockClearAudit(admin, {
    entityType: 'settlement_charge',
    entityId: charge.id,
    actor,
    beforeState,
    afterState: data,
    metadata,
  })
  return normalizeCharge(data)
}

async function clearCompletedSettlementRunBlock(
  admin: SupabaseAdminClient,
  run: Record<string, unknown>,
  actor: SettlementTransitionActor,
  metadata: Record<string, unknown>,
) {
  if (!hasSettlementBlockMetadata(run)) return run

  const beforeState = { ...run }
  const runId = String(run.id)
  const { data, error } = await (admin as any)
    .from('settlement_runs')
    .update({
      blocked_at: null,
      blocked_previous_status: null,
      blocked_stripe_account_id: null,
      stripe_account_recovery_notified_at: null,
      account_state_blocked_at: null,
      account_state_block_reason: null,
      account_state_blocked_event_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .eq('status', 'settled')
    .select('*')
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Failed to clear settled run block')
  if (!data) throw new Error(`Settled run not found while clearing block: ${runId}`)

  await writeSettlementBlockClearAudit(admin, {
    entityType: 'settlement_run',
    entityId: runId,
    actor,
    beforeState,
    afterState: data,
    metadata,
  })
  return data as Record<string, unknown>
}

function hasSettlementBlockMetadata(row: Record<string, unknown>) {
  return Boolean(
    row.blocked_at ||
    row.blocked_previous_status ||
    row.blocked_stripe_account_id ||
    row.account_state_blocked_at ||
    row.account_state_block_reason ||
    row.account_state_blocked_event_id,
  )
}

async function writeSettlementBlockClearAudit(
  admin: SupabaseAdminClient,
  input: {
    entityType: 'settlement_charge' | 'settlement_run'
    entityId: string
    actor: SettlementTransitionActor
    beforeState: Record<string, unknown>
    afterState: Record<string, unknown>
    metadata: Record<string, unknown>
    action?: string
    reason?: string
  },
) {
  const { error } = await (admin as any).from('settlement_audit_log').insert({
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action ?? 'account_restriction_cleared_after_payment',
    before_state: input.beforeState,
    after_state: input.afterState,
    actor_id: input.actor.id,
    actor_type: input.actor.type,
    reason: input.reason ?? 'Stripe confirmed payment before account restriction neutralization completed.',
    metadata: input.metadata,
  })
  if (error) throw new Error(error.message ?? 'Failed to audit settlement block cleanup')
}

async function createStripeCheckoutSession(input: {
  request: Request
  charge: SettlementChargeRow
  context: SettlementContext
  connectedAccountId: string
  rawToken: string
}) {
  assertSettlementChargeAmounts(input.charge)
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
            currency: SETTLEMENT_CURRENCY,
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

function validateSettlementApprovalAmount(input: {
  approval: SettlementApprovalRow
  run: SettlementRunRow
  planId: string | null
  currentTotalCents: number
}) {
  const approvalAmount = input.approval.authorized_amount_cents
  if (approvalAmount === input.currentTotalCents) return null

  return new SettlementApprovalAmountDriftError({
    planId: input.planId,
    approval_id: input.approval.id,
    run_id: input.run.id,
    approval_amount: approvalAmount,
    current_total: input.currentTotalCents,
    drift_amount: approvalAmount == null ? null : input.currentTotalCents - approvalAmount,
  })
}

async function loadChargeForCheckoutSession(
  admin: SupabaseAdminClient,
  session: Stripe.Checkout.Session,
  settlementChargeId?: string | null,
) {
  const chargeId = session.metadata?.settlement_charge_id
  const settlementRunId = session.metadata?.settlement_run_id
  let query = (admin as any).from('settlement_charges').select('*')
  if (settlementChargeId) {
    query = query.eq('id', settlementChargeId)
  } else if (chargeId) {
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
    .select('id, title, event_type, guest_count, budget_cap_cents, neighborhood, date_window_start, date_window_end, ticketed, ticketing_model, food_responsibility, profit_goal_cents')
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
    blocked_at: row.blocked_at ?? null,
    blocked_previous_status: (row.blocked_previous_status as SettlementRunStatus | null) ?? null,
    blocked_stripe_account_id: row.blocked_stripe_account_id ?? null,
    account_state_blocked_at: row.account_state_blocked_at ?? null,
    account_state_block_reason: row.account_state_block_reason ?? null,
    account_state_blocked_event_id: row.account_state_blocked_event_id ?? null,
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
    blocked_at: row.blocked_at ?? null,
    blocked_previous_status: row.blocked_previous_status ?? null,
    blocked_stripe_account_id: row.blocked_stripe_account_id ?? null,
    account_state_blocked_at: row.account_state_blocked_at ?? null,
    account_state_block_reason: row.account_state_block_reason ?? null,
    account_state_blocked_event_id: row.account_state_blocked_event_id ?? null,
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
