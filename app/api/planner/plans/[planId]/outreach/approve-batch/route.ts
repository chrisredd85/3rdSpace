export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { GmailConnectionRequiredError } from '@/lib/outreach/gmailApprovalFlow'
import { enqueueDraftBatchAfterVenueApproval } from '@/lib/planner/discoveryOutreachDrafts'
import { PLAN_SELECT_COLUMNS } from '@/lib/planner/dbSelects'
import {
  buildDefaultOutreachBody,
  buildDefaultOutreachSubject,
  resolveDiscoveryVenueContact,
  type DiscoveryVenueRow,
  type PlanDiscoveryVenueCandidateRow,
} from '@/lib/server/places-outreach'
import {
  ensurePlannerEventAccess,
  PlannerProductAccessActivationError,
  PlannerProductAccessRequiredError,
  productAccessErrorResponse,
} from '@/lib/planner/productAccess'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import type { Json, Plan } from '@/lib/types'

type RouteContext = {
  params: Promise<{
    planId: string
  }>
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

    const plan = await loadOwnedPlan(supabase, (await context.params).planId, user.id)
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const uniqueVenueIds = Array.from(new Set(parsed.data.discovery_venue_ids))
    const rows = await loadCandidateRows((await context.params).planId, uniqueVenueIds)
    const rowByVenueId = new Map(rows.map((row) => [row.venue.id, row]))
    const errors = uniqueVenueIds.flatMap((venueId) => {
      const row = rowByVenueId.get(venueId)
      if (!row) return [{ discovery_venue_id: venueId, error: 'not_found' }]
      if (!isPlacesBackedCandidate(row)) {
        return [{
          discovery_venue_id: venueId,
          name: row.venue.name,
          error: 'places_discovery_required',
        }]
      }
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
      const placesRequired = errors.every((error) => error.error === 'places_discovery_required')
      return NextResponse.json(
        {
          error: placesRequired
            ? 'Run Google Places discovery before creating outreach approvals.'
            : 'Some venues need a contact email before outreach approval can be created.',
          code: placesRequired ? 'places_discovery_required' : 'contact_not_ready',
          venue_errors: errors,
        },
        { status: 400 }
      )
    }

    const accessPlan = await ensurePlannerEventAccess({
      plan,
      userId: user.id,
      reason: 'outreach_started',
    })
    const subject = parsed.data.custom_subject ?? buildDefaultOutreachSubject(accessPlan)
    const bodyText = parsed.data.custom_body ?? buildDefaultOutreachBody(accessPlan)
    const batch = await enqueueDraftBatchAfterVenueApproval({
      db: supabase as unknown as { from: (table: string) => any },
      planId: plan.id,
      userId: user.id,
      venueIds: uniqueVenueIds,
      subject,
      bodyText,
    })

    const createdByApprovalId = new Map<string, {
      approval_id: string
      approval_message_id: string | null
      redirect_url: string | null
      status: string
      target_count: number
      discovery_venue_ids: string[]
      venue_names: string[]
    }>()
    for (const result of batch.results.filter((result) => result.status === 'draft_created' && result.gmailApprovalId)) {
      const approvalId = result.gmailApprovalId as string
      const existing = createdByApprovalId.get(approvalId)
      if (existing) {
        existing.target_count += 1
        existing.discovery_venue_ids.push(result.discoveryVenueId)
        existing.venue_names.push(result.venueName)
        continue
      }
      createdByApprovalId.set(approvalId, {
        approval_id: approvalId,
        approval_message_id: result.approvalMessageId ?? null,
        redirect_url: result.redirectUrl ?? null,
        status: result.status,
        target_count: 1,
        discovery_venue_ids: [result.discoveryVenueId],
        venue_names: [result.venueName],
      })
    }
    const created = Array.from(createdByApprovalId.values())

    return NextResponse.json({
      approvals: created,
      created_count: created.length,
      target_count: batch.draftCreatedCount,
    })
  } catch (error) {
    if (error instanceof GmailConnectionRequiredError) {
      return NextResponse.json({ error: error.message, gmail_required: true }, { status: 409 })
    }
    if (error instanceof PlannerProductAccessRequiredError) {
      return NextResponse.json(productAccessErrorResponse(error), { status: error.status })
    }
    if (error instanceof PlannerProductAccessActivationError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
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
      created_at,updated_at,extracted_emails,extracted_contact_forms,website_extraction_attempted_at,
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

function isPlacesBackedCandidate(row: CandidateWithVenue) {
  return row.venue.source === 'google_places' && Boolean(row.venue.source_external_id)
}
