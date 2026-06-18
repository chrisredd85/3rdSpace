export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/types'

type RouteContext = {
  params: {
    venueId: string
  }
}

const contactEmailSchema = z.object({
  email: z.string().trim().email().max(254),
}).strict()

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const supabase = createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    if (user.user_metadata?.user_type !== 'community_builder') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const parsed = contactEmailSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const ownsCandidate = await userOwnsDiscoveryVenue(supabase, user.id, context.params.venueId)
    if (!ownsCandidate) {
      return NextResponse.json({ error: 'Discovery venue not found' }, { status: 404 })
    }

    const admin = createServiceRoleClient()
    const { data: venue, error: loadError } = await admin
      .from('discovery_venues')
      .select('id,organizer_provided_emails,organizer_rescue_count')
      .eq('id', context.params.venueId)
      .maybeSingle()

    if (loadError || !venue) {
      return NextResponse.json({ error: 'Discovery venue not found' }, { status: 404 })
    }

    const now = new Date().toISOString()
    const existing = Array.isArray(venue.organizer_provided_emails)
      ? venue.organizer_provided_emails
      : []
    const nextEmails = [
      ...existing,
      {
        email: parsed.data.email.toLowerCase(),
        provided_by_user_id: user.id,
        provided_at: now,
        source: 'organizer_manual',
      },
    ]

    const { data: updated, error: updateError } = await admin
      .from('discovery_venues')
      .update({
        organizer_provided_emails: nextEmails as Json,
        organizer_rescue_count: (venue.organizer_rescue_count ?? 0) + 1,
        last_rescue_at: now,
      })
      .eq('id', context.params.venueId)
      .select('id,organizer_provided_emails,organizer_rescue_count,last_rescue_at')
      .single()

    if (updateError || !updated) {
      console.error('[planner.discovery-venues.contact-email] update_failed', {
        error: updateError?.message,
        venue_id: context.params.venueId,
      })
      return NextResponse.json({ error: 'Failed to save contact email' }, { status: 500 })
    }

    return NextResponse.json({ venue: updated })
  } catch (error) {
    console.error('[planner.discovery-venues.contact-email] POST failed', error)
    return NextResponse.json({ error: 'Failed to save contact email' }, { status: 500 })
  }
}

async function userOwnsDiscoveryVenue(
  db: ReturnType<typeof createClient>,
  userId: string,
  venueId: string
) {
  const { data, error } = await db
    .from('plan_discovery_venue_candidates')
    .select('id,plans!inner(id,user_id)')
    .eq('discovery_venue_id', venueId)
    .eq('plans.user_id', userId)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[planner.discovery-venues.contact-email] ownership_check_failed', {
      error: error.message,
      venue_id: venueId,
    })
    return false
  }

  return Boolean(data)
}
