'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { sendEmailNotification } from '@/lib/email'
import { dollarsToCents } from '@/lib/money'
import { attachVenueToActivePlan, type VenueTermType } from '@/lib/planner/planVenueSelections'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { createVenueClaimToken } from '@/lib/venues/venueInviteTokens'

const VENUE_TYPES = ['loft_warehouse', 'gallery', 'restaurant', 'rooftop', 'conference_center', 'other'] as const
const TERM_TYPES = ['flat_rental', 'minimum_spend', 'per_head_chi', 'bar_chi', 'no_charge', 'tbd'] as const

const inviteVenueSchema = z.object({
  venueName: z.string().trim().min(1, 'Venue name is required'),
  contactEmail: z.string().trim().email('Enter a valid email address'),
  contactName: z.string().trim().optional().nullable(),
  contactRole: z.string().trim().optional().nullable(),
  venueType: z.enum(VENUE_TYPES).default('other'),
  city: z.string().trim().optional().nullable(),
  state: z.string().trim().optional().nullable(),
  standingCapacity: z.coerce.number().int().positive().optional().nullable(),
  seatedCapacity: z.coerce.number().int().positive().optional().nullable(),
  termType: z.enum(TERM_TYPES).default('tbd'),
  proposedAmount: z.coerce.number().nonnegative().optional().nullable(),
  planId: z.string().uuid().optional().nullable(),
})

export interface InviteVenueInput {
  venueName: string
  contactEmail: string
  contactName?: string | null
  contactRole?: string | null
  venueType?: typeof VENUE_TYPES[number]
  city?: string | null
  state?: string | null
  standingCapacity?: number | null
  seatedCapacity?: number | null
  termType?: VenueTermType
  proposedAmount?: number | null
  planId?: string | null
}

export interface InviteVenueResult {
  ok: boolean
  error?: string
  venueId?: string
  relationshipId?: string | null
  termAgreementId?: string | null
  claimUrl?: string
  emailSent?: boolean
  existing?: boolean
  plan?: unknown
}

export async function inviteVenue(input: InviteVenueInput): Promise<InviteVenueResult> {
  const parsed = inviteVenueSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || 'Invite details are invalid' }
  }

  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { ok: false, error: 'Sign in to invite venues.' }
  }

  const admin = createServiceRoleClient() as any
  const sourceEventId = await getPlanSourceEventId(admin, user.id, parsed.data.planId)
  const amountCents = normalizeAmountCents(parsed.data.termType, parsed.data.proposedAmount)

  const { data: inviteRows, error: inviteError } = await admin.rpc('create_venue_invite', {
    p_organizer_user_id: user.id,
    p_venue_name: parsed.data.venueName,
    p_contact_email: parsed.data.contactEmail,
    p_contact_name: parsed.data.contactName || null,
    p_contact_role: parsed.data.contactRole || null,
    p_venue_type: parsed.data.venueType,
    p_city: parsed.data.city || null,
    p_state: parsed.data.state || 'CA',
    p_standing_capacity: parsed.data.standingCapacity || null,
    p_seated_capacity: parsed.data.seatedCapacity || null,
    p_term_type: parsed.data.termType,
    p_amount_cents: amountCents,
    p_source_event_id: sourceEventId,
  })

  if (inviteError) {
    console.error('Error creating venue invite:', inviteError)
    return { ok: false, error: inviteError.message || 'Could not create venue invite.' }
  }

  const inviteRow = Array.isArray(inviteRows) ? inviteRows[0] : inviteRows
  if (!inviteRow?.venue_id) {
    return { ok: false, error: 'Venue invite did not return a venue id.' }
  }

  const { data: venue, error: venueError } = await admin
    .from('venues')
    .select('id, venue_name, contact_email, invited_at')
    .eq('id', inviteRow.venue_id)
    .single()

  if (venueError || !venue?.contact_email || !venue.invited_at) {
    console.error('Error loading invited venue:', venueError)
    return { ok: false, error: 'Venue invite was created, but the claim link could not be generated.' }
  }

  const token = createVenueClaimToken({
    venueId: venue.id,
    email: venue.contact_email,
    invitedAt: venue.invited_at,
  })
  const claimUrl = `${getOrigin()}/venue/claim?token=${encodeURIComponent(token)}`

  let attachedPlan: unknown = null
  if (parsed.data.planId) {
    const attachResult = await attachVenueToActivePlan(admin, {
      planId: parsed.data.planId,
      organizerUserId: user.id,
      venueId: venue.id,
      termType: parsed.data.termType,
      amountCents,
    })
    if (attachResult.ok) {
      attachedPlan = attachResult.plan
    }
  }

  const emailResult = await sendEmailNotification({
    to: venue.contact_email,
    subject: `${user.email || 'An organizer'} invited you to join 3rdPlace`,
    body: [
      `${user.email || 'An organizer'} invited ${venue.venue_name} to confirm private event terms on 3rdPlace.`,
      '',
      'Create your venue account, confirm or counter the proposed terms, then complete your profile. Stripe payout setup happens before your first in-app payment, not during claim.',
    ].join('\n'),
    actionUrl: claimUrl,
    templateType: 'generic',
  })

  return {
    ok: true,
    venueId: inviteRow.venue_id,
    relationshipId: inviteRow.relationship_id || null,
    termAgreementId: inviteRow.term_agreement_id || null,
    claimUrl,
    emailSent: emailResult.sent,
    existing: Boolean(inviteRow.existing),
    plan: attachedPlan,
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

function normalizeAmountCents(termType: VenueTermType, proposedAmount?: number | null) {
  if (termType === 'tbd') return null
  if (termType === 'no_charge') return 0
  if (proposedAmount === null || proposedAmount === undefined || !Number.isFinite(Number(proposedAmount))) return null
  return Math.max(dollarsToCents(Number(proposedAmount)), 0)
}

function getOrigin() {
  const headerStore = headers()
  const origin = headerStore.get('origin')
  if (origin) return origin

  const host = headerStore.get('host')
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
  return host ? `${protocol}://${host}` : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}
