import 'server-only'

type SupabaseAdminClient = { from: (table: string) => any }

export type GateBlockReason =
  | 'no_account'
  | 'onboarding_incomplete'
  | 'restricted'
  | 'disabled'
  | 'deauthorized'

export type StripeReadinessGate =
  | { ready: true; account_id: string }
  | {
      ready: false
      reason: GateBlockReason
      account_id: string | null
      needs_action_by: 'organizer' | 'venue' | 'vendor'
    }

export type AuthorizationGateTarget = {
  entityType: 'organizer' | 'venue' | 'vendor'
  entityId: string
}

type StripeAccountRow = {
  stripe_account_id: string | null
  account_status: string | null
  charges_enabled: boolean | null
  payouts_enabled: boolean | null
  disabled_reason?: string | null
}

export async function checkStripeReadinessForAuthorization(opts: {
  supabase: SupabaseAdminClient
  entityType: 'organizer' | 'venue' | 'vendor'
  entityId: string
}): Promise<StripeReadinessGate> {
  const resolved = await resolveStripeAccountLookup(opts.supabase, opts.entityType, opts.entityId)
  if (!resolved) {
    return {
      ready: false,
      reason: 'no_account',
      account_id: null,
      needs_action_by: opts.entityType,
    }
  }

  const account = resolved.account
  if (!account?.stripe_account_id) {
    return {
      ready: false,
      reason: 'no_account',
      account_id: null,
      needs_action_by: opts.entityType,
    }
  }

  const status = normalizeStatus(account.account_status)
  const disabledReason = normalizeStatus(account.disabled_reason)
  if (status === 'disabled' || disabledReason.includes('deauthorized') || disabledReason.includes('application_deauthorized')) {
    return {
      ready: false,
      reason: disabledReason.includes('deauthorized') ? 'deauthorized' : 'disabled',
      account_id: account.stripe_account_id,
      needs_action_by: opts.entityType,
    }
  }

  if (status === 'restricted') {
    return {
      ready: false,
      reason: 'restricted',
      account_id: account.stripe_account_id,
      needs_action_by: opts.entityType,
    }
  }

  const chargesReady = account.charges_enabled !== false
  const payoutsReady = account.payouts_enabled === true
  const statusReady = status.length === 0 || isReadyStatus(status)

  if (!chargesReady || !payoutsReady || !statusReady) {
    return {
      ready: false,
      reason: 'onboarding_incomplete',
      account_id: account.stripe_account_id,
      needs_action_by: opts.entityType,
    }
  }

  return { ready: true, account_id: account.stripe_account_id }
}

export async function checkAuthorizationActionStripeGate(opts: {
  supabase: SupabaseAdminClient
  actionType?: string | null
  targetType?: string | null
  targetId?: string | null
  amountCents?: number | null
  payload?: unknown
  resultMetadata?: unknown
}): Promise<{ target: AuthorizationGateTarget; gate: StripeReadinessGate } | null> {
  const target = resolveAuthorizationGateTarget(opts)
  if (!target) return null
  const gate = await checkStripeReadinessForAuthorization({
    supabase: opts.supabase,
    entityType: target.entityType,
    entityId: target.entityId,
  })
  return { target, gate }
}

export function resolveAuthorizationGateTarget(input: {
  actionType?: string | null
  targetType?: string | null
  targetId?: string | null
  amountCents?: number | null
  payload?: unknown
  resultMetadata?: unknown
}): AuthorizationGateTarget | null {
  const payload = readRecord(input.payload)
  const metadata = readRecord(input.resultMetadata)
  const executionMode = normalizeStatus(
    readString(metadata?.execution_mode) ??
      readString(payload?.execution_mode) ??
      readString(payload?.executionMode),
  )
  const actionType = normalizeStatus(input.actionType)
  const targetType = normalizeStatus(input.targetType ?? readString(payload?.target_type) ?? readString(payload?.targetType))
  const amountCents = readNumber(input.amountCents) ?? readNumber(payload?.amount_cents) ?? readNumber(payload?.requested_amount_cents)

  const paymentLike =
    executionMode === 'controlled_payment' ||
    actionType === 'payment' ||
    actionType === 'hold' ||
    readBoolean(payload?.requires_stripe_recipient) === true ||
    readBoolean(payload?.has_controlled_payment_account) === true ||
    (typeof amountCents === 'number' && amountCents > 0 && readBoolean(payload?.payment_required) === true)

  if (!paymentLike) return null

  const venueId = firstString([
    input.targetType && /venue/.test(targetType) ? input.targetId : null,
    readString(payload?.venue_id),
    readString(payload?.venueId),
    readString(payload?.venue_owner_id),
    readString(payload?.venueOwnerId),
    readString(payload?.claimed_venue_id),
    readString(payload?.claimedVenueId),
  ])
  if (venueId) return { entityType: 'venue', entityId: venueId }

  const vendorId = firstString([
    input.targetType && /vendor/.test(targetType) ? input.targetId : null,
    readString(payload?.vendor_id),
    readString(payload?.vendorId),
    readString(payload?.vendor_profile_id),
    readString(payload?.vendorProfileId),
  ])
  if (vendorId) return { entityType: 'vendor', entityId: vendorId }

  const organizerId = firstString([
    input.targetType && /(organizer|builder|settlement_run)/.test(targetType) ? input.targetId : null,
    readString(payload?.organizer_id),
    readString(payload?.organizerId),
    readString(payload?.builder_id),
    readString(payload?.builderId),
  ])
  if (organizerId && (actionType === 'payment' || targetType === 'settlement_run')) {
    return { entityType: 'organizer', entityId: organizerId }
  }

  return null
}

export function getStripeGateErrorMessage(input: {
  entityType: 'organizer' | 'venue' | 'vendor'
  entityName?: string | null
  reason: GateBlockReason
}) {
  const name = input.entityName ?? (input.entityType === 'venue' ? 'The venue' : input.entityType === 'vendor' ? 'The vendor' : 'The organizer')
  switch (input.reason) {
    case 'no_account':
      return `${name} hasn't connected Stripe yet.`
    case 'onboarding_incomplete':
      return `${name} needs to finish Stripe onboarding.`
    case 'restricted':
      return `Stripe has placed ${name}'s account on hold pending verification.`
    case 'disabled':
      return `${name}'s Stripe account is disabled.`
    case 'deauthorized':
      return `${name} disconnected their Stripe account.`
  }
}

async function resolveStripeAccountLookup(
  supabase: SupabaseAdminClient,
  entityType: 'organizer' | 'venue' | 'vendor',
  entityId: string,
): Promise<{ account: StripeAccountRow | null; canonicalEntityId: string } | null> {
  if (entityType === 'organizer') {
    const account = await loadStripeAccount(supabase, 'builder_stripe_accounts', 'user_id', entityId)
    if (account) return { account, canonicalEntityId: entityId }

    const byBuilder = await loadStripeAccount(supabase, 'builder_stripe_accounts', 'builder_id', entityId)
    return byBuilder ? { account: byBuilder, canonicalEntityId: entityId } : null
  }

  if (entityType === 'vendor') {
    const account = await loadStripeAccount(supabase, 'vendor_stripe_accounts', 'vendor_id', entityId)
    return { account, canonicalEntityId: entityId }
  }

  const directAccount = await loadStripeAccount(supabase, 'venue_stripe_accounts', 'owner_id', entityId)
  if (directAccount) return { account: directAccount, canonicalEntityId: entityId }

  const venue = await loadVenueOwner(supabase, entityId)
  if (venue?.owner_id) {
    const account = await loadStripeAccount(supabase, 'venue_stripe_accounts', 'owner_id', venue.owner_id)
    return { account, canonicalEntityId: venue.id }
  }

  const discoveryVenue = await loadDiscoveryVenueClaim(supabase, entityId)
  if (discoveryVenue?.claimed_venue_id) {
    const claimedVenue = await loadVenueOwner(supabase, discoveryVenue.claimed_venue_id)
    if (claimedVenue?.owner_id) {
      const account = await loadStripeAccount(supabase, 'venue_stripe_accounts', 'owner_id', claimedVenue.owner_id)
      return { account, canonicalEntityId: claimedVenue.id }
    }
  }

  return null
}

async function loadStripeAccount(
  supabase: SupabaseAdminClient,
  table: 'builder_stripe_accounts' | 'venue_stripe_accounts' | 'vendor_stripe_accounts',
  column: string,
  value: string,
): Promise<StripeAccountRow | null> {
  const { data, error } = await supabase
    .from(table)
    .select('stripe_account_id, account_status, charges_enabled, payouts_enabled, disabled_reason')
    .eq(column, value)
    .maybeSingle()

  if (error) throw new Error(error.message ?? `Failed to load ${table}`)
  return (data as StripeAccountRow | null) ?? null
}

async function loadVenueOwner(supabase: SupabaseAdminClient, venueId: string): Promise<{ id: string; owner_id: string | null } | null> {
  const { data, error } = await supabase
    .from('venues')
    .select('id, owner_id')
    .eq('id', venueId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load venue owner')
  return (data as { id: string; owner_id: string | null } | null) ?? null
}

async function loadDiscoveryVenueClaim(
  supabase: SupabaseAdminClient,
  discoveryVenueId: string,
): Promise<{ claimed_venue_id: string | null } | null> {
  const { data, error } = await supabase
    .from('discovery_venues')
    .select('claimed_venue_id')
    .eq('id', discoveryVenueId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Failed to load discovery venue claim')
  return (data as { claimed_venue_id: string | null } | null) ?? null
}

function isReadyStatus(status: string) {
  return status === 'active' || status === 'complete' || status === 'connected' || status === 'ready'
}

function normalizeStatus(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function firstString(values: Array<string | null | undefined>) {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Number(value))) return Number(value)
  return null
}
