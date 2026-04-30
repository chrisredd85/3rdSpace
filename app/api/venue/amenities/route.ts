import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const saveAmenitiesSchema = z.object({
  venueId: z.string().uuid('Invalid venue id'),
  amenityTypeIds: z.array(z.string().uuid()).max(100).default([]),
  customAmenities: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
})

type AmenityTypeRow = {
  id: string
  name: string
  category: string
  icon: string
  description: string | null
  display_order: number
}

/**
 * Groups amenity types by category for selector display.
 *
 * @param amenities - Master-list amenity types.
 * @returns Amenity types keyed by category.
 */
function groupAmenityTypes(amenities: AmenityTypeRow[]) {
  return amenities.reduce<Record<string, AmenityTypeRow[]>>((accumulator, amenity) => {
    if (!accumulator[amenity.category]) {
      accumulator[amenity.category] = []
    }
    accumulator[amenity.category].push(amenity)
    return accumulator
  }, {})
}

/**
 * Verifies that the authenticated user owns the venue.
 *
 * @param venueId - Venue id to check.
 * @returns Ownership result with an HTTP status and error when denied.
 */
async function verifyVenueOwnership(venueId: string) {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  const { data: venue, error: venueError } = await supabase
    .from('venues')
    .select('owner_id')
    .eq('id', venueId)
    .maybeSingle()

  if (venueError) {
    console.error('[venue.amenities] Venue lookup failed', venueError)
    return { ok: false, status: 500, error: 'Failed to verify venue ownership' }
  }

  if (!venue) {
    return { ok: false, status: 404, error: 'Venue not found' }
  }

  if ((venue as { owner_id?: string }).owner_id !== user.id) {
    return { ok: false, status: 403, error: 'Not authorized' }
  }

  return { ok: true, status: 200, error: null }
}

/**
 * Loads the master amenity list and selected amenities for a venue.
 *
 * @route GET /api/venue/amenities?venueId={id}
 * @auth Public
 *
 * @param request - Request with optional venueId.
 * @returns Available amenity types grouped by category and selected venue amenities.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    const venueId = request.nextUrl.searchParams.get('venueId')

    const { data: available, error: availableError } = await supabase
      .from('venue_amenity_types')
      .select('*')
      .order('display_order', { ascending: true })

    if (availableError) {
      console.error('[venue.amenities] Failed to load amenity types', availableError)
      return NextResponse.json({ error: 'Failed to load amenity types' }, { status: 500 })
    }

    let selected: unknown[] = []

    if (venueId) {
      const { data: selectedAmenities, error: selectedError } = await supabase
        .from('venue_amenities')
        .select(`
          id,
          venue_id,
          amenity_name,
          description,
          amenity_type_id,
          custom_amenity_name,
          venue_amenity_types (
            id,
            name,
            category,
            icon,
            description,
            display_order
          )
        `)
        .eq('venue_id', venueId)

      if (selectedError) {
        console.error('[venue.amenities] Failed to load venue amenities', selectedError)
        return NextResponse.json({ error: 'Failed to load venue amenities' }, { status: 500 })
      }

      selected = selectedAmenities ?? []
    }

    const availableRows = (available as AmenityTypeRow[] | null) ?? []
    return NextResponse.json({
      available: groupAmenityTypes(availableRows),
      selected,
    })
  } catch (error) {
    console.error('[venue.amenities] Unexpected GET error', error)
    return NextResponse.json({ error: 'Failed to load amenities' }, { status: 500 })
  }
}

/**
 * Replaces a venue's selected amenities.
 *
 * Standard amenities store an amenity_type_id. Custom amenities store
 * custom_amenity_name and also fill the legacy amenity_name column so older
 * venue surfaces keep working.
 *
 * @route POST /api/venue/amenities
 * @auth Required - venue owner only.
 *
 * @param request - JSON body with venueId, amenityTypeIds, and customAmenities.
 * @returns Newly saved venue amenity rows.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = saveAmenitiesSchema.safeParse(await request.json())

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid amenities payload', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const { venueId, amenityTypeIds, customAmenities } = parsedBody.data
    const ownership = await verifyVenueOwnership(venueId)

    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    const supabase = createClient()
    const uniqueAmenityTypeIds = Array.from(new Set(amenityTypeIds))
    const uniqueCustomAmenities = Array.from(
      new Set(customAmenities.map((name) => name.trim()).filter(Boolean))
    )

    const { data: amenityTypes, error: amenityTypeError } = uniqueAmenityTypeIds.length
      ? await supabase
          .from('venue_amenity_types')
          .select('id, name, description')
          .in('id', uniqueAmenityTypeIds)
      : { data: [], error: null }

    if (amenityTypeError) {
      console.error('[venue.amenities] Failed to validate amenity types', amenityTypeError)
      return NextResponse.json({ error: 'Failed to validate amenity types' }, { status: 500 })
    }

    if ((amenityTypes ?? []).length !== uniqueAmenityTypeIds.length) {
      return NextResponse.json({ error: 'One or more amenity types are invalid' }, { status: 400 })
    }

    const { error: deleteError } = await supabase
      .from('venue_amenities')
      .delete()
      .eq('venue_id', venueId)

    if (deleteError) {
      console.error('[venue.amenities] Failed to delete existing amenities', deleteError)
      return NextResponse.json({ error: 'Failed to replace venue amenities' }, { status: 500 })
    }

    const typeById = new Map(
      ((amenityTypes as Array<{ id: string; name: string; description: string | null }> | null) ?? []).map(
        (amenity) => [amenity.id, amenity]
      )
    )

    const standardRows = uniqueAmenityTypeIds.map((typeId) => {
      const amenity = typeById.get(typeId)
      return {
        venue_id: venueId,
        amenity_type_id: typeId,
        custom_amenity_name: null,
        amenity_name: amenity?.name ?? 'Amenity',
        description: amenity?.description ?? null,
      }
    })

    const customRows = uniqueCustomAmenities.map((name) => ({
      venue_id: venueId,
      amenity_type_id: null,
      custom_amenity_name: name,
      amenity_name: name,
      description: null,
    }))

    const rowsToInsert = [...standardRows, ...customRows]

    if (rowsToInsert.length === 0) {
      return NextResponse.json({ amenities: [] })
    }

    const { data: newAmenities, error } = await supabase
      .from('venue_amenities')
      .insert(rowsToInsert as never)
      .select('*')

    if (error) {
      console.error('[venue.amenities] Failed to insert amenities', error)
      return NextResponse.json({ error: 'Failed to save amenities' }, { status: 500 })
    }

    return NextResponse.json({ amenities: newAmenities ?? [] })
  } catch (error) {
    console.error('[venue.amenities] Unexpected POST error', error)
    return NextResponse.json({ error: 'Failed to save amenities' }, { status: 500 })
  }
}
