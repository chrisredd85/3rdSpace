export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { GmailConnectionRequiredError } from '@/lib/outreach/gmailApprovalFlow'
import { enqueueDraftAfterVenueApproval } from '@/lib/planner/discoveryOutreachDrafts'
import { PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import {
  buildDefaultOutreachBody,
  buildDefaultOutreachSubject,
  resolveDiscoveryVenueContact,
  type DiscoveryVenueRow,
  type PlanDiscoveryVenueCandidateRow,
} from '@/lib/server/places-outreach'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { Json, Plan } from '@/lib/types'

type RouteContext = {
  params: {
    planId: string
  }
}

const approveBatchSchema = z.object({
  discovery_venue_ids: z.array(z.string().uuid()).min(1).max(6),
  message_template_id: z.string().trim().max(120).optional(),
  custom_subject: z.string().trim().min(3).max(180).optional(),
  custom_body: z.string().trim().min(20).max(4000).optional(),
}).strict()

type CandidateWithVenue = {
  candidate: PlanDiscoveryVenueCandidateRow
  venue: DiscoveryVenueRow
}

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

    const parsed = approveBatchSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const plan = await loadOwnedPlan(supabase, context.params.planId, user.id)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const uniqueVenueIds = Array.from(new Set(parsed.data.discovery_venue_ids))
    const rows = await loadCandidateRows(context.params.planId, uniqueVenueIds)
    const rowByVenueId = new Map(rows.map((row) => [row.venue.id, row]))
    const errors = uniqueVenueIds.flatMap((venueId) => {
      const row = rowByVenueId.get(venueId)
      if (!row) return [{ discovery_venue_id: venueId, error: 'not_found' }]
      const contact = resolveDiscoveryVenueContact(row.venue)
      if (contact.status !== 'ready_to_reach_out' || !contact.email) {
        return [{
          discovery_venue_id: venueId,
          name: row.venue.name,
          error: 'contact_not_ready',
          contact_status: contact.status,
        }]
      }
      return []
    })

    if (errors.length > 0) {
      return NextResponse.json(
        { error: 'Some venues need a contact email before outreach approval can be created.', venue_errors: errors },
        { status: 400 }
      )
    }

    const subject = parsed.data.custom_subject ?? buildDefaultOutreachSubject(plan)
    const bodyText = parsed.data.custom_body ?? buildDefaultOutreachBody(plan)
    const created = []

    for (const venueId of uniqueVenueIds) {
      const row = rowByVenueId.get(venueId)
      if (!row) continue

      const result = await enqueueDraftAfterVenueApproval({
        db: supabase as unknown as { from: (table: string) => any },
        planId: plan.id,
        userId: user.id,
        discoveryVenueId: row.venue.id,
        subject,
        bodyText,
      })

      created.push({
        discovery_venue_id: row.venue.id,
        venue_name: row.venue.name,
        approval_id: result.gmailApprovalId,
        approval_message_id: result.approvalMessageId,
        redirect_url: result.redirectUrl ?? null,
        status: result.status,
      })
    }

    return NextResponse.json({
      approvals: created,
      created_count: created.length,
    })
  } catch (error) {
    if (error instanceof GmailConnectionRequiredError) {
      return NextResponse.json({ error: error.message, gmail_required: true }, { status: 409 })
    }
    console.error('[planner.outreach.approve-batch] POST failed', error)
    return NextResponse.json({ error: 'Failed to create outreach approvals' }, { status: 500 })
  }
}

async function loadOwnedPlan(
  db: ReturnType<typeof createClient>,
  planId: string,
  userId: string
): Promise<Plan | null> {
  const { data, error } = await db
    .from('plans')
    .select(PLAN_SELECT_COLUMNS)
    .eq('id', planId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data as Plan | null) ?? null
}

async function loadCandidateRows(planId: string, venueIds: string[]): Promise<CandidateWithVenue[]> {
  const admin = createServiceRoleClient()
  const { data: candidates, error } = await admin
    .from('plan_discovery_venue_candidates')
    .select('*')
    .eq('plan_id', planId)
    .in('discovery_venue_id', venueIds)
    .is('dismissed_at', null)
    .returns<PlanDiscoveryVenueCandidateRow[]>()

  if (error) throw new Error(error.message)
  const candidateRows = candidates ?? []
  if (candidateRows.length === 0) return []

  const { data: venues, error: venueError } = await admin
    .from('discovery_venues')
    .select(`
      id,name,address,neighborhood,city,state,lat,lng,contact_email,contact_phone,website,
      instagram_handle,capacity_seated,capacity_standing,capacity_cocktail,vibe_tags,
      alcohol_policy,av_available,parking_notes,price_hint_cents_low,price_hint_cents_high,
      price_hint_note,source,source_external_id,google_rating,google_user_ratings_total,
      google_photo_names,photos,opening_hours_json,metadata,last_enriched_at,last_verified_at,
      last_rescue_at,organizer_provided_emails,organizer_rescue_count,is_claimed,claimed_venue_id,
      created_at,updated_at,extracted_emails,website_extraction_attempted_at,
      website_extraction_attempts,website_extraction_metadata,website_extraction_status
    `)
    .in('id', candidateRows.map((candidate) => candidate.discovery_venue_id))
    .returns<DiscoveryVenueRow[]>()

  if (venueError) throw new Error(venueError.message)
  const venueById = new Map((venues ?? []).map((venue) => [venue.id, venue]))
  return candidateRows.flatMap((candidate) => {
    const venue = venueById.get(candidate.discovery_venue_id)
    return venue ? [{ candidate, venue }] : []
  })
}
