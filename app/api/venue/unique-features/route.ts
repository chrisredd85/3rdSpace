import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { extractUniqueFeatureTags } from '@/lib/venues/unique-features'

const saveUniqueFeaturesSchema = z.object({
  venueId: z.string().uuid('Invalid venue id'),
  uniqueFeatures: z.string().trim().max(3000, 'Unique features must be under 3000 characters').default(''),
})

/**
 * Verifies that the authenticated user owns a venue.
 *
 * @param venueId - Venue id to verify.
 * @returns Supabase client and venue ownership result.
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
    .select('id, owner_id')
    .eq('id', venueId)
    .maybeSingle()

  if (venueError) {
    console.error('[venue.unique-features] Venue lookup failed', venueError)
    return { ok: false as const, status: 500, error: 'Failed to verify venue ownership' }
  }

  if (!venue) {
    return { ok: false as const, status: 404, error: 'Venue not found' }
  }

  if ((venue as { owner_id?: string }).owner_id !== user.id) {
    return { ok: false as const, status: 403, error: 'Not authorized' }
  }

  return { ok: true as const, supabase, venue }
}

/**
 * Gets public unique feature text and tags for a venue.
 *
 * @route GET /api/venue/unique-features?venueId={id}
 * @auth Public
 *
 * @param request - Request with venueId query parameter.
 * @returns Unique features text and extracted tags.
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

    const supabase = createClient()
    const { data: venue, error } = await supabase
      .from('venues')
      .select('unique_features, unique_features_tags')
      .eq('id', parsedVenueId.data)
      .maybeSingle()

    if (error) {
      console.error('[venue.unique-features] Failed to load features', error)
      return NextResponse.json({ error: 'Failed to load unique features' }, { status: 500 })
    }

    if (!venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 })
    }

    const row = venue as { unique_features?: string | null; unique_features_tags?: string[] | null }
    return NextResponse.json({
      unique_features: row.unique_features || '',
      unique_features_tags: row.unique_features_tags || [],
    })
  } catch (error) {
    console.error('[venue.unique-features] Unexpected GET error', error)
    return NextResponse.json({ error: 'Failed to load unique features' }, { status: 500 })
  }
}

/**
 * Saves unique features for a venue and refreshes extracted search tags.
 *
 * @route POST /api/venue/unique-features
 * @auth Required - venue owner only.
 *
 * @param request - JSON body containing venueId and uniqueFeatures.
 * @returns Updated venue row and extracted tags.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = saveUniqueFeaturesSchema.safeParse(await request.json())

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid unique features payload', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const { venueId, uniqueFeatures } = parsedBody.data
    const ownership = await requireVenueOwner(venueId)

    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    const tags = extractUniqueFeatureTags(uniqueFeatures)
    const { data: updated, error } = await ownership.supabase
      .from('venues')
      .update({
        unique_features: uniqueFeatures,
        unique_features_tags: tags,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', venueId)
      .select('*')
      .single()

    if (error) {
      console.error('[venue.unique-features] Failed to save features', error)
      return NextResponse.json({ error: 'Failed to save unique features' }, { status: 500 })
    }

    return NextResponse.json({
      venue: updated,
      extracted_tags: tags,
    })
  } catch (error) {
    console.error('[venue.unique-features] Unexpected POST error', error)
    return NextResponse.json({ error: 'Failed to save unique features' }, { status: 500 })
  }
}
