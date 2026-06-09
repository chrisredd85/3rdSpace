/**
 * Stripe Connect helpers — SERVER ONLY
 *
 * This module is wired up and functional but payment collection is intentionally
 * disabled in the UI until Stripe keys are configured in production.
 * The database schemas (vendor_stripe_accounts, venue_stripe_accounts,
 * builder_stripe_accounts) and
 * helper functions here are ready; live flows need STRIPE_SECRET_KEY +
 * NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
 * to be set to go live.
 *
 * @see components/shared/StripeIntegrationNotice.tsx — renders the "coming soon" badge
 */
import 'server-only'

import Stripe from 'stripe'
type AnySupabaseClient = import('@supabase/supabase-js').SupabaseClient<any, any, any>
import type { Json } from '@/lib/types/database'

export type ConnectedStripeAccountStatus =
  | 'pending'
  | 'pending_onboarding'
  | 'onboarding_started'
  | 'capabilities_pending'
  | 'active'
  | 'complete'
  | 'restricted'
  | 'disabled'
export type VendorStripeAccountStatus = ConnectedStripeAccountStatus

export type VendorStripeAccountRecord = {
  id?: string
  vendor_id: string
  stripe_account_id: string | null
  account_status: ConnectedStripeAccountStatus
  charges_enabled: boolean
  payouts_enabled: boolean
  requirements_due: Json
  created_at?: string
  updated_at?: string
}

export type VenueStripeAccountRecord = {
  id?: string
  owner_id: string
  stripe_account_id: string | null
  account_status: ConnectedStripeAccountStatus
  charges_enabled: boolean
  payouts_enabled: boolean
  requirements_due: Json
  created_at?: string
  updated_at?: string
}

export type BuilderStripeAccountRecord = {
  id?: string
  user_id: string
  builder_id: string | null
  stripe_account_id: string | null
  account_status: ConnectedStripeAccountStatus
  charges_enabled: boolean
  payouts_enabled: boolean
  requirements_due: Json
  created_at?: string
  updated_at?: string
}

let stripeClient: Stripe | null = null

export function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }

  if (!stripeClient) {
    stripeClient = new Stripe(secretKey, {
      apiVersion: '2023-10-16',
      typescript: true,
    })
  }

  return stripeClient
}

export function getAppBaseUrl(request: Request) {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`

  return new URL(request.url).origin
}

export function getStripeAccountStatus(account: Stripe.Account): ConnectedStripeAccountStatus {
  if (account.charges_enabled && account.payouts_enabled) return 'active'
  if (account.requirements?.disabled_reason) return 'disabled'
  if ((account.requirements?.past_due?.length ?? 0) > 0) {
    return 'restricted'
  }

  if (!account.details_submitted) return 'pending_onboarding'
  if (
    (account.requirements?.currently_due?.length ?? 0) > 0 ||
    (account.requirements?.eventually_due?.length ?? 0) > 0 ||
    (account.requirements?.pending_verification?.length ?? 0) > 0
  ) {
    return 'capabilities_pending'
  }

  return 'onboarding_started'
}

export function getLegacyStripeAccountStatus(status: ConnectedStripeAccountStatus): 'pending' | 'active' | 'restricted' {
  // During schema rollout, preview/prod can briefly run against the older DB constraint.
  // These legacy values preserve money-movement safety: not-ready stays pending and blocked stays restricted.
  if (status === 'active' || status === 'complete') return 'active'
  if (status === 'restricted' || status === 'disabled') return 'restricted'

  return 'pending'
}

function isStripeAccountStatusConstraintError(error: { message?: string } | null) {
  return Boolean(
    error?.message &&
      /violates check constraint/i.test(error.message) &&
      /stripe_accounts_status_check/i.test(error.message)
  )
}

export function isConnectedStripeAccountBlocked(status: string | null | undefined) {
  return status === 'restricted' || status === 'disabled'
}

export function getStripeRequirementsDue(account: Stripe.Account): Json {
  const requirements = account.requirements

  return {
    currently_due: requirements?.currently_due ?? [],
    eventually_due: requirements?.eventually_due ?? [],
    past_due: requirements?.past_due ?? [],
    pending_verification: requirements?.pending_verification ?? [],
    disabled_reason: requirements?.disabled_reason ?? null,
  }
}

export function getStripeCompletionPercent(account: Stripe.Account) {
  if (account.charges_enabled && account.payouts_enabled) return 100

  const requirementCount = [
    ...(account.requirements?.currently_due ?? []),
    ...(account.requirements?.past_due ?? []),
  ].length

  if (requirementCount === 0) return account.details_submitted ? 80 : 45

  return Math.max(20, 90 - requirementCount * 10)
}

export function mapStripeAccount(
  vendorId: string,
  account: Stripe.Account
): VendorStripeAccountRecord {
  return {
    vendor_id: vendorId,
    stripe_account_id: account.id,
    account_status: getStripeAccountStatus(account),
    charges_enabled: Boolean(account.charges_enabled),
    payouts_enabled: Boolean(account.payouts_enabled),
    requirements_due: getStripeRequirementsDue(account),
  }
}

export function mapVenueStripeAccount(
  ownerId: string,
  account: Stripe.Account
): VenueStripeAccountRecord {
  return {
    owner_id: ownerId,
    stripe_account_id: account.id,
    account_status: getStripeAccountStatus(account),
    charges_enabled: Boolean(account.charges_enabled),
    payouts_enabled: Boolean(account.payouts_enabled),
    requirements_due: getStripeRequirementsDue(account),
  }
}

export function mapBuilderStripeAccount(
  userId: string,
  builderId: string | null,
  account: Stripe.Account
): BuilderStripeAccountRecord {
  return {
    user_id: userId,
    builder_id: builderId,
    stripe_account_id: account.id,
    account_status: getStripeAccountStatus(account),
    charges_enabled: Boolean(account.charges_enabled),
    payouts_enabled: Boolean(account.payouts_enabled),
    requirements_due: getStripeRequirementsDue(account),
  }
}

export async function saveVendorStripeAccount(
  supabase: AnySupabaseClient,
  vendorId: string,
  account: Stripe.Account
) {
  const payload = mapStripeAccount(vendorId, account)
  const updatedAt = new Date().toISOString()

  let { data, error } = await supabase
    .from('vendor_stripe_accounts')
    .upsert(
      {
        ...payload,
        updated_at: updatedAt,
      },
      { onConflict: 'vendor_id' }
    )
    .select('*')
    .single()

  if (isStripeAccountStatusConstraintError(error)) {
    ;({ data, error } = await supabase
      .from('vendor_stripe_accounts')
      .upsert(
        {
          ...payload,
          account_status: getLegacyStripeAccountStatus(payload.account_status),
          updated_at: updatedAt,
        },
        { onConflict: 'vendor_id' }
      )
      .select('*')
      .single())
  }

  if (error) {
    throw new Error(`Failed to save Stripe account: ${error.message}`)
  }

  const { error: mirrorError } = await supabase
    .from('vendor_profiles')
    .update({
      stripe_account_id: account.id,
      payout_enabled: Boolean(account.payouts_enabled),
      updated_at: new Date().toISOString(),
    })
    .eq('id', vendorId)

  if (mirrorError) {
    throw new Error(`Failed to update vendor Stripe account mirror: ${mirrorError.message}`)
  }

  return data as VendorStripeAccountRecord
}

export async function saveVenueStripeAccount(
  supabase: AnySupabaseClient,
  ownerId: string,
  account: Stripe.Account
) {
  const payload = mapVenueStripeAccount(ownerId, account)
  const updatedAt = new Date().toISOString()

  let { data, error } = await supabase
    .from('venue_stripe_accounts')
    .upsert(
      {
        ...payload,
        updated_at: updatedAt,
      },
      { onConflict: 'owner_id' }
    )
    .select('*')
    .single()

  if (isStripeAccountStatusConstraintError(error)) {
    ;({ data, error } = await supabase
      .from('venue_stripe_accounts')
      .upsert(
        {
          ...payload,
          account_status: getLegacyStripeAccountStatus(payload.account_status),
          updated_at: updatedAt,
        },
        { onConflict: 'owner_id' }
      )
      .select('*')
      .single())
  }

  if (error) {
    throw new Error(`Failed to save Stripe account: ${error.message}`)
  }

  const { error: mirrorError } = await supabase
    .from('owner_profiles')
    .update({
      stripe_account_id: account.id,
      payout_enabled: Boolean(account.payouts_enabled),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', ownerId)

  if (mirrorError) {
    throw new Error(`Failed to update venue Stripe account mirror: ${mirrorError.message}`)
  }

  return data as VenueStripeAccountRecord
}

export async function saveBuilderStripeAccount(
  supabase: AnySupabaseClient,
  userId: string,
  builderId: string | null,
  account: Stripe.Account
) {
  const payload = mapBuilderStripeAccount(userId, builderId, account)
  const updatedAt = new Date().toISOString()

  let { data, error } = await supabase
    .from('builder_stripe_accounts')
    .upsert(
      {
        ...payload,
        updated_at: updatedAt,
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single()

  if (isStripeAccountStatusConstraintError(error)) {
    ;({ data, error } = await supabase
      .from('builder_stripe_accounts')
      .upsert(
        {
          ...payload,
          account_status: getLegacyStripeAccountStatus(payload.account_status),
          updated_at: updatedAt,
        },
        { onConflict: 'user_id' }
      )
      .select('*')
      .single())
  }

  if (error) {
    throw new Error(`Failed to save Stripe account: ${error.message}`)
  }

  return data as BuilderStripeAccountRecord
}

export async function getAuthenticatedVendor(supabase: AnySupabaseClient) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      user: null,
      vendor: null,
      error: 'Not authenticated',
      status: 401,
    }
  }

  const { data: vendor, error: vendorError } = await supabase
    .from('vendor_profiles')
    .select('id, name, user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (vendorError || !vendor) {
    return {
      user,
      vendor: null,
      error: 'Vendor profile not found',
      status: 404,
    }
  }

  return {
    user,
    vendor: vendor as { id: string; name?: string | null; user_id: string },
    error: null,
    status: 200,
  }
}

export async function getAuthenticatedVenueOwner(supabase: AnySupabaseClient) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      user: null,
      owner: null,
      error: 'Not authenticated',
      status: 401,
    }
  }

  const { data: account, error: accountError } = await supabase
    .from('users')
    .select('id, email, company_name, role, user_type')
    .eq('id', user.id)
    .maybeSingle()

  if (accountError || !account) {
    return {
      user,
      owner: null,
      error: 'Venue owner account not found',
      status: accountError ? 500 : 404,
    }
  }

  const ownerAccount = account as {
    id: string
    email: string
    company_name?: string | null
    role?: string | null
    user_type?: string | null
  }
  const isVenueOwner = ownerAccount.role === 'owner' || ownerAccount.user_type === 'venue_owner'

  if (!isVenueOwner) {
    return {
      user,
      owner: null,
      error: 'Venue owner access required',
      status: 403,
    }
  }

  const { data: venue } = await supabase
    .from('venues')
    .select('venue_name')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return {
    user,
    owner: {
      id: ownerAccount.id,
      email: ownerAccount.email,
      company_name: ownerAccount.company_name,
      venue_name: (venue as { venue_name?: string | null } | null)?.venue_name ?? null,
    },
    error: null,
    status: 200,
  }
}

export async function getAuthenticatedBuilderPayoutOwner(supabase: AnySupabaseClient) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      user: null,
      builder: null,
      error: 'Not authenticated',
      status: 401,
    }
  }

  const { data: builder, error: builderError } = await supabase
    .from('builder_profiles')
    .select('id, user_id, name')
    .eq('user_id', user.id)
    .maybeSingle()

  if (builderError || !builder) {
    return {
      user,
      builder: null,
      error: 'Builder profile not found',
      status: builderError ? 500 : 404,
    }
  }

  return {
    user,
    builder: builder as { id: string; user_id: string; name?: string | null },
    error: null,
    status: 200,
  }
}
