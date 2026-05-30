import 'server-only'

import Stripe from 'stripe'
import type { Json } from '@/lib/types/database'
import {
  getStripeAccountStatus,
  getStripeRequirementsDue,
} from '@/lib/stripe/connect'

type AnySupabaseClient = import('@supabase/supabase-js').SupabaseClient<any, any, any>

type ConnectAccountKind = 'venue' | 'vendor' | 'builder'

type ConnectAccountRow = {
  kind: ConnectAccountKind
  table: 'venue_stripe_accounts' | 'vendor_stripe_accounts' | 'builder_stripe_accounts'
  idField: 'owner_id' | 'vendor_id' | 'user_id'
  ownerId: string
  builderId?: string | null
  stripeAccountId: string
  requirementsDue: Record<string, unknown>
}

export type ConnectWebhookResult = {
  handled: boolean
  reason?: string
  accountId?: string
  accountKind?: ConnectAccountKind
}

export const CONNECT_WEBHOOK_EVENT_TYPES = new Set([
  'account.updated',
  'capability.updated',
  'payout.created',
  'payout.paid',
  'payout.failed',
])

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toObject(value: Json | null | undefined): Record<string, unknown> {
  return isObject(value) ? value : {}
}

function accountIdFromCapability(capability: Stripe.Capability) {
  const account = capability.account
  return typeof account === 'string' ? account : null
}

function accountIdFromPayout(payout: Stripe.Payout) {
  const account = (payout as Stripe.Payout & { account?: string }).account
  return typeof account === 'string' ? account : null
}

export function getConnectAccountId(event: Stripe.Event) {
  if (typeof event.account === 'string') return event.account

  if (event.type === 'account.updated') {
    const account = event.data.object as Stripe.Account
    return account.id
  }

  if (event.type === 'capability.updated') {
    return accountIdFromCapability(event.data.object as Stripe.Capability)
  }

  if (event.type.startsWith('payout.')) {
    return accountIdFromPayout(event.data.object as Stripe.Payout)
  }

  return null
}

export async function lookupConnectAccount(
  supabase: AnySupabaseClient,
  stripeAccountId: string
): Promise<ConnectAccountRow | null> {
  const { data: venue } = await supabase
    .from('venue_stripe_accounts')
    .select('owner_id, stripe_account_id, requirements_due')
    .eq('stripe_account_id', stripeAccountId)
    .maybeSingle()

  if (venue?.owner_id) {
    return {
      kind: 'venue',
      table: 'venue_stripe_accounts',
      idField: 'owner_id',
      ownerId: venue.owner_id,
      stripeAccountId,
      requirementsDue: toObject(venue.requirements_due),
    }
  }

  const { data: vendor } = await supabase
    .from('vendor_stripe_accounts')
    .select('vendor_id, stripe_account_id, requirements_due')
    .eq('stripe_account_id', stripeAccountId)
    .maybeSingle()

  if (vendor?.vendor_id) {
    return {
      kind: 'vendor',
      table: 'vendor_stripe_accounts',
      idField: 'vendor_id',
      ownerId: vendor.vendor_id,
      stripeAccountId,
      requirementsDue: toObject(vendor.requirements_due),
    }
  }

  const { data: builder } = await supabase
    .from('builder_stripe_accounts')
    .select('user_id, builder_id, stripe_account_id, requirements_due')
    .eq('stripe_account_id', stripeAccountId)
    .maybeSingle()

  if (builder?.user_id) {
    return {
      kind: 'builder',
      table: 'builder_stripe_accounts',
      idField: 'user_id',
      ownerId: builder.user_id,
      builderId: builder.builder_id ?? null,
      stripeAccountId,
      requirementsDue: toObject(builder.requirements_due),
    }
  }

  return null
}

function buildAccountRequirements(account: Stripe.Account, syncedAt: string) {
  const base = toObject(getStripeRequirementsDue(account))

  return {
    ...base,
    details_submitted: Boolean(account.details_submitted),
    disabled_reason: account.requirements?.disabled_reason ?? null,
    capabilities: account.capabilities ?? {},
    last_synced_at: syncedAt,
  }
}

async function mirrorConnectAccountStatus(
  supabase: AnySupabaseClient,
  row: ConnectAccountRow,
  stripeAccountId: string,
  payoutsEnabled: boolean,
  syncedAt: string
) {
  if (row.kind === 'venue') {
    await supabase
      .from('owner_profiles')
      .update({
        stripe_account_id: stripeAccountId,
        payout_enabled: payoutsEnabled,
        updated_at: syncedAt,
      })
      .eq('user_id', row.ownerId)
    return
  }

  if (row.kind === 'vendor') {
    await supabase
      .from('vendor_profiles')
      .update({
        stripe_account_id: stripeAccountId,
        payout_enabled: payoutsEnabled,
        updated_at: syncedAt,
      })
      .eq('id', row.ownerId)
  }
}

export async function handleConnectAccountUpdated(
  supabase: AnySupabaseClient,
  account: Stripe.Account,
  accountId = account.id
): Promise<ConnectWebhookResult> {
  const row = await lookupConnectAccount(supabase, accountId)
  if (!row) {
    console.warn('[stripe.connect.webhook] account.updated for unknown account', { accountId })
    return { handled: false, reason: 'unknown_account', accountId }
  }

  const syncedAt = new Date().toISOString()
  const payoutsEnabled = Boolean(account.payouts_enabled)

  const { error } = await supabase
    .from(row.table)
    .update({
      charges_enabled: Boolean(account.charges_enabled),
      payouts_enabled: payoutsEnabled,
      account_status: getStripeAccountStatus(account),
      requirements_due: buildAccountRequirements(account, syncedAt),
      updated_at: syncedAt,
    })
    .eq('stripe_account_id', accountId)

  if (error) {
    throw new Error(`Failed to update ${row.table}: ${error.message}`)
  }

  await mirrorConnectAccountStatus(supabase, row, accountId, payoutsEnabled, syncedAt)

  return { handled: true, accountId, accountKind: row.kind }
}

export async function handleConnectCapabilityUpdated(
  supabase: AnySupabaseClient,
  capability: Stripe.Capability,
  accountId: string
): Promise<ConnectWebhookResult> {
  const row = await lookupConnectAccount(supabase, accountId)
  if (!row) {
    console.warn('[stripe.connect.webhook] capability.updated for unknown account', {
      accountId,
      capabilityId: capability.id,
    })
    return { handled: false, reason: 'unknown_account', accountId }
  }

  const syncedAt = new Date().toISOString()
  const existingCapabilities = isObject(row.requirementsDue.capabilities)
    ? row.requirementsDue.capabilities
    : {}

  const { error } = await supabase
    .from(row.table)
    .update({
      requirements_due: {
        ...row.requirementsDue,
        capabilities: {
          ...existingCapabilities,
          [capability.id]: capability.status,
        },
        last_capability_event: {
          id: capability.id,
          status: capability.status,
          updated_at: syncedAt,
        },
        last_synced_at: syncedAt,
      },
      updated_at: syncedAt,
    })
    .eq('stripe_account_id', accountId)

  if (error) {
    throw new Error(`Failed to update ${row.table}: ${error.message}`)
  }

  return { handled: true, accountId, accountKind: row.kind }
}

export async function handleConnectPayoutEvent(
  supabase: AnySupabaseClient,
  payout: Stripe.Payout,
  eventType: 'payout.created' | 'payout.paid' | 'payout.failed',
  accountId: string
): Promise<ConnectWebhookResult> {
  const row = await lookupConnectAccount(supabase, accountId)
  if (!row) {
    console.warn('[stripe.connect.webhook] payout event for unknown account', {
      accountId,
      payoutId: payout.id,
      eventType,
    })
    return { handled: false, reason: 'unknown_account', accountId }
  }

  const syncedAt = new Date().toISOString()
  const failed = eventType === 'payout.failed'
  const failureReason =
    payout.failure_message ||
    payout.failure_code ||
    (failed ? 'payout_failed' : null)

  const requirementsDue = {
    ...row.requirementsDue,
    ...(failed ? { disabled_reason: failureReason } : {}),
    latest_payout: {
      id: payout.id,
      status: payout.status,
      amount: payout.amount,
      currency: payout.currency,
      arrival_date: payout.arrival_date ?? null,
      failure_code: payout.failure_code ?? null,
      failure_message: payout.failure_message ?? null,
      event_type: eventType,
      updated_at: syncedAt,
    },
    last_synced_at: syncedAt,
  }

  const { error } = await supabase
    .from(row.table)
    .update({
      ...(failed
        ? {
            account_status: 'restricted',
            payouts_enabled: false,
          }
        : {}),
      requirements_due: requirementsDue,
      updated_at: syncedAt,
    })
    .eq('stripe_account_id', accountId)

  if (error) {
    throw new Error(`Failed to update ${row.table}: ${error.message}`)
  }

  if (failed) {
    await mirrorConnectAccountStatus(supabase, row, accountId, false, syncedAt)
  }

  console.log('[stripe.connect.webhook] payout event observed', {
    accountId,
    accountKind: row.kind,
    payoutId: payout.id,
    eventType,
    status: payout.status,
  })

  return { handled: true, accountId, accountKind: row.kind }
}
