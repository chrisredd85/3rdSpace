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

const servicePayloadSchema = z.object({
  vendorId: z.string().uuid().optional(),
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
 * Loads the vendor profile owned by the signed-in user.
 *
 * @param supabase - Request-scoped Supabase client.
 * @param vendorId - Optional vendor id that must belong to the user.
 * @returns Authorized vendor id or an error response.
 */
async function requireOwnedVendor(supabase: ReturnType<typeof createClient>, vendorId?: string) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  let query = supabase
    .from('vendor_profiles')
    .select('id')
    .eq('user_id', user.id)

  if (vendorId) query = query.eq('id', vendorId)

  const { data: vendor, error } = await query.limit(1).maybeSingle()

  if (error) {
    console.error('[vendor.services] Vendor lookup failed', error)
    return { ok: false as const, response: NextResponse.json({ error: 'Failed to verify vendor profile' }, { status: 500 }) }
  }

  if (!vendor) {
    return { ok: false as const, response: NextResponse.json({ error: 'Vendor profile not found' }, { status: 403 }) }
  }

  return { ok: true as const, vendorId: (vendor as { id: string }).id }
}

/**
 * Lists service offerings for a vendor profile.
 *
 * @route GET /api/vendor/services?vendorId={id}
 * @auth Public for active service listings.
 *
 * @param request - Request with vendorId query parameter.
 * @returns Vendor service listings.
 */
export async function GET(request: NextRequest) {
  try {
    const vendorId = request.nextUrl.searchParams.get('vendorId')

    if (!vendorId) {
      return NextResponse.json({ error: 'vendorId required' }, { status: 400 })
    }

    const parsedVendorId = z.string().uuid().safeParse(vendorId)
    if (!parsedVendorId.success) {
      return NextResponse.json({ error: 'Invalid vendor id' }, { status: 400 })
    }

    const supabase = createClient()
    const { data, error } = await supabase
      .from('vendor_offerings')
      .select('*')
      .eq('vendor_id', parsedVendorId.data)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[vendor.services] Failed to list services', error)
      return NextResponse.json({ error: 'Failed to load services' }, { status: 500 })
    }

    const services = ((data as VendorServiceRow[] | null) || []).map(normalizeVendorService)
    return NextResponse.json({ services })
  } catch (error) {
    console.error('[vendor.services] Unexpected GET error', error)
    return NextResponse.json({ error: 'Failed to load services' }, { status: 500 })
  }
}

/**
 * Creates a vendor service listing.
 *
 * @route POST /api/vendor/services
 * @auth Required - vendor owner only.
 *
 * @param request - Service listing payload.
 * @returns Created service listing.
 */
export async function POST(request: NextRequest) {
  try {
    const parsedBody = servicePayloadSchema.safeParse(await request.json())

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid service payload', details: parsedBody.error.flatten() },
        { status: 400 }
      )
    }

    const supabase = createClient()
    const ownership = await requireOwnedVendor(supabase, parsedBody.data.vendorId)

    if (!ownership.ok) return ownership.response

    const payload = parsedBody.data
    const { data, error } = await supabase
      .from('vendor_offerings')
      .insert({
        vendor_id: ownership.vendorId,
        offering_name: payload.offering_name,
        description: payload.description || null,
        base_price: payload.base_price,
        pricing_model: 'flat_rate',
        duration_hours: payload.duration_hours || null,
        service_category: payload.service_category,
        max_capacity: payload.max_capacity || null,
        equipment_included: payload.equipment_included || [],
        add_ons: payload.add_ons || [],
        portfolio_images: [],
        is_included: true,
        is_active: payload.is_active ?? true,
      } as never)
      .select('*')
      .single()

    if (error) {
      console.error('[vendor.services] Failed to create service', error)
      return NextResponse.json({ error: 'Failed to create service' }, { status: 500 })
    }

    return NextResponse.json({ service: normalizeVendorService(data as VendorServiceRow) }, { status: 201 })
  } catch (error) {
    console.error('[vendor.services] Unexpected POST error', error)
    return NextResponse.json({ error: 'Failed to create service' }, { status: 500 })
  }
}

