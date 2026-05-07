import 'server-only'

import type { Json } from '@/lib/types'

type SupabaseAdminClient = any

export type OpportunityResponseKind = 'venue' | 'vendor'
export type OpportunityResponseAction = 'accept' | 'decline' | 'counter'

export interface OpportunityResponseContext {
  kind: OpportunityResponseKind
  isExpired: boolean
  invite: Record<string, unknown>
  brief: Record<string, unknown>
  partner: Record<string, unknown> | null
}

const VENUE_INVITE_SELECT = `
  id,
  opportunity_id,
  brief_id,
  target_type,
  venue_id,
  vendor_profile_id,
  status,
  proposed_deposit_cents,
  quoted_price_cents,
  venue_response_json,
  magic_link_token,
  magic_link_expires_at,
  viewed_at,
  response_at,
  response_payload,
  sent_at,
  responded_at,
  expires_at,
  created_at
`

const VENUE_BRIEF_SELECT = `
  id,
  plan_id,
  title,
  event_type,
  guest_count,
  date_window_start,
  date_window_end,
  neighborhood,
  budget_cents,
  summary,
  requirements,
  response_deadline,
  created_at
`

const VENUE_SELECT = `
  id,
  venue_name,
  name,
  venue_type,
  address,
  city,
  state,
  neighborhood,
  standing_capacity
`

const VENDOR_INVITE_SELECT = `
  id,
  brief_id,
  vendor_id,
  status,
  magic_link_token,
  magic_link_expires_at,
  sent_at,
  viewed_at,
  response_at,
  response_payload,
  quoted_amount_cents,
  created_at
`

const VENDOR_BRIEF_SELECT = `
  id,
  plan_id,
  package_type,
  summary,
  requirements,
  budget_range_cents,
  date_needed,
  response_deadline,
  quote_requested,
  created_at
`

const VENDOR_SELECT = `
  id,
  name,
  service_type,
  vendor_type,
  bio,
  service_area
`

/**
 * Loads a venue or vendor opportunity response context from a magic-link token.
 */
export async function getOpportunityResponseContext(
  admin: SupabaseAdminClient,
  token: string
): Promise<OpportunityResponseContext | null> {
  const safeToken = token.trim()
  if (!safeToken || safeToken.length > 256) return null

  const venueContext = await getVenueResponseContext(admin, safeToken)
  if (venueContext) return venueContext

  return getVendorResponseContext(admin, safeToken)
}

/**
 * Marks a valid opportunity invite as viewed when the response page is opened.
 */
export async function markOpportunityViewed(admin: SupabaseAdminClient, context: OpportunityResponseContext) {
  if (context.isExpired || !['queued', 'sent'].includes(readString(context.invite.status) ?? '')) return

  const updates = {
    status: 'viewed',
    viewed_at: new Date().toISOString(),
  }

  if (context.kind === 'venue') {
    await admin.from('venue_opportunity_invites').update(updates).eq('id', context.invite.id)
    return
  }

  await admin.from('vendor_opportunity_invites').update(updates).eq('id', context.invite.id)
}

/**
 * Applies an accept, decline, or counter response to a magic-link invite.
 */
export async function submitOpportunityResponse(
  admin: SupabaseAdminClient,
  context: OpportunityResponseContext,
  input: {
    action: OpportunityResponseAction
    notes?: string | null
    quotedAmountCents?: number | null
    contactName?: string | null
    loadInTime?: string | null
    address?: string | null
    parkingNotes?: string | null
  }
) {
  if (context.isExpired) throw new Error('This response link has expired')

  const status = input.action === 'accept' ? 'accepted' : input.action === 'decline' ? 'declined' : 'countered'
  const responseAt = new Date().toISOString()
  const responsePayload = {
    action: input.action,
    status,
    notes: input.notes ?? null,
    quoted_amount_cents: input.quotedAmountCents ?? null,
    contact_name: input.contactName ?? null,
    load_in_time: input.loadInTime ?? null,
    address: input.address ?? null,
    parking_notes: input.parkingNotes ?? null,
    deposit_step_unblocked: status === 'accepted',
    deposit_status: status === 'accepted' ? 'unblocked' : null,
    responded_at: responseAt,
  } satisfies Record<string, unknown>

  if (context.kind === 'venue') {
    const { data, error } = await admin
      .from('venue_opportunity_invites')
      .update({
        status,
        response_at: responseAt,
        responded_at: responseAt,
        response_payload: responsePayload as Json,
        venue_response_json: responsePayload as Json,
        quoted_price_cents: input.quotedAmountCents ?? readNumber(context.invite.quoted_price_cents),
      })
      .eq('id', context.invite.id)
      .select(VENUE_INVITE_SELECT)
      .single()

    if (error || !data) throw new Error(error?.message ?? 'Failed to save venue response')
    return data as Record<string, unknown>
  }

  const { data, error } = await admin
    .from('vendor_opportunity_invites')
    .update({
      status,
      response_at: responseAt,
      response_payload: responsePayload as Json,
      quoted_amount_cents: input.quotedAmountCents ?? readNumber(context.invite.quoted_amount_cents),
    })
    .eq('id', context.invite.id)
    .select(VENDOR_INVITE_SELECT)
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to save vendor response')
  return data as Record<string, unknown>
}

async function getVenueResponseContext(admin: SupabaseAdminClient, token: string) {
  const { data: invite, error: inviteError } = await admin
    .from('venue_opportunity_invites')
    .select(VENUE_INVITE_SELECT)
    .eq('magic_link_token', token)
    .maybeSingle()

  if (inviteError) throw new Error(`Failed to load venue invite: ${inviteError.message}`)
  if (!invite) return null

  const inviteRow = invite as Record<string, unknown>
  const briefId = readString(inviteRow.brief_id) ?? readString(inviteRow.opportunity_id)
  if (!briefId) return null

  const [{ data: brief, error: briefError }, { data: venue, error: venueError }] = await Promise.all([
    admin.from('venue_opportunity_briefs').select(VENUE_BRIEF_SELECT).eq('id', briefId).single(),
    readString(inviteRow.venue_id)
      ? admin.from('venues').select(VENUE_SELECT).eq('id', inviteRow.venue_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (briefError || !brief) throw new Error(`Failed to load venue brief: ${briefError?.message ?? 'not found'}`)
  if (venueError) throw new Error(`Failed to load venue: ${venueError.message}`)

  return {
    kind: 'venue' as const,
    isExpired: isTokenExpired(inviteRow),
    invite: inviteRow,
    brief: brief as Record<string, unknown>,
    partner: (venue as Record<string, unknown> | null) ?? null,
  }
}

async function getVendorResponseContext(admin: SupabaseAdminClient, token: string) {
  const { data: invite, error: inviteError } = await admin
    .from('vendor_opportunity_invites')
    .select(VENDOR_INVITE_SELECT)
    .eq('magic_link_token', token)
    .maybeSingle()

  if (inviteError) throw new Error(`Failed to load vendor invite: ${inviteError.message}`)
  if (!invite) return null

  const inviteRow = invite as Record<string, unknown>
  const briefId = readString(inviteRow.brief_id)
  if (!briefId) return null

  const [{ data: brief, error: briefError }, { data: vendor, error: vendorError }] = await Promise.all([
    admin.from('vendor_opportunity_briefs').select(VENDOR_BRIEF_SELECT).eq('id', briefId).single(),
    admin.from('vendor_profiles').select(VENDOR_SELECT).eq('id', inviteRow.vendor_id).maybeSingle(),
  ])

  if (briefError || !brief) throw new Error(`Failed to load vendor brief: ${briefError?.message ?? 'not found'}`)
  if (vendorError) throw new Error(`Failed to load vendor: ${vendorError.message}`)

  return {
    kind: 'vendor' as const,
    isExpired: isTokenExpired(inviteRow),
    invite: inviteRow,
    brief: brief as Record<string, unknown>,
    partner: (vendor as Record<string, unknown> | null) ?? null,
  }
}

function isTokenExpired(invite: Record<string, unknown>) {
  const expiresAt = readString(invite.magic_link_expires_at) ?? readString(invite.expires_at)
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() < Date.now()
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
