export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAdminContext } from '@/lib/server/admin-auth'
import type { Database as GeneratedDatabase } from '@/lib/types/database-generated'

const venueSeedSchema = z.object({
  name: z.string().trim().min(1).max(180),
  neighborhood: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(240),
  city: z.string().trim().min(1).max(120).default('San Francisco'),
  state: z.string().trim().min(1).max(20).default('CA'),
  zip_code: z.string().trim().min(1).max(20),
  venue_type: z.enum(['loft_warehouse', 'gallery', 'restaurant', 'rooftop', 'conference_center', 'other']),
  capacity: z.number().int().positive(),
  // integer cents — e.g. $350/hr = 35000
  hourly_rate: z.number().int().nonnegative().nullable().default(null),
  // integer cents — e.g. $350/hr = 35000
  minimum_spend: z.number().int().nonnegative().nullable().default(null),
  contact_email: z.string().email(),
  av_included: z.boolean().default(false),
  // integer cents — e.g. $22/head = 2200
  per_head_kickback_amount: z.number().int().nonnegative().nullable().default(null),
  notes: z.string().trim().max(2000).nullable().default(null),
})

const venuePublishSchema = z.object({
  id: z.string().trim().min(1),
  is_published: z.boolean(),
})

/**
 * Seeds a new unclaimed venue listing into the catalog.
 *
 * Monetary inputs are expected as integer cents and are stored without conversion.
 * The current database uses legacy venue columns, so `capacity` maps to
 * `standing_capacity`, `name` maps to `venue_name`, and active catalog visibility
 * maps to `is_published`.
 *
 * @param request - Admin-authenticated request containing the venue seed body.
 * @returns The inserted venue id and success message.
 */
export async function POST(request: NextRequest) {
  const context = await getAdminContext()
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const parsed = venueSeedSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid venue seed payload', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const venue = parsed.data
  const admin = createServiceRoleClient() as unknown as SupabaseClient<GeneratedDatabase>
  const insertPayload = {
    venue_name: venue.name,
    owner_id: null,
    description: venue.notes,
    venue_type: venue.venue_type,
    address: venue.address,
    city: venue.city,
    state: venue.state,
    zip_code: venue.zip_code,
    standing_capacity: venue.capacity,
    seated_capacity: venue.capacity,
    hourly_rate_cents: venue.hourly_rate,
    minimum_hours: null,
    per_head_kickback_cents: venue.per_head_kickback_amount,
    contact_email: venue.contact_email,
    is_claimed: false,
    claimed_user_id: null,
    is_admin_seeded: true,
    is_published: true,
    pricing_model: 'hourly',
    unique_features: venue.notes,
    unique_features_tags: venue.av_included ? ['av_included'] : [],
    auto_approve_conditions: {
      minimum_spend_cents: venue.minimum_spend,
      av_included: venue.av_included,
      neighborhood: venue.neighborhood,
    },
  }

  const { data, error } = await admin
    .from('venues')
    .insert(insertPayload as never)
    .select('id')
    .single()

  if (error) {
    console.error('[admin.catalog.venues] Seed failed', error)
    return NextResponse.json(
      { error: 'Failed to seed venues', details: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json(
    {
      success: true,
      venueId: (data as { id: string } | null)?.id,
      message: 'Venue added to catalog',
    }
  )
}

/**
 * Lists all admin-seeded venue catalog rows for internal review.
 *
 * The response intentionally includes `contact_email`, `is_claimed`, and
 * `claimed_user_id` because this route is admin-only.
 *
 * @returns Admin-only venue catalog rows ordered newest first.
 */
export async function GET() {
  const context = await getAdminContext()
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const admin = createServiceRoleClient()
  const { data, error } = await admin
    .from('venues')
    .select('*')
    .eq('is_admin_seeded', true)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[admin.catalog.venues] List failed', error)
    return NextResponse.json(
      { error: 'Failed to fetch admin-seeded venues', details: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ venues: data ?? [] })
}

/**
 * Publishes or unpublishes an admin-seeded venue listing.
 *
 * @param request - Admin-authenticated request containing the venue id and visibility state.
 * @returns The updated venue catalog row.
 */
export async function PATCH(request: NextRequest) {
  const context = await getAdminContext()
  if (!context.authorized) {
    return NextResponse.json({ error: context.error }, { status: context.status })
  }

  const parsed = venuePublishSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid venue publish payload', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const admin = createServiceRoleClient()
  const { data, error } = await admin
    .from('venues')
    .update({
      is_published: parsed.data.is_published,
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', parsed.data.id)
    .eq('is_admin_seeded', true)
    .select('*')
    .single()

  if (error) {
    console.error('[admin.catalog.venues] Publish update failed', error)
    return NextResponse.json(
      { error: 'Failed to update venue visibility', details: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, venue: data })
}
