export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import {
  MAX_VENUE_PHOTO_BYTES,
  VenuePhotoValidationError,
  validateVenuePhotoBytes,
} from '@/lib/security/venue-photo-validation'

const venueIdSchema = z.string().uuid()
const photoIdSchema = z.string().uuid()
const updatePhotoSchema = z.object({
  photoId: photoIdSchema,
  isPrimary: z.literal(true),
}).strict()
const deletePhotoSchema = z.object({ photoId: photoIdSchema }).strict()

type UploadFile = {
  arrayBuffer(): Promise<ArrayBuffer>
  size: number
}

function isUploadFile(value: FormDataEntryValue | null): value is File & UploadFile {
  return Boolean(
    value &&
    typeof value !== 'string' &&
    typeof value.size === 'number' &&
    typeof value.arrayBuffer === 'function'
  )
}

function validationErrorResponse(error: VenuePhotoValidationError) {
  return NextResponse.json(
    { error: error.message, code: error.code },
    { status: 400 }
  )
}

async function authenticatedContext() {
  const supabase = createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  return { admin: createServiceRoleClient(), userId: user.id }
}

async function requireOwnedVenue(
  admin: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  venueId: string
) {
  const { data: venue, error: venueError } = await admin
    .from('venues')
    .select('id, owner_id')
    .eq('id', venueId)
    .maybeSingle()

  if (venueError) {
    console.error('[venue.photos] Venue ownership lookup failed', venueError)
    return {
      response: NextResponse.json(
        { error: 'Failed to verify venue ownership' },
        { status: 500 }
      ),
    }
  }
  if (!venue) {
    return {
      response: NextResponse.json({ error: 'Venue not found' }, { status: 404 }),
    }
  }
  if (venue.owner_id !== userId) {
    return {
      response: NextResponse.json({ error: 'Not authorized' }, { status: 403 }),
    }
  }

  return { venue }
}

function storagePathForVenuePhoto(photoUrl: string, venueId: string) {
  const marker = '/storage/v1/object/public/venue-photos/'
  const markerIndex = photoUrl.indexOf(marker)
  if (markerIndex === -1) return null

  const encodedPath = photoUrl.slice(markerIndex + marker.length).split('?')[0]
  try {
    const decodedPath = decodeURIComponent(encodedPath)
    return decodedPath.startsWith(`${venueId}/`) ? decodedPath : null
  } catch {
    return null
  }
}

/**
 * Read a venue owner's photos through the same authenticated server boundary.
 * venue_photos has RLS enabled without browser-readable policies in the reviewed base.
 */
export async function GET(request: NextRequest) {
  const parsedVenueId = venueIdSchema.safeParse(
    request.nextUrl.searchParams.get('venueId')
  )
  if (!parsedVenueId.success) {
    return NextResponse.json({ error: 'Invalid venue id' }, { status: 400 })
  }

  const context = await authenticatedContext()
  if ('response' in context) return context.response

  const ownership = await requireOwnedVenue(
    context.admin,
    context.userId,
    parsedVenueId.data
  )
  if ('response' in ownership) return ownership.response

  const { data: photos, error } = await context.admin
    .from('venue_photos')
    .select('*')
    .eq('venue_id', ownership.venue.id)
    .order('display_order', { ascending: true })

  if (error) {
    console.error('[venue.photos] Photo list failed', error)
    return NextResponse.json({ error: 'Failed to load venue photos' }, { status: 500 })
  }

  return NextResponse.json({
    photos: (photos ?? []).map((photo) => ({ ...photo, caption: null })),
  })
}

/**
 * Upload one venue photo through an authenticated, server-owned validation boundary.
 * The request MIME type and filename are ignored; storage metadata is derived from bytes.
 */
export async function POST(request: NextRequest) {
  let uploadedObject: {
    admin: ReturnType<typeof createServiceRoleClient>
    storagePath: string
  } | null = null

  try {
    const context = await authenticatedContext()
    if ('response' in context) return context.response

    const formData = await request.formData()
    const parsedVenueId = venueIdSchema.safeParse(formData.get('venueId'))
    if (!parsedVenueId.success) {
      return NextResponse.json({ error: 'Invalid venue id' }, { status: 400 })
    }

    const photo = formData.get('photo')
    if (!isUploadFile(photo) || photo.size === 0) {
      return NextResponse.json({ error: 'A venue photo is required' }, { status: 400 })
    }
    if (photo.size > MAX_VENUE_PHOTO_BYTES) {
      return validationErrorResponse(
        new VenuePhotoValidationError(
          'file_too_large',
          'Venue photos must be 4 MB or smaller.'
        )
      )
    }

    const ownership = await requireOwnedVenue(
      context.admin,
      context.userId,
      parsedVenueId.data
    )
    if ('response' in ownership) return ownership.response
    const { venue } = ownership

    const bytes = Buffer.from(await photo.arrayBuffer())
    const validated = validateVenuePhotoBytes(bytes)

    const { data: lastPhoto, error: orderError } = await context.admin
      .from('venue_photos')
      .select('display_order')
      .eq('venue_id', venue.id)
      .order('display_order', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (orderError) {
      console.error('[venue.photos] Display order lookup failed', orderError)
      return NextResponse.json({ error: 'Failed to prepare venue photo' }, { status: 500 })
    }

    const storagePath = `${venue.id}/${randomUUID()}.${validated.extension}`
    const { error: uploadError } = await context.admin.storage
      .from('venue-photos')
      .upload(storagePath, bytes, {
        contentType: validated.mimeType,
        upsert: false,
      })

    if (uploadError) {
      console.error('[venue.photos] Storage upload failed', uploadError)
      return NextResponse.json({ error: 'Failed to upload venue photo' }, { status: 500 })
    }
    uploadedObject = { admin: context.admin, storagePath }

    const photoUrl = context.admin.storage
      .from('venue-photos')
      .getPublicUrl(storagePath).data.publicUrl

    const { data: savedPhoto, error: insertError } = await context.admin
      .from('venue_photos')
      .insert({
        venue_id: venue.id,
        photo_url: photoUrl,
        is_primary: false,
        display_order: (lastPhoto?.display_order ?? -1) + 1,
      })
      .select('*')
      .single()

    if (insertError) {
      const { error: cleanupError } = await context.admin.storage
        .from('venue-photos')
        .remove([storagePath])
      if (cleanupError) {
        console.error('[venue.photos] Failed to clean up orphaned upload', cleanupError)
      }
      uploadedObject = null
      console.error('[venue.photos] Database insert failed', insertError)
      return NextResponse.json({ error: 'Failed to save venue photo' }, { status: 500 })
    }

    uploadedObject = null
    return NextResponse.json(
      { photo: { ...savedPhoto, caption: null } },
      { status: 201 }
    )
  } catch (error) {
    if (uploadedObject) {
      const { error: cleanupError } = await uploadedObject.admin.storage
        .from('venue-photos')
        .remove([uploadedObject.storagePath])
      if (cleanupError) {
        console.error('[venue.photos] Failed to clean up interrupted upload', cleanupError)
      }
    }
    if (error instanceof VenuePhotoValidationError) {
      return validationErrorResponse(error)
    }
    console.error('[venue.photos] Unexpected upload failure', error)
    return NextResponse.json({ error: 'Failed to upload venue photo' }, { status: 500 })
  }
}

/** Set one owned venue photo as primary. */
export async function PATCH(request: NextRequest) {
  const context = await authenticatedContext()
  if ('response' in context) return context.response

  const body = await request.json().catch(() => null)
  const parsed = updatePhotoSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { data: photo, error: photoError } = await context.admin
    .from('venue_photos')
    .select('id, venue_id')
    .eq('id', parsed.data.photoId)
    .maybeSingle()

  if (photoError) {
    console.error('[venue.photos] Photo lookup failed', photoError)
    return NextResponse.json({ error: 'Failed to load venue photo' }, { status: 500 })
  }
  if (!photo) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
  }

  const ownership = await requireOwnedVenue(
    context.admin,
    context.userId,
    photo.venue_id
  )
  if ('response' in ownership) return ownership.response

  const { error: resetError } = await context.admin
    .from('venue_photos')
    .update({ is_primary: false })
    .eq('venue_id', photo.venue_id)

  if (resetError) {
    console.error('[venue.photos] Primary-photo reset failed', resetError)
    return NextResponse.json({ error: 'Failed to update venue photo' }, { status: 500 })
  }

  const { data: updatedPhoto, error: updateError } = await context.admin
    .from('venue_photos')
    .update({ is_primary: true })
    .eq('id', photo.id)
    .select('*')
    .single()

  if (updateError) {
    console.error('[venue.photos] Primary-photo update failed', updateError)
    return NextResponse.json({ error: 'Failed to update venue photo' }, { status: 500 })
  }

  return NextResponse.json({ photo: { ...updatedPhoto, caption: null } })
}

/** Delete one owned venue photo and its public storage object. */
export async function DELETE(request: NextRequest) {
  const context = await authenticatedContext()
  if ('response' in context) return context.response

  const body = await request.json().catch(() => null)
  const parsed = deletePhotoSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { data: photo, error: photoError } = await context.admin
    .from('venue_photos')
    .select('id, venue_id, photo_url')
    .eq('id', parsed.data.photoId)
    .maybeSingle()

  if (photoError) {
    console.error('[venue.photos] Photo lookup failed', photoError)
    return NextResponse.json({ error: 'Failed to load venue photo' }, { status: 500 })
  }
  if (!photo) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
  }

  const ownership = await requireOwnedVenue(
    context.admin,
    context.userId,
    photo.venue_id
  )
  if ('response' in ownership) return ownership.response

  const { error: deleteError } = await context.admin
    .from('venue_photos')
    .delete()
    .eq('id', photo.id)

  if (deleteError) {
    console.error('[venue.photos] Photo delete failed', deleteError)
    return NextResponse.json({ error: 'Failed to delete venue photo' }, { status: 500 })
  }

  const storagePath = storagePathForVenuePhoto(photo.photo_url, photo.venue_id)
  if (storagePath) {
    const { error: storageError } = await context.admin.storage
      .from('venue-photos')
      .remove([storagePath])
    if (storageError) {
      console.error('[venue.photos] Storage cleanup failed after row delete', storageError)
    }
  }

  return NextResponse.json({ id: photo.id, venueId: photo.venue_id })
}
