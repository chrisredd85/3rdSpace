export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { normalizeVendorService, type VendorServiceRow } from '@/lib/vendor-services/types'

const MAX_PORTFOLIO_IMAGES = 10

/**
 * Creates a storage-safe filename segment.
 *
 * @param name - Original filename.
 * @returns Sanitized filename.
 */
function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-');
}

/**
 * Verifies ownership of a service listing.
 *
 * @param supabase - Request-scoped Supabase client.
 * @param serviceId - Service listing id.
 * @returns Authorized service row or error response.
 */
async function requireOwnedService(supabase: ReturnType<typeof createClient>, serviceId: string) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: service, error } = await supabase
    .from('vendor_offerings')
    .select('*, vendor_profiles!inner(user_id)')
    .eq('id', serviceId)
    .maybeSingle()

  if (error) {
    console.error('[vendor.services.photos] Service lookup failed', error)
    return { ok: false as const, response: NextResponse.json({ error: 'Failed to verify service ownership' }, { status: 500 }) }
  }

  if (!service) {
    return { ok: false as const, response: NextResponse.json({ error: 'Service not found' }, { status: 404 }) }
  }

  const row = service as VendorServiceRow & { vendor_profiles?: { user_id?: string } }
  if (row.vendor_profiles?.user_id !== user.id) {
    return { ok: false as const, response: NextResponse.json({ error: 'Not authorized' }, { status: 403 }) }
  }

  return { ok: true as const, service: row }
}

/**
 * Uploads portfolio photos for a vendor service listing.
 *
 * @route POST /api/vendor/services/{id}/photos
 * @auth Required - service owner only.
 *
 * @param request - Multipart form data with one or more files named photos.
 * @param params - Service id route params.
 * @returns Updated service and uploaded public URLs.
 */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const parsedId = z.string().uuid().safeParse(params.id)
    if (!parsedId.success) {
      return NextResponse.json({ error: 'Invalid service id' }, { status: 400 })
    }

    const supabase = createClient()
    const ownership = await requireOwnedService(supabase, parsedId.data)
    if (!ownership.ok) return ownership.response

    const formData = await request.formData()
    const files = [
      ...formData.getAll('photos'),
      ...formData.getAll('files'),
      formData.get('file'),
    ].filter((file): file is File => file instanceof File && file.size > 0)

    if (files.length === 0) {
      return NextResponse.json({ error: 'No portfolio photos uploaded' }, { status: 400 })
    }

    const existingImages = ownership.service.portfolio_images || []
    if (existingImages.length + files.length > MAX_PORTFOLIO_IMAGES) {
      return NextResponse.json(
        { error: `Portfolio can include up to ${MAX_PORTFOLIO_IMAGES} photos` },
        { status: 400 }
      )
    }

    const uploadedPaths: string[] = []
    const uploadedUrls: string[] = []

    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        return NextResponse.json({ error: 'Portfolio uploads must be images' }, { status: 400 })
      }

      const filePath = `${ownership.service.vendor_id}/services/${ownership.service.id}/${Date.now()}-${sanitizeFileName(file.name)}`
      const { error: uploadError } = await supabase.storage
        .from('vendor-photos')
        .upload(filePath, file, { upsert: false, contentType: file.type || undefined })

      if (uploadError) {
        if (uploadedPaths.length > 0) {
          await supabase.storage.from('vendor-photos').remove(uploadedPaths)
        }
        console.error('[vendor.services.photos] Upload failed', uploadError)
        return NextResponse.json({ error: 'Failed to upload portfolio photo' }, { status: 500 })
      }

      uploadedPaths.push(filePath)
      uploadedUrls.push(supabase.storage.from('vendor-photos').getPublicUrl(filePath).data.publicUrl)
    }

    const nextImages = [...existingImages, ...uploadedPaths]
    const { data, error } = await supabase
      .from('vendor_offerings')
      .update({
        portfolio_images: nextImages,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', ownership.service.id)
      .select('*')
      .single()

    if (error) {
      await supabase.storage.from('vendor-photos').remove(uploadedPaths)
      console.error('[vendor.services.photos] Failed to update service photos', error)
      return NextResponse.json({ error: 'Failed to save portfolio photos' }, { status: 500 })
    }

    return NextResponse.json({
      service: normalizeVendorService(data as VendorServiceRow),
      uploaded: uploadedUrls,
    })
  } catch (error) {
    console.error('[vendor.services.photos] Unexpected POST error', error)
    return NextResponse.json({ error: 'Failed to upload portfolio photos' }, { status: 500 })
  }
}

