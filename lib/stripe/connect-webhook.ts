import 'server-only'

import type Stripe from 'stripe'
import * as Sentry from '@sentry/nextjs'
import { sendEmailNotification } from '@/lib/email'
import {
  getStripeAccountStatus,
  isConnectedStripeAccountBlocked,
  saveBuilderStripeAccount,
  saveVendorStripeAccount,
  saveVenueStripeAccount,
} from '@/lib/stripe/connect'
import { handleVenueStripeReadyForOwner } from '@/lib/venues/venueOpportunityRecovery'
import { recordStripeReadyUnblockNotice } from '@/lib/server/notifyEntityStripeSetup'

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

type StripeAccountLookup = Record<string, unknown> | null

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
  const vendorId = readString(vendor?.vendor_id)
  if (vendorId) {
    await saveVendorStripeAccount(admin, vendorId, account)
    if (account.charges_enabled) {
      await clearVendorStripeSkippedAt(admin, vendorId)
    }
    if (account.charges_enabled && account.payouts_enabled) {
      recordStripeReadyUnblockNotice({
        supabase: admin,
        entityType: 'vendor',
        entityId: vendorId,
        stripeAccountId: account.id,
        eventId,
      }).catch((error) => {
        console.error('[stripe.connect.webhook] Failed to record vendor Stripe unblock notice', error)
      })
    }
    await recordStripeConnectAccountEvent(admin, account.id, 'account.updated', eventId)
    return { received: true }
  }

  const venue = await loadStripeAccountRow(admin, 'venue_stripe_accounts', 'owner_id, payouts_enabled', account.id)
  const venueOwnerId = readString(venue?.owner_id)
  if (venueOwnerId) {
    const wasPayoutReady = venue?.payouts_enabled === true
    await saveVenueStripeAccount(admin, venueOwnerId, account)
    if (!wasPayoutReady && account.payouts_enabled) {
      await handleVenueStripeReadyForOwner(admin, venueOwnerId)
    }
    if (account.charges_enabled && account.payouts_enabled) {
      recordStripeReadyUnblockNotice({
        supabase: admin,
        entityType: 'venue',
        entityId: venueOwnerId,
        stripeAccountId: account.id,
        eventId,
      }).catch((error) => {
        console.error('[stripe.connect.webhook] Failed to record venue Stripe unblock notice', error)
      })
    }
    await recordStripeConnectAccountEvent(admin, account.id, 'account.updated', eventId)
    return { received: true }
  }

  const builder = await loadStripeAccountRow(admin, 'builder_stripe_accounts', 'user_id, builder_id, account_status', account.id)
  const builderUserId = readString(builder?.user_id)
  if (builderUserId) {
    const previousStatus = readString(builder?.account_status)
    const nextStatus = getStripeAccountStatus(account)
    await saveBuilderStripeAccount(admin, builderUserId, readString(builder?.builder_id), account)
    if (isConnectedStripeAccountBlocked(nextStatus)) {
      const blockResult = await blockInFlightStripeAccountPayments(admin, account.id, 'account.updated', eventId)
      await notifyOrganizerStripeAccountBlocked(admin, {
        accountId: account.id,
        organizerId: builderUserId,
        blockResult,
      })
    } else {
      if (isConnectedStripeAccountBlocked(previousStatus)) {
        const unblockResult = await unblockStripeAccountSettlements(admin, account.id, eventId)
        if (unblockResult) {
          console.info('stripe_account_settlements_unblocked', {
            account_id: account.id,
            event_id: eventId,
            ...unblockResult,
          })
        }
      }
      if (account.charges_enabled && account.payouts_enabled) {
        recordStripeReadyUnblockNotice({
          supabase: admin,
          entityType: 'organizer',
          entityId: builderUserId,
          stripeAccountId: account.id,
          eventId,
        }).catch((error) => {
          console.error('[stripe.connect.webhook] Failed to record builder Stripe unblock notice', error)
        })
      }
    }
    await recordStripeConnectAccountEvent(admin, account.id, 'account.updated', eventId)
    return { received: true }
  }

  return { received: true, ignored: true, reason: 'unknown_account' }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

async function clearVendorStripeSkippedAt(
  admin: StripeAdminClient,
  vendorId: string
) {
  const { error } = await admin
    .from('vendor_profiles')
    .update({
      stripe_skipped_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', vendorId)

  if (error) throw new Error(`Failed to clear vendor Stripe skip state: ${error.message}`)
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
  if (typeof admin.rpc !== 'function') return null

  const { data, error } = await admin.rpc('block_inflight_stripe_account_payments', {
    p_stripe_account_id: accountId,
    p_reason: reason,
    p_event_id: eventId,
  })

  if (error) throw new Error(`Failed to block in-flight Stripe account payments: ${error.message}`)
  return readRpcCounts(data)
}

async function unblockStripeAccountSettlements(
  admin: StripeAdminClient,
  accountId: string,
  eventId: string
) {
  if (typeof admin.rpc !== 'function') return null

  const { data, error } = await admin.rpc('unblock_stripe_account_settlements', {
    p_stripe_account_id: accountId,
    p_event_id: eventId,
  })

  if (error) throw new Error(`Failed to unblock Stripe account settlements: ${error.message}`)
  return readRpcCounts(data)
}

async function notifyOrganizerStripeAccountBlocked(
  admin: StripeAdminClient,
  input: {
    accountId: string
    organizerId: string
    blockResult: Record<string, number> | null
  }
) {
  const blockedRuns = input.blockResult?.settlement_runs ?? 0
  const blockedCharges = input.blockResult?.settlement_charges ?? 0
  if (blockedRuns + blockedCharges <= 0) return

  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const { data: recent, error: recentError } = await admin
    .from('settlement_runs')
    .select('id')
    .eq('blocked_stripe_account_id', input.accountId)
    .gt('stripe_account_recovery_notified_at', cutoff)
    .limit(1)

  if (recentError) throw new Error(`Failed to check Stripe recovery notification state: ${recentError.message}`)
  if (Array.isArray(recent) && recent.length > 0) return

  const { data: user, error: userError } = await admin
    .from('users')
    .select('email')
    .eq('id', input.organizerId)
    .maybeSingle()

  if (userError) throw new Error(`Failed to load organizer email for Stripe recovery notification: ${userError.message}`)

  const email = readString((user as Record<string, unknown> | null)?.email)
  if (!email) return

  try {
    await sendEmailNotification({
      to: email,
      subject: 'Action needed: your Stripe account needs attention',
      body: [
        'Stripe reported that your connected payout account needs attention before CHI settlement payments can continue.',
        'We paused affected settlement runs so venues cannot pay into an account that is restricted or disabled.',
        'Reconnect Stripe, then return to settlements to continue.',
      ].join('\n\n'),
      actionUrl: `${getConfiguredAppBaseUrl()}/planner/settings/stripe`,
    })

    await admin
      .from('settlement_runs')
      .update({ stripe_account_recovery_notified_at: new Date().toISOString() })
      .eq('blocked_stripe_account_id', input.accountId)
      .eq('status', 'blocked')
  } catch (error) {
    Sentry.captureException(error, { tags: { area: 'stripe_account_recovery_email' } })
  }
}

function readRpcCounts(data: unknown): Record<string, number> {
  if (!data || typeof data !== 'object') return {}
  return Object.fromEntries(
    Object.entries(data as Record<string, unknown>).map(([key, value]) => [
      key,
      typeof value === 'number' ? value : Number(value ?? 0),
    ])
  )
}

function getConfiguredAppBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://www.3rdplace.io')
  ).replace(/\/$/, '')
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
