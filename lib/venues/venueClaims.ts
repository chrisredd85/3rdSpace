import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/server'
import { verifyVenueClaimToken } from '@/lib/venues/venueInviteTokens'

export interface VenueClaimDetails {
  venue_id: string
  venue_name: string
  venue_type: string | null
  email: string
  contact_name: string | null
  contact_role: string | null
  claim_status: string
  organizer_user_id: string | null
  organizer_name: string
  organizer_email: string | null
  proposed_terms: {
    id: string
    amount_cents: number | null
    term_type: 'flat_rental' | 'minimum_spend' | 'per_head_chi' | 'bar_chi' | 'no_charge' | 'tbd'
    status: string
  } | null
  stripe_account: {
    stripe_account_id: string | null
    account_status: string | null
    charges_enabled: boolean
    payouts_enabled: boolean
  } | null
}

export interface ClaimInvitedVenueInput {
  token: string
  email: string
  password: string
  termDecision: 'accept' | 'counter'
  counterAmountCents?: number | null
}

export async function getVenueClaimDetails(token: string): Promise<{ ok: true; details: VenueClaimDetails } | { ok: false; error: string }> {
  const payload = verifyVenueClaimToken(token)
  if (!payload) return { ok: false, error: 'This venue invite link is invalid or expired.' }

  const admin = createServiceRoleClient() as any

  const { data: venue, error: venueError } = await admin
    .from('venues')
    .select('id, venue_name, venue_type, contact_email, contact_name, contact_role, invited_at, invited_by_user_id, claim_status, owner_id, claimed_user_id')
    .eq('id', payload.venue_id)
    .maybeSingle()

  if (venueError || !venue) {
    return { ok: false, error: 'This venue invite no longer exists.' }
  }

  if (String(venue.contact_email || '').toLowerCase() !== payload.email) {
    return { ok: false, error: 'This venue invite does not match the invite email.' }
  }

  if (venue.invited_at !== payload.invited_at) {
    return { ok: false, error: 'This venue invite was regenerated. Ask the organizer for the latest link.' }
  }

  const organizer = venue.invited_by_user_id
    ? await loadOrganizer(admin, venue.invited_by_user_id)
    : null

  const { data: termRows } = await admin
    .from('venue_term_agreements')
    .select('id, amount_cents, term_type, status')
    .eq('venue_id', venue.id)
    .eq('organizer_user_id', venue.invited_by_user_id)
    .order('created_at', { ascending: false })
    .limit(1)

  const terms = Array.isArray(termRows) ? termRows[0] : null
  const ownerId = readString(venue.owner_id) ?? readString(venue.claimed_user_id)
  const { data: stripeAccount } = ownerId
    ? await admin
        .from('venue_stripe_accounts')
        .select('stripe_account_id, account_status, charges_enabled, payouts_enabled')
        .eq('owner_id', ownerId)
        .maybeSingle()
    : { data: null }

  return {
    ok: true,
    details: {
      venue_id: venue.id,
      venue_name: venue.venue_name,
      venue_type: venue.venue_type,
      email: venue.contact_email,
      contact_name: venue.contact_name ?? null,
      contact_role: venue.contact_role ?? null,
      claim_status: venue.claim_status,
      organizer_user_id: venue.invited_by_user_id,
      organizer_name: organizer?.name || 'An organizer',
      organizer_email: organizer?.email || null,
      proposed_terms: terms
        ? {
            id: terms.id,
            amount_cents: typeof terms.amount_cents === 'number' ? terms.amount_cents : null,
            term_type: terms.term_type,
            status: terms.status,
          }
        : null,
      stripe_account: stripeAccount
        ? {
            stripe_account_id: stripeAccount.stripe_account_id ?? null,
            account_status: stripeAccount.account_status ?? null,
            charges_enabled: Boolean(stripeAccount.charges_enabled),
            payouts_enabled: Boolean(stripeAccount.payouts_enabled),
          }
        : null,
    },
  }
}

export async function claimInvitedVenue(input: ClaimInvitedVenueInput): Promise<{ ok: true; redirectTo: string } | { ok: false; error: string }> {
  const detailsResult = await getVenueClaimDetails(input.token)
  if (!detailsResult.ok) return detailsResult

  const details = detailsResult.details
  if (details.claim_status === 'invited_claimed') {
    return { ok: false, error: 'This venue invite has already been claimed.' }
  }

  const email = input.email.trim().toLowerCase()
  if (email !== details.email.toLowerCase()) {
    return { ok: false, error: 'Use the email address that received this invite.' }
  }

  if (!input.password || input.password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' }
  }

  const admin = createServiceRoleClient() as any
  const { data: existingAppUser, error: existingAppUserError } = await admin
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existingAppUserError) {
    return { ok: false, error: 'Could not check account availability.' }
  }

  if (existingAppUser) {
    return { ok: false, error: 'An account already exists for this email. Sign in, then ask the organizer to resend the invite.' }
  }

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      name: details.contact_name || details.venue_name,
      role: 'venue_owner',
      user_type: 'venue_owner',
      company_name: details.venue_name,
    },
  })

  if (authError || !authData?.user) {
    console.error('Error creating venue claim auth user:', authError)
    return { ok: false, error: authError?.message || 'Could not create venue account.' }
  }

  const userId = authData.user.id
  const { error: userError } = await admin
    .from('users')
    .insert({
      id: userId,
      email,
      role: 'owner',
      user_type: 'venue_owner',
      company_name: details.venue_name,
      email_verified: true,
    })

  if (userError && !isConflict(userError)) {
    await admin.auth.admin.deleteUser(userId)
    return { ok: false, error: `Could not create venue profile user: ${userError.message}` }
  }

  const now = new Date().toISOString()
  const { error: ownerProfileError } = await admin
    .from('owner_profiles')
    .upsert(
      {
        user_id: userId,
        name: details.contact_name || details.venue_name,
        business_name: details.venue_name,
        business_type: details.venue_type || 'venue',
        updated_at: now,
      },
      { onConflict: 'user_id' }
    )

  if (ownerProfileError) {
    await admin.auth.admin.deleteUser(userId)
    return { ok: false, error: `Could not prepare venue profile: ${ownerProfileError.message}` }
  }

  const { error: venueError } = await admin
    .from('venues')
    .update({
      owner_id: userId,
      claimed_user_id: userId,
      claim_status: 'invited_claimed',
      is_claimed: true,
      is_published: false,
      contact_email: email,
      updated_at: now,
    })
    .eq('id', details.venue_id)
    .eq('claim_status', 'invited_unclaimed')

  if (venueError) {
    await admin.auth.admin.deleteUser(userId)
    return { ok: false, error: `Could not claim venue listing: ${venueError.message}` }
  }

  if (details.proposed_terms) {
    if (input.termDecision === 'accept') {
      await admin
        .from('venue_term_agreements')
        .update({ status: 'confirmed', confirmed_at: now })
        .eq('id', details.proposed_terms.id)
    } else if (Number.isFinite(input.counterAmountCents) && Number(input.counterAmountCents) >= 0) {
      await admin
        .from('venue_term_agreements')
        .update({ amount_cents: Number(input.counterAmountCents), status: 'proposed', confirmed_at: null })
        .eq('id', details.proposed_terms.id)
    }
  }

  return { ok: true, redirectTo: '/venue/profile/complete?claim_complete=1' }
}

async function loadOrganizer(admin: any, userId: string) {
  const { data } = await admin
    .from('users')
    .select('id, email, name, company_name')
    .eq('id', userId)
    .maybeSingle()

  if (!data) return null
  return {
    id: data.id,
    email: data.email ?? null,
    name: data.company_name || data.name || data.email || 'An organizer',
  }
}

function isConflict(error: { code?: string | null }) {
  return error.code === '23505'
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}
