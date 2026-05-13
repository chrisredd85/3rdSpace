'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { sendEmailNotification } from '@/lib/email'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { ServiceType } from '@/lib/types'
import { createVendorClaimToken } from '@/lib/vendors/vendorInviteTokens'

const SERVICE_TYPES = ['dj', 'catering', 'bartending', 'photography', 'videography', 'av_tech', 'event_planning', 'florist', 'other'] as const
const RATE_TYPES = ['flat', 'per_person', 'hourly'] as const

const inviteVendorSchema = z.object({
  vendorName: z.string().trim().min(1, 'Vendor name is required'),
  email: z.string().trim().email('Enter a valid email address'),
  phone: z.string().trim().optional().nullable(),
  serviceType: z.enum(SERVICE_TYPES),
  rateType: z.enum(RATE_TYPES),
  proposedRateAmount: z.coerce.number().positive('Proposed rate must be greater than 0'),
  planId: z.string().uuid().optional().nullable(),
})

export interface InviteVendorInput {
  vendorName: string
  email: string
  phone?: string | null
  serviceType: ServiceType
  rateType: 'flat' | 'per_person' | 'hourly'
  proposedRateAmount: number
  planId?: string | null
}

export interface InviteVendorResult {
  ok: boolean
  error?: string
  vendorId?: string
  relationshipId?: string | null
  rateAgreementId?: string | null
  claimUrl?: string
  emailSent?: boolean
  existing?: boolean
}

export async function inviteVendor(input: InviteVendorInput): Promise<InviteVendorResult> {
  const parsed = inviteVendorSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || 'Invite details are invalid' }
  }

  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { ok: false, error: 'Sign in to invite vendors.' }
  }

  const admin = createServiceRoleClient() as any
  const sourceEventId = await getPlanSourceEventId(admin, user.id, parsed.data.planId)

  const { data: inviteRows, error: inviteError } = await admin.rpc('create_vendor_invite', {
    p_organizer_user_id: user.id,
    p_vendor_name: parsed.data.vendorName,
    p_email: parsed.data.email,
    p_phone: parsed.data.phone || null,
    p_service_type: parsed.data.serviceType,
    p_rate_type: parsed.data.rateType,
    p_amount: parsed.data.proposedRateAmount,
    p_source_event_id: sourceEventId,
  })

  if (inviteError) {
    console.error('Error creating vendor invite:', inviteError)
    return { ok: false, error: inviteError.message || 'Could not create vendor invite.' }
  }

  const inviteRow = Array.isArray(inviteRows) ? inviteRows[0] : inviteRows
  if (!inviteRow?.vendor_id) {
    return { ok: false, error: 'Vendor invite did not return a vendor id.' }
  }

  const { data: vendor, error: vendorError } = await admin
    .from('vendor_profiles')
    .select('id, name, contact_email, invited_at')
    .eq('id', inviteRow.vendor_id)
    .single()

  if (vendorError || !vendor?.contact_email || !vendor.invited_at) {
    console.error('Error loading invited vendor:', vendorError)
    return { ok: false, error: 'Vendor invite was created, but the claim link could not be generated.' }
  }

  const token = createVendorClaimToken({
    vendorId: vendor.id,
    email: vendor.contact_email,
    invitedAt: vendor.invited_at,
  })
  const claimUrl = `${getOrigin()}/vendor/claim?token=${encodeURIComponent(token)}`

  const emailResult = await sendEmailNotification({
    to: vendor.contact_email,
    subject: `${user.email || 'An organizer'} invited you to join 3rdPlace`,
    body: [
      `${user.email || 'An organizer'} invited ${vendor.name} to confirm a private booking rate on 3rdPlace.`,
      '',
      'Create your vendor account, confirm or counter the proposed rate, then set your public catalog rate for future clients.',
    ].join('\n'),
    actionUrl: claimUrl,
    templateType: 'generic',
  })

  return {
    ok: true,
    vendorId: inviteRow.vendor_id,
    relationshipId: inviteRow.relationship_id || null,
    rateAgreementId: inviteRow.rate_agreement_id || null,
    claimUrl,
    emailSent: emailResult.sent,
    existing: Boolean(inviteRow.existing),
  }
}

async function getPlanSourceEventId(admin: any, userId: string, planId?: string | null) {
  if (!planId) return null

  const { data: plan, error } = await admin
    .from('plans')
    .select('id, user_id, metadata')
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !plan) return null

  const metadata = plan.metadata && typeof plan.metadata === 'object' && !Array.isArray(plan.metadata)
    ? plan.metadata as Record<string, unknown>
    : {}
  const eventId = metadata.event_id
  return typeof eventId === 'string' ? eventId : null
}

function getOrigin() {
  const headerStore = headers()
  const origin = headerStore.get('origin')
  if (origin) return origin

  const host = headerStore.get('host')
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
  return host ? `${protocol}://${host}` : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}
