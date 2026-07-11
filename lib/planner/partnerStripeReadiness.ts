import 'server-only'

import type Stripe from 'stripe'
import { PlannerDepositAccountBlockedError } from '@/lib/planner/depositPayments'
import {
  getStripeAccountStatus,
  getStripeClient,
  isConnectedStripeAccountBlocked,
} from '@/lib/stripe/connect'

type PlannerDb = {
  from: (table: string) => any
  rpc?: (fn: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown
    error: { message?: string } | null
  }>
}

type PartnerKind = 'venue' | 'vendor'

export class PlannerPartnerStripeReadinessUnavailableError extends Error {
  code = 'stripe_partner_readiness_unavailable'

  constructor(message: string) {
    super(message)
    this.name = 'PlannerPartnerStripeReadinessUnavailableError'
  }
}

export async function assertPlannerPartnerStripeReady(input: {
  db: PlannerDb
  partnerKind: PartnerKind
  partnerId: string
  eventId: string
}) {
  const account = await loadPartnerStripeAccount(input.db, input.partnerKind, input.partnerId)
  if (!account?.stripe_account_id) {
    throw new PlannerDepositAccountBlockedError(
      'The selected partner must finish Stripe setup before this controlled payment can continue.'
    )
  }
  if (typeof input.db.rpc !== 'function') {
    throw new PlannerPartnerStripeReadinessUnavailableError(
      'Stripe account payment-state checks are temporarily unavailable.'
    )
  }

  let liveAccount: Stripe.Account
  try {
    const retrieved = await getStripeClient().accounts.retrieve(account.stripe_account_id)
    if ('deleted' in retrieved && retrieved.deleted) {
      await blockPartnerPayments(input.db, account.stripe_account_id, input.eventId)
      throw new PlannerDepositAccountBlockedError(
        'The selected partner Stripe account is no longer available.'
      )
    }
    liveAccount = retrieved as Stripe.Account
  } catch (error) {
    if (error instanceof PlannerDepositAccountBlockedError) throw error
    throw new PlannerPartnerStripeReadinessUnavailableError(
      `Unable to verify the partner Stripe account before payment: ${error instanceof Error ? error.message : 'Stripe lookup failed'}`
    )
  }

  const liveStatus = getStripeAccountStatus(liveAccount)
  const ready = liveAccount.charges_enabled === true &&
    liveAccount.payouts_enabled === true &&
    !isConnectedStripeAccountBlocked(liveStatus)

  if (!ready) {
    await blockPartnerPayments(input.db, account.stripe_account_id, input.eventId)
    throw new PlannerDepositAccountBlockedError(
      'The selected partner Stripe account is not ready for controlled payments.'
    )
  }

  const { error: unblockError } = await input.db.rpc('unblock_stripe_account_settlements', {
    p_stripe_account_id: account.stripe_account_id,
    p_event_id: input.eventId,
  })
  if (unblockError) {
    throw new Error(`Failed to restore partner payments after Stripe recovery: ${unblockError.message}`)
  }

  return { stripeAccountId: account.stripe_account_id, accountStatus: liveStatus }
}

async function blockPartnerPayments(db: PlannerDb, stripeAccountId: string, eventId: string) {
  if (typeof db.rpc !== 'function') {
    throw new PlannerPartnerStripeReadinessUnavailableError(
      'Stripe account payment-state checks are temporarily unavailable.'
    )
  }
  const { error } = await db.rpc('block_inflight_stripe_account_payments', {
    p_stripe_account_id: stripeAccountId,
    p_reason: 'planner.payment_boundary_not_ready',
    p_event_id: eventId,
  })
  if (error) throw new Error(`Failed to block unsafe partner payments: ${error.message}`)
}

async function loadPartnerStripeAccount(
  db: PlannerDb,
  partnerKind: PartnerKind,
  partnerId: string
): Promise<{ stripe_account_id: string | null } | null> {
  if (partnerKind === 'vendor') {
    const { data, error } = await db
      .from('vendor_stripe_accounts')
      .select('stripe_account_id')
      .eq('vendor_id', partnerId)
      .maybeSingle()
    if (error) throw new Error(`Failed to load vendor Stripe account: ${error.message}`)
    return (data as { stripe_account_id: string | null } | null) ?? null
  }

  const { data: venue, error: venueError } = await db
    .from('venues')
    .select('owner_id')
    .eq('id', partnerId)
    .maybeSingle()
  if (venueError) throw new Error(`Failed to load venue owner for Stripe readiness: ${venueError.message}`)
  const ownerId = (venue as { owner_id?: string } | null)?.owner_id
  if (!ownerId) return null

  const { data, error } = await db
    .from('venue_stripe_accounts')
    .select('stripe_account_id')
    .eq('owner_id', ownerId)
    .maybeSingle()
  if (error) throw new Error(`Failed to load venue Stripe account: ${error.message}`)
  return (data as { stripe_account_id: string | null } | null) ?? null
}
