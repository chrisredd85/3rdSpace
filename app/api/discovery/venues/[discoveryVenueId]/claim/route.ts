export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { sendEmailNotification } from '@/lib/email'
import { verifyDiscoveryVenueClaimToken } from '@/lib/outreach/discoveryClaimTokens'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/types'

type RouteContext = {
  params: {
    discoveryVenueId: string
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const isFormPost = request.headers.get('content-type')?.includes('form') === true

  try {
    const supabase = createClient()
    const admin = createServiceRoleClient() as any
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return routeResponse(request, isFormPost, { error: 'Not authenticated' }, 401)
    }

    if (user.user_metadata?.user_type !== 'venue_owner') {
      return routeResponse(request, isFormPost, { error: 'Only venue owner accounts can claim a discovery listing.' }, 403)
    }

    const body = await readClaimBody(request)
    const tokenPayload = verifyDiscoveryVenueClaimToken(body.token)
    if (!tokenPayload || tokenPayload.discovery_venue_id !== context.params.discoveryVenueId) {
      return routeResponse(request, isFormPost, { error: 'Claim link is invalid or expired.' }, 400)
    }

    const { data: discoveryVenue, error: discoveryError } = await admin
      .from('discovery_venues')
      .select('id, name, contact_email, is_claimed, claimed_venue_id, metadata')
      .eq('id', context.params.discoveryVenueId)
      .maybeSingle()

    if (discoveryError) throw new Error(discoveryError.message)
    if (!discoveryVenue) {
      return routeResponse(request, isFormPost, { error: 'Discovery venue not found.' }, 404)
    }

    if (discoveryVenue.is_claimed && discoveryVenue.claimed_venue_id) {
      return routeResponse(request, isFormPost, { error: 'This discovery listing has already been claimed.' }, 409)
    }

    const { data: venue, error: venueError } = await admin
      .from('venues')
      .select('id, owner_id, venue_name, contact_email')
      .eq('id', body.venueId)
      .eq('owner_id', user.id)
      .maybeSingle()

    if (venueError) throw new Error(venueError.message)
    if (!venue) {
      return routeResponse(request, isFormPost, { error: 'Select a venue listing owned by your account.' }, 403)
    }

    const now = new Date().toISOString()
    const metadata = {
      ...(readRecord(discoveryVenue.metadata) ?? {}),
      claimed_at: now,
      claimed_by_user_id: user.id,
    } as Json

    const { error: updateDiscoveryError } = await admin
      .from('discovery_venues')
      .update({
        is_claimed: true,
        claimed_venue_id: venue.id,
        metadata,
        last_verified_at: now,
      })
      .eq('id', context.params.discoveryVenueId)

    if (updateDiscoveryError) throw new Error(updateDiscoveryError.message)

    const threadUpdates: Record<string, unknown> = {
      target_source: 'onboarded',
      target_id: venue.id,
      discovery_venue_id: context.params.discoveryVenueId,
      target_name: venue.venue_name ?? discoveryVenue.name,
      last_event_at: now,
    }
    const targetEmail = venue.contact_email ?? discoveryVenue.contact_email
    if (targetEmail) threadUpdates.target_email = targetEmail

    const { error: threadUpdateError } = await admin
      .from('outreach_threads')
      .update(threadUpdates)
      .eq('discovery_venue_id', context.params.discoveryVenueId)

    if (threadUpdateError) throw new Error(threadUpdateError.message)

    await admin
      .from('discovery_venue_events')
      .insert({
        discovery_venue_id: context.params.discoveryVenueId,
        event_type: 'claimed',
        actor_user_id: user.id,
        metadata: {
          claimed_venue_id: venue.id,
          venue_name: venue.venue_name,
        } as Json,
      })

    await sendWelcomeEmail({
      to: venue.contact_email ?? user.email ?? discoveryVenue.contact_email ?? null,
      venueName: venue.venue_name ?? discoveryVenue.name,
    })

    return routeResponse(
      request,
      isFormPost,
      {
        success: true,
        discoveryVenueId: context.params.discoveryVenueId,
        venueId: venue.id,
      },
      200,
      body.returnTo
    )
  } catch (error) {
    console.error('[discovery.claim] Claim failed', error)
    return routeResponse(request, isFormPost, { error: 'Could not claim discovery venue.' }, 500)
  }
}

async function readClaimBody(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('form')) {
    const form = await request.formData()
    return {
      token: String(form.get('token') ?? ''),
      venueId: String(form.get('venueId') ?? ''),
      returnTo: String(form.get('returnTo') ?? ''),
    }
  }

  const body = await request.json().catch(() => ({}))
  return {
    token: String(body.token ?? ''),
    venueId: String(body.venueId ?? ''),
    returnTo: String(body.returnTo ?? ''),
  }
}

function routeResponse(
  request: NextRequest,
  isFormPost: boolean,
  payload: Record<string, unknown>,
  status: number,
  returnTo?: string
) {
  if (!isFormPost) {
    return NextResponse.json(payload, { status })
  }

  const url = new URL(safeReturnTo(returnTo), request.url)
  if (status >= 400) {
    url.searchParams.set('claim_error', String(payload.error ?? 'Claim failed'))
  } else {
    url.searchParams.set('claimed', '1')
  }
  return NextResponse.redirect(url, { status: 303 })
}

function safeReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/venue'
  return value
}

async function sendWelcomeEmail(input: { to: string | null; venueName: string }) {
  if (!input.to) return
  try {
    await sendEmailNotification({
      to: input.to,
      subject: `${input.venueName} is claimed on 3rdPlace`,
      body: 'Your venue listing is now connected to your account. Any existing creator outreach threads for this discovery listing will route to your onboarded venue profile.',
      actionUrl: buildAppUrl('/venue'),
      templateType: 'generic',
    })
  } catch (error) {
    console.error('[discovery.claim] Welcome email failed', error)
  }
}

function buildAppUrl(path: string) {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    'http://localhost:3000'
  return `${baseUrl.replace(/\/$/, '')}${path}`
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
