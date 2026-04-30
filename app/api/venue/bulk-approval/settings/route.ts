import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const settingsSchema = z.object({
  venueId: z.string().uuid('Invalid venue id'),
  bulkApprovalEnabled: z.boolean(),
  autoApproveThreshold: z.number().min(0).nullable().optional(),
  autoApproveConditions: z
    .object({
      minNotice: z.number().int().min(0).nullable().optional(),
      maxCapacity: z.number().int().min(1).nullable().optional(),
    })
    .default({}),
})

/**
 * Verifies that the authenticated user owns a venue.
 *
 * @param venueId - Venue id to verify.
 * @returns Supabase client, user id, and venue row when authorized.
 */
async function requireVenueOwner(venueId: string) {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { ok: false as const, status: 401, error: 'Unauthorized' }
  }

  const { data: venue, error: venueError } = await supabase
    .from('venues')
    .select('id, owner_id, bulk_approval_enabled, auto_approve_threshold, auto_approve_conditions')
    .eq('id', venueId)
    .maybeSingle()

  if (venueError) {
    console.error('[bulk-approval.settings] Venue lookup failed', venueError)
    return { ok: false as const, status: 500, error: 'Failed to verify venue ownership' }
  }

  if (!venue) {
    return { ok: false as const, status: 404, error: 'Venue not found' }
  }

  if ((venue as { owner_id?: string }).owner_id !== user.id) {
    return { ok: false as const, status: 403, error: 'Not authorized' }
  }

  return { ok: true as const, supabase, userId: user.id, venue }
}

/**
 * Gets bulk approval and auto-approval settings for a venue.
 *
 * @route GET /api/venue/bulk-approval/settings?venueId={id}
 * @auth Required - venue owner only.
 *
 * @param request - Request with venueId query parameter.
 * @returns Venue bulk approval settings.
 */
export async function GET(request: NextRequest) {
  try {
    const venueId = request.nextUrl.searchParams.get('venueId')

    if (!venueId) {
      return NextResponse.json({ error: 'venueId required' }, { status: 400 })
    }

    const parsedVenueId = z.string().uuid().safeParse(venueId)
    if (!parsedVenueId.success) {
      return NextResponse.json({ error: 'Invalid venue id' }, { status: 400 })
    }

    const ownership = await requireVenueOwner(parsedVenueId.data)
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    const venue = ownership.venue as {
      bulk_approval_enabled?: boolean | null
      auto_approve_threshold?: number | null
      auto_approve_conditions?: Record<string, unknown> | null
    }

    return NextResponse.json({
      bulk_approval_enabled: venue.bulk_approval_enabled || false,
      auto_approve_threshold: venue.auto_approve_threshold ?? null,
      auto_approve_conditions: venue.auto_approve_conditions || {},
    })
  } catch (error) {
    console.error('[bulk-approval.settings] Unexpected GET error', error)
    return NextResponse.json({ error: 'Failed to load bulk approval settings' }, { status: 500 })
  }
}

/**
 * Updates bulk approval and auto-approval settings for a venue.
 *
 * @route POST /api/venue/bulk-approval/settings
 * @auth Required - venue owner only.
 *
 * @param request - JSON body with venueId and approval settings.
 * @returns Updated venue row.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = settingsSchema.safeParse(await request.json())

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid bulk approval settings', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const { venueId, bulkApprovalEnabled, autoApproveThreshold, autoApproveConditions } = parsedBody.data
    const ownership = await requireVenueOwner(venueId)

    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    const normalizedConditions = {
      minNotice: autoApproveConditions.minNotice ?? null,
      maxCapacity: autoApproveConditions.maxCapacity ?? null,
    }

    const { data: updated, error } = await ownership.supabase
      .from('venues')
      .update({
        bulk_approval_enabled: bulkApprovalEnabled,
        auto_approve_threshold: autoApproveThreshold ?? null,
        auto_approve_conditions: normalizedConditions,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', venueId)
      .select('*')
      .single()

    if (error) {
      console.error('[bulk-approval.settings] Failed to update settings', error)
      return NextResponse.json({ error: 'Failed to save bulk approval settings' }, { status: 500 })
    }

    return NextResponse.json({ venue: updated })
  } catch (error) {
    console.error('[bulk-approval.settings] Unexpected POST error', error)
    return NextResponse.json({ error: 'Failed to save bulk approval settings' }, { status: 500 })
  }
}
