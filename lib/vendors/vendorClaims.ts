import 'server-only'

import { sendEmailNotification } from '@/lib/email'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { verifyVendorClaimToken } from '@/lib/vendors/vendorInviteTokens'

export interface VendorClaimDetails {
  vendor_id: string
  vendor_name: string
  service_type: string | null
  email: string
  claim_status: string
  organizer_user_id: string | null
  organizer_name: string
  organizer_email: string | null
  proposed_rate: {
    id: string
    amount: number
    rate_type: 'flat' | 'per_person' | 'hourly'
    status: string
  } | null
}

export interface ClaimInvitedVendorInput {
  token: string
  email: string
  password: string
  rateDecision: 'accept' | 'counter'
  counterAmount?: number | null
  publicBaseRateAmount: number
  publicRateType: 'flat' | 'per_person' | 'hourly'
}

export async function getVendorClaimDetails(token: string): Promise<{ ok: true; details: VendorClaimDetails } | { ok: false; error: string }> {
  const payload = verifyVendorClaimToken(token)
  if (!payload) return { ok: false, error: 'This vendor invite link is invalid or expired.' }

  const admin = createServiceRoleClient() as any

  const { data: vendor, error: vendorError } = await admin
    .from('vendor_profiles')
    .select('id, name, service_type, contact_email, invited_at, invited_by_user_id, claim_status')
    .eq('id', payload.vendor_id)
    .maybeSingle()

  if (vendorError || !vendor) {
    return { ok: false, error: 'This vendor invite no longer exists.' }
  }

  if (String(vendor.contact_email || '').toLowerCase() !== payload.email) {
    return { ok: false, error: 'This vendor invite does not match the invite email.' }
  }

  if (vendor.invited_at !== payload.invited_at) {
    return { ok: false, error: 'This vendor invite was regenerated. Ask the organizer for the latest link.' }
  }

  const organizer = vendor.invited_by_user_id
    ? await loadOrganizer(admin, vendor.invited_by_user_id)
    : null

  const { data: rateRows } = await admin
    .from('vendor_rate_agreements')
    .select('id, amount, rate_type, status')
    .eq('vendor_id', vendor.id)
    .eq('organizer_user_id', vendor.invited_by_user_id)
    .order('created_at', { ascending: false })
    .limit(1)

  const rate = Array.isArray(rateRows) ? rateRows[0] : null

  return {
    ok: true,
    details: {
      vendor_id: vendor.id,
      vendor_name: vendor.name,
      service_type: vendor.service_type,
      email: vendor.contact_email,
      claim_status: vendor.claim_status,
      organizer_user_id: vendor.invited_by_user_id,
      organizer_name: organizer?.name || 'An organizer',
      organizer_email: organizer?.email || null,
      proposed_rate: rate
        ? {
            id: rate.id,
            amount: Number(rate.amount),
            rate_type: rate.rate_type,
            status: rate.status,
          }
        : null,
    },
  }
}

export async function claimInvitedVendor(input: ClaimInvitedVendorInput): Promise<{ ok: true; redirectTo: string } | { ok: false; error: string }> {
  const detailsResult = await getVendorClaimDetails(input.token)
  if (!detailsResult.ok) return detailsResult

  const details = detailsResult.details
  if (details.claim_status === 'invited_claimed') {
    return { ok: false, error: 'This vendor invite has already been claimed.' }
  }

  const email = input.email.trim().toLowerCase()
  if (email !== details.email.toLowerCase()) {
    return { ok: false, error: 'Use the email address that received this invite.' }
  }

  if (!input.password || input.password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' }
  }

  if (!Number.isFinite(input.publicBaseRateAmount) || input.publicBaseRateAmount <= 0) {
    return { ok: false, error: 'Enter a public base rate greater than 0.' }
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
      name: details.vendor_name,
      role: 'vendor',
      user_type: 'vendor',
      company_name: details.vendor_name,
    },
  })

  if (authError || !authData?.user) {
    console.error('Error creating vendor claim auth user:', authError)
    return { ok: false, error: authError?.message || 'Could not create vendor account.' }
  }

  const userId = authData.user.id
  const { error: userError } = await admin
    .from('users')
    .insert({
      id: userId,
      email,
      role: 'vendor',
      user_type: 'vendor',
      company_name: details.vendor_name,
      email_verified: true,
    })

  if (userError && !isConflict(userError)) {
    await admin.auth.admin.deleteUser(userId)
    return { ok: false, error: `Could not create vendor profile user: ${userError.message}` }
  }

  const publicBaseRateCents = Math.round(input.publicBaseRateAmount * 100)
  const { error: vendorError } = await admin
    .from('vendor_profiles')
    .update({
      user_id: userId,
      claimed_user_id: userId,
      claim_status: 'invited_claimed',
      is_claimed: true,
      is_published: true,
      base_rate: publicBaseRateCents,
      pricing_model: input.publicRateType === 'flat' ? 'flat_rate' : input.publicRateType,
      contact_email: email,
    })
    .eq('id', details.vendor_id)
    .eq('claim_status', 'invited_unclaimed')

  if (vendorError) {
    await admin.auth.admin.deleteUser(userId)
    return { ok: false, error: `Could not claim vendor listing: ${vendorError.message}` }
  }

  if (details.proposed_rate) {
    if (input.rateDecision === 'accept') {
      await admin
        .from('vendor_rate_agreements')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
        .eq('id', details.proposed_rate.id)
    } else {
      const counterAmount = input.counterAmount
      if (Number.isFinite(counterAmount) && Number(counterAmount) > 0) {
        await admin
          .from('vendor_rate_agreements')
          .update({ amount: Number(counterAmount).toFixed(2), status: 'proposed', confirmed_at: null })
          .eq('id', details.proposed_rate.id)

        if (details.organizer_email) {
          await sendEmailNotification({
            to: details.organizer_email,
            subject: `${details.vendor_name} countered your private rate`,
            body: `${details.vendor_name} countered the private booking rate at $${Number(counterAmount).toFixed(0)} ${formatRateType(details.proposed_rate.rate_type)}.`,
            templateType: 'generic',
          })
        }
      }
    }
  }

  return { ok: true, redirectTo: '/vendor' }
}

async function loadOrganizer(admin: any, organizerUserId: string) {
  const { data } = await admin
    .from('users')
    .select('email, company_name')
    .eq('id', organizerUserId)
    .maybeSingle()

  if (!data) return null
  return {
    name: data.company_name || data.email,
    email: data.email,
  }
}

function isConflict(error: { code?: string; message?: string }) {
  return error.code === '23505' || /duplicate key|unique constraint/i.test(error.message || '')
}

function formatRateType(rateType: string) {
  if (rateType === 'per_person') return 'per person'
  if (rateType === 'hourly') return 'per hour'
  return 'flat'
}
