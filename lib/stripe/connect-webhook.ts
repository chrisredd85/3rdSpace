import 'server-only'

import type Stripe from 'stripe'
import {
  saveBuilderStripeAccount,
  saveVendorStripeAccount,
  saveVenueStripeAccount,
} from '@/lib/stripe/connect'

type StripeAdminClient = Parameters<typeof saveBuilderStripeAccount>[0] & {
  rpc?: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>
}
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
  account: Stripe.Account,
  eventId = account.id
): Promise<StripeConnectWebhookResult> {
  const vendor = await loadStripeAccountRow(admin, 'vendor_stripe_accounts', 'vendor_id', account.id)
  if (vendor?.vendor_id) {
    await saveVendorStripeAccount(admin, vendor.vendor_id, account)
    await recordStripeConnectAccountEvent(admin, account.id, 'account.updated', eventId)
    return { received: true }
  }

  const venue = await loadStripeAccountRow(admin, 'venue_stripe_accounts', 'owner_id', account.id)
  if (venue?.owner_id) {
    await saveVenueStripeAccount(admin, venue.owner_id, account)
    await recordStripeConnectAccountEvent(admin, account.id, 'account.updated', eventId)
    return { received: true }
  }

  const builder = await loadStripeAccountRow(admin, 'builder_stripe_accounts', 'user_id, builder_id', account.id)
  if (builder?.user_id) {
    await saveBuilderStripeAccount(admin, builder.user_id, builder.builder_id ?? null, account)
    await recordStripeConnectAccountEvent(admin, account.id, 'account.updated', eventId)
    return { received: true }
  }

  return { received: true, ignored: true, reason: 'unknown_account' }
}

export async function restrictDeauthorizedStripeConnectAccount(
  admin: StripeAdminClient,
  accountId: string,
  eventId = accountId
): Promise<void> {
  const now = new Date().toISOString()
  const restriction = {
    account_status: 'disabled',
    charges_enabled: false,
    payouts_enabled: false,
    requirements_due: { disabled_reason: 'application_deauthorized' },
    disabled_reason: 'application_deauthorized',
    updated_at: now,
  }

  await markStripeAccountRestricted(admin, 'vendor_stripe_accounts', accountId, restriction)
  await markStripeAccountRestricted(admin, 'venue_stripe_accounts', accountId, restriction)
  await markStripeAccountRestricted(admin, 'builder_stripe_accounts', accountId, restriction)
  await blockInFlightStripeAccountPayments(admin, accountId, 'account.application.deauthorized', eventId)
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
    return applyStripeConnectAccountUpdated(admin, event.data.object as Stripe.Account, event.id)
  }

  if (event.type === 'account.application.deauthorized') {
    const accountId = event.account || (event.data.object as { id?: string }).id
    if (accountId) {
      await restrictDeauthorizedStripeConnectAccount(admin, accountId, event.id)
    }
    return { received: true }
  }

  if (
      event.type === 'capability.updated' ||
      event.type === 'payout.created' ||
      event.type === 'payout.paid' ||
      event.type === 'payout.failed'
  ) {
    const accountId = readEventAccountId(event)
    if (accountId) {
      await recordStripeConnectAccountEvent(admin, accountId, event.type, event.id)
    }
    return { received: true, observed: event.type }
  }

  return { received: true, ignored: true, reason: 'unhandled_connect_event' }
}

async function recordStripeConnectAccountEvent(
  admin: StripeAdminClient,
  accountId: string,
  eventType: string,
  eventId: string
) {
  const updates = {
    last_webhook_event_id: eventId,
    last_webhook_event_type: eventType,
    last_webhook_at: new Date().toISOString(),
  }

  await markStripeAccountEvent(admin, 'vendor_stripe_accounts', accountId, updates)
  await markStripeAccountEvent(admin, 'venue_stripe_accounts', accountId, updates)
  await markStripeAccountEvent(admin, 'builder_stripe_accounts', accountId, updates)
}

async function markStripeAccountEvent(
  admin: StripeAdminClient,
  table: StripeAccountTable,
  accountId: string,
  updates: Record<string, unknown>
) {
  const { error } = await admin
    .from(table)
    .update(updates)
    .eq('stripe_account_id', accountId)

  if (error) throw new Error(`Failed to record Stripe Connect event in ${table}: ${error.message}`)
}

async function blockInFlightStripeAccountPayments(
  admin: StripeAdminClient,
  accountId: string,
  reason: string,
  eventId: string
) {
  if (typeof admin.rpc !== 'function') return

  const { error } = await admin.rpc('block_inflight_stripe_account_payments', {
    p_stripe_account_id: accountId,
    p_reason: reason,
    p_event_id: eventId,
  })

  if (error) throw new Error(`Failed to block in-flight Stripe account payments: ${error.message}`)
}

function readEventAccountId(event: Stripe.Event) {
  if (event.account) return event.account
  const object = event.data.object as { account?: string | { id?: string }; destination?: string | { id?: string } }
  if (typeof object.account === 'string') return object.account
  if (object.account?.id) return object.account.id
  if (typeof object.destination === 'string') return object.destination
  if (object.destination?.id) return object.destination.id
  return null
}
