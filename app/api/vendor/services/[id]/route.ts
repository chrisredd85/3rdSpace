export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { normalizeVendorService, type VendorServiceRow } from '@/lib/vendor-services/types'

const addOnSchema = z.object({
  name: z.string().trim().min(1).max(80),
  price: z.coerce.number().min(0),
  description: z.string().trim().max(200).optional().or(z.literal('')),
})

const updateServiceSchema = z.object({
  offering_name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  base_price: z.coerce.number().min(0),
  duration_hours: z.coerce.number().positive().nullable().optional(),
  service_category: z.enum(['dj', 'photography', 'videography', 'av', 'security', 'catering', 'bartending', 'staffing', 'production', 'decor', 'other']),
  max_capacity: z.coerce.number().int().positive().nullable().optional(),
  equipment_included: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  add_ons: z.array(addOnSchema).max(20).optional(),
  is_active: z.boolean().optional(),
})

/**
 * Verifies the signed-in vendor owns a service listing.
 *
 * @param supabase - Request-scoped Supabase client.
 * @param serviceId - Service listing id.
 * @returns Service row or error response.
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
    console.error('[vendor.services.detail] Service lookup failed', error)
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
 * Updates a vendor service listing.
 *
 * @route PUT /api/vendor/services/{id}
 * @auth Required - service owner only.
 *
 * @param request - Service update payload.
 * @param params - Service id route params.
 * @returns Updated service listing.
 */
export async function PUT(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const parsedId = z.string().uuid().safeParse(params.id)
    if (!parsedId.success) {
      return NextResponse.json({ error: 'Invalid service id' }, { status: 400 })
    }

    const parsedBody = updateServiceSchema.safeParse(await request.json())
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid service payload', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const supabase = createClient()
    const ownership = await requireOwnedService(supabase, parsedId.data)
    if (!ownership.ok) return ownership.response

    const payload = parsedBody.data
    const { data, error } = await supabase
      .from('vendor_offerings')
      .update({
        offering_name: payload.offering_name,
        description: payload.description || null,
        base_price: payload.base_price,
        duration_hours: payload.duration_hours || null,
        service_category: payload.service_category,
        max_capacity: payload.max_capacity || null,
        equipment_included: payload.equipment_included || [],
        add_ons: payload.add_ons || [],
        is_active: payload.is_active ?? true,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', parsedId.data)
      .select('*')
      .single()

    if (error) {
      console.error('[vendor.services.detail] Failed to update service', error)
      return NextResponse.json({ error: 'Failed to update service' }, { status: 500 })
    }

    return NextResponse.json({ service: normalizeVendorService(data as VendorServiceRow) })
  } catch (error) {
    console.error('[vendor.services.detail] Unexpected PUT error', error)
    return NextResponse.json({ error: 'Failed to update service' }, { status: 500 })
  }
}

/**
 * Deletes a vendor service listing.
 *
 * @route DELETE /api/vendor/services/{id}
 * @auth Required - service owner only.
 *
 * @param request - Delete request.
 * @param params - Service id route params.
 * @returns Deleted service id.
 */
export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const parsedId = z.string().uuid().safeParse(params.id)
    if (!parsedId.success) {
      return NextResponse.json({ error: 'Invalid service id' }, { status: 400 })
    }

    const supabase = createClient()
    const ownership = await requireOwnedService(supabase, parsedId.data)
    if (!ownership.ok) return ownership.response

    const imagePaths = ownership.service.portfolio_images || []
    if (imagePaths.length > 0) {
      await supabase.storage.from('vendor-photos').remove(imagePaths)
    }

    const { error } = await supabase
      .from('vendor_offerings')
      .delete()
      .eq('id', parsedId.data)

    if (error) {
      console.error('[vendor.services.detail] Failed to delete service', error)
      return NextResponse.json({ error: 'Failed to delete service' }, { status: 500 })
    }

    return NextResponse.json({ deleted: parsedId.data })
  } catch (error) {
    console.error('[vendor.services.detail] Unexpected DELETE error', error)
    return NextResponse.json({ error: 'Failed to delete service' }, { status: 500 })
  }
}

