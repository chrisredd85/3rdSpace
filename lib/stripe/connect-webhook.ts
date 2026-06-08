import 'server-only'

import type Stripe from 'stripe'
import {
  saveBuilderStripeAccount,
  saveVendorStripeAccount,
  saveVenueStripeAccount,
} from '@/lib/stripe/connect'

type StripeAdminClient = Parameters<typeof saveBuilderStripeAccount>[0]
type StripeAccountTable = 'vendor_stripe_accounts' | 'venue_stripe_accounts' | 'builder_stripe_accounts'

export type StripeConnectWebhookResult = {
  received: true
  ignored?: true
  observed?: string
  reason?: string
}

type StripeAccountLookup = Record<string, string | null> | null

async function loadStripeAccountRow(
  admin: StripeAdminClient,
  table: StripeAccountTable,
  selectColumns: string,
  accountId: string
): Promise<StripeAccountLookup> {
  const { data, error } = await admin
    .from(table)
    .select(selectColumns)
    .eq('stripe_account_id', accountId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as StripeAccountLookup) ?? null
}

export async function applyStripeConnectAccountUpdated(
  admin: StripeAdminClient,
  account: Stripe.Account
): Promise<StripeConnectWebhookResult> {
  const vendor = await loadStripeAccountRow(admin, 'vendor_stripe_accounts', 'vendor_id', account.id)
  if (vendor?.vendor_id) {
    await saveVendorStripeAccount(admin, vendor.vendor_id, account)
    return { received: true }
  }

  const venue = await loadStripeAccountRow(admin, 'venue_stripe_accounts', 'owner_id', account.id)
  if (venue?.owner_id) {
    await saveVenueStripeAccount(admin, venue.owner_id, account)
    return { received: true }
  }

  const builder = await loadStripeAccountRow(admin, 'builder_stripe_accounts', 'user_id, builder_id', account.id)
  if (builder?.user_id) {
    await saveBuilderStripeAccount(admin, builder.user_id, builder.builder_id ?? null, account)
    return { received: true }
  }

  return { received: true, ignored: true, reason: 'unknown_account' }
}

export async function restrictDeauthorizedStripeConnectAccount(
  admin: StripeAdminClient,
  accountId: string
): Promise<void> {
  const now = new Date().toISOString()
  const restriction = {
    account_status: 'restricted',
    charges_enabled: false,
    payouts_enabled: false,
    requirements_due: { disabled_reason: 'application_deauthorized' },
    updated_at: now,
  }

  await markStripeAccountRestricted(admin, 'vendor_stripe_accounts', accountId, restriction)
  await markStripeAccountRestricted(admin, 'venue_stripe_accounts', accountId, restriction)
  await markStripeAccountRestricted(admin, 'builder_stripe_accounts', accountId, restriction)
}

async function markStripeAccountRestricted(
  admin: StripeAdminClient,
  table: StripeAccountTable,
  accountId: string,
  restriction: Record<string, unknown>
) {
  const { error } = await admin
    .from(table)
    .update(restriction)
    .eq('stripe_account_id', accountId)

  if (error) throw new Error(`Failed to restrict deauthorized Stripe account in ${table}: ${error.message}`)
}

export async function processStripeConnectWebhookEvent(
  admin: StripeAdminClient,
  event: Stripe.Event
): Promise<StripeConnectWebhookResult> {
  if (event.type === 'account.updated') {
    return applyStripeConnectAccountUpdated(admin, event.data.object as Stripe.Account)
  }

  if (event.type === 'account.application.deauthorized') {
    const accountId = event.account || (event.data.object as { id?: string }).id
    if (accountId) {
      await restrictDeauthorizedStripeConnectAccount(admin, accountId)
    }
    return { received: true }
  }

  if (
    event.type === 'capability.updated' ||
    event.type === 'payout.created' ||
    event.type === 'payout.paid' ||
    event.type === 'payout.failed'
  ) {
    return { received: true, observed: event.type }
  }

  return { received: true, ignored: true, reason: 'unhandled_connect_event' }
}
