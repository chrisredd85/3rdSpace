export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAdminContext } from '@/lib/server/admin-auth'
import {
  buildDiscoveryVenueInsertFromLead,
  buildSupplyScoutLeadInsert,
  findDuplicateDiscoveryVenue,
  findDuplicateLead,
  normalizeAddress,
  supplyScoutLeadCreateSchema,
  supplyScoutLeadUpdateSchema,
  supplyScoutReviewStatusSchema,
  type SupplyScoutLeadRow,
} from '@/lib/server/supply-scout'
import type { Json } from '@/lib/types'

type AdminDb = { from(table: string): any }

const LEAD_SELECT = `
  id,
  name,
  address,
  normalized_name,
  normalized_address,
  neighborhood,
  city,
  state,
  source_platform,
  source_url,
  event_title,
  event_type,
  evidence_summary,
  booking_signals,
  disqualifiers,
  website,
  capacity_hint,
  price_hint_cents_low,
  price_hint_cents_high,
  booking_likelihood,
  confidence,
  review_status,
  discovery_venue_id,
  duplicate_of_lead_id,
  created_by,
  reviewed_by,
  metadata,
  captured_at,
  reviewed_at,
  created_at,
  updated_at
`

/**
 * Lists staged Supply Scout venue leads for internal review.
 */
export async function GET(request: NextRequest) {
  const context = await getAdminContext()
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const statusParam = request.nextUrl.searchParams.get('status') ?? 'all'
  const parsedStatus = statusParam === 'all'
    ? null
    : supplyScoutReviewStatusSchema.safeParse(statusParam)
  if (parsedStatus && !parsedStatus.success) {
    return NextResponse.json({ error: 'Invalid review status filter' }, { status: 400 })
  }

  const limit = Math.min(
    Math.max(Number(request.nextUrl.searchParams.get('limit') ?? 250) || 250, 1),
    500
  )
  const admin = createServiceRoleClient() as unknown as AdminDb
  let query = admin
    .from('supply_scout_venue_leads')
    .select(LEAD_SELECT)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (parsedStatus && parsedStatus.success) {
    query = query.eq('review_status', parsedStatus.data)
  }

  const { data, error } = await query
  if (error) {
    console.error('[admin.supply-scout] List failed', error)
    return NextResponse.json(
      { error: 'Failed to fetch Supply Scout leads', details: error.message },
      { status: 500 }
    )
  }

  const leads = (data ?? []) as SupplyScoutLeadRow[]
  return NextResponse.json({
    leads,
    counts: buildCounts(leads),
  })
}

/**
 * Captures a venue/address signal from a supervised research session.
 */
export async function POST(request: NextRequest) {
  const context = await getAdminContext()
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const parsed = supplyScoutLeadCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid Supply Scout lead payload', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const admin = createServiceRoleClient() as unknown as AdminDb
  const duplicateLead = await loadDuplicateLead(admin, parsed.data)
  const duplicateVenue = await loadDuplicateDiscoveryVenue(admin, parsed.data)
  const insertPayload = buildSupplyScoutLeadInsert(parsed.data, context.user.id, {
    leadId: duplicateLead?.id ?? null,
    discoveryVenueId: duplicateVenue?.id ?? null,
  })

  const { data, error } = await admin
    .from('supply_scout_venue_leads')
    .insert(insertPayload)
    .select(LEAD_SELECT)
    .single()

  if (error) {
    console.error('[admin.supply-scout] Capture failed', error)
    return NextResponse.json(
      { error: 'Failed to capture Supply Scout lead', details: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    lead: data as SupplyScoutLeadRow,
    duplicate: Boolean(duplicateLead || duplicateVenue),
    duplicate_lead_id: duplicateLead?.id ?? null,
    duplicate_discovery_venue_id: duplicateVenue?.id ?? null,
  })
}

/**
 * Updates review status. Approval promotes the lead into discovery_venues.
 */
export async function PATCH(request: NextRequest) {
  const context = await getAdminContext()
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const parsed = supplyScoutLeadUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid Supply Scout review payload', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const admin = createServiceRoleClient() as unknown as AdminDb
  const lead = await loadLead(admin, parsed.data.id)
  if (!lead) return NextResponse.json({ error: 'Supply Scout lead not found' }, { status: 404 })

  const effectiveLead: SupplyScoutLeadRow = {
    ...lead,
    booking_likelihood: parsed.data.booking_likelihood ?? lead.booking_likelihood,
    confidence: parsed.data.confidence ?? lead.confidence,
    metadata: mergeSupplyScoutMetadata(lead.metadata, {
      operator_notes: parsed.data.operator_notes ?? null,
      review_status: parsed.data.review_status,
      reviewed_by: context.user.id,
    }),
  }

  if (parsed.data.review_status === 'approved' && effectiveLead.booking_likelihood === 'not_suitable') {
    return NextResponse.json(
      { error: 'Not suitable leads cannot be approved into discovery venues' },
      { status: 400 }
    )
  }

  let discoveryVenueId = effectiveLead.discovery_venue_id
  if (parsed.data.review_status === 'approved' && !discoveryVenueId) {
    const discovery = await promoteLeadToDiscoveryVenue(admin, effectiveLead, context.user.id)
    if ('error' in discovery) {
      return NextResponse.json(discovery.error, { status: discovery.status })
    }
    discoveryVenueId = discovery.discoveryVenueId
  }

  const reviewedAt = parsed.data.review_status === 'needs_review' ? null : new Date().toISOString()
  const { data, error } = await admin
    .from('supply_scout_venue_leads')
    .update({
      review_status: parsed.data.review_status,
      booking_likelihood: effectiveLead.booking_likelihood,
      confidence: effectiveLead.confidence,
      discovery_venue_id: discoveryVenueId,
      reviewed_by: parsed.data.review_status === 'needs_review' ? null : context.user.id,
      reviewed_at: reviewedAt,
      metadata: effectiveLead.metadata,
    })
    .eq('id', parsed.data.id)
    .select(LEAD_SELECT)
    .single()

  if (error) {
    console.error('[admin.supply-scout] Review update failed', error)
    return NextResponse.json(
      { error: 'Failed to update Supply Scout lead', details: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    lead: data as SupplyScoutLeadRow,
    discovery_venue_id: discoveryVenueId,
  })
}

async function loadLead(db: AdminDb, id: string): Promise<SupplyScoutLeadRow | null> {
  const { data, error } = await db
    .from('supply_scout_venue_leads')
    .select(LEAD_SELECT)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[admin.supply-scout] Lead lookup failed', error)
    return null
  }
  return (data as SupplyScoutLeadRow | null) ?? null
}

async function loadDuplicateLead(db: AdminDb, input: { address: string }) {
  const normalized = normalizeAddress(input.address)
  if (!normalized) return null

  const { data, error } = await db
    .from('supply_scout_venue_leads')
    .select('id, normalized_address, review_status')
    .eq('normalized_address', normalized)
    .limit(10)

  if (error) {
    console.error('[admin.supply-scout] Duplicate lead lookup failed', error)
    return null
  }

  return findDuplicateLead(input as never, data ?? [])
}

async function loadDuplicateDiscoveryVenue(db: AdminDb, input: { address: string }) {
  const { data, error } = await db
    .from('discovery_venues')
    .select('id, name, address, metadata')
    .limit(750)

  if (error) {
    console.error('[admin.supply-scout] Duplicate discovery lookup failed', error)
    return null
  }

  return findDuplicateDiscoveryVenue(input as never, data ?? [])
}

async function promoteLeadToDiscoveryVenue(
  db: AdminDb,
  lead: SupplyScoutLeadRow,
  reviewedBy: string
): Promise<{ discoveryVenueId: string } | { status: number; error: { error: string; details?: string } }> {
  const payload = buildDiscoveryVenueInsertFromLead(lead, reviewedBy)
  const { data, error } = await db
    .from('discovery_venues')
    .upsert(payload, { onConflict: 'source,source_external_id' })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[admin.supply-scout] Discovery promotion failed', error)
    return {
      status: 500,
      error: {
        error: 'Failed to promote Supply Scout lead into discovery venues',
        details: error?.message,
      },
    }
  }

  await db
    .from('discovery_venue_events')
    .insert({
      discovery_venue_id: data.id,
      event_type: 'supply_scout_approved',
      actor_user_id: reviewedBy,
      metadata: {
        supply_scout_lead_id: lead.id,
        source_platform: lead.source_platform,
        source_url: lead.source_url,
        booking_likelihood: lead.booking_likelihood,
        confidence: lead.confidence,
      } satisfies Json,
    })

  return { discoveryVenueId: String(data.id) }
}

function mergeSupplyScoutMetadata(
  metadata: Json | null,
  patch: Record<string, Json | undefined>
) {
  const current = readRecord(metadata)
  const supplyScout = readRecord(current.supply_scout)
  return {
    ...current,
    supply_scout: {
      ...supplyScout,
      ...patch,
    },
  } as Json
}

function buildCounts(leads: SupplyScoutLeadRow[]) {
  return leads.reduce(
    (counts, lead) => {
      counts.total += 1
      if (lead.review_status === 'needs_review') counts.needs_review += 1
      if (lead.review_status === 'approved') counts.approved += 1
      if (lead.review_status === 'rejected') counts.rejected += 1
      if (lead.review_status === 'duplicate') counts.duplicate += 1
      return counts
    },
    { total: 0, needs_review: 0, approved: 0, rejected: 0, duplicate: 0 }
  )
}

function readRecord(value: unknown): Record<string, Json> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, Json>
    : {}
}
